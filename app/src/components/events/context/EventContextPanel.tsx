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
 * Task 6 mounts `<EventContextList/>`, Task 7 `<EventContextRibbon/>`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useEventContextStore } from '../../../stores/eventContext';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useEventsAround } from '../../../hooks/useEventsAround';
import { useSettingsStore, type EventContextSettings } from '../../../stores/settings';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '../../ui/sheet';
import { Button } from '../../ui/button';
import { EventContextControls } from './EventContextControls';
import { EventContextList } from './EventContextList';
import { EventContextRibbon } from './EventContextRibbon';
import { buildRibbonLanes } from '../../../lib/event/event-context-view';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import type { EventData, ProfileId } from '../../../api/types';

function EventContextBody({ anchor, profileId }: { anchor: EventData; profileId: ProfileId | undefined }) {
  const settings = useSettingsStore(useShallow((s) => s.getProfileSettings(profileId ?? '')));
  const [context, setContext] = useState<EventContextSettings>(settings.eventContext);

  const { rows, monitorNames, available, effectiveScope, isLoading, error, truncated } = useEventsAround(anchor, profileId, {
    windowMinutes: context.windowMinutes,
    scope: context.scope,
    enabled: true,
  });

  const applyContext = useCallback(
    (next: EventContextSettings) => {
      // The controls render `shownContext` below, so a window change reports
      // the effective scope back rather than the saved one. Only a segment the
      // user moved somewhere else overwrites the saved scope: a fallback this
      // anchor forced is about the open panel, not about their default.
      const merged = next.scope === effectiveScope ? { ...next, scope: context.scope } : next;
      setContext(merged);
      if (profileId) useSettingsStore.getState().updateProfileSettings(profileId, { eventContext: merged });
    },
    [profileId, context.scope, effectiveScope]
  );

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

  // What the controls show is the scope the query actually ran with, which is
  // not the saved one when this anchor cannot offer it (useEventsAround). The
  // user's own choice stays in `context` and in settings; only the pressed
  // chip follows the result.
  const shownContext = useMemo(
    () => (effectiveScope === context.scope ? context : { ...context, scope: effectiveScope }),
    [context, effectiveScope]
  );

  return (
    <>
      <EventContextControls value={shownContext} onChange={applyContext} available={available} />
      <EventContextRibbon lanes={lanes} onSelect={onSelect} />
      <div ref={listRef} className="contents">
        <EventContextList
          rows={rows}
          profileId={profileId}
          monitorNames={monitorNames}
          isLoading={isLoading}
          error={error}
          truncated={truncated}
          onWiden={onWiden}
        />
      </div>
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

  // Radix blocks background clicks but not navigation: back/forward, a
  // programmatic navigate, or a typed URL all leave the panel mounted with a
  // now-stale anchor. Close it on the first pathname change after it opened,
  // but not on the initial mount. This is what closes the panel when a row's
  // own navigate (CompactEventRow) takes the user to that event.
  const pathname = useLocation().pathname;
  const openedPathname = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openedPathname.current = null;
      return;
    }
    if (openedPathname.current === null) {
      openedPathname.current = pathname;
      return;
    }
    if (pathname !== openedPathname.current) closePanel();
  }, [open, pathname, closePanel]);

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
