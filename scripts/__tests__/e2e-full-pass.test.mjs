/**
 * make_release.sh says when the browser e2e suite last passed. It used to read
 * Playwright's JSON report, which every run overwrites, so a 45-second run of
 * one feature file read as a recent pass of the whole 18-minute suite.
 *
 * The stamp is now a date written only after a full, passing run, and it is
 * the only thing the release prompt reads. The check is textual: it catches a
 * stamp written without the pass, and the prompt drifting back to a per-run
 * report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('test:e2e:full stamps .e2e-full-pass only after the whole suite passes', () => {
  const full = JSON.parse(read('app/package.json')).scripts['test:e2e:full'];
  assert.match(full ?? '', /^npm run test:e2e && .*\.e2e-full-pass/);
});

test('make_release.sh runs the full suite and reads only the full-pass stamp', () => {
  const release = read('scripts/make_release.sh');
  assert.match(release, /npm run test:e2e:full/);
  assert.match(release, /app\/\.e2e-full-pass/);
  assert.doesNotMatch(release, /\.e2e-last-run\.json/);
});
