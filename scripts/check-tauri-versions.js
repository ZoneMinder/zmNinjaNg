#!/usr/bin/env node
/**
 * Validates that Tauri Rust crate versions match their JS counterparts.
 * Tauri requires major.minor to match between Rust crates and JS packages
 * for the core API and every plugin.
 *
 * Checks Cargo.lock (resolved versions) against package.json.
 * Exits with code 1 if mismatches are found.
 */

const fs = require('fs');
const path = require('path');

const appDir = path.resolve(__dirname, '..', 'app');
const cargoLock = path.join(appDir, 'src-tauri', 'Cargo.lock');
const packageJson = path.join(appDir, 'package.json');

// Mapping: Rust crate name → JS package name. Must include core (tauri ↔
// @tauri-apps/api) — that pair regressed in CI after a Cargo.lock bump
// because it was missing here.
const PACKAGE_MAP = {
  'tauri': '@tauri-apps/api',
  'tauri-plugin-dialog': '@tauri-apps/plugin-dialog',
  'tauri-plugin-fs': '@tauri-apps/plugin-fs',
  'tauri-plugin-http': '@tauri-apps/plugin-http',
  'tauri-plugin-log': '@tauri-apps/plugin-log',
};

function parseCargoLockVersions(lockContent) {
  const versions = {};
  const lines = lockContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(/^name = "(.+)"$/);
    if (nameMatch && PACKAGE_MAP[nameMatch[1]]) {
      const versionMatch = lines[i + 1]?.match(/^version = "(.+)"$/);
      if (versionMatch) {
        versions[nameMatch[1]] = versionMatch[1];
      }
    }
  }
  return versions;
}

function getMajorMinor(version) {
  const parts = version.replace(/^[\^~]/, '').split('.');
  return `${parts[0]}.${parts[1]}`;
}

// Read files
const lockContent = fs.readFileSync(cargoLock, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

const rustVersions = parseCargoLockVersions(lockContent);
let hasError = false;

console.log('Checking Tauri plugin version alignment...');

for (const [rustCrate, jsPackage] of Object.entries(PACKAGE_MAP)) {
  const rustVer = rustVersions[rustCrate];
  const jsVer = deps[jsPackage];

  if (!rustVer || !jsVer) continue;

  const rustMM = getMajorMinor(rustVer);
  const jsMM = getMajorMinor(jsVer);

  if (rustMM !== jsMM) {
    console.error(`  ❌ ${rustCrate} (${rustVer}) ↔ ${jsPackage} (${jsVer}) — major.minor mismatch`);
    console.error(`     Fix: npm install ${jsPackage}@^${rustVer}`);
    hasError = true;
  } else {
    console.log(`  ✓ ${rustCrate} (${rustVer}) ↔ ${jsPackage} (${jsVer})`);
  }
}

if (hasError) {
  console.error('\n❌ Tauri plugin version mismatches found. Fix before releasing.');
  process.exit(1);
} else {
  console.log('\n✅ All Tauri plugin versions aligned.');
}
