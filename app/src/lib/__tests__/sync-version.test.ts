import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// scripts/sync-version.js is a repo-root CommonJS build script. It exports pure
// string transforms that this suite exercises; the file-writing main() only
// runs when the script is invoked directly (require.main === module).
import syncVersion from '../../../../scripts/sync-version.js';

const { applyGradleVersion, applyXcodeVersion, buildNumberXcconfig } = syncVersion;

const repo = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(repo, path), 'utf8');

describe('sync-version', () => {
  it('sets Android versionName to the marketing version', () => {
    const gradle = `    defaultConfig {
        applicationId "com.zoneminder.zmNinjaNG"
        versionName "1.1.14"
    }`;

    expect(applyGradleVersion(gradle, '2.1.1')).toContain('versionName "2.1.1"');
  });

  it('sets iOS MARKETING_VERSION across every build config', () => {
    const pbxproj = `
				MARKETING_VERSION = 1.1.14;
				MARKETING_VERSION = 1.1.14;`;

    expect(applyXcodeVersion(pbxproj, '2.1.1').match(/MARKETING_VERSION = 2\.1\.1;/g)).toHaveLength(2);
  });

  it('writes the build number as an xcconfig setting', () => {
    expect(buildNumberXcconfig(3035)).toMatch(/^CURRENT_PROJECT_VERSION = 3035$/m);
  });
});

// The build number is the git commit count, worked out when a build runs, so a
// build never rewrites a tracked file (and a dirty tree never blocks a branch
// switch). A literal number in either file would be stale after the next commit.
describe('native build numbers come from the build, not the tracked files', () => {
  it('Android computes versionCode from the git commit count, above the legacy scheme', () => {
    // Builds before mid-2026 used major*10000 + minor*100 + patch (v1.1.14 ->
    // 10114); the 100000 offset keeps every commit-count code above those.
    const gradle = read('app/android/app/build.gradle');
    expect(gradle).not.toMatch(/versionCode \d+\s*$/m);
    expect(gradle).toMatch(/versionCode 100000 \+ gitCommitCount/);
    expect(gradle).toMatch(/'rev-list', '--count', 'HEAD'/);
  });

  it('iOS targets inherit CURRENT_PROJECT_VERSION from the project xcconfig', () => {
    const pbxproj = read('app/ios/App/App.xcodeproj/project.pbxproj');
    expect(pbxproj).not.toMatch(/CURRENT_PROJECT_VERSION/);
    expect(pbxproj.match(/baseConfigurationReference = \w+ \/\* Version\.xcconfig \*\//g)).toHaveLength(2);

    const xcconfig = read('app/ios/App/Version.xcconfig');
    expect(xcconfig).toMatch(/#include\? "BuildNumber\.xcconfig"/);
    expect(read('app/ios/.gitignore')).toMatch(/^App\/BuildNumber\.xcconfig$/m);
  });
});
