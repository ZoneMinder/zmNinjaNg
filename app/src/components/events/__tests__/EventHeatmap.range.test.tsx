/**
 * Regression test (refs #495): a half-typed year in the Events date filter
 * hands the heatmap a range of two thousand years. Bucketing it produced
 * hundreds of thousands of entries, and spreading those into Math.max threw
 * "Maximum call stack size exceeded", which took the whole page down.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventHeatmap } from '../EventHeatmap';
import type { EventData } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { count?: number } | string) => (typeof opts === 'string' ? opts : k) }),
}));
function event(id: string, startDateTime: string): EventData {
  return {
    Event: { Id: id, Name: `Event-${id}`, StartDateTime: startDateTime, Cause: 'Motion', Length: '10', Notes: '' },
  } as EventData;
}

const oneEvent = [{ item: event('1', '2026-06-15 06:00:00'), timezone: 'UTC' }];

describe('EventHeatmap date range guards (refs #495)', () => {
  it('draws nothing for a range too long to bucket instead of crashing', () => {
    render(
      <EventHeatmap
        events={oneEvent}
        startDate={new Date('0002-01-01T00:00:00Z')}
        endDate={new Date('2026-06-16T00:00:00Z')}
        collapsible={false}
        showCard={false}
      />
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('draws nothing when the range runs backwards', () => {
    render(
      <EventHeatmap
        events={oneEvent}
        startDate={new Date('2026-06-16T00:00:00Z')}
        endDate={new Date('2026-06-15T00:00:00Z')}
        collapsible={false}
        showCard={false}
      />
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('draws nothing when a date is unparseable', () => {
    render(
      <EventHeatmap
        events={oneEvent}
        startDate={new Date('not a date')}
        endDate={new Date('2026-06-16T00:00:00Z')}
        collapsible={false}
        showCard={false}
      />
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('still draws a bar per hour for a range it can bucket', () => {
    render(
      <EventHeatmap
        events={oneEvent}
        startDate={new Date('2026-06-15T00:00:00Z')}
        endDate={new Date('2026-06-15T05:00:00Z')}
        collapsible={false}
        showCard={false}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(6);
  });
});
