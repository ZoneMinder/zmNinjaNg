/**
 * Monitor paging
 *
 * Splits a monitor list into pages so only one page's worth is ever rendered.
 * The tiles on other pages are not paused or hidden, they are never mounted,
 * so they hold no connection at all - the same mechanism that stops a
 * collapsed server section from streaming (refs #503).
 *
 * This is deliberately arithmetic on an array and nothing else. The approach
 * it replaced asked which tiles were on screen, which needs the page's layout
 * geometry to be readable at the moment the observer is built; on the montage
 * it is not, and four rounds of device logs never got it to hold a single tile
 * (refs #507). A slice has no such dependency and is provable in a unit test.
 */

/** Pages a list of this length divides into. Always at least 1: an empty list
 *  still has a first page, and the controls read "1 / 1" rather than "1 / 0". */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps a page number into the range the list supports. Pages are 1-based,
 *  because that is what the controls show and what a user would say out loud. */
export function clampPage(page: number, total: number, pageSize: number): number {
  if (!Number.isInteger(page)) return 1;
  return Math.min(Math.max(page, 1), pageCount(total, pageSize));
}

/**
 * The items on one page.
 *
 * Returns `items` itself when paging is off or everything fits, so callers that
 * memoize on identity see no change - the montage's query inputs and grid
 * layout all key off this list, and a fresh array every render would rebuild
 * them for nothing (the same reason `allocateStreamBudget` returns its input).
 */
export function pageSlice<T>(items: T[], pageSize: number, page: number): T[] {
  if (pageSize <= 0 || items.length <= pageSize) return items;
  const start = (clampPage(page, items.length, pageSize) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
