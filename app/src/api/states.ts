/**
 * States API
 *
 * Handles fetching and changing ZoneMinder system states.
 */

import { getApiClient } from './client';
import type { State } from './types';
import { StatesResponseSchema } from './types';
import { validateApiResponse } from '../lib/api-validator';
import { log, LogLevel } from '../lib/logger';

/**
 * Get all states
 *
 * @returns Promise resolving to array of State objects
 */
export async function getStates(): Promise<State[]> {
  const client = getApiClient();
  const response = await client.get('/states.json', { intent: 'Fetch system states' });

  // Validate response with Zod
  const validated = validateApiResponse(StatesResponseSchema, response.data, {
    endpoint: '/states.json',
    method: 'GET',
  });

  const stateDataArray = validated.states || [];

  // Transform StateData objects to State objects (unwrap and convert types)
  return stateDataArray.map((stateData) => ({
    Id: String(stateData.State.Id),
    Name: stateData.State.Name,
    Definition: stateData.State.Definition,
    IsActive: String(stateData.State.IsActive),
  }));
}

/**
 * Change state
 *
 * @param stateName - The name of the state to activate
 */
export async function changeState(stateName: string): Promise<void> {
  log.api('Changing system state', LogLevel.INFO, { stateName });

  const client = getApiClient();
  await client.post(`/states/change/${stateName}.json`);
}
