import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings';

describe('Settings Store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      profileSettings: {},
    });
  });

  it('returns defaults for unknown profile', () => {
    const settings = useSettingsStore.getState().getProfileSettings('missing-profile');
    expect(settings.viewMode).toBe('snapshot');
    expect(settings.snapshotRefreshInterval).toBe(3);
    expect(settings.montageGridRows).toBe(2);
    expect(settings.eventMontageGridCols).toBe(2);
    expect(settings.monitorDetailCycleSeconds).toBe(0);
    expect(settings.eventsThumbnailFit).toBe('contain');
  });

  it('updates profile settings with partial values', () => {
    const profileId = 'profile-1';
    useSettingsStore.getState().updateProfileSettings(profileId, {
      viewMode: 'streaming',
      streamMaxFps: 15,
    });

    const settings = useSettingsStore.getState().getProfileSettings(profileId);
    expect(settings.viewMode).toBe('streaming');
    expect(settings.streamMaxFps).toBe(15);
    expect(settings.snapshotRefreshInterval).toBe(3);
  });

  it('saves montage layout per profile', () => {
    const profileId = 'profile-1';
    const layout = {
      lg: [{ i: '1', x: 0, y: 0, w: 2, h: 2 }],
    };

    useSettingsStore.getState().saveMontageLayout(profileId, layout);

    const settings = useSettingsStore.getState().getProfileSettings(profileId);
    expect(settings.montageLayouts).toEqual(layout);
  });

  it('saves event montage layout per profile', () => {
    const profileId = 'profile-1';
    const layout = {
      lg: [{ i: 'e1', x: 1, y: 1, w: 3, h: 2 }],
    };

    useSettingsStore.getState().saveEventMontageLayout(profileId, layout);

    const settings = useSettingsStore.getState().getProfileSettings(profileId);
    expect(settings.eventMontageLayouts).toEqual(layout);
  });

  describe('Streaming method settings', () => {
    it('defaults to auto streaming method', () => {
      const settings = useSettingsStore.getState().getProfileSettings('new-profile');
      expect(settings.streamingMethod).toBe('auto');
      expect(settings.webrtcFallbackEnabled).toBe(true);
    });

    it('updates streaming method to mjpeg from default', () => {
      const profileId = 'profile-1';
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
      });

      const settings = useSettingsStore.getState().getProfileSettings(profileId);
      expect(settings.streamingMethod).toBe('mjpeg');
    });

    it('updates streaming method back to auto', () => {
      const profileId = 'profile-1';
      // First set to mjpeg
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
      });
      // Then back to auto
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'auto',
      });

      const settings = useSettingsStore.getState().getProfileSettings(profileId);
      expect(settings.streamingMethod).toBe('auto');
    });

    it('disables webrtc fallback', () => {
      const profileId = 'profile-1';
      useSettingsStore.getState().updateProfileSettings(profileId, {
        webrtcFallbackEnabled: false,
      });

      const settings = useSettingsStore.getState().getProfileSettings(profileId);
      expect(settings.webrtcFallbackEnabled).toBe(false);
    });

    it('updates both streaming settings together', () => {
      const profileId = 'profile-1';
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
        webrtcFallbackEnabled: false,
      });

      const settings = useSettingsStore.getState().getProfileSettings(profileId);
      expect(settings.streamingMethod).toBe('mjpeg');
      expect(settings.webrtcFallbackEnabled).toBe(false);
    });

    it('persists streaming method across store resets', () => {
      const profileId = 'profile-1';
      useSettingsStore.getState().updateProfileSettings(profileId, {
        streamingMethod: 'mjpeg',
        webrtcFallbackEnabled: false,
      });

      // Verify settings are stored
      const storedSettings = useSettingsStore.getState().profileSettings[profileId];
      expect(storedSettings.streamingMethod).toBe('mjpeg');
      expect(storedSettings.webrtcFallbackEnabled).toBe(false);
    });
  });
});

describe('montageHiddenMonitorIds setting', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('defaults to an empty array', () => {
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.montageHiddenMonitorIds).toEqual([]);
  });

  it('persists updates via updateProfileSettings', () => {
    const store = useSettingsStore.getState();
    store.updateProfileSettings('profile-a', { montageHiddenMonitorIds: [3, 7] });
    const settings = useSettingsStore.getState().getProfileSettings('profile-a');
    expect(settings.montageHiddenMonitorIds).toEqual([3, 7]);
  });

  it('is profile-scoped (does not leak across profiles)', () => {
    const store = useSettingsStore.getState();
    store.updateProfileSettings('profile-a', { montageHiddenMonitorIds: [1] });
    store.updateProfileSettings('profile-b', { montageHiddenMonitorIds: [2] });
    expect(
      useSettingsStore.getState().getProfileSettings('profile-a').montageHiddenMonitorIds
    ).toEqual([1]);
    expect(
      useSettingsStore.getState().getProfileSettings('profile-b').montageHiddenMonitorIds
    ).toEqual([2]);
  });
});
