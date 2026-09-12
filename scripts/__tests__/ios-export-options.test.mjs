import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATOR = join(REPO_ROOT, 'scripts/ios-export-options.sh');
const PBXPROJ = join(REPO_ROOT, 'app/ios/App/App.xcodeproj/project.pbxproj');

/** The generated plist as an object, via plutil so malformed output fails here. */
function exportOptions() {
  const plist = execFileSync('bash', [GENERATOR], { encoding: 'utf8' });
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: plist,
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

test('export options upload to App Store Connect rather than writing an ipa', () => {
  const options = exportOptions();
  // Without destination=upload, -exportArchive succeeds and leaves the ipa on
  // disk. The release then looks green while nothing reached Apple.
  assert.equal(options.destination, 'upload');
  assert.equal(options.method, 'app-store-connect');
});

test('export options take the signing team from the Xcode project', () => {
  const teams = [...readFileSync(PBXPROJ, 'utf8').matchAll(/DEVELOPMENT_TEAM = ([A-Z0-9]+);/g)]
    .map((m) => m[1]);
  assert.ok(teams.length > 0, 'project.pbxproj declares no DEVELOPMENT_TEAM');
  assert.equal(new Set(teams).size, 1, `project targets mix teams: ${[...new Set(teams)].join(', ')}`);
  assert.equal(exportOptions().teamID, teams[0]);
});
