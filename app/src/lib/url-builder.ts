/**
 * URL Builder Utility
 *
 * Centralized utility for building ZoneMinder URLs with consistent:
 * - Protocol normalization
 * - Query parameter handling
 * - Token injection
 * - API URL coordination
 *
 * Eliminates duplication of URL construction logic across the codebase.
 */

import { log, LogLevel } from './logger';

/**
 * Normalize a portal URL to ensure it has a proper protocol.
 * Preserves the existing protocol if present, otherwise defaults to http.
 *
 * @param portalUrl - The portal URL (may or may not have protocol)
 * @param _apiUrl - Unused parameter (kept for backwards compatibility)
 * @returns Normalized URL with protocol
 */
export function normalizePortalUrl(portalUrl: string, _apiUrl?: string): string {
  let baseUrl = portalUrl;

  // Add protocol if missing (default to http)
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `http://${baseUrl}`;
  }

  // Preserve the existing protocol - do NOT force protocol coordination
  // The portalUrl and apiUrl can have different protocols if needed
  return baseUrl;
}

/**
 * Build a query string from parameters, optionally including auth token.
 *
 * @param params - Parameter object
 * @param token - Optional auth token to include
 * @returns Query string (without leading '?')
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined>,
  token?: string
): string {
  const finalParams: Record<string, string> = {};

  // Add all provided params
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      finalParams[key] = String(value);
    }
  });

  // Add token if provided
  if (token) {
    finalParams.token = token;
  }

  return new URLSearchParams(finalParams).toString();
}

/**
 * Apply multi-port streaming to a URL.
 * When minStreamingPort is configured, the port is set to minStreamingPort + monitorId.
 * This matches ZoneMinder's per-monitor port routing.
 */
function applyMultiPort(url: string, monitorId: string, minStreamingPort?: number): string {
  if (!minStreamingPort) return url;
  try {
    const parsed = new URL(url);
    const monitorIdNum = parseInt(monitorId, 10);
    if (!isNaN(monitorIdNum) && minStreamingPort > 0) {
      parsed.port = (minStreamingPort + monitorIdNum).toString();
      return parsed.toString();
    }
  } catch {
    // Fallback to original URL if parsing fails
  }
  return url;
}

/**
 * Build a complete URL with normalized base and query parameters.
 *
 * @param portalUrl - Base portal URL
 * @param path - Path to append (e.g., '/index.php', '/cgi-bin/nph-zms')
 * @param params - Query parameters
 * @param token - Optional auth token
 * @param apiUrl - Optional API URL for protocol coordination
 * @returns Complete URL with query string
 */
export function buildUrl(
  portalUrl: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  token?: string,
  apiUrl?: string
): string {
  const baseUrl = normalizePortalUrl(portalUrl, apiUrl);
  const queryString = buildQueryString(params, token);

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return queryString
    ? `${baseUrl}${normalizedPath}?${queryString}`
    : `${baseUrl}${normalizedPath}`;
}

/**
 * Get monitor stream URL (ZMS MJPEG stream)
 *
 * @param cgiUrl - Full CGI-BIN URL including nph-zms (e.g., portalUrl/cgi-bin/nph-zms)
 * @param monitorId - Monitor ID
 * @param options - Stream options
 * @returns Stream URL
 */
export function getMonitorStreamUrl(
  cgiUrl: string,
  monitorId: string,
  options: {
    mode?: 'jpeg' | 'single' | 'stream';
    scale?: number;
    width?: number;
    height?: number;
    maxfps?: number;
    buffer?: number;
    token?: string;
    connkey?: number;
    cacheBuster?: number;
    minStreamingPort?: number; // Base port for multi-port streaming
  } = {}
): string {
  const params: Record<string, string> = {
    monitor: monitorId,
    mode: options.mode || 'jpeg',
  };

  if (options.scale) params.scale = options.scale.toString();
  if (options.width) params.width = `${options.width}px`;
  if (options.height) params.height = `${options.height}px`;
  if (options.maxfps) params.maxfps = options.maxfps.toString();
  if (options.buffer) params.buffer = options.buffer.toString();
  if (options.token) params.token = options.token;
  if (options.connkey) params.connkey = options.connkey.toString();
  if (options.cacheBuster) params._t = options.cacheBuster.toString();

  const queryString = new URLSearchParams(params).toString();

  // cgiUrl already includes /nph-zms (from discovery or ZM_PATH_ZMS API)
  // If minStreamingPort is set, apply per-monitor port routing
  if (options.minStreamingPort) {
    const multiPortUrl = applyMultiPort(cgiUrl, monitorId, options.minStreamingPort);
    if (multiPortUrl !== cgiUrl) {
      return `${multiPortUrl}?${queryString}`;
    }
  }

  return `${cgiUrl}?${queryString}`;
}


/**
 * Get monitor control command URL
 *
 * @param portalUrl - Portal URL
 * @param monitorId - Monitor ID
 * @param command - Command to send
 * @param options - Additional options
 * @returns Control command URL
 */
export function getMonitorControlUrl(
  portalUrl: string,
  monitorId: string,
  command: string,
  options: {
    token?: string;
    apiUrl?: string;
    minStreamingPort?: number;
  } = {}
): string {
  const { token, apiUrl, minStreamingPort } = options;

  const params: Record<string, string> = {
    view: 'request',
    request: 'control',
    id: monitorId,
    control: command,
  };

  // ZM classic UI attaches xge/yge only when the HTML button carries
  // data-xtell/data-ytell — i.e. only for axis commands. Preset, home, reset,
  // wake/sleep buttons have no xtell/ytell and are sent without xge/yge
  // (web/skins/classic/views/js/watch.js:402-439). The server uses presence
  // of xge/yge as a routing key in web/includes/control_functions.php:9 — if
  // they're set it parses `control` as a movement-axis camelCase command and
  // logs "Invalid control parameter" for anything that doesn't match the
  // axis regex (presetGoto<N>, moveStop, presetHome, reset). Match ZM's
  // emit pattern: only attach xge/yge for axis + mode + direction commands.
  if (/^(move|zoom|focus|iris|white|gain)(Con|Rel|Abs)[A-Z]/.test(command)) {
    params.xge = '0';
    params.yge = '0';
  }

  const url = buildUrl(portalUrl, '/index.php', params, token, apiUrl);

  return applyMultiPort(url, monitorId, minStreamingPort);
}

/**
 * Get event image URL
 *
 * @param portalUrl - Portal URL
 * @param eventId - Event ID
 * @param frame - Frame number or special frame type
 * @param options - Image options
 * @returns Event image URL
 */
export function getEventImageUrl(
  portalUrl: string,
  eventId: string,
  frame: number | 'snapshot' | 'alarm' | 'objdetect' | string,
  options: {
    token?: string;
    width?: number;
    height?: number;
    apiUrl?: string;
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  const { token, width, height, apiUrl, minStreamingPort, monitorId } = options;

  const params: Record<string, string | number> = {
    view: 'image',
    eid: eventId,
    fid: typeof frame === 'number' ? frame : frame,
  };

  if (width) params.width = width;
  if (height) params.height = height;

  const url = buildUrl(portalUrl, '/index.php', params, token, apiUrl);
  return applyMultiPort(url, monitorId || '', minStreamingPort);
}

/**
 * Get event video URL (MP4/H.264 format)
 *
 * ZoneMinder requires mode=mpeg (not view=video) for MP4 video playback.
 * This URL is used directly with video.js for event video playback.
 *
 * Format: /index.php?mode=mpeg&format=h264&eid=<eventId>&view=view_video&token=<token>
 *
 * @param portalUrl - Portal URL
 * @param eventId - Event ID
 * @param options - Video options
 * @param options.token - Authentication token
 * @param options.apiUrl - API URL for protocol coordination (optional)
 * @param options.format - Video codec: 'h264' (default) or 'h265'
 * @returns Event video URL for direct video.js playback
 *
 * @example
 * getEventVideoUrl('https://zm.com', '123', { token: 'abc' })
 * // Returns: 'https://zm.com/index.php?mode=mpeg&format=h264&eid=123&view=view_video&token=abc'
 */
export function getEventVideoUrl(
  portalUrl: string,
  eventId: string,
  options: {
    token?: string;
    apiUrl?: string;
    format?: 'h264' | 'h265';
    /** When true, use HLS mode (mode=hls&view=view_event_hls) instead of MP4 */
    hls?: boolean;
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  const { token, apiUrl, format = 'h264', hls = false, minStreamingPort, monitorId } = options;

  const params: Record<string, string> = hls
    ? {
        mode: 'hls',
        eid: eventId,
        view: 'view_event_hls',
      }
    : {
        mode: 'mpeg',
        format,
        eid: eventId,
        view: 'view_video',
      };

  const url = buildUrl(portalUrl, '/index.php', params, token, apiUrl);
  return applyMultiPort(url, monitorId || '', minStreamingPort);
}

/**
 * Get ZMS event playback URL (MJPEG stream of recorded event)
 *
 * @param portalUrl - Portal URL
 * @param eventId - Event ID
 * @param options - Playback options
 * @returns ZMS event stream URL
 */
export function getEventZmsUrl(
  portalUrl: string,
  eventId: string,
  options: {
    token?: string;
    apiUrl?: string;
    frame?: number;
    rate?: number;
    maxfps?: number;
    replay?: 'single' | 'all' | 'gapless' | 'none';
    scale?: number;
    connkey?: string;
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  const {
    token,
    apiUrl,
    frame = 1,
    rate = 100,
    maxfps = 30,
    replay = 'single',
    scale = 100,
    connkey,
    minStreamingPort,
    monitorId,
  } = options;

  const params: Record<string, string | number> = {
    mode: 'jpeg',
    source: 'event',
    event: eventId,
    frame,
    rate,
    maxfps,
    replay,
    scale,
  };

  if (connkey) params.connkey = connkey;

  const url = buildUrl(portalUrl, '/cgi-bin/nph-zms', params, token, apiUrl);
  return applyMultiPort(url, monitorId || '', minStreamingPort);
}

/**
 * Get ZMS stream control command URL
 *
 * @param portalUrl - Portal URL
 * @param command - ZM command number
 * @param connkey - Connection key
 * @param options - Additional options
 * @returns Stream control URL
 */
export function getZmsControlUrl(
  portalUrl: string,
  command: number,
  connkey: string,
  options: {
    token?: string;
    apiUrl?: string;
    offset?: number;
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  const { token, apiUrl, offset, minStreamingPort, monitorId } = options;

  const params: Record<string, string | number> = {
    command: command.toString(),
    connkey,
    view: 'request',
    request: 'stream',
  };

  if (offset !== undefined) params.offset = offset;

  const url = buildUrl(portalUrl, '/index.php', params, token, apiUrl);
  return applyMultiPort(url, monitorId || '', minStreamingPort);
}

/**
 * Build Go2RTC WebSocket URL for WebRTC signaling.
 *
 * Uses ZM_GO2RTC_PATH from server config and constructs WebSocket URL matching
 * ZoneMinder's official implementation. Stream name format: {monitorId}_{channel}
 *
 * Protocol conversion:
 * - http:// → ws://
 * - https:// → wss://
 *
 * @param go2rtcPath - Full Go2RTC URL from ZM_GO2RTC_PATH config (e.g., "http://server:1984")
 * @param monitorId - Monitor ID (numeric)
 * @param channel - Channel number (0 = primary, 1 = secondary, default: 0)
 * @param options - Additional options
 * @returns WebSocket URL for go2rtc signaling
 *
 * @example
 * getGo2RTCWebSocketUrl('http://zm.example.com:1984', '1', 0, { token: 'abc' })
 * // Returns: 'ws://zm.example.com:1984/ws?src=1_0&token=abc'
 *
 * getGo2RTCWebSocketUrl('http://zm.example.com:1984/go2rtc', '5', 1)
 * // Returns: 'ws://zm.example.com:1984/go2rtc/ws?src=5_1'
 */
export function getGo2RTCWebSocketUrl(
  go2rtcPath: string,
  monitorId: string,
  channel: string | number = 0,
  options: {
    token?: string;
  } = {}
): string {
  const { token } = options;

  // Parse the configured Go2RTC path
  const url = new URL(go2rtcPath);

  // NOTE: Keep credentials in URL if present - ZoneMinder does NOT strip them
  // The server/proxy may handle authentication via URL credentials
  // (ZoneMinder's MonitorStream.js keeps credentials when building WebSocket URL)

  // Convert http/https to ws/wss (matches ZoneMinder implementation)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  // Append /ws to existing pathname (matches ZoneMinder: webrtcUrl.pathname += "/ws")
  url.pathname += url.pathname.endsWith('/') ? 'ws' : '/ws';

  // Build stream name: {monitorId}_{channel} (matches ZoneMinder format)
  const streamName = `${monitorId}_${channel}`;
  url.searchParams.set('src', streamName);

  if (token) {
    url.searchParams.set('token', token);
  }

  const finalUrl = url.toString();

  log.http(
    'Built Go2RTC WebSocket URL',
    LogLevel.INFO,
    { go2rtcPath, monitorId, channel, streamName, finalUrl, hasToken: !!token, protocol: url.protocol }
  );

  return finalUrl;
}

/**
 * Build Go2RTC HTTP stream URL for MSE/HLS/MP4/MJPEG fallback.
 *
 * Uses ZM_GO2RTC_PATH from server config and constructs HTTP streaming URL.
 * Stream name format: {monitorId}_{channel}
 *
 * @param go2rtcPath - Full Go2RTC URL from ZM_GO2RTC_PATH config (e.g., "http://server:1984")
 * @param monitorId - Monitor ID (numeric)
 * @param channel - Channel number (0 = primary, 1 = secondary, default: 0)
 * @param streamType - Stream type (mse, hls, mp4, mjpeg)
 * @param options - Additional options
 * @returns HTTP stream URL for go2rtc
 *
 * @example
 * getGo2RTCStreamUrl('http://zm.example.com:1984', '1', 0, 'hls', { token: 'abc' })
 * // Returns: 'http://zm.example.com:1984/api/stream.hls?src=1_0&token=abc'
 */
export function getGo2RTCStreamUrl(
  go2rtcPath: string,
  monitorId: string,
  channel: string | number = 0,
  streamType: 'mse' | 'hls' | 'mp4' | 'mjpeg',
  options: {
    token?: string;
  } = {}
): string {
  const { token } = options;

  // Parse the configured Go2RTC path
  const url = new URL(go2rtcPath);

  // Append /stream.{type} to existing pathname (matches Go2RTC API structure)
  // If ZM_GO2RTC_PATH is "http://server:1984/api", pathname is "/api"
  // We append "/stream.{type}" to get "/api/stream.{type}"
  const pathSuffix = url.pathname.endsWith('/') ? `stream.${streamType}` : `/stream.${streamType}`;
  url.pathname += pathSuffix;

  // Build stream name: {monitorId}_{channel}
  const streamName = `${monitorId}_${channel}`;
  url.searchParams.set('src', streamName);

  if (token) {
    url.searchParams.set('token', token);
  }

  const finalUrl = url.toString();

  log.http(
    'Built Go2RTC stream URL',
    LogLevel.INFO,
    { go2rtcPath, monitorId, channel, streamName, streamType, finalUrl, hasToken: !!token }
  );

  return finalUrl;
}
