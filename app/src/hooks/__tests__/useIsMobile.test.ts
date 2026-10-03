import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsPhone } from '../useIsMobile';

/** A matchMedia that evaluates the max-width / max-height / pointer queries
 *  the hooks use against one fake screen. A comma is OR, `and` is AND. */
function stubScreen(width: number, height: number, coarse: boolean) {
  const test = (cond: string) => {
    const m = cond.match(/\((max-width|max-height|pointer):\s*([\w.]+?)(px)?\)/);
    if (!m) throw new Error(`unhandled media condition ${cond}`);
    if (m[1] === 'pointer') return (m[2] === 'coarse') === coarse;
    return (m[1] === 'max-width' ? width : height) <= Number(m[2]);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.split(',').some((part) => part.split(' and ').every((c) => test(c.trim()))),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('useIsPhone', () => {
  it.each([
    ['phone, portrait', 412, 915, true, true],
    ['phone, landscape', 915, 412, true, true],
    ['tablet, landscape', 1180, 820, true, false],
    ['short laptop window', 1280, 600, false, false],
  ])('%s', (_, width, height, coarse, expected) => {
    stubScreen(width, height, coarse);
    expect(renderHook(() => useIsPhone()).result.current).toBe(expected);
  });
});
