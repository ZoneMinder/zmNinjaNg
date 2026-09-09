import { useCallback, useEffect, useState } from 'react';

/** Desktop windows are landscape all day; only a touch screen counts. */
const COARSE_POINTER_QUERY = '(pointer: coarse)';
/** Fallback for engines without screen.orientation. */
const LANDSCAPE_QUERY = '(orientation: landscape)';

function screenOrientation(): ScreenOrientation | undefined {
  return typeof screen !== 'undefined' ? screen.orientation : undefined;
}

/**
 * The device is sideways. screen.orientation is read first: iOS evaluates
 * the orientation media query against the zoomed visual viewport, so during
 * a pinch it briefly reported portrait and the page fell out of fullscreen
 * and back in. The device orientation does not move with a pinch.
 */
function isLandscape(): boolean {
  const orientation = screenOrientation();
  if (orientation?.type) return orientation.type.startsWith('landscape');
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(LANDSCAPE_QUERY).matches;
}

function isLandscapeTouch(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(COARSE_POINTER_QUERY).matches && isLandscape();
}

/**
 * Fullscreen for a player page. `startFullscreen` is the user's setting
 * ("open in fullscreen"), a phone turned to landscape adds a temporary
 * fullscreen on top, and the page's own maximize/exit buttons change only
 * this session through `setFullscreen`. Nothing here or in its callers
 * writes a setting: a fullscreen page hides its header, so exiting is forced
 * before navigating away and a remembered exit could never be kept. Making
 * entry the writer instead is what #476 reported - the settings that already
 * name this preference are the only place it persists (refs #462, #463).
 *
 * A session override lasts until the next rotation or until `resetKey`
 * changes (the detail page stays mounted across monitors).
 */
export function useAutoFullscreen({ startFullscreen, resetKey }: {
  startFullscreen: boolean;
  resetKey?: string;
}): [isFullscreen: boolean, setFullscreen: (fullscreen: boolean) => void] {
  const [landscape, setLandscape] = useState(isLandscapeTouch);
  const [override, setOverride] = useState<{ key: string | undefined; value: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const onChange = () => {
      setLandscape(isLandscapeTouch());
      setOverride(null);
    };
    const orientation = screenOrientation();
    if (orientation?.addEventListener) {
      orientation.addEventListener('change', onChange);
      return () => orientation.removeEventListener('change', onChange);
    }
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setFullscreen = useCallback((fullscreen: boolean) => {
    setOverride({ key: resetKey, value: fullscreen });
  }, [resetKey]);

  const active = override && override.key === resetKey ? override.value : null;
  return [active ?? (startFullscreen || landscape), setFullscreen];
}
