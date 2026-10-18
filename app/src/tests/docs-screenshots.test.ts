/**
 * Gate for the screenshots rule in agents/project/documentation.md: every
 * image a user-guide page references under docs/_static/img/screens exists,
 * and every image there is referenced by some page. A retake that renames a
 * shot, or a doc edit that drops a figure, leaves one side dangling.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const userDocsDir = path.join(root, 'docs/user-guide');
const screensDir = path.join(root, 'docs/_static/img/screens');

function referencedImages(): Set<string> {
  const refs = new Set<string>();
  for (const name of fs.readdirSync(userDocsDir).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(userDocsDir, name), 'utf8');
    for (const m of text.matchAll(/_static\/img\/screens\/([\w./-]+\.(?:jpg|png))/g)) refs.add(m[1]);
  }
  return refs;
}

function imagesOnDisk(): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(screensDir)) return out;
  for (const doc of fs.readdirSync(screensDir, { withFileTypes: true })) {
    if (!doc.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(screensDir, doc.name))) {
      if (/\.(jpg|png)$/.test(f)) out.add(`${doc.name}/${f}`);
    }
  }
  return out;
}

describe('user-guide screenshots', () => {
  const refs = referencedImages();
  const disk = imagesOnDisk();

  it('every referenced screenshot exists', () => {
    expect([...refs].filter((r) => !disk.has(r))).toEqual([]);
  });

  it('every screenshot is referenced by a user-guide page', () => {
    expect([...disk].filter((d) => !refs.has(d))).toEqual([]);
  });
});
