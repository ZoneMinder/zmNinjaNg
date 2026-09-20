/**
 * Page state for a monitor list.
 *
 * Which page you are on is per-device view state, not a preference: it is not
 * worth a round trip to every other device, and opening the montage on page 4
 * because that is where you left it last week would read as a bug. So it lives
 * in component state and starts at the first page every time the screen mounts.
 * The page SIZE is the setting (`monitorsPerPage`), and that is profile-scoped
 * like every other preference.
 *
 * The page is clamped as it is read rather than corrected in an effect: a
 * monitor going away or a group filter narrowing must not strand the user on a
 * page past the end, and doing it in an effect would cost a second render and
 * a `set-state-in-effect` violation for an answer that is already derivable.
 */

import { useCallback, useMemo, useState } from 'react';
import { clampPage, pageCount, pageSlice } from '../lib/monitor/paging';

export interface MonitorPaging<T> {
  /** The items on the current page - the whole list when paging is off, and the
   *  same array identity in that case, so callers memoizing on it see no
   *  change. */
  items: T[];
  /** 1-based, always inside the range `total` and `pageSize` allow. */
  page: number;
  /** Pages available; 1 when paging is off. */
  pages: number;
  /** Whether there is more than one page, and so anything worth rendering a
   *  control for. */
  isPaged: boolean;
  goToPage: (page: number) => void;
}

export function useMonitorPaging<T>({
  items,
  pageSize,
  resetKey,
}: {
  /** The whole list, before paging. */
  items: T[];
  /** `monitorsPerPage`; 0 is off. */
  pageSize: number;
  /** Anything that means "a different list now": the profile in scope, the
   *  group filter. Changing it returns to the first page, because page 4 of
   *  the previous list says nothing about this one. */
  resetKey: string;
}): MonitorPaging<T> {
  // The state carries the list it belongs to, so a new list reads as page 1
  // without writing anything: no effect (which would render the wrong page once
  // before correcting it, and on a montage that render mounts tiles) and no ref
  // read during render (which the React lint rightly rejects).
  const [state, setState] = useState({ resetKey, page: 1 });
  const page = state.resetKey === resetKey ? state.page : 1;

  const total = items.length;
  const pages = pageCount(total, pageSize);
  const goToPage = useCallback((next: number) => setState({ resetKey, page: next }), [resetKey]);

  const safePage = clampPage(page, total, pageSize);

  return {
    items: useMemo(() => pageSlice(items, pageSize, safePage), [items, pageSize, safePage]),
    page: safePage,
    pages,
    isPaged: pages > 1,
    goToPage,
  };
}
