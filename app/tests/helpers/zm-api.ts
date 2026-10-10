/**
 * Direct ZoneMinder API access for e2e tests.
 *
 * Used when a test needs to know a server-side fact (e.g. a monitor's
 * `Controllable` capability) independently of the app UI, so that a UI
 * regression cannot make the test believe the fact is something it isn't.
 * See ptz.steps.ts "the current monitor supports PTZ" (refs #217, #218).
 *
 * This talks to the ZM API directly with node's built-in fetch, using the
 * same login flow as src/api/auth.ts (POST /host/login.json form-encoded,
 * token passed as a query param on subsequent requests). It intentionally
 * does not reuse the app's ApiClient: that client is wired to the browser's
 * auth store, which this Node-side test code does not have access to.
 */
import { testConfig } from './config';

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const { host, username, password } = testConfig.server;
  const body = new URLSearchParams();
  body.set('user', username);
  body.set('pass', password);

  const res = await fetch(`${host}/api/host/login.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`ZM API login failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token?: string; access_token_expires?: number };
  if (!data.access_token) {
    throw new Error('ZM API login response did not include access_token');
  }

  cachedToken = {
    token: data.access_token,
    // Refresh a little early so a long-running suite never races expiry.
    expiresAt: Date.now() + (data.access_token_expires ?? 3600) * 1000 - 30_000,
  };
  return cachedToken.token;
}

/**
 * Query the ZoneMinder API for a monitor's `Controllable` field.
 *
 * This is the ground truth for "does this monitor support PTZ" - independent
 * of whether the app's PTZ panel happens to render, so a rendering regression
 * fails the calling test's assertions instead of being silently skipped.
 */
export async function isMonitorControllable(monitorId: string): Promise<boolean> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/monitors/${monitorId}.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API monitor fetch failed for id ${monitorId}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { monitor?: { Monitor?: { Controllable?: string | number } } };
  const controllable = data.monitor?.Monitor?.Controllable;
  return controllable === '1' || controllable === 1;
}

export interface MonitorPtzPowerCapabilities {
  canWake: boolean;
  canSleep: boolean;
  canReset: boolean;
  canReboot: boolean;
}

/**
 * Read the camera's PTZ power capabilities directly from its control profile.
 * The UI assertion must use server data rather than its own rendered buttons.
 */
export async function getMonitorPtzPowerCapabilities(
  monitorId: string
): Promise<MonitorPtzPowerCapabilities> {
  const token = await getAccessToken();
  const { host } = testConfig.server;
  const monitorRes = await fetch(`${host}/api/monitors/${monitorId}.json?token=${encodeURIComponent(token)}`);
  if (!monitorRes.ok) {
    throw new Error(`ZM API monitor fetch failed for id ${monitorId}: ${monitorRes.status} ${monitorRes.statusText}`);
  }

  const monitorData = (await monitorRes.json()) as {
    monitor?: { Monitor?: { ControlId?: string | number | null } };
  };
  const controlId = monitorData.monitor?.Monitor?.ControlId;
  if (controlId === undefined || controlId === null || String(controlId) === '') {
    return { canWake: false, canSleep: false, canReset: false, canReboot: false };
  }

  const controlRes = await fetch(
    `${host}/api/controls/${encodeURIComponent(String(controlId))}.json?token=${encodeURIComponent(token)}`
  );
  if (!controlRes.ok) {
    throw new Error(`ZM API control fetch failed for id ${controlId}: ${controlRes.status} ${controlRes.statusText}`);
  }

  const controlData = (await controlRes.json()) as {
    control?: {
      Control?: {
        CanWake?: string | number;
        CanSleep?: string | number;
        CanReset?: string | number;
        CanReboot?: string | number;
      };
    };
  };
  const control = controlData.control?.Control;
  return {
    canWake: control?.CanWake === '1' || control?.CanWake === 1,
    canSleep: control?.CanSleep === '1' || control?.CanSleep === 1,
    canReset: control?.CanReset === '1' || control?.CanReset === 1,
    canReboot: control?.CanReboot === '1' || control?.CanReboot === 1,
  };
}

/**
 * How many monitors the server has.
 *
 * Multi-column layout assertions need to know whether a second card can exist
 * at all. Counting the rendered cards instead would make a layout regression
 * look like "the server only has one monitor" and pass (refs #233).
 */
export async function getMonitorCount(): Promise<number> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/monitors.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API monitor list fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { monitors?: unknown[] };
  return data.monitors?.length ?? 0;
}

/**
 * How many monitor groups the server has.
 *
 * The group filter only renders when groups exist, so "is the filter visible"
 * has no fixed answer. Asking the server first turns that into a real
 * assertion: with groups the filter must be there, without them it must not.
 */
export async function getGroupCount(): Promise<number> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/groups.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API group list fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { groups?: unknown[] };
  return data.groups?.length ?? 0;
}

/**
 * How many events a monitor has recorded strictly after `since`.
 *
 * Used to seed a reliable "this monitor has new events" precondition in e2e
 * tests (see monitors.steps.ts "I seed old watermarks for monitors with
 * events"): only monitors the API confirms have events after the watermark
 * are expected to render a badge, so the scenario's later assertions can be
 * hard instead of skipping when the badge fails to render (refs #239).
 */
export async function getMonitorEventCountSince(monitorId: string, since: string): Promise<number> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const segments = [`MonitorId:${monitorId}`, `StartDateTime >:${since}`];
  const path = segments.map((s) => `/${encodeURIComponent(s)}`).join('');
  const res = await fetch(`${host}/api/events/index${path}.json?limit=1&token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API event count fetch failed for monitor ${monitorId}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { pagination?: { count?: number } };
  return data.pagination?.count ?? 0;
}

/**
 * How many events the server has recorded.
 *
 * The events steps gate on "does this server have any events" before asserting
 * anything about event cards. Deriving that from the rendered cards makes a
 * broken list look like an empty server and passes every downstream step
 * (refs #237). Asks the API instead. Reads only the pagination count, so it
 * does not depend on the default page size.
 */
export async function getEventCount(): Promise<number> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/events.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API event list fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { pagination?: { count?: number }; events?: unknown[] };
  return data.pagination?.count ?? data.events?.length ?? 0;
}

/**
 * Whether a monitor is currently in an armed (forced) alarm state.
 *
 * Ground truth for the assistant e2e destructive-action scenario (rule 34):
 * the UI's confirm/cancel flow triggers or cancels the alarm, but this reads
 * the server directly so a rendering regression in the confirm card can't
 * make the test believe the alarm state changed when it didn't. Mirrors the
 * numeric/string parsing in src/pages/hooks/useAlarmControl.ts.
 */
export async function getAlarmStatus(monitorId: string): Promise<boolean> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(
    `${host}/api/monitors/alarm/id:${monitorId}/command:status.json?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    throw new Error(`ZM API alarm status fetch failed for monitor ${monitorId}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { status?: string | number; output?: string | number };
  const raw = data.status ?? data.output;
  const value = raw?.toString().toLowerCase();
  const parsed = raw !== undefined && raw !== null ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed !== 0 : value === 'on' || value === '1' || value === 'armed' || value === 'true';
}

/**
 * Cancel a monitor's forced alarm state directly against the API.
 *
 * Cleanup for the assistant e2e destructive-action scenario: after the
 * scripted `trigger_alarm` confirm path proves the app can arm a monitor,
 * this leaves the monitor as it found it instead of relying on a second UI
 * round-trip through the assistant to disarm it.
 */
export async function cancelAlarmDirect(monitorId: string): Promise<void> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(
    `${host}/api/monitors/alarm/id:${monitorId}/command:off.json?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    throw new Error(`ZM API alarm cancel failed for monitor ${monitorId}: ${res.status} ${res.statusText}`);
  }
}

/**
 * The server's ZoneMinder version, for scenarios whose control only exists on
 * one side of a version gate. Derived from the API rather than from whether
 * the control is on screen, which would assert nothing.
 */
export async function getZmVersion(): Promise<string> {
  const token = await getAccessToken();
  const { host } = testConfig.server;

  const res = await fetch(`${host}/api/host/getVersion.json?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`ZM API version fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { version?: string };
  return data.version ?? '';
}

