/**
 * Montage grid rendering: All-mode per-profile error strips, and the
 * grouped/ungrouped tile grid with its stream-cap overflow message.
 *
 * Extracted from Montage.tsx (refs #337, Phase 4 Task 1 fix round 1 - C2:
 * the page file had grown past the 400-line guideline). Behavior-preserving;
 * Montage.tsx still owns all state and the profile/event-count resolution
 * (single vs All mode), passed in here as plain resolver callbacks so this
 * component stays agnostic of that branching.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { Profile, ProfileId } from '../../api/types';
import type { ProfileError } from '../../api/scoped-types';
import type { MonitorFeedFit } from '../../stores/settings';
import { Button } from '../ui/button';
import { ErrorBanner } from '../ui/query-state';
import { resolveQueryError } from '../../lib/query/query-error';
import { handleKeyClick } from '../../lib/tv/tv-a11y';
import { cn } from '../../lib/utils';
import { GRID_LAYOUT } from '../../lib/zmninja-ng-constants';
import { MontageMonitor } from '../monitors/MontageMonitor';
import { MontageTileErrorBoundary } from './MontageTileErrorBoundary';
import { ProfileSectionList } from '../profiles/ProfileSectionList';
import { internalColsForCols, tileIdFor, type MontageTileMonitorData } from './hooks/useMontageGrid';

const WrappedGridLayout = WidthProvider(GridLayout);

/** One montage tile's render data. profileId/profileChip are set only in
 *  All mode (see useScopedMonitors), mirroring Monitors.tsx's MonitorGridItem. */
export interface MontageTileItem extends MontageTileMonitorData {
  profileChip?: string;
}

export type MontageGroupedSections = Array<
  [ProfileId, { profileName: string; items: MontageTileItem[] }]
>;

interface MontageErrorStripsProps {
  errors: ProfileError[];
  onRetry: (profileId: ProfileId) => void;
}

/** Per-profile error strips, All mode only (see visibleErrors in Montage.tsx
 *  - zero-data suppression already applied by the caller). */
export function MontageErrorStrips({ errors, onRetry }: MontageErrorStripsProps) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;
  return (
    <div className="space-y-2 px-2 pt-2 sm:px-3">
      {errors.map((err) => (
        <div
          key={err.profileId}
          className="flex items-center gap-2"
          data-testid={`profile-error-strip-${err.profileId}`}
        >
          <ErrorBanner
            className="flex-1"
            // "{name}: {message}" is a raw template join, not a locale key -
            // deliberately mirrors Monitors.tsx's own All-mode error strip
            // (same join, same fallbackKey), so this stays consistent with
            // the sibling page rather than diverging with a new pattern.
            message={`${err.profileName}: ${resolveQueryError(err.error, t, { fallbackKey: 'monitors.failed_to_load' })}`}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry(err.profileId)}
            data-testid={`profile-error-strip-retry-${err.profileId}`}
          >
            {t('common.retry')}
          </Button>
        </div>
      ))}
    </div>
  );
}

interface MontageGridSectionsProps {
  cappedMonitors: MontageTileItem[];
  groupedSections: MontageGroupedSections | null;
  /** The aggregate the sections belong to; scopes their collapse state. */
  scopeId?: ProfileId;
  layout: Layout[];
  gridCols: number;
  isEditMode: boolean;
  overflowCount: number;
  onLayoutChange: (nextLayout: Layout[]) => void;
  onDragStop: (nextLayout: Layout[], oldItem: Layout, newItem: Layout) => void;
  onResizeStop: (layout: Layout[], oldItem: Layout, newItem: Layout) => void;
  navigate: NavigateFunction;
  isFullscreen: boolean;
  isTvMode: boolean;
  focusedMonitorIndex: number;
  showMonitorLabels: boolean;
  objectFit: MonitorFeedFit;
  accessToken: string | null;
  isMonitorPinned: (tileId: string) => boolean;
  onPinToggle: (tileId: string) => void;
  /** The tile's owning profile: its own server in All mode (profileId set),
   *  the page's current profile in single mode (profileId undefined). */
  resolveOwnerProfile: (profileId: ProfileId | undefined) => Profile | null;
  resolveNewEventCount: (item: MontageTileItem) => number | undefined;
  resolveNewestEventAt: (item: MontageTileItem) => string | null | undefined;
  /** All-mode "reduced" stream tuning: every tile asks its server for a
   *  cheaper stream (refs #337). Always false in single mode. */
  reduceStream: boolean;
  /** All-mode pause-while-hidden: every tile stops streaming (refs #337).
   *  Always false in single mode. */
  paused: boolean;
  /** All-mode viewport gating: this tile is out of view and must hold no
   *  connection (refs #337). Composes with `paused` - either reason stops the
   *  tile. Always false in single mode. */
  isTileGated: (tileId: string) => boolean;
  /** Hands the tile's element to the page's one IntersectionObserver, which
   *  is what answers `isTileGated`. Records the element whether gating is on
   *  or off - only the observing waits for the setting, so turning it on
   *  mid-session finds every tile already registered. */
  registerTile: (tileId: string) => (el: HTMLElement | null) => void;
  /** All-mode idle downgrade: 'snapshot' once the user has left the page
   *  alone long enough (refs #337). Undefined leaves each tile on its own
   *  Streaming Mode. */
  forceViewMode?: 'streaming' | 'snapshot';
}

/** Grouped-by-server sections when the toggle is on (All mode only), or one
 *  combined grid otherwise, plus the stream-cap overflow message. */
export function MontageGridSections({
  cappedMonitors,
  groupedSections,
  scopeId,
  layout,
  gridCols,
  isEditMode,
  overflowCount,
  onLayoutChange,
  onDragStop,
  onResizeStop,
  navigate,
  isFullscreen,
  isTvMode,
  focusedMonitorIndex,
  showMonitorLabels,
  objectFit,
  accessToken,
  isMonitorPinned,
  onPinToggle,
  resolveOwnerProfile,
  resolveNewEventCount,
  resolveNewestEventAt,
  reduceStream,
  paused,
  isTileGated,
  registerTile,
  forceViewMode,
}: MontageGridSectionsProps) {
  const { t } = useTranslation();

  // layout is one flat array covering every tile (single WrappedGridLayout in
  // the ungrouped case); grouped rendering slices it per profile so each
  // server gets its own independent grid region. x stays within
  // internalColsForCols(gridCols) regardless of subset size, so a section's
  // own vertical compaction is all that changes per instance.
  const layoutByTileId = new Map(layout.map((item) => [item.i, item]));
  const globalIndexByTileId = new Map(cappedMonitors.map((item, i) => [tileIdFor(item), i]));

  const sharedGridLayoutProps = {
    cols: internalColsForCols(gridCols),
    rowHeight: GRID_LAYOUT.montageRowHeight,
    margin: [0, 0] as [number, number],
    containerPadding: [0, 0] as [number, number],
    compactType: 'vertical' as const,
    preventCollision: false,
    isResizable: isEditMode,
    isDraggable: isEditMode,
    resizeHandles: ['se', 'sw', 'ne', 'nw'] as Array<'s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne'>,
    draggableCancel: '.pin-locked,.no-drag',
    onLayoutChange,
    onDragStop,
    onResizeStop,
  };

  const renderTile = (item: MontageTileItem): ReactNode => {
    const { Monitor, Monitor_Status, profileId, profileChip } = item;
    const tileId = tileIdFor(item);
    const idx = globalIndexByTileId.get(tileId) ?? -1;
    const ownerProfile = resolveOwnerProfile(profileId);
    return (
      <div
        key={tileId}
        className={cn(
          "relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isMonitorPinned(tileId) && "pin-locked",
          isTvMode && idx === focusedMonitorIndex && "ring-2 ring-primary"
        )}
        role="button"
        aria-label={Monitor.Name}
        data-testid={`montage-monitor-${tileId}`}
        tabIndex={isEditMode ? -1 : 0}
        onClick={() => !isEditMode && navigate(
          profileId ? `/all/monitors/${profileId}/${Monitor.Id}` : `/monitors/${Monitor.Id}`,
          { state: { from: '/montage' } }
        )}
        onKeyDown={handleKeyClick}
      >
        {/* The element viewport gating observes. It has to be INSIDE the grid
            item rather than being the item itself: react-grid-layout clones
            every child with a ref of its own, which replaces any ref put on
            that element, so a ref one level up is never called. This div
            fills the item, so its box is the tile's real position, and the
            item is the thing react-grid-layout moves - a drag or resize
            changes this box with it. */}
        <div ref={registerTile(tileId)} className="w-full h-full">
          <MontageTileErrorBoundary monitorId={Monitor.Id} monitorName={Monitor.Name}>
            <MontageMonitor
              monitor={Monitor}
              status={Monitor_Status}
              currentProfile={ownerProfile}
              accessToken={accessToken}
              navigate={navigate}
              profileId={profileId}
              profileChip={profileChip}
              isFullscreen={isFullscreen}
              isEditing={isEditMode}
              isPinned={isMonitorPinned(tileId)}
              onPinToggle={() => onPinToggle(tileId)}
              objectFit={objectFit}
              showOverlay={showMonitorLabels}
              newEventCount={resolveNewEventCount(item)}
              newestEventAt={resolveNewestEventAt(item)}
              reduceStream={reduceStream}
              // Out of view stops the tile for the same reason a hidden page
              // does, so the two share one prop rather than the player
              // learning a second way to be off.
              paused={paused || isTileGated(tileId)}
              forceViewMode={forceViewMode}
            />
          </MontageTileErrorBoundary>
        </div>
      </div>
    );
  };

  return (
    <>
      <div
        className={cn(
          'w-full',
          isFullscreen && 'pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]'
        )}
        data-testid="montage-grid"
      >
        {groupedSections && scopeId ? (
          <ProfileSectionList
            sections={groupedSections}
            surface="montage-group"
            scopeId={scopeId}
            className="space-y-6"
            renderItems={(items) => {
              // Collapsing unmounts the section's tiles, which stops those
              // streams - the point of folding a server away (refs #503).
              const sectionLayout = items
                .map((item) => layoutByTileId.get(tileIdFor(item)))
                .filter((item): item is Layout => !!item);
              return (
                <WrappedGridLayout layout={sectionLayout} {...sharedGridLayoutProps}>
                  {items.map(renderTile)}
                </WrappedGridLayout>
              );
            }}
          />
        ) : (
          <WrappedGridLayout layout={layout} {...sharedGridLayoutProps}>
            {cappedMonitors.map(renderTile)}
          </WrappedGridLayout>
        )}
      </div>
      {overflowCount > 0 && (
        <p className="text-sm text-muted-foreground mt-3 px-1" data-testid="montage-stream-cap-overflow">
          {t('montage.stream_cap_overflow', { count: overflowCount })}
        </p>
      )}
    </>
  );
}
