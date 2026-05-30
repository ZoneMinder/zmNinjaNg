import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPlatformMock = vi.fn();
const isNativePlatformMock = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => getPlatformMock(),
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

beforeEach(() => {
  getPlatformMock.mockReset();
  isNativePlatformMock.mockReset();
});

describe('Platform.isIOS', () => {
  it('is true on real iOS Capacitor', async () => {
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(true);
    const { Platform } = await import('../platform');
    expect(Platform.isIOS).toBe(true);
  });

  it('is false when web', async () => {
    getPlatformMock.mockReturnValue('web');
    isNativePlatformMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isIOS).toBe(false);
  });

  it('is false when Capacitor reports ios but isNativePlatform is false', async () => {
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isIOS).toBe(false);
  });
});

describe('Platform.isAndroid', () => {
  it('is true on real Android Capacitor', async () => {
    getPlatformMock.mockReturnValue('android');
    isNativePlatformMock.mockReturnValue(true);
    const { Platform } = await import('../platform');
    expect(Platform.isAndroid).toBe(true);
  });

  it('is false on iOS', async () => {
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(true);
    const { Platform } = await import('../platform');
    expect(Platform.isAndroid).toBe(false);
  });

  it('is false on web', async () => {
    getPlatformMock.mockReturnValue('web');
    isNativePlatformMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isAndroid).toBe(false);
  });
});
