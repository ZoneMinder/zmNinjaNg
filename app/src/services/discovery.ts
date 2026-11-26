
import type { ApiClient } from '../api/client';
import { createStoreApiClient } from '../api/store-gates';
import { LoginResponseSchema, PROBE_PROFILE_ID, type LoginResponse, type ProfileId } from '../api/types';
import type { HttpError } from '../lib/http';
import { log, LogLevel } from '../lib/logger';
import { isAbortError } from '../lib/is-abort-error';
import { DISCOVERY_TIMEOUTS } from '../lib/zmninja-ng-constants';
import { firstAnsweringStreamUrl } from '../lib/zm/zms-probe';

/**
 * Options for the discoverUrls helper used by UI pages.
 */
export interface DiscoverUrlsOptions {
  /**
   * The profile this discovery/connection-test session belongs to. A caller
   * adding a new profile mints the id before this call (see ProfileForm.tsx)
   * so the same id carries into the saved profile; a caller re-testing an
   * existing profile passes its real id. Defaults to PROBE_PROFILE_ID (never
   * a saved profile, and excluded from auth persistence, so the resulting
   * auth slice stays empty and never survives a reload) when the caller has
   * no profile id yet - this module stays store-free, so it never reads one
   * for itself.
   */
  profileId?: ProfileId;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  /** Called once an API client has been created for the discovered URL. */
  onClientCreated?: (client: ApiClient) => void;
}

/**
 * Result of the discovery process
 */
export interface DiscoveryResult {
    portalUrl: string;
    apiUrl: string;
    cgiUrl: string;
    /** 'server' when cgiUrl is the server's ZM_PATH_ZMS, 'default' for `<portal>/cgi-bin/nph-zms`. */
    cgiUrlSource: 'server' | 'default';
    /** Whether cgiUrl returned a frame; absent when there was no monitor to ask (refs #613). */
    cgiUrlVerified?: boolean;
    /**
     * The login discovery performed to read ZM_PATH_ZMS, when credentials
     * were given and the server issued tokens. ZoneMinder's login.json
     * hashes the password server-side and costs ~0.6s, 20x any other call;
     * a caller that holds this can install it instead of logging in again.
     */
    loginResponse?: LoginResponse;
}

/** The streaming URL wasn't confirmed by a frame: it failed, or it's the fallback and there was no monitor to ask. */
export function streamUrlUnconfirmed(result: Pick<DiscoveryResult, 'cgiUrlSource' | 'cgiUrlVerified'>): boolean {
    return result.cgiUrlVerified === false || (result.cgiUrlVerified === undefined && result.cgiUrlSource === 'default');
}

/**
 * Options for discovery
 */
export interface DiscoveryOptions {
    /** See DiscoverUrlsOptions.profileId - same default when omitted. */
    profileId?: ProfileId;
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
async function probeApi(apiUrl: string, profileId: ProfileId, signal?: AbortSignal): Promise<boolean> {
    // Check if already aborted
    if (signal?.aborted) {
        throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
    }

    const apiClient = createStoreApiClient(apiUrl, undefined, profileId);

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
        if (isAbortError(error)) {
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
        if (isAbortError(loginError)) {
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
 * Read the server's ZM_PATH_ZMS and one monitor id to test stream URLs with,
 * logging in first when credentials are given (a server with auth off answers
 * without a token). Returns nulls for whatever it couldn't read. Throws if
 * signal is aborted.
 */
interface CgiFetch {
    cgiUrl: string | null;
    monitorId?: string;
    token?: string;
    loginResponse?: LoginResponse;
}

async function fetchCgiUrl(apiUrl: string, portalUrl: string, options: DiscoveryOptions, profileId: ProfileId): Promise<CgiFetch> {
    const { username, password, signal } = options;

    // Check if already aborted
    if (signal?.aborted) {
        throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
    }

    try {
        // Create the API client for this API URL
        const client = createStoreApiClient(apiUrl, undefined, profileId);

        let token: string | undefined;
        let validLogin: LoginResponse | undefined;
        if (username && password) {
            // Authenticate using direct POST to avoid circular dependency with auth store
            log.discovery('Authenticating to fetch ZMS path', LogLevel.DEBUG);
            const formData = `user=${encodeURIComponent(username)}&pass=${encodeURIComponent(password)}`;
            const loginResponse = await client.post<{ access_token?: string }>('/host/login.json', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal
            });

            if (!loginResponse.data?.access_token) {
                log.discovery('Login did not return access token', LogLevel.DEBUG);
                return { cgiUrl: null };
            }
            token = loginResponse.data.access_token;
            // Validated so the caller can hand it to the auth store as-is; a body
            // the schema rejects is treated as no login rather than a bad one.
            const parsedLogin = LoginResponseSchema.safeParse(loginResponse.data);
            validLogin = parsedLogin.success ? parsedLogin.data : undefined;
        }
        const tokenQuery = token ? `?token=${token}` : '';

        // Check if aborted before fetching config
        if (signal?.aborted) {
            throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
        }

        // Fetch ZMS path from server config (include token in request)
        log.discovery('Fetching ZM_PATH_ZMS from server config', LogLevel.DEBUG);
        const configResponse = await client.get<{ config?: { Value?: string } }>(
            `/configs/viewByName/ZM_PATH_ZMS.json${tokenQuery}`,
            { signal }
        );
        const zmsPath = configResponse?.data?.config?.Value;
        // ZMS path is absolute from web root (e.g., /zm/cgi-bin/nph-zms)
        const cgiUrl = zmsPath ? `${new URL(portalUrl).origin}${zmsPath}` : null;
        if (cgiUrl) log.discovery('ZMS path fetched from server', LogLevel.INFO, { zmsPath, cgiUrl });

        // Any monitor proves a stream path: nph-zms answers a frame for one
        // that isn't capturing, but a capturing one is the likelier answer.
        type MonitorList = { monitors?: Array<{ Monitor?: { Id?: string; Capturing?: string } }> };
        const monitorsResponse = await Promise.resolve()
            .then(() => client.get<MonitorList>(`/monitors.json${tokenQuery}`, { signal }))
            .catch(() => undefined); // no list, no frame check
        const list = (monitorsResponse?.data?.monitors ?? []).flatMap((m) => (m.Monitor?.Id ? [m.Monitor] : []));
        const monitorId = (list.find((m) => m.Capturing !== 'None') ?? list[0])?.Id;
        return { cgiUrl, monitorId, token, loginResponse: validLogin };
    } catch (error) {
        // Re-throw abort/cancel errors
        if (error instanceof DiscoveryError && error.code === 'CANCELLED') {
            throw error;
        }
        if (isAbortError(error)) {
            throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
        }
        log.discovery('Failed to fetch ZMS path (will use default)', LogLevel.DEBUG, {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    return { cgiUrl: null };
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
    const profileId = options.profileId ?? PROBE_PROFILE_ID;

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
                const found = await probeApi(fullApiUrl, profileId, signal);
                if (found) {
                    log.discovery(`API confirmed: ${fullApiUrl}`, LogLevel.INFO);

                    // Derive portalUrl from the confirmed API URL
                    // API URL format: {base}{apiPath} where apiPath is /zm/api or /api
                    // portalUrl = API URL minus "/api" suffix
                    const portalUrl = fullApiUrl.replace(/\/api$/, '');

                    const fetched = await fetchCgiUrl(fullApiUrl, portalUrl, options, profileId);
                    // The server's path first, then the usual one; the first
                    // that returns a frame wins (refs #613).
                    const fallback = portalUrl + '/cgi-bin/nph-zms';
                    const candidates = [...new Set([fetched.cgiUrl ?? fallback, fallback])];
                    const answering = fetched.monitorId
                        ? await firstAnsweringStreamUrl(candidates, fetched.monitorId, fetched.token)
                        : null;
                    if (signal?.aborted) throw new DiscoveryError('Discovery cancelled', 'CANCELLED');
                    const cgiUrl = answering ?? candidates[0];
                    const cgiUrlSource = cgiUrl === fetched.cgiUrl ? 'server' : 'default';

                    log.discovery(`Discovery complete`, LogLevel.INFO, { portalUrl, apiUrl: fullApiUrl, cgiUrl, cgiUrlSource });

                    return {
                        portalUrl,
                        apiUrl: fullApiUrl,
                        cgiUrl,
                        cgiUrlSource,
                        ...(fetched.monitorId ? { cgiUrlVerified: answering !== null } : {}),
                        ...(fetched.loginResponse ? { loginResponse: fetched.loginResponse } : {}),
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
    { credentials, signal, onClientCreated, profileId }: DiscoverUrlsOptions = {}
): Promise<DiscoveryResult> {
    const resolvedProfileId = profileId ?? PROBE_PROFILE_ID;
    const attempt = async () => {
        const result = await discoverZoneminder(portal, { ...credentials, signal, profileId: resolvedProfileId });
        const client = createStoreApiClient(result.apiUrl, undefined, resolvedProfileId);
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
