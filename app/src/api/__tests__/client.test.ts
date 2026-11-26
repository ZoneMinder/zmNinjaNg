import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClientGates, type AuthGate, type SettingsGate } from '../client';
import { createStoreApiClient } from '../store-gates';
import { httpRequest } from '../../lib/http';
import { log, LogLevel } from '../../lib/logger';
import { useAuthStore, resetAuthGates } from '../../stores/auth';
import { asProfileId } from '../types';
import { API_REQUEST } from '../../lib/zmninja-ng-constants';

const pid = asProfileId('p1');

vi.mock('../../lib/http', () => ({
  httpRequest: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    api: vi.fn(),
    auth: vi.fn(),
    debug: vi.fn(),
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

function okOnce() {
  vi.mocked(httpRequest).mockResolvedValueOnce({ data: {}, status: 200, statusText: 'OK', headers: {} } as never);
}

/** Plain mock gates: the client is tested against these, no stores involved. */
function mockGates(overrides: { auth?: Partial<AuthGate>; settings?: Partial<SettingsGate> } = {}): ApiClientGates {
  return {
    auth: {
      getAccessToken: () => null,
      getAccessTokenExpires: () => null,
      isAuthenticated: () => false,
      getFreshAccessToken: vi.fn(async () => null),
      proactiveLogin: vi.fn(async (reLogin: () => Promise<boolean>) => reLogin()),
      recoverFromAuthFailure: vi.fn(async () => false),
      ...overrides.auth,
    },
    settings: {
      getApiTimeoutSeconds: () => API_REQUEST.defaultTimeoutSeconds,
      ...overrides.settings,
    },
  };
}

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ slices: {} });
  });

  it('never attaches a token to the login.json query string when posting credentials', async () => {
    const gates = mockGates({
      auth: { getAccessToken: () => 'stale-at', isAuthenticated: () => false },
    });

    const httpRequestSpy = vi.mocked(httpRequest);
    httpRequestSpy.mockResolvedValueOnce({
      data: { access_token: 'a', refresh_token: 'r', access_token_expires: 7200, refresh_token_expires: 86400 },
      status: 200,
      statusText: 'OK',
      headers: {},
    } as never);

    const client = createApiClient('https://zm.example.com/api', gates);
    const formBody = new URLSearchParams({ user: 'admin', pass: 'secret' }).toString();
    await client.post('/host/login.json', formBody, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    expect(httpRequestSpy).toHaveBeenCalled();
    const callArgs = httpRequestSpy.mock.calls[0]?.[1];
    expect(callArgs?.params?.token).toBeUndefined();
    // A login request never triggers the proactive login path either.
    expect(gates.auth.proactiveLogin).not.toHaveBeenCalled();
  });

  it('replaces an expired access token with a fresh one before attaching', async () => {
    const getFreshAccessToken = vi.fn(async () => 'fresh-at');
    const gates = mockGates({
      auth: {
        getAccessToken: () => 'expired-at',
        getAccessTokenExpires: () => Date.now() - 60_000,
        isAuthenticated: () => true,
        getFreshAccessToken,
      },
    });

    okOnce();

    const client = createApiClient('https://zm.example.com/api', gates);
    await client.get('/monitors.json');

    expect(getFreshAccessToken).toHaveBeenCalled();
    const callArgs = vi.mocked(httpRequest).mock.calls[0]?.[1];
    expect(callArgs?.params?.token).toBe('fresh-at');
  });

  it('attaches no token when refresh returns null for an expired access token', async () => {
    const getFreshAccessToken = vi.fn(async () => null);
    const gates = mockGates({
      auth: {
        getAccessToken: () => 'expired-at',
        getAccessTokenExpires: () => Date.now() - 60_000,
        isAuthenticated: () => true,
        getFreshAccessToken,
      },
    });

    okOnce();

    const client = createApiClient('https://zm.example.com/api', gates);
    await client.get('/monitors.json');

    expect(getFreshAccessToken).toHaveBeenCalled();
    const callArgs = vi.mocked(httpRequest).mock.calls[0]?.[1];
    expect(callArgs?.params?.token).toBeUndefined();
  });

  it('logs an expected status (e.g. 404 probe) at DEBUG, not ERROR, and still rejects', async () => {
    vi.mocked(httpRequest).mockRejectedValueOnce({
      status: 404,
      statusText: 'Not Found',
      message: 'Not Found',
    } as never);

    const client = createApiClient('https://zm.example.com/api', mockGates());

    await expect(
      client.get('/tags/index/Events.Id:55.json', { expectedStatuses: [404] }),
    ).rejects.toMatchObject({ status: 404 });

    const errorCall = vi.mocked(log.api).mock.calls.find(c => String(c[0]).includes('[Error #'));
    expect(errorCall).toBeDefined();
    expect(errorCall?.[1]).toBe(LogLevel.DEBUG);
  });

  it('logs an unexpected error status at ERROR', async () => {
    vi.mocked(httpRequest).mockRejectedValueOnce({
      status: 500,
      statusText: 'Server Error',
      message: 'Server Error',
    } as never);

    const client = createApiClient('https://zm.example.com/api', mockGates());

    await expect(client.get('/monitors.json')).rejects.toMatchObject({ status: 500 });

    const errorCall = vi.mocked(log.api).mock.calls.find(c => String(c[0]).includes('[Error #'));
    expect(errorCall?.[1]).toBe(LogLevel.ERROR);
  });

  describe('form helpers', () => {
    it('postForm serializes a URLSearchParams body and sets the form content-type', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api', mockGates());
      await client.postForm('/host/login.json', new URLSearchParams({ user: 'admin', pass: 'secret' }));

      const callArgs = vi.mocked(httpRequest).mock.calls[0]?.[1];
      expect(callArgs?.method).toBe('POST');
      expect(callArgs?.body).toBe('user=admin&pass=secret');
      expect((callArgs?.headers as Record<string, string>)?.['Content-Type'])
        .toBe('application/x-www-form-urlencoded');
    });

    it('putForm accepts a plain record and serializes it to a string body', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api', mockGates());
      await client.putForm('/notifications/1.json', { 'Notification[PushState]': 'enabled' });

      const callArgs = vi.mocked(httpRequest).mock.calls[0]?.[1];
      expect(callArgs?.method).toBe('PUT');
      expect(callArgs?.body).toBe('Notification%5BPushState%5D=enabled');
    });
  });

  describe('default request timeout', () => {
    it('applies the built-in default timeout when no profile and no explicit timeout', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api', mockGates());
      await client.get('/monitors.json');
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs)
        .toBe(API_REQUEST.defaultTimeoutSeconds * 1000);
    });

    it('uses the profile-configured timeout when a profileId is provided', async () => {
      const getApiTimeoutSeconds = vi.fn(() => 7);
      okOnce();
      const client = createApiClient(
        'https://zm.example.com/api',
        mockGates({ settings: { getApiTimeoutSeconds } }),
        undefined,
        'p1',
      );
      await client.get('/monitors.json');
      expect(getApiTimeoutSeconds).toHaveBeenCalledWith('p1');
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBe(7000);
    });

    it('disables the timeout when apiTimeoutSeconds is 0', async () => {
      okOnce();
      const client = createApiClient(
        'https://zm.example.com/api',
        mockGates({ settings: { getApiTimeoutSeconds: () => 0 } }),
        undefined,
        'p1',
      );
      await client.get('/monitors.json');
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBeUndefined();
    });

    it('does not apply the default to downloads (onDownloadProgress)', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api', mockGates());
      await client.get('/events/12/video.mp4', { onDownloadProgress: () => {} });
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBeUndefined();
    });

    it('respects an explicit timeoutMs from the caller', async () => {
      okOnce();
      const client = createApiClient('https://zm.example.com/api', mockGates());
      await client.get('/monitors.json', { timeoutMs: 1234 });
      expect(vi.mocked(httpRequest).mock.calls[0]?.[1]?.timeoutMs).toBe(1234);
    });
  });

  describe('proactive login', () => {
    it('runs the deduped login and retries the request once on success', async () => {
      const reLogin = vi.fn(async () => true);
      const proactiveLogin = vi.fn(async (fn: () => Promise<boolean>) => fn());
      const gates = mockGates({ auth: { isAuthenticated: () => false, proactiveLogin } });

      okOnce();

      const client = createApiClient('https://zm.example.com/api', gates, reLogin);
      await client.get('/monitors.json');

      expect(proactiveLogin).toHaveBeenCalledTimes(1);
      expect(reLogin).toHaveBeenCalledTimes(1);
      expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(1);
    });

    it('throws without issuing the request when the login fails', async () => {
      const reLogin = vi.fn(async () => false);
      const client = createApiClient('https://zm.example.com/api', mockGates(), reLogin);

      await expect(client.get('/monitors.json')).rejects.toThrow(
        'Authentication required but login failed',
      );
      expect(vi.mocked(httpRequest)).not.toHaveBeenCalled();
    });

    // A saved profile with a wrong password: the Profiles page marks its API
    // red only when the error carries a status (refs #613).
    it('rejects a failed login with status 401', async () => {
      const client = createApiClient('https://zm.example.com/api', mockGates(), vi.fn(async () => false));

      await expect(client.get('/monitors.json')).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('401 recovery retry', () => {
    const unauthorized = { status: 401, statusText: 'Unauthorized', message: 'Unauthorized' };

    it('retries once when recovery succeeds', async () => {
      const recoverFromAuthFailure = vi.fn(async () => true);
      const gates = mockGates({
        auth: { isAuthenticated: () => true, recoverFromAuthFailure },
      });

      vi.mocked(httpRequest)
        .mockRejectedValueOnce(unauthorized as never)
        .mockResolvedValueOnce({ data: {}, status: 200, statusText: 'OK', headers: {} } as never);

      const client = createApiClient('https://zm.example.com/api', gates);
      const response = await client.get('/monitors.json');

      expect(response.status).toBe(200);
      expect(recoverFromAuthFailure).toHaveBeenCalledTimes(1);
      expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(2);
    });

    it('propagates the 401 without retrying when recovery fails', async () => {
      const recoverFromAuthFailure = vi.fn(async () => false);
      const gates = mockGates({
        auth: { isAuthenticated: () => true, recoverFromAuthFailure },
      });

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createApiClient('https://zm.example.com/api', gates);
      await expect(client.get('/monitors.json')).rejects.toMatchObject({ status: 401 });

      expect(recoverFromAuthFailure).toHaveBeenCalledTimes(1);
      expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(1);
    });

    // A permission refusal survives any number of fresh tokens, so refreshing
    // one only spends two extra requests before failing anyway (refs #344).
    it('does not refresh the token when ZoneMinder refused on privileges', async () => {
      const recoverFromAuthFailure = vi.fn(async () => true);
      const gates = mockGates({
        auth: { isAuthenticated: () => true, recoverFromAuthFailure },
      });

      vi.mocked(httpRequest).mockRejectedValue({
        status: 401,
        statusText: 'Unauthorized',
        message: 'Unauthorized',
        data: { success: false, data: { name: 'Insufficient Privileges' } },
      } as never);

      const client = createApiClient('https://zm.example.com/api', gates);
      await expect(client.postForm('/monitors/1.json', new URLSearchParams({ 'Monitor[MaxFPS]': '5' })))
        .rejects.toMatchObject({ status: 401 });

      expect(recoverFromAuthFailure).not.toHaveBeenCalled();
      expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(1);
    });
  });

  // End-to-end through the real auth store gates (api/store-gates.ts): the
  // single-flight behavior pinned here spans the client retry loop and the
  // store's pendingAuthRecovery gate. Refs #182.
  describe('single-flight 401 recovery', () => {
    const unauthorized = { status: 401, statusText: 'Unauthorized', message: 'Unauthorized' };

    function authedState() {
      useAuthStore.setState({
        slices: {
          [pid]: {
            accessToken: 'at',
            accessTokenExpires: Date.now() + 60 * 60 * 1000,
            refreshToken: 'rt',
            refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
            version: null,
            apiVersion: null,
            isAuthenticated: true,
            requiresAuth: true,
          },
        },
      });
    }

    it('runs one token refresh for concurrent 401s and retries each request once', async () => {
      authedState();

      let resolveRefresh!: () => void;
      const refreshAccessToken = vi.fn(
        () => new Promise<void>((resolve) => { resolveRefresh = resolve; }),
      );
      useAuthStore.setState({ refreshAccessToken } as never);

      const httpRequestSpy = vi.mocked(httpRequest);
      let calls = 0;
      httpRequestSpy.mockImplementation(async () => {
        calls += 1;
        if (calls <= 5) throw unauthorized;
        return { data: {}, status: 200, statusText: 'OK', headers: {} } as never;
      });

      const client = createStoreApiClient('https://zm.example.com/api', undefined, pid);
      const requests = Array.from({ length: 5 }, (_, i) => client.get(`/monitors/${i}.json`));

      // Let all five requests hit the 401 handler before the refresh resolves.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      resolveRefresh();

      const results = await Promise.all(requests);
      expect(results).toHaveLength(5);
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      // 5 original attempts + 5 retries, no extra recovery round-trips.
      expect(httpRequestSpy).toHaveBeenCalledTimes(10);
    });

    it('fails all concurrent callers with one re-login attempt, then allows a later recovery', async () => {
      // No refresh token: recovery falls through to reLogin immediately.
      useAuthStore.setState({
        slices: {
          [pid]: {
            accessToken: 'at',
            accessTokenExpires: Date.now() + 60 * 60 * 1000,
            refreshToken: null,
            refreshTokenExpires: null,
            version: null,
            apiVersion: null,
            isAuthenticated: true,
            requiresAuth: true,
          },
        },
      });
      const logout = vi.fn();
      useAuthStore.setState({ logout } as never);

      let resolveReLogin!: (ok: boolean) => void;
      const reLogin = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveReLogin = resolve; }),
      );

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createStoreApiClient('https://zm.example.com/api', reLogin, pid);
      const requests = Array.from({ length: 4 }, () =>
        client.get('/monitors.json').then(() => 'resolved', (e: unknown) => e),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reLogin).toHaveBeenCalledTimes(1);
      resolveReLogin(false);

      const results = await Promise.all(requests);
      results.forEach((r) => expect(r).toMatchObject({ status: 401 }));
      expect(reLogin).toHaveBeenCalledTimes(1);
      expect(logout).toHaveBeenCalledTimes(1);

      // The gate is cleared: a later 401 attempts recovery again.
      const next = client.get('/monitors.json').then(() => 'resolved', (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reLogin).toHaveBeenCalledTimes(2);
      resolveReLogin(false);
      expect(await next).toMatchObject({ status: 401 });
    });

    it('does not start a second recovery when the retried request 401s again', async () => {
      authedState();
      const refreshAccessToken = vi.fn(async () => {});
      useAuthStore.setState({ refreshAccessToken } as never);

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createStoreApiClient('https://zm.example.com/api', undefined, pid);
      await expect(client.get('/monitors.json')).rejects.toMatchObject({ status: 401 });
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(2);
    });

    it('resetAuthGates(profileId) clears an in-flight recovery so later requests start a new one', async () => {
      // Per-profile gates: dropSession/logout(profileId) call resetAuthGates
      // directly to clear a profile's pending single-flight auth ops (refs #337).
      authedState();
      const refreshResolvers: Array<() => void> = [];
      const refreshAccessToken = vi.fn(
        () => new Promise<void>((resolve) => { refreshResolvers.push(resolve); }),
      );
      useAuthStore.setState({ refreshAccessToken } as never);

      vi.mocked(httpRequest).mockRejectedValue(unauthorized as never);

      const client = createStoreApiClient('https://zm.example.com/api', undefined, pid);
      const first = client.get('/a.json').then(() => 'resolved', (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);

      resetAuthGates(pid);

      const second = client.get('/b.json').then(() => 'resolved', (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The gate is now cleared: a new recovery starts.
      expect(refreshAccessToken).toHaveBeenCalledTimes(2);

      refreshResolvers.forEach((resolve) => resolve());
      // Both retries hit the always-401 mock and reject without looping.
      expect(await first).toMatchObject({ status: 401 });
      expect(await second).toMatchObject({ status: 401 });
    });
  });
});
