import { describe, it, expect, beforeEach, vi } from 'vitest';
import { asProfileId, type Profile, type ProfileId } from '../../api/types';
import {
  registerSessionsGate,
  getSession,
  getCurrentSession,
  tryGetCurrentSession,
  hasSession,
  dropSession,
  dropAllSessions,
  ALL_PROFILES_ID,
} from '../sessions';
import { PROBE_PROFILE_ID, mintVirtualProfileId } from '../../api/types';
import { getServerMap } from '../../lib/zm/server-resolver';
import { getServers } from '../../api/server';

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn((baseURL: string, _reLogin?: () => Promise<boolean>, profileId?: string) => ({
    __tag: `client:${profileId}:${baseURL}`,
  })),
  resetAuthGates: vi.fn(),
}));

vi.mock('../../api/server', () => ({
  getServers: vi.fn(async () => []),
}));

/** Flush the microtask queue so fire-and-forget server-map populates settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

vi.mock('../../lib/logger', () => ({
  log: {
    profileService: vi.fn(),
    http: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

import { createStoreApiClient, resetAuthGates } from '../../api/store-gates';

const aId = asProfileId('profile-a');
const bId = asProfileId('profile-b');

function makeProfile(id: ProfileId, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: id,
    portalUrl: 'https://portal.example',
    apiUrl: `https://api.example/${id}`,
    cgiUrl: 'https://cgi.example',
    isDefault: false,
    createdAt: 0,
    ...overrides,
  };
}

describe('sessions', () => {
  const profiles = new Map<ProfileId, Profile>([
    [aId, makeProfile(aId, { timezone: 'America/New_York' })],
    [bId, makeProfile(bId, { timezone: 'Europe/London' })],
  ]);
  let currentProfileId: ProfileId | null = aId;

  beforeEach(() => {
    vi.clearAllMocks();
    dropAllSessions();
    currentProfileId = aId;
    registerSessionsGate({
      getProfile: (id) => profiles.get(id),
      getCurrentProfileId: () => currentProfileId,
      reLoginFor: (id) => async () => {
        void id;
        return true;
      },
    });
  });

  it('lazily creates one session per profile and caches it', () => {
    const s1 = getSession(aId);
    const s2 = getSession(aId);

    expect(s1).toBe(s2);
    expect(getSession(bId)).not.toBe(s1);
    expect(s1.timezone).toBe('America/New_York');
  });

  it('builds the client via createStoreApiClient with the profile apiUrl and id', () => {
    getSession(aId);

    expect(createStoreApiClient).toHaveBeenCalledWith(
      'https://api.example/profile-a',
      expect.any(Function),
      aId,
    );
  });

  it('defaults timezone to UTC when the profile has none', () => {
    profiles.set(bId, makeProfile(bId, { timezone: undefined }));

    const session = getSession(bId);

    expect(session.timezone).toBe('UTC');
  });

  it('throws for ALL_PROFILES_ID and unknown ids', () => {
    expect(() => getSession(ALL_PROFILES_ID)).toThrow();
    expect(() => getSession(asProfileId('nope'))).toThrow();
  });

  it('throws for a virtual profile id, which names no server either (refs #337)', () => {
    expect(() => getSession(mintVirtualProfileId())).toThrow(/no session/);
  });

  it('dropSession evicts so the next get rebuilds', () => {
    const s1 = getSession(aId);
    dropSession(aId);

    expect(hasSession(aId)).toBe(false);
    expect(getSession(aId)).not.toBe(s1);
  });

  it('dropSession resets that profile\'s pending auth gates', () => {
    getSession(aId);
    vi.clearAllMocks();

    dropSession(aId);

    expect(resetAuthGates).toHaveBeenCalledWith(aId);
  });

  it('dropAllSessions resets every profile\'s pending auth gates', () => {
    getSession(aId);
    getSession(bId);
    vi.clearAllMocks();

    dropAllSessions();

    expect(resetAuthGates).toHaveBeenCalledWith();
  });

  it('getCurrentSession returns the session for the current profile', () => {
    currentProfileId = bId;

    const session = getCurrentSession();

    expect(session.profileId).toBe(bId);
  });

  it('getCurrentSession throws when there is no current profile', () => {
    currentProfileId = null;

    expect(() => getCurrentSession()).toThrow();
  });

  it('tryGetCurrentSession returns the session for the current profile', () => {
    currentProfileId = bId;

    const session = tryGetCurrentSession();

    expect(session?.profileId).toBe(bId);
  });

  it('tryGetCurrentSession returns null instead of throwing when there is no current profile', () => {
    currentProfileId = null;

    expect(tryGetCurrentSession()).toBeNull();
  });

  it('tryGetCurrentSession returns null instead of throwing for the ALL_PROFILES_ID sentinel', () => {
    currentProfileId = ALL_PROFILES_ID;

    expect(tryGetCurrentSession()).toBeNull();
  });

  it('tryGetCurrentSession returns null instead of throwing for a virtual profile (refs #337)', () => {
    currentProfileId = mintVirtualProfileId();

    expect(tryGetCurrentSession()).toBeNull();
  });

  it('tryGetCurrentSession returns null instead of throwing for the probe sentinel', () => {
    currentProfileId = PROBE_PROFILE_ID;

    expect(tryGetCurrentSession()).toBeNull();
  });

  describe('server map bootstrap on session creation (refs #337 I3)', () => {
    it('fires one populate against the new session\'s client', async () => {
      const session = getSession(aId);
      await flush();

      expect(getServers).toHaveBeenCalledTimes(1);
      expect(getServers).toHaveBeenCalledWith(session.client);
    });

    it('does not re-fire on a second getSession for the same profile', async () => {
      getSession(aId);
      await flush();
      vi.mocked(getServers).mockClear();

      getSession(aId);
      await flush();

      expect(getServers).not.toHaveBeenCalled();
    });

    it("gives the map the profile's address, so a blank-port server can be routed (refs #585)", async () => {
      const blankPort = (Id: string, Hostname: string) => ({ Id, Name: Id, Hostname, Port: 0 });
      vi.mocked(getServers).mockResolvedValueOnce([blankPort('1', 'api.example'), blankPort('2', 'other.example')] as never);

      getSession(aId);

      await vi.waitFor(() => expect([...getServerMap(aId).keys()]).toEqual(['2']));
    });

    it('leaves the server map empty without throwing when the fetch fails', async () => {
      vi.mocked(getServers).mockRejectedValueOnce(new Error('network down'));

      expect(() => getSession(aId)).not.toThrow();
      await flush();

      expect(getServerMap(aId).size).toBe(0);
    });
  });
});
