import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseNoticeFor, toPlainNotes, fitToLimit, PLAY_MAX, APP_STORE_MAX } from '../release-notes.mjs';

const NOTICES = [
  { id: 'release-2.3.0', body: 'older' },
  { id: '2026-05-30-welcome', body: 'not a release' },
  { id: 'release-2.4.0', body: '- Did a thing.' },
];

test('picks the release notice matching the version', () => {
  assert.equal(releaseNoticeFor(NOTICES, '2.4.0').body, '- Did a thing.');
});

test('returns null when the version has no release notice', () => {
  // Patch releases never get one: make_release only offers a notice for x.y.0.
  assert.equal(releaseNoticeFor(NOTICES, '2.4.1'), null);
});

test('strips the markup both stores show literally', () => {
  assert.equal(
    toPlainNotes('- **Bold** and *italic* and `code` and [a link](https://x.test).'),
    '- Bold and italic and code and a link.',
  );
});

test('drops the trailing full-changelog link', () => {
  assert.equal(toPlainNotes('- Did a thing.\n\n[Full changelog](https://x.test/tag/v1)'), '- Did a thing.');
});

test('text within the limit is returned whole', () => {
  const { text, dropped } = fitToLimit('- One.\n- Two.', PLAY_MAX);
  assert.equal(text, '- One.\n- Two.');
  assert.deepEqual(dropped, []);
});

test('over the limit, whole bullets are dropped and named', () => {
  const bullets = Array.from({ length: 40 }, (_, i) => `- Bullet number ${i} about a change.`);
  const { text, dropped } = fitToLimit(bullets.join('\n'), PLAY_MAX);
  assert.ok(text.length <= PLAY_MAX, `${text.length} exceeds ${PLAY_MAX}`);
  // Nothing may be cut mid-bullet: every kept line must be one of the originals.
  for (const line of text.split('\n')) assert.ok(bullets.includes(line), `mangled line: ${line}`);
  assert.equal(dropped.length + text.split('\n').length, bullets.length);
  assert.deepEqual(dropped, bullets.slice(text.split('\n').length));
});

test('the two stores have different limits', () => {
  assert.equal(PLAY_MAX, 500);
  assert.equal(APP_STORE_MAX, 4000);
});
