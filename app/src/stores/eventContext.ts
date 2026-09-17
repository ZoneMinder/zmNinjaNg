/**
 * Which event the "around this event" panel is anchored to, if any (refs #494).
 *
 * One store rather than per-card state: the panel is mounted once in the app
 * shell, so a list of two hundred cards costs two hundred buttons and one
 * sheet. The anchor carries its own profileId because an All-mode row's server
 * is not the current profile.
 */

import { create } from 'zustand';
import type { EventData, ProfileId } from '../api/types';

interface EventContextState {
  anchor: EventData | null;
  profileId: ProfileId | undefined;
  open: boolean;
  openPanel: (anchor: EventData, profileId: ProfileId | undefined) => void;
  closePanel: () => void;
}

export const useEventContextStore = create<EventContextState>((set) => ({
  anchor: null,
  profileId: undefined,
  open: false,
  openPanel: (anchor, profileId) => set({ anchor, profileId, open: true }),
  closePanel: () => set({ anchor: null, profileId: undefined, open: false }),
}));
