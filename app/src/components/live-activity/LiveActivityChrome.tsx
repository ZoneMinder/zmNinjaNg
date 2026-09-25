/**
 * The page furniture around the Live Activity grid, in both of its modes.
 *
 * Normally that is a heading and the controls; in fullscreen it is a thin
 * translucent bar and nothing else, so a wall display shows tiles. Montage's
 * own fullscreen bar is not reused: it carries the kiosk lock and the tile
 * label toggle, and importing it would pull the kiosk store and the PIN pad
 * onto a page that offers neither.
 */

import { useTranslation } from 'react-i18next';
import { Maximize, Minimize, Settings } from 'lucide-react';
import { EventMontageGridControls } from '../events/EventMontageGridControls';
import { AnalysisFramesToggle } from '../monitors/AnalysisFramesToggle';
import { NinjiiToolbarButton } from '../assistant/NinjiiToolbarButton';
import { Button } from '../ui/button';
import { GroupByServerToggle } from '../profiles/GroupByServerToggle';

interface LiveActivityHeaderProps {
  gridCols: number;
  customCols: string;
  isCustomGridDialogOpen: boolean;
  onApplyGridLayout: (cols: number) => void;
  onCustomColsChange: (value: string) => void;
  onCustomGridDialogOpenChange: (open: boolean) => void;
  onCustomGridSubmit: () => void;
  onEnterFullscreen: () => void;
  onOpenSettings: () => void;
}

export function LiveActivityHeader({
  gridCols,
  customCols,
  isCustomGridDialogOpen,
  onApplyGridLayout,
  onCustomColsChange,
  onCustomGridDialogOpenChange,
  onCustomGridSubmit,
  onEnterFullscreen,
  onOpenSettings,
}: LiveActivityHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h1 className="text-lg font-semibold min-w-0 truncate" title={t('live_activity.title')}>
        {t('live_activity.title')}
      </h1>
      <div className="flex items-center gap-1">
        <GroupByServerToggle setting="monitorsGroupByServer" testId="live-activity-group-by-server" />
        <EventMontageGridControls
          gridCols={gridCols}
          customCols={customCols}
          isCustomGridDialogOpen={isCustomGridDialogOpen}
          onApplyGridLayout={onApplyGridLayout}
          onCustomColsChange={onCustomColsChange}
          onCustomGridDialogOpenChange={onCustomGridDialogOpenChange}
          onCustomGridSubmit={onCustomGridSubmit}
        />
        <NinjiiToolbarButton />
        <AnalysisFramesToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={onEnterFullscreen}
          title={t('live_activity.fullscreen')}
          aria-label={t('live_activity.fullscreen')}
          data-testid="live-activity-fullscreen-btn"
        >
          <Maximize className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          title={t('live_activity.settings_title')}
          aria-label={t('live_activity.settings_title')}
          data-testid="live-activity-settings-btn"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function LiveActivityFullscreenBar({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-2 h-9 px-3 pt-[var(--sai-top,env(safe-area-inset-top))] bg-black/50 backdrop-blur-sm shrink-0">
      <span className="text-white/70 font-medium text-xs min-w-0 truncate">
        {t('live_activity.title')}
      </span>
      <Button
        onClick={onExit}
        variant="ghost"
        size="icon"
        className="text-white/70 hover:text-white hover:bg-white/10 h-7 w-7"
        title={t('live_activity.exit_fullscreen')}
        aria-label={t('live_activity.exit_fullscreen')}
        data-testid="live-activity-exit-fullscreen-btn"
      >
        <Minimize className="h-4 w-4" />
      </Button>
    </div>
  );
}
