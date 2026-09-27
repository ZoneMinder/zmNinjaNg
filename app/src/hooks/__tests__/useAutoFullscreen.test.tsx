/**
 * useAutoFullscreen: the "open in fullscreen" setting seeds the page, a
 * phone turned to landscape adds a temporary fullscreen on top, and the
 * page's own buttons only change the session. Nothing here writes a setting
 * (refs #462, #463).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoFullscreen } from '../useAutoFullscreen';

type Listener = (e: { matches: boolean }) => void;
let listeners: Listener[];
let landscape: boolean;

beforeEach(() => {
  listeners = [];
  landscape = false;
  // Two queries: the pointer one is a touch screen throughout, the
  // orientation one follows `landscape`.
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    get matches() { return query.includes('pointer') ? true : landscape; },
    addEventListener: (_: string, fn: Listener) => { listeners.push(fn); },
    removeEventListener: (_: string, fn: Listener) => { listeners = listeners.filter((l) => l !== fn); },
  })));
});
afterEach(() => vi.unstubAllGlobals());

function rotate(toLandscape: boolean) {
  landscape = toLandscape;
  act(() => listeners.forEach((l) => l({ matches: toLandscape })));
}

describe('useAutoFullscreen', () => {
  it('starts from the setting and lets the user toggle the session', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: true }));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('goes fullscreen on rotation to landscape and back on portrait', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));

    rotate(true);
    expect(result.current[0]).toBe(true);
    rotate(false);
    expect(result.current[0]).toBe(false);
  });

  it('starts fullscreen when mounted already in landscape', () => {
    landscape = true;
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));
    expect(result.current[0]).toBe(true);
  });

  it('lets the user leave a rotation fullscreen, and rotates in again next time', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));

    rotate(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rotate(false);
    rotate(true);
    expect(result.current[0]).toBe(true);
  });

  it('keeps a setting-driven fullscreen after rotating back to portrait', () => {
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: true }));
    rotate(true);
    rotate(false);
    expect(result.current[0]).toBe(true);
  });

  // iOS re-evaluates the orientation media query against the zoomed viewport
  // mid-pinch, so it briefly reads portrait and the page fell out of
  // fullscreen and back. screen.orientation reports the device, not the zoom.
  it('reads screen.orientation when present and ignores media-query flicker', () => {
    let orientationType = 'portrait-primary';
    let orientationListeners: Array<() => void> = [];
    vi.stubGlobal('screen', {
      orientation: {
        get type() { return orientationType; },
        addEventListener: (_: string, fn: () => void) => { orientationListeners.push(fn); },
        removeEventListener: (_: string, fn: () => void) => { orientationListeners = orientationListeners.filter((l) => l !== fn); },
      },
    });
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false }));
    expect(result.current[0]).toBe(false);

    orientationType = 'landscape-primary';
    act(() => orientationListeners.forEach((l) => l()));
    expect(result.current[0]).toBe(true);

    // The media query flips to portrait and back during a pinch; nothing changes.
    rotate(false);
    expect(result.current[0]).toBe(true);
    rotate(true);
    expect(result.current[0]).toBe(true);

    orientationType = 'portrait-primary';
    act(() => orientationListeners.forEach((l) => l()));
    expect(result.current[0]).toBe(false);
  });

  it('does not add fullscreen on a landscape touch device when landscape is false', () => {
    landscape = true;
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: false, landscape: false }));
    expect(result.current[0]).toBe(false);
  });

  it('still honors startFullscreen and the page buttons when landscape is false', () => {
    landscape = true;
    const { result } = renderHook(() => useAutoFullscreen({ startFullscreen: true, landscape: false }));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });

  it('drops the session override when the subject changes', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useAutoFullscreen({ startFullscreen: true, resetKey: key }),
      { initialProps: { key: '1' } },
    );
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    rerender({ key: '2' });
    expect(result.current[0]).toBe(true);
  });
});
