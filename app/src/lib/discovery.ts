
import { createApiClient, setApiClient } from '../api/client';
import type { HttpError } from './http';
import { log, LogLevel } from './logger';
import { DISCOVERY_TIMEOUTS } from './zmninja-ng-constants';

/**
 * Options for the discoverUrls helper used by UI pages.
 */
export interface DiscoverUrlsOptions {
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  /** Called once an API client has been created for the discovered URL. */
  onClientCreated?: (client: ReturnType<typeof createApiClient>) => void;
}

/**
 * Result of the discovery process
 */
export interface DiscoveryResult {
    portalUrl: string;
    apiUrl: string;
    cgiUrl: string;
}

/**
 * Options for discovery
 */
export interface DiscoveryOptions {
    username?: string;
    password?: string;
    signal?: AbortSignal;
}

/**
 * Errors that can occur during discovery
 */
export class DiscoveryError extends Error {
    public code: 'PORTAL_UNREACHABLE' | 'API_NOT_FOUND' | 'CANCELLED' | 'UNKNOWN';

    constructor(message: string, code: 'PORTAL_UNREACHABLE' | 'API_NOT_FOUND' | 'CANCELLED' | 'UNKNOWN') {
        super(message);
        this.name = 'DiscoveryError';
        this.code = code;
    }
}

/**
 * Normalizes input URL and returns a list of base URLs to try.
 * If user specified a scheme, use it. Otherwise try HTTPS then HTTP.
 */
function getBaseCandidates(inputUrl: string): string[] {
    const cleanInput = inputUrl.trim().replace(/\/$/, '');

    // If scheme is specified, trust it
    if (cleanInput.startsWith('http://') || cleanInput.startsWith('https://')) {
        return [cleanInput];
    }

    // No scheme specified - try HTTPS first, then HTTP
    return [`https://${cleanInput}`, `http://${cleanInput}`];
}

/**
 * Check if a response status indicates a valid API endpoint.
 */
function isValidApiStatus(status?: number): boolean {
    // 200 OK: Valid
    // 401 Unauthorized: Valid (endpoint exists but needs auth)
    // 405 Method Not Allowed: Valid (endpoint exists)
    return status === 200 || status === 401 || status === 405;
}

/**
 * Try to probe the API at a given URL.
 * Returns true if the API is found, false otherwise.
 * Throws if signal is aborted.
 */
async function probeApi(apiUrl: string, signal?: AbortSignal): Promise<boolean> {
    // Check if already aborted
    if (signal?.aborted) {
        throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
    }

    const apiClient = createApiClient(apiUrl);

    // Try getVersion.json first
    let hadHttpError = false; // True if we got an HTTP response (even error), false if connection failed
    try {
        const res = await apiClient.get<{ version?: string; apiversion?: string }>('/host/getVersion.json', {
            timeout: 5000,
            headers: { 'Skip-Auth': 'true' },
            validateStatus: (status) => isValidApiStatus(status),
            signal
        });

        if (isValidApiStatus(res.status)) {
            // For 200 responses, verify it contains version info
            if (res.status === 200 && (!res.data || (!res.data.version && !res.data.apiversion))) {
                log.discovery(`Response from ${apiUrl}/host/getVersion.json was 200 but no version info`, LogLevel.DEBUG);
                hadHttpError = true; // Server responded, just not valid - try fallback
            } else {
                return true;
            }
        }
    } catch (error: unknown) {
        // Re-throw abort errors
        if (error instanceof Error && error.name === 'AbortError') {
            throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
        }
        const status = (error as HttpError)?.status;
        if (isValidApiStatus(status)) {
            return true;
        }
        // If we got an HTTP status, server is reachable but endpoint may not exist
        hadHttpError = status !== undefined;
        log.discovery(`getVersion probe failed for ${apiUrl}`, LogLevel.DEBUG, {
            error: error instanceof Error ? error.message : String(error),
            isConnectionError: !hadHttpError
        });
    }

    // Only try login.json fallback if we got an HTTP response (server reachable)
    // Skip if it was a connection error - login.json would also fail
    if (!hadHttpError) {
        return false;
    }

    // Check if aborted before trying fallback
    if (signal?.aborted) {
        throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
    }

    // Try login.json as fallback (for older ZM versions where getVersion.json may not exist)
    try {
        const loginRes = await apiClient.get('/host/login.json', {
            timeout: 5000,
            headers: { 'Skip-Auth': 'true' },
            validateStatus: (status) => isValidApiStatus(status),
            signal
        });

        if (isValidApiStatus(loginRes.status)) {
            return true;
        }
    } catch (loginError: unknown) {
        // Re-throw abort errors
        if (loginError instanceof Error && loginError.name === 'AbortError') {
            throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
        }
        const loginStatus = (loginError as HttpError)?.status;
        if (isValidApiStatus(loginStatus)) {
            return true;
        }
        log.discovery(`login.json probe failed for ${apiUrl}`, LogLevel.DEBUG, {
            error: loginError instanceof Error ? loginError.message : String(loginError)
        });
    }

    return false;
}

/**
 * Fetch ZMS path from server config after authentication.
 * Returns the full cgiUrl or null if fetch fails.
 * Throws if signal is aborted.
 */
async function fetchCgiUrl(apiUrl: string, portalUrl: string, options: DiscoveryOptions): Promise<string | null> {
    const { username, password, signal } = options;

    if (!username || !password) {
        log.discovery('No credentials provided, skipping ZMS path fetch', LogLevel.DEBUG);
        return null;
    }

    // Check if already aborted
    if (signal?.aborted) {
        throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
    }

    try {
        // Create and set API client for this API URL
        const client = createApiClient(apiUrl);
        setApiClient(client);

        // Authenticate using direct POST to avoid circular dependency with auth store
        log.discovery('Authenticating to fetch ZMS path', LogLevel.DEBUG);
        const formData = `user=${encodeURIComponent(username)}&pass=${encodeURIComponent(password)}`;
        const loginResponse = await client.post<{ access_token?: string }>('/host/login.json', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal
        });

        if (!loginResponse.data?.access_token) {
            log.discovery('Login did not return access token', LogLevel.DEBUG);
            return null;
        }

        // Check if aborted before fetching config
        if (signal?.aborted) {
            throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
        }

        // Fetch ZMS path from server config (include token in request)
        log.discovery('Fetching ZM_PATH_ZMS from server config', LogLevel.DEBUG);
        const configResponse = await client.get<{ config?: { Value?: string } }>(
            `/configs/viewByName/ZM_PATH_ZMS.json?token=${loginResponse.data.access_token}`,
            { signal }
        );

        const zmsPath = configResponse.data?.config?.Value;
        if (zmsPath) {
            // ZMS path is absolute from web root (e.g., /zm/cgi-bin/nph-zms)
            // Combine with origin to get full URL
            const url = new URL(portalUrl);
            const cgiUrl = `${url.origin}${zmsPath}`;
            log.discovery('ZMS path fetched from server', LogLevel.INFO, { zmsPath, cgiUrl });
            return cgiUrl;
        }
    } catch (error) {
        // Re-throw abort/cancel errors
        if (error instanceof DiscoveryError && error.code === 'CANCELLED') {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
        }
        log.discovery('Failed to fetch ZMS path (will use default)', LogLevel.DEBUG, {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    return null;
}

/**
 * Discover ZoneMinder connection details.
 *
 * Strategy:
 * 1. For each base URL candidate (https/http), try to find the API at /zm/api or /api
 * 2. Once API is found, derive portalUrl from the API URL
 * 3. If credentials provided, authenticate and fetch ZM_PATH_ZMS for accurate cgiUrl
 * 4. Otherwise, derive cgiUrl from portalUrl
 *
 * @param inputUrl The URL or hostname entered by the user
 * @param options Optional credentials for authentication
 */
export async function discoverZoneminder(inputUrl: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
    const { signal } = options;

    // Check if already aborted
    if (signal?.aborted) {
        throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
    }

    const baseCandidates = getBaseCandidates(inputUrl);
    const apiPaths = ['/zm/api', '/api'];

    log.discovery(`Starting discovery for: "${inputUrl}"`, LogLevel.INFO, { candidates: baseCandidates });

    // Try each base URL candidate with each API path
    for (const baseUrl of baseCandidates) {
        for (const apiPath of apiPaths) {
            // Check for cancellation between probes
            if (signal?.aborted) {
                throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
            }

            const fullApiUrl = `${baseUrl}${apiPath}`;
            log.discovery(`Probing API: ${fullApiUrl}`, LogLevel.DEBUG);

            try {
                const found = await probeApi(fullApiUrl, signal);
                if (found) {
                    log.discovery(`API confirmed: ${fullApiUrl}`, LogLevel.INFO);

                    // Derive portalUrl from the confirmed API URL
                    // API URL format: {base}{apiPath} where apiPath is /zm/api or /api
                    // portalUrl = API URL minus "/api" suffix
                    const portalUrl = fullApiUrl.replace(/\/api$/, '');

                    // Try to fetch actual ZMS path from server (requires auth)
                    // Fall back to inference if auth fails or no credentials
                    let cgiUrl = await fetchCgiUrl(fullApiUrl, portalUrl, options);

                    if (!cgiUrl) {
                        // Default: derive from portalUrl
                        cgiUrl = portalUrl + '/cgi-bin/nph-zms';
                        log.discovery('Using default CGI URL', LogLevel.DEBUG, { cgiUrl });
                    }

                    log.discovery(`Discovery complete`, LogLevel.INFO, { portalUrl, apiUrl: fullApiUrl, cgiUrl });

                    return {
                        portalUrl,
                        apiUrl: fullApiUrl,
                        cgiUrl,
                    };
                }
            } catch (error) {
                // Re-throw cancel errors
                if (error instanceof DiscoveryError && error.code === 'CANCELLED') {
                    throw error;
                }
                log.discovery(`API probe error for ${fullApiUrl}`, LogLevel.DEBUG, {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    // No API found at any candidate
    throw new DiscoveryError(
        `Could not find ZoneMinder API. Tried /zm/api and /api at ${baseCandidates.join(', ')}`,
        'API_NOT_FOUND'
    );
}

/**
 * Discover ZoneMinder URLs from a portal address, with iOS retry logic.
 *
 * Wraps `discoverZoneminder` with a single retry on network failure to handle
 * the iOS local network permission dialog: the first request fails while the
 * dialog is showing, but succeeds after the user grants access.
 *
 * Calls `onClientCreated` once an API client has been created for the found URL.
 */
export async function discoverUrls(
    portal: string,
    { credentials, signal, onClientCreated }: DiscoverUrlsOptions = {}
): Promise<DiscoveryResult> {
    const attempt = async () => {
        const result = await discoverZoneminder(portal, { ...credentials, signal });
        const client = createApiClient(result.apiUrl);
        onClientCreated?.(client);
        return result;
    };

    try {
        return await attempt();
    } catch (e) {
        // On network-related failures, retry once after a delay.
        // This handles the iOS local network permission dialog: the first request
        // fails while the dialog is showing, but succeeds after the user grants access.
        if (e instanceof DiscoveryError && (e.code === 'API_NOT_FOUND' || e.code === 'PORTAL_UNREACHABLE')) {
            log.discovery('First discovery attempt failed, retrying in case of iOS permission dialog', LogLevel.INFO);
            await new Promise((resolve) => setTimeout(resolve, DISCOVERY_TIMEOUTS.iosPermissionRetryMs));
            if (signal?.aborted) {
                throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
            }
            try {
                return await attempt();
            } catch (retryError) {
                if (retryError instanceof DiscoveryError) {
                    throw retryError;
                }
                throw new DiscoveryError('Discovery failed', 'UNKNOWN');
            }
        }
        if (e instanceof DiscoveryError) {
            throw e;
        }
        throw new DiscoveryError('Discovery failed', 'UNKNOWN');
    }
}
