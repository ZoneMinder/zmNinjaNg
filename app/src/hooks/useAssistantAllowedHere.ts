/**
 * Whether the assistant may run on this install's App Store storefront.
 *
 * China mainland requires a filed and approved model for any AI chatbot, and
 * the app has none, so the assistant is off on that storefront (refs #587).
 * Only iOS has a storefront; every other platform is allowed straight away.
 * undefined while the native lookup is in flight, so the assistant never
 * flashes on in China. A failed lookup allows it, as with no storefront.
 *
 * ponytail: read once per launch; a storefront change (Storefront.updates)
 * takes effect on the next launch.
 */

import { useEffect, useState } from 'react';
import { Platform } from '../lib/platform';
import { ASSISTANT_BLOCKED_STOREFRONTS } from '../lib/zmninja-ng-constants';

let lookup: Promise<boolean> | undefined;

function lookUpAllowed(): Promise<boolean> {
  lookup ??= import('../plugins/storefront')
    .then(({ Storefront }) => Storefront.getCountryCode())
    .then(({ countryCode }) => !countryCode || !ASSISTANT_BLOCKED_STOREFRONTS.includes(countryCode))
    .catch(() => true);
  return lookup;
}

export function useAssistantAllowedHere(): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean | undefined>(Platform.isIOS ? undefined : true);

  useEffect(() => {
    if (!Platform.isIOS) return;
    let cancelled = false;
    void lookUpAllowed().then((ok) => {
      if (!cancelled) setAllowed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return allowed;
}
