/**
 * Zones API
 *
 * Handles fetching zone data for monitors.
 * Zones define detection areas on a monitor.
 */

import { getApiClient } from './client';
import type { ZonesResponse, Zone } from './types';
import { ZonesResponseSchema } from './types';
import { validateApiResponse } from '../lib/api-validator';

/**
 * Get all zones for a specific monitor.
 *
 * @param monitorId - The ID of the monitor to fetch zones for
 * @returns Promise resolving to array of Zone objects
 */
export async function getZones(monitorId: string): Promise<Zone[]> {
  const client = getApiClient();
  const response = await client.get<ZonesResponse>(`/zones.json?MonitorId=${monitorId}`, {
    intent: `Fetch zones for monitor ${monitorId}`,
  });

  const validated = validateApiResponse(ZonesResponseSchema, response.data, {
    endpoint: `/zones.json?MonitorId=${monitorId}`,
    method: 'GET',
  });

  // Extract Zone objects from the wrapper
  return validated.zones.map((z) => z.Zone);
}

