import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSettings = { tvMode: false };
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    settings: mockSettings,
    currentProfile: { id: 'test' },
  }),
}));

vi.mock('../../lib/platform', () => ({
  Platform: { isNative: false },
}));

describe('useTvMode', () => {
  beforeEach(() => {
    mockSettings.tvMode = false;
  });

  it('returns false when tvMode setting is off', async () => {
    const { useTvMode } = await import('../useTvMode');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useTvMode());
    expect(result.current.isTvMode).toBe(false);
  });

  it('returns true when tvMode setting is on', async () => {
    mockSettings.tvMode = true;
    const { useTvMode } = await import('../useTvMode');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useTvMode());
    expect(result.current.isTvMode).toBe(true);
  });
});
