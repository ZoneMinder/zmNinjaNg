/**
 * URL Builder Tests
 *
 * Comprehensive tests for ZoneMinder URL generation functions.
 * Tests cover event images, videos, monitor streams, and various edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePortalUrl,
  buildQueryString,
  buildUrl,
  getMonitorStreamUrl,
  getMonitorControlUrl,
  getEventImageUrl,
  getEventVideoUrl,
  getEventZmsUrl,
  getZmsControlUrl,
  getGo2RTCWebSocketUrl,
  getGo2RTCStreamUrl,
} from '../url-builder';

describe('normalizePortalUrl', () => {
  it('adds http:// prefix when protocol is missing', () => {
    expect(normalizePortalUrl('zm.example.com')).toBe('http://zm.example.com');
  });

  it('preserves https:// protocol', () => {
    expect(normalizePortalUrl('https://zm.example.com')).toBe('https://zm.example.com');
  });

  it('preserves http:// protocol', () => {
    expect(normalizePortalUrl('http://zm.example.com')).toBe('http://zm.example.com');
  });

  it('handles URL with path', () => {
    expect(normalizePortalUrl('zm.example.com/zm')).toBe('http://zm.example.com/zm');
  });
});

describe('buildQueryString', () => {
  it('builds query string from params', () => {
    const result = buildQueryString({ view: 'console', limit: 10 });
    expect(result).toBe('view=console&limit=10');
  });

  it('adds token parameter when provided', () => {
    const result = buildQueryString({ view: 'console' }, 'mytoken');
    expect(result).toBe('view=console&token=mytoken');
  });

  it('filters out undefined values', () => {
    const result = buildQueryString({ view: 'console', limit: undefined });
    expect(result).toBe('view=console');
  });

  it('handles empty params with token', () => {
    const result = buildQueryString({}, 'mytoken');
    expect(result).toBe('token=mytoken');
  });

  it('handles boolean values', () => {
    const result = buildQueryString({ enabled: true, disabled: false });
    expect(result).toBe('enabled=true&disabled=false');
  });
});

describe('buildUrl', () => {
  it('builds complete URL with query string', () => {
    const result = buildUrl('https://zm.com', '/index.php', { view: 'console' });
    expect(result).toBe('https://zm.com/index.php?view=console');
  });

  it('builds URL with token', () => {
    const result = buildUrl('https://zm.com', '/index.php', { view: 'console' }, 'token123');
    expect(result).toBe('https://zm.com/index.php?view=console&token=token123');
  });

  it('handles path without leading slash', () => {
    const result = buildUrl('https://zm.com', 'api/monitors', { limit: 5 });
    expect(result).toBe('https://zm.com/api/monitors?limit=5');
  });

  it('handles URL without params', () => {
    const result = buildUrl('https://zm.com', '/index.php', {});
    expect(result).toBe('https://zm.com/index.php');
  });

  it('normalizes portal URL', () => {
    const result = buildUrl('zm.com', '/index.php', { view: 'console' });
    expect(result).toBe('http://zm.com/index.php?view=console');
  });
});

describe('getMonitorStreamUrl', () => {
  const cgiUrl = 'https://zm.com/cgi-bin/nph-zms';
  const monitorId = '1';

  it('generates basic stream URL', () => {
    const result = getMonitorStreamUrl(cgiUrl, monitorId);
    expect(result).toContain('/cgi-bin/nph-zms');
    expect(result).toContain('monitor=1');
    expect(result).toContain('mode=jpeg');
  });

  it('includes all stream options', () => {
    const result = getMonitorStreamUrl(cgiUrl, monitorId, {
      mode: 'stream',
      scale: 50,
      width: 640,
      height: 480,
      maxfps: 10,
      buffer: 1000,
      token: 'abc123',
      connkey: 12345,
    });

    expect(result).toContain('mode=stream');
    expect(result).toContain('scale=50');
    expect(result).toContain('width=640px');
    expect(result).toContain('height=480px');
    expect(result).toContain('maxfps=10');
    expect(result).toContain('buffer=1000');
    expect(result).toContain('token=abc123');
    expect(result).toContain('connkey=12345');
  });

  it('adds cache buster when provided', () => {
    const result = getMonitorStreamUrl(cgiUrl, monitorId, {
      cacheBuster: 1234567890,
    });
    expect(result).toContain('_t=1234567890');
  });
});

describe('getMonitorControlUrl', () => {
  const portalUrl = 'https://zm.com';
  const monitorId = '1';

  it('generates PTZ control URL', () => {
    const result = getMonitorControlUrl(portalUrl, monitorId, 'moveRelUp');
    expect(result).toContain('/index.php');
    expect(result).toContain('view=request');
    expect(result).toContain('request=control');
    expect(result).toContain('id=1');
    expect(result).toContain('control=moveRelUp');
  });

  it('includes token when provided', () => {
    const result = getMonitorControlUrl(portalUrl, monitorId, 'moveRelUp', {
      token: 'mytoken',
    });
    expect(result).toContain('token=mytoken');
  });

  it('attaches xge/yge for pan/tilt commands so the server takes the movement-axis branch', () => {
    const result = getMonitorControlUrl(portalUrl, monitorId, 'moveConUp');
    expect(result).toContain('xge=0');
    expect(result).toContain('yge=0');
  });

  it('attaches xge/yge for zoom and focus commands', () => {
    expect(getMonitorControlUrl(portalUrl, monitorId, 'zoomConTele')).toContain('xge=0');
    expect(getMonitorControlUrl(portalUrl, monitorId, 'focusConFar')).toContain('yge=0');
  });

  it('omits xge/yge for presetGoto<N> so the server rewrites it to presetGoto + --preset=N', () => {
    const result = getMonitorControlUrl(portalUrl, monitorId, 'presetGoto3');
    expect(result).not.toContain('xge=');
    expect(result).not.toContain('yge=');
    expect(result).toContain('control=presetGoto3');
  });

  it('omits xge/yge for moveStop, presetHome, and reset', () => {
    for (const command of ['moveStop', 'presetHome', 'reset']) {
      const result = getMonitorControlUrl(portalUrl, monitorId, command);
      expect(result).not.toContain('xge=');
      expect(result).not.toContain('yge=');
    }
  });
});

describe('getEventImageUrl', () => {
  const portalUrl = 'https://zm.com';
  const eventId = '123';

  it('generates image URL with frame number', () => {
    const result = getEventImageUrl(portalUrl, eventId, 10);
    expect(result).toContain('/index.php');
    expect(result).toContain('view=image');
    expect(result).toContain('eid=123');
    expect(result).toContain('fid=10');
  });

  it('handles snapshot frame', () => {
    const result = getEventImageUrl(portalUrl, eventId, 'snapshot');
    expect(result).toContain('fid=snapshot');
  });

  it('handles objdetect frame', () => {
    const result = getEventImageUrl(portalUrl, eventId, 'objdetect');
    expect(result).toContain('fid=objdetect');
  });

  it('includes dimensions when provided', () => {
    const result = getEventImageUrl(portalUrl, eventId, 'snapshot', {
      width: 640,
      height: 480,
    });
    expect(result).toContain('width=640');
    expect(result).toContain('height=480');
  });

  it('includes token when provided', () => {
    const result = getEventImageUrl(portalUrl, eventId, 1, {
      token: 'mytoken',
    });
    expect(result).toContain('token=mytoken');
  });
});

describe('getEventVideoUrl', () => {
  const portalUrl = 'https://zm.com';
  const eventId = '9';

  it('generates MP4 video URL with default h264 format', () => {
    const result = getEventVideoUrl(portalUrl, eventId);
    expect(result).toBe('https://zm.com/index.php?mode=mpeg&format=h264&eid=9&view=view_video');
  });

  it('includes token parameter', () => {
    const result = getEventVideoUrl(portalUrl, eventId, {
      token: 'mytoken123',
    });
    expect(result).toBe('https://zm.com/index.php?mode=mpeg&format=h264&eid=9&view=view_video&token=mytoken123');
  });

  it('supports h265 format', () => {
    const result = getEventVideoUrl(portalUrl, eventId, {
      format: 'h265',
      token: 'mytoken',
    });
    expect(result).toContain('format=h265');
  });

  it('uses mode=mpeg for MP4 playback', () => {
    const result = getEventVideoUrl(portalUrl, eventId);
    expect(result).toContain('mode=mpeg');
  });

  it('uses view=view_video', () => {
    const result = getEventVideoUrl(portalUrl, eventId);
    expect(result).toContain('view=view_video');
  });

  it('normalizes portal URL without protocol', () => {
    const result = getEventVideoUrl('zm.com', eventId);
    expect(result).toContain('http://zm.com');
  });
});

describe('getEventZmsUrl', () => {
  const portalUrl = 'https://zm.com';
  const eventId = '123';

  it('generates ZMS event playback URL with defaults', () => {
    const result = getEventZmsUrl(portalUrl, eventId);
    expect(result).toContain('/cgi-bin/nph-zms');
    expect(result).toContain('mode=jpeg');
    expect(result).toContain('source=event');
    expect(result).toContain('event=123');
    expect(result).toContain('frame=1');
    expect(result).toContain('rate=100');
    expect(result).toContain('maxfps=30');
    expect(result).toContain('replay=single');
    expect(result).toContain('scale=100');
  });

  it('accepts custom playback options', () => {
    const result = getEventZmsUrl(portalUrl, eventId, {
      frame: 50,
      rate: 200,
      maxfps: 60,
      replay: 'gapless',
      scale: 50,
    });

    expect(result).toContain('frame=50');
    expect(result).toContain('rate=200');
    expect(result).toContain('maxfps=60');
    expect(result).toContain('replay=gapless');
    expect(result).toContain('scale=50');
  });

  it('includes connkey when provided', () => {
    const result = getEventZmsUrl(portalUrl, eventId, {
      connkey: 'conn123',
    });
    expect(result).toContain('connkey=conn123');
  });

  it('includes token when provided', () => {
    const result = getEventZmsUrl(portalUrl, eventId, {
      token: 'mytoken',
    });
    expect(result).toContain('token=mytoken');
  });
});

describe('getZmsControlUrl', () => {
  const portalUrl = 'https://zm.com';
  const command = 1; // ZMS_COMMANDS.cmdPlay
  const connkey = 'conn123';

  it('generates ZMS control URL', () => {
    const result = getZmsControlUrl(portalUrl, command, connkey);
    expect(result).toContain('/index.php');
    expect(result).toContain('command=1');
    expect(result).toContain('connkey=conn123');
    expect(result).toContain('view=request');
    expect(result).toContain('request=stream');
  });

  it('includes offset when provided', () => {
    const result = getZmsControlUrl(portalUrl, command, connkey, {
      offset: 500,
    });
    expect(result).toContain('offset=500');
  });

  it('includes token when provided', () => {
    const result = getZmsControlUrl(portalUrl, command, connkey, {
      token: 'mytoken',
    });
    expect(result).toContain('token=mytoken');
  });
});

describe('Edge Cases', () => {
  it('handles special characters in event ID', () => {
    const result = getEventVideoUrl('https://zm.com', '123-456');
    expect(result).toContain('eid=123-456');
  });

  it('handles special characters in monitor ID', () => {
    const result = getMonitorStreamUrl('https://zm.com/cgi-bin', 'mon-1');
    expect(result).toContain('monitor=mon-1');
  });

  it('encodes token with special characters', () => {
    const result = getEventVideoUrl('https://zm.com', '9', {
      token: 'abc+def=ghi',
    });
    // URLSearchParams automatically encodes special characters
    expect(result).toContain('token=abc');
  });
});

describe('getGo2RTCWebSocketUrl', () => {
  it('builds WebSocket URL with monitor ID and channel', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com:1984', '1', 0);
    expect(result).toBe('ws://zm.example.com:1984/ws?src=1_0');
  });

  it('converts https to wss', () => {
    const result = getGo2RTCWebSocketUrl('https://zm.example.com:1984', '2', 0);
    expect(result).toBe('wss://zm.example.com:1984/ws?src=2_0');
  });

  it('builds stream name as {monitorId}_{channel}', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com:1984', '5', 1);
    expect(result).toContain('src=5_1');
  });

  it('defaults channel to 0 when not provided', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com:1984', '3');
    expect(result).toContain('src=3_0');
  });

  it('preserves explicit port', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com:8080', '1', 0);
    expect(result).toBe('ws://zm.example.com:8080/ws?src=1_0');
  });

  it('includes auth token when provided', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com:1984', '1', 0, {
      token: 'mytoken123',
    });
    expect(result).toBe('ws://zm.example.com:1984/ws?src=1_0&token=mytoken123');
  });

  it('handles URL with existing path (appends /ws)', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com/go2rtc', '1', 0);
    expect(result).toBe('ws://zm.example.com/go2rtc/ws?src=1_0');
  });

  it('handles URL with trailing slash in path', () => {
    const result = getGo2RTCWebSocketUrl('http://zm.example.com:1984/', '2', 0);
    expect(result).toBe('ws://zm.example.com:1984/ws?src=2_0');
  });

  it('preserves username and password in URL (ZoneMinder behavior)', () => {
    const result = getGo2RTCWebSocketUrl('https://admin:pass@zm.example.com:1985/api', '4', 0);
    // ZoneMinder keeps credentials in WebSocket URL - the server/proxy handles auth
    expect(result).toBe('wss://admin:pass@zm.example.com:1985/api/ws?src=4_0');
    expect(result).toContain('admin');
    expect(result).toContain('pass');
  });
});

describe('getGo2RTCStreamUrl', () => {
  it('builds MSE stream URL when path includes /api', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984/api', '1', 0, 'mse');
    expect(result).toBe('http://zm.example.com:1984/api/stream.mse?src=1_0');
  });

  it('builds HLS stream URL when path includes /api', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984/api', '2', 0, 'hls');
    expect(result).toBe('http://zm.example.com:1984/api/stream.hls?src=2_0');
  });

  it('builds MP4 stream URL when no path provided', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984', '3', 0, 'mp4');
    expect(result).toBe('http://zm.example.com:1984/stream.mp4?src=3_0');
  });

  it('builds MJPEG stream URL when no path provided', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984', '4', 0, 'mjpeg');
    expect(result).toBe('http://zm.example.com:1984/stream.mjpeg?src=4_0');
  });

  it('builds stream name as {monitorId}_{channel}', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984/api', '5', 1, 'hls');
    expect(result).toContain('src=5_1');
  });

  it('defaults channel to 0 when not provided', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984/api', '6', undefined, 'mse');
    expect(result).toContain('src=6_0');
  });

  it('preserves https protocol', () => {
    const result = getGo2RTCStreamUrl('https://zm.example.com:1984/api', '1', 0, 'hls');
    expect(result).toBe('https://zm.example.com:1984/api/stream.hls?src=1_0');
  });

  it('includes auth token when provided', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984/api', '1', 0, 'mse', {
      token: 'mytoken123',
    });
    expect(result).toBe('http://zm.example.com:1984/api/stream.mse?src=1_0&token=mytoken123');
  });

  it('handles URL with custom path (appends /stream.type)', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com/go2rtc/api', '1', 0, 'hls');
    expect(result).toBe('http://zm.example.com/go2rtc/api/stream.hls?src=1_0');
  });

  it('preserves explicit port', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:8080/api', '1', 0, 'hls');
    expect(result).toBe('http://zm.example.com:8080/api/stream.hls?src=1_0');
  });

  it('handles trailing slash in path', () => {
    const result = getGo2RTCStreamUrl('http://zm.example.com:1984/api/', '2', 0, 'mse');
    expect(result).toBe('http://zm.example.com:1984/api/stream.mse?src=2_0');
  });
});
