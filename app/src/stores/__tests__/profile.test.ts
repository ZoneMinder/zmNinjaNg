import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useProfileStore } from '../profile';
import { useAuthStore, getAuthSlice } from '../auth';
import { useMonitorSeenStore } from '../monitorSeen';
import { setQueryClient } from '../query-cache';
import { createStoreApiClient } from '../../api/store-gates';
import { getServerTimeZone } from '../../api/time';
import { setSecureValue, removeSecureValue, getSecureValue } from '../../lib/security/secureStorage';
import { asProfileId, ALL_PROFILES_ID } from '../../api/types';
import { getSession, hasSession, dropAllSessions } from '../../services/sessions';
import { useNotificationStore } from '../notifications';
import { useDeleteSelectionStore, eventSelectionKey } from '../deleteSelection';

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));

vi.mock('../../api/time', () => ({
  getServerTimeZone: vi.fn(),
}));

vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn().mockResolvedValue(undefined),
  getSecureValue: vi.fn().mockResolvedValue(undefined),
  removeSecureValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    profile: vi.fn(),
    profileService: vi.fn(),
    auth: vi.fn(),
    notifications: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

describe('Profile Store', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [],
      currentProfileId: null,
      isInitialized: true,
    });
    useMonitorSeenStore.setState({ profileWatermarks: {} });
    useAuthStore.setState({ slices: {} });
    dropAllSessions();
    queryClient = new QueryClient();
    setQueryClient(queryClient);
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: () => 'profile-1' });
  });

  it('detects duplicate profile names', () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
    });

    const exists = useProfileStore.getState().profileExists('home');

    expect(exists).toBe(true);
  });

  it('adds a profile and stores password securely', async () => {
    vi.mocked(getServerTimeZone).mockResolvedValue('UTC');

    const id = await useProfileStore.getState().addProfile({
      name: 'Office',
      portalUrl: 'https://example.test',
      apiUrl: 'https://example.test',
      cgiUrl: 'https://example.test/cgi-bin',
      isDefault: false,
      username: 'admin',
      password: 'secret',
    });

    expect(id).toBe('profile-1');
    expect(setSecureValue).toHaveBeenCalledWith('password_profile-1', 'secret');
    expect(createStoreApiClient).toHaveBeenCalledWith('https://example.test', expect.any(Function), 'profile-1');
    expect(hasSession(asProfileId('profile-1'))).toBe(true);

    const { profiles, currentProfileId } = useProfileStore.getState();
    const profile = profiles.find(p => p.id === currentProfileId);
    expect(profile?.name).toBe('Office');
    expect(profile?.password).toBe('stored-securely');
  });

  it('rejects duplicate profile names on add', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
    });

    await expect(
      useProfileStore.getState().addProfile({
        name: 'Home',
        portalUrl: 'https://example.test',
        apiUrl: 'https://example.test',
        cgiUrl: 'https://example.test/cgi-bin',
        isDefault: false,
      })
    ).rejects.toThrow('already exists');
  });

  // A monitor list fetched from the old URL would stand in for the new
  // server's on the live pages and in the Profiles checks (refs #613).
  describe('updateProfile clears cached data when an address changes', () => {
    const p1 = asProfileId('p1');
    const seed = () => {
      useProfileStore.setState({
        profiles: [{ id: p1, name: 'Home', apiUrl: 'http://a/api', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 }],
      });
      queryClient.setQueryData(['monitors', p1], { monitors: ['old'] });
    };

    it('drops the profile\'s cached queries when its API URL changes', async () => {
      seed();
      await useProfileStore.getState().updateProfile('p1', { apiUrl: 'http://b/api' });
      expect(queryClient.getQueryData(['monitors', p1])).toBeUndefined();
    });

    it('keeps them when the save carries the same addresses', async () => {
      seed();
      await useProfileStore.getState().updateProfile('p1', {
        name: 'Home 2', apiUrl: 'http://a/api', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin',
      });
      expect(queryClient.getQueryData(['monitors', p1])).toEqual({ monitors: ['old'] });
    });
  });

  it('updates profile and enforces unique names', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
        {
          id: asProfileId('p2'),
          name: 'Office',
          apiUrl: 'http://b',
          portalUrl: 'http://b',
          cgiUrl: 'http://b/cgi-bin',
          isDefault: false,
          createdAt: 2,
        },
      ],
    });

    await expect(
      useProfileStore.getState().updateProfile('p2', { name: 'Home' })
    ).rejects.toThrow('already exists');
  });

  it('removes profile password on delete', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
      currentProfileId: asProfileId('p1'),
    });

    await useProfileStore.getState().deleteProfile('p1');

    expect(removeSecureValue).toHaveBeenCalledWith('password_p1');
    expect(useProfileStore.getState().profiles).toHaveLength(0);
  });

  it('drops the deleted profile\'s monitor watermarks but keeps other profiles\'', async () => {
    useProfileStore.setState({
      profiles: [
        {
          id: asProfileId('p1'),
          name: 'Home',
          apiUrl: 'http://a',
          portalUrl: 'http://a',
          cgiUrl: 'http://a/cgi-bin',
          isDefault: true,
          createdAt: 1,
        },
      ],
      currentProfileId: asProfileId('p1'),
    });

    useMonitorSeenStore.getState().seed('p1', 'monitor-1', '2026-07-01 00:00:00');
    useMonitorSeenStore.getState().seed('p2', 'monitor-1', '2026-07-02 00:00:00');

    await useProfileStore.getState().deleteProfile('p1');

    expect(useMonitorSeenStore.getState().hasWatermark('p1', 'monitor-1')).toBe(false);
    expect(useMonitorSeenStore.getState().hasWatermark('p2', 'monitor-1')).toBe(true);
    expect(useMonitorSeenStore.getState().getWatermark('p2', 'monitor-1')).toBe('2026-07-02 00:00:00');
  });

  it('drops the deleted profile\'s query cache entries but keeps other profiles\' (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    queryClient.setQueryData(['monitors', 'p1'], ['m1']);
    queryClient.setQueryData(['monitors', 'p2'], ['m2']);

    await useProfileStore.getState().deleteProfile('p1');

    expect(queryClient.getQueryData(['monitors', 'p1'])).toBeUndefined();
    expect(queryClient.getQueryData(['monitors', 'p2'])).toEqual(['m2']);
  });

  it('clears the deleted profile\'s auth slice but keeps other profiles\' (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    useAuthStore.getState().setTokens(asProfileId('p1'), {
      access_token: 'p1-at', access_token_expires: 60, refresh_token: 'p1-rt', refresh_token_expires: 120,
    });
    useAuthStore.getState().setTokens(asProfileId('p2'), {
      access_token: 'p2-at', access_token_expires: 60, refresh_token: 'p2-rt', refresh_token_expires: 120,
    });

    await useProfileStore.getState().deleteProfile('p1');

    expect(getAuthSlice(asProfileId('p1')).isAuthenticated).toBe(false);
    expect(getAuthSlice(asProfileId('p1')).refreshToken).toBeNull();
    expect(getAuthSlice(asProfileId('p2')).isAuthenticated).toBe(true);
    expect(getAuthSlice(asProfileId('p2')).refreshToken).toBe('p2-rt');
  });

  it('tears down the deleted profile\'s notification connection through the store, leaving others alone (refs #337 I5)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
        { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    useNotificationStore.setState({
      connections: { p1: 'connected', p2: 'connected' },
    });

    await useProfileStore.getState().deleteProfile('p1');

    expect(useNotificationStore.getState().connections.p1).toBe('disconnected');
    expect(useNotificationStore.getState().connections.p2).toBe('connected');
  });

  it('deleteAllProfiles clears every profile\'s auth slice (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
        { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    useAuthStore.getState().setTokens(asProfileId('p1'), {
      access_token: 'p1-at', access_token_expires: 60, refresh_token: 'p1-rt', refresh_token_expires: 120,
    });
    useAuthStore.getState().setTokens(asProfileId('p2'), {
      access_token: 'p2-at', access_token_expires: 60, refresh_token: 'p2-rt', refresh_token_expires: 120,
    });

    await useProfileStore.getState().deleteAllProfiles();

    expect(getAuthSlice(asProfileId('p1')).isAuthenticated).toBe(false);
    expect(getAuthSlice(asProfileId('p2')).isAuthenticated).toBe(false);
  });

  it('drops the deleted profile\'s session (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    getSession(asProfileId('p1'));
    expect(hasSession(asProfileId('p1'))).toBe(true);

    await useProfileStore.getState().deleteProfile('p1');

    expect(hasSession(asProfileId('p1'))).toBe(false);
  });

  it('drops the session when connection details change (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    getSession(asProfileId('p1'));
    expect(hasSession(asProfileId('p1'))).toBe(true);

    await useProfileStore.getState().updateProfile('p1', { apiUrl: 'http://b' });

    expect(hasSession(asProfileId('p1'))).toBe(false);
  });

  it('deleteAllProfiles drops every cached session (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
        { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    getSession(asProfileId('p1'));
    getSession(asProfileId('p2'));
    expect(hasSession(asProfileId('p1'))).toBe(true);
    expect(hasSession(asProfileId('p2'))).toBe(true);

    await useProfileStore.getState().deleteAllProfiles();

    expect(hasSession(asProfileId('p1'))).toBe(false);
    expect(hasSession(asProfileId('p2'))).toBe(false);
  });

  it('deleteAllProfiles tears down every profile\'s notification connection through the store (refs #337 I5)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
        { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
      ],
      currentProfileId: asProfileId('p1'),
    });
    useNotificationStore.setState({
      connections: { p1: 'connected', p2: 'connected' },
    });

    await useProfileStore.getState().deleteAllProfiles();

    expect(useNotificationStore.getState().connections.p1).toBe('disconnected');
    expect(useNotificationStore.getState().connections.p2).toBe('disconnected');
  });

  it('reLoginFor(id) re-authenticates a non-current profile against its own client, leaving the current profile untouched (refs #337)', async () => {
    const postFormA = vi.fn();
    const postFormB = vi.fn().mockResolvedValue({
      data: {
        access_token: 'b-at',
        access_token_expires: 60,
        refresh_token: 'b-rt',
        refresh_token_expires: 120,
        version: '1.36.33',
        apiversion: '2.0',
      },
    });
    vi.mocked(createStoreApiClient).mockImplementation(
      (_baseURL, _reLogin, profileId) =>
        (profileId === asProfileId('b') ? { postForm: postFormB } : { postForm: postFormA }) as never
    );
    vi.mocked(getSecureValue).mockImplementation(async (key: string) =>
      key === 'password_b' ? 'b-secret' : null
    );

    useProfileStore.setState({
      profiles: [
        { id: asProfileId('a'), name: 'A', apiUrl: 'https://a.test', portalUrl: 'https://a.test', cgiUrl: 'https://a.test/cgi-bin', isDefault: true, createdAt: 1, username: 'admin-a', password: 'stored-securely' },
        { id: asProfileId('b'), name: 'B', apiUrl: 'https://b.test', portalUrl: 'https://b.test', cgiUrl: 'https://b.test/cgi-bin', isDefault: false, createdAt: 2, username: 'admin-b', password: 'stored-securely' },
      ],
      currentProfileId: asProfileId('a'),
    });

    // Building B's session registers its client with the sessions gate, which
    // captures the actual reLoginFor(B.id) closure this store registered.
    getSession(asProfileId('b'));
    const reLoginForB = vi.mocked(createStoreApiClient).mock.calls[0][1] as () => Promise<boolean>;

    const result = await reLoginForB();

    expect(result).toBe(true);
    expect(postFormB).toHaveBeenCalledWith('/host/login.json', expect.any(URLSearchParams));
    expect(postFormA).not.toHaveBeenCalled();
    expect(getAuthSlice(asProfileId('b')).isAuthenticated).toBe(true);
    expect(getAuthSlice(asProfileId('a')).isAuthenticated).toBe(false);
  });

  it('getFreshAccessToken(B) self-heals via B\'s own reLogin, not the current profile\'s (refs #337)', async () => {
    const postFormA = vi.fn();
    const postFormB = vi.fn().mockResolvedValue({
      data: {
        access_token: 'b-at',
        access_token_expires: 60,
        refresh_token: 'b-rt',
        refresh_token_expires: 120,
        version: '1.36.33',
        apiversion: '2.0',
      },
    });
    vi.mocked(createStoreApiClient).mockImplementation(
      (_baseURL, _reLogin, profileId) =>
        (profileId === asProfileId('b') ? { postForm: postFormB } : { postForm: postFormA }) as never
    );
    vi.mocked(getSecureValue).mockImplementation(async (key: string) =>
      key === 'password_b' ? 'b-secret' : null
    );

    useProfileStore.setState({
      profiles: [
        { id: asProfileId('a'), name: 'A', apiUrl: 'https://a.test', portalUrl: 'https://a.test', cgiUrl: 'https://a.test/cgi-bin', isDefault: true, createdAt: 1, username: 'admin-a', password: 'stored-securely' },
        { id: asProfileId('b'), name: 'B', apiUrl: 'https://b.test', portalUrl: 'https://b.test', cgiUrl: 'https://b.test/cgi-bin', isDefault: false, createdAt: 2, username: 'admin-b', password: 'stored-securely' },
      ],
      // Current profile is A - B has no active session of its own until an
      // All-mode reader builds one, and getFreshAccessToken(B) must still
      // self-heal B without touching A's credentials.
      currentProfileId: asProfileId('a'),
    });

    // Building B's session is what registers B's reLoginFor into the auth
    // store's setReLoginCallback map (refs #337) - previously only the
    // rehydrated CURRENT profile ever got a callback registered, so
    // getFreshAccessToken(B) had nothing to fall through to.
    getSession(asProfileId('b'));
    // B has no refresh token yet (fresh slice), so refreshAccessToken(B)
    // rejects immediately and getFreshAccessToken falls through to B's
    // reLogin callback.
    const token = await useAuthStore.getState().getFreshAccessToken(asProfileId('b'));

    expect(token).toBe('b-at');
    expect(postFormB).toHaveBeenCalledWith('/host/login.json', expect.any(URLSearchParams));
    expect(postFormA).not.toHaveBeenCalled();
    expect(getAuthSlice(asProfileId('b')).isAuthenticated).toBe(true);
    expect(getAuthSlice(asProfileId('a')).isAuthenticated).toBe(false);
  });

  it('reLoginFor(id) returns false for a profile that no longer exists (refs #337)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: asProfileId('a'), name: 'A', apiUrl: 'https://a.test', portalUrl: 'https://a.test', cgiUrl: 'https://a.test/cgi-bin', isDefault: true, createdAt: 1 },
      ],
      currentProfileId: asProfileId('a'),
    });

    getSession(asProfileId('a'));
    const reLoginForA = vi.mocked(createStoreApiClient).mock.calls[0][1] as () => Promise<boolean>;

    await useProfileStore.getState().deleteProfile('a');

    const result = await reLoginForA();

    expect(result).toBe(false);
  });

  describe('setProfileDisabled (refs #337)', () => {
    it('disables a non-current profile, dropping its session', () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
          { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
        ],
        currentProfileId: asProfileId('p1'),
      });
      getSession(asProfileId('p2'));
      expect(hasSession(asProfileId('p2'))).toBe(true);

      useProfileStore.getState().setProfileDisabled('p2', true);

      expect(useProfileStore.getState().profiles.find((p) => p.id === 'p2')?.disabled).toBe(true);
      expect(hasSession(asProfileId('p2'))).toBe(false);
      // The other profile is untouched.
      expect(useProfileStore.getState().profiles.find((p) => p.id === 'p1')?.disabled).toBeFalsy();
    });

    it('rejects disabling the active profile', () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
        ],
        currentProfileId: asProfileId('p1'),
      });

      expect(() => useProfileStore.getState().setProfileDisabled('p1', true)).toThrow();
      expect(useProfileStore.getState().profiles.find((p) => p.id === 'p1')?.disabled).toBeFalsy();
    });

    it('re-enables a profile unconditionally, without rebuilding a session', () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1, disabled: true },
        ],
        currentProfileId: null,
      });

      useProfileStore.getState().setProfileDisabled('p1', false);

      expect(useProfileStore.getState().profiles.find((p) => p.id === 'p1')?.disabled).toBe(false);
    });
  });

  describe('switchProfile', () => {
    it('rejects switching to a disabled profile (refs #337)', async () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
          { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2, disabled: true },
        ],
        currentProfileId: asProfileId('p1'),
      });

      await expect(useProfileStore.getState().switchProfile('p2')).rejects.toThrow();
      expect(useProfileStore.getState().currentProfileId).toBe('p1');
    });

    it('keeps both profiles\' query cache entries warm across a switch (refs #337)', async () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
          { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
        ],
        currentProfileId: asProfileId('p1'),
      });
      queryClient.setQueryData(['monitors', 'p1'], ['m1']);
      queryClient.setQueryData(['monitors', 'p2'], ['m2']);

      await useProfileStore.getState().switchProfile('p2');

      expect(queryClient.getQueryData(['monitors', 'p1'])).toEqual(['m1']);
      expect(queryClient.getQueryData(['monitors', 'p2'])).toEqual(['m2']);
    });

    it('switching to a group sets its id without building a session or running bootstrap (refs #337)', async () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
          { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
        ],
        currentProfileId: asProfileId('p1'),
      });
      const group = useProfileStore
        .getState()
        .addVirtualProfile('Upstairs', [asProfileId('p1'), asProfileId('p2')]);

      await useProfileStore.getState().switchProfile(group);

      expect(useProfileStore.getState().currentProfileId).toBe(group);
      expect(hasSession(group)).toBe(false);
      expect(createStoreApiClient).not.toHaveBeenCalled();
    });

    // The All Servers sentinel is retired: nothing offers it, and nothing
    // stores it either, so it fails the same membership check any unknown
    // aggregate id fails. The message is asserted because it is what
    // discriminates against a branch that merely happens to throw (refs #337).
    it('rejects the retired sentinel like any unknown id, keeping the current profile', async () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
        ],
        currentProfileId: asProfileId('p1'),
      });

      await expect(useProfileStore.getState().switchProfile(ALL_PROFILES_ID)).rejects.toThrow(
        `Profile ${ALL_PROFILES_ID} not found`
      );
      expect(useProfileStore.getState().currentProfileId).toBe(asProfileId('p1'));
    });
  });

  /**
   * The delete-selection bar lives in AppLayout and never unmounts, so a queue
   * left over from another profile stays on screen with nothing marked under
   * it - and confirming would delete events on a server the user is no longer
   * looking at (refs #337).
   */
  describe('stale delete selection', () => {
    const twoProfiles = () =>
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
          { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2 },
        ],
        currentProfileId: asProfileId('p1'),
      });

    beforeEach(() => {
      useDeleteSelectionStore.getState().clear();
      useDeleteSelectionStore.getState().toggle(eventSelectionKey(asProfileId('p1'), '5'));
    });

    it('switching to another profile drops the queue', async () => {
      twoProfiles();
      await useProfileStore.getState().switchProfile('p2');
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });

    it('switching to a group drops the queue', async () => {
      twoProfiles();
      const group = useProfileStore
        .getState()
        .addVirtualProfile('Queue Group', [asProfileId('p1'), asProfileId('p2')]);
      await useProfileStore.getState().switchProfile(group);
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });

    it('deleting a profile drops the queue', async () => {
      twoProfiles();
      await useProfileStore.getState().deleteProfile('p1');
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });

    it('deleting every profile drops the queue', async () => {
      twoProfiles();
      await useProfileStore.getState().deleteAllProfiles();
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });

    it('disabling a profile drops the queue', () => {
      twoProfiles();
      useProfileStore.getState().setProfileDisabled('p2', true);
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
    });

    it('keeps the queue when the switch is rejected', async () => {
      useProfileStore.setState({
        profiles: [
          { id: asProfileId('p1'), name: 'Home', apiUrl: 'http://a', portalUrl: 'http://a', cgiUrl: 'http://a/cgi-bin', isDefault: true, createdAt: 1 },
          { id: asProfileId('p2'), name: 'Away', apiUrl: 'http://b', portalUrl: 'http://b', cgiUrl: 'http://b/cgi-bin', isDefault: false, createdAt: 2, disabled: true },
        ],
        currentProfileId: asProfileId('p1'),
      });

      await expect(useProfileStore.getState().switchProfile('p2')).rejects.toThrow();
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(asProfileId('p1'), '5')]);
    });
  });
});
