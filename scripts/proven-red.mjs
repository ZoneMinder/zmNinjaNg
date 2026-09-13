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
 *
 * A red run is not one proof but two. A test that fails an assertion on the
 * old code shows the assertion bites. A test that fails only because it
 * references a symbol the fork point does not have (`x is not a function`,
 * `Cannot find module`) shows the code is new and nothing about the
 * assertions; that is the only red a new module can ever give against the
 * fork point. The job reads the failures and says which kind it saw, and
 * warns when every failure is the second kind, so a reviewer knows the
 * assertions still need a look (M2: read what a gate measured).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
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

/** A failure that says the symbol or module is missing, not that a value was wrong. */
const MISSING_REFERENCE =
  /is not a function|is not defined|is not a constructor|Cannot find module|Failed to resolve import|does not provide an export|Cannot read propert/;

/** Sort vitest failure messages into assertion failures and missing references. */
export function classifyFailures(failures) {
  const missing = failures.filter((m) => MISSING_REFERENCE.test(m));
  return { assertion: failures.length - missing.length, missing: missing.length, sample: missing[0] };
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
    const result = runTests(path.join(worktree, 'app'), relative);
    const { code, failures = [] } = typeof result === 'number' ? { code: result } : result;
    if (code === 0) {
      log(`proven-red: ${relative.length} changed test file(s) pass on the pre-change code; they cannot catch the bug they claim to.`);
      return 1;
    }
    const kinds = classifyFailures(failures);
    if (failures.length > 0 && kinds.assertion === 0) {
      const warning =
        `proven-red: the changed tests fail on the pre-change code only because they reference code it does not have ` +
        `(${kinds.missing} failure(s), e.g. "${kinds.sample.split('\n')[0]}"). That proves the code is new, not that ` +
        `the assertions would catch a wrong value. Check the assertions in review, or run npm run test:mutation on the module.`;
      log(process.env.GITHUB_ACTIONS ? `::warning title=Red by missing symbol only::${warning}` : warning);
      return 0;
    }
    log(
      `proven-red: changed tests fail on the pre-change code, as they should` +
        (failures.length ? ` (${kinds.assertion} assertion failure(s), ${kinds.missing} missing reference(s)).` : '.'),
    );
    return 0;
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktree], repo);
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

/** Run vitest; the JSON report beside the default one is how the failures get read. */
function runVitest(appDir, files) {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'proven-red-report-')), 'vitest.json');
  const args = ['vitest', 'run', ...files, '--reporter=default', '--reporter=json', `--outputFile=${report}`];
  let code = 0;
  try {
    execFileSync('npx', args, { cwd: appDir, stdio: 'inherit' });
  } catch (error) {
    code = error.status ?? 1;
  }
  return { code, failures: readFailures(report) };
}

/** Every failure message in a vitest JSON report: per-test ones, and the file-level one when a file could not even load. */
export function readFailures(report) {
  if (!existsSync(report)) return [];
  const failures = [];
  for (const file of JSON.parse(readFileSync(report, 'utf8')).testResults ?? []) {
    const perTest = (file.assertionResults ?? []).flatMap((t) => t.failureMessages ?? []);
    failures.push(...perTest);
    if (perTest.length === 0 && file.status === 'failed' && file.message) failures.push(file.message);
  }
  return failures;
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
