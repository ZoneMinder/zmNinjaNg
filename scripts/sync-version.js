#!/usr/bin/env node

/**
 * Synchronizes version from package.json to iOS and Android configuration files.
 * Run this before building to ensure all version numbers match.
 */

const fs = require('fs');
const path = require('path');

// Read version from package.json
const packageJsonPath = path.join(__dirname, '../app/package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`Syncing version ${version} to all platform configs...`);

// Update Android build.gradle (versionName and versionCode)
const buildGradlePath = path.join(__dirname, '../app/android/app/build.gradle');
if (fs.existsSync(buildGradlePath)) {
  let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');

  // Update versionName
  buildGradle = buildGradle.replace(
    /versionName ".*"/,
    `versionName "${version}"`
  );

  // Compute versionCode from version: major * 10000 + minor * 100 + patch
  const parts = version.split('.').map(Number);
  const versionCode = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  buildGradle = buildGradle.replace(
    /versionCode \d+/,
    `versionCode ${versionCode}`
  );

  fs.writeFileSync(buildGradlePath, buildGradle);
  console.log(`✓ Updated ${buildGradlePath} (versionName=${version}, versionCode=${versionCode})`);
}

// Update iOS Xcode project (MARKETING_VERSION)
const xcodeProjectPath = path.join(__dirname, '../app/ios/App/App.xcodeproj/project.pbxproj');
if (fs.existsSync(xcodeProjectPath)) {
  let xcodeProject = fs.readFileSync(xcodeProjectPath, 'utf8');
  xcodeProject = xcodeProject.replace(
    /MARKETING_VERSION = [\d.]+;/g,
    `MARKETING_VERSION = ${version};`
  );
  fs.writeFileSync(xcodeProjectPath, xcodeProject);
  console.log(`✓ Updated ${xcodeProjectPath}`);
}

console.log(`✅ All version numbers synced to ${version}`);
