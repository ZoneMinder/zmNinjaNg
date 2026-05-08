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
