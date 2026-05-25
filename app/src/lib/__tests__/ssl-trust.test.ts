import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnable = vi.fn().mockResolvedValue(undefined);
const mockDisable = vi.fn().mockResolvedValue(undefined);

vi.mock('../../plugins/ssl-trust', () => ({
  SSLTrust: {
    enable: mockEnable,
    disable: mockDisable,
    isEnabled: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

vi.mock('../logger', () => ({
  log: {
    sslTrust: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

describe('applySSLTrustSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should call SSLTrust.enable() when enabled on native', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true, isTauri: false },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(true);

    expect(mockEnable).toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('should call SSLTrust.disable() when disabled on native', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: true, isTauri: false },
    }));

    const { applySSLTrustSetting } = await import('../ssl-trust');
    await applySSLTrustSetting(false);

    expect(mockDisable).toHaveBeenCalled();
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('should set tauri flag when on Tauri platform', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isTauri: true },
    }));

    const { applySSLTrustSetting, isTauriSslTrustEnabled } = await import('../ssl-trust');
    await applySSLTrustSetting(true);

    expect(isTauriSslTrustEnabled()).toBe(true);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('should clear tauri flag when disabled', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isTauri: true },
    }));

    const { applySSLTrustSetting, isTauriSslTrustEnabled } = await import('../ssl-trust');
    await applySSLTrustSetting(true);
    expect(isTauriSslTrustEnabled()).toBe(true);

    await applySSLTrustSetting(false);
    expect(isTauriSslTrustEnabled()).toBe(false);
  });

  it('should call electronSsl.setTrustSelfSigned with the enabled flag on Electron', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isTauri: false, isElectron: true },
    }));

    const setTrustSelfSigned = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { electronSsl: { setTrustSelfSigned } });

    const { applySSLTrustSetting } = await import('../ssl-trust');

    await applySSLTrustSetting(true);
    expect(setTrustSelfSigned).toHaveBeenCalledWith(true);

    await applySSLTrustSetting(false);
    expect(setTrustSelfSigned).toHaveBeenCalledWith(false);

    expect(mockEnable).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should be a no-op on web platforms', async () => {
    vi.doMock('../platform', () => ({
      Platform: { isNative: false, isTauri: false },
    }));

    const { applySSLTrustSetting, isTauriSslTrustEnabled } = await import('../ssl-trust');
    await applySSLTrustSetting(true);

    expect(mockEnable).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
    expect(isTauriSslTrustEnabled()).toBe(false);
  });
});
