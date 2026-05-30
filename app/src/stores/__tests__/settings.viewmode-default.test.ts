import { describe, it, expect } from 'vitest';
import { getDefaultViewMode, DEFAULT_SETTINGS, useSettingsStore } from '../settings';

describe('default view mode', () => {
  it('returns snapshot on every platform', () => {
    expect(getDefaultViewMode()).toBe('snapshot');
  });

  it('preserves an explicitly stored viewMode', () => {
    useSettingsStore.setState({
      profileSettings: { p1: { ...DEFAULT_SETTINGS, viewMode: 'streaming' } },
    });
    const resolved = useSettingsStore.getState().getProfileSettings('p1');
    expect(resolved.viewMode).toBe('streaming');
  });
});
