/**
 * Formatting that matches ZoneMinder's console navbar, so the Server page
 * shows the same numbers a user sees in the ZoneMinder web portal.
 */

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
