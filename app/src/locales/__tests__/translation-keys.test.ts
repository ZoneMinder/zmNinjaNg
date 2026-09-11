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

/** Suffix i18next appends to a plural family, e.g. "count_one". */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * Base paths of the plural families en declares, e.g. "monitors.count". Both
 * `_one` and `_other` must be present: `timeline.filter_other` is a detection
 * category sitting next to `filter_person`, not a plural form.
 */
function pluralFamilies(paths: string[]): string[] {
  const all = new Set(paths);
  const bases = paths.filter((p) => PLURAL_SUFFIX.test(p)).map((p) => p.replace(PLURAL_SUFFIX, ''));
  return [...new Set(bases)].filter((base) => all.has(`${base}_one`) && all.has(`${base}_other`));
}

/**
 * Plural categories a language needs for the counts this app shows. English
 * has two (one/other) and Russian has three below 100 (one/few/many), so a
 * locale legitimately carries keys en never declares. Categories that only
 * fire for millions or fractions, such as French `many`, are left out: no
 * screen counts that high, and i18next falls back to `_other` for them.
 */
function countedCategories(lang: string): string[] {
  const rules = new Intl.PluralRules(lang);
  const seen = new Set<string>();
  for (let n = 0; n <= 100; n++) seen.add(rules.select(n));
  return [...seen];
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

  it.each(TRANSLATED)('%s has every key en has', (_lang, tree) => {
    const have = new Set(leafPaths(tree));
    expect(leafPaths(en as Tree).filter((path) => !have.has(path))).toEqual([]);
  });

  it.each(TRANSLATED)('%s adds no keys en lacks, beyond plural forms', (_lang, tree) => {
    const expected = new Set(leafPaths(en as Tree));
    const families = new Set(pluralFamilies([...expected]));
    const extra = leafPaths(tree).filter(
      (path) => !expected.has(path) && !(PLURAL_SUFFIX.test(path) && families.has(path.replace(PLURAL_SUFFIX, '')))
    );
    expect(extra).toEqual([]);
  });

  /**
   * Without this, a locale copied from en carries only `_one` and `_other`,
   * and i18next silently renders English for every count whose category is
   * missing: Russian showed "2 monitors" for any count from 2 to 4.
   */
  it.each(TRANSLATED)('%s covers every plural category its counts reach', (lang, tree) => {
    const have = new Set(leafPaths(tree));
    const missing = pluralFamilies(leafPaths(en as Tree)).flatMap((family) =>
      countedCategories(lang)
        .map((category) => `${family}_${category}`)
        .filter((path) => !have.has(path))
    );
    expect(missing).toEqual([]);
  });
});
