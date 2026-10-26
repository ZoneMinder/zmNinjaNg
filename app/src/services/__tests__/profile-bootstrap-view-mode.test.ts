/**
 * bootstrapViewMode against the real settings store (refs #385).
 *
 * The gate is viewModeChosen, not the bucket and not viewMode: lastRoute or
 * the self-signed flag can create the bucket before the first bootstrap, and
 * every write copies DEFAULT_SETTINGS.viewMode in, which is how the earlier
 * bucket-existence check never fired for a first or self-signed profile.
 * Expected modes here are the non-default one wherever the old gate would
 * have left the default behind, so a regression reads as a failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapViewMode } from '../profile-bootstrap';
import { useSettingsStore } from '../../stores/settings';
import { getMonitors } from '../../api/monitors';
import { asProfileId, type Profile } from '../../api/types';

vi.mock('../../lib/logger', () => ({
  log: { profileService: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));
vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));
const platform = vi.hoisted(() => ({ isNative: false, isElectron: false }));
vi.mock('../../lib/platform', () => ({ Platform: platform }));
vi.mock('../sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sessions')>()),
  getSession: () => ({ client: {} }) as never,
}));

const id = asProfileId('fresh');
const profile = { id, name: 'Fresh', portalUrl: 'https://zm', apiUrl: 'https://zm/api', cgiUrl: 'https://zm/cgi-bin', isDefault: true, createdAt: 0 } as Profile;

const monitorCount = (n: number) =>
  vi.mocked(getMonitors).mockResolvedValue({
    monitors: Array.from({ length: n }, (_, i) => ({ id: String(i + 1) })),
  } as never);

const storedViewMode = () => useSettingsStore.getState().profileSettings[id]?.viewMode;

describe('bootstrapViewMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ profileSettings: {} });
    platform.isNative = false;
    platform.isElectron = false;
  });

  it('starts a fresh profile in the recommended mode and marks it chosen', async () => {
    monitorCount(3);
    await bootstrapViewMode(profile, null);
    expect(storedViewMode()).toBe('streaming');
    expect(useSettingsStore.getState().profileSettings[id]?.viewModeChosen).toBe(true);
  });

  it('still decides when the bucket already holds unrelated keys', async () => {
    useSettingsStore.getState().updateProfileSettings(id, { lastRoute: '/montage', allowSelfSignedCerts: true });
    monitorCount(3);
    await bootstrapViewMode(profile, null);
    expect(storedViewMode()).toBe('streaming');
  });

  it('leaves a chosen viewMode alone', async () => {
    useSettingsStore.getState().updateProfileSettings(id, { viewMode: 'snapshot', viewModeChosen: true });
    monitorCount(2);
    await bootstrapViewMode(profile, null);
    expect(storedViewMode()).toBe('snapshot');
    expect(getMonitors).not.toHaveBeenCalled();
  });

  it('ignores multi-port when the profile force-disables it', async () => {
    useSettingsStore.getState().updateProfileSettings(id, { forceDisableMultiPort: true });
    monitorCount(20);
    await bootstrapViewMode(profile, 31000);
    expect(storedViewMode()).toBe('snapshot');
  });

  it('leaves the mode undecided when the count fails and multi-port is off', async () => {
    vi.mocked(getMonitors).mockRejectedValue(new Error('Network error'));
    await bootstrapViewMode(profile, null);
    expect(storedViewMode()).toBeUndefined();
  });

  it('still picks streaming when the count fails but multi-port is on', async () => {
    vi.mocked(getMonitors).mockRejectedValue(new Error('Network error'));
    await bootstrapViewMode(profile, 31000);
    expect(storedViewMode()).toBe('streaming');
  });

  it('picks streaming for a large server on a native host', async () => {
    platform.isNative = true;
    monitorCount(40);
    await bootstrapViewMode(profile, null);
    expect(storedViewMode()).toBe('streaming');
  });

  it('picks streaming on a desktop host even when the count fails', async () => {
    platform.isElectron = true;
    vi.mocked(getMonitors).mockRejectedValue(new Error('Network error'));
    await bootstrapViewMode(profile, null);
    expect(storedViewMode()).toBe('streaming');
    expect(useSettingsStore.getState().profileSettings[id]?.viewModeChosen).toBe(true);
  });
});
