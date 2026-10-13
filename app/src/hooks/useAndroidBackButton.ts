/**
 * Android Hardware Back Button
 *
 * Without a handler the Android back gesture only walks the WebView history and
 * never leaves the app (refs #192). This registers a single global handler that:
 * - closes an open dialog/popover first,
 * - on a detail view, navigates back to its parent,
 * - on a root (menu) view, shows "press back again to exit" and exits on a
 *   second press within a short window.
 *
 * Native Android only. Disabled while the kiosk lock is engaged so the kiosk's
 * own back-swallowing handler stays in control.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Platform } from '../lib/platform';
import { useKioskStore } from '../stores/kioskStore';
import { ANDROID_BACK } from '../lib/zmninja-ng-constants';
import { hasOpenOverlay } from '../lib/overlay';
import { log, LogLevel } from '../lib/logger';

/** Top-level menu destinations. Back here confirms/exits rather than navigating. */
const ROOT_ROUTES = [
  '/dashboard',
  '/monitors',
  '/montage',
  '/events',
  '/timeline',
  '/notifications',
  '/profiles',
  '/settings',
  '/server',
  '/logs',
  '/developer-notice',
];

export type BackAction = 'close-overlay' | 'navigate-back' | 'confirm-exit' | 'exit';

export function isRootRoute(pathname: string): boolean {
  return ROOT_ROUTES.includes(pathname);
}

/**
 * Pure decision for what the back button should do. Kept separate from the hook
 * so the branching is unit-testable without Capacitor or the DOM.
 */
export function decideBackAction(params: {
  hasOpenOverlay: boolean;
  isRootRoute: boolean;
  doubleTapActive: boolean;
}): BackAction {
  if (params.hasOpenOverlay) return 'close-overlay';
  if (!params.isRootRoute) return 'navigate-back';
  return params.doubleTapActive ? 'exit' : 'confirm-exit';
}

/** Close the app. Only Android honours this; iOS and the web ignore it. */
export async function exitApp(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    await App.exitApp();
  } catch (error) {
    log.app('exitApp failed', LogLevel.WARN, { error });
  }
}

export function useAndroidBackButton(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isLocked = useKioskStore((state) => state.isLocked);
  const lastBackRef = useRef(0);

  const handleBack = useCallback(async () => {
    const now = Date.now();
    const overlay = hasOpenOverlay();
    const root = isRootRoute(location.pathname);
    const doubleTapActive = now - lastBackRef.current < ANDROID_BACK.exitConfirmWindowMs;
    const action = decideBackAction({ hasOpenOverlay: overlay, isRootRoute: root, doubleTapActive });

    switch (action) {
      case 'close-overlay':
        // Let the overlay's own Escape handling close the topmost layer.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      case 'navigate-back':
        navigate(-1);
        return;
      case 'confirm-exit':
        lastBackRef.current = now;
        toast(t('common.press_back_again_to_exit'));
        return;
      case 'exit':
        await exitApp();
        return;
    }
  }, [navigate, location.pathname, t]);

  // Keep the latest handler and lock state in refs so the listener can register
  // once and never re-subscribe. useCapacitorListener was unreliable here: its
  // re-subscribe-on-enabled-change path could cancel the in-flight registration,
  // leaving no listener so Capacitor fell back to walking WebView history.
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;

  useEffect(() => {
    if (!Platform.isNative) return;
    let handle: { remove: () => void } | undefined;
    let removed = false;
    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', () => {
          // While the kiosk lock is on, its own handler swallows back.
          if (isLockedRef.current) return;
          void handleBackRef.current();
        }),
      )
      .then((h) => {
        if (removed) h.remove();
        else handle = h;
      })
      .catch((error) => log.app('back button listener failed', LogLevel.WARN, { error }));
    return () => {
      removed = true;
      handle?.remove();
    };
  }, []);
}
