#!/usr/bin/env node
/**
 * Proven-red gate (AGENTS.md P2).
 *
 * P2 says a failing test precedes every feature and bugfix. Nothing checked
 * it: three tests in this repo's history passed on the code they were meant
 * to catch (two in the all-profiles run, refs #337, one in the Streaming
 * Mode default, refs #385), and each was found only because someone stashed
 * the fix and re-ran by hand. This script does that by machine.
 *
 * For a range base..head it takes the test files changed since the two
 * forked, runs them in a throwaway worktree that holds the fork-point code
 * plus the head tests, and fails when they pass there. A test that is green
 * on the code it claims to guard proves nothing. The normal unit-test job
 * proves the same tests are green on head.
 *
 *   node scripts/proven-red.mjs <base> <head> [--title "<pr title>"]
 *
 * Skips, and says so: a range that changes no source; a source change with no
 * unit test whose title type is docs, chore, ci, refactor, build, style, or
 * test (no behavior change to prove); a range whose only changed tests are
 * browser e2e steps, which need a ZoneMinder and cannot run here. Fails when a
 * behavior change arrives with no changed test at all. A changed unit test is
 * always proved, whatever the title claims.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKIP_TYPES = ['docs', 'chore', 'ci', 'refactor', 'build', 'style', 'test'];

// app/src/tests/ holds the repo-hygiene gates. A new assertion there is
// proven red against a scratch violation (testing playbook), not against the
// previous commit, where the violation it guards against does not exist yet.
const UNIT_TEST = /^app\/src\/(?!tests\/).*\.test\.(ts|tsx)$/;
const TEST_SUPPORT = /^app\/src\/tests\/|\/__tests__\/|^app\/tests\/steps\//;
// Ratchet baselines record a count; changing one is bookkeeping, not
// behaviour. Counting them as source made a pure test migration (tests
// changed, a baseline lowered, no app code touched) demand a red proof it
// cannot give, since its tests rightly pass on the old code too.
// site/ is the static GitHub Pages portal. It sits outside app/, where the
// proof runs vitest, so no changed test could ever prove a change to it.
const NON_CODE = /^(docs\/|agents\/|\.github\/|site\/|.*\.md$|.*\.rst$|app\/src\/locales\/|app\/tests\/features\/|app\/\.[\w-]+-baseline\.json$)/;

/** Split a changed-file list into what to run, what to carry along, and what counts as behavior. */
export function classify(files) {
  const unitTests = files.filter((f) => UNIT_TEST.test(f));
  const testSupport = files.filter((f) => TEST_SUPPORT.test(f) && !UNIT_TEST.test(f));
  const source = files.filter(
    (f) => !UNIT_TEST.test(f) && !TEST_SUPPORT.test(f) && !NON_CODE.test(f),
  );
  return { unitTests, testSupport, source };
}

/** Why a range needs no red proof, or null when it does. */
export function skipReason(title, { unitTests, testSupport, source }) {
  if (source.length === 0) return 'no source file changed';
  // The title is unverified input, so it cannot excuse a changed test from the
  // proof: a behavior change mislabelled `refactor:` used to skip the gate
  // entirely. A skip-type title still excuses a source change that brings no
  // test, which is what a real refactor looks like.
  if (unitTests.length > 0) return null;
  const type = /^([a-z]+)(\(.+\))?!?:/.exec(title ?? '')?.[1];
  if (type && SKIP_TYPES.includes(type)) return `title type "${type}" carries no behavior change`;
  if (testSupport.length > 0) {
    return 'only browser e2e, gate, or test-support files changed; e2e needs a server, and a gate is proven red by scratch violation';
  }
  return null;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Run the head tests against the base code in a worktree.
 * `runTests(appDir, files)` returns the vitest exit code; injectable for tests.
 */
export function proveRed({ base, head, repo, title, runTests = runVitest, log = console.log }) {
  // The fork point, not `base` itself. CI passes
  // github.event.pull_request.base.sha, which is the base branch's tip at
  // event time, so on a branch whose base has moved since it was cut, a
  // two-dot diff reports the base branch's own newer commits as this range's
  // changes. Those tests then rightly pass on `base` and the gate fails a PR
  // that did nothing wrong. The same tip is also the wrong worktree to prove
  // against: the pre-change code is the fork point, not whatever landed on
  // the base branch afterwards.
  const forkPoint = git(['merge-base', base, head], repo);
  const files = git(['diff', '--name-only', `${forkPoint}..${head}`], repo).split('\n').filter(Boolean);
  const split = classify(files);
  const skip = skipReason(title, split);
  if (skip) {
    log(`proven-red: skipped, ${skip}.`);
    return 0;
  }
  if (split.unitTests.length === 0) {
    log('proven-red: a behavior change arrived with no changed test (P2).');
    return 1;
  }

  const worktree = mkdtempSync(path.join(tmpdir(), 'proven-red-'));
  try {
    git(['worktree', 'add', '--detach', '-q', worktree, forkPoint], repo);
    for (const f of [...split.unitTests, ...split.testSupport]) {
      const from = path.join(repo, f);
      if (!existsSync(from)) continue; // deleted at head
      mkdirSync(path.dirname(path.join(worktree, f)), { recursive: true });
      cpSync(from, path.join(worktree, f));
    }
    const modules = path.join(repo, 'app/node_modules');
    if (existsSync(modules)) symlinkSync(modules, path.join(worktree, 'app/node_modules'));

    const relative = split.unitTests.map((f) => f.replace(/^app\//, ''));
    const code = runTests(path.join(worktree, 'app'), relative);
    if (code === 0) {
      log(`proven-red: ${relative.length} changed test file(s) pass on the pre-change code; they cannot catch the bug they claim to.`);
      return 1;
    }
    log(`proven-red: changed tests fail on the pre-change code, as they should.`);
    return 0;
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktree], repo);
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

function runVitest(appDir, files) {
  try {
    execFileSync('npx', ['vitest', 'run', ...files], { cwd: appDir, stdio: 'inherit' });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const titleIndex = process.argv.indexOf('--title');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const title =
    titleIndex > -1 ? process.argv[titleIndex + 1] : git(['log', '-1', '--format=%s', head], repo);
  if (!base || !head) {
    console.error('usage: proven-red.mjs <base> <head> [--title "<title>"]');
    process.exit(2);
  }
  process.exit(proveRed({ base, head, repo, title }));
}
