/**
 * Event rows for the "around this event" panel (refs #494). Reuses
 * CompactEventRow for the thumbnail, detection text, time and duration; the
 * offset badge and anchor marking are this list's own.
 */
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CompactEventRow } from '../CompactEventRow';
import { Skeleton } from '../../ui/skeleton';
import { ErrorBanner } from '../../ui/query-state';
import { EmptyState } from '../../ui/empty-state';
import { Button } from '../../ui/button';
import { resolveQueryError } from '../../../lib/query/query-error';
import { formatElapsedShort } from '../../../lib/format-date-time';
import { buildThumbnailChainForEvent, eventHasAlarmFrame } from '../../../lib/event/thumbnail-chain';
import { calculateThumbnailDimensions, getMonitorDimensions, EVENT_GRID_CONSTANTS } from '../../../lib/event/event-utils';
import { useProfileById } from '../../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../../lib/monitor/multiport';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { Event, ProfileId } from '../../../api/types';
import type { ThumbnailFallbackEntry } from '../../../lib/event/thumbnail-chain';

interface RowThumbnailOptions {
  portalUrl: string;
  thumbnailChain: ThumbnailFallbackEntry[];
  token: string | undefined;
  minStreamingPort: number | undefined;
  profileId: ProfileId | undefined;
}

/** Thumbnail chain and aspect ratio for one row, mirroring
 *  MonitorRecentEvents.tsx's buildRow. */
function buildRowThumbnail(event: Event, opts: RowThumbnailOptions) {
  const { width, height } = getMonitorDimensions(undefined, event.Width, event.Height);
  const { width: tw, height: th } = calculateThumbnailDimensions(
    width,
    height,
    event.Orientation,
    EVENT_GRID_CONSTANTS.LIST_VIEW_TARGET_SIZE
  );
  const urls = buildThumbnailChainForEvent(event.MonitorId, [], opts.portalUrl, event.Id, opts.thumbnailChain, {
    token: opts.token,
    width: tw,
    height: th,
    minStreamingPort: opts.minStreamingPort,
    monitorId: event.MonitorId,
    hasAlarmFrame: eventHasAlarmFrame(event),
    profileId: opts.profileId,
  });
  return { urls, aspectRatio: tw / th };
}

export interface EventContextListProps {
  rows: EventAroundRow[];
  profileId: ProfileId | undefined;
  isLoading: boolean;
  error: unknown;
  truncated: boolean;
  onWiden: (() => void) | undefined;
}

/** "−4:12" / "+0:38" / "0:00" — digits and a sign, no translation needed. */
export function offsetLabel(offsetMs: number): string {
  const elapsed = formatElapsedShort(Math.abs(offsetMs));
  if (offsetMs < 0) return `−${elapsed}`;
  if (offsetMs > 0) return `+${elapsed}`;
  return elapsed;
}

export function EventContextList({ rows, profileId, isLoading, error, truncated, onWiden }: EventContextListProps) {
  const { t } = useTranslation();
  const { profile, settings } = useProfileById(profileId);
  const { token: accessToken, isFresh } = useFreshAccessToken(profileId);
  const minStreamingPort = resolveMinStreamingPort(profile?.minStreamingPort, settings.forceDisableMultiPort);
  const portalUrl = profile?.portalUrl || '';

  if (isLoading) {
    return (
      <div className="space-y-1.5 p-2" data-testid="event-context-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="event-context-error" className="p-4">
        <ErrorBanner message={resolveQueryError(error, t)} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div data-testid="event-context-empty">
        <EmptyState icon={Link2} title={t('events.around.empty')} description={t('events.around.empty_desc')} />
        {onWiden && (
          <div className="text-center -mt-2 pb-4">
            <Button variant="link" size="sm" onClick={onWiden} data-testid="event-context-widen">
              {t('events.around.widen')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {truncated && (
        <div data-testid="event-context-truncated" className="px-4 py-2 text-xs text-muted-foreground">
          {t('events.around.truncated', { count: rows.length })}
        </div>
      )}
      <div className="space-y-1.5 p-2">
        {rows.map(({ event, offsetMs, isAnchor }) => {
          const { urls, aspectRatio } = buildRowThumbnail(event, {
            portalUrl,
            thumbnailChain: settings.thumbnailFallbackChain,
            token: isFresh ? accessToken ?? undefined : undefined,
            minStreamingPort,
            profileId,
          });
          return (
            <div
              key={event.Id}
              data-testid={`event-context-row-${event.Id}`}
              aria-current={isAnchor ? 'true' : undefined}
              className={cn('relative', isAnchor && 'ring-2 ring-primary/60 rounded-md')}
            >
              <span className="absolute right-1.5 top-1.5 z-10 text-[11px] font-medium tabular-nums px-1 py-0.5 rounded bg-background/90 text-muted-foreground">
                {offsetLabel(offsetMs)}
              </span>
              <CompactEventRow
                event={event}
                thumbnailUrls={urls}
                aspectRatio={aspectRatio}
                profileId={profileId}
                ownerProfileId={profileId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
