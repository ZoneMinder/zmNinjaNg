/**
 * Hook for event navigation in detail view
 *
 * Fetches adjacent events on demand using server-side filters
 * passed through router state. Provides prev/next callbacks
 * and slide animation state.
 */

import { useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getAdjacentEvent, type EventFilters } from '../api/events';
import { getSession, getCurrentSession } from '../services/sessions';
import { log, LogLevel } from '../lib/logger';
import type { ProfileId } from '../api/types';
import type { EventContextHistoryState } from '../stores/eventContext';
import { useReturnHighlightStore } from '../stores/returnHighlight';

interface UseEventNavigationOptions {
  currentEventId: string | undefined;
  currentStartDateTime: string | undefined;
  /**
   * Owning profile for an /all/ deep route; defaults to the current profile.
   * Also selects the path template prev/next navigate to: when set,
   * `/all/events/:profileId/:id` (stays in owning-profile context) instead
   * of `/events/:id`.
   */
  profileId?: ProfileId;
}

interface UseEventNavigationReturn {
  /** Resolves true if it navigated to a previous event, false if none exists. */
  goToPrevEvent: () => Promise<boolean>;
  /** Resolves true if it navigated to a next event, false if none exists.
   * Continuous playback (#250) uses the result to decide whether to stop. */
  goToNextEvent: (options?: { continuousPlayback?: boolean }) => Promise<boolean>;
  isLoadingPrev: boolean;
  isLoadingNext: boolean;
  slideDirection: 'left' | 'right' | null;
  hasFilters: boolean;
}

export function useEventNavigation({
  currentEventId,
  currentStartDateTime,
  profileId,
}: UseEventNavigationOptions): UseEventNavigationReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoadingPrev, setIsLoadingPrev] = useState(false);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  // Extract filters from navigation state (passed from Events page)
  const eventFilters = (location.state?.eventFilters as EventFilters) || undefined;
  const hasFilters = !!eventFilters;

  // Preserve the original referrer (e.g., '/timeline' or '/events') across prev/next navigation
  const originalFrom = (location.state?.from as string) || '/events';

  // Events opened from the Nearby panel (refs #547): carried across prev/next
  // so continuous play keeps walking them in the panel's order.
  const nearbyQueue = (location.state as EventContextHistoryState | null)?.eventContextQueue;

  const navigateToEvent = useCallback(
    (eventId: string, direction: 'left' | 'right', continuousPlayback = false) => {
      setSlideDirection(direction);
      const path = profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`;
      navigate(path, {
        state: {
          from: originalFrom,
          eventFilters,
          slideDirection: direction,
          ...(continuousPlayback && { continuousPlayback: true }),
          ...(nearbyQueue && { eventContextQueue: nearbyQueue }),
        },
        replace: true,
      });
    },
    [navigate, eventFilters, originalFrom, profileId, nearbyQueue]
  );

  const goToPrevEvent = useCallback(async (): Promise<boolean> => {
    if (!currentStartDateTime || isLoadingPrev) return false;
    setIsLoadingPrev(true);
    try {
      const session = profileId ? getSession(profileId) : getCurrentSession();
      const prev = await getAdjacentEvent(session.client, session.profileId, 'prev', currentStartDateTime, eventFilters);
      if (prev) {
        navigateToEvent(prev.Event.Id, 'right');
        return true;
      }
      return false;
    } catch (err) {
      log.eventDetail('Failed to fetch previous event', LogLevel.ERROR, { error: err });
      return false;
    } finally {
      setIsLoadingPrev(false);
    }
  }, [currentStartDateTime, eventFilters, isLoadingPrev, navigateToEvent, profileId]);

  const goToNextEvent = useCallback(async ({ continuousPlayback = false } = {}): Promise<boolean> => {
    // Continuous play from a nearby event follows the panel's list. The panel
    // highlights where playback got to when back returns to it.
    const nearbyIndex = continuousPlayback && currentEventId ? nearbyQueue?.indexOf(currentEventId) ?? -1 : -1;
    if (nearbyQueue && nearbyIndex >= 0) {
      const nextId = nearbyQueue[nearbyIndex + 1];
      if (!nextId) return false;
      useReturnHighlightStore.getState().markViewed(nextId);
      navigateToEvent(nextId, 'left', true);
      return true;
    }
    if (!currentStartDateTime || isLoadingNext) return false;
    setIsLoadingNext(true);
    try {
      const session = profileId ? getSession(profileId) : getCurrentSession();
      const next = await getAdjacentEvent(session.client, session.profileId, 'next', currentStartDateTime, eventFilters);
      if (next) {
        navigateToEvent(next.Event.Id, 'left', continuousPlayback);
        return true;
      }
      return false;
    } catch (err) {
      log.eventDetail('Failed to fetch next event', LogLevel.ERROR, { error: err });
      return false;
    } finally {
      setIsLoadingNext(false);
    }
  }, [currentEventId, currentStartDateTime, eventFilters, isLoadingNext, nearbyQueue, navigateToEvent, profileId]);

  return {
    goToPrevEvent,
    goToNextEvent,
    isLoadingPrev,
    isLoadingNext,
    slideDirection,
    hasFilters,
  };
}
