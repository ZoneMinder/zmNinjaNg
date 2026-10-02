/**
 * The "around this event" panel shell (refs #494): mounted once in the app
 * shell and driven entirely by `useEventContextStore`. Radix handles the
 * backdrop, Escape and focus trapping; `useIsMobile` decides which edge it
 * comes from.
 *
 * The window/scope choice lives in local state seeded from the current
 * selection's settings, and is written back through `updateProfileSettings` on
 * every change so the next open starts where the last one ended. That state
 * lives in `EventContextBody`, keyed by profile+anchor, so each open mounts a
 * fresh instance seeded from the *current* setting rather than
 * whatever was on screen the first time the (always-mounted) panel rendered.
 *
 * The open panel is itself a history entry (refs #494): EventContextButton
 * pushes it, so back/forward, the Android back button and this panel's own
 * dismissal controls all agree on whether it is showing. See
 * stores/eventContext.ts for the state that entry carries.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, Play } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useEventContextStore, type EventContextHistoryState } from '../../../stores/eventContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useEventsAround } from '../../../hooks/useEventsAround';
import { useSettingsStore, type EventContextSettings } from '../../../stores/settings';
import { useProfileStore } from '../../../stores/profile';
import { useCurrentProfile } from '../../../hooks/useCurrentProfile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '../../ui/sheet';
import { Button } from '../../ui/button';
import { EventContextControls } from './EventContextControls';
import { EventContextList } from './EventContextList';
import { EventContextSequence } from './EventContextSequence';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import type { EventData, ProfileId } from '../../../api/types';

function EventContextBody({ anchor, profileId }: { anchor: EventData; profileId: ProfileId | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Sequence play is its own history entry over the panel's, so back from an
  // event opened in it lands on it again (refs #534).
  const historyState = location.state as EventContextHistoryState | null;
  const sequence = historyState?.eventContextSequence;
  const openSequence = () =>
    navigate(
      { pathname: location.pathname, search: location.search },
      { state: { ...historyState, eventContextSequence: {} } satisfies EventContextHistoryState }
    );
  // eventContext is selection-scoped: read and saved on the current selection,
  // not on the anchor's server (refs #536).
  const { settings } = useCurrentProfile();
  const currentProfileId = useProfileStore((s) => s.currentProfileId);
  const [context, setContext] = useState<EventContextSettings>(settings.eventContext);

  // The Events page behind the panel, if any, publishes its query for the
  // Filtered scope; anywhere else this is null and Filtered greys out.
  const pageQuery = useEventContextStore((s) => s.pageQuery);
  const { rows, monitorNames, available, effectiveScope, isLoading, error, truncated } = useEventsAround(anchor, profileId, {
    windowMinutes: context.windowMinutes,
    scope: context.scope,
    enabled: true,
    pageQuery,
  });

  const applyContext = useCallback(
    (next: EventContextSettings) => {
      // The controls render `shownContext` below, so a window change reports
      // the effective scope back rather than the saved one. Only a segment the
      // user moved somewhere else overwrites the saved scope: a fallback this
      // anchor forced is about the open panel, not about their default.
      const merged = next.scope === effectiveScope ? { ...next, scope: context.scope } : next;
      setContext(merged);
      if (currentProfileId) useSettingsStore.getState().updateProfileSettings(currentProfileId, { eventContext: merged });
    },
    [currentProfileId, context.scope, effectiveScope]
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
      <EventContextControls value={shownContext} onChange={applyContext} available={available}>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length < 2}
          onClick={openSequence}
          data-testid="event-context-sequence-open"
        >
          {/* One icon: a grid of tiles with a play badge on its corner. The
              badge's stroke is the button background, so the grid lines stop
              short of it instead of running through. */}
          <span className="relative inline-flex h-4 w-4 shrink-0" aria-hidden>
            <Grid3x3 className="h-4 w-4" />
            <Play
              className="absolute -bottom-1 -right-1 h-2.5 w-2.5 fill-current stroke-background"
              strokeWidth={4}
              style={{ paintOrder: 'stroke' }}
            />
          </span>
          {t('events.around.sequence')}
        </Button>
      </EventContextControls>
      {/* Mounted only while open, so each open or return starts fresh. */}
      {sequence && (
        <EventContextSequence
          open
          onOpenChange={(next) => { if (!next) navigate(-1); }}
          rows={rows}
          profileId={profileId}
          monitorNames={monitorNames}
          returnedFrom={sequence.returnedFrom}
          truncated={truncated}
        />
      )}
      <EventContextList
        rows={rows}
        profileId={profileId}
        monitorNames={monitorNames}
        isLoading={isLoading}
        error={error}
        truncated={truncated}
        onWiden={onWiden}
      />
    </>
  );
}

export function EventContextPanel() {
  const { t } = useTranslation();
  const { anchor, profileId } = useEventContextStore(
    useShallow((s) => ({ anchor: s.anchor, profileId: s.profileId }))
  );
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // The open panel is a history entry (refs #494), not a store flag: this is
  // what back/forward, a programmatic navigate elsewhere, and a typed URL all
  // already handle correctly without a dedicated effect. EventContextButton
  // pushes the entry that carries `eventContextAnchor`; it disappears the
  // moment that entry is no longer current, by any route away from it.
  const historyAnchor = (useLocation().state as EventContextHistoryState | null)?.eventContextAnchor;
  const open = Boolean(historyAnchor);

  if (!open || !anchor) return null;

  return (
    <Sheet open onOpenChange={(next) => { if (!next) navigate(-1); }}>
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
