/**
 * Shared date/time formatting utility.
 *
 * All user-facing date/time display should use these functions
 * to respect the user's chosen format from Settings.
 */

import { format as dateFnsFormat } from 'date-fns';
import { log, LogLevel } from './logger';

// The presets are declared here rather than in stores/settings, so this module
// does not depend on the store that stores its output (refs #281).
export type DateFormatPreset = 'MMM d, yyyy' | 'MMM d' | 'dd/MM/yyyy' | 'dd/MM' | 'custom';
export type TimeFormatPreset = '12h' | '24h' | 'custom';

export interface FormatSettings {
  dateFormat: DateFormatPreset;
  timeFormat: TimeFormatPreset;
  customDateFormat: string;
  customTimeFormat: string;
}

/** Resolve the date-fns format string for dates */
function resolveDatePattern(s: FormatSettings): string {
  if (s.dateFormat === 'custom') return s.customDateFormat || 'MMM d';
  return s.dateFormat || 'MMM d';
}

/** Resolve the date-fns format string for times */
function resolveTimePattern(s: FormatSettings): string {
  if (s.timeFormat === 'custom') return s.customTimeFormat || 'h:mm a';
  return (s.timeFormat || '12h') === '12h' ? 'h:mm:ss a' : 'HH:mm:ss';
}

/** Resolve time pattern without seconds */
function resolveTimePatternShort(s: FormatSettings): string {
  if (s.timeFormat === 'custom') return s.customTimeFormat || 'h:mm a';
  return (s.timeFormat || '12h') === '12h' ? 'h:mm a' : 'HH:mm';
}

/** Format a date (no time) according to user settings */
export function formatAppDate(date: Date, settings: FormatSettings): string {
  try {
    return dateFnsFormat(date, resolveDatePattern(settings));
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'MMM d');
  }
}

/**
 * Format a short weekday name (e.g. "Mon").
 *
 * Weekday has no user-facing format preset, so this routes through the same
 * date-fns layer as the other helpers to keep weekday labels consistent with
 * the rest of the app rather than diverging on locale. The pattern is fixed,
 * so no per-setting fallback is needed.
 */
export function formatAppWeekday(date: Date): string {
  return dateFnsFormat(date, 'EEE');
}

/** Format time only (with seconds) according to user settings */
export function formatAppTime(date: Date, settings: FormatSettings): string {
  try {
    return dateFnsFormat(date, resolveTimePattern(settings));
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'HH:mm:ss');
  }
}

/** Format time only (without seconds) according to user settings */
export function formatAppTimeShort(date: Date, settings: FormatSettings): string {
  try {
    return dateFnsFormat(date, resolveTimePatternShort(settings));
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'HH:mm');
  }
}

/** Format date + time according to user settings */
export function formatAppDateTime(date: Date, settings: FormatSettings): string {
  try {
    const d = resolveDatePattern(settings);
    const t = resolveTimePattern(settings);
    return dateFnsFormat(date, `${d}, ${t}`);
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'MMM d, HH:mm:ss');
  }
}

/** Format date + time (short, no seconds) according to user settings */
export function formatAppDateTimeShort(date: Date, settings: FormatSettings): string {
  try {
    const d = resolveDatePattern(settings);
    const t = resolveTimePatternShort(settings);
    return dateFnsFormat(date, `${d}, ${t}`);
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'MMM d, HH:mm');
  }
}

/**
 * How long something has been running, as a stopwatch reading: `0:42`,
 * `4:07`, `1:02:33`.
 *
 * Digits and colons only, so it needs no translation and stays narrow enough
 * for a 320px live tile, which is what rules out date-fns' `formatDuration`
 * ("about 4 minutes"). The hours field appears only once there are hours, so
 * the common case is three characters wide.
 */
export function formatElapsedShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours === 0) return `${minutes}:${paddedSeconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
}

/**
 * An event length as "30s", "1.5m" or "1.5hr": the largest unit that fits,
 * with at most one decimal. Untranslated, like the other short duration
 * labels on event rows.
 */
export function formatCompactDuration(seconds: number): string {
  const s = Math.max(0, seconds) || 0;
  const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${oneDecimal(s / 60)}m`;
  return `${oneDecimal(s / 3600)}hr`;
}

/**
 * Validate a custom format string.
 * Returns the formatted preview string, or null if invalid.
 */
export function validateFormatString(pattern: string | undefined | null): string | null {
  if (!pattern || !pattern.trim()) return null;
  try {
    return dateFnsFormat(new Date(), pattern);
  } catch (error) {
    log.time('Format validation failed', LogLevel.DEBUG, { pattern, error });
    return null;
  }
}
