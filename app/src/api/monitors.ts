/**
 * Monitors API
 *
 * Handles fetching monitor lists, details, and controlling monitor state (enable/disable, alarms).
 * Also provides utility for generating stream URLs.
 */

import type { ApiClient } from './client';
import type { MonitorsResponse, MonitorData, ControlData, AlarmStatusResponse, DaemonStatusResponse, ProfileId } from './types';
import { MonitorsResponseSchema, MonitorDataSchema, ControlDataSchema, AlarmStatusResponseSchema, DaemonStatusResponseSchema } from './types';
import { validateApiResponse } from '../lib/zm/api-validator';
import {
  getMonitorStreamUrl as buildMonitorStreamUrl,
  getMonitorControlUrl as buildMonitorControlUrl,
} from '../lib/zm/url-builder';
import { log, LogLevel } from '../lib/logger';
import { wrapWithImageProxy } from '../lib/zm/proxy-utils';
import { filterExcludedMonitors, sortMonitors } from '../lib/monitor/filters';
import { getExcludedMonitorIds } from '../lib/profile/profile-settings';

/**
 * Get all monitors.
 *
 * Fetches the list of all monitors from /monitors.json.
 *
 * @param profileId - The profile whose exclusion list filters the result.
 * @param options.includeExcluded - When true, skip the per-profile exclusion
 *   filter so callers (e.g. the exclusion Settings UI) can still list excluded
 *   monitors. Deleted monitors are always dropped.
 * @returns Promise resolving to MonitorsResponse containing array of monitors
 */
export async function getMonitors(
  client: ApiClient,
  profileId: ProfileId,
  options?: { includeExcluded?: boolean }
): Promise<MonitorsResponse> {
  const response = await client.get<MonitorsResponse>('/monitors.json', {
    intent: 'Fetch monitors list',
  });

  // Validate response with Zod
  const validated = validateApiResponse(MonitorsResponseSchema, response.data, {
    endpoint: '/monitors.json',
    method: 'GET',
  });

  // Exclude deleted monitors at the API boundary so they never enter the app
  validated.monitors = validated.monitors.filter(
    ({ Monitor }) => Monitor.Deleted !== true
  );

  // Drop per-profile excluded monitors unless the caller opts out
  if (!options?.includeExcluded) {
    validated.monitors = filterExcludedMonitors(validated.monitors, getExcludedMonitorIds(profileId));
  }

  // Order once, here, so the grid, the montage and live-view stepping all read
  // the same list in the same order (refs #527).
  validated.monitors = sortMonitors(validated.monitors);

  return validated;
}

/**
 * Get a single monitor by ID.
 * 
 * @param monitorId - The ID of the monitor to fetch
 * @returns Promise resolving to MonitorData
 */
export async function getMonitor(client: ApiClient, monitorId: string): Promise<MonitorData> {
  const response = await client.get<{ monitor: MonitorData }>(`/monitors/${monitorId}.json`, {
    intent: `Fetch monitor ${monitorId}`,
  });
  // Validate and coerce types (e.g. Controllable number -> string)
  return validateApiResponse(MonitorDataSchema, response.data.monitor, {
    endpoint: `/monitors/${monitorId}.json`,
    method: 'GET',
  });
}

/**
 * Get control capabilities for a monitor.
 * 
 * @param controlId - The ID of the control profile
 * @returns Promise resolving to ControlData
 */
export async function getControl(client: ApiClient, controlId: string): Promise<ControlData> {
  const response = await client.get(`/controls/${controlId}.json`, {
    intent: `Fetch control ${controlId} capabilities`,
  });
  return validateApiResponse(ControlDataSchema, response.data, {
    endpoint: `/controls/${controlId}.json`,
    method: 'GET',
  });
}

/**
 * Update monitor settings.
 *
 * Sends a PUT request to update specific monitor fields.
 *
 * @param monitorId - The ID of the monitor to update
 * @param updates - Object containing fields to update
 * @returns Promise resolving to updated MonitorData
 */
export async function updateMonitor(
  client: ApiClient,
  monitorId: string,
  updates: Record<string, unknown>
): Promise<void> {
  log.api('Updating monitor settings', LogLevel.INFO, { monitorId, updates });

  const body = new URLSearchParams();
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.set(key, String(value));
  });
  await client.postForm(`/monitors/${monitorId}.json`, body);
  // ZM returns {"message":"Saved"}. Callers refetch monitor data separately
}

/**
 * Change monitor function (None/Monitor/Modect/Record/Mocord/Nodect).
 * 
 * Helper wrapper around updateMonitor for changing the function.
 * 
 * @param monitorId - The ID of the monitor
 * @param func - The new function mode
 * @returns Promise resolving to updated MonitorData
 */
export async function changeMonitorFunction(
  client: ApiClient,
  monitorId: string,
  func: 'None' | 'Monitor' | 'Modect' | 'Record' | 'Mocord' | 'Nodect'
): Promise<void> {
  log.api('Changing monitor function', LogLevel.INFO, { monitorId, function: func });

  await updateMonitor(client, monitorId, {
    'Monitor[Function]': func,
  });
}

/**
 * Update monitor capture settings (ZM 1.38+).
 *
 * Sets Capturing, Analysing, and/or Recording fields independently.
 * Only sends fields that are provided.
 *
 * @param monitorId - The ID of the monitor
 * @param settings - Object with optional Capturing, Analysing, Recording values
 * @returns Promise resolving to updated MonitorData
 */
export async function updateMonitorCapture(
  client: ApiClient,
  monitorId: string,
  settings: {
    Capturing?: 'None' | 'Ondemand' | 'Always';
    Analysing?: 'None' | 'Always';
    Recording?: 'None' | 'OnMotion' | 'Always';
  }
): Promise<void> {
  log.api('Updating monitor capture settings', LogLevel.INFO, { monitorId, settings });

  const params: Record<string, string> = {};
  if (settings.Capturing !== undefined) params['Monitor[Capturing]'] = settings.Capturing;
  if (settings.Analysing !== undefined) params['Monitor[Analysing]'] = settings.Analysing;
  if (settings.Recording !== undefined) params['Monitor[Recording]'] = settings.Recording;
  await updateMonitor(client, monitorId, params);
}

/**
 * Enable or disable a monitor.
 *
 * Helper wrapper around updateMonitor for toggling enabled state.
 *
 * @param monitorId - The ID of the monitor
 * @param enabled - True to enable, false to disable
 * @returns Promise resolving to updated MonitorData
 */
export async function setMonitorEnabled(client: ApiClient, monitorId: string, enabled: boolean): Promise<void> {
  log.api('Setting monitor enabled state', LogLevel.INFO, { monitorId, enabled });

  await updateMonitor(client, monitorId, {
    'Monitor[Enabled]': enabled ? '1' : '0',
  });
}

/**
 * Trigger alarm on a monitor.
 *
 * Forces an alarm state on the monitor.
 *
 * @param monitorId - The ID of the monitor
 * @throws Error if alarm trigger fails (ZM returns status: 'false' with error)
 */
export async function triggerAlarm(client: ApiClient, monitorId: string, apiBaseUrl?: string): Promise<void> {
  log.api('Triggering monitor alarm', LogLevel.INFO, { monitorId, apiBaseUrl });

  const config = apiBaseUrl ? { baseURL: apiBaseUrl } : undefined;
  const response = await client.get(`/monitors/alarm/id:${monitorId}/command:on.json`, config);

  // Validate response with Zod to catch failures
  const validated = validateApiResponse(AlarmStatusResponseSchema, response.data, {
    endpoint: `/monitors/alarm/id:${monitorId}/command:on.json`,
    method: 'GET',
  });

  // Check for error response
  if (validated.status === 'false' && validated.error) {
    throw new Error(`Failed to trigger alarm: ${validated.error} (code: ${validated.code})`);
  }
}

/**
 * Cancel alarm on a monitor.
 *
 * Forces an alarm state off on the monitor.
 *
 * @param monitorId - The ID of the monitor
 * @throws Error if alarm cancel fails (ZM returns status: 'false' with error)
 */
export async function cancelAlarm(client: ApiClient, monitorId: string, apiBaseUrl?: string): Promise<void> {
  log.api('Cancelling monitor alarm', LogLevel.INFO, { monitorId, apiBaseUrl });

  const config = apiBaseUrl ? { baseURL: apiBaseUrl } : undefined;
  const response = await client.get(`/monitors/alarm/id:${monitorId}/command:off.json`, config);

  // Validate response with Zod to catch failures
  const validated = validateApiResponse(AlarmStatusResponseSchema, response.data, {
    endpoint: `/monitors/alarm/id:${monitorId}/command:off.json`,
    method: 'GET',
  });

  // Check for error response
  if (validated.status === 'false' && validated.error) {
    throw new Error(`Failed to cancel alarm: ${validated.error} (code: ${validated.code})`);
  }
}

/**
 * Get alarm status of a monitor.
 *
 * Checks if the monitor is currently in alarm state.
 *
 * @param monitorId - The ID of the monitor
 * @returns Promise resolving to object with status string
 */
export async function getAlarmStatus(client: ApiClient, monitorId: string, apiBaseUrl?: string): Promise<AlarmStatusResponse> {
  const config = { intent: `Fetch alarm status for monitor ${monitorId}`, ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}) };
  const response = await client.get(`/monitors/alarm/id:${monitorId}/command:status.json`, config);

  // Validate response with Zod
  const validated = validateApiResponse(AlarmStatusResponseSchema, response.data, {
    endpoint: `/monitors/alarm/id:${monitorId}/command:status.json`,
    method: 'GET',
  });

  return validated;
}

/**
 * Get daemon status for a monitor.
 *
 * Checks status of zmc (capture) or zma (analysis) daemons.
 *
 * @param monitorId - The ID of the monitor
 * @param daemon - 'zmc' or 'zma'
 * @returns Promise resolving to object with status string
 */
export async function getDaemonStatus(
  client: ApiClient,
  monitorId: string,
  daemon: 'zmc' | 'zma',
  apiBaseUrl?: string
): Promise<DaemonStatusResponse> {
  const config = { intent: `Fetch ${daemon} daemon status for monitor ${monitorId}`, ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}) };
  const response = await client.get(`/monitors/daemonStatus/id:${monitorId}/daemon:${daemon}.json`, config);

  // Validate response with Zod
  const validated = validateApiResponse(DaemonStatusResponseSchema, response.data, {
    endpoint: `/monitors/daemonStatus/id:${monitorId}/daemon:${daemon}.json`,
    method: 'GET',
  });

  return validated;
}

/**
 * Construct streaming URL for a monitor.
 *
 * Generates the URL for the ZMS CGI script to stream video or images.
 * In development mode on web, routes through proxy to avoid CORS issues.
 *
 * @param cgiUrl - Base CGI URL (e.g. https://zm.example.com/cgi-bin)
 * @param monitorId - The ID of the monitor
 * @param options - Streaming options (mode, scale, dimensions, etc.)
 * @returns Full URL string for the stream
 */
export function getStreamUrl(
  cgiUrl: string,
  monitorId: string,
  options: {
    mode?: 'jpeg' | 'single' | 'stream';
    frames?: number;
    scale?: number;
    width?: number;
    height?: number;
    maxfps?: number;
    buffer?: number;
    token?: string;
    connkey?: number;
    cacheBuster?: number;
    minStreamingPort?: number;
  } = {}

): string {
  const fullUrl = buildMonitorStreamUrl(cgiUrl, monitorId, options);

  // In dev mode on web, use proxy server to avoid CORS issues
  // Native platforms and production can access directly
  return wrapWithImageProxy(fullUrl);
}

/**
 * Send PTZ control command to a monitor.
 * 
 * @param portalUrl - Base Portal URL (e.g. https://zm.example.com/zm)
 * @param monitorId - The ID of the monitor
 * @param command - The PTZ command to execute
 * @param token - Optional auth token
 */
export async function controlMonitor(
  client: ApiClient,
  portalUrl: string,
  monitorId: string,
  command: string,
  token?: string,
  minStreamingPort?: number,
): Promise<void> {
  log.api('Sending PTZ control command', LogLevel.INFO, { monitorId, command });

  const url = buildMonitorControlUrl(portalUrl, monitorId, command, { token, minStreamingPort });

  // In dev mode on web, use proxy server to avoid CORS issues
  const proxiedUrl = wrapWithImageProxy(url);

  // Use the unified client for cross-platform HTTP while keeping the full URL override.
  // We skip auth interceptor because we manually added the token to the URL
  await client.get(proxiedUrl, {
    headers: {
      'Skip-Auth': 'true'
    }
  });
}
