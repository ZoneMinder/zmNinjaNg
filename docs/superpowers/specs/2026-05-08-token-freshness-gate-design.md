# Token Freshness Gate

**Status:** Proposed
**Date:** 2026-05-08

## Problem

The server receives requests bearing access or refresh tokens that the client should know are stale. Three observed symptoms:

1. **ZMS streaming URLs.** Every visible monitor tile constructs `<img src=".../nph-zms?...&token=X">` with whatever value `useAuthStore.accessToken` holds at render time. There is no expiry pre-check at the URL-builder call sites (`hooks/useMonitorStream.ts:111`, `lib/url-builder.ts:120`). On app resume from background, every visible tile fires a request with the now-expired token before `useTokenRefresh` swaps it. ZMS logs `Unable to verify token: token expired` (`zm_crypt.cpp:121`) once per tile.

2. **`login.json` resurrected refresh token.** `api/client.ts:124-130` attaches `?token=<refreshToken>` to login requests when the store believes the refresh token is valid. The auth-store rehydration is async (the encrypted refresh token requires Web Crypto), and the merge can land **after** `clearStaleState()` ran `logout()`, resurrecting the cleared refresh token. The subsequent credentials login then carries a stale JWT in the query string. ZM logs `Unable to authenticate user. error decoding JWT token:Expired token` (`auth.php:130`).

3. **`refreshAccessToken` posts dead refresh tokens.** `stores/auth.ts:180-194` does not check `refreshTokenExpires` before posting the refresh token to `login.json`. If the persisted refresh token is past expiry, the server logs another JWT-decode error before the client falls through to logout.

## Goals

- The server is never hit with a token the client knows to be stale.
- All token-bearing URLs the browser/native loads directly (ZMS streams, event images and videos, Go2RTC WebSocket and HTTP, push-notification image backfills) carry an access token with at least 30 minutes of remaining validity.
- Cold-start, resume-from-background, and steady-state operation share one freshness gate; no path bypasses it.
- When the gate cannot produce a fresh token (refresh token expired, server rejected refresh), the client falls through to credentials re-login automatically using stored profile credentials.

## Non-goals

- Pre-flight expiry check on JSON API calls through `api/client.ts`. Those already retry on 401 via the existing `client.ts:155-178` path; adding the gate there is belt-and-suspenders. (One narrow change is included — see Architecture #4 — to skip attaching a known-expired access token, which removes one round-trip's worth of server-side error spam.)
- Adaptive leeway. 30 minutes is a fixed value, not a percentage of token TTL.
- UI to surface "auth refreshing" state. The existing `VideoOff` placeholder shows automatically while a tile's stream URL is empty.

## Architecture

### 1. Constant change

`lib/zmninja-ng-constants.ts`: `ZM_INTEGRATION.accessTokenLeewayMs` changes from `5 * 60 * 1000` to `30 * 60 * 1000`.

### 2. Auth store: `getFreshAccessToken` action

`stores/auth.ts`: add an action returning `Promise<string | null>`. Behavior:

1. If `accessToken` exists and `accessTokenExpires - Date.now() > leewayMs` → resolve immediately with `accessToken`.
2. Else, if a refresh is already in flight, await the same promise.
3. Else, kick off `refreshAccessToken()`. If it succeeds, resolve with the new `accessToken`.
4. If `refreshAccessToken` rejects, call the externally-injected `reLoginCallback()` (the credentials path). If it succeeds, resolve with the new `accessToken`.
5. If `reLoginCallback` also fails (or none is registered), resolve with `null`.

Concurrent callers share the in-flight promise via a module-level `pendingFreshToken` ref, mirroring the `pendingLogin` pattern at `auth.ts:110`.

The `reLoginCallback` is registered by `App.tsx` (or `profile-initialization.ts` after the API client is ready) via a setter `setReLoginCallback(fn)` on the auth store. This avoids a circular import between `stores/auth` and `stores/profile`.

### 3. Hook: `useFreshAccessToken`

`hooks/useFreshAccessToken.ts` (new file). Returns `{ token: string | null; isFresh: boolean }`.

```ts
export function useFreshAccessToken(): { token: string | null; isFresh: boolean } {
  const accessToken = useAuthStore((s) => s.accessToken);
  const accessTokenExpires = useAuthStore((s) => s.accessTokenExpires);
  const getFreshAccessToken = useAuthStore((s) => s.getFreshAccessToken);

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

The effect kicks off a refresh only when the gate is closed; the dedup in `getFreshAccessToken` ensures concurrent tiles share one network call.

### 4. `api/client.ts` cold-start fixes

- **Drop the resurrected-token branch (lines 124-130).** Login requests with form-encoded credentials never need `?token=` attached. `apiRefreshToken` (in `api/auth.ts:96`) constructs its own request with the token in the form body, not the query, so refresh-token login is unaffected.
- **Pre-check access token before attaching to params (line 120-122).** If `accessTokenExpires` exists and `accessTokenExpires - Date.now() <= 0`, await `useAuthStore.getState().getFreshAccessToken()` first, then attach the returned token. If the call returns `null`, proceed without a token (the request will likely 401 and the existing retry path handles it).

### 5. `stores/auth.ts` refresh pre-check

`refreshAccessToken` (lines 180-194): before calling `apiRefreshToken(refreshToken)`, check `refreshTokenExpires`. If null or `<= Date.now()`, throw `new Error('Refresh token expired')` synchronously. The existing `catch` block calls `logout()`. The gate's caller (`getFreshAccessToken`) catches that and falls through to `reLoginCallback()`.

### 6. Component-side gating

Each call site that builds a token-bearing URL the browser/native loads directly switches to `useFreshAccessToken()`. URL construction is gated on `isFresh`; while not fresh, the call site emits an empty/null URL, and the existing `VideoOff` placeholder (`components/video/VideoPlayer.tsx:301-313` and similar in `ZmsEventPlayer`, `EventThumbnail`, `MonitorHoverPreview`, `EventPreviewPopover`) shows through automatically.

Sites in scope:

| File | Construct |
|------|-----------|
| `hooks/useMonitorStream.ts` | Live MJPEG monitor streams |
| `components/events/ZmsEventPlayer.tsx` | Recorded event ZMS playback |
| `components/events/EventThumbnailHoverPreview.tsx` | Event hover ZMS preview |
| `components/events/EventListView.tsx`, `EventMontageView.tsx` | Event thumbnails (image URLs) |
| `components/events/EventThumbnail.tsx` | Event thumbnails |
| `components/timeline/EventPreviewPopover.tsx` | Timeline event thumbnails |
| `components/monitors/MonitorHoverPreview.tsx` | Hover live snapshot |
| `lib/thumbnail-chain.ts` | Thumbnail-fallback chain images |
| `pages/EventDetail.tsx` | Event image and video URLs |
| `hooks/useGo2RTCStream.ts` | WebRTC signaling and HTTP fallback |

For non-React async callsites (`services/eventPoller.ts:167`, `services/notifications.ts:446`), call `useAuthStore.getState().getFreshAccessToken()` directly and `await` the result before constructing the URL.

### 7. Eager keep-alive

`hooks/useTokenRefresh.ts` requires no logic change. The constant bump in #1 means the existing `if (timeUntilExpiry < ZM_INTEGRATION.accessTokenLeewayMs)` check now fires when <30 minutes remain, refreshing on the 60s interval and on `visibilitychange`. With a 2-hour ZM access-token TTL, this yields one refresh per ~90 minutes of uptime.

## Data flow

```
Cold start:
  Profile rehydrate → clearStaleState (logout) → API client init → isInitialized=true
                                                                    ↓
  Components mount → useFreshAccessToken returns { token: null, isFresh: false }
                                                                    ↓
                  → effect calls getFreshAccessToken() (no token + no refresh)
                                                                    ↓
                  → refreshAccessToken throws (no refresh token)
                                                                    ↓
                  → fall through to reLoginCallback() (credentials)
                                                                    ↓
                  → fresh accessToken set → subscribers re-render → URLs build with fresh token
```

```
Steady state, every ~90 min:
  useTokenRefresh interval fires, sees <30 min remaining, calls refreshAccessToken
                                                                    ↓
  Subscribers re-render with new accessToken; URLs rebuild with fresh token
```

```
Resume from background:
  visibilitychange → useTokenRefresh.checkAndRefresh fires
                                                                    ↓
  Concurrently: useFreshAccessToken effects in mounted components run
                                                                    ↓
  Both call getFreshAccessToken; dedup ensures one refresh
                                                                    ↓
  Until refresh resolves, isFresh=false → tiles emit empty URLs → VideoOff shows
                                                                    ↓
  Refresh resolves → isFresh=true → URLs rebuild with fresh token → server sees only fresh requests
```

## Failure modes

| Failure | Behavior |
|---------|----------|
| `getFreshAccessToken` called, no refresh token in store | Call `reLoginCallback()` (credentials), return new token |
| `getFreshAccessToken` called, refresh token expired | `refreshAccessToken` pre-check throws → `catch` calls `logout()` → gate caller falls through to `reLoginCallback()` |
| `refreshAccessToken` succeeds | Resolve with new access token |
| `refreshAccessToken` rejects (server 401, network) | Fall through to `reLoginCallback()` |
| `reLoginCallback` fails (no creds, wrong creds, network) | Logout, gate returns `null`. UI tiles show `VideoOff`. Existing route guards in `App.tsx` redirect to profile form on no-auth states. |
| Concurrent `getFreshAccessToken` callers | Share the in-flight promise via module-level dedup, same pattern as `pendingLogin` |

## Testing

### Unit tests

`stores/__tests__/auth.test.ts` additions:

- `getFreshAccessToken` returns immediately when token has >30 min remaining.
- `getFreshAccessToken` awaits in-flight refresh when <30 min remaining and returns the refreshed token.
- `getFreshAccessToken` falls through to `reLoginCallback` when `refreshAccessToken` rejects.
- `getFreshAccessToken` returns `null` when both refresh and re-login fail.
- Concurrent `getFreshAccessToken` callers receive the same promise (one network call).
- `refreshAccessToken` throws synchronously when `refreshTokenExpires` is null or past, without making a network request.

### Hook tests

`hooks/__tests__/useFreshAccessToken.test.tsx`:

- Returns `{ token: null, isFresh: false }` when access token has <30 min remaining.
- Returns `{ token: <fresh>, isFresh: true }` after gate-triggered refresh resolves.
- Effect does not retrigger refresh on every render while gate is closed (only while `isFresh` transitions from false).
- Cleans up subscription on unmount.

### E2E test

`tests/features/auth-token-freshness.feature`, `@web @android`:

```gherkin
Scenario: App resume with stale access token does not hit ZMS with stale token
  Given I am logged into zmNinjaNg with a server requiring auth
  And the access token expires in 10 minutes
  When I navigate to the Montage page
  Then the server should receive no ZMS request before the access token refreshes
  And the visible monitor tiles should show the no-video placeholder briefly
  And after the refresh completes the tiles should show live frames
  And every ZMS request after the refresh should carry the new access token
```

Implementation: the test pre-stages `accessTokenExpires` in localStorage to simulate near-expiry, intercepts ZMS requests via a Playwright route handler, and asserts no request matches the old token after the refresh fires.

### Manual verification

- Open the app cold with stored credentials; tail the ZM server logs. Expect zero `Unable to verify token` and zero `error decoding JWT token:Expired token` entries.
- Background the app for 2+ hours, then foreground. Expect the same.

## Migration

No persisted-state migration required. The `accessTokenLeewayMs` change applies on next render; no localStorage format change.

## Out of scope (deferred)

- JSON API pre-flight gating. The existing 401-retry path remains the safety net.
- Per-environment leeway tuning. 30 min is fixed.
- UI for "auth refreshing" state beyond the existing `VideoOff` placeholder.
