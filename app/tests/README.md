# Cross-Platform Test Setup

This guide covers setting up and running the full cross-platform test suite, which drives the actual app on Android Emulator, iOS Simulator (iPhone and iPad), and web browser.

---

## 1. Prerequisites

Install these tools before running any platform tests:

| Tool | Version | Notes |
|---|---|---|
| Xcode | 15+ | Required for iOS simulators and `xcrun simctl` |
| Android Studio | Latest | Required for AVD manager and Android SDK |
| Node.js | 20+ | Required for all npm scripts |
| Appium | 2.x | Global install; manages iOS and Android drivers |

---

## 2. First-Time Setup

Run these steps once on a new machine. After completing all steps, run `npm run test:platform:setup` from `app/` to verify everything is ready.

### Android

1. Open Android Studio → Virtual Device Manager → Create Device.
2. Select **Pixel 7** as the hardware profile.
3. Select system image: **API 34**, **arm64-v8a**, `google_apis` image (required for Apple Silicon Macs).
4. Name the AVD **`Pixel_7_API_34`** (this is the default name expected by the config).
5. Finish creating the AVD.
6. Verify `adb` is on your PATH:
   ```bash
   adb version
   ```
   If not found, add `$ANDROID_HOME/platform-tools` to your shell PATH.

### iOS

1. Open Xcode → Settings → Platforms → click **+** to add a platform.
2. Install **iOS 17** simulator runtime (download size is several GB).
3. Verify the required simulators exist:
   ```bash
   xcrun simctl list devices | grep -E "iPhone 15|iPad Air"
   ```
   You need both **iPhone 15** and **iPad Air 11-inch (M2)** listed. If missing, add them via Xcode → Window → Devices and Simulators.

### Appium

```bash
npm install -g appium
appium driver install xcuitest
appium driver install uiautomator2
```

Verify:
```bash
appium --version        # should be 2.x
appium driver list      # should show xcuitest and uiautomator2 as installed
```

### Verify All Setup

From the `app/` directory:

```bash
npm run test:platform:setup
```

This checks Xcode, iOS runtime, simulators, Android SDK, AVD, adb, Appium drivers, and port availability. Any failing check includes a fix instruction.

---

## 3. Platform Config

### Default Config

`app/tests/platforms.config.defaults.ts` ships with the repo and contains the default simulator names, ports, and timeouts:

- Android AVD: `Pixel_7_API_34`
- Android CDP port: `9222`
- iOS phone simulator: `iPhone 15` (iOS 17.5)
- iOS tablet simulator: `iPad Air 11-inch (M2)` (iOS 17.5)
- Appium port: `4723`
- App launch timeout: `30000` ms
- WebView switch timeout: `10000` ms

### Local Overrides

To use different simulator names or ports, copy the defaults file:

```bash
cp app/tests/platforms.config.defaults.ts app/tests/platforms.config.local.ts
```

The `*.local` gitignore pattern already covers this file, so it will not be committed.

Edit `platforms.config.local.ts` with your values. The config loader merges local over defaults at startup. You only need to set the fields you want to change.

### Finding Your Simulator Names

```bash
# List iOS simulators
xcrun simctl list devices

# List Android AVDs
emulator -list-avds
```

Use the exact name shown in the output as the value in your local config.

### Server Credentials

E2E tests connect to a real ZoneMinder server. Set credentials in `app/.env`:

```env
ZM_HOST_1=http://your-server:port
ZM_USER_1=admin
ZM_PASSWORD_1=password
```

---

## 4. Running Tests

All commands run from the `app/` directory.

### Web E2E (fast, no devices needed)

| Command | Description |
|---|---|
| `npm run test:e2e` | All web browser tests |
| `npm run test:e2e -- tests/features/dashboard.feature` | Single feature file |
| `npm run test:e2e -- --headed` | See the browser |
| `npm run test:e2e:visual-update` | Regenerate web visual baselines |
| `npm test` | Unit tests (Vitest, no server needed) |
| `npm run test:all` | Unit + web E2E |
| `npm run test:platform:setup` | Verify tools and simulators are ready |

### Device E2E (requires simulators/emulators)

Device tests are run via shell scripts from the repo root. Each script handles building the app, booting the device, and running the tests.

| Command | What it does |
|---|---|
| `bash scripts/test-android.sh` | Build APK, boot emulator, forward CDP port, run Playwright |
| `bash scripts/test-ios.sh phone` | Build iOS app, boot iPhone 15 sim, start Appium, run WebDriverIO |
| `bash scripts/test-ios.sh tablet` | Build iOS app, boot iPad Air sim, start Appium, run WebDriverIO |
| `bash scripts/test-all-platforms.sh` | Run all platforms sequentially (web, Android, iOS phone, iOS tablet) |

### Running Device Tests Step by Step

#### Android

```bash
# 1. Build and sync the Capacitor app to Android
cd app && npm run android:sync

# 2. Run the test script. It builds the APK, boots the emulator,
#    installs the app, forwards the CDP port, and runs Playwright
#    against the Android WebView.
bash scripts/test-android.sh

# Run a single feature file:
bash scripts/test-android.sh tests/features/dashboard.feature
```

**How it works:** The Android WebView exposes Chrome DevTools Protocol on a debug socket. The script uses `adb forward` to map it to `localhost:9222`, then Playwright connects via `connectOverCDP()` and drives the app like a regular browser.

#### iOS (iPhone)

```bash
# 1. Build and sync the Capacitor app to iOS
cd app && npm run ios:sync

# 2. Run the test script. It builds the app via xcodebuild for the
#    simulator, boots iPhone 15, starts Appium with XCUITest driver,
#    launches the app, switches to the WebView context, and runs
#    WebDriverIO tests.
bash scripts/test-ios.sh phone
```

**How it works:** Appium's XCUITest driver launches the app on the iOS simulator. WebDriverIO connects to Appium (default port 4723), which switches into the WKWebView context. From there, WebDriverIO can find elements by `data-testid` and drive the app.

#### iOS (iPad)

```bash
cd app && npm run ios:sync
bash scripts/test-ios.sh tablet
```

Same flow as iPhone, but targets `iPad Air 11-inch (M2)`.

#### All Platforms

```bash
bash scripts/test-all-platforms.sh
```

Runs in order: web, Android, iOS phone, iOS tablet.

### Device Screenshot Capture

For capturing device screenshots without running the full E2E suite:

| Command | Description |
|---|---|
| `npm run test:screenshots:ios-phone` | Capture screenshots on iPhone sim |
| `npm run test:screenshots:ios-tablet` | Capture screenshots on iPad sim |
| `npm run test:screenshots:android` | Capture screenshots on Android emulator |

These use `wdio.config.device-screenshots.ts` with Appium to launch the app and capture screenshots of each screen.

### Platform Tags

Scenarios are tagged to control which platforms run them:

| Tag | Runs on |
|---|---|
| `@all` | All platforms |
| `@android` | Android emulator only |
| `@ios` | iPhone + iPad simulators |
| `@ios-phone` | iPhone simulator only |
| `@ios-tablet` | iPad simulator only |
| `@web` | Web browser only |
| `@visual` | Triggers screenshot comparison |
| `@native` | Appium native suite only |

---

## 5. Visual Baselines

### Storage

Screenshot baselines are stored in `app/tests/screenshots/` per platform:

```
tests/screenshots/
├── web-chromium/
├── android-phone/
├── ios-phone/
└── ios-tablet/
```

Baselines are checked into git so every developer and CI run compares against the same reference images.

### Generating Baselines

On first run for a platform, or after intentional UI changes, generate new baselines:

```bash
# Web baselines
npm run test:e2e:visual-update

# Device baselines (pass the update flag through the test script)
bash scripts/test-android.sh --update-snapshots
bash scripts/test-ios.sh phone --update-snapshots
bash scripts/test-ios.sh tablet --update-snapshots
```

### Threshold

The pixel diff threshold is **0.2%**. Differences within this threshold pass. Differences above it fail.

### Reviewing Failures

When a visual test fails, a diff image is saved next to the baseline file showing the changed pixels. Inspect the diff to determine whether the change is intentional (update the baseline) or a regression (fix the code).

---

## 6. Architecture

### Two-Driver Design

Tests use two browser automation drivers:

| Driver | Platforms | Why |
|---|---|---|
| **Playwright** | Web, Android | Connects to Chromium-based WebViews via CDP |
| **WebDriverIO + Appium** | iOS | Drives WKWebView (WebKit) via XCUITest |

### TestActions Abstraction

Step definitions never call Playwright or WebDriverIO APIs directly. They use a shared `TestActions` interface (`tests/actions/types.ts`) so the same `.feature` files and step definitions work across all platforms.

Implementations:
- `PlaywrightActions` (`tests/actions/playwright-actions.ts`): for web and Android
- `WebDriverIOActions`: for iOS

### Config Loader

`tests/platforms.config.ts` loads defaults from `platforms.config.defaults.ts` and merges any overrides from `platforms.config.local.ts` (gitignored). The merged config provides simulator names, ports, timeouts, and app paths to all test infrastructure.

### Helper Modules

| File | Purpose |
|---|---|
| `tests/helpers/config.ts` | Loads server credentials from `.env` |
| `tests/helpers/ios-launcher.ts` | Builds iOS app, boots simulators, generates Appium capabilities |
| `tests/helpers/visual-regression.ts` | Screenshot paths and diff threshold constants |

---

## 7. Adding Tests

See the **"Extending Tests for New Features"** section in `AGENTS.md` for the full workflow.

Summary:

1. Write a human test plan. What would a QA tester check on each device?
2. Add Gherkin scenarios to the appropriate `tests/features/<screen>.feature` file. Tag with `@all`, `@ios-phone`, etc. as needed.
3. Add step definitions to `tests/steps/<screen>.steps.ts`. Use `TestActions` interface methods (not raw Playwright or WebDriverIO APIs) so steps work across all drivers.
4. If the feature uses a native plugin (haptics, filesystem, camera, etc.), add a test to `tests/native/specs/`.
5. Run with `--update-snapshots` on each platform to generate visual baselines, then commit them.

---

## 8. Troubleshooting

### "WebView context not found"

The app may not have finished loading when the test tried to switch context. Increase the `webviewSwitch` timeout in `platforms.config.local.ts`:

```typescript
timeouts: {
  webviewSwitch: 20000, // increase from default 10000
}
```

### "Appium can't find device" or "No device found"

The simulator or emulator name in config does not match what is installed. Check exact names:

```bash
xcrun simctl list devices     # iOS
emulator -list-avds           # Android
```

Update `platforms.config.local.ts` with the exact name shown.

### "Port already in use"

A previous test run left a process holding the port. Find and kill it:

```bash
lsof -ti :4723 | xargs kill   # Appium port
lsof -ti :9222 | xargs kill   # Android CDP port
```

Or change the port in `platforms.config.local.ts` to an unused one.

### "bddgen missing steps" / step not found error

A step used in a `.feature` file has no matching implementation. Add the step definition to the appropriate `tests/steps/<screen>.steps.ts` file.

### "Emulator won't boot" or hangs at startup

Check the AVD name matches exactly:

```bash
emulator -list-avds
```

If the name is wrong, update `platforms.config.local.ts`. If the AVD is corrupted, delete and recreate it in Android Studio Virtual Device Manager.

### iOS build fails with xcodebuild

Ensure Xcode CLI tools are installed and agree to the license:

```bash
xcode-select --install
sudo xcodebuild -license accept
```

Then verify the correct SDK is available:

```bash
xcodebuild -showsdks | grep iphonesimulator
```
