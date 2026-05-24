import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getPlatformMock = vi.fn();
const isNativePlatformMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => getPlatformMock(),
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

beforeEach(() => {
  getPlatformMock.mockReset();
  isNativePlatformMock.mockReset();
  isTauriMock.mockReset();
});

describe('Platform.isIOS', () => {
  it('is true on real iOS Capacitor', async () => {
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(true);
    isTauriMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isIOS).toBe(true);
  });

  it('is false when web', async () => {
    getPlatformMock.mockReturnValue('web');
    isNativePlatformMock.mockReturnValue(false);
    isTauriMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isIOS).toBe(false);
  });

  it('is false when Capacitor reports ios but isNativePlatform is false (Tauri WKWebView misdetection guard)', async () => {
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(false);
    isTauriMock.mockReturnValue(true);
    const { Platform } = await import('../platform');
    expect(Platform.isIOS).toBe(false);
  });
});

describe('Platform.isAndroid', () => {
  it('is true on real Android Capacitor', async () => {
    getPlatformMock.mockReturnValue('android');
    isNativePlatformMock.mockReturnValue(true);
    isTauriMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isAndroid).toBe(true);
  });

  it('is false on iOS', async () => {
    getPlatformMock.mockReturnValue('ios');
    isNativePlatformMock.mockReturnValue(true);
    isTauriMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isAndroid).toBe(false);
  });

  it('is false on web', async () => {
    getPlatformMock.mockReturnValue('web');
    isNativePlatformMock.mockReturnValue(false);
    isTauriMock.mockReturnValue(false);
    const { Platform } = await import('../platform');
    expect(Platform.isAndroid).toBe(false);
  });
});

describe('Platform.isTauriLinux', () => {
  const ORIGINAL_UA = navigator.userAgent;
  const setUA = (ua: string) =>
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });

  afterEach(() => setUA(ORIGINAL_UA));

  it('is true on Tauri with a Linux (WebKitGTK) user agent', async () => {
    isTauriMock.mockReturnValue(true);
    isNativePlatformMock.mockReturnValue(false);
    setUA('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko)');
    const { Platform } = await import('../platform');
    expect(Platform.isTauriLinux).toBe(true);
  });

  it('is false on Tauri with a macOS (WKWebView) user agent', async () => {
    isTauriMock.mockReturnValue(true);
    isNativePlatformMock.mockReturnValue(false);
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)');
    const { Platform } = await import('../platform');
    expect(Platform.isTauriLinux).toBe(false);
  });

  it('is false in a Linux web browser (not Tauri)', async () => {
    isTauriMock.mockReturnValue(false);
    isNativePlatformMock.mockReturnValue(false);
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0');
    const { Platform } = await import('../platform');
    expect(Platform.isTauriLinux).toBe(false);
  });
});
