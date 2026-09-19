import { describe, it, expect } from 'vitest';
import {
  eventContextWindow,
  parseLinkedMonitorIds,
  groupMonitorIds,
  resolveScopeMonitorIds,
} from '../event-context';
import type { EventData } from '../../../api/types';

const anchor = (over: Partial<EventData['Event']> = {}): EventData =>
  ({
    Event: {
      Id: '406',
      MonitorId: '3',
      StartDateTime: '2026-09-17 21:14:03',
      EndDateTime: '2026-09-17 21:14:41',
      Length: '38.00',
      ...over,
    },
  }) as EventData;

describe('eventContextWindow', () => {
  it('spans the anchor start minus N to the anchor end plus N', () => {
    const w = eventContextWindow(anchor(), 15, 'UTC');
    expect(w.startDateTime).toBe('2026-09-17 20:59:03');
    expect(w.endDateTime).toBe('2026-09-17 21:29:41');
  });

  it('measures the window in the profile timezone, not the browser one', () => {
    const utc = eventContextWindow(anchor(), 15, 'UTC');
    const ny = eventContextWindow(anchor(), 15, 'America/New_York');
    expect(ny.startDateTime).toBe(utc.startDateTime);
    expect(ny.anchorMs - utc.anchorMs).toBe(4 * 60 * 60 * 1000);
  });

  it('extends past a long anchor event instead of clipping its tail', () => {
    const long = anchor({ EndDateTime: '2026-09-17 21:44:03', Length: '1800.00' });
    expect(eventContextWindow(long, 5, 'UTC').endDateTime).toBe('2026-09-17 21:49:03');
  });

  it('falls back to start plus Length when the server reports no end', () => {
    const open = anchor({ EndDateTime: null });
    expect(eventContextWindow(open, 1, 'UTC').endDateTime).toBe('2026-09-17 21:15:41');
  });
});

describe('parseLinkedMonitorIds', () => {
  it('reads a comma separated id list', () => {
    expect(parseLinkedMonitorIds('2,5,9')).toEqual(['2', '5', '9']);
  });

  it('tolerates spacing and prefixed tokens ZoneMinder writes', () => {
    expect(parseLinkedMonitorIds(' 2 , Monitor:5 ,,9 ')).toEqual(['2', '5', '9']);
  });

  it('treats an empty, null or unreadable field as no links', () => {
    expect(parseLinkedMonitorIds('')).toEqual([]);
    expect(parseLinkedMonitorIds(null)).toEqual([]);
    expect(parseLinkedMonitorIds('none')).toEqual([]);
  });
});

describe('groupMonitorIds', () => {
  const groups = [
    { Group: { Id: '1', Name: 'Outside' }, Monitor: [{ Id: '3' }, { Id: '4' }] },
    { Group: { Id: '2', Name: 'Inside' }, Monitor: [{ Id: '7' }] },
    { Group: { Id: '3', Name: 'Front' }, Monitor: [{ Id: '3' }, { Id: '9' }] },
  ] as unknown as Parameters<typeof groupMonitorIds>[0];

  it('unions every group the monitor belongs to, including itself', () => {
    expect(groupMonitorIds(groups, '3')).toEqual(['3', '4', '9']);
  });

  it('returns nothing for a monitor in no group', () => {
    expect(groupMonitorIds(groups, '11')).toEqual([]);
  });

  it('returns nothing when groups have not loaded', () => {
    expect(groupMonitorIds(undefined, '3')).toEqual([]);
  });
});

describe('resolveScopeMonitorIds', () => {
  it('drops the monitor filter entirely for the all scope', () => {
    expect(resolveScopeMonitorIds('all', { linked: ['2'], group: ['3'] })).toBeUndefined();
  });

  it('includes the anchor monitor with its linked cameras', () => {
    expect(resolveScopeMonitorIds('linked', { linked: ['3', '2'], group: [] })).toEqual(['3', '2']);
  });

  it('falls back to every camera when the list would blow the URL cap', () => {
    const many = Array.from({ length: 41 }, (_, i) => String(i + 1));
    expect(resolveScopeMonitorIds('group', { linked: [], group: many })).toBeUndefined();
  });

  it('falls back to every camera when the scope resolves to nothing', () => {
    expect(resolveScopeMonitorIds('linked', { linked: [], group: [] })).toBeUndefined();
  });
});
