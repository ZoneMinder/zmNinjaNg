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

import { log, LogLevel } from '../logger';

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
    /** Stop a jpeg stream after this many frames (ZM 1.38+). */
    frames?: number;
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

  if (options.frames) params.frames = options.frames.toString();
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

  // The Perl driver method is `presetGoto` and reads its preset number from a
  // separate `preset` parameter (scripts/ZoneMinder/lib/ZoneMinder/Control/*.pm).
  // ZM's PHP layer accepts both the legacy concatenated `presetGoto<N>` form
  // (matched by a regex in web/includes/control_functions.php:698) and the
  // structured form (line 701: `control=presetGoto` + `preset=<N>`). Emit the
  // structured form so the client doesn't depend on the server-side regex
  // translation surviving future refactors.
  const presetGotoMatch = /^presetGoto(\d+)$/.exec(command);
  const controlCommand = presetGotoMatch ? 'presetGoto' : command;

  const params: Record<string, string> = {
    view: 'request',
    request: 'control',
    id: monitorId,
    control: controlCommand,
  };

  if (presetGotoMatch) {
    params.preset = presetGotoMatch[1];
  }

  // ZM classic UI attaches xge/yge only when the HTML button carries
  // data-xtell/data-ytell, i.e. only for axis commands. Preset, home, reset,
  // wake/sleep buttons have no xtell/ytell and are sent without xge/yge
  // (web/skins/classic/views/js/watch.js:402-439). The server uses presence
  // of xge/yge as a routing key in web/includes/control_functions.php:9. If
  // they're set it parses `control` as a movement-axis camelCase command and
  // logs "Invalid control parameter" for anything that doesn't match the
  // axis regex. Match ZM's emit pattern: only attach xge/yge for axis +
  // mode + direction commands.
  if (/^(move|zoom|focus|iris|white|gain)(Con|Rel|Abs)[A-Z]/.test(controlCommand)) {
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
    fid: frame,
  };

  if (width) params.width = width;
  if (height) params.height = height;

  const url = buildUrl(portalUrl, '/index.php', params, token, apiUrl);
  return applyMultiPort(url, monitorId || '', minStreamingPort);
}

/**
 * Get event video URL (MP4/H.264 format)
 *
 * Uses mode=mp4, which serves the stored event file as a complete, seekable MP4
 * (Content-Length + Accept-Ranges). mode=mpeg is the live CGI remux: a throttled
 * stream with no length/duration that Chromium's media stack rejects mid-stream
 * (MEDIA_ERR_DECODE), even though WebKit tolerates it.
 *
 * Format: /index.php?mode=mp4&format=h264&eid=<eventId>&view=view_video&token=<token>
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
 * // Returns: 'https://zm.com/index.php?mode=mp4&format=h264&eid=123&view=view_video&token=abc'
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
        mode: 'mp4',
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
    rate?: number;
    minStreamingPort?: number;
    monitorId?: string;
  } = {}
): string {
  const { token, apiUrl, offset, rate, minStreamingPort, monitorId } = options;

  const params: Record<string, string | number> = {
    command: command.toString(),
    connkey,
    view: 'request',
    request: 'stream',
  };

  if (offset !== undefined) params.offset = offset;
  if (rate !== undefined) params.rate = rate;

  const url = buildUrl(portalUrl, '/index.php', params, token, apiUrl);
  return applyMultiPort(url, monitorId || '', minStreamingPort);
}

/**
 * go2rtc stream suffix for a ZoneMinder StreamChannel, as ZoneMinder's own
 * player names it (web/js/MonitorStream.js getStreamSuffix, 1.38): zmc
 * registers `<Id>` and `<Id>_CameraDirectPrimary`, plus
 * `<Id>_ZoneMinderPrimary` only when the monitor's RTSPServer is on and
 * `<Id>_CameraDirectSecondary` only when it has a secondary path.
 */
export function go2rtcStreamSuffix(channel: string | number | null | undefined, rtspServer = false): string {
  const map: Record<string, string> = {
    default: '',
    Primary: '',
    Secondary: '_CameraDirectSecondary',
    CameraDirectSecondary: '_CameraDirectSecondary',
    Restream: '_ZoneMinderPrimary',
    ZoneMinderPrimary: '_ZoneMinderPrimary',
    CameraDirectPrimary: '_CameraDirectPrimary',
    '0': '',
    '1': '_CameraDirectSecondary',
    '2': '_ZoneMinderPrimary',
  };
  const key = channel === null || channel === undefined || channel === '' ? 'default' : String(channel);
  const suffix = map[key] ?? '';
  if (suffix === '_ZoneMinderPrimary' && !rtspServer) return '_CameraDirectPrimary';
  return suffix;
}

/**
 * Build Go2RTC WebSocket URL for WebRTC signaling.
 *
 * Uses ZM_GO2RTC_PATH from server config and constructs WebSocket URL matching
 * ZoneMinder's official implementation. Stream name: `{monitorId}{suffix}`,
 * suffix from go2rtcStreamSuffix.
 *
 * Protocol conversion:
 * - http:// → ws://
 * - https:// → wss://
 *
 * @param go2rtcPath - Full Go2RTC URL from ZM_GO2RTC_PATH config (e.g., "http://server:1984")
 * @param monitorId - Monitor ID (numeric)
 * @param channel - The monitor's StreamChannel (e.g. 'Restream', 'CameraDirectPrimary'; legacy 0/1/2)
 * @param options - Additional options (token: the API access token, for a
 *   proxy that authenticates the WebSocket; rtspServer: the monitor's RTSPServer)
 * @returns WebSocket URL for go2rtc signaling
 *
 * @example
 * getGo2RTCWebSocketUrl('http://zm.example.com:1984', '1', 'CameraDirectPrimary', { token: 'abc' })
 * // Returns: 'ws://zm.example.com:1984/ws?src=1_CameraDirectPrimary&token=abc'
 *
 * getGo2RTCWebSocketUrl('http://zm.example.com:1984/go2rtc', '5')
 * // Returns: 'ws://zm.example.com:1984/go2rtc/ws?src=5'
 */
/**
 * Warn when the session token is being sent to a go2rtc host other than the
 * configured portal. Embedded user:pass@ credentials in the URL are kept
 * intact: ZoneMinder authenticates the go2rtc WebSocket via those credentials
 * (the client does not attach a separate token here), so stripping them breaks
 * WebRTC streaming on setups that rely on them.
 */
function hardenGo2RTCUrl(url: URL, hasToken: boolean, expectedHost?: string): void {
  if (hasToken && expectedHost && url.hostname !== expectedHost) {
    log.http(
      'Attaching session token to a go2rtc host that differs from the configured portal',
      LogLevel.WARN,
      { go2rtcHost: url.hostname, expectedHost }
    );
  }
}

export function getGo2RTCWebSocketUrl(
  go2rtcPath: string,
  monitorId: string,
  channel: string | number | null = 0,
  options: {
    token?: string;
    expectedHost?: string;
    rtspServer?: boolean;
  } = {}
): string {
  const { token, expectedHost, rtspServer = false } = options;

  // Parse the configured Go2RTC path
  const url = new URL(go2rtcPath);
  hardenGo2RTCUrl(url, !!token, expectedHost);

  // Convert http/https to ws/wss (matches ZoneMinder implementation)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  // Append /ws to existing pathname (matches ZoneMinder: webrtcUrl.pathname += "/ws")
  url.pathname += url.pathname.endsWith('/') ? 'ws' : '/ws';

  // Build stream name the way ZoneMinder's player does
  const streamName = `${monitorId}${go2rtcStreamSuffix(channel, rtspServer)}`;
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
