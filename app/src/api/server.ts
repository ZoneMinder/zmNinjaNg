/**
 * Server API
 *
 * Handles server information, load, disk usage, and run state management
 * for ZoneMinder servers.
 */

import type { ApiClient } from './client';
import { validateApiResponse } from '../lib/zm/api-validator';
import { tolerantArray, withFieldCatch } from '../lib/zm/schema-tolerance';
import { z } from 'zod';
import { log, LogLevel } from '../lib/logger';
import type { HttpError } from '../lib/http';

// ========== Schemas ==========

// withFieldCatch + tolerantArray: a drifted field falls back and one bad row
// drops itself, so a ZoneMinder change never blanks the whole response (rule 43).
const ServerSchema = z.object(
  withFieldCatch({
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
  }, ['Id', 'Name']),
);

const ServersResponseSchema = z.object({
  servers: tolerantArray(z.object({ Server: ServerSchema }), 'server'),
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

// One Server_Stats row, written by zmstats about once a minute.
const ServerStatSchema = z.object(
  withFieldCatch({
    TimeStamp: z.string(),
    ServerId: z.coerce.string().optional(),
    CpuLoad: z.coerce.number().optional(),
    CpuUsagePercent: z.coerce.number().optional(),
    TotalSwap: z.coerce.number().optional(),
    FreeSwap: z.coerce.number().optional(),
  }, ['TimeStamp']),
);

const ServerStatsResponseSchema = z.object({
  serverstats: tolerantArray(z.object({ ServerStat: ServerStatSchema }), 'server stat'),
});

const DaemonCheckSchema = z.object({
  result: z.coerce.number(),
});

const StorageSchema = z.object(
  withFieldCatch({
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
  }, ['Id', 'Name']),
);

const StoragesResponseSchema = z.object({
  storage: tolerantArray(z.object({ Storage: StorageSchema }), 'storage'),
});


// ========== Types ==========

export type Server = z.infer<typeof ServerSchema>;
export type ServersResponse = z.infer<typeof ServersResponseSchema>;
export type Storage = z.infer<typeof StorageSchema>;
export type ServerStat = z.infer<typeof ServerStatSchema>;

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
export async function getServers(client: ApiClient): Promise<Server[]> {
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
export async function getStorages(client: ApiClient): Promise<Storage[]> {
  const response = await client.get('/storage.json');

  const validated = validateApiResponse(StoragesResponseSchema, response.data, {
    endpoint: '/storage.json',
    method: 'GET',
  });

  return validated.storage.map((s) => s.Storage);
}

/**
 * Count the events stored in a storage area, the figure ZoneMinder's
 * Options > Storage table shows before "using". One row is enough: ZoneMinder
 * reports the full match size in `pagination.count`.
 */
export async function getStorageEventCount(client: ApiClient, storageId: string): Promise<number> {
  const response = await client.get<{ pagination?: { count?: number } }>(
    `/events/index/${encodeURIComponent(`StorageId:${storageId}`)}.json`,
    { params: { limit: 1 }, intent: `Count events in storage ${storageId}` },
  );
  return response.data.pagination?.count ?? 0;
}

/**
 * Check if ZoneMinder daemon is running
 *
 * Calls /host/daemonCheck.json to verify if the core service is active.
 *
 * @returns Promise resolving to boolean (true = running, false = stopped)
 */
export async function getDaemonCheck(client: ApiClient, apiBaseUrl?: string): Promise<boolean> {
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
export async function getLoad(client: ApiClient, apiBaseUrl?: string): Promise<ServerLoad> {
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
 * Get the newest Server_Stats row, which is where ZoneMinder's console reads
 * its Load and Cpu figures.
 *
 * The endpoint returns every stored row oldest first and has no limit, so the
 * caller passes a server-local 'YYYY-MM-DD HH:mm:ss' lower bound and this takes
 * the last row. Needs ZoneMinder 1.37.61 or newer for the filter.
 *
 * The console reads the row of the server it runs on; the caller names that
 * server (see `zmThisServerId`), and rows of other servers are ignored.
 *
 * @returns The newest row of `serverId`, or undefined when it has none newer
 *   than `since`
 */
export async function getLatestServerStat(
  client: ApiClient,
  since: string,
  serverId: string,
): Promise<ServerStat | undefined> {
  const endpoint = `/server_stats/index/${encodeURIComponent(`TimeStamp >=:${since}`)}.json`;
  const response = await client.get(endpoint);

  const validated = validateApiResponse(ServerStatsResponseSchema, response.data, {
    endpoint,
    method: 'GET',
  });

  // Server::ReadStats: the newest row of one server. Rows without a ServerId
  // predate multi-server stats and belong to the single-server id 0.
  return validated.serverstats
    .map((r) => r.ServerStat)
    .filter((r) => (r.ServerId ?? '0') === serverId)
    .at(-1);
}

/**
 * Get disk usage percentage
 *
 * Fetches the current disk usage for the ZoneMinder events storage.
 *
 * @returns Promise resolving to DiskUsage object with usage percentage
 */
export async function getDiskPercent(client: ApiClient, apiBaseUrl?: string): Promise<DiskUsage> {
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
export async function getConfigs(client: ApiClient): Promise<import('./types').Config[]> {
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
export async function fetchMinStreamingPort(client: ApiClient): Promise<number | null> {
  try {
    const response = await client.get<import('./types').MinStreamingPortResponse>(
      '/configs/viewByName/ZM_MIN_STREAMING_PORT.json',
      { intent: 'Fetch MIN_STREAMING_PORT config' },
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
