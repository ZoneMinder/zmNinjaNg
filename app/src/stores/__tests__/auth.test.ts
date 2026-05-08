import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { useAuthStore } from '../auth';
import { login as apiLogin, refreshToken as apiRefreshToken } from '../../api/auth';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    auth: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

describe('Auth Store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      accessTokenExpires: null,
      refreshTokenExpires: null,
      version: null,
      apiVersion: null,
      isAuthenticated: false,
    });
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs in and sets tokens', async () => {
    const response = {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      access_token_expires: 60,
      refresh_token_expires: 120,
      version: '1.0.0',
      apiversion: '2.0.0',
    };

    vi.mocked(apiLogin).mockResolvedValue(response);

    await useAuthStore.getState().login('user', 'pass');

    expect(apiLogin).toHaveBeenCalledWith({ user: 'user', pass: 'pass' });
    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-123');
    expect(state.refreshToken).toBe('refresh-456');
    expect(state.accessTokenExpires).toBe(Date.now() + 60 * 1000);
    expect(state.refreshTokenExpires).toBe(Date.now() + 120 * 1000);
    expect(state.version).toBe('1.0.0');
    expect(state.apiVersion).toBe('2.0.0');
    expect(state.isAuthenticated).toBe(true);
  });

  it('retains refresh token when access token only is returned', () => {
    useAuthStore.setState({
      refreshToken: 'existing-refresh',
      refreshTokenExpires: Date.now() + 5000,
      version: '0.9.0',
      apiVersion: '1.9.0',
    });

    useAuthStore.getState().setTokens({
      access_token: 'new-access',
      access_token_expires: 10,
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-access');
    expect(state.refreshToken).toBe('existing-refresh');
    expect(state.refreshTokenExpires).toBe(Date.now() + 5000);
    expect(state.version).toBe('0.9.0');
    expect(state.apiVersion).toBe('1.9.0');
  });

  it('refreshes access token successfully', async () => {
    useAuthStore.setState({
      refreshToken: 'refresh-xyz',
    });

    vi.mocked(apiRefreshToken).mockResolvedValue({
      access_token: 'new-access',
      access_token_expires: 30,
    });

    await useAuthStore.getState().refreshAccessToken();

    expect(apiRefreshToken).toHaveBeenCalledWith('refresh-xyz');
    expect(useAuthStore.getState().accessToken).toBe('new-access');
  });

  it('logs out on refresh failure', async () => {
    useAuthStore.setState({
      refreshToken: 'refresh-xyz',
      accessToken: 'old-access',
      isAuthenticated: true,
    });

    vi.mocked(apiRefreshToken).mockRejectedValue(new Error('refresh failed'));

    await expect(useAuthStore.getState().refreshAccessToken()).rejects.toThrow('refresh failed');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('clears state on logout', () => {
    useAuthStore.setState({
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpires: Date.now() + 1000,
      refreshTokenExpires: Date.now() + 2000,
      version: '1.0.0',
      apiVersion: '2.0.0',
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.accessTokenExpires).toBeNull();
    expect(state.refreshTokenExpires).toBeNull();
    expect(state.version).toBeNull();
    expect(state.apiVersion).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  describe('getFreshAccessToken', () => {
    beforeEach(() => {
      useAuthStore.setState({
        accessToken: null,
        refreshToken: null,
        accessTokenExpires: null,
        refreshTokenExpires: null,
        isAuthenticated: false,
      });
    });

    it('returns the current access token when it has more than the leeway remaining', async () => {
      const future = Date.now() + 60 * 60 * 1000; // 1 hour ahead
      useAuthStore.setState({
        accessToken: 'fresh-token',
        accessTokenExpires: future,
        isAuthenticated: true,
      });
      const result = await useAuthStore.getState().getFreshAccessToken();
      expect(result).toBe('fresh-token');
    });

    it('refreshes when the token has less than the leeway remaining', async () => {
      const soon = Date.now() + 5 * 60 * 1000; // 5 min ahead, below the 30-min leeway
      useAuthStore.setState({
        accessToken: 'stale-token',
        refreshToken: 'rt',
        accessTokenExpires: soon,
        refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
        isAuthenticated: true,
      });
      vi.mocked(apiRefreshToken).mockResolvedValueOnce({
        access_token: 'new-token',
        access_token_expires: 7200,
        refresh_token: 'new-rt',
        refresh_token_expires: 86400,
      });
      const result = await useAuthStore.getState().getFreshAccessToken();
      expect(result).toBe('new-token');
      expect(apiRefreshToken).toHaveBeenCalledWith('rt');
    });

    it('falls through to reLoginCallback when refresh rejects', async () => {
      useAuthStore.setState({
        accessToken: 'stale',
        refreshToken: 'rt',
        accessTokenExpires: Date.now() + 60_000,
        refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
        isAuthenticated: true,
      });
      vi.mocked(apiRefreshToken).mockRejectedValueOnce(new Error('401'));
      const reLogin = vi.fn().mockImplementation(async () => {
        useAuthStore.setState({
          accessToken: 'after-relogin',
          accessTokenExpires: Date.now() + 2 * 60 * 60 * 1000,
          isAuthenticated: true,
        });
        return true;
      });
      useAuthStore.getState().setReLoginCallback(reLogin);
      const result = await useAuthStore.getState().getFreshAccessToken();
      expect(result).toBe('after-relogin');
      expect(reLogin).toHaveBeenCalled();
    });

    it('returns null when both refresh and reLogin fail', async () => {
      useAuthStore.setState({
        accessToken: 'stale',
        refreshToken: 'rt',
        accessTokenExpires: Date.now() + 60_000,
        refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
        isAuthenticated: true,
      });
      vi.mocked(apiRefreshToken).mockRejectedValueOnce(new Error('401'));
      useAuthStore.getState().setReLoginCallback(async () => false);
      const result = await useAuthStore.getState().getFreshAccessToken();
      expect(result).toBeNull();
    });

    it('dedupes concurrent callers into one refresh', async () => {
      useAuthStore.setState({
        accessToken: 'stale',
        refreshToken: 'rt',
        accessTokenExpires: Date.now() + 60_000,
        refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
        isAuthenticated: true,
      });
      vi.mocked(apiRefreshToken).mockResolvedValue({
        access_token: 'new',
        access_token_expires: 7200,
        refresh_token: 'new-rt',
        refresh_token_expires: 86400,
      });
      const [a, b, c] = await Promise.all([
        useAuthStore.getState().getFreshAccessToken(),
        useAuthStore.getState().getFreshAccessToken(),
        useAuthStore.getState().getFreshAccessToken(),
      ]);
      expect(a).toBe('new');
      expect(b).toBe('new');
      expect(c).toBe('new');
      expect(apiRefreshToken).toHaveBeenCalledTimes(1);
    });
  });
});
