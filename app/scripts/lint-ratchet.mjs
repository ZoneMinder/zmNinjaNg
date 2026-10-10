#!/usr/bin/env node
/**
 * Lint ratchet (refs #281).
 *
 * `npm run lint` is advisory in CI because of a pre-existing backlog, which
 * means the backlog can grow for free: nothing fails when a PR adds another
 * react-hooks error. It is advisory because it is big, and it stays big
 * because it is advisory.
 *
 * This turns that into a one-way ratchet. `.lint-baseline.json` records how
 * many problems each rule currently reports. The check fails when any rule
 * goes above its recorded number, so the backlog can shrink or stay flat but
 * never grow, without demanding a burn-down first.
 *
 *   npm run lint:ratchet            check against the baseline
 *   npm run lint:ratchet -- --update   rewrite the baseline from the current tree
 *
 * Lower the baseline whenever you fix something: the check prints the rules
 * that improved and exits 0, so `--update` is the follow-up, not a bypass.
 * Raising a number by hand is the escape hatch, and it should show up in
 * review as exactly that.
 *
 * Runs in CI only. Pre-commit already makes two full ESLint passes (a11y and
 * React correctness), and a third would put it past the point where people
 * start reaching for --no-verify.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(appDir, '.lint-baseline.json');
const update = process.argv.includes('--update');

/** Problem count per rule across everything `npm run lint` covers. */
function currentCounts() {
  let raw;
  try {
    raw = execFileSync(process.execPath, [path.join(appDir, 'node_modules/eslint/bin/eslint.js'), '.', '-f', 'json'], {
      cwd: appDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // ESLint exits non-zero when it reports errors, which is the normal case
    // here. Its stdout is still the report. A genuine crash has no stdout.
    if (!error.stdout) throw error;
    raw = error.stdout;
  }

  const counts = {};
  for (const file of JSON.parse(raw)) {
    for (const message of file.messages) {
      const rule = message.ruleId ?? 'unused-eslint-disable-directive';
      counts[rule] = (counts[rule] ?? 0) + 1;
    }
  }
  return counts;
}

const counts = currentCounts();
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Baseline written: ${Object.keys(sorted).length} rules, ${total} problems.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const regressions = [];
const improvements = [];

for (const [rule, count] of Object.entries(counts)) {
  const allowed = baseline[rule] ?? 0;
  if (count > allowed) regressions.push({ rule, count, allowed });
}
for (const [rule, allowed] of Object.entries(baseline)) {
  const count = counts[rule] ?? 0;
  if (count < allowed) improvements.push({ rule, count, allowed });
}

if (improvements.length > 0) {
  console.log('Improved since the baseline:');
  for (const { rule, count, allowed } of improvements) {
    console.log(`  ${rule}: ${allowed} -> ${count}`);
  }
  console.log('Run `npm run lint:ratchet -- --update` to lock the gain in.\n');
}

// C7 symmetry with quality-ratchet.test.ts: a baseline raised by hand and never
// lowered back stays above reality forever, and the ratchet stops ratcheting.
const slack = Object.entries(baseline)
  .map(([rule, allowed]) => ({ rule, allowed, count: counts[rule] ?? 0 }))
  .filter(({ allowed, count }) => allowed - count > 5);

if (slack.length > 0) {
  console.error('Lint baseline sits above the real count:');
  for (const { rule, count, allowed } of slack) {
    console.error(`  ${rule}: baseline ${allowed} is ${allowed - count} above the ${count} found`);
  }
  console.error('\nRun `npm run lint:ratchet -- --update` to lock the gain in.');
  process.exit(1);
}

if (regressions.length > 0) {
  console.error('Lint backlog grew:');
  for (const { rule, count, allowed } of regressions) {
    console.error(`  ${rule}: ${allowed} allowed, ${count} found (+${count - allowed})`);
  }
  console.error('\nFix the new problems, or raise the number in .lint-baseline.json');
  console.error('deliberately and say why in the commit message.');
  process.exit(1);
}

console.log(`Lint backlog within baseline: ${total} problems across ${Object.keys(counts).length} rules.`);
