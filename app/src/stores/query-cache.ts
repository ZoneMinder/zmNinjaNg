/**
 * Query Cache Manager
 *
 * Provides a global reference to the React Query client.
 * Allows clearing the cache from outside React components (e.g., in Zustand stores).
 *
 * This is critical for profile switching, where we need to ensure data from
 * one profile doesn't leak into another.
 */

import { QueryClient } from '@tanstack/react-query';
import { log, LogLevel } from '../lib/logger';
import { MAX_QUERY_RETRIES } from '../lib/zmninja-ng-constants';
import type { ProfileId } from '../api/types';

// Global query client instance
let queryClient: QueryClient | null = null;

/**
 * Default retry predicate for React Query.
 *
 * Never retries 401/403 responses: the API client already performs token
 * recovery inside the request, so a surfaced auth error is final and
 * retrying only adds latency and server load. Everything else (5xx,
 * network errors) is retried once, matching the previous `retry: 1`.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (status === 401 || status === 403) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * Set the global query client instance.
 * Should be called when the App initializes the QueryClientProvider.
 */
export function setQueryClient(client: QueryClient) {
  queryClient = client;
}

/**
 * Clear all query cache.
 * 
 * Used when switching profiles to remove all cached data (monitors, events, etc.)
 * ensuring the new profile starts with a clean slate.
 */
export function clearQueryCache() {
  if (queryClient) {
    const queriesCount = queryClient.getQueryCache().getAll().length;
    queryClient.clear();
    log.queryCache('Query cache cleared', LogLevel.INFO, { queriesCount });
  } else {
    log.queryCache('No query client to clear', LogLevel.WARN);
  }
}

/**
 * Remove one profile's cached queries.
 *
 * Used when a profile is deleted: every profile-scoped key carries the
 * ProfileId (queryKeys.ts), so `includes` catches it regardless of position
 * or query shape.
 */
export function removeProfileQueries(profileId: ProfileId): void {
  if (!queryClient) return;
  queryClient.removeQueries({ predicate: (q) => q.queryKey.includes(profileId) });
}

/**
 * Drop one profile's cached data and refetch what is on screen. Used when a
 * profile's addresses change, so nothing fetched from the old server stands
 * in for the new one (refs #613).
 */
export function resetProfileQueries(profileId: ProfileId): void {
  if (!queryClient) return;
  void queryClient.resetQueries({ predicate: (q) => q.queryKey.includes(profileId) });
}
