import { EVENTS_AUTO_REFRESH } from '../zmninja-ng-constants';

/** A persisted auto-refresh interval in bounds: 0 (off) or whole seconds
 *  between the floor and the cap. Anything else from storage is off. */
export function clampAutoRefreshSeconds(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(EVENTS_AUTO_REFRESH.maxSeconds, Math.max(EVENTS_AUTO_REFRESH.minSeconds, Math.round(value)));
}
