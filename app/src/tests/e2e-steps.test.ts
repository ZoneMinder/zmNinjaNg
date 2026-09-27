/**
 * Structural gates on the e2e step definitions (AGENTS.md rules 6 and 12).
 *
 * Two failures this catches, both of which shipped before it existed:
 *
 * 1. A `Then` with no `expect` cannot fail. A step that waits for a locator,
 *    swallows the timeout, and logs the result passes on every run, including
 *    runs where the feature is broken. Playwright's own waits do throw, but a
 *    step that states no expected value is not an assertion.
 * 2. A step definition no feature references is dead code. Step files drift
 *    when scenarios are rewritten and the old definitions stay behind.
 *
 * 3. A `Then` that returns early when the UI it asserts is not on screen
 *    reports the same green as a passing run. The `expect` further down is
 *    unreachable, so the assertion gate above passes it: presence of an
 *    `expect` is not proof that one runs. This is how a profile-creation
 *    chain passed without creating a profile.
 * 4. A capability flag reassigned from `isVisible()` inside a step body turns
 *    "the control is missing" into "this scenario does not apply", and every
 *    later step gated on that flag silently skips.
 *
 * Features under `tests/features/.wip/` count as references: those scenarios
 * are staged, not deleted.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const STEP_DIR = join(__dirname, '../../tests/steps');
const FEATURE_DIR = join(__dirname, '../../tests/features');

interface StepDef {
  file: string;
  line: number;
  keyword: string;
  pattern: string;
  body: string;
  node: ts.CallExpression;
  source: ts.SourceFile;
}

const readFeatures = (dir: string): string => {
  let text = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) text += readFeatures(join(dir, entry.name));
    else if (entry.name.endsWith('.feature')) text += `\n${readFileSync(join(dir, entry.name), 'utf8')}`;
  }
  return text;
};

/**
 * Cucumber expression to a line matcher. `{string}` matches a quoted value,
 * `{int}`/`{float}` match a literal number or a Scenario Outline `<placeholder>`.
 */
const patternToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\\\{string\\\}/g, '"[^"]*"')
    .replace(/\\\{(?:int|float)\\\}/g, '(?:[\\d.]+|<[^>]+>)');
  return new RegExp(`^\\s*(?:Given|When|Then|And|But)\\s+${body}\\s*$`, 'm');
};

const collectSteps = (): StepDef[] => {
  const steps: StepDef[] = [];
  for (const name of readdirSync(STEP_DIR).filter((n) => n.endsWith('.ts'))) {
    const source = ts.createSourceFile(
      name,
      readFileSync(join(STEP_DIR, name), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['Given', 'When', 'Then'].includes(node.expression.text) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        steps.push({
          file: name,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          keyword: node.expression.text,
          pattern: node.arguments[0].text,
          body: node.getText(source),
          node,
          source,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(steps.length, `no step definitions parsed out of ${name}`).toBeGreaterThan(0);
  }
  return steps;
};

const steps = collectSteps();
const featureText = readFeatures(FEATURE_DIR);

describe('e2e step definitions', () => {
  it('parses the step files and the feature files', () => {
    expect(steps.length).toBeGreaterThan(100);
    expect(featureText).toContain('Scenario:');
  });

  it('gives every Then step an assertion that can fail', () => {
    // Either the step asserts directly (`expect(...)`, `expect.poll(...)`) or it
    // delegates to an `assert*` helper that does.
    const asserts = (body: string) => /\bexpect\s*[.(]/.test(body) || /\bassert[A-Z]\w*\s*\(/.test(body);
    const unassertive = steps
      .filter((s) => s.keyword === 'Then' && !asserts(s.body))
      .map((s) => `${s.file}:${s.line}: Then ${s.pattern}`);
    expect(unassertive).toEqual([]);
  });

  /** Text of every `if` condition in a step, in source order. */
  const ifStatements = (step: StepDef): ts.IfStatement[] => {
    const found: ts.IfStatement[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isIfStatement(n)) found.push(n);
      ts.forEachChild(n, visit);
    };
    visit(step.node);
    return found;
  };

  const hasReturn = (n: ts.Node): boolean => {
    if (ts.isReturnStatement(n)) return true;
    // A nested function's return belongs to that function, not to the step.
    if (ts.isFunctionLike(n) && n !== undefined) return false;
    return ts.forEachChild(n, hasReturn) ?? false;
  };

  // Steps whose early return is still there; each is a finding of its own and
  // shrinks to empty as those land. A new entry needs a reason, not a line.
  // Empty, and it should stay that way: a Then that cannot reach its assertion
  // is the defect this gate exists for. An entry here needs a reason.
  const EARLY_RETURN_ALLOWLIST = new Set<string>([]);

  it('no Then skips itself when the UI it asserts is missing', () => {
    const offenders = steps
      .filter((s) => s.keyword === 'Then')
      .filter((s) => !EARLY_RETURN_ALLOWLIST.has(`${s.file}:${s.pattern}`))
      .filter((s) =>
        ifStatements(s).some(
          (stmt) =>
            /\.isVisible\s*\(/.test(stmt.expression.getText(s.source)) &&
            hasReturn(stmt.thenStatement),
        ),
      )
      .map((s) => `${s.file}:${s.line}: Then ${s.pattern}`);
    expect(
      offenders,
      `Then steps that return early on a visibility probe:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('no capability flag has both an API source and an isVisible source', () => {
    // A flag derived from the server (`serverGroupCount > 0`) and then
    // overwritten from `isVisible()` has two sources of truth, and the weaker
    // one wins: a filter that stops rendering reads as "this scenario does not
    // apply" and every later step gated on the flag skips. A flag whose only
    // source is `isVisible` records what the When did and is fine; so is a
    // plain `flag = false` reset.
    const fromVisible = new Map<string, Set<string>>();
    const fromElsewhere = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, file: string, name: string) => {
      if (!m.has(file)) m.set(file, new Set());
      m.get(file)!.add(name);
    };

    for (const step of steps) {
      const visit = (n: ts.Node): void => {
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(n.left)
        ) {
          const right = n.right.getText(step.source);
          const isLiteralReset = /^(true|false)$/.test(right.trim());
          if (/\.isVisible\s*\(/.test(right)) add(fromVisible, step.file, n.left.text);
          else if (!isLiteralReset) add(fromElsewhere, step.file, n.left.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(step.node);
    }

    const offenders: string[] = [];
    for (const [file, names] of fromVisible) {
      for (const name of names) {
        if (fromElsewhere.get(file)?.has(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(
      offenders.sort(),
      `capability flags with two sources of truth:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * `agents/project/testing.md` says not to use fixed `waitForTimeout`, and
   * nothing enforced it: the count sat unchanged through thirteen commits that
   * touched these files. Each sleep is a latent flake and a third of a second
   * per run, and a real timing regression turns into an intermittent red
   * nobody trusts.
   *
   * A ratchet, not a ban: the existing sleeps are grandfathered per file and
   * the numbers may only fall. Replace one with the condition it stands in for
   * and lower its entry in the same commit. Pattern: .lint-baseline.json (C7).
   */
  const SLEEP_BUDGET: Record<string, number> = {
    'common.steps.ts': 6,
    'dashboard.steps.ts': 2,
    'events.steps.ts': 12,
    'group-filter.steps.ts': 3,
    'hidden-monitors.steps.ts': 1,
    'kiosk.steps.ts': 5,
    'profiles.steps.ts': 2,
    'settings.steps.ts': 4,
    'timeline.steps.ts': 2,
  };

  it('the fixed-sleep budget only falls', () => {
    const counts = new Map<string, number>();
    for (const name of readdirSync(STEP_DIR).filter((n) => n.endsWith('.ts'))) {
      const hits = readFileSync(join(STEP_DIR, name), 'utf8').match(/waitForTimeout\s*\(/g)?.length ?? 0;
      if (hits > 0) counts.set(name, hits);
    }

    const grown = [...counts.entries()]
      .filter(([file, n]) => n > (SLEEP_BUDGET[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} sleeps, budget ${SLEEP_BUDGET[file] ?? 0}`);
    expect(
      grown,
      `fixed sleeps added; await the condition instead:\n${grown.join('\n')}`,
    ).toEqual([]);

    // A budget above reality is a number nobody lowered back, which is how a
    // ratchet stops ratcheting (C7).
    const slack = Object.entries(SLEEP_BUDGET)
      .filter(([file, budget]) => budget > (counts.get(file) ?? 0))
      .map(([file, budget]) => `${file}: budget ${budget}, actual ${counts.get(file) ?? 0}`);
    expect(slack, `lower these budgets to match:\n${slack.join('\n')}`).toEqual([]);
  });

  it('has no step definition that no feature references', () => {
    const orphans = steps
      .filter((s) => !patternToRegExp(s.pattern).test(featureText))
      .map((s) => `${s.file}:${s.line}: ${s.keyword} ${s.pattern}`);
    expect(orphans).toEqual([]);
  });
});
