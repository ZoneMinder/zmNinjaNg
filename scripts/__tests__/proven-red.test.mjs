import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, classifyFailures, readFailures, skipReason, proveRed } from '../proven-red.mjs';

test('classify separates unit tests, test support, source, and non-code', () => {
  const split = classify([
    'app/src/lib/foo.ts',
    'app/src/lib/__tests__/foo.test.ts',
    'app/src/tests/setup.ts',
    'app/tests/steps/settings.steps.ts',
    'app/tests/features/settings.feature',
    'docs/user-guide/settings.md',
    'app/src/locales/en/translation.json',
  ]);
  assert.deepEqual(split.unitTests, ['app/src/lib/__tests__/foo.test.ts']);
  assert.deepEqual(split.testSupport, ['app/src/tests/setup.ts', 'app/tests/steps/settings.steps.ts']);
  assert.deepEqual(split.source, ['app/src/lib/foo.ts']);
});

test('skipReason honors no-behavior commit types and source-less ranges', () => {
  const change = { unitTests: [], testSupport: [], source: ['app/src/a.ts'] };
  assert.match(skipReason('docs: tidy', change), /docs/);
  assert.match(skipReason('refactor(zones): split file', change), /refactor/);
  assert.equal(skipReason('fix(zones): scale coords', change), null);
  assert.equal(skipReason('feat!: breaking', change), null);
  assert.match(skipReason('fix: x', { unitTests: [], testSupport: [], source: [] }), /no source/);
  assert.match(
    skipReason('fix: x', { unitTests: [], testSupport: ['app/tests/steps/a.steps.ts'], source: ['app/src/a.ts'] }),
    /e2e/,
  );
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'proven-red-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'app/src/lib/__tests__'), { recursive: true });
  writeFileSync(join(dir, 'app/src/lib/sum.ts'), 'export const sum = (a, b) => a - b;\n');
  git('add', '.');
  git('commit', '-qm', 'chore: seed');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'app/src/lib/sum.ts'), 'export const sum = (a, b) => a + b;\n');
  writeFileSync(join(dir, 'app/src/lib/__tests__/sum.test.ts'), 'expect(sum(1, 2)).toBe(3)\n');
  git('add', '.');
  git('commit', '-qm', 'fix(sum): add, not subtract');
  const head = git('rev-parse', 'HEAD');
  return { dir, base, head, git };
}

test('proveRed fails when the changed test passes on the base code, and passes when it fails there', () => {
  const { dir, base, head } = repo();
  const seen = [];
  const runTests = (appDir, files) => {
    seen.push(files);
    // The worktree must hold the BASE source and the HEAD test.
    assert.equal(readFileSync(join(appDir, 'src/lib/sum.ts'), 'utf8'), 'export const sum = (a, b) => a - b;\n');
    assert.equal(readFileSync(join(appDir, 'src/lib/__tests__/sum.test.ts'), 'utf8'), 'expect(sum(1, 2)).toBe(3)\n');
    return 1; // vitest went red on the old code
  };
  try {
    const log = () => {};
    assert.equal(proveRed({ base, head, repo: dir, title: 'fix(sum): add', runTests, log }), 0);
    assert.deepEqual(seen, [['src/lib/__tests__/sum.test.ts']]);
    assert.equal(proveRed({ base, head, repo: dir, title: 'fix(sum): add', runTests: () => 0, log }), 1);
    // A skip-type title no longer excuses a changed test from the proof.
    assert.equal(proveRed({ base, head, repo: dir, title: 'docs: x', runTests: () => 0, log }), 1);
    assert.equal(proveRed({ base, head, repo: dir, title: 'docs: x', runTests: () => 1, log }), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('proveRed measures from the fork point, not the base branch tip', () => {
  const { dir, base, head, git } = repo();

  // The base branch moves on after this branch was cut, which is what CI's
  // github.event.pull_request.base.sha points at by the time the PR runs.
  git('checkout', '-q', base);
  mkdirSync(join(dir, 'app/src/lib/__tests__'), { recursive: true });
  writeFileSync(join(dir, 'app/src/lib/other.ts'), 'export const other = () => 1;\n');
  writeFileSync(join(dir, 'app/src/lib/__tests__/other.test.ts'), 'expect(other()).toBe(1)\n');
  git('add', '.');
  git('commit', '-qm', 'feat(other): land on the base branch');
  const movedTip = git('rev-parse', 'HEAD');

  const seen = [];
  const runTests = (appDir, files) => {
    seen.push(files);
    return 1;
  };
  const code = proveRed({
    base: movedTip,
    head,
    repo: dir,
    title: 'fix(sum): add, not subtract',
    runTests,
    log: () => {},
  });

  // Only this branch's own test is proved. Diffing straight from the moved
  // tip would drag in other.test.ts, which passes on the fork point and would
  // fail the gate for a branch that changed nothing about it.
  assert.equal(code, 0);
  assert.deepEqual(seen, [['src/lib/__tests__/sum.test.ts']]);
});

test('proveRed fails a behavior change that brings no unit test', () => {
  const { dir, base, git } = repo();
  try {
    writeFileSync(join(dir, 'app/src/lib/sum.ts'), 'export const sum = (a, b) => a + b + 0;\n');
    git('commit', '-qam', 'fix(sum): again');
    const head = git('rev-parse', 'HEAD');
    // base..head now spans two commits; the test file was added in the first, so use the second only.
    assert.equal(proveRed({ base: `${head}^`, head, repo: dir, title: 'fix(sum): again', runTests: () => 1, log: () => {} }), 1);
    assert.equal(proveRed({ base, head, repo: dir, title: 'fix(sum): again', runTests: () => 1, log: () => {} }), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a ratchet baseline is bookkeeping, not source', () => {
  const split = classify(['app/.quality-baseline.json', 'app/.lint-baseline.json', 'app/src/hooks/__tests__/x.test.ts']);
  assert.deepEqual(split.source, []);
  assert.equal(skipReason('test: migrate', split), 'no source file changed');
});

test('the static portal page under site/ is not app source', () => {
  const split = classify(['site/index.html']);
  assert.deepEqual(split.source, []);
  assert.equal(skipReason('feat(site): add a button', split), 'no source file changed');
});

test('a repo-hygiene gate under app/src/tests is gate work, not a unit test to prove', () => {
  const split = classify(['app/src/tests/quality-ratchet.test.ts', 'scripts/proven-red.mjs']);
  assert.deepEqual(split.unitTests, []);
  assert.deepEqual(split.testSupport, ['app/src/tests/quality-ratchet.test.ts']);
  assert.match(skipReason('fix: x', split), /gate/);
});

test('a red made only of missing references is reported as such, and still passes', () => {
  const { dir, base, head } = repo();
  try {
    const lines = [];
    const log = (l) => lines.push(l);
    const missing = { code: 1, failures: ['TypeError: (0 , resolveStartRoute) is not a function\n    at x.test.ts:3'] };
    assert.equal(proveRed({ base, head, repo: dir, title: 'feat(nav): start screen', runTests: () => missing, log }), 0);
    assert.match(lines.at(-1), /only because they reference code it does not have/);
    assert.match(lines.at(-1), /resolveStartRoute/);

    lines.length = 0;
    const assertion = { code: 1, failures: ['AssertionError: expected 1 to be 2', 'TypeError: y is not a function'] };
    assert.equal(proveRed({ base, head, repo: dir, title: 'fix(sum): add', runTests: () => assertion, log }), 0);
    assert.match(lines.at(-1), /as they should \(1 assertion failure\(s\), 1 missing reference\(s\)\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifyFailures counts assertion failures and missing references apart', () => {
  const kinds = classifyFailures([
    'AssertionError: expected 3 to be 4',
    "Error: expect(element).toHaveTextContent()",
    "Error: Cannot find module './new-thing'",
    'ReferenceError: newHook is not defined',
  ]);
  assert.deepEqual({ assertion: kinds.assertion, missing: kinds.missing }, { assertion: 2, missing: 2 });
  assert.match(kinds.sample, /Cannot find module/);
});

test('readFailures takes per-test messages and the file-level message when a file could not load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proven-red-report-'));
  const report = join(dir, 'vitest.json');
  try {
    writeFileSync(
      report,
      JSON.stringify({
        testResults: [
          { status: 'failed', message: '', assertionResults: [{ status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] }, { status: 'passed', failureMessages: [] }] },
          { status: 'failed', message: "Error: Failed to resolve import './gone'", assertionResults: [] },
        ],
      }),
    );
    assert.deepEqual(readFailures(report), ['AssertionError: expected 1 to be 2', "Error: Failed to resolve import './gone'"]);
    assert.deepEqual(readFailures(join(dir, 'missing.json')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
