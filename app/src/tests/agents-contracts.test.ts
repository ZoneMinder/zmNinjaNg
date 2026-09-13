import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const appSrc = path.resolve(repoRoot, 'app/src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceText = walk(appSrc)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

function srcFiles(): string[] {
  return walk(appSrc);
}

function read(f: string): string {
  return fs.readFileSync(f, 'utf8');
}

interface Contract {
  name: string;
  body: string;
}

function parseContracts(md: string): Contract[] {
  const section = md.split('## Architecture contracts')[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n### ')
    .slice(1)
    .map((block) => {
      const [name, ...rest] = block.split('\n');
      return { name: name.trim(), body: rest.join('\n') };
    });
}

function backtickTokens(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ''));
}

describe('AGENTS.project.md architecture contracts', () => {
  const projectFile = path.join(repoRoot, 'AGENTS.project.md');

  it('exists and holds at least 12 contracts with all four lines', () => {
    const md = fs.readFileSync(projectFile, 'utf8');
    const contracts = parseContracts(md);
    expect(contracts.length).toBeGreaterThanOrEqual(12);
    for (const c of contracts) {
      for (const field of ['Owns:', 'Path:', 'Never:', 'Gate:']) {
        expect(c.body, `${c.name} missing ${field}`).toContain(field);
      }
    }
  });

  it('every symbol and path named in Path/Gate lines exists', () => {
    const md = fs.readFileSync(projectFile, 'utf8');
    for (const c of parseContracts(md)) {
      const lines = c.body
        .split('\n')
        .filter((l) => l.startsWith('Path:') || l.startsWith('Gate:'));
      for (const token of lines.flatMap(backtickTokens)) {
        if (token.includes('/')) {
          expect(
            fs.existsSync(path.join(repoRoot, token)),
            `${c.name}: path ${token} missing`,
          ).toBe(true);
        } else {
          const symbolPattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          expect(
            symbolPattern.test(sourceText),
            `${c.name}: symbol ${token} not found in app/src`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('AGENTS.md stays portable', () => {
  it('contains no project-specific tokens', () => {
    const core = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8').toLowerCase();
    const forbidden = [
      'zmNinja',
      'ZoneMinder',
      'zoneminder',
      'getProfileSettings',
      'useBandwidthSettings',
      'ErrorBanner',
      'agents/project',
      'Capacitor',
      'Zustand',
      'app/src',
    ];
    for (const token of forbidden) {
      expect(core.includes(token.toLowerCase()), `AGENTS.md contains "${token}"`).toBe(false);
    }
  });

  it('instruction files stay inside the token budget', () => {
    // These files load into every agent session (CLAUDE.md is the
    // Claude-only shim). Raising this budget is a deliberate act that needs
    // a reason in the commit message, like the lint ratchet (C7). Lowering
    // it is always welcome.
    // 2000 -> 2050 (refs #337): the assistant tool-loop contract gained the
    // multi-server path, and the entry was already compressed to pay for most
    // of it. A contract nobody can find is worse than 50 words.
    // 2050 -> 2100 (refs #385 follow-up): P2 and C6 gained the gates M1
    // demands (proven-red job, quality ratchet), P1 the out-of-scope ledger
    // and acceptance lines; the verification section was compressed to pay
    // for half of it.
    // 2100 -> 4000 (maintainer decision, 2026-08-30): headroom, not a target.
    // Context windows stopped being the constraint; instruction-following
    // degrades with rule count, not file size, so the discipline stays the
    // same: gates over prose, playbooks over always-loaded text, and every
    // addition still answers "can a script check this instead". The files
    // sit at ~2100; treat the gap as room for future rules, not an invitation.
    const WORD_BUDGET = 4000;
    const words = (f: string) =>
      fs.readFileSync(path.join(repoRoot, f), 'utf8').split(/\s+/).filter(Boolean).length;
    const total = words('AGENTS.md') + words('AGENTS.project.md') + words('CLAUDE.md');
    expect(total, `combined ${total} words > budget ${WORD_BUDGET}`).toBeLessThanOrEqual(WORD_BUDGET);
  });
});

describe('knowledge files stay evidence-backed and private-data-free (M5)', () => {
  const knowledgeFiles = [
    'agents/project/domain-context.md',
    'agents/project/llm-models.md',
    'agents/generic/claude-workflows.md',
    'agents/project/glossary.md',
    'agents/project/out-of-scope.md',
  ];

  it('the PR template offers the Acceptance heading the ci.yml job requires', () => {
    // This asserts the template only. It is NOT the gate on P1's
    // acceptance-lines clause and was read as one for a month, during which
    // four consecutive PRs shipped with no Acceptance section: a file
    // containing a heading says nothing about any PR body. The real gate is
    // the pr-acceptance job in ci.yml, which reads the body.
    const template = fs.readFileSync(path.join(repoRoot, '.github/pull_request_template.md'), 'utf8');
    expect(template).toMatch(/^## Acceptance$/m);

    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci, 'the pr-acceptance job is what actually enforces P1').toMatch(/pr-acceptance:/);
  });

  it('every issue cited in out-of-scope has a reason line', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'agents/project/out-of-scope.md'), 'utf8');
    const entries = md.split('\n- ').slice(1);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.split(/\s+/).length, `entry too short to carry a reason: ${entry.slice(0, 60)}`).toBeGreaterThan(12);
    }
  });

  it('every commit hash cited in domain-context exists in this repo', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'agents/project/domain-context.md'), 'utf8');
    const hashes = [...new Set([...md.matchAll(/\b[0-9a-f]{8}\b/g)].map((m) => m[0]))];
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(
        () => execSync(`git cat-file -e ${hash}^{commit}`, { cwd: repoRoot, stdio: 'pipe' }),
        `cited commit ${hash} not found in history`,
      ).not.toThrow();
    }
  });

  it('agent knowledge files contain no emails or IP addresses', () => {
    for (const file of knowledgeFiles) {
      const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(text, `${file} contains an IP address`).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(text, `${file} contains an email address`).not.toMatch(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/);
    }
  });
});

describe('prose stays in developer voice (P10)', () => {
  it('no rst or agent-playbook heading starts with "The "', () => {
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const lines = fs.readFileSync(path.join(guideDir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const next = lines[i + 1] ?? '';
        const isHeading = /^[=\-~^"]{3,}\s*$/.test(next) && next.trim().length >= line.trim().length - 2;
        if (isHeading && /^The /.test(line)) offenders.push(`${file}:${i + 1} ${line}`);
      });
    }
    for (const dir of ['agents/generic', 'agents/project']) {
      const full = path.join(repoRoot, dir);
      for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.md'))) {
        fs.readFileSync(path.join(full, file), 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/^#+ The /.test(line)) offenders.push(`${dir}/${file}:${i + 1} ${line}`);
          });
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});

describe('developer docs cite symbols, not line numbers', () => {
  it('no rst file carries a file.ts:NN citation', () => {
    // Line numbers rot silently as code moves; symbol names are greppable
    // and survive edits. GitHub #LNN anchors are covered by the next case.
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      fs.readFileSync(path.join(guideDir, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\.(ts|tsx):\d+/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders, `line-number citations found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no rst file teaches a retired or invented symbol', () => {
    // Nothing checked developer-guide symbol truth, and it showed: four
    // chapters taught the HTTP singleton the Sessions contract deleted, and
    // applySSLTrustSetting was cited at seven sites without ever having
    // existed (the real function is applyTrustedCertificates). A contributor
    // following the guide wrote code the contract gate then rejected.
    const RETIRED: Record<string, string> = {
      getApiClient: 'getSession(profileId).client, or createStoreApiClient',
      setApiClient: 'getSession(profileId), which owns the per-profile client',
      resetApiClient: 'resetAuthGates, or drop the session from the registry',
      registerApiClientResetHook: 'resetAuthGates',
      applySSLTrustSetting: 'applyTrustedCertificates(candidate?: TrustCandidate)',
    };

    // A name that comes back for real must update this list, not sit here
    // passing while the guide is right and the test is wrong.
    const revived = Object.keys(RETIRED).filter((name) =>
      srcFiles().some((f) => !f.endsWith('agents-contracts.test.ts') && new RegExp(`\\b${name}\\b`).test(read(f))),
    );
    expect(revived, `these are back in app/src; drop them from RETIRED: ${revived.join(', ')}`).toEqual([]);

    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      fs.readFileSync(path.join(guideDir, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const [name, replacement] of Object.entries(RETIRED)) {
            if (new RegExp(`\\b${name}\\b`).test(line)) {
              offenders.push(`${file}:${i + 1} ${name} -> ${replacement}`);
            }
          }
        });
    }
    expect(offenders, `developer guide teaches symbols that do not exist:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no source link pins a line number', () => {
    // A #LNN anchor is a line number wearing a URL. All 246 of them had
    // rotted: call-flows cited Monitors.tsx#L66 for the monitor-list query,
    // which by then was a group-filter comment, and the reader lands
    // confidently in the wrong place. The bare file link stays useful as the
    // code moves; the prose names the symbol.
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      fs.readFileSync(path.join(guideDir, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/blob\/[^\s>`]*#L\d+/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders, `source links pinned to a line number:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no mermaid block contains a semicolon', () => {
    // Mermaid parses ";" as a statement separator, so a semicolon inside a
    // message label truncates the statement and the whole diagram renders as
    // "Syntax error in text" on readthedocs.
    const offenders: string[] = [];
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const lines = fs.readFileSync(path.join(guideDir, file), 'utf8').split('\n');
      let inMermaid = false;
      lines.forEach((line, i) => {
        if (/^\s*\.\. mermaid::/.test(line)) {
          inMermaid = true;
          return;
        }
        if (inMermaid && line.trim() && !/^\s/.test(line)) inMermaid = false;
        if (inMermaid && line.includes(';')) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, `semicolons inside mermaid blocks:\n${offenders.join('\n')}`).toEqual([]);
  });
});

/**
 * The Never clauses that a grep can decide.
 *
 * Eleven contracts in AGENTS.project.md cited this file as their gate while it
 * asserted only that the prose parsed and that the symbols it names exist. A
 * reader who skips review of anything a gate enforces was skipping eleven
 * unenforced contracts (M2). The clauses below are the ones a grep can settle;
 * the rest now say `Gate: review.` and mean it.
 *
 * Comments are stripped before matching, so a doc comment that names a
 * forbidden call (useBandwidthSettings.ts, providers/openai.ts) is not a hit.
 */
describe('contract Never clauses a grep can decide', () => {
  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Every non-test source file as [repo-relative path, comment-free text]. */
  const codeFiles = (): [string, string][] =>
    srcFiles()
      .filter((f) => !f.includes('__tests__'))
      .map((f) => [path.relative(appSrc, f), stripComments(read(f))]);

  const offenders = (pattern: RegExp, exempt: (rel: string) => boolean = () => false) =>
    codeFiles()
      .filter(([rel, code]) => !exempt(rel) && pattern.test(code))
      .map(([rel]) => rel);

  it('Logging: no console calls outside the logger itself', () => {
    expect(
      offenders(/\bconsole\.\w/, (f) => f === 'lib/logger.ts' || f.startsWith('lib/log-file/')),
    ).toEqual([]);
  });

  it('HTTP: no raw fetch or axios outside lib/http', () => {
    expect(offenders(/(^|[^.\w])fetch\s*\(|\baxios\b/, (f) => f.startsWith('lib/http'))).toEqual(
      [],
    );
  });

  it('Native: Capacitor plugins are imported dynamically, never statically', () => {
    // @capacitor/core holds Capacitor/registerPlugin themselves, not a plugin.
    expect(offenders(/^import\s[^;]*?from\s+['"]@capacitor\/(?!core)/m)).toEqual([]);
  });

  it('Server queries: no inline queryKey arrays outside the key factory', () => {
    expect(offenders(/queryKey:\s*\[/, (f) => f.startsWith('lib/query/'))).toEqual([]);
  });

  it('Service boundary: no service statically imports a store', () => {
    // Type-only imports are erased and reach no store at runtime; the gate in
    // no-circular-deps.test.ts skips them for the same reason.
    expect(
      offenders(
        /^import\s+(?!type\b)[^;]*?from\s+['"][^'"]*\/stores\//m,
        (f) => !f.startsWith('services/'),
      ),
    ).toEqual([]);
  });

  it('Stores: no whole-store subscription', () => {
    // `useXStore()` with no selector re-renders on every store write. The
    // contract's sanctioned shape is a selector per field (useShallow for
    // several); the count was zero when this landed, so zero is the number.
    expect(offenders(/\buse[A-Z]\w*Store\(\)/)).toEqual([]);
  });

  it('Polling: no literal refresh interval outside the bandwidth hook', () => {
    // Users tune every interval through useBandwidthSettings; a literal
    // 30000 in a component is a bug even though it works (Polling contract).
    // Two seconds and up counts as a refresh. Faster literals are display
    // ticks (an elapsed-seconds counter runs at 1000) and cost no bandwidth.
    const literalMs = '(?:[2-9]_?\\d{3}|\\d{2,}_?\\d{3})';
    expect(
      offenders(new RegExp(`\\b(?:refetchInterval|staleTime)\\s*:\\s*${literalMs}|\\bsetInterval\\([^;]*?,\\s*${literalMs}\\s*\\)`), (f) =>
        f.startsWith('hooks/useBandwidthSettings'),
      ),
    ).toEqual([]);
  });

  it('Date and time: no literal date-fns pattern in a component or page', () => {
    // Rendering goes through useDateTimeFormat / formatAppDate so the user's
    // locale and 12/24-hour choice apply everywhere. A `format(d, 'yyyy-MM-dd')`
    // in a component bypasses both.
    expect(
      offenders(/\bformat\([^;\n]*?,\s*['"][^'"]*(?:yyyy|MM|dd|HH|mm|ss)/, (f) =>
        !/^(components|pages)\//.test(f),
      ),
    ).toEqual([]);
  });

  it('Error handling: abort checks go through isAbortError', () => {
    // DOMException does not extend Error in browsers and an abort can arrive
    // wrapped; the helper checks the name, which is the part that holds.
    expect(offenders(/instanceof\s+DOMException/, (f) => f === 'lib/is-abort-error.ts')).toEqual([]);
  });
});

describe('Sessions contract', () => {
  // ApiClient is built either directly (createApiClient, api/client.ts) or
  // via its store-wired wrapper (createStoreApiClient, api/store-gates.ts).
  // Sanctioned callers, per grep evidence (refs #337):
  //  - api/store-gates.ts    the gate factory; sole caller of createApiClient
  //  - services/sessions.ts  the live per-profile session registry
  //  - services/discovery.ts, pages/ProfileForm.tsx
  //                          pre-save probe flows: build a client for an
  //                          un-saved profile before it has a session
  const SANCTIONED = [
    'api/store-gates.ts',
    'services/sessions.ts',
    'services/discovery.ts',
    'pages/ProfileForm.tsx',
  ];

  it('ApiClient is constructed only in sanctioned files', () => {
    const offenders = srcFiles().filter(
      (f) =>
        !SANCTIONED.some((ok) => f.endsWith(ok)) &&
        !f.includes('__tests__') &&
        !f.endsWith('api/client.ts') &&
        /\bcreate(?:Store)?ApiClient\s*\(/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('the deleted singleton stays deleted', () => {
    const offenders = srcFiles().filter((f) => /\b(getApiClient|setApiClient)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the profile-id sentinels and the virtual prefix live only beside the brand', () => {
    // The virtual prefix joins the two sentinels here: it is the shape
    // isVirtualProfileId/isAggregateProfileId test for, so a second copy of
    // the literal is a second definition of what "aggregate" means. Callers
    // import the helpers instead, and mint ids with mintVirtualProfileId().
    //
    // The prefix match is open-ended, unlike the two sentinels: those are
    // whole ids, but this is a prefix, so '__virtual_legacy' hand-written
    // anywhere is the same second definition and has to be caught too.
    // Refs #337.
    const offenders = srcFiles().filter(
      (f) =>
        (read(f).includes("'__all_profiles__'") ||
          read(f).includes("'__probe__'") ||
          /['"`]__virtual_/.test(read(f))) &&
        !f.endsWith('api/types.ts'),
    );
    expect(offenders).toEqual([]);
  });

  it('stores/auth.ts never statically imports services/sessions.ts', () => {
    // sessions.ts injects a gate instead (see its file header) precisely to
    // avoid this cycle; a static import here would reintroduce it.
    const authFile = srcFiles().find((f) => f.endsWith('stores/auth.ts'))!;
    expect(/from\s+['"][^'"]*services\/sessions['"]/.test(read(authFile))).toBe(false);
  });
});

/**
 * Native contract: ACCESS_LOCAL_NETWORK is declared with the targetSdk bump
 * that makes it mandatory, never before it.
 *
 * Android grants local network access implicitly through INTERNET while an app
 * targets API 36 or lower, and Google's guide is explicit that such an app must
 * not declare the permission. Declaring it early forfeits the implicit grant on
 * an Android 17 device: the toggle shows up default-denied, the app never asks
 * for it, and every LAN server times out (#350).
 */
/**
 * Native logging never passes through the Logging contract's sanitizer, which
 * lives on the JS side. `agents/project/native.md` said of it "Nothing gates
 * it, so it is on you", and M1 predicts what happens next: the rule has now
 * been broken on both platforms (#307 on Android, the iOS extension since).
 *
 * The check is a heuristic, deliberately. It strips string literals so a
 * static message mentioning "URL" is not a hit, then looks for a risky
 * identifier among what is left, which is the arguments. It will occasionally
 * flag something harmless. That is the point: every hit has to carry a written
 * `// log-safe:` reason, so the decision is recorded next to the code instead
 * of being rediscovered by the next review.
 */
describe('Native contract: no bridge URL or raw error in a native log', () => {
  const NATIVE_ROOTS = ['app/ios/App', 'app/android/app/src/main/java'];
  const SKIP_DIRS = ['DerivedData', 'Pods', 'build'];
  const LOG_CALL = /(NSLog|os_log|CAPLog\.print|Log\.[dewiv])\s*\(/;
  const RISKY = /\b(url|uri|absoluteString|getMessage\(\)|localizedDescription)\b/i;
  const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;
  const EXCUSED = /\/\/\s*log-safe:/;

  const nativeSources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (SKIP_DIRS.includes(entry.name)) continue;
          walk(path.join(dir, entry.name));
        } else if (/\.(swift|java)$/.test(entry.name)) {
          out.push(path.join(dir, entry.name));
        }
      }
    };
    for (const root of NATIVE_ROOTS) walk(path.join(repoRoot, root));
    return out;
  };

  it('finds native sources to scan at all', () => {
    // Without this the suite passes by scanning nothing after any path move.
    expect(nativeSources().length).toBeGreaterThan(5);
  });

  it('every logged URL or raw error carries a written log-safe reason', () => {
    const offenders: string[] = [];
    for (const file of nativeSources()) {
      const lines = read(file).split('\n');
      lines.forEach((line, i) => {
        if (!LOG_CALL.test(line)) return;
        if (!RISKY.test(line.replace(STRING_LITERAL, '""'))) return;
        if (EXCUSED.test(line) || (i > 0 && EXCUSED.test(lines[i - 1]))) return;
        offenders.push(`${path.relative(repoRoot, file)}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      offenders,
      `native log of a URL or raw error with no // log-safe: reason:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('Native contract: Android local network permission', () => {
  it('declares ACCESS_LOCAL_NETWORK only once targetSdk requires it', () => {
    const androidDir = path.join(repoRoot, 'app/android');
    const target = Number(
      /targetSdkVersion\s*=\s*(\d+)/.exec(read(path.join(androidDir, 'variables.gradle')))?.[1],
    );
    expect(target).toBeGreaterThanOrEqual(36);

    const manifest = read(path.join(androidDir, 'app/src/main/AndroidManifest.xml'));
    const declared = /<uses-permission[^>]*android\.permission\.ACCESS_LOCAL_NETWORK/.test(manifest);

    if (target < 37) {
      expect(declared, 'ACCESS_LOCAL_NETWORK must not be declared below targetSdk 37').toBe(false);
      return;
    }
    // From 37 the permission is mandatory, and a declaration nobody requests at
    // runtime leaves users with the same dead LAN.
    expect(declared, 'targetSdk 37+ must declare ACCESS_LOCAL_NETWORK').toBe(true);
    expect(
      sourceText.includes('ACCESS_LOCAL_NETWORK'),
      'targetSdk 37+ needs a runtime permission request in app code',
    ).toBe(true);
  });
});

describe('Native contract: R8 keeps Capacitor plugin metadata', () => {
  it('does not optimize the release build without keeping PluginHandle', () => {
    const androidDir = path.join(repoRoot, 'app/android');
    const gradle = read(path.join(androidDir, 'app/build.gradle'));
    const optimizing = /getDefaultProguardFile\('proguard-android-optimize\.txt'\)/.test(gradle);
    if (!optimizing) return;

    // -optimize drops -dontoptimize, and R8's field optimization then deletes
    // PluginHandle.pluginAnnotation, so getPluginAnnotation() returns null and
    // every Capacitor permission check NPEs in Bridge.getPermissionStates.
    // That shipped in 2.2.1 and crashed the app on open. Optimizing
    // again is fine, but only with the reflective metadata kept.
    const rules = read(path.join(androidDir, 'app/proguard-rules.pro'));
    expect(
      /-keepclassmembers class com\.getcapacitor\.PluginHandle/.test(rules),
      'proguard-android-optimize.txt needs a keep rule for com.getcapacitor.PluginHandle members',
    ).toBe(true);
  });
});

describe('developer docs reference valid rule IDs', () => {
  it('every "rule <id>" reference resolves', () => {
    // Derived from AGENTS.md so adding or removing a rule cannot desync
    // this set (it did once, when M5 landed without a matching update).
    const core = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const valid = new Set([...core.matchAll(/^- ([IPCM][0-9]+)\./gm)].map((m) => m[1]));
    expect(valid.size).toBeGreaterThanOrEqual(20);
    const guideDir = path.join(repoRoot, 'docs/developer-guide');
    for (const file of fs.readdirSync(guideDir).filter((f) => f.endsWith('.rst'))) {
      const text = fs.readFileSync(path.join(guideDir, file), 'utf8');
      for (const m of text.matchAll(/\brules? ([IPCM]?[0-9]+)\b/gi)) {
        expect(valid.has(m[1].toUpperCase()), `${file}: unknown rule id "${m[1]}"`).toBe(true);
      }
    }
  });
});

/**
 * Localization contract, mechanical half: a translated string may say anything
 * it likes, but it has to interpolate the same values `en` does.
 *
 * A dropped or renamed `{{param}}` is invisible to the existing key gate,
 * which only checks that keys exist. The string still renders - it just
 * renders without the monitor name, the count, or the server it was about, in
 * one language only, which nobody reviewing an English diff would notice.
 */
describe('Localization contract', () => {
  const localesDir = path.join(appSrc, 'locales');

  /** Every leaf string, keyed by its dotted path. */
  function flatten(node: unknown, prefix = '', acc = new Map<string, string>()): Map<string, string> {
    if (typeof node === 'string') {
      acc.set(prefix, node);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        flatten(value, prefix ? `${prefix}.${key}` : key, acc);
      }
    }
    return acc;
  }

  /** Names only: `{{count}}` and `{{count, number}}` are the same parameter. */
  function placeholders(text: string): Set<string> {
    return new Set([...text.matchAll(/\{\{\s*([^}\s,]+)/g)].map((m) => m[1]));
  }

  function load(locale: string): Map<string, string> {
    return flatten(JSON.parse(read(path.join(localesDir, locale, 'translation.json'))));
  }

  it('every locale interpolates the same values as en, key for key', () => {
    const en = load('en');
    // 1380 today. A floor with real slack in it would let a partial parse
    // through and report parity over a handful of keys.
    expect(en.size).toBeGreaterThan(1000);

    const others = fs
      .readdirSync(localesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'en' && e.name !== '__tests__')
      .map((e) => e.name);
    expect(others.length).toBeGreaterThanOrEqual(4);

    const mismatches: string[] = [];
    for (const locale of others) {
      for (const [key, text] of load(locale)) {
        const enText = en.get(key);
        // Keys en does not have are the key gate's business, not this one.
        if (enText === undefined) continue;
        const expected = placeholders(enText);
        const actual = placeholders(text);
        const missing = [...expected].filter((p) => !actual.has(p));
        const extra = [...actual].filter((p) => !expected.has(p));
        if (missing.length || extra.length) {
          const parts = [
            missing.length ? `missing ${missing.map((p) => `{{${p}}}`).join(', ')}` : '',
            extra.length ? `unexpected ${extra.map((p) => `{{${p}}}`).join(', ')}` : '',
          ].filter(Boolean);
          mismatches.push(`${locale}: ${key} - ${parts.join(', ')}`);
        }
      }
    }

    expect(mismatches, `Placeholder drift against en:\n${mismatches.join('\n')}`).toEqual([]);
  });
});
