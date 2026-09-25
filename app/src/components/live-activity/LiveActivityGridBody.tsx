/**
 * Live Activity's grid content: loading skeleton, quiet empty state, tile
 * grid, and the two overflow notices. Extracted out of LiveActivity.tsx (C2 -
 * the page file had grown past the 400-line guideline once All mode was
 * added). Behavior-preserving; the page still owns all state and the
 * single/All-mode resolution, passed in here as plain values/callbacks so
 * this component stays agnostic of that branching (mirrors
 * MontageGridSections' extraction out of Montage.tsx).
 */

import { useTranslation } from 'react-i18next';
import { EyeClosed } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { Profile, ProfileId } from '../../api/types';
import type { ActiveMonitorEntry } from '../../lib/monitor/live-activity';
import type { LiveActivityMonitorEntry } from '../../hooks/useLiveActivityAllMode';
import { getLiveActivityRowSpan } from '../../lib/monitor/live-activity-layout';
import { LIVE_ACTIVITY } from '../../lib/zmninja-ng-constants';
import { LiveActivityTile } from './LiveActivityTile';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/query-state';
import { Skeleton } from '../ui/skeleton';
import { resolveQueryError } from '../../lib/query/query-error';
import { groupByOwningProfile } from '../../lib/profile/profile-sections';
import { ProfileSectionList } from '../profiles/ProfileSectionList';

interface LiveActivityGridBodyProps {
  error: unknown;
  showSkeleton: boolean;
  showEmptyState: boolean;
  isEmpty: boolean;
  watchedCount: number;
  gridCols: number;
  gridWidth: number;
  setGridElement: (element: HTMLDivElement | null) => void;
  visible: ActiveMonitorEntry[];
  monitorsById: Map<string, LiveActivityMonitorEntry>;
  resolveOwnerProfile: (profileId: ProfileId | undefined) => Profile | null;
  accessToken: string | null;
  navigate: NavigateFunction;
  /** Whether a tile's video opens the enlarged preview on hover. */
  hoverPreview: boolean;
  now: number;
  onDismiss: (monitorId: string) => void;
  /** Tiles beyond liveActivityMaxTiles, collapsed into a count. */
  overflowCount: number;
  /** All mode only: watched (profile, monitor) pairs the round-robin cap
   *  dropped before any alarm was ever polled - distinct from
   *  `overflowCount` above, which is about ALARMING monitors. */
  watchOverflowCount: number;
  /** The aggregate's id when its tiles are sectioned by server, else
   *  undefined for one flat grid (refs #529). */
  groupByScopeId?: ProfileId;
}

export function LiveActivityGridBody({
  error,
  showSkeleton,
  showEmptyState,
  isEmpty,
  watchedCount,
  gridCols,
  gridWidth,
  setGridElement,
  visible,
  monitorsById,
  resolveOwnerProfile,
  accessToken,
  navigate,
  hoverPreview,
  now,
  onDismiss,
  overflowCount,
  watchOverflowCount,
  groupByScopeId,
}: LiveActivityGridBodyProps) {
  const { t } = useTranslation();

  // One tile grid. The measuring ref sits on a wrapper below, not on the
  // grid, so one element is measured whether the tiles are sectioned or not.
  const renderGrid = (entries: ActiveMonitorEntry[]) => (
    <div
      // items-start, so each tile keeps the height its camera's aspect
      // ratio gives it and never stretches to fill the rows it spans.
      // The default stretch would pull a tile up to the rounded-up span
      // below, and since the video area inside a tile is pinned to its own
      // ratio, that extra height would arrive as dead black space under
      // the picture along with the elapsed label floating in it.
      //
      // Rows are one pixel tall and each tile spans its own height, so
      // tiles never share a row and a short camera beside a tall one no
      // longer leaves a hole under itself. Until the grid has been
      // measured there are no spans to honour, so the row unit stays off
      // and tiles keep their natural heights for that one frame.
      className="grid items-start"
      style={{
        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
        gridAutoRows: gridWidth > 0 ? `${LIVE_ACTIVITY.rowUnitPx}px` : undefined,
      }}
    >
      {entries.map((entry) => {
        const monitorData = monitorsById.get(entry.monitorId);
        if (!monitorData) return null;
        return (
          <LiveActivityTile
            key={entry.monitorId}
            entry={entry}
            monitor={monitorData.Monitor}
            status={monitorData.Monitor_Status}
            currentProfile={resolveOwnerProfile(monitorData.profileId)}
            profileId={monitorData.profileId}
            profileChip={monitorData.profileChip}
            accessToken={accessToken}
            navigate={navigate}
            hoverPreview={hoverPreview}
            now={now}
            // Recomputed per render, but it only ever changes with the
            // grid width, the column count or the camera's own shape, so
            // the one-second clock never moves it.
            rowSpan={
              gridWidth > 0
                ? getLiveActivityRowSpan(monitorData.Monitor, gridWidth, gridCols)
                : undefined
            }
            onDismiss={onDismiss}
          />
        );
      })}
    </div>
  );

  // Tagged with the owning server for sectioning. A tile whose monitor is
  // not loaded yet has no owner to section it under, and renderGrid would
  // skip it anyway.
  const sections = groupByScopeId
    ? groupByOwningProfile(visible.flatMap((entry) => {
        const monitorData = monitorsById.get(entry.monitorId);
        return monitorData
          ? [{ entry, profileId: monitorData.profileId, profileChip: monitorData.profileChip }]
          : [];
      }))
    : null;

  return (
    <>
      {!!error && <ErrorBanner message={resolveQueryError(error, t)} />}

      {showSkeleton && (
        <div
          // Same element ref as the real grid, so the width is already
          // measured when the first tiles arrive and they are packed on their
          // first frame rather than laying out once and then again.
          ref={setGridElement}
          className="grid"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
          data-testid="live-activity-loading"
        >
          {Array.from({ length: gridCols * 2 }, (_, i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      )}

      {showEmptyState && (
        <div data-testid="live-activity-empty">
          <EmptyState
            icon={EyeClosed}
            title={t('live_activity.all_quiet')}
            description={t('live_activity.watching_count', { count: watchedCount })}
          />
        </div>
      )}

      {!isEmpty && (
        <div ref={setGridElement}>
          {sections && groupByScopeId ? (
            <ProfileSectionList
              sections={sections}
              surface="live-activity-group"
              scopeId={groupByScopeId}
              className="space-y-6"
              renderItems={(items) => renderGrid(items.map((item) => item.entry))}
            />
          ) : (
            renderGrid(visible)
          )}
        </div>
      )}

      {overflowCount > 0 && (
        <p className="text-sm text-muted-foreground mt-3" data-testid="live-activity-overflow">
          {t('live_activity.overflow', { count: overflowCount })}
        </p>
      )}

      {/* GUARDRAIL notice, All mode only: the watched set itself was capped
          before any alarm was ever polled, distinct from the tile overflow
          above (which is about how many ALARMING monitors are shown). */}
      {watchOverflowCount > 0 && (
        <p className="text-sm text-muted-foreground mt-3" data-testid="live-activity-watch-cap-notice">
          {t('live_activity.watch_cap_overflow', { count: watchOverflowCount })}
        </p>
      )}
    </>
  );
}
