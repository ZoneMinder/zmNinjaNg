import { useEffect } from 'react';
import { Platform } from '../lib/platform';
import { useCurrentProfile } from './useCurrentProfile';
import { log, LogLevel } from '../lib/logger';
import { AUTO_RESTART_MIN_MINUTES } from '../lib/zmninja-ng-constants';

/**
 * Desktop only: when enabled, restart the app after the configured interval to
 * release WebKit's process-level memory (decoded frames, allocator high-water)
 * that no in-process flush reclaims. The restart preserves window size/position
 * via tauri-plugin-window-state. refs #150
 */
export function useAutoRestart(): void {
  const { settings } = useCurrentProfile();
  const enabled = settings.autoRestartEnabled;
  const minutes = settings.autoRestartIntervalMinutes;

  useEffect(() => {
    if (!Platform.isTauri || !enabled) return;
    // Clamp to the minimum so a stray tiny value can't put the app in a
    // restart storm. refs #150
    const safeMinutes = Number.isFinite(minutes)
      ? Math.max(AUTO_RESTART_MIN_MINUTES, minutes)
      : AUTO_RESTART_MIN_MINUTES;

    const id = setTimeout(() => {
      log.app(`Auto-restart after ${safeMinutes} min to release memory`, LogLevel.INFO);
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('restart_app'));
    }, safeMinutes * 60 * 1000);

    return () => clearTimeout(id);
  }, [enabled, minutes]);
}
