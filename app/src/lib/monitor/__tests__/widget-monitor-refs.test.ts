/**
 * Tests for reading and writing an aggregate dashboard widget's monitor
 * picks (refs #529).
 */

import { describe, it, expect } from 'vitest';
import { widgetMonitorRefs, withMonitorRefs } from '../widget-monitor-refs';
import { asProfileId } from '../../../api/types';

const A = asProfileId('profile-a');
const B = asProfileId('profile-b');

describe('widgetMonitorRefs', () => {
  it('returns the stored refs of a widget saved in the new shape', () => {
    const refs = [{ profileId: A, monitorId: '1' }, { profileId: B, monitorId: '1' }];
    expect(widgetMonitorRefs({ monitorRefs: refs }, A)).toBe(refs);
  });

  it('pins a legacy widget\'s bare ids to its stored profile', () => {
    expect(widgetMonitorRefs({ profileId: B, monitorIds: ['3', '4'] }, A)).toEqual([
      { profileId: B, monitorId: '3' },
      { profileId: B, monitorId: '4' },
    ]);
  });

  it('pins a legacy single-monitor id to the fallback profile when none was stored', () => {
    expect(widgetMonitorRefs({ monitorId: '5' }, A)).toEqual([{ profileId: A, monitorId: '5' }]);
  });

  it('reads nothing from bare ids with no owning profile to pin them to', () => {
    expect(widgetMonitorRefs({ monitorIds: ['1'] })).toEqual([]);
  });

  it('returns the same array for the same settings object', () => {
    const settings = { profileId: B, monitorIds: ['3'] };
    expect(widgetMonitorRefs(settings, A)).toBe(widgetMonitorRefs(settings, A));
  });
});

describe('withMonitorRefs', () => {
  it('writes the refs and drops the legacy keys', () => {
    const refs = [{ profileId: A, monitorId: '1' }];
    expect(withMonitorRefs({ profileId: B, monitorIds: ['3'], monitorId: '3', feedFit: 'cover' }, refs))
      .toEqual({ monitorRefs: refs, feedFit: 'cover' });
  });
});
