import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from '../../lib/platform';
import { getDefaultViewMode, DEFAULT_SETTINGS, useSettingsStore } from '../settings';

describe('default view mode by platform', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns streaming on Tauri desktop', () => {
    vi.spyOn(Platform, 'isTauri', 'get').mockReturnValue(true);
    expect(getDefaultViewMode()).toBe('streaming');
  });

  it('returns snapshot off Tauri (web/mobile)', () => {
    vi.spyOn(Platform, 'isTauri', 'get').mockReturnValue(false);
    expect(getDefaultViewMode()).toBe('snapshot');
  });

  it('preserves an explicitly stored viewMode regardless of platform default', () => {
    useSettingsStore.setState({
      profileSettings: { p1: { ...DEFAULT_SETTINGS, viewMode: 'snapshot' } },
    });
    const resolved = useSettingsStore.getState().getProfileSettings('p1');
    expect(resolved.viewMode).toBe('snapshot');
  });
});
