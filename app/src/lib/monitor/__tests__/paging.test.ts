/**
 * Monitor paging arithmetic.
 *
 * The point of paging over the viewport gating it replaced is that it can be
 * proven here rather than on a device: a slice needs no layout, so every claim
 * below is checkable (refs #507).
 */

import { describe, it, expect } from 'vitest';
import { clampPage, pageCount, pageSlice } from '../paging';

const items = Array.from({ length: 74 }, (_, i) => `m${i + 1}`);

describe('pageCount', () => {
  it('counts the pages a list divides into, rounding a partial page up', () => {
    expect(pageCount(74, 12)).toBe(7);
    expect(pageCount(72, 12)).toBe(6);
  });

  it('is one page when paging is off, whatever the list holds', () => {
    expect(pageCount(74, 0)).toBe(1);
  });

  it('is one page for an empty list, so the controls read 1 / 1', () => {
    expect(pageCount(0, 12)).toBe(1);
  });
});

describe('pageSlice', () => {
  it('returns one page of the list', () => {
    expect(pageSlice(items, 12, 1)).toEqual(items.slice(0, 12));
    expect(pageSlice(items, 12, 2)).toEqual(items.slice(12, 24));
  });

  it('gives the last page only what is left', () => {
    expect(pageSlice(items, 12, 7)).toHaveLength(74 - 72);
  });

  it('pages are disjoint and together cover the whole list', () => {
    const pages = [1, 2, 3, 4, 5, 6, 7].flatMap((page) => pageSlice(items, 12, page));
    expect(new Set(pages).size).toBe(items.length);
    expect(pages).toEqual(items);
  });

  it('holds a page in range when the list shrank under it', () => {
    // A monitor going away, or a group filter narrowing, must not strand the
    // user on a page past the end with nothing rendered.
    expect(pageSlice(items.slice(0, 5), 12, 7)).toEqual(items.slice(0, 5));
  });

  it('returns the list itself when paging is off or everything fits', () => {
    // Identity, not just equality: the montage memoizes its query inputs and
    // grid layout on this array.
    expect(pageSlice(items, 0, 1)).toBe(items);
    expect(pageSlice(items, 100, 1)).toBe(items);
  });
});

describe('clampPage', () => {
  it('holds a page inside the range the list supports', () => {
    expect(clampPage(9, 74, 12)).toBe(7);
    expect(clampPage(0, 74, 12)).toBe(1);
    expect(clampPage(-3, 74, 12)).toBe(1);
  });

  it('rejects a non-integer page rather than slicing on a fraction', () => {
    expect(clampPage(2.5, 74, 12)).toBe(1);
  });
});
