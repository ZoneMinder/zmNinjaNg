/**
 * Timezone utilities
 */

import { useProfileStore } from '../stores/profile';
import { log, LogLevel } from './logger';

/**
 * Format a date for the ZM API in an EXPLICIT timezone. ZM API expects
 * 'YYYY-MM-DD HH:mm:ss' (space, not T).
 *
 * Used directly by All-mode aggregation fan-outs (useScopedEvents,
 * useScopedTimelineEvents), which convert one shared Date bound per
 * profile using THAT profile's own timezone rather than the globally
 * selected current profile (refs #337) - formatForServer below is now a
 * thin wrapper over this for the single-current-profile case.
 *
 * @param date The local Date object (e.g. from a date picker or 'new Date()')
 * @param timeZone IANA timezone to format into
 * @returns String formatted in the given timezone
 */
export function formatForServerInTz(date: Date, timeZone: string): string {
    // Format: 'yyyy-MM-dd HH:mm:ss' in the TARGET timezone
    // This effectively shifts the time.
    // e.g. If local is 10:00 EST and Server is PST, this returns "07:00:00" string
    // which is what ZM expects if we are querying against its DB time.
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(date).replace(', ', ' ');
    } catch (e) {
        log.time('Timezone conversion failed, falling back to local ISO', LogLevel.WARN, e);
        const pad = (num: number) => num.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
}

/**
 * Resolve a profile's timezone for date-filter conversion, falling back to
 * the BROWSER's own zone when the profile has none set - the historical
 * `formatForServer` fallback. Shared by `formatForServer` and the All-mode
 * aggregation hooks (useScopedEvents, useScopedTimelineEvents) so a
 * timezone-less profile converts date-range filters identically in both
 * single and All mode (refs #337 fix round 1: All mode previously fell back
 * to 'UTC' here, silently shifting the query window for such a profile).
 *
 * Not used for the eventInstant/sort ordering fallback - that one
 * deliberately matches `getSession`'s own 'UTC' convention instead (a
 * different, already-correct concern: a stable sort key, not a
 * user-facing query window).
 */
export function resolveProfileTimezone(timezone: string | null | undefined): string {
    return timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Format a date for the ZM API using the CURRENT profile's timezone.
 * Single-mode call sites (queries scoped to one active profile).
 *
 * @param date The local Date object (e.g. from a date picker or 'new Date()')
 * @returns String formatted in server's timezone
 */
export function formatForServer(date: Date): string {
    // Access primitives directly to avoid deprecated currentProfile() getter
    const { profiles, currentProfileId } = useProfileStore.getState();
    const currentProfile = profiles.find(p => p.id === currentProfileId);
    return formatForServerInTz(date, resolveProfileTimezone(currentProfile?.timezone));
}

/**
 * Format a date for datetime-local input (local timezone).
 * Returns format: YYYY-MM-DDTHH:mm
 *
 * @param date - The date to format
 * @returns String formatted for datetime-local input
 */
export function formatLocalDateTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Same, at seconds precision, for a `datetime-local` input with `step="1"`.
 *
 * Such an input reports seconds back on the first keystroke, so a
 * minute-precision value written into it changes shape mid-edit; React then
 * rewrites the DOM value and the browser drops the segment being typed. That
 * is why, on the Events filter, typing 30 into a preset-populated day landed
 * 03 (refs #495).
 */
export function formatLocalDateTimeSeconds(date: Date): string {
    return `${formatLocalDateTime(date)}:${String(date.getSeconds()).padStart(2, '0')}`;
}
