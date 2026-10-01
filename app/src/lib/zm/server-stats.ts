/**
 * Formatting that matches ZoneMinder's console navbar, so the Server page
 * shows the same numbers a user sees in the ZoneMinder web portal.
 */

import { ZM_SERVER_LOW_FREE_FRACTION } from './zm-constants';

const ZM_SIZE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;

/** ZoneMinder's `human_filesize` (`web/includes/functions.php`): 1024 steps,
 *  two decimals, and a step up once the value passes 0.9 of the next unit. */
export function zmHumanFilesize(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size / 1024 > 0.9 && unit < ZM_SIZE_UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(2)} ${ZM_SIZE_UNITS[unit]}`;
}

/** Which colour the console gives a usage percentage. */
export function zmUsageLevel(
  percent: number,
  warnAbove: number,
  dangerAbove: number,
): 'danger' | 'warning' | undefined {
  if (percent > dangerAbove) return 'danger';
  if (percent > warnAbove) return 'warning';
  return undefined;
}

/** The id of the server ZoneMinder's navbar would describe (`$thisServer`).
 *  The console reads it from zm.conf, which the API does not expose, so the
 *  stand-in is the server whose Hostname the profile's API URL points at.
 *  With no match it is 0, where zmstats writes on a single-server install. */
export function zmThisServerId(servers: { Id: string; Hostname?: string }[], apiUrl: string): string {
  let host: string;
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return '0';
  }
  const match = servers.find((s) => s.Hostname?.split(':')[0].toLowerCase() === host);
  return match?.Id ?? '0';
}

/** The Servers table marks memory or swap red under a tenth free, or with no total. */
export function zmLowFree(free: number, total: number): boolean {
  return !total || free / total < ZM_SERVER_LOW_FREE_FRACTION;
}
