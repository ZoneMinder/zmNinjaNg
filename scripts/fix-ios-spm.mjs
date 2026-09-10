#!/usr/bin/env node
/**
 * Repair a gutted Swift Package Manager cache before an iOS build.
 *
 * Xcode keeps every SPM dependency in two cache trees it marks as purgeable:
 * the shared clones in ~/Library/Caches/org.swift.swiftpm and the per-project
 * checkouts in <DerivedData>/App-<hash>/SourcePackages. macOS reclaims space
 * from purgeable directories file by file, leaving the directory tree standing
 * with its contents gone. SwiftPM then finds a checkout with no Package.swift
 * and a bare clone with no config, and resolution fails.
 *
 * The failure names nothing useful. From the CLI it reports a missing
 * Package.swift under a path no one has heard of; in Xcode it reports
 * "Missing package product 'CapApp-SPM'" and "Missing package product
 * 'LlamaKit'", which reads like the project lost its own local packages.
 * Neither points at a cache, and it has cost two sessions.
 *
 * So the CLI build resolves first and repairs on the way through. A purge is
 * only ever a re-download, but it is minutes of one, so it happens only when
 * the failure carries a corruption signature - a genuine version conflict
 * still fails fast with its own message.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');
const XCODE_PROJECT_DIR = join(REPO_ROOT, 'app/ios/App');
const DERIVED_DATA_ROOT = join(homedir(), 'Library/Developer/Xcode/DerivedData');
const SHARED_CACHE = join(homedir(), 'Library/Caches/org.swift.swiftpm');

/**
 * What a resolve failure says when the caches have been gutted, rather than
 * when the dependency graph is genuinely unsatisfiable. The last one is
 * ambiguous on its own - a real version conflict says it too - but it only
 * reaches us after a resolve that already failed, and a needless purge costs
 * a re-download while a missed one costs a session.
 */
const CORRUPTION_SIGNS = [
  'is not valid git repository',
  "cannot be accessed",
  'Missing package product',
  'no versions of',
];

/** Whether a failed resolve looks like cache corruption rather than a real conflict. */
export function isSpmCacheCorruption(output) {
  return CORRUPTION_SIGNS.some((sign) => output.includes(sign));
}

/**
 * The DerivedData SourcePackages trees belonging to one checkout.
 *
 * Two clones of this repo produce two `App-<hash>` directories and a machine
 * may hold several `App-` projects that are nothing to do with us, so the
 * owner is identified by the local package paths SwiftPM records in
 * workspace-state.json, not by the directory name.
 *
 * @param entries - `{ path, state }` per candidate, state being the file's
 *   text or null when it could not be read.
 * @param projectRoot - Absolute path of the checkout being built.
 */
export function ownedSourcePackages(entries, projectRoot) {
  return entries.filter(({ state }) => state !== null && state.includes(projectRoot)).map((e) => e.path);
}

function readSourcePackageEntries() {
  if (!existsSync(DERIVED_DATA_ROOT)) return [];
  return readdirSync(DERIVED_DATA_ROOT)
    .map((name) => join(DERIVED_DATA_ROOT, name, 'SourcePackages'))
    .filter((path) => existsSync(path))
    .map((path) => {
      const stateFile = join(path, 'workspace-state.json');
      let state = null;
      try {
        state = readFileSync(stateFile, 'utf8');
      } catch {
        // A SourcePackages tree with no readable state is one whose owner we
        // cannot prove, so it is left alone.
      }
      return { path, state };
    });
}

function resolvePackages() {
  try {
    execFileSync(
      'xcodebuild',
      ['-project', 'App.xcodeproj', '-scheme', 'App', '-resolvePackageDependencies'],
      { cwd: XCODE_PROJECT_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { ok: true, output: '' };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function main() {
  const first = resolvePackages();
  if (first.ok) return 0;

  if (!isSpmCacheCorruption(first.output)) {
    process.stderr.write(first.output);
    process.stderr.write('\nPackage resolution failed for a reason that is not a gutted cache.\n');
    return 1;
  }

  process.stdout.write('SPM caches are incomplete; purging and re-resolving. This re-downloads.\n');
  for (const dir of ['repositories', 'manifests']) {
    rmSync(join(SHARED_CACHE, dir), { recursive: true, force: true });
  }
  for (const path of ownedSourcePackages(readSourcePackageEntries(), REPO_ROOT)) {
    process.stdout.write(`  removing ${path}\n`);
    rmSync(path, { recursive: true, force: true });
  }

  const second = resolvePackages();
  if (second.ok) {
    process.stdout.write('Packages resolved.\n');
    return 0;
  }
  process.stderr.write(second.output);
  process.stderr.write('\nStill failing after a purge, so the cause is not the cache.\n');
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
