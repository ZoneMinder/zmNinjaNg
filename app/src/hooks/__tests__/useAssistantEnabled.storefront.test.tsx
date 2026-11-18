/**
 * China mainland requires a filed model for any AI chatbot, and we have none,
 * so the assistant is off on the China App Store storefront (refs #587).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { asProfileId } from '../../api/types';

const countryCode = vi.fn();

vi.mock('../../lib/platform', () => ({ Platform: { isNative: true, isIOS: true } }));
vi.mock('../../plugins/storefront', () => ({ Storefront: { getCountryCode: () => countryCode() } }));
vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));
vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn(),
  getSecureValue: vi.fn(),
  removeSecureValue: vi.fn(),
}));

async function enabledOn(storefront: string | null) {
  vi.resetModules();
  countryCode.mockResolvedValue({ countryCode: storefront });
  const { useAssistantEnabled: hook } = await import('../useAssistantEnabled');
  const { useProfileStore: profiles } = await import('../../stores/profile');
  const { useSettingsStore: settings } = await import('../../stores/settings');
  profiles.setState({
    profiles: [{ id: asProfileId('p1'), name: 'Home', apiUrl: 'http://h', portalUrl: 'http://h', cgiUrl: 'http://h/cgi-bin', isDefault: false, createdAt: 1 }],
    virtualProfiles: [],
    currentProfileId: asProfileId('p1'),
    isInitialized: true,
  });
  act(() => settings.getState().updateProfileSettings(asProfileId('p1'), { assistantEnabled: true }));
  const { result } = renderHook(() => hook());
  await waitFor(() => expect(countryCode).toHaveBeenCalled());
  await act(async () => {});
  return result.current.enabled;
}

describe('assistant on the China mainland storefront', () => {
  beforeEach(() => {
    countryCode.mockReset();
  });

  it('is off on the China storefront even when turned on', async () => {
    expect(await enabledOn('CHN')).toBe(false);
  });

  it('stays on for other storefronts', async () => {
    expect(await enabledOn('USA')).toBe(true);
  });

  it('stays on when there is no storefront (no App Store account)', async () => {
    expect(await enabledOn(null)).toBe(true);
  });
});
