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
 * pushes the entry and EventContextPanel derives `open` from it.
 */

import { create } from 'zustand';
import type { EventData, ProfileId } from '../api/types';

/** Carried in `location.state` by the entry a panel open pushes, so back
 *  navigation (browser, Android, or the panel's own close controls) restores
 *  or discards the panel by restoring or discarding that entry. */
export interface EventContextHistoryState {
  eventContextAnchor?: { eventId: string; profileId: ProfileId | undefined };
}

interface EventContextState {
  anchor: EventData | null;
  profileId: ProfileId | undefined;
  openPanel: (anchor: EventData, profileId: ProfileId | undefined) => void;
  closePanel: () => void;
}

export const useEventContextStore = create<EventContextState>((set) => ({
  anchor: null,
  profileId: undefined,
  openPanel: (anchor, profileId) => set({ anchor, profileId }),
  closePanel: () => set({ anchor: null, profileId: undefined }),
}));
