/**
 * Timeline "Event Cause" filter.
 *
 * Most options map straight to a ZoneMinder Cause value (Continuous, Signal,
 * Forced). MOTION_CAUSE is a pseudo-cause: continuous-recording setups
 * (Mocord/Record) write "Motion: <zones>" into the event Notes field, so motion
 * activity is matched on Notes rather than the Cause field. CAUSE_ALL is the
 * no-filter sentinel; it exists because Radix Select items cannot use an
 * empty-string value, while the stored filter uses '' for "no filter".
 */

import type { EventData } from '../api/types';
import type { EventFilters } from '../api/events';

export const CAUSE_ALL = 'all';
export const MOTION_CAUSE = 'motion_detected';

const MOTION_NOTES_REGEXP = 'Motion:';
const DETECTED_NOTES_REGEXP = 'detected:';

export interface CauseOption {
  /** Stored value: CAUSE_ALL clears the filter, MOTION_CAUSE filters Notes, others are ZM Cause values. */
  value: string;
  /** i18n key (under the `timeline` namespace) for the option label. */
  labelKey: string;
}

export const TIMELINE_CAUSE_OPTIONS: CauseOption[] = [
  { value: CAUSE_ALL, labelKey: 'timeline.cause_all' },
  { value: MOTION_CAUSE, labelKey: 'timeline.cause_motion' },
  { value: 'Continuous', labelKey: 'timeline.cause_continuous' },
  { value: 'Signal', labelKey: 'timeline.cause_signal' },
  { value: 'Forced', labelKey: 'timeline.cause_forced' },
];

/** A stored causeFilter value narrows results only when it is neither empty nor CAUSE_ALL. */
export function isCauseActive(causeFilter: string): boolean {
  return causeFilter !== '' && causeFilter !== CAUSE_ALL;
}

/**
 * Translate the selected cause filter and the object-detection toggle into
 * getEvents() Notes/Cause fields. Motion is Notes-based and ignores the
 * detected-objects toggle; every other cause uses the Cause field and still
 * honors the toggle.
 */
export function causeToEventFilter(
  causeFilter: string,
  onlyDetectedObjects: boolean,
): Pick<EventFilters, 'notesRegexp' | 'cause'> {
  if (causeFilter === MOTION_CAUSE) {
    return { notesRegexp: MOTION_NOTES_REGEXP, cause: undefined };
  }
  return {
    notesRegexp: onlyDetectedObjects ? DETECTED_NOTES_REGEXP : undefined,
    cause: isCauseActive(causeFilter) ? causeFilter : undefined,
  };
}

/**
 * Merge per-monitor event lists into one stream: dedupe by Event.Id and sort by
 * StartDateTime descending, so a fanned-out query matches a single sorted query.
 */
export function mergeMonitorEvents(lists: EventData[][]): EventData[] {
  const byId = new Map<string, EventData>();
  for (const list of lists) {
    for (const event of list) {
      byId.set(event.Event.Id, event);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    (b.Event.StartDateTime ?? '').localeCompare(a.Event.StartDateTime ?? ''),
  );
}
