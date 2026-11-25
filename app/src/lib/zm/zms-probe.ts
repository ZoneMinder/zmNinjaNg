/**
 * Stream path probe (refs #603).
 *
 * An `<img>` playing MJPEG fires the same `error` for a 404, a 403 and a
 * dropped connection, so a wrong CGI path looks like an offline monitor. This
 * asks nph-zms for one frame with its own request and classifies the answer.
 * A 200 jpeg proves the path and the token work, not that a given monitor is
 * capturing: nph-zms answers a "Not connected" jpeg for a monitor id that
 * doesn't exist.
 */

import { httpGet } from '../http';
import { getMonitorStreamUrl } from './url-builder';
import { ZMS_PROBE } from '../zmninja-ng-constants';
import type { MonitorData } from '../../api/types';

export type ZmsProbeResult =
  | { state: 'ok' }
  /** `path` is the URL path only, so the token never reaches the UI. */
  | { state: 'failed'; status: number; path: string }
  /** No HTTP status (network error, timeout, CORS). Never shown as red. */
  | { state: 'unknown'; reason: string };

export async function probeZms(
  recordingUrl: string,
  monitorId: string,
  token: string | null | undefined,
): Promise<ZmsProbeResult> {
  // The unwrapped builder, not api/monitors getStreamUrl: httpGet adds the dev
  // proxy itself, and getStreamUrl's image proxy on top would proxy twice.
  const url = getMonitorStreamUrl(recordingUrl, monitorId, {
    mode: 'single',
    scale: ZMS_PROBE.scale,
    token: token ?? undefined,
  });
  try {
    const response = await httpGet<string>(url, {
      responseType: 'base64',
      timeoutMs: ZMS_PROBE.timeoutMs,
      validateStatus: () => true,
      intent: 'Probe stream path',
    });
    const contentType = Object.entries(response.headers)
      .find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
    if (response.status >= 200 && response.status < 300 && contentType.startsWith('image/')) {
      return { state: 'ok' };
    }
    if (!response.status) return { state: 'unknown', reason: 'no status' };
    return { state: 'failed', status: response.status, path: new URL(recordingUrl).pathname };
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Whether the portal page answers. Any status below 400 counts: ZM serves its
 * login page or a redirect to it. No status (network, CORS) is unknown.
 */
export async function probePortal(portalUrl: string): Promise<ZmsProbeResult> {
  try {
    const response = await httpGet<string>(portalUrl, {
      responseType: 'text',
      timeoutMs: ZMS_PROBE.timeoutMs,
      validateStatus: () => true,
      intent: 'Probe portal',
    });
    if (!response.status) return { state: 'unknown', reason: 'no status' };
    if (response.status < 400) return { state: 'ok' };
    return { state: 'failed', status: response.status, path: new URL(portalUrl).pathname };
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface ZmsProbeTarget {
  recordingUrl: string;
  monitorId: string;
}

/**
 * One target per distinct stream URL, through the first monitor on it that is
 * capturing (any monitor when none is). A monitor without `Capturing` predates
 * ZM 1.38 and counts as capturing.
 */
export function pickProbeTargets(
  monitors: MonitorData[],
  urlFor: (serverId: string | null | undefined) => string,
): ZmsProbeTarget[] {
  const byUrl = new Map<string, ZmsProbeTarget & { capturing: boolean }>();
  for (const { Monitor: m } of monitors) {
    const recordingUrl = urlFor(m.ServerId);
    if (!recordingUrl) continue;
    const capturing = m.Capturing !== 'None';
    const seen = byUrl.get(recordingUrl);
    if (!seen || (!seen.capturing && capturing)) {
      byUrl.set(recordingUrl, { recordingUrl, monitorId: m.Id, capturing });
    }
  }
  return [...byUrl.values()].map(({ recordingUrl, monitorId }) => ({ recordingUrl, monitorId }));
}

/** `host/path` of a stream URL, for the user to compare with their server. */
export function streamUrlLabel(recordingUrl: string): string {
  try {
    const u = new URL(recordingUrl);
    return `${u.host}${u.pathname}`;
  } catch {
    return recordingUrl;
  }
}
