/**
 * Guards against the two ways translations rot silently.
 *
 * i18n.ts sets `fallbackLng: 'en'`, so a key missing from a translated locale
 * renders the English string in the middle of a translated screen, and a key
 * missing from en renders the raw key id at the user ("events.duration").
 * Neither throws, and no CI job caught either until these tests existed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import en from '../en/translation.json';

type Tree = { [key: string]: string | Tree };

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(LOCALES, '..');

/**
 * Locale directories read from disk rather than listed here, so a language
 * added to `app/src/locales/` is covered without editing this file. Listing
 * them by hand meant a new locale was silently unchecked and the suite still
 * passed.
 */
const TRANSLATED: Array<[string, Tree]> = readdirSync(LOCALES)
  .filter((entry) => entry !== 'en' && entry !== '__tests__' && statSync(join(LOCALES, entry)).isDirectory())
  .map((code) => [code, JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8')) as Tree]);

/** Every leaf path in a translation tree, e.g. "events.duration". */
function leafPaths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`)
  );
}

/**
 * i18next resolves `foo.count` against `count_one` / `count_other` when the
 * caller passes a count, so a plural family satisfies a bare key reference.
 */
function resolves(tree: Tree, path: string): boolean {
  const parts = path.split('.');
  const leaf = parts.pop() as string;
  let node: Tree | string = tree;
  for (const part of parts) {
    if (typeof node === 'string' || !(part in node)) return false;
    node = node[part];
  }
  if (typeof node === 'string') return false;
  return leaf in node || Object.keys(node).some((k) => k.startsWith(`${leaf}_`));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' || entry === 'locales' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Literal keys passed to t(). Dynamic keys (t(someVar)) are out of reach. */
const T_CALL = /\bt\(\s*['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g;

describe('translation keys', () => {
  it('every t() key in the source resolves against en', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(T_CALL)) {
        if (!resolves(en as Tree, match[1])) missing.push(`${match[1]} (${file.slice(SRC.length + 1)})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds the translated locales on disk', () => {
    // Without this, a discovery bug empties TRANSLATED and it.each below runs
    // zero cases, which reads as a pass.
    expect(TRANSLATED.map(([code]) => code)).toEqual(expect.arrayContaining(['de', 'es', 'fr', 'it', 'zh', 'ru']));
  });

  it.each(TRANSLATED)('%s has exactly the keys en has', (_lang, tree) => {
    const expected = leafPaths(en as Tree).sort();
    expect(leafPaths(tree).sort()).toEqual(expected);
  });
});
