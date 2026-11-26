/**
 * probeZms classifies what nph-zms answered (refs #603). The rows follow the
 * spec's measured table on ZM 1.39.45; only the HTTP boundary is faked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const httpGet = vi.fn();
vi.mock('../../http', () => ({ httpGet: (...args: unknown[]) => httpGet(...args) }));

import { probeZms, probePortal, pickProbeTargets } from '../zms-probe';
import { log, LogLevel } from '../../logger';
import type { MonitorData } from '../../../api/types';

const CGI = 'https://zm.example.com/zm/cgi-bin/nph-zms';

function reply(status: number, contentType?: string) {
  return { status, statusText: '', data: '', headers: contentType ? { 'Content-Type': contentType } : {} };
}

describe('probeZms', () => {
  beforeEach(() => httpGet.mockReset());

  it('is ok on a 200 jpeg, and asks for one frame with the token', async () => {
    httpGet.mockResolvedValueOnce(reply(200, 'image/jpeg'));
    expect(await probeZms(CGI, '3', 'tok')).toEqual({ state: 'ok' });
    const url = new URL(httpGet.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/zm/cgi-bin/nph-zms');
    expect(url.searchParams.get('mode')).toBe('single');
    expect(url.searchParams.get('monitor')).toBe('3');
    expect(url.searchParams.get('token')).toBe('tok');
  });

  it('fails a 403 with the path and no token in it', async () => {
    httpGet.mockResolvedValueOnce(reply(403));
    expect(await probeZms(CGI, '3', 'tok')).toEqual({ state: 'failed', status: 403, path: '/zm/cgi-bin/nph-zms' });
  });

  it('fails a 404 Apache page', async () => {
    httpGet.mockResolvedValueOnce(reply(404, 'text/html'));
    expect(await probeZms(CGI, '3', null)).toEqual({ state: 'failed', status: 404, path: '/zm/cgi-bin/nph-zms' });
  });

  it('fails a 200 that is not an image (CGI served as a download)', async () => {
    httpGet.mockResolvedValueOnce(reply(200, 'application/octet-stream'));
    expect(await probeZms(CGI, '3', 'tok')).toEqual({ state: 'failed', status: 200, path: '/zm/cgi-bin/nph-zms' });
  });

  it('reads the content type case-insensitively (native adapters keep server casing)', async () => {
    httpGet.mockResolvedValueOnce({ ...reply(200), headers: { 'content-type': 'image/jpeg' } });
    expect(await probeZms(CGI, '3', 'tok')).toEqual({ state: 'ok' });
  });

  it('is unknown on a network error, never failed', async () => {
    httpGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await probeZms(CGI, '3', 'tok')).toEqual({ state: 'unknown', reason: 'Failed to fetch' });
  });
});

function monitor(Id: string, ServerId: string | null, Capturing?: string): MonitorData {
  return { Monitor: { Id, ServerId, Capturing } } as unknown as MonitorData;
}

describe('pickProbeTargets', () => {
  const urlFor = (serverId: string | null | undefined) => (serverId === '2' ? 'https://b/nph-zms' : 'https://a/nph-zms');

  it('probes each distinct URL once, through a capturing monitor when there is one', () => {
    const targets = pickProbeTargets(
      [monitor('1', '1', 'None'), monitor('2', '1', 'Always'), monitor('3', '2', 'None'), monitor('4', '2', 'None')],
      urlFor,
    );
    expect(targets).toEqual([
      { recordingUrl: 'https://a/nph-zms', monitorId: '2' },
      { recordingUrl: 'https://b/nph-zms', monitorId: '3' },
    ]);
  });

  it('treats a monitor without Capturing (pre-1.38) as capturing', () => {
    expect(pickProbeTargets([monitor('1', null, 'None'), monitor('5', null)], urlFor)).toEqual([
      { recordingUrl: 'https://a/nph-zms', monitorId: '5' },
    ]);
  });

  it('probes nothing without monitors', () => {
    expect(pickProbeTargets([], urlFor)).toEqual([]);
  });
});

/**
 * A failed check is a WARN line, so filtering the console to warnings shows a
 * broken streaming or portal URL (refs #613). The probes accept any status, so
 * the HTTP layer only logs the answer at DEBUG.
 */
describe('failed checks are logged', () => {
  beforeEach(() => httpGet.mockReset());

  it('warns with the stream path and status, and no token', async () => {
    const warn = vi.spyOn(log, 'http').mockImplementation(() => {});
    httpGet.mockResolvedValueOnce(reply(404, 'text/html'));

    await probeZms(CGI, '3', 'secret-token');

    const warned = warn.mock.calls.filter(([, level]) => level === LogLevel.WARN);
    expect(warned).toHaveLength(1);
    expect(JSON.stringify(warned[0])).toContain('/zm/cgi-bin/nph-zms');
    expect(JSON.stringify(warned[0])).toContain('404');
    expect(JSON.stringify(warned[0])).not.toContain('secret-token');
    warn.mockRestore();
  });

  it('warns when the portal answers with an error status', async () => {
    const warn = vi.spyOn(log, 'http').mockImplementation(() => {});
    httpGet.mockResolvedValueOnce(reply(503, 'text/html'));

    await probePortal('https://zm.example.com/zm');

    const warned = warn.mock.calls.filter(([, level]) => level === LogLevel.WARN);
    expect(JSON.stringify(warned)).toContain('503');
    warn.mockRestore();
  });
});
