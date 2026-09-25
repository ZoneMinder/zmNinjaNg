/**
 * Tests for pruning references to monitors ZoneMinder no longer has
 * (refs #323, #324).
 */

import { describe, it, expect } from 'vitest';
import {
  pruneAggregateWidgetMonitorRefs,
  pruneAllBucketMonitorIds,
  pruneProfileSettingsMonitorIds,
  pruneWidgetMonitorIds,
} from '../prune-deleted-monitors';
import { DEFAULT_MONTAGE_GROUP_LAYOUT } from '../../../stores/settings';
import type { DashboardWidget } from '../../../stores/dashboard';
import { asProfileId } from '../../../api/types';

const KNOWN = new Set(['1', '2']);

function montageBucket(overrides: Partial<typeof DEFAULT_MONTAGE_GROUP_LAYOUT>) {
  return { ...DEFAULT_MONTAGE_GROUP_LAYOUT, ...overrides };
}

function monitorWidget(settings: DashboardWidget['settings']): DashboardWidget {
  return {
    id: 'w1',
    type: 'monitor',
    settings,
    layout: { i: 'w1', x: 0, y: 0, w: 4, h: 4 },
  };
}

describe('pruneProfileSettingsMonitorIds', () => {
  it('drops a hidden monitor that no longer exists so the hidden count matches reality', () => {
    const patch = pruneProfileSettingsMonitorIds({ excludedMonitorIds: ['1', '99'] }, KNOWN);

    expect(patch?.excludedMonitorIds).toEqual(['1']);
  });

  it('keeps every id when all of them still exist', () => {
    expect(pruneProfileSettingsMonitorIds({ excludedMonitorIds: ['1', '2'] }, KNOWN)).toBeNull();
  });

  it('drops deleted monitors from a montage group without touching the survivors', () => {
    const patch = pruneProfileSettingsMonitorIds(
      {
        montageByGroup: {
          all: montageBucket({
            hiddenMonitorIds: ['2', '99'],
            workingLayout: [
              { i: '1', x: 0, y: 0, w: 6, h: 6 },
              { i: '99', x: 6, y: 0, w: 6, h: 6 },
            ],
          }),
        },
      },
      KNOWN
    );

    expect(patch?.montageByGroup?.all.hiddenMonitorIds).toEqual(['2']);
    expect(patch?.montageByGroup?.all.workingLayout.map((l) => l.i)).toEqual(['1']);
  });

  it('leaves named saved layouts alone: they are user artifacts, not live state', () => {
    const saved = [
      { name: 'Front', layout: [{ i: '99', x: 0, y: 0, w: 6, h: 6 }], displayCols: 2 },
    ];
    const patch = pruneProfileSettingsMonitorIds(
      { montageByGroup: { all: montageBucket({ hiddenMonitorIds: ['99'], savedLayouts: saved }) } },
      KNOWN
    );

    expect(patch?.montageByGroup?.all.savedLayouts).toEqual(saved);
  });

  it('reports no change when a montage group holds only live monitors', () => {
    const patch = pruneProfileSettingsMonitorIds(
      { montageByGroup: { all: montageBucket({ hiddenMonitorIds: ['1'] }) } },
      KNOWN
    );

    expect(patch).toBeNull();
  });
});

describe('pruneAllBucketMonitorIds', () => {
  it('leaves a bare id alone: it predates All mode and names no owning server', () => {
    // The caller knows p1's monitors, and '99' is not among them - but nothing
    // says this id was ever p1's, so deleting it would be a guess.
    const patch = pruneAllBucketMonitorIds(
      { montageByGroup: { all: montageBucket({ hiddenMonitorIds: ['99'] }) } },
      'p1',
      KNOWN
    );

    expect(patch).toBeNull();
  });

  it('does not treat a profile id that merely starts the same as its own', () => {
    // 'p1' must not claim 'p10:99'. String prefixes are how ownership is read
    // here, and the separator is what makes that safe.
    const patch = pruneAllBucketMonitorIds(
      { montageByGroup: { all: montageBucket({ hiddenMonitorIds: ['p10:99'] }) } },
      'p1',
      KNOWN
    );

    expect(patch).toBeNull();
  });
});

describe('pruneWidgetMonitorIds', () => {
  it('drops a deleted monitor from a widget display order', () => {
    const updates = pruneWidgetMonitorIds([monitorWidget({ monitorIds: ['1', '99', '2'] })], KNOWN);

    expect(updates).toEqual([{ id: 'w1', settings: { monitorIds: ['1', '2'] } }]);
  });

  it('clears a single-monitor widget whose monitor is gone', () => {
    const updates = pruneWidgetMonitorIds([monitorWidget({ monitorId: '99' })], KNOWN);

    expect(updates[0].settings.monitorId).toBeUndefined();
  });

  it('leaves widgets that reference only live monitors untouched', () => {
    expect(pruneWidgetMonitorIds([monitorWidget({ monitorIds: ['1'], monitorId: '2' })], KNOWN))
      .toEqual([]);
  });

  it('keeps the rest of a widget settings object intact', () => {
    const updates = pruneWidgetMonitorIds(
      [monitorWidget({ monitorIds: ['99'], feedFit: 'cover', eventCount: 5 })],
      KNOWN
    );

    expect(updates[0].settings).toEqual({ monitorIds: [], feedFit: 'cover', eventCount: 5 });
  });
});

describe('pruneAggregateWidgetMonitorRefs', () => {
  const A = asProfileId('profile-a');
  const B = asProfileId('profile-b');

  it("drops this profile's deleted picks and keeps another server's pick with the same id", () => {
    const updates = pruneAggregateWidgetMonitorRefs(
      [monitorWidget({ monitorRefs: [{ profileId: A, monitorId: '1' }, { profileId: A, monitorId: '99' }, { profileId: B, monitorId: '99' }] })],
      A,
      KNOWN
    );

    expect(updates).toEqual([{
      id: 'w1',
      settings: { monitorRefs: [{ profileId: A, monitorId: '1' }, { profileId: B, monitorId: '99' }] },
    }]);
  });

  it('prunes a legacy widget pinned to this profile and rewrites it in the new shape', () => {
    const updates = pruneAggregateWidgetMonitorRefs(
      [monitorWidget({ profileId: A, monitorIds: ['1', '99'], feedFit: 'cover' })],
      A,
      KNOWN
    );

    expect(updates).toEqual([{
      id: 'w1',
      settings: { monitorRefs: [{ profileId: A, monitorId: '1' }], feedFit: 'cover' },
    }]);
  });

  it("leaves a legacy widget pinned to another profile alone", () => {
    expect(pruneAggregateWidgetMonitorRefs([monitorWidget({ profileId: B, monitorIds: ['99'] })], A, KNOWN))
      .toEqual([]);
  });
});
