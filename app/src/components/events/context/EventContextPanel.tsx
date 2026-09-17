/**
 * The "around this event" panel shell (refs #494): mounted once in the app
 * shell and driven entirely by `useEventContextStore`. Radix handles the
 * backdrop, Escape and focus trapping; `useIsMobile` decides which edge it
 * comes from.
 *
 * The window/scope choice lives in local state seeded from the anchor
 * profile's settings, and is written back through `updateProfileSettings` on
 * every change so the next open starts where the last one ended. That state
 * lives in `EventContextBody`, keyed by profile+anchor, so each open mounts a
 * fresh instance seeded from that profile's *current* setting rather than
 * whatever was on screen the first time the (always-mounted) panel rendered.
 *
 * Task 6 mounts `<EventContextList/>`, Task 7 `<EventContextRibbon/>`, Task 8
 * the footer.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useEventContextStore } from '../../../stores/eventContext';
import { useProfileStore } from '../../../stores/profile';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useEventsAround } from '../../../hooks/useEventsAround';
import { useSettingsStore, type EventContextSettings } from '../../../stores/settings';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose, SheetFooter } from '../../ui/sheet';
import { Button } from '../../ui/button';
import { EventContextControls } from './EventContextControls';
import { EventContextList } from './EventContextList';
import { EventContextRibbon } from './EventContextRibbon';
import { buildRibbonLanes } from '../../../lib/event/event-context-view';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import type { EventData, ProfileId } from '../../../api/types';

function EventContextBody({ anchor, profileId }: { anchor: EventData; profileId: ProfileId | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const closePanel = useEventContextStore((s) => s.closePanel);
  const settings = useSettingsStore(useShallow((s) => s.getProfileSettings(profileId ?? '')));
  const [context, setContext] = useState<EventContextSettings>(settings.eventContext);
  const applyContext = useCallback(
    (next: EventContextSettings) => {
      setContext(next);
      if (profileId) useSettingsStore.getState().updateProfileSettings(profileId, { eventContext: next });
    },
    [profileId]
  );

  const { rows, monitorNames, available, isLoading, error, truncated, window } = useEventsAround(anchor, profileId, {
    windowMinutes: context.windowMinutes,
    scope: context.scope,
    enabled: true,
  });

  const lanes = useMemo(
    () => buildRibbonLanes(rows, monitorNames, context.windowMinutes * 60_000 * 2),
    [rows, monitorNames, context.windowMinutes]
  );

  const listRef = useRef<HTMLDivElement>(null);
  const markViewed = useReturnHighlightStore((s) => s.markViewed);
  const onSelect = useCallback(
    (eventId: string) => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-testid="event-context-row-${eventId}"]`)
        ?.scrollIntoView({ block: 'nearest' });
      markViewed(eventId);
    },
    [markViewed]
  );

  const widerMinutes = EVENT_CONTEXT.windowChoices.find((m) => m > context.windowMinutes);
  const onWiden = widerMinutes
    ? () => applyContext({ ...context, windowMinutes: widerMinutes })
    : undefined;

  // The distinct monitor ids among the window's own rows: what the scope
  // actually resolved to, read off data already fetched rather than
  // re-deriving the scope's monitor list for the Events hatch.
  const monitorIds = useMemo(() => [...new Set(rows.map((r) => r.event.MonitorId))], [rows]);

  const openInTimeline = useCallback(() => {
    // useTimelineFilters restores timelinePageFilters from the settings
    // bucket keyed by currentProfileId - the aggregate id in All mode, a real
    // profile id in single mode - not from the anchor's own profile. Writing
    // to the anchor's bucket in All mode would land the window somewhere the
    // Timeline page never reads it (refs #494).
    const targetProfileId = useProfileStore.getState().currentProfileId;
    if (targetProfileId) {
      const store = useSettingsStore.getState();
      const current = store.getProfileSettings(targetProfileId).timelinePageFilters;
      store.updateProfileSettings(targetProfileId, {
        timelinePageFilters: { ...current, startDateTime: window.startDateTime, endDateTime: window.endDateTime },
      });
    }
    closePanel();
    navigate('/timeline');
  }, [window, closePanel, navigate]);

  const openInEvents = useCallback(() => {
    closePanel();
    // A URL deep link, not nav state: resolveInitialFilters
    // (useEventFilters.ts) reads exactly these query params ahead of any
    // persisted filter, which is the sanctioned way to land on Events
    // pre-filtered - nav state has no reader there.
    const params = new URLSearchParams({
      startDateTime: window.startDateTime,
      endDateTime: window.endDateTime,
    });
    if (monitorIds.length) params.set('monitorId', monitorIds.join(','));
    navigate(`/events?${params.toString()}`);
  }, [window, monitorIds, closePanel, navigate]);

  return (
    <>
      <EventContextControls value={context} onChange={applyContext} available={available} />
      <EventContextRibbon lanes={lanes} onSelect={onSelect} />
      <div ref={listRef} className="contents">
        <EventContextList
          rows={rows}
          profileId={profileId}
          isLoading={isLoading}
          error={error}
          truncated={truncated}
          onWiden={onWiden}
        />
      </div>
      <SheetFooter className="flex-row gap-2 border-t p-3">
        <Button variant="outline" size="sm" className="flex-1" onClick={openInTimeline} data-testid="event-context-open-timeline">
          {t('events.around.timeline')}
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={openInEvents} data-testid="event-context-open-events">
          {t('events.around.events')}
        </Button>
      </SheetFooter>
    </>
  );
}

export function EventContextPanel() {
  const { t } = useTranslation();
  const { anchor, open, profileId } = useEventContextStore(
    useShallow((s) => ({ anchor: s.anchor, open: s.open, profileId: s.profileId }))
  );
  const closePanel = useEventContextStore((s) => s.closePanel);
  const isMobile = useIsMobile();

  if (!open || !anchor) return null;

  return (
    <Sheet open onOpenChange={(next) => { if (!next) closePanel(); }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn('flex flex-col gap-0 p-0', isMobile ? 'h-[85vh] rounded-t-2xl' : 'w-[440px] sm:max-w-[440px]')}
        data-testid="event-context-panel"
      >
        <SheetHeader className="px-4 pt-4 pb-3 text-left">
          <SheetTitle className="text-base">{t('events.around.title')}</SheetTitle>
          <div className="text-sm text-muted-foreground" data-testid="event-context-anchor">
            {anchor.Event.Name}
          </div>
        </SheetHeader>
        <EventContextBody key={`${profileId ?? ''}:${anchor.Event.Id}`} anchor={anchor} profileId={profileId} />
        <SheetClose asChild>
          <Button variant="outline" size="sm" className="m-4" data-testid="event-context-close">
            {t('common.close')}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
