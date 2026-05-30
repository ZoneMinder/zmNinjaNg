/**
 * Developer Notice Read State
 *
 * Tracks which notice ids the current device has read and which critical
 * banners have been dismissed. Persisted to localStorage (not profile-
 * scoped — the broadcast message is the same regardless of which ZM server
 * the user is connected to).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';

interface DeveloperNoticeState {
  readIds: string[];
  dismissedBannerIds: string[];

  isRead: (id: string) => boolean;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: (ids: string[]) => void;
  markAllUnread: (ids: string[]) => void;

  isBannerDismissed: (id: string) => boolean;
  dismissBanner: (id: string) => void;
}

export const useDeveloperNoticeStore = create<DeveloperNoticeState>()(
  persist(
    (set, get) => ({
      readIds: [],
      dismissedBannerIds: [],

      isRead: (id) => get().readIds.includes(id),
      markRead: (id) => {
        set((state) => {
          if (state.readIds.includes(id)) return state;
          return { ...state, readIds: [...state.readIds, id] };
        });
      },
      markAllRead: (ids) => {
        set((state) => {
          const merged = new Set(state.readIds);
          ids.forEach((id) => merged.add(id));
          return { ...state, readIds: Array.from(merged) };
        });
      },
      markUnread: (id) => {
        set((state) => {
          if (!state.readIds.includes(id)) return state;
          return { ...state, readIds: state.readIds.filter((rid) => rid !== id) };
        });
      },
      markAllUnread: (ids) => {
        set((state) => {
          const drop = new Set(ids);
          return { ...state, readIds: state.readIds.filter((rid) => !drop.has(rid)) };
        });
      },

      isBannerDismissed: (id) => get().dismissedBannerIds.includes(id),
      dismissBanner: (id) => {
        set((state) => {
          if (state.dismissedBannerIds.includes(id)) return state;
          return { ...state, dismissedBannerIds: [...state.dismissedBannerIds, id] };
        });
      },
    }),
    {
      name: STORAGE_KEYS.developerNoticeRead,
    },
  ),
);
