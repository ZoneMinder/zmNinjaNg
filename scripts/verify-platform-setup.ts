import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

function pass(label: string, detail: string): void {
  process.stdout.write(`\u2713 ${label} (${detail})\n`);
}

function fail(label: string, fix: string): void {
  process.stdout.write(`\u2717 ${label} \u2014 ${fix}\n`);
}

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// 1. Xcode installed
try {
  const xcodePath = run('xcode-select -p');
  pass('Xcode installed', `found at ${xcodePath}`);
} catch {
  fail('Xcode not found', 'install Xcode from the App Store');
}

// 2. iOS simulator runtime available
try {
  const runtimes = run('xcrun simctl list runtimes');
  const iosRuntime = runtimes.split('\n').find(l => l.includes('iOS'));
  if (iosRuntime) {
    pass('iOS simulator runtime available', iosRuntime.trim().split('(')[0]!.trim());
  } else {
    fail('iOS simulator runtime not found', 'open Xcode → Settings → Platforms and download an iOS runtime');
  }
} catch {
  fail('xcrun simctl not available', 'install Xcode command line tools: xcode-select --install');
}

// 3. iPhone 15 simulator exists
try {
  const devices = run('xcrun simctl list devices');
  if (devices.includes('iPhone 15')) {
    pass('iPhone 15 simulator exists', 'found in simctl list');
  } else {
    fail('iPhone 15 simulator not found', 'open Xcode → Windows → Devices and Simulators → add iPhone 15');
  }
} catch {
  fail('Cannot list simulators', 'install Xcode command line tools: xcode-select --install');
}

// 4. iPad Air simulator exists
try {
  const devices = run('xcrun simctl list devices');
  if (devices.includes('iPad Air')) {
    pass('iPad Air simulator exists', 'found in simctl list');
  } else {
    fail('iPad Air simulator not found', 'open Xcode → Windows → Devices and Simulators → add iPad Air');
  }
} catch {
  fail('Cannot list simulators', 'install Xcode command line tools: xcode-select --install');
}

// 5. Android SDK found
const androidHome = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'] ?? '';
if (androidHome && fs.existsSync(androidHome)) {
  pass('Android SDK found', `ANDROID_HOME=${androidHome}`);
} else {
  fail('Android SDK not found', 'install Android Studio and set ANDROID_HOME or ANDROID_SDK_ROOT');
}

// 6. AVD exists
try {
  const emulatorBin = androidHome ? path.join(androidHome, 'emulator', 'emulator') : 'emulator';
  const avds = run(`"${emulatorBin}" -list-avds`);
  if (avds.trim().length > 0) {
    const first = avds.split('\n')[0]!.trim();
    pass('Android AVD exists', first);
  } else {
    fail('No Android AVD found', 'open Android Studio → Device Manager → create a virtual device');
  }
} catch {
  fail('Cannot list AVDs', 'install Android Studio and create a virtual device via Device Manager');
}

// 7. adb accessible
try {
  const adbVersion = run('adb version');
  const versionLine = adbVersion.split('\n')[0]!.trim();
  pass('adb accessible', versionLine);
} catch {
  fail('adb not found', 'add $ANDROID_HOME/platform-tools to your PATH');
}

// 8. Appium installed
try {
  const appiumVersion = run('appium --version');
  pass('Appium installed', `version ${appiumVersion}`);
} catch {
  fail('Appium not found', 'install with: npm install -g appium');
}

// 9. XCUITest driver installed
try {
  const drivers = run('appium driver list --installed');
  if (drivers.includes('xcuitest')) {
    pass('XCUITest driver installed', 'found in appium driver list');
  } else {
    fail('XCUITest driver not installed', 'install with: appium driver install xcuitest');
  }
} catch {
  fail('Cannot check Appium drivers', 'ensure Appium is installed: npm install -g appium');
}

// 10. UiAutomator2 driver installed
try {
  const drivers = run('appium driver list --installed');
  if (drivers.includes('uiautomator2')) {
    pass('UiAutomator2 driver installed', 'found in appium driver list');
  } else {
    fail('UiAutomator2 driver not installed', 'install with: appium driver install uiautomator2');
  }
} catch {
  fail('Cannot check Appium drivers', 'ensure Appium is installed: npm install -g appium');
}

// 11. Ports 4723, 9222 available
const ports = [4723, 9222];
for (const port of ports) {
  try {
    // Use lsof to check if port is in use (avoids async)
    run(`lsof -i :${port} -sTCP:LISTEN`);
    fail(`Port ${port} in use`, `stop whatever is using port ${port} before running tests`);
  } catch {
    // lsof exits non-zero when nothing is listening — port is free
    pass(`Port ${port} available`, 'not in use');
  }
}

// 13. platforms.config.local.ts existence
const localConfigPath = path.resolve(SCRIPT_DIR, '../app/tests/platforms.config.local.ts');
if (fs.existsSync(localConfigPath)) {
  pass('platforms.config.local.ts exists', localConfigPath);
} else {
  fail(
    'platforms.config.local.ts not found',
    `copy app/tests/platforms.config.defaults.ts to ${localConfigPath} and fill in device details`,
  );
}
