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
  type EventContextScope,
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
 * Every knob here is a primitive assigned onto the already-fresh `merged`, so
 * repeated merges of one persisted value produce equal values and the
 * `useShallow` readers compare them equal. Nothing to cache. A nested object
 * added to this slice would need `coerceEventContext`'s treatment instead.
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
}

export const DEFAULT_EVENT_CONTEXT: EventContextSettings = {
  windowMinutes: EVENT_CONTEXT.defaultWindowMinutes,
  scope: 'all',
};

/** Every repair this module has already made, keyed by the persisted object it
 *  was made from, so the same stored value always resolves to the same
 *  repaired object.
 *
 *  `getProfileSettings` merges on every read and the panel reads the result
 *  through `useShallow`, so a repair that allocates each time hands the
 *  shallow compare a new nested identity every call and `useSyncExternalStore`
 *  re-renders until React throws "Maximum update depth exceeded". Keeping the
 *  persisted identity when nothing needs correcting is not enough on its own:
 *  any profile written before a field existed fails that check forever, which
 *  is how adding a field to this shape once reopened the bug a narrow fix had
 *  already closed (refs #494). Caching the repair closes it for whatever
 *  field comes next.
 *
 *  A WeakMap, not a Map: the keys are settings blobs belonging to stores that
 *  come and go with profiles, and nothing here should keep one alive. */
const REPAIRED_EVENT_CONTEXT = new WeakMap<object, EventContextSettings>();

/** Brings a persisted `eventContext` back inside what the UI can express: an
 *  offered window and a scope the panel has a segment for. Persisted settings
 *  are a trust boundary (I1), so the value may be half-written, from a build
 *  with different choices, or not an object at all. An unknown key such as a
 *  retired `view` is left on the object untouched: a leftover key is
 *  harmless, since nothing reads it.
 *
 *  Returns the persisted object untouched when it is already valid, and
 *  otherwise the one repaired object for that persisted value. Either way the
 *  identity is stable across merges; see `REPAIRED_EVENT_CONTEXT`. */
export function coerceEventContext(
  merged: { eventContext: EventContextSettings },
  defaults: { eventContext: EventContextSettings }
): void {
  const raw = merged.eventContext ?? defaults.eventContext;
  const windowOffered = (EVENT_CONTEXT.windowChoices as readonly number[]).includes(raw.windowMinutes);
  const scopeKnown = EVENT_CONTEXT_SCOPES.includes(raw.scope);
  if (raw === merged.eventContext && windowOffered && scopeKnown) return;

  // A hand-edited blob can hold a string or a number here, which no WeakMap
  // will take as a key. Those all repair to the same thing, so file them
  // under the defaults.
  const key: object = typeof raw === 'object' ? raw : defaults.eventContext;
  const cached = REPAIRED_EVENT_CONTEXT.get(key);
  if (cached) {
    merged.eventContext = cached;
    return;
  }

  const repaired: EventContextSettings = {
    windowMinutes: windowOffered ? raw.windowMinutes : defaults.eventContext.windowMinutes,
    scope: scopeKnown ? raw.scope : defaults.eventContext.scope,
  };
  REPAIRED_EVENT_CONTEXT.set(key, repaired);
  merged.eventContext = repaired;
}
