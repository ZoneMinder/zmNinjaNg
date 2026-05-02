import { describe, expect, it } from 'vitest';
import type { Layout } from 'react-grid-layout';
import { INTERNAL_COLS, migrateLayout } from '../useMontageGrid';

const buildNewFormatLayout = (displayCols: number, count: number): Layout[] => {
  const w = Math.max(1, Math.floor(INTERNAL_COLS / displayCols));
  const perRow = Math.floor(INTERNAL_COLS / w);
  return Array.from({ length: count }, (_, i) => ({
    i: `m${i}`,
    x: (i % perRow) * w,
    y: Math.floor(i / perRow) * 2,
    w,
    h: 2,
  }));
};

const buildLegacyLayout = (displayCols: number, count: number): Layout[] =>
  Array.from({ length: count }, (_, i) => ({
    i: `m${i}`,
    x: i % displayCols,
    y: Math.floor(i / displayCols) * 3,
    w: 1,
    h: 3,
  }));

describe('migrateLayout', () => {
  it('returns empty input unchanged', () => {
    expect(migrateLayout([], 5)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    'leaves new-format layouts (%i columns) untouched',
    (cols) => {
      const layout = buildNewFormatLayout(cols, 6);
      expect(migrateLayout(layout, cols)).toEqual(layout);
    }
  );

  it('migrates legacy w=1 layouts to the 12-col grid', () => {
    const legacy = buildLegacyLayout(5, 5);
    const migrated = migrateLayout(legacy, 5);

    const scale = Math.floor(INTERNAL_COLS / 5);
    expect(migrated).toEqual(
      legacy.map((item) => ({
        ...item,
        w: item.w * scale,
        x: item.x * scale,
      }))
    );
    expect(Math.max(...migrated.map((m) => m.w))).toBe(scale);
  });

  it('clamps oversized scaled values to internal grid bounds', () => {
    const legacy: Layout[] = [{ i: 'a', x: 11, y: 0, w: 1, h: 2 }];
    const migrated = migrateLayout(legacy, 1);
    expect(migrated[0].w).toBeLessThanOrEqual(INTERNAL_COLS);
    expect(migrated[0].x).toBeLessThanOrEqual(INTERNAL_COLS - 1);
  });

  it('does not corrupt a 5-column layout into a 3-column layout (regression for #135)', () => {
    const fiveCol = buildNewFormatLayout(5, 6);
    const result = migrateLayout(fiveCol, 5);
    expect(Math.max(...result.map((m) => m.w))).toBe(2);
  });

  it('does not corrupt a 6-column custom layout (regression for #135)', () => {
    const sixCol = buildNewFormatLayout(6, 6);
    const result = migrateLayout(sixCol, 6);
    expect(Math.max(...result.map((m) => m.w))).toBe(2);
  });
});
