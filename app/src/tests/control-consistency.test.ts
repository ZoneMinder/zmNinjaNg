/**
 * Control consistency gate.
 *
 * A pressable control has to look pressed the same way everywhere. Three
 * conventions had grown up side by side - default/outline, secondary/ghost,
 * default/ghost - so the same state read as "filled", "tinted", or "no change"
 * depending on the screen. And several toggles announced nothing at all to a
 * screen reader, which only sees aria-pressed, not colour.
 *
 * This scans source rather than rendering, because the point is the rule, not
 * one component's output: a new toggle written the old way fails here even if
 * nobody wrote a test for it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';

const SRC = join(__dirname, '..');

/**
 * Segmented pickers, where the choices sit inside one bordered group and an
 * outline on each would draw a box in a box. They are exempt from the
 * variant rule, not from aria-pressed.
 */
const SEGMENTED = ['pages/Logs.tsx', 'components/ui/quick-date-range-buttons.tsx'];

/** Opening tags of <Button ...>, which may span lines. */
function buttonTags(source: string): string[] {
  return source.match(/<Button\b[^>]*>/g) ?? [];
}

function sourceFiles(): { path: string; rel: string; text: string }[] {
  return globSync('{pages,components}/**/*.tsx', { cwd: SRC, absolute: false })
    .filter((rel) => !rel.includes('__tests__'))
    .map((rel) => {
      const normalizedRel = rel.replaceAll('\\', '/');
      return {
        path: join(SRC, rel),
        rel: normalizedRel,
        text: readFileSync(join(SRC, rel), 'utf8'),
      };
    });
}

describe('pressable controls', () => {
  it('show the pressed state as default over outline, everywhere', () => {
    const offenders: string[] = [];

    for (const { rel, text } of sourceFiles()) {
      if (SEGMENTED.includes(rel)) continue;
      for (const tag of buttonTags(text)) {
        const ternary = tag.match(/variant=\{[^}]*\?\s*['"](\w+)['"]\s*:\s*['"](\w+)['"]\s*\}/);
        if (!ternary) continue;
        const [, pressed, unpressed] = ternary;
        if (pressed !== 'default' || unpressed !== 'outline') {
          offenders.push(`${rel}: ${pressed}/${unpressed}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('announce the pressed state to a screen reader', () => {
    const offenders: string[] = [];

    for (const { rel, text } of sourceFiles()) {
      for (const tag of buttonTags(text)) {
        const isToggle = /variant=\{[^}]*\?\s*['"]\w+['"]\s*:\s*['"]\w+['"]\s*\}/.test(tag);
        if (!isToggle) continue;
        if (!tag.includes('aria-pressed')) offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
