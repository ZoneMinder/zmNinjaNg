import { httpRequest, type HttpError, type HttpOptions, type HttpResponse } from '../lib/http';
import { useAuthStore } from '../stores/auth';
import { log, LogLevel } from '../lib/logger';
import { sanitizeObject } from '../lib/log-sanitizer';

export type ApiMethod = NonNullable<HttpOptions['method']>;

export interface ApiRequestConfig {
  baseURL?: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  responseType?: HttpOptions['responseType'];
  timeout?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  validateStatus?: (status: number) => boolean;
  onDownloadProgress?: HttpOptions['onDownloadProgress'];
  /**
   * Domain-level label rendered in the HTTP log headline, e.g.
   * "Fetch monitors list". Replaces the redundant log.api intent
   * line at the call site.
   */
  intent?: string;
}

export interface ApiClient {
  get<T = unknown>(url: string, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
  post<T = unknown>(url: string, data?: unknown, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
  put<T = unknown>(url: string, data?: unknown, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
  delete<T = unknown>(url: string, config?: ApiRequestConfig): Promise<HttpResponse<T>>;
}

let apiClient: ApiClient | null = null;

// Correlation ID counter - starts at 1, increments with each request, resets on app restart
let correlationIdCounter = 0;

function resolveUrl(baseURL: string, url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const trimmedBase = baseURL.replace(/\/$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${trimmedBase}${normalizedPath}`;
}

function appendQuery(url: string, params: Record<string, string | number>): string {
  const stringParams: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    stringParams[key] = String(value);
  });
  const queryParams = new URLSearchParams(stringParams).toString();
  if (!queryParams) return url;
  return url.includes('?') ? `${url}&${queryParams}` : `${url}?${queryParams}`;
}

// Track if login is currently in progress to prevent duplicate login attempts
let loginInProgress = false;
let loginPromise: Promise<boolean> | null = null;

export function createApiClient(baseURL: string, reLogin?: () => Promise<boolean>): ApiClient {
  const request = async <T>(
    method: ApiMethod,
    url: string,
    data?: unknown,
    config: ApiRequestConfig = {},
    hasRetried = false
  ): Promise<HttpResponse<T>> => {
    const correlationId = ++correlationIdCounter;
    const { accessToken, refreshToken, refreshTokenExpires, isAuthenticated } = useAuthStore.getState();
    const headers = { ...(config.headers ?? {}) };
    const params: Record<string, string | number> = { ...(config.params ?? {}) };

    const skipAuth = headers['Skip-Auth'] === 'true';
    const isLoginRequest = url.includes('login.json') && method.toUpperCase() === 'POST';

    // PROACTIVE: If not authenticated and not a login request, trigger login first
    if (!isAuthenticated && !skipAuth && !isLoginRequest && reLogin && !hasRetried) {
      log.api(`Request requires authentication, triggering login first`, LogLevel.DEBUG, {
        correlationId,
        method,
        url,
      });

      let loginSuccess = false;

      // If login already in progress, wait for it
      if (loginInProgress && loginPromise) {
        try {
          loginSuccess = await loginPromise;
        } catch (error) {
          log.api('Waiting for in-progress login failed', LogLevel.ERROR, error);
          throw new Error('Authentication required but concurrent login attempt failed');
        }
      } else {
        // Start new login
        loginInProgress = true;
        loginPromise = reLogin();
        try {
          loginSuccess = await loginPromise;
        } catch (error) {
          log.api('Proactive login failed', LogLevel.ERROR, error);
          throw error;
        } finally {
          loginInProgress = false;
          loginPromise = null;
        }
      }

      // Check if login actually succeeded before retrying
      if (!loginSuccess) {
        throw new Error('Authentication required but login failed');
      }

      // Retry the original request now that we're authenticated
      return request(method, url, data, config, true);
    }

    if (accessToken && !skipAuth && !isLoginRequest) {
      params.token = accessToken;
    }

    if (isLoginRequest && !skipAuth) {
      const nowMs = Date.now();
      const isRefreshTokenValid = refreshToken && refreshTokenExpires && refreshTokenExpires > nowMs;
      if (isRefreshTokenValid) {
        params.token = refreshToken;
      }
    }

    const resolvedBaseUrl = config.baseURL ?? baseURL;
    const fullUrl = resolveUrl(resolvedBaseUrl, url);
    const fullUrlWithParams = appendQuery(fullUrl, params);

    try {
      const response = await httpRequest<T>(fullUrl, {
        method,
        headers,
        params,
        body: data,
        responseType: config.responseType,
        timeout: config.timeout,
        timeoutMs: config.timeoutMs,
        validateStatus: config.validateStatus,
        signal: config.signal,
        onDownloadProgress: config.onDownloadProgress,
        correlationId,
        intent: config.intent,
      });

      return response;
    } catch (error) {
      const httpError = error as HttpError;
      if (httpError.status === 401 && !hasRetried && !skipAuth && !isLoginRequest) {
        try {
          const { refreshToken: refreshTokenValue, refreshAccessToken } = useAuthStore.getState();
          if (refreshTokenValue) {
            await refreshAccessToken();
            return request(method, url, data, config, true);
          }
          throw new Error('No refresh token available');
        } catch (refreshError) {
          if (reLogin) {
            try {
              const success = await reLogin();
              if (success) {
                return request(method, url, data, config, true);
              }
            } catch (reLoginError) {
              log.api('Re-login failed', LogLevel.ERROR, reLoginError);
            }
          }

          const { logout } = useAuthStore.getState();
          logout();
          throw refreshError;
        }
      }

      const errorData: Record<string, unknown> = {
        correlationId,
        method,
        url: fullUrlWithParams,
        zmUrl: fullUrl,
        status: httpError.status,
        statusText: httpError.statusText,
        message: httpError.message,
      };

      if (httpError.data) {
        errorData.responseData = sanitizeObject(httpError.data);
      }

      if (data) {
        if (data instanceof URLSearchParams) {
          const formDataObj: Record<string, string> = {};
          data.forEach((value: string, key: string) => {
            formDataObj[key] = value;
          });
          errorData.requestFormData = sanitizeObject(formDataObj);
        } else {
          errorData.requestBodyData = sanitizeObject(data);
        }
      }

      log.api(`[Error #${correlationId}] ${method} ${fullUrlWithParams}`, LogLevel.ERROR, {
        error,
        ...errorData,
      });

      throw error;
    }
  };

  return {
    get: <T>(url: string, config?: ApiRequestConfig) => request<T>('GET', url, undefined, config),
    post: <T>(url: string, data?: unknown, config?: ApiRequestConfig) => request<T>('POST', url, data, config),
    put: <T>(url: string, data?: unknown, config?: ApiRequestConfig) => request<T>('PUT', url, data, config),
    delete: <T>(url: string, config?: ApiRequestConfig) => request<T>('DELETE', url, undefined, config),
  };
}

export function getApiClient(): ApiClient {
  if (!apiClient) {
    throw new Error('API client not initialized. Call createApiClient first.');
  }
  return apiClient;
}

export function setApiClient(client: ApiClient): void {
  apiClient = client;
}

export function resetApiClient(): void {
  apiClient = null;
}
