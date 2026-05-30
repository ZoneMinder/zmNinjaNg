/**
 * Developer Notice Feed API
 *
 * One-way broadcast channel from the maintainer to all users. Fetches a
 * static JSON feed (DEVELOPER_NOTICES.feedUrl) with no auth headers. The
 * feed lives in the repo at docs/notices.json and is served via GitHub's
 * raw URL — there is no backend and no telemetry.
 */

import { z } from 'zod';
import { httpGet } from '../lib/http';
import { DEVELOPER_NOTICES } from '../lib/zmninja-ng-constants';
import { validateApiResponse } from '../lib/api-validator';

export const DeveloperNoticeSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type DeveloperNoticeSeverity = z.infer<typeof DeveloperNoticeSeveritySchema>;

export const DeveloperNoticeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  publishedAt: z.string(),
  severity: DeveloperNoticeSeveritySchema.default('info'),
  link: z.string().url().optional(),
  /** When set, hide the notice on app versions older than this. */
  minAppVersion: z.string().optional(),
});

export type DeveloperNotice = z.infer<typeof DeveloperNoticeSchema>;

export const DeveloperNoticeFeedSchema = z.array(DeveloperNoticeSchema);

/**
 * Fetch the notice feed. Uses httpGet directly (not the api client) so the
 * request bypasses auth, cookies, and the ZM baseURL — this URL is a public
 * raw GitHub file. Validation strips malformed entries upstream of the UI.
 */
export async function fetchDeveloperNotices(): Promise<DeveloperNotice[]> {
  const response = await httpGet<unknown>(DEVELOPER_NOTICES.feedUrl, {
    headers: { 'Skip-Auth': 'true' },
    timeoutMs: 10_000,
    intent: 'Fetch developer notices',
  });
  return validateApiResponse(DeveloperNoticeFeedSchema, response.data, {
    endpoint: DEVELOPER_NOTICES.feedUrl,
    method: 'GET',
  });
}
