/**
 * Coercions for the All-mode performance knobs.
 *
 * Split out of `settings.ts` to keep that file near the 400-line guidance
 * (C2); it is not a second entry point. `mergeProfileSettings` remains the
 * only caller and the only place a profile's settings are resolved, so the
 * Settings contract's "every coercion lives in the merge" still holds.
 *
 * Nothing here imports `settings.ts`, not even a type: the import runs the
 * other way and the module graph has to stay acyclic (`no-circular-deps`).
 * The shape below and the `defaults` argument are how that is paid for -
 * the same trade the date-format and thumbnail-chain types already make.
 */

import {
  ALL_MODE_PERFORMANCE,
  EVENT_CONTEXT,
  EVENT_CONTEXT_SCOPES,
  EVENT_CONTEXT_VIEWS,
  type EventContextScope,
  type EventContextView,
} from '../lib/zmninja-ng-constants';

/** All mode only: how much each aggregated tile's stream is dialed back.
 *  'off' streams exactly as single mode does; 'reduced' trades frame rate and
 *  scale for the bandwidth of running many servers at once. */
export type AllModeStreamTuning = 'off' | 'reduced';
export const ALL_MODE_STREAM_TUNING_VALUES: readonly AllModeStreamTuning[] = ['off', 'reduced'] as const;

/** The slice of `ProfileSettings` this module reads and writes. */
export interface AllModePerformanceSettings {
  allModeMaxStreams: number;
  allModeMaxWatched: number;
  allModePollFloorSeconds: number;
  allModeBurstSeconds: number;
  allModeIdleMinutes: number;
  allModeStreamTuning: AllModeStreamTuning;
  allModePauseHidden: boolean;
  allModeViewportGating: boolean;
}

/** Clamps one persisted numeric setting into its editable range, falling back
 *  to the shipped default for anything that is not a finite number. Counts and
 *  whole-second/minute windows only, hence the rounding. */
function clampSetting(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Brings every All-mode performance knob back inside its bounds, in place.
 *
 * These are read straight off persisted storage, which is a trust boundary
 * (I1): the settings blob survives app upgrades, is editable by hand, and a
 * value from a build where a bound was wider would otherwise reach the
 * consumer unchecked. Each consumer gets to treat its setting as already
 * valid because this runs on every read, imperative and reactive alike.
 *
 * @param defaults - the shipped defaults, passed in rather than imported (see
 *                   the module comment).
 */
export function coerceAllModePerformance(
  merged: AllModePerformanceSettings,
  defaults: AllModePerformanceSettings
): void {
  merged.allModeMaxStreams = clampSetting(
    merged.allModeMaxStreams,
    ALL_MODE_PERFORMANCE.minStreams,
    ALL_MODE_PERFORMANCE.maxStreams,
    defaults.allModeMaxStreams
  );
  merged.allModeMaxWatched = clampSetting(
    merged.allModeMaxWatched,
    ALL_MODE_PERFORMANCE.minWatched,
    ALL_MODE_PERFORMANCE.maxWatched,
    defaults.allModeMaxWatched
  );
  merged.allModePollFloorSeconds = clampSetting(
    merged.allModePollFloorSeconds,
    ALL_MODE_PERFORMANCE.minPollFloorSeconds,
    ALL_MODE_PERFORMANCE.maxPollFloorSeconds,
    defaults.allModePollFloorSeconds
  );
  merged.allModeBurstSeconds = clampSetting(
    merged.allModeBurstSeconds,
    ALL_MODE_PERFORMANCE.minBurstSeconds,
    ALL_MODE_PERFORMANCE.maxBurstSeconds,
    defaults.allModeBurstSeconds
  );
  merged.allModeIdleMinutes = clampSetting(
    merged.allModeIdleMinutes,
    ALL_MODE_PERFORMANCE.minIdleMinutes,
    ALL_MODE_PERFORMANCE.maxIdleMinutes,
    defaults.allModeIdleMinutes
  );
  if (!ALL_MODE_STREAM_TUNING_VALUES.includes(merged.allModeStreamTuning)) {
    merged.allModeStreamTuning = defaults.allModeStreamTuning;
  }
  if (typeof merged.allModePauseHidden !== 'boolean') {
    merged.allModePauseHidden = defaults.allModePauseHidden;
  }
  if (typeof merged.allModeViewportGating !== 'boolean') {
    merged.allModeViewportGating = defaults.allModeViewportGating;
  }
}

export interface EventContextSettings {
  windowMinutes: number;
  scope: EventContextScope;
  view: EventContextView;
}

export const DEFAULT_EVENT_CONTEXT: EventContextSettings = {
  windowMinutes: EVENT_CONTEXT.defaultWindowMinutes,
  scope: 'all',
  view: 'list',
};

/** Brings a persisted `eventContext` back inside what the UI can express: an
 *  offered window and a scope the panel has a segment for.
 *
 *  Reallocates only when a field actually needed correcting, and keeps the
 *  persisted object's identity otherwise: `getProfileSettings` runs this on
 *  every read, and a fresh object each time would defeat the `useShallow`
 *  selectors that read it (the same reason `fillHoverPreviewSurfaces` writes
 *  `hoverPreview` once at migration instead of every merge). */
export function coerceEventContext(
  merged: { eventContext: EventContextSettings },
  defaults: { eventContext: EventContextSettings }
): void {
  const raw = merged.eventContext ?? defaults.eventContext;
  const windowOffered = (EVENT_CONTEXT.windowChoices as readonly number[]).includes(raw.windowMinutes);
  const scopeKnown = EVENT_CONTEXT_SCOPES.includes(raw.scope);
  const viewKnown = EVENT_CONTEXT_VIEWS.includes(raw.view);
  if (raw === merged.eventContext && windowOffered && scopeKnown && viewKnown) return;
  merged.eventContext = {
    windowMinutes: windowOffered ? raw.windowMinutes : defaults.eventContext.windowMinutes,
    scope: scopeKnown ? raw.scope : defaults.eventContext.scope,
    view: viewKnown ? raw.view : defaults.eventContext.view,
  };
}
