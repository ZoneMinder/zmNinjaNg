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
import { offsetLabel, buildRowThumbnail } from '../../../lib/event/event-context-view';
import { useProfileById } from '../../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../../lib/monitor/multiport';
import { cn } from '../../../lib/utils';
import type { EventAroundRow } from '../../../hooks/useEventsAround';
import type { ProfileId } from '../../../api/types';

export interface EventContextListProps {
  rows: EventAroundRow[];
  profileId: ProfileId | undefined;
  isLoading: boolean;
  error: unknown;
  truncated: boolean;
  onWiden: (() => void) | undefined;
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
              className={cn(isAnchor && 'ring-2 ring-primary/60 bg-primary/5 rounded-md')}
            >
              {/* The offset replaces CompactEventRow's own duration badge
                  rather than sitting in a column beside it, so it appears
                  once (refs #494). An offset of zero from itself says
                  nothing, so the anchor gets a label instead, tinted blue
                  to read as the event you came from. */}
              <CompactEventRow
                event={event}
                thumbnailUrls={urls}
                aspectRatio={aspectRatio}
                profileId={profileId}
                ownerProfileId={profileId}
                hoverPreview={settings.hoverPreview.eventContext}
                badgeLabel={isAnchor ? t('events.around.this_event') : offsetLabel(offsetMs)}
                badgeTitle={t('events.around.offset_title')}
                badgeClassName={isAnchor ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
