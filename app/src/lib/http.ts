/**
 * Unified HTTP Client
 *
 * Provides a platform-agnostic HTTP interface that works across Web, iOS, Android, and Desktop.
 * Handles CORS, proxying, and platform-specific implementations automatically.
 *
 * Features:
 * - Automatic platform detection (Native/Tauri/Web/Proxy)
 * - CORS handling via native HTTP or proxy
 * - Token injection for authenticated requests
 * - Response type handling (json, blob, arraybuffer, text, base64)
 * - Logging integration
 */

import { Platform } from './platform';
import { log, LogLevel } from './logger';

// Monotonically increasing request ID counter for correlation
let requestIdCounter = 0;

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  body?: unknown;
  responseType?: 'json' | 'blob' | 'arraybuffer' | 'text' | 'base64';
  token?: string; // Optional auth token to inject
  timeoutMs?: number;
  timeout?: number;
  signal?: AbortSignal;
  validateStatus?: (status: number) => boolean;
  onDownloadProgress?: (progress: HttpProgress) => void;
  /**
   * Caller-supplied correlation ID (e.g., from api/client.ts) so the wire-level
   * HTTP log can be tied back to the originating API request without inspecting
   * stack traces. Rendered as `{api:N, http:M}` in the completion line.
   */
  correlationId?: number;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface HttpProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface HttpError extends Error {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
}

function createHttpError(
  status: number,
  statusText: string,
  data: unknown,
  headers: Record<string, string>
): HttpError {
  const error = new Error(`HTTP ${status}: ${statusText}`) as HttpError;
  error.status = status;
  error.statusText = statusText;
  error.data = data;
  error.headers = headers;
  return error;
}

/**
 * Serialize request body to string for fetch-based requests
 */
function serializeRequestBody(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return JSON.stringify(body);
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const responseHeaders: Record<string, string> = {};
  headers.forEach((value: string, key: string) => {
    responseHeaders[key] = value;
  });
  return responseHeaders;
}

function stringifyParams(params: Record<string, string | number>): Record<string, string> {
  const stringParams: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    stringParams[key] = String(value);
  });
  return stringParams;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function readResponseBytes(
  response: Response,
  onDownloadProgress?: (progress: HttpProgress) => void
): Promise<Uint8Array> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (onDownloadProgress) {
      onDownloadProgress({
        loaded: bytes.length,
        total: bytes.length,
        percentage: 100,
      });
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const contentLengthHeader = response.headers.get('content-length');
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  let loaded = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      if (onDownloadProgress) {
        const percentage = total > 0 ? Math.round((loaded * 100) / total) : 0;
        onDownloadProgress({ loaded, total, percentage });
      }
    }
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  if (onDownloadProgress) {
    onDownloadProgress({
      loaded,
      total: total || loaded,
      percentage: 100,
    });
  }

  return combined;
}

async function parseFetchResponse<T>(
  response: Response,
  responseType: string,
  onDownloadProgress?: (progress: HttpProgress) => void
): Promise<{ data: T; headers: Record<string, string> }> {
  const responseHeaders = normalizeHeaders(response.headers);

  let data: T;
  if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64') {
    const bytes = await readResponseBytes(response, onDownloadProgress);
    if (responseType === 'blob') {
      const contentType =
        responseHeaders['content-type'] ||
        responseHeaders['Content-Type'] ||
        'application/octet-stream';
      const blobBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      data = new Blob([blobBuffer], { type: contentType }) as T;
    } else if (responseType === 'arraybuffer') {
      data = bytes.buffer as T;
    } else {
      data = bytesToBase64(bytes) as T;
    }
  } else if (responseType === 'text') {
    const text = await response.text();
    data = text as T;
  } else {
    const text = await response.text();
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }

  return { data, headers: responseHeaders };
}

function withTimeoutSignal(timeoutMs?: number, signal?: AbortSignal): { signal?: AbortSignal; cleanup: () => void } {
  if (!timeoutMs) {
    return { signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/**
 * Extract the path + query for log lines so the host/proxy doesn't dominate.
 */
function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return url;
  }
}

/**
 * Flatten one level deep so console renders a single-line preview:
 * scalars stay, large strings truncate, arrays/nested objects collapse to a
 * "[N items]" / "{N keys}" summary. Sensitive values are still redacted by
 * the logger's sanitiser before this output reaches the console.
 */
function flattenForLog(value: unknown, depth = 1): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (depth <= 0) return `[${value.length} items]`;
    // Show short arrays of scalars in full, otherwise summarize
    const allScalar = value.every((v) => v === null || typeof v !== 'object');
    if (allScalar && value.length <= 5) return value;
    return `[${value.length} items]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (depth <= 0) return `{${entries.length} keys}`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = flattenForLog(v, depth - 1);
  }
  return out;
}

/** Decide whether a body summary is worth showing at all. */
function summarizeBody(data: unknown, responseType: string): unknown {
  if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64') {
    return undefined; // binary; not loggable
  }
  if (data === null || data === undefined) return undefined;
  if (typeof data === 'string') {
    if (data.length === 0) return undefined;
    return data.length > 200 ? `${data.slice(0, 200)}… (+${data.length - 200} chars)` : data;
  }
  if (Array.isArray(data) && data.length === 0) return undefined;
  if (typeof data === 'object' && Object.keys(data as object).length === 0) return undefined;
  return flattenForLog(data, 1);
}

function correlationPrefix(requestId: number, correlationId?: number): string {
  return correlationId !== undefined ? `{api:${correlationId}, http:${requestId}}` : `#${requestId}`;
}

/**
 * Make an HTTP request using the appropriate platform-specific method.
 *
 * @param url - The URL to request (full URL, not relative)
 * @param options - Request options
 * @returns Promise resolving to the response
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpOptions = {}
): Promise<HttpResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    params = {},
    body,
    responseType = 'json',
    token,
    timeout,
    timeoutMs,
    signal,
    validateStatus,
    onDownloadProgress,
    correlationId,
  } = options;

  // Add token to params if provided
  const finalParams = { ...params };
  if (token) {
    finalParams.token = token;
  }

  // Build query string
  const queryString = new URLSearchParams(stringifyParams(finalParams)).toString();
  const fullUrl = queryString ? (url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`) : url;

  // Handle proxy in dev mode for web
  let requestUrl = fullUrl;
  let requestHeaders = { ...headers };

  if (body && typeof body !== 'string' && !(body instanceof URLSearchParams)) {
    requestHeaders = {
      ...requestHeaders,
      'Content-Type': requestHeaders['Content-Type'] || 'application/json',
    };
  }

  if (Platform.shouldUseProxy && (url.startsWith('http://') || url.startsWith('https://'))) {
    // Extract the base URL to use as X-Target-Host
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    // Replace base URL with proxy
    requestUrl = fullUrl.replace(baseUrl, 'http://localhost:3001/proxy');
    requestHeaders['X-Target-Host'] = baseUrl;
  }

  // Generate monotonically increasing request ID for correlation
  const requestId = ++requestIdCounter;
  const platform = Platform.isNative ? 'Native' : Platform.isTauri ? 'Tauri' : 'Web';
  const startTime = performance.now();

  // Prepare request body for logging
  let requestBodyForLog: unknown = body;
  if (body instanceof URLSearchParams) {
    const formData: Record<string, string> = {};
    body.forEach((value, key) => {
      formData[key] = value;
    });
    requestBodyForLog = formData;
  }

  log.http(`[HTTP] Request #${requestId} ${method} ${fullUrl}`, LogLevel.DEBUG, {
    requestId,
    platform,
    method,
    url: fullUrl,
    params: Object.keys(finalParams).length > 0 ? finalParams : undefined,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    body: requestBodyForLog,
  });

  try {
    let response: HttpResponse<T>;
    if (Platform.isNative) {
      response = await nativeHttpRequest<T>(requestUrl, method, requestHeaders, body, responseType);
    } else if (Platform.isTauri) {
      const { signal: timeoutSignal, cleanup } = withTimeoutSignal(timeoutMs ?? timeout, signal);
      response = await tauriHttpRequest<T>(
        requestUrl,
        method,
        requestHeaders,
        body,
        responseType,
        timeoutSignal,
        onDownloadProgress
      );
      cleanup();
    } else {
      const { signal: timeoutSignal, cleanup } = withTimeoutSignal(timeoutMs ?? timeout, signal);
      response = await webHttpRequest<T>(
        requestUrl,
        method,
        requestHeaders,
        body,
        responseType,
        timeoutSignal,
        onDownloadProgress
      );
      cleanup();
    }

    const isValidStatus = validateStatus
      ? validateStatus(response.status)
      : response.status >= 200 && response.status < 300;

    if (!isValidStatus) {
      throw createHttpError(response.status, response.statusText, response.data, response.headers);
    }

    const duration = Math.round(performance.now() - startTime);

    // Prepare response data for logging (truncate large responses)
    let responseDataForLog: unknown = response.data;
    if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64') {
      responseDataForLog = `<Binary data: ${responseType}>`;
    } else if (typeof response.data === 'string' && response.data.length > 1000) {
      responseDataForLog = `${response.data.substring(0, 1000)}... (truncated, total: ${response.data.length} chars)`;
    } else if (typeof response.data === 'object' && response.data !== null) {
      const jsonString = JSON.stringify(response.data);
      if (jsonString.length > 2000) {
        responseDataForLog = `${jsonString.substring(0, 2000)}... (truncated, total: ${jsonString.length} chars)`;
      }
    }

    log.http(`[HTTP] Response #${requestId} ${method} ${fullUrl}`, LogLevel.DEBUG, {
      requestId,
      platform,
      method,
      url: fullUrl,
      status: response.status,
      statusText: response.statusText || undefined,
      duration: `${duration}ms`,
      headers: Object.keys(response.headers).length > 0 ? response.headers : undefined,
      data: responseDataForLog,
    });

    return response;
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const httpError = error as HttpError;

    log.http(`[HTTP] Failed #${requestId} ${method} ${fullUrl}`, LogLevel.ERROR, {
      requestId,
      platform,
      method,
      url: fullUrl,
      duration: `${duration}ms`,
      status: httpError.status || undefined,
      statusText: httpError.statusText || undefined,
      headers: httpError.headers && Object.keys(httpError.headers).length > 0 ? httpError.headers : undefined,
      errorData: httpError.data || undefined,
      error: httpError.message || error,
    });
    throw error;
  }
}

/**
 * Native (Capacitor) HTTP request implementation
 */
async function nativeHttpRequest<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  responseType: string
): Promise<HttpResponse<T>> {
  const { CapacitorHttp } = await import('@capacitor/core');
  const nativeResponseType =
    responseType === 'arraybuffer' ? 'arraybuffer' : responseType === 'blob' || responseType === 'base64' ? 'blob' : undefined;
  const response = await CapacitorHttp.request({
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD',
    url,
    headers,
    data: body,
    responseType: nativeResponseType,
  });

  const data = response.data as T;
  const responseHeaders = response.headers as Record<string, string>;

  return {
    data,
    status: response.status,
    statusText: '',
    headers: responseHeaders,
  };
}

/**
 * Tauri HTTP request implementation
 */
async function tauriHttpRequest<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  responseType: string,
  signal?: AbortSignal,
  onDownloadProgress?: (progress: HttpProgress) => void
): Promise<HttpResponse<T>> {
  const requestBody = serializeRequestBody(body);

  // Check if self-signed cert support is enabled for Tauri
  const { isTauriSslTrustEnabled } = await import('./ssl-trust');
  const dangerOpts = isTauriSslTrustEnabled()
    ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }
    : {};

  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  const response = await tauriFetch(url, {
    method,
    headers,
    body: requestBody,
    signal,
    ...dangerOpts,
  });

  const { data, headers: responseHeaders } = await parseFetchResponse<T>(response, responseType, onDownloadProgress);

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  };
}

/**
 * Web (fetch) HTTP request implementation
 */
async function webHttpRequest<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  responseType: string,
  signal?: AbortSignal,
  onDownloadProgress?: (progress: HttpProgress) => void
): Promise<HttpResponse<T>> {
  const requestBody = serializeRequestBody(body);

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
    signal,
  });

  const { data, headers: responseHeaders } = await parseFetchResponse<T>(response, responseType, onDownloadProgress);

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  };
}

/**
 * Convenience method for GET requests
 */
export async function httpGet<T = unknown>(
  url: string,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'GET' });
}

/**
 * Convenience method for POST requests
 */
export async function httpPost<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'POST', body });
}

/**
 * Convenience method for PUT requests
 */
export async function httpPut<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'PUT', body });
}

/**
 * Convenience method for DELETE requests
 */
export async function httpDelete<T = unknown>(
  url: string,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'DELETE' });
}
