/**
 * Server API
 *
 * Handles server information, load, disk usage, and run state management
 * for ZoneMinder servers.
 */

import { getApiClient } from './client';
import { validateApiResponse } from '../lib/api-validator';
import { z } from 'zod';
import { log, LogLevel } from '../lib/logger';
import type { HttpError } from '../lib/http';

// ========== Schemas ==========

const ServerSchema = z.object({
  Id: z.coerce.string(),
  Name: z.string(),
  Hostname: z.string().optional(),
  State_Id: z.coerce.number().optional(),
  Status: z.string().optional(),
  CpuLoad: z.coerce.number().optional(),
  TotalMem: z.coerce.number().optional(),
  FreeMem: z.coerce.number().optional(),
  Protocol: z.string().optional(),
  Port: z.coerce.number().optional(),
  PathToIndex: z.string().optional(),
  PathToZMS: z.string().optional(),
  PathToApi: z.string().optional(),
  CpuUserPercent: z.coerce.number().optional(),
  CpuSystemPercent: z.coerce.number().optional(),
  CpuIdlePercent: z.coerce.number().optional(),
  CpuUsagePercent: z.coerce.number().optional(),
  TotalSwap: z.coerce.number().optional(),
  FreeSwap: z.coerce.number().optional(),
  zmstats: z.boolean().optional(),
  zmaudit: z.boolean().optional(),
  zmtrigger: z.boolean().optional(),
  zmeventnotification: z.boolean().optional(),
});

const ServersResponseSchema = z.object({
  servers: z.array(z.object({ Server: ServerSchema })),
});

const LoadSchema = z.object({
  load: z.union([
    z.array(z.coerce.number()),
    z.coerce.number(),
    z.string().transform((val) => parseFloat(val)),
  ]),
});

const DiskPercentSchema = z.object({
  usage: z
    .union([
      // Complex object with monitor disk usage
      z.record(
        z.string(),
        z.object({
          space: z
            .union([z.string(), z.number()])
            .transform((val) => (typeof val === 'string' ? parseFloat(val) : val)),
          color: z.string().optional(),
        })
      ),
      // Simple number fallback
      z.coerce.number(),
    ])
    .optional(),
  percent: z.coerce.number().optional(),
});

const DaemonCheckSchema = z.object({
  result: z.coerce.number(),
});

const StorageSchema = z.object({
  Id: z.coerce.string(),
  Path: z.string().nullable(),
  Name: z.string(),
  Type: z.string(),
  Url: z.string().nullable(),
  DiskSpace: z.coerce.number().nullable(),
  Scheme: z.string().nullable(),
  ServerId: z.coerce.string().nullable(),
  DoDelete: z.coerce.boolean().optional(),
  Enabled: z.coerce.boolean().optional(),
  DiskTotalSpace: z.coerce.number().nullable(),
  DiskUsedSpace: z.coerce.number().nullable(),
});

const StoragesResponseSchema = z.object({
  storage: z.array(z.object({ Storage: StorageSchema })),
});


// ========== Types ==========

export type Server = z.infer<typeof ServerSchema>;
export type ServersResponse = z.infer<typeof ServersResponseSchema>;
export type Storage = z.infer<typeof StorageSchema>;

export interface ServerLoad {
  load: number | number[];
}

export interface DiskUsage {
  usage?: number;
  percent?: number;
}


// ========== API Functions ==========

/**
 * Get all servers
 *
 * Fetches information about all ZoneMinder servers in the system.
 * Includes CPU load, memory usage, and status information.
 *
 * @returns Promise resolving to array of Server objects
 */
export async function getServers(): Promise<Server[]> {
  const client = getApiClient();
  const response = await client.get('/servers.json');

  const validated = validateApiResponse(ServersResponseSchema, response.data, {
    endpoint: '/servers.json',
    method: 'GET',
  });

  return validated.servers.map((s) => s.Server);
}

/**
 * Get all storages
 *
 * Fetches storage configuration from ZoneMinder, including paths,
 * disk space, and server associations.
 *
 * @returns Promise resolving to array of Storage objects
 */
export async function getStorages(): Promise<Storage[]> {
  const client = getApiClient();
  const response = await client.get('/storage.json');

  const validated = validateApiResponse(StoragesResponseSchema, response.data, {
    endpoint: '/storage.json',
    method: 'GET',
  });

  return validated.storage.map((s) => s.Storage);
}

/**
 * Check if ZoneMinder daemon is running
 *
 * Calls /host/daemonCheck.json to verify if the core service is active.
 *
 * @returns Promise resolving to boolean (true = running, false = stopped)
 */
export async function getDaemonCheck(apiBaseUrl?: string): Promise<boolean> {
  const client = getApiClient();
  const config = apiBaseUrl ? { baseURL: apiBaseUrl } : undefined;
  const response = await client.get('/host/daemonCheck.json', config);

  const validated = validateApiResponse(DaemonCheckSchema, response.data, {
    endpoint: '/host/daemonCheck.json',
    method: 'GET',
  });

  return validated.result === 1;
}

/**
 * Get server load average
 *
 * Fetches the current system load average (1, 5, 15 min).

/**
 * Get server load average
 *
 * Fetches the current load average for the ZoneMinder server.
 *
 * @returns Promise resolving to ServerLoad object with load value
 */
export async function getLoad(apiBaseUrl?: string): Promise<ServerLoad> {
  const client = getApiClient();
  const config = apiBaseUrl ? { baseURL: apiBaseUrl } : undefined;
  const response = await client.get('/host/getLoad.json', config);

  const validated = validateApiResponse(LoadSchema, response.data, {
    endpoint: '/host/getLoad.json',
    method: 'GET',
  });

  // If load is an array, use the 1-minute average (first element)
  const loadValue = Array.isArray(validated.load) ? validated.load[0] : validated.load;

  return { load: loadValue };
}

/**
 * Get disk usage percentage
 *
 * Fetches the current disk usage for the ZoneMinder events storage.
 *
 * @returns Promise resolving to DiskUsage object with usage percentage
 */
export async function getDiskPercent(apiBaseUrl?: string): Promise<DiskUsage> {
  const client = getApiClient();
  const config = apiBaseUrl ? { baseURL: apiBaseUrl } : undefined;
  const response = await client.get('/host/getDiskPercent.json', config);

  const validated = validateApiResponse(DiskPercentSchema, response.data, {
    endpoint: '/host/getDiskPercent.json',
    method: 'GET',
  });

  let usageValue: number | undefined;
  let percentValue: number | undefined;

  // Handle complex usage object (monitor-specific disk usage)
  if (validated.usage && typeof validated.usage === 'object' && !Array.isArray(validated.usage)) {
    // Extract total disk space from "Total" key
    const totalEntry = (validated.usage as Record<string, { space: number; color?: string }>)['Total'];
    if (totalEntry) {
      usageValue = totalEntry.space;
      // For now, we don't have total capacity to calculate percentage
      // Return the space usage in GB
      percentValue = undefined;
    }
  } else if (typeof validated.usage === 'number') {
    usageValue = validated.usage;
  }

  return {
    usage: usageValue,
    percent: validated.percent ?? percentValue ?? usageValue,
  };
}

/**
 * Get system configurations
 *
 * Fetches configuration values from the server.
 * Can optionally filter by restart requirement or category.
 *
 * @returns Promise resolving to array of Config objects
 */
export async function getConfigs(): Promise<import('./types').Config[]> {
  const client = getApiClient();
  const response = await client.get('/configs.json');
  const { ConfigsResponseSchema } = await import('./types');

  const validated = validateApiResponse(ConfigsResponseSchema, response.data, {
    endpoint: '/configs.json',
    method: 'GET',
  });

  return validated.configs.map((c) => c.Config);
}

/**
 * Fetch the ZM_MIN_STREAMING_PORT configuration value
 *
 * Returns the minimum streaming port if multi-port streaming is enabled.
 * An empty string indicates multi-port streaming is not configured.
 * Only works after successful authentication.
 *
 * @returns Promise resolving to the port number or null if not configured/fetch fails
 */
export async function fetchMinStreamingPort(): Promise<number | null> {
  try {
    const client = getApiClient();
    log.api('Fetching MIN_STREAMING_PORT from server config', LogLevel.DEBUG);

    const response = await client.get<import('./types').MinStreamingPortResponse>(
      '/configs/viewByName/ZM_MIN_STREAMING_PORT.json'
    );

    const { MinStreamingPortResponseSchema } = await import('./types');
    const validated = MinStreamingPortResponseSchema.parse(response.data);
    const portValue = validated.config.Value;

    if (!portValue || portValue === '') {
      log.api('MIN_STREAMING_PORT not configured (empty value)', LogLevel.DEBUG);
      return null;
    }

    const port = parseInt(portValue, 10);
    if (isNaN(port) || port <= 0) {
      log.api('MIN_STREAMING_PORT has invalid value', LogLevel.WARN, { portValue });
      return null;
    }

    log.api('MIN_STREAMING_PORT fetched successfully', LogLevel.DEBUG, { port });
    return port;
  } catch (error: unknown) {
    const err = error as HttpError & { constructor: { name: string } };
    log.api('Failed to fetch MIN_STREAMING_PORT from server', LogLevel.WARN, {
      error: err.constructor.name,
      message: err.message,
      status: err.status,
    });
    return null;
  }
}
