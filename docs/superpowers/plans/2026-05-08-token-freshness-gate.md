# Token Freshness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sending tokens the client knows to be stale to the ZoneMinder server. All token-bearing URLs the browser/native loads directly must carry an access token with ≥30 minutes of remaining validity. Refs #145.

**Architecture:** Add `getFreshAccessToken()` action and `useFreshAccessToken()` hook on top of the existing auth store. Components that build token-bearing URLs gate construction on `isFresh`; while not fresh, they emit empty URLs and the existing `VideoOff` placeholder shows through. Cold-start race fixes in `api/client.ts` and `auth.refreshAccessToken` close the remaining stale-token paths.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright + Cucumber.

**Spec:** `docs/superpowers/specs/2026-05-08-token-freshness-gate-design.md`

**Working directory for npm commands:** `app/`

---

## File Map

**Create:**
- `app/src/hooks/useFreshAccessToken.ts`
- `app/src/hooks/__tests__/useFreshAccessToken.test.tsx`
- `app/tests/features/auth-token-freshness.feature`

**Modify (foundation):**
- `app/src/lib/zmninja-ng-constants.ts` — leeway bump
- `app/src/stores/auth.ts` — `getFreshAccessToken`, `setReLoginCallback`, refresh-token pre-check
- `app/src/stores/__tests__/auth.test.ts` — tests for new actions
- `app/src/api/client.ts` — drop resurrected branch, pre-check access expiry
- `app/src/api/__tests__/client.test.ts` — covering the changes
- `app/src/stores/profile-initialization.ts` — register reLogin callback

**Modify (component gating, B-scope from spec):**
- `app/src/hooks/useMonitorStream.ts`
- `app/src/components/events/ZmsEventPlayer.tsx`
- `app/src/components/events/EventThumbnailHoverPreview.tsx`
- `app/src/pages/Events.tsx`
- `app/src/pages/EventMontage.tsx`
- `app/src/components/timeline/EventPreviewPopover.tsx`
- `app/src/components/monitors/MonitorHoverPreview.tsx`
- `app/src/pages/EventDetail.tsx`
- `app/src/services/eventPoller.ts` (async path)
- `app/src/services/notifications.ts` (async path)

**Out of scope:**
- `useGo2RTCStream` — current callers do not pass a `token` prop, so no stale-token risk via this path.
- JSON API pre-flight gating beyond the one `client.ts` access-token expiry check.

---

## Task 1: Bump access token leeway constant

**Files:**
- Modify: `app/src/lib/zmninja-ng-constants.ts:47`

- [ ] **Step 1: Make the change**

Open `app/src/lib/zmninja-ng-constants.ts`. Find:

```ts
accessTokenLeewayMs: 5 * 60 * 1000, // 5 minutes in milliseconds
```

Replace with:

```ts
accessTokenLeewayMs: 30 * 60 * 1000, // 30 minutes in milliseconds — gates URL construction; refresh fires when below this threshold
```

- [ ] **Step 2: Verify build**

Run from `app/`:

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/zmninja-ng-constants.ts
git commit -m "feat(auth): raise access token leeway to 30 min

refs #145"
```

---

## Task 2: Auth store — write failing test for `getFreshAccessToken`

**Files:**
- Modify: `app/src/stores/__tests__/auth.test.ts`

- [ ] **Step 1: Inspect existing test scaffold**

Read `app/src/stores/__tests__/auth.test.ts` to see the existing mock/setup pattern (mocks for `apiLogin`, `apiRefreshToken`, etc).

- [ ] **Step 2: Add a `describe('getFreshAccessToken')` block at the end of the file**

Append this block before the final closing brace of the outer `describe`:

```ts
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
      accessTokenExpires: Date.now() + 60_000, // 1 min ahead, below leeway
      refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
      isAuthenticated: true,
    });
    vi.mocked(apiRefreshToken).mockRejectedValueOnce(new Error('401'));
    const reLogin = vi.fn().mockResolvedValue(true);
    useAuthStore.getState().setReLoginCallback(reLogin);
    // Simulate reLogin populating the access token
    reLogin.mockImplementation(async () => {
      useAuthStore.setState({
        accessToken: 'after-relogin',
        accessTokenExpires: Date.now() + 2 * 60 * 60 * 1000,
        isAuthenticated: true,
      });
      return true;
    });
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
```

If `apiRefreshToken` is not already imported at the top of the file, add to the existing imports:

```ts
import { login as apiLogin, refreshToken as apiRefreshToken } from '../../api/auth';
```

- [ ] **Step 3: Run tests, expect failure**

```bash
cd app && npx vitest run src/stores/__tests__/auth.test.ts
```

Expected: failures for `getFreshAccessToken` (action does not exist) and `setReLoginCallback` (action does not exist).

- [ ] **Step 4: Commit failing tests**

```bash
git add app/src/stores/__tests__/auth.test.ts
git commit -m "test(auth): add failing tests for getFreshAccessToken and dedup

refs #145"
```

---

## Task 3: Auth store — implement `getFreshAccessToken` and `setReLoginCallback`

**Files:**
- Modify: `app/src/stores/auth.ts`

- [ ] **Step 1: Add types and module-level dedup ref**

Open `app/src/stores/auth.ts`. After the `pendingLogin` declaration around line 110, add:

```ts
/**
 * Module-level dedup for getFreshAccessToken(). Concurrent callers (multiple
 * monitor tiles, hover previews, services) share the same in-flight refresh
 * so we only hit /host/login.json once per stale window.
 */
let pendingFreshToken: Promise<string | null> | null = null;

/**
 * Credentials-based re-login callback registered by the profile store at app
 * init. Decoupled via a setter to avoid a circular import between auth and
 * profile stores.
 */
let reLoginCallback: (() => Promise<boolean>) | null = null;
```

- [ ] **Step 2: Extend the `AuthState` interface**

In the `AuthState` interface (around line 22), add:

```ts
  getFreshAccessToken: () => Promise<string | null>;
  setReLoginCallback: (callback: (() => Promise<boolean>) | null) => void;
```

- [ ] **Step 3: Import the leeway constant**

At the top of the file, add to the existing imports:

```ts
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';
```

- [ ] **Step 4: Implement the two actions inside the `create<AuthState>` block**

Find the `setTokens` action and add the new actions after it:

```ts
      setReLoginCallback: (callback) => {
        reLoginCallback = callback;
      },

      getFreshAccessToken: async () => {
        if (pendingFreshToken) {
          return pendingFreshToken;
        }

        const state = get();
        const now = Date.now();
        const hasFresh =
          !!state.accessToken &&
          !!state.accessTokenExpires &&
          state.accessTokenExpires - now > ZM_INTEGRATION.accessTokenLeewayMs;
        if (hasFresh) {
          return state.accessToken;
        }

        pendingFreshToken = (async (): Promise<string | null> => {
          try {
            await get().refreshAccessToken();
            return get().accessToken;
          } catch (refreshError) {
            log.auth(
              'Refresh failed in getFreshAccessToken; falling through to reLogin',
              LogLevel.WARN,
              { error: refreshError },
            );
            if (!reLoginCallback) {
              return null;
            }
            try {
              const ok = await reLoginCallback();
              if (!ok) return null;
              return get().accessToken;
            } catch (reLoginError) {
              log.auth(
                'reLogin failed in getFreshAccessToken',
                LogLevel.ERROR,
                { error: reLoginError },
              );
              return null;
            }
          }
        })();

        try {
          return await pendingFreshToken;
        } finally {
          pendingFreshToken = null;
        }
      },
```

- [ ] **Step 5: Run the tests, expect pass**

```bash
cd app && npx vitest run src/stores/__tests__/auth.test.ts
```

Expected: all `getFreshAccessToken` tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/stores/auth.ts
git commit -m "feat(auth): add getFreshAccessToken with dedup and reLogin fallback

refs #145"
```

---

## Task 4: Auth store — pre-check `refreshTokenExpires` in `refreshAccessToken`

**Files:**
- Modify: `app/src/stores/auth.ts:180-194`
- Modify: `app/src/stores/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing test**

Append to the auth test file inside the existing `describe('useAuthStore')`:

```ts
describe('refreshAccessToken expiry pre-check', () => {
  it('throws synchronously and does not call the network when refresh token is expired', async () => {
    useAuthStore.setState({
      refreshToken: 'expired-rt',
      refreshTokenExpires: Date.now() - 60_000,
    });
    vi.mocked(apiRefreshToken).mockClear();
    await expect(useAuthStore.getState().refreshAccessToken()).rejects.toThrow(
      /Refresh token expired/,
    );
    expect(apiRefreshToken).not.toHaveBeenCalled();
  });

  it('throws when refresh token expiry is missing', async () => {
    useAuthStore.setState({
      refreshToken: 'rt-no-expiry',
      refreshTokenExpires: null,
    });
    vi.mocked(apiRefreshToken).mockClear();
    await expect(useAuthStore.getState().refreshAccessToken()).rejects.toThrow();
    expect(apiRefreshToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd app && npx vitest run src/stores/__tests__/auth.test.ts -t "expiry pre-check"
```

Expected: both tests fail (network is called).

- [ ] **Step 3: Add the pre-check in `refreshAccessToken`**

Find `refreshAccessToken` around line 180 in `app/src/stores/auth.ts`. Replace its body so the function is:

```ts
      refreshAccessToken: async () => {
        const { refreshToken, refreshTokenExpires } = get();
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }
        if (!refreshTokenExpires || refreshTokenExpires <= Date.now()) {
          log.auth('Refresh token expired or missing expiry; skipping network call', LogLevel.WARN);
          get().logout();
          throw new Error('Refresh token expired');
        }

        try {
          const response = await apiRefreshToken(refreshToken);
          get().setTokens(response);
        } catch (error) {
          log.auth('Token refresh failed', LogLevel.ERROR, error);
          get().logout();
          throw error;
        }
      },
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd app && npx vitest run src/stores/__tests__/auth.test.ts
```

Expected: all auth tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/stores/auth.ts app/src/stores/__tests__/auth.test.ts
git commit -m "feat(auth): pre-check refresh token expiry before posting to server

refs #145"
```

---

## Task 5: `useFreshAccessToken` hook — failing test

**Files:**
- Create: `app/src/hooks/__tests__/useFreshAccessToken.test.tsx`

- [ ] **Step 1: Write the test file**

Create `app/src/hooks/__tests__/useFreshAccessToken.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFreshAccessToken } from '../useFreshAccessToken';
import { useAuthStore } from '../../stores/auth';

describe('useFreshAccessToken', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      accessTokenExpires: null,
      refreshToken: null,
      refreshTokenExpires: null,
      isAuthenticated: false,
    });
  });

  it('returns isFresh=true with the token when expiry is comfortably ahead', () => {
    useAuthStore.setState({
      accessToken: 'fresh',
      accessTokenExpires: Date.now() + 60 * 60 * 1000, // 1 hour
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBe('fresh');
  });

  it('returns isFresh=false with token=null when expiry is below the leeway', () => {
    useAuthStore.setState({
      accessToken: 'stale',
      accessTokenExpires: Date.now() + 5 * 60 * 1000, // 5 min, under 30-min leeway
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('returns isFresh=false when there is no token', () => {
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('triggers getFreshAccessToken when not fresh', () => {
    const spy = vi.fn(async () => 'new');
    useAuthStore.setState({
      accessToken: 'stale',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
      getFreshAccessToken: spy as never,
    });
    renderHook(() => useFreshAccessToken());
    expect(spy).toHaveBeenCalled();
  });

  it('does not retrigger refresh while fresh', () => {
    const spy = vi.fn(async () => 'tok');
    useAuthStore.setState({
      accessToken: 'tok',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      isAuthenticated: true,
      getFreshAccessToken: spy as never,
    });
    const { rerender } = renderHook(() => useFreshAccessToken());
    rerender();
    rerender();
    expect(spy).not.toHaveBeenCalled();
  });

  it('flips to fresh when accessTokenExpires updates', () => {
    useAuthStore.setState({
      accessToken: 'old',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    act(() => {
      useAuthStore.setState({
        accessToken: 'new',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
      });
    });
    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBe('new');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd app && npx vitest run src/hooks/__tests__/useFreshAccessToken.test.tsx
```

Expected: imports fail because `useFreshAccessToken` does not exist.

- [ ] **Step 3: Commit failing tests**

```bash
git add app/src/hooks/__tests__/useFreshAccessToken.test.tsx
git commit -m "test(auth): add failing tests for useFreshAccessToken hook

refs #145"
```

---

## Task 6: `useFreshAccessToken` hook — implementation

**Files:**
- Create: `app/src/hooks/useFreshAccessToken.ts`

- [ ] **Step 1: Write the hook**

Create `app/src/hooks/useFreshAccessToken.ts`:

```ts
/**
 * useFreshAccessToken
 *
 * Returns an access token only when it has at least
 * `ZM_INTEGRATION.accessTokenLeewayMs` of validity remaining. Otherwise
 * returns `{ token: null, isFresh: false }` and asks the auth store to
 * refresh in the background. Subscribers re-render once the new token
 * lands.
 *
 * Used by every callsite that builds a token-bearing URL the browser or
 * native runtime loads directly (ZMS streams, event images and videos,
 * push-notification image backfills). Construct the URL only when
 * `isFresh` is true; while not fresh, render the existing VideoOff
 * placeholder by emitting an empty URL.
 */

import { useEffect } from 'react';
import { useAuthStore } from '../stores/auth';
import { ZM_INTEGRATION } from '../lib/zmninja-ng-constants';

export interface FreshAccessToken {
  token: string | null;
  isFresh: boolean;
}

export function useFreshAccessToken(): FreshAccessToken {
  const accessToken = useAuthStore((state) => state.accessToken);
  const accessTokenExpires = useAuthStore((state) => state.accessTokenExpires);
  const getFreshAccessToken = useAuthStore((state) => state.getFreshAccessToken);

  const isFresh =
    !!accessToken &&
    !!accessTokenExpires &&
    accessTokenExpires - Date.now() > ZM_INTEGRATION.accessTokenLeewayMs;

  useEffect(() => {
    if (!isFresh) {
      void getFreshAccessToken();
    }
  }, [isFresh, getFreshAccessToken]);

  return { token: isFresh ? accessToken : null, isFresh };
}
```

- [ ] **Step 2: Run hook tests, expect pass**

```bash
cd app && npx vitest run src/hooks/__tests__/useFreshAccessToken.test.tsx
```

Expected: all six tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useFreshAccessToken.ts
git commit -m "feat(auth): add useFreshAccessToken hook

refs #145"
```

---

## Task 7: Register `reLogin` callback at app init

**Files:**
- Modify: `app/src/stores/profile-initialization.ts:110-122`

- [ ] **Step 1: Inject the callback when the API client is initialized**

Open `app/src/stores/profile-initialization.ts`. Find `initializeApiClient`:

```ts
async function initializeApiClient(
  profile: Profile,
  reLogin: () => Promise<boolean>
): Promise<void> {
  const apiClientStart = Date.now();
  log.profileService('Initializing API client', LogLevel.INFO, {
    apiUrl: profile.apiUrl,
  });

  setApiClient(createApiClient(profile.apiUrl, reLogin));
  logDuration('Bootstrap step: API client ready', apiClientStart, {
    apiUrl: profile.apiUrl,
  });
}
```

Replace with:

```ts
async function initializeApiClient(
  profile: Profile,
  reLogin: () => Promise<boolean>
): Promise<void> {
  const apiClientStart = Date.now();
  log.profileService('Initializing API client', LogLevel.INFO, {
    apiUrl: profile.apiUrl,
  });

  setApiClient(createApiClient(profile.apiUrl, reLogin));

  // Wire the same credentials reLogin into the auth store so
  // getFreshAccessToken can fall through to it when refresh fails.
  const { useAuthStore } = await import('./auth');
  useAuthStore.getState().setReLoginCallback(reLogin);

  logDuration('Bootstrap step: API client ready', apiClientStart, {
    apiUrl: profile.apiUrl,
  });
}
```

- [ ] **Step 2: Build**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run unit tests for affected stores**

```bash
cd app && npx vitest run src/stores
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/stores/profile-initialization.ts
git commit -m "feat(auth): wire reLogin callback into auth store at app init

refs #145"
```

---

## Task 8: `api/client.ts` — drop resurrected refresh-token branch

**Files:**
- Modify: `app/src/api/client.ts:124-130`

- [ ] **Step 1: Inspect existing tests**

Read `app/src/api/__tests__/client.test.ts` to see existing test scaffolding.

- [ ] **Step 2: Add a failing test asserting login.json never carries a `?token=` param**

Append to the existing `describe('createApiClient'` block in `app/src/api/__tests__/client.test.ts`:

```ts
it('never attaches refresh token to the login.json query string when posting credentials', async () => {
  // Simulate the rehydration race: refresh token has been resurrected after logout.
  useAuthStore.setState({
    accessToken: null,
    refreshToken: 'rehydrated-rt',
    refreshTokenExpires: Date.now() + 24 * 60 * 60 * 1000,
    isAuthenticated: false,
  });

  const httpRequestSpy = vi.mocked(httpRequest);
  httpRequestSpy.mockResolvedValueOnce({
    data: { access_token: 'a', refresh_token: 'r', access_token_expires: 7200, refresh_token_expires: 86400 },
    status: 200,
    statusText: 'OK',
    headers: {},
  } as never);

  const client = createApiClient('https://zm.example.com/api');
  const formBody = new URLSearchParams({ user: 'admin', pass: 'secret' }).toString();
  await client.post('/host/login.json', formBody, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  expect(httpRequestSpy).toHaveBeenCalled();
  const callArgs = httpRequestSpy.mock.calls[0][1];
  expect(callArgs.params?.token).toBeUndefined();
});
```

If `useAuthStore` and `httpRequest` are not yet imported in this test file, add them following the patterns already in the file.

- [ ] **Step 3: Run, expect failure**

```bash
cd app && npx vitest run src/api/__tests__/client.test.ts -t "never attaches refresh token"
```

Expected: failure — current code attaches the token.

- [ ] **Step 4: Remove the branch**

In `app/src/api/client.ts`, delete lines 124-130:

```ts
    if (isLoginRequest && !skipAuth) {
      const nowMs = Date.now();
      const isRefreshTokenValid = refreshToken && refreshTokenExpires && refreshTokenExpires > nowMs;
      if (isRefreshTokenValid) {
        params.token = refreshToken;
      }
    }
```

Also remove `refreshToken` and `refreshTokenExpires` from the destructuring at line 71 since they're no longer used in this scope:

```ts
const { accessToken, isAuthenticated } = useAuthStore.getState();
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd app && npx vitest run src/api/__tests__/client.test.ts
```

Expected: pass.

- [ ] **Step 6: Build**

```bash
cd app && npx tsc --noEmit
```

Expected: clean (verify no other references to the removed destructured fields).

- [ ] **Step 7: Commit**

```bash
git add app/src/api/client.ts app/src/api/__tests__/client.test.ts
git commit -m "fix(auth): never attach refresh token to login.json query string

The branch could resurrect a cleared refresh token via Zustand persist's
async rehydration race and ship it as ?token= alongside form-encoded
credentials, producing 'error decoding JWT token:Expired token' entries
on the server. Credentials in the body are sufficient.

refs #145"
```

---

## Task 9: `api/client.ts` — pre-check access token expiry before attaching

**Files:**
- Modify: `app/src/api/client.ts:120-122`

- [ ] **Step 1: Add a failing test**

Append to `app/src/api/__tests__/client.test.ts`:

```ts
it('does not attach an expired access token to outgoing requests', async () => {
  useAuthStore.setState({
    accessToken: 'expired-at',
    accessTokenExpires: Date.now() - 60_000,
    refreshToken: null,
    refreshTokenExpires: null,
    isAuthenticated: true,
  });

  const httpRequestSpy = vi.mocked(httpRequest);
  httpRequestSpy.mockResolvedValueOnce({
    data: {},
    status: 200,
    statusText: 'OK',
    headers: {},
  } as never);

  const client = createApiClient('https://zm.example.com/api');
  await client.get('/monitors.json');

  const callArgs = httpRequestSpy.mock.calls[0][1];
  expect(callArgs.params?.token).not.toBe('expired-at');
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd app && npx vitest run src/api/__tests__/client.test.ts -t "does not attach an expired"
```

Expected: failure.

- [ ] **Step 3: Replace the access-token attach block**

In `app/src/api/client.ts`, find:

```ts
    if (accessToken && !skipAuth && !isLoginRequest) {
      params.token = accessToken;
    }
```

Replace with:

```ts
    if (accessToken && !skipAuth && !isLoginRequest) {
      const { accessTokenExpires } = useAuthStore.getState();
      const isAccessTokenExpired = accessTokenExpires !== null && accessTokenExpires <= Date.now();
      if (isAccessTokenExpired) {
        log.api(
          `Skipping attached token; expired by ${Date.now() - (accessTokenExpires ?? 0)}ms — refreshing first`,
          LogLevel.DEBUG,
          { correlationId, method, url },
        );
        const fresh = await useAuthStore.getState().getFreshAccessToken();
        if (fresh) {
          params.token = fresh;
        }
      } else {
        params.token = accessToken;
      }
    }
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd app && npx vitest run src/api/__tests__/client.test.ts
```

Expected: pass.

- [ ] **Step 5: Build**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/api/client.ts app/src/api/__tests__/client.test.ts
git commit -m "fix(auth): refresh access token before attaching when known to be expired

refs #145"
```

---

## Task 10: Gate `useMonitorStream`

**Files:**
- Modify: `app/src/hooks/useMonitorStream.ts`

- [ ] **Step 1: Replace the access-token subscription with the freshness hook**

In `app/src/hooks/useMonitorStream.ts`, find:

```ts
import { useAuthStore } from '../stores/auth';
```

Replace with:

```ts
import { useFreshAccessToken } from './useFreshAccessToken';
```

Find:

```ts
const accessToken = useAuthStore((state) => state.accessToken);
```

Replace with:

```ts
const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
```

Find the streamUrl construction (around line 103):

```ts
const streamUrl = currentProfile && connKey !== 0
  ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, {
```

Replace with:

```ts
const streamUrl = currentProfile && connKey !== 0 && isAccessTokenFresh
  ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, {
```

- [ ] **Step 2: Build**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run unit tests**

```bash
cd app && npx vitest run src/hooks
```

Expected: pass. If `useMonitorStream.test.tsx` exists and breaks, update its mocks of `useAuthStore` to instead mock `useFreshAccessToken` returning `{ token: 'test-token', isFresh: true }`.

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useMonitorStream.ts $(if [ -f app/src/hooks/__tests__/useMonitorStream.test.tsx ]; then echo app/src/hooks/__tests__/useMonitorStream.test.tsx; fi)
git commit -m "feat(auth): gate live monitor stream URL on token freshness

refs #145"
```

---

## Task 11: Gate `ZmsEventPlayer` (recorded event playback)

**Files:**
- Modify: `app/src/components/events/ZmsEventPlayer.tsx`

- [ ] **Step 1: Inspect the component to find where the token is read**

Run:

```bash
grep -n "useAuthStore\|accessToken\|getEventZmsUrl\|getEventImageUrl" app/src/components/events/ZmsEventPlayer.tsx
```

Note each line that constructs an event URL with a token.

- [ ] **Step 2: Replace `useAuthStore` access-token reads with `useFreshAccessToken`**

At the top of `app/src/components/events/ZmsEventPlayer.tsx`, replace:

```ts
import { useAuthStore } from '../../stores/auth';
```

with:

```ts
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
```

Replace any line of the form:

```ts
const accessToken = useAuthStore((s) => s.accessToken);
```

with:

```ts
const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
```

If the file reads other auth-store fields besides `accessToken` (e.g., `version`), keep those subscriptions via `useAuthStore` — only replace the `accessToken` read.

- [ ] **Step 3: Gate URL construction**

Find each `getEventZmsUrl(...)` and `getEventImageUrl(...)` call. Wrap each so it only runs when `isAccessTokenFresh` is true. The pattern depends on whether the URL is built inside `useMemo` or inline — keep the existing memoization shape:

For inline expressions, change e.g.:

```ts
return getEventZmsUrl(portalUrl, eventId, { ... });
```

to:

```ts
return isAccessTokenFresh ? getEventZmsUrl(portalUrl, eventId, { ... }) : '';
```

For `useMemo`, add `isAccessTokenFresh` to the deps array and gate inside:

```ts
const streamUrl = useMemo(() => {
  if (!isAccessTokenFresh) return '';
  return getEventZmsUrl(portalUrl, eventId, { token: accessToken ?? undefined, ... });
}, [portalUrl, eventId, accessToken, isAccessTokenFresh, ...]);
```

For `<img src={getEventImageUrl(...)} />` patterns, wrap the JSX `src` value:

```tsx
<img src={isAccessTokenFresh ? getEventImageUrl(...) : undefined} />
```

The existing `VideoOff` placeholder at `ZmsEventPlayer.tsx:265-267` will show through.

- [ ] **Step 4: Build**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Run unit tests**

```bash
cd app && npx vitest run src/components/events
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/events/ZmsEventPlayer.tsx
git commit -m "feat(auth): gate event ZMS playback URLs on token freshness

refs #145"
```

---

## Task 12: Gate `EventThumbnailHoverPreview`

**Files:**
- Modify: `app/src/components/events/EventThumbnailHoverPreview.tsx`

- [ ] **Step 1: Replace the access-token read**

In `app/src/components/events/EventThumbnailHoverPreview.tsx`:

Replace:

```ts
import { useAuthStore } from '../../stores/auth';
```

with:

```ts
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
```

Replace:

```ts
const accessToken = useAuthStore((s) => s.accessToken);
```

with:

```ts
const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
```

- [ ] **Step 2: Gate the streamUrl**

Find the `streamUrl` construction (around line 84):

```ts
const streamUrl = portalUrl
  ? getEventZmsUrl(portalUrl, descriptor.eventId, {
      ...tokenOpts,
      connkey,
      rate: 100,
      maxfps: 30,
      replay: 'single',
    })
  : '';
```

Replace with:

```ts
const streamUrl = portalUrl && isAccessTokenFresh
  ? getEventZmsUrl(portalUrl, descriptor.eventId, {
      ...tokenOpts,
      connkey,
      rate: 100,
      maxfps: 30,
      replay: 'single',
    })
  : '';
```

- [ ] **Step 3: Build and test**

```bash
cd app && npx tsc --noEmit && npx vitest run src/components/events
```

Expected: clean and pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/events/EventThumbnailHoverPreview.tsx
git commit -m "feat(auth): gate event hover preview URL on token freshness

refs #145"
```

---

## Task 13: Gate `Events` page (passes token down to list and montage views)

**Files:**
- Modify: `app/src/pages/Events.tsx`

- [ ] **Step 1: Replace the access-token subscription**

In `app/src/pages/Events.tsx` find:

```ts
import { useAuthStore } from '../stores/auth';
```

Add (keep `useAuthStore` only if other fields like `isAuthenticated` are used; based on the earlier grep, both `accessToken` and `isAuthenticated` are read from the store):

```ts
import { useFreshAccessToken } from '../hooks/useFreshAccessToken';
```

Replace:

```ts
const accessToken = useAuthStore((state) => state.accessToken);
```

with:

```ts
const { token: accessToken } = useFreshAccessToken();
```

Leave `isAuthenticated` subscription alone.

- [ ] **Step 2: Verify downstream**

The two callsites (around 527 and 543):

```tsx
accessToken={accessToken || undefined}
```

become naturally gated: when `isFresh` is false, `accessToken` is null, the `|| undefined` evaluates to `undefined`, and child components receive no token. They construct URLs without a token, which means the existing thumbnail URLs render an unauth fallback. To skip URL construction entirely when not fresh, pull `isFresh` too:

```ts
const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
```

and pass:

```tsx
accessToken={isAccessTokenFresh ? accessToken ?? undefined : undefined}
```

at both callsites. (Same change in the `EventMontageView` line.)

- [ ] **Step 3: Build and test**

```bash
cd app && npx tsc --noEmit && npx vitest run src/pages/__tests__/Events.test.tsx
```

Expected: clean and pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/Events.tsx
git commit -m "feat(auth): gate Events-page passed-down token on freshness

refs #145"
```

---

## Task 14: Gate `EventMontage` page

**Files:**
- Modify: `app/src/pages/EventMontage.tsx`

- [ ] **Step 1: Find the access-token read**

```bash
grep -n "useAuthStore\|accessToken" app/src/pages/EventMontage.tsx
```

- [ ] **Step 2: Apply the same pattern as Task 13**

Replace `useAuthStore`'s `accessToken` read with `useFreshAccessToken`. At the `<EventMontageView accessToken={...}>` callsite (around line 289), pass `isAccessTokenFresh ? accessToken ?? undefined : undefined`.

- [ ] **Step 3: Build and test**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/EventMontage.tsx
git commit -m "feat(auth): gate EventMontage page token on freshness

refs #145"
```

---

## Task 15: Gate `MonitorHoverPreview`

**Files:**
- Modify: `app/src/components/monitors/MonitorHoverPreview.tsx`

- [ ] **Step 1: Replace the access-token read and gate URL construction**

In `app/src/components/monitors/MonitorHoverPreview.tsx`:

Replace:

```ts
import { useAuthStore } from '../../stores/auth';
```

with:

```ts
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
```

Replace:

```ts
const accessToken = useAuthStore((state) => state.accessToken);
```

with:

```ts
const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
```

Find the `getEventImageUrl(...)` (around line 85) call and gate it: wrap whatever URL expression includes `token: accessToken || undefined` so that the URL is empty unless `isAccessTokenFresh` is true. The existing `VideoOff` placeholder at line 78 covers the empty state.

- [ ] **Step 2: Build and test**

```bash
cd app && npx tsc --noEmit && npx vitest run src/components/monitors
```

Expected: clean and pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/monitors/MonitorHoverPreview.tsx
git commit -m "feat(auth): gate monitor hover preview URL on token freshness

refs #145"
```

---

## Task 16: Gate `EventPreviewPopover` (timeline)

**Files:**
- Modify: `app/src/components/timeline/EventPreviewPopover.tsx`

- [ ] **Step 1: Inspect**

```bash
grep -n "useAuthStore\|accessToken\|getEventImageUrl" app/src/components/timeline/EventPreviewPopover.tsx
```

- [ ] **Step 2: Apply the standard gate**

Replace any `useAuthStore((s) => s.accessToken)` with `const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();`. Wrap each `getEventImageUrl(...)` call so the resulting URL is empty when `isAccessTokenFresh` is false. The existing `VideoOff` icon at line 152 is the placeholder.

- [ ] **Step 3: Build and test**

```bash
cd app && npx tsc --noEmit && npx vitest run src/components/timeline
```

Expected: clean and pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/timeline/EventPreviewPopover.tsx
git commit -m "feat(auth): gate timeline event preview URL on token freshness

refs #145"
```

---

## Task 17: Gate `EventDetail` page (image and video)

**Files:**
- Modify: `app/src/pages/EventDetail.tsx`

- [ ] **Step 1: Inspect**

```bash
grep -n "useAuthStore\|accessToken\|getEventVideoUrl\|getEventImageUrl" app/src/pages/EventDetail.tsx
```

- [ ] **Step 2: Apply the standard gate**

Same pattern: replace `useAuthStore((state) => state.accessToken)` with `useFreshAccessToken()`. Wrap each `getEventImageUrl(...)` and `getEventVideoUrl(...)` URL so it's empty/unset until `isAccessTokenFresh` is true.

- [ ] **Step 3: Build and test**

```bash
cd app && npx tsc --noEmit && npx vitest run src/pages
```

Expected: clean and pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/EventDetail.tsx
git commit -m "feat(auth): gate event detail image and video URLs on token freshness

refs #145"
```

---

## Task 18: Gate non-React async paths (eventPoller, notifications)

**Files:**
- Modify: `app/src/services/eventPoller.ts:167`
- Modify: `app/src/services/notifications.ts:445-449`

- [ ] **Step 1: Update eventPoller**

Open `app/src/services/eventPoller.ts`. Find the URL construction near line 167 that uses `useAuthStore.getState().accessToken`. Replace with `await useAuthStore.getState().getFreshAccessToken()`. The surrounding function must already be `async` — if so, just `await`. If the URL is built outside an async context, hoist the URL build into the async caller.

Change pattern:

```ts
const token = useAuthStore.getState().accessToken;
const url = getEventImageUrl(eventPortalUrl, String(eventId), 'snapshot', { token: token ?? undefined, ... });
```

to:

```ts
const token = await useAuthStore.getState().getFreshAccessToken();
const url = token
  ? getEventImageUrl(eventPortalUrl, String(eventId), 'snapshot', { token, ... })
  : '';
```

If `url` is empty, skip emitting the URL (or skip the surrounding push-notification image backfill — the notification still appears, just without a thumbnail).

- [ ] **Step 2: Update notifications service**

Open `app/src/services/notifications.ts`. Find lines 445-449:

```ts
const currentToken = useAuthStore.getState().accessToken;
let imageUrl = `${this.config.portalUrl}/index.php?view=image&eid=${event.EventId}&fid=snapshot&width=600`;
if (currentToken) {
  imageUrl += `&token=${currentToken}`;
}
event.ImageUrl = imageUrl;
```

Replace with:

```ts
const currentToken = await useAuthStore.getState().getFreshAccessToken();
let imageUrl = `${this.config.portalUrl}/index.php?view=image&eid=${event.EventId}&fid=snapshot&width=600`;
if (currentToken) {
  imageUrl += `&token=${currentToken}`;
}
event.ImageUrl = imageUrl;
```

The enclosing block at line 430 (`for (const event of message.events) { ... }`) is inside an async handler (`_handleMessage` in the WebSocket handler), so `await` is allowed. Confirm by checking the function signature is `async` — if it isn't, wrap the per-event work in `await Promise.all(message.events.map(async (event) => { ... }))` instead of the `for ... of`.

- [ ] **Step 3: Build and test**

```bash
cd app && npx tsc --noEmit && npx vitest run src/services
```

Expected: clean and pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/services/eventPoller.ts app/src/services/notifications.ts
git commit -m "feat(auth): use getFreshAccessToken in poller and notifications services

refs #145"
```

---

## Task 19: Gate `lib/thumbnail-chain.ts` callers

**Files:**
- Inspect: `app/src/lib/thumbnail-chain.ts`
- Modify: callers identified in inspection

- [ ] **Step 1: Inspect chain consumers**

```bash
grep -rn "buildThumbnailChain" app/src --include="*.ts" --include="*.tsx"
```

The chain itself is sync and takes a `token` option. The fix is at each caller, not in the chain. Each caller already runs inside a React component — so the same `useFreshAccessToken` pattern applies.

- [ ] **Step 2: For each caller (e.g. `EventListView.tsx`, `EventMontageView.tsx`, `EventCard.tsx`, `EventThumbnail.tsx`), pass `undefined` instead of `accessToken` while not fresh**

For caller files that already accept `accessToken` as a prop (like `EventListView`, `EventMontageView`), no change is required — Task 13 and Task 14 already gate the prop at the page level, so the chain receives `undefined` while not fresh.

For files that read auth-store directly inside the component, replace with the standard `useFreshAccessToken` pattern from prior tasks. Identify them with:

```bash
grep -l "buildThumbnailChain" app/src/components | xargs grep -l "useAuthStore"
```

For each match, apply the standard substitution.

- [ ] **Step 3: Build**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/components
git commit -m "feat(auth): gate thumbnail-chain consumers on token freshness

refs #145"
```

(If the inspection in Step 2 finds no direct-store callers, skip Steps 3 and 4 and note in PR body that no change was needed here.)

---

## Task 20: E2E feature — token freshness gate

**Files:**
- Create: `app/tests/features/auth-token-freshness.feature`

- [ ] **Step 1: Write the feature file**

Create `app/tests/features/auth-token-freshness.feature`:

```gherkin
Feature: Token freshness gate
  The app must not hit the server with access tokens it knows are stale.
  When the access token has less than 30 minutes remaining, the app must
  refresh before constructing any ZMS or event-image URL.

  @web @android
  Scenario: Stale access token at app load does not hit ZMS with the stale token
    Given I am logged into zmNinjaNg with a server requiring auth
    And the stored access token expires in 10 minutes
    When I navigate to the Montage page
    Then the server should receive no ZMS request bearing the stale access token
    And the visible monitor tiles should briefly show the no-video placeholder
    And after the refresh completes the tiles should show live frames
    And every ZMS request after the refresh should carry a different access token
```

- [ ] **Step 2: Add step definitions**

Inspect existing step files to find the right location:

```bash
ls app/tests/steps/
```

Add a new file `app/tests/steps/auth-freshness.steps.ts` (or extend an existing montage steps file if there's an obvious match):

```ts
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { TestActions } from '../helpers/test-actions';

const stalenessMarker = 'STALE-TOKEN-MARKER';

Given('the stored access token expires in {int} minutes', async function ({ page }: { page: Awaited<ReturnType<TestActions['page']>> }, mins: number) {
  await page.evaluate(({ marker, future }: { marker: string; future: number }) => {
    const raw = localStorage.getItem('zmng-auth');
    if (!raw) throw new Error('zmng-auth not set; user must be logged in first');
    const parsed = JSON.parse(raw);
    parsed.state.accessToken = marker;
    parsed.state.accessTokenExpires = future;
    localStorage.setItem('zmng-auth', JSON.stringify(parsed));
  }, { marker: stalenessMarker, future: Date.now() + mins * 60_000 });
});

Then('the server should receive no ZMS request bearing the stale access token', async function ({ requestLog }: { requestLog: { url: string }[] }) {
  const stale = requestLog.filter((r) => r.url.includes(`token=${stalenessMarker}`));
  expect(stale).toHaveLength(0);
});

Then('every ZMS request after the refresh should carry a different access token', async function ({ requestLog }: { requestLog: { url: string }[] }) {
  const zmsReqs = requestLog.filter((r) => /nph-zms/.test(r.url));
  expect(zmsReqs.length).toBeGreaterThan(0);
  for (const r of zmsReqs) {
    expect(r.url).not.toContain(`token=${stalenessMarker}`);
  }
});
```

The `requestLog` fixture is the existing Playwright route-handler test fixture used elsewhere — locate it by searching:

```bash
grep -rn "requestLog" app/tests/
```

If no such fixture exists, add one in `app/tests/helpers/` that records every request URL via `page.route('**/*')`. (If this prerequisite is missing, capture it in the PR description as follow-up work.)

The `the visible monitor tiles should briefly show the no-video placeholder` and `after the refresh completes the tiles should show live frames` steps may already have implementations elsewhere. Search:

```bash
grep -rn "no-video placeholder\|live frames" app/tests/steps/
```

If they don't, add them in the new steps file matching the pattern of other existing tile-state assertions. Locate `data-testid` of the `VideoOff` placeholder layer in `VideoPlayer.tsx` and assert visibility/invisibility.

- [ ] **Step 3: Run the e2e**

```bash
cd app && npm run test:e2e -- auth-token-freshness.feature
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add app/tests/features/auth-token-freshness.feature app/tests/steps/auth-freshness.steps.ts $(if [ -d app/tests/helpers ]; then echo app/tests/helpers; fi)
git commit -m "test(auth): e2e for token freshness gate

refs #145"
```

---

## Task 21: Update i18n if any new user-facing string was added

**Files:**
- Modify if needed: `app/src/locales/{en,de,es,fr,zh}/translation.json`

- [ ] **Step 1: Check for new strings**

If any task above introduced a new visible string (e.g., a "refreshing auth" toast), it would have been called out. The plan does not introduce any. Confirm:

```bash
git diff main -- 'app/src/**/*.tsx' 'app/src/**/*.ts' | grep -E '"[A-Z][a-z]+ [a-z]+'
```

If no new visible strings, skip this task.

- [ ] **Step 2: If strings were added, update all five locale files with the new keys.**

Strings must be short. AGENTS.md rule #23 — concise i18n labels.

---

## Task 22: Documentation

**Files:**
- Modify: `docs/developer-guide/` (relevant chapter)

- [ ] **Step 1: Decide which chapter**

The relevant chapter is `12-shared-services-and-components.rst` (utilities/hooks chapter per AGENTS.md). Add a section for `useFreshAccessToken` and the auth store's `getFreshAccessToken` action.

- [ ] **Step 2: Write the section**

Add to the chapter:

```rst
Token freshness gate
--------------------

``useFreshAccessToken`` (``hooks/useFreshAccessToken.ts``) returns ``{ token, isFresh }``
where ``isFresh`` is true only when the access token has more than
``ZM_INTEGRATION.accessTokenLeewayMs`` (30 minutes) of validity remaining. While not
fresh, the hook returns ``token: null`` and asks the auth store to refresh in the
background. Any callsite that builds a token-bearing URL the browser or native
runtime loads directly (ZMS streams, event images and videos, push-notification
image backfills) must gate URL construction on ``isFresh``. While not fresh, emit
an empty URL and the existing ``VideoOff`` placeholder shows through.

For non-React async paths, call ``useAuthStore.getState().getFreshAccessToken()``
directly. The action dedupes concurrent callers, falls through from refresh to
credentials re-login on failure, and resolves with ``null`` if both fail.
```

- [ ] **Step 3: Commit**

```bash
git add docs/developer-guide/12-shared-services-and-components.rst
git commit -m "docs: document token freshness gate hook and action

refs #145"
```

---

## Task 23: Verification before merge

**Files:**
- None (run-only)

- [ ] **Step 1: Run unit tests**

```bash
cd app && npm test
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

```bash
cd app && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run build**

```bash
cd app && npm run build
```

Expected: success. AGENTS.md rule #3 — `npm run build` (not just `tsc --noEmit`) must pass.

- [ ] **Step 4: Run web e2e tests**

```bash
cd app && npm run test:e2e
```

Expected: pass.

- [ ] **Step 5: Manual verification with a live ZM server**

Tail the ZoneMinder server logs. Then:

1. Force-quit and relaunch the app. Confirm zero `Unable to verify token: token expired` and zero `error decoding JWT token:Expired token` entries.
2. Background the app for at least 2 hours (or set the ZM access token TTL low for the test). Foreground. Confirm the same.

- [ ] **Step 6: State the verification status in the PR description**

"Tests verified: npm test ✓, tsc --noEmit ✓, build ✓, test:e2e ✓, manual ZM-log tail ✓"

---

## Summary

23 tasks. Foundation (1–9) is the auth store and API client core. Component gating (10–19) is the surface area. E2E (20), i18n check (21), docs (22), and final verification (23) close it out. Every task is TDD where reasonable; every commit references issue #145.
