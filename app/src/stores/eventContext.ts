/**
 * Which event the "around this event" panel is anchored to, if any (refs #494).
 *
 * One store rather than per-card state: the panel is mounted once in the app
 * shell, so a list of two hundred cards costs two hundred buttons and one
 * sheet. The anchor carries its own profileId because an All-mode row's server
 * is not the current profile.
 *
 * Whether the panel is open is NOT tracked here (refs #494): the open panel is
 * a router history entry, so back/forward can restore it. This store only
 * holds the anchor payload that entry's state points at; EventContextButton
 * pushes the entry and EventContextPanel derives `open` from it. It also holds
 * the Events page's current query, for the Filtered scope (refs #534).
 */

import { create } from 'zustand';
import type { EventData, EventFilters, ProfileId } from '../api/types';

/** Carried in `location.state` by the entry a panel open pushes, so back
 *  navigation (browser, Android, or the panel's own close controls) restores
 *  or discards the panel by restoring or discarding that entry. */
export interface EventContextHistoryState {
  eventContextAnchor?: { eventId: string; profileId: ProfileId | undefined };
  /** Sequence play is open over the panel (refs #534). A tile that opens its
   *  event first records itself here, so back reopens Sequence play on it. */
  eventContextSequence?: { returnedFrom?: string };
  /** On an event opened from the panel or Sequence play: the panel's events in
   *  time order, so continuous play walks them instead of the Events filter
   *  (refs #547). */
  eventContextQueue?: string[];
}

/**
 * The query the Events page is running, as it hands it to useScopedEvents, so
 * the panel's Filtered scope applies the same filters around one event
 * (refs #534). The Events page publishes it while mounted and clears it on
 * unmount, so a panel opened anywhere else sees null and greys Filtered out.
 */
export interface EventsPageQuery {
  /** The page's EventFilters; the panel drops its dates, limit and sort. */
  filters: EventFilters;
  /** Resolved monitor filter: the selection, the group, or undefined.
   *  Composite `profileId:id` tokens in All mode. */
  monitorId?: string;
  favoritesOnly: boolean;
  /** Each server's own tag ids, when a tag filter is on. */
  tagIdsByProfile?: Partial<Record<ProfileId, string[]>>;
  /** Any filter besides the date range is set. */
  active: boolean;
}

interface EventContextState {
  anchor: EventData | null;
  profileId: ProfileId | undefined;
  pageQuery: EventsPageQuery | null;
  openPanel: (anchor: EventData, profileId: ProfileId | undefined) => void;
  closePanel: () => void;
  setPageQuery: (query: EventsPageQuery | null) => void;
}

export const useEventContextStore = create<EventContextState>((set) => ({
  anchor: null,
  profileId: undefined,
  openPanel: (anchor, profileId) => set({ anchor, profileId }),
  closePanel: () => set({ anchor: null, profileId: undefined }),
  pageQuery: null,
  setPageQuery: (pageQuery) => set({ pageQuery }),
}));
