/**
 * Groups API
 *
 * Handles fetching monitor groups from ZoneMinder.
 * Groups are hierarchical (parent/child) and monitors can belong to multiple groups.
 */

import { getApiClient } from './client';
import type { GroupsResponse } from './types';
import { GroupsResponseSchema } from './types';
import { validateApiResponse } from '../lib/api-validator';
import { log, LogLevel } from '../lib/logger';

/**
 * Get all monitor groups.
 *
 * Fetches the list of all groups from /groups.json.
 * Each group contains its metadata and an array of monitor references.
 *
 * @returns Promise resolving to GroupsResponse containing array of groups
 */
export async function getGroups(): Promise<GroupsResponse> {
  log.api('Fetching groups list', LogLevel.DEBUG);

  const client = getApiClient();
  const response = await client.get<GroupsResponse>('/groups.json');

  // Validate response with Zod
  return validateApiResponse(GroupsResponseSchema, response.data, {
    endpoint: '/groups.json',
    method: 'GET',
  });
}
