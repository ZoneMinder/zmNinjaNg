Testing Strategy
================

Three tiers:

1. **Unit tests**: logic and components, in isolation
2. **Web E2E**: user journeys in a browser against a real ZoneMinder server
3. **Device E2E**: the same journeys on Android emulator and iOS simulator

Every test verifies what a human would verify: can I do the task, does
it look right, does the data make sense.

Cross-Platform Architecture
---------------------------

Tests run on 4 platform profiles using two drivers:

.. list-table::
   :header-rows: 1

   * - Profile
     - Device
     - Driver
     - Connection
   * - ``web-chromium``
     - Desktop browser
     - Playwright
     - Direct launch
   * - ``android-phone``
     - Pixel 7 emulator
     - Playwright
     - ADB port-forward to CDP
   * - ``ios-phone``
     - iPhone 15 simulator
     - WebDriverIO + Appium XCUITest
     - WebView context switch
   * - ``ios-tablet``
     - iPad Air simulator
     - WebDriverIO + Appium XCUITest
     - WebView context switch

Playwright connects to Chromium WebViews via CDP. iOS uses WKWebView
(WebKit), which requires WebDriverIO + Appium.

TestActions Abstraction
~~~~~~~~~~~~~~~~~~~~~~~

Step definitions don't call Playwright or WebDriverIO APIs directly.
They use a shared ``TestActions`` interface
(``tests/actions/types.ts``) so the same Gherkin steps run on every
platform:

.. code:: typescript

   export interface TestActions {
     goto(path: string): Promise<void>;
     click(testId: string): Promise<void>;
     fill(testId: string, value: string): Promise<void>;
     getText(testId: string): Promise<string>;
     isVisible(testId: string, timeout?: number): Promise<boolean>;
     screenshot(name: string): Promise<Buffer>;
     compareScreenshot(name: string, threshold?: number): Promise<void>;
     platform(): PlatformProfile;
     // ... more methods in types.ts
   }

Two implementations exist:

- ``PlaywrightActions`` (``tests/actions/playwright-actions.ts``), for
  web and Android
- ``WebDriverIOActions``: for iOS

Unit Tests
----------

Technology Stack
~~~~~~~~~~~~~~~~

- **Vitest**: Fast test runner (Vite-based)
- **React Testing Library**: Component testing utilities
- **Testing Library User Event**: Simulate user interactions
- **vi.mock()**: Mocking dependencies

File Organization
~~~~~~~~~~~~~~~~~

Tests live next to the code they test in ``__tests__/`` subdirectories:

::

   src/
   ├── components/
   │   └── monitors/
   │       ├── MonitorCard.tsx
   │       └── __tests__/
   │           └── MonitorCard.test.tsx
   ├── lib/
   │   ├── crypto.ts
   │   └── __tests__/
   │       └── crypto.test.ts
   └── stores/
       ├── profile.ts
       └── __tests__/
           └── profile.test.ts

Running Unit Tests
~~~~~~~~~~~~~~~~~~

.. code:: bash

   # Run all unit tests
   npm test

   # Run specific test file
   npm test -- MonitorCard.test.tsx

   # Run tests matching pattern
   npm test -- dashboard

   # Watch mode (auto-rerun on changes)
   npm test -- --watch

   # With coverage report
   npm test -- --coverage

Writing Unit Tests
~~~~~~~~~~~~~~~~~~

Basic Test Structure
^^^^^^^^^^^^^^^^^^^^

.. code:: tsx

   import { describe, it, expect } from 'vitest';
   import { formatEventCount } from '../utils';

   describe('formatEventCount', () => {
     it('returns exact number for counts under 1000', () => {
       expect(formatEventCount(42)).toBe('42');
       expect(formatEventCount(999)).toBe('999');
     });

     it('formats thousands with K suffix', () => {
       expect(formatEventCount(1000)).toBe('1K');
       expect(formatEventCount(2500)).toBe('2.5K');
     });

     it('handles zero', () => {
       expect(formatEventCount(0)).toBe('0');
     });
   });

Testing React Components
^^^^^^^^^^^^^^^^^^^^^^^^^

.. code:: tsx

   import { describe, it, expect, vi } from 'vitest';
   import { render, screen } from '@testing-library/react';
   import userEvent from '@testing-library/user-event';
   import { MonitorCard } from '../MonitorCard';

   describe('MonitorCard', () => {
     const mockMonitor = {
       Id: '1', Name: 'Front Door',
       Width: '1920', Height: '1080',
       Function: 'Modect', Controllable: '0',
     };

     it('renders monitor name', () => {
       render(<MonitorCard monitor={mockMonitor} />);
       expect(screen.getByText('Front Door')).toBeInTheDocument();
     });

     it('calls onShowSettings when settings button clicked', async () => {
       const handleShowSettings = vi.fn();
       render(<MonitorCard monitor={mockMonitor} onShowSettings={handleShowSettings} />);

       await userEvent.click(screen.getByTestId('monitor-settings-button'));
       expect(handleShowSettings).toHaveBeenCalledWith(mockMonitor);
     });
   });

Mocking Dependencies
^^^^^^^^^^^^^^^^^^^^

**Zustand stores:**

.. code:: tsx

   vi.mock('../../../stores/profile');

   it('displays current profile name', () => {
     useProfileStore.mockReturnValue({
       currentProfileId: '1',
       profiles: [{ id: '1', name: 'My Profile' }],
     });
     render(<ProfileSelector />);
     expect(screen.getByText('My Profile')).toBeInTheDocument();
   });

**React Query:**

.. code:: tsx

   vi.mock('@tanstack/react-query');

   it('renders monitors when loaded', () => {
     useQuery.mockReturnValue({
       data: { monitors: [{ Monitor: { Id: '1', Name: 'Monitor 1' } }] },
       isLoading: false,
     });
     render(<MonitorList />);
     expect(screen.getByText('Monitor 1')).toBeInTheDocument();
   });

Unit Testing Rules
~~~~~~~~~~~~~~~~~~

- Test behaviour, not implementation: "clicking delete removes the
  monitor", not "handleDelete calls removeMonitor".
- Query with ``data-testid``.
- Mock external dependencies (stores, React Query, custom hooks).
- Reset shared state in ``beforeEach``.
- Cover edge cases: empty lists, null values, boundaries.

E2E Tests
---------

Technology Stack
~~~~~~~~~~~~~~~~

- **Playwright**: Browser automation (web + Android)
- **WebDriverIO + Appium**: Device automation (iOS)
- **playwright-bdd**: Gherkin/Cucumber integration for Playwright
- **Real ZoneMinder server**: Tests connect to an actual server

File Organization
~~~~~~~~~~~~~~~~~

::

   tests/
   ├── features/               # Gherkin feature files
   │   ├── dashboard.feature
   │   ├── monitors.feature
   │   ├── events.feature
   │   └── ...
   ├── steps/                  # Step definitions (one file per screen)
   │   ├── common.steps.ts     # Login, navigation, visual baseline
   │   ├── dashboard.steps.ts
   │   ├── monitors.steps.ts
   │   ├── monitor-detail.steps.ts
   │   ├── events.steps.ts
   │   ├── timeline.steps.ts
   │   ├── montage.steps.ts
   │   ├── settings.steps.ts
   │   ├── profiles.steps.ts
   │   ├── kiosk.steps.ts
   │   ├── group-filter.steps.ts
   │   └── platform.steps.ts
   ├── actions/                # Driver abstraction
   │   ├── types.ts            # TestActions interface
   │   └── playwright-actions.ts
   ├── helpers/
   │   ├── config.ts           # Server credentials from .env
   │   ├── ios-launcher.ts     # Build iOS app, boot simulator, Appium caps
   │   └── visual-regression.ts
   ├── screenshots/            # Visual baselines per platform
   │   ├── web-chromium/
   │   ├── android-phone/
   │   ├── ios-phone/
   │   └── ios-tablet/
   ├── device-screenshots/     # Device screenshot capture specs
   │   └── specs/
   ├── platforms.config.defaults.ts  # Default simulator names, ports, timeouts
   ├── platforms.config.local.ts     # Local overrides (gitignored)
   └── platforms.config.ts           # Config loader (merges local over defaults)

Platform Tags
~~~~~~~~~~~~~

Use tags in ``.feature`` files to control which platforms run each
scenario:

.. list-table::
   :header-rows: 1

   * - Tag
     - Runs on
   * - ``@all``
     - Every platform
   * - ``@android``
     - Android emulator only
   * - ``@ios``
     - iPhone + iPad simulators
   * - ``@ios-phone``
     - iPhone simulator only
   * - ``@ios-tablet``
     - iPad simulator only
   * - ``@web``
     - Web browser only
   * - ``@visual``
     - Triggers screenshot comparison
   * - ``@native``
     - Appium native suite only

Writing Gherkin Feature Files
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: gherkin

   # tests/features/monitors.feature
   Feature: Monitor Management

     Background:
       Given I am logged into zmNinjaNg

     @all @visual
     Scenario: View monitor list with live status
       When I navigate to the "Monitors" page
       Then I should see at least 1 monitor card
       And each monitor card should show the monitor name
       And the page should match the visual baseline

     @ios-phone @android
     Scenario: Monitor list adapts to phone layout
       When I navigate to the "Monitors" page
       Then monitor cards should not overflow the screen width
       And the page should match the visual baseline

Scenarios test user goals, not element presence.

Step Definitions
~~~~~~~~~~~~~~~~

Step definitions go in per-screen files under ``tests/steps/``. Use
``TestActions`` methods so steps work across all drivers:

.. code:: tsx

   // tests/steps/monitors.steps.ts
   import { createBdd } from 'playwright-bdd';

   const { Given, When, Then } = createBdd();

   When('I navigate to the {string} page', async ({ page }, pageName) => {
     await page.getByTestId(`nav-${pageName.toLowerCase()}`).click();
     await page.waitForLoadState('networkidle');
   });

   Then('I should see at least {int} monitor card(s)', async ({ page }, count) => {
     const cards = page.getByTestId('monitor-card');
     expect(await cards.count()).toBeGreaterThanOrEqual(count);
   });

Use dynamic selectors (``.first()``, ``.nth(n)``, "at least N"), never
hardcode monitor names or IDs.

Running Tests
-------------

All commands run from the ``app/`` directory.

Quick Reference
~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1

   * - Command
     - Description
   * - ``npm test``
     - Unit tests (Vitest)
   * - ``npm run test:e2e``
     - Web browser E2E (Playwright, fast)
   * - ``npm run test:e2e -- --headed``
     - Web E2E with visible browser
   * - ``npm run test:e2e -- tests/features/dashboard.feature``
     - Single feature file
   * - ``npm run test:e2e:visual-update``
     - Regenerate web visual baselines
   * - ``npm run test:platform:setup``
     - Verify device tools and simulators

Device E2E tests are run via shell scripts in ``scripts/``:

.. list-table::
   :header-rows: 1

   * - Command
     - Description
   * - ``npm run test:e2e:android``
     - Android emulator (Playwright via CDP)
   * - ``npm run test:e2e:ios-phone``
     - iPhone simulator (WebDriverIO + Appium)
   * - ``npm run test:e2e:ios-tablet``
     - iPad simulator (WebDriverIO + Appium)
   * - ``npm run test:e2e:all-platforms``
     - All platforms sequentially

Running Device Tests Step by Step
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Android emulator:**

.. code:: bash

   # 1. Build and sync the app
   cd app && npm run android:sync

   # 2. The npm script handles building, booting the emulator,
   #    installing the APK, forwarding the CDP port, and running
   #    Playwright against the Android WebView.
   npm run test:e2e:android

   # Run a single feature:
   npm run test:e2e:android -- tests/features/dashboard.feature

**iOS simulator (iPhone or iPad):**

.. code:: bash

   # 1. Build and sync the app
   cd app && npm run ios:sync

   # 2. The npm script builds the app via xcodebuild, boots the
   #    simulator, starts Appium, launches the app, switches to
   #    the WebView context, and runs WebDriverIO tests.
   npm run test:e2e:ios-phone     # iPhone 15
   npm run test:e2e:ios-tablet    # iPad Air

**All platforms sequentially:**

.. code:: bash

   npm run test:e2e:all-platforms

This runs: web, Android, iOS phone, iOS tablet, in order.

Device Screenshot Capture
~~~~~~~~~~~~~~~~~~~~~~~~~

For capturing device screenshots without running the full E2E suite:

.. code:: bash

   npm run test:screenshots:ios-phone
   npm run test:screenshots:ios-tablet
   npm run test:screenshots:android

These use a separate WebDriverIO config
(``wdio.config.device-screenshots.ts``) and Appium to launch the app
on the target device and capture screenshots of each screen.

Device Setup
------------

One-Time Machine Setup
~~~~~~~~~~~~~~~~~~~~~~

Prerequisites
^^^^^^^^^^^^^

.. list-table::
   :header-rows: 1

   * - Tool
     - Version
     - Notes
   * - Xcode
     - 15+
     - iOS simulators and ``xcrun simctl``
   * - Android Studio
     - Latest
     - AVD manager and Android SDK
   * - Node.js
     - 20+
     - All npm scripts
   * - Appium
     - 2.x
     - Global install; manages iOS and Android drivers

Android Setup
^^^^^^^^^^^^^

1. Open Android Studio → Virtual Device Manager → Create Device.
2. Select **Pixel 7** as the hardware profile.
3. Select system image: **API 34**, **arm64-v8a**,
   ``google_apis`` image (required for Apple Silicon Macs).
4. Name the AVD ``Pixel_7_API_34`` (default expected by config).
5. Verify ``adb`` is on your PATH:

.. code:: bash

   adb version
   # If not found, add $ANDROID_HOME/platform-tools to your shell PATH

iOS Setup
^^^^^^^^^

1. Open Xcode → Settings → Platforms → click **+** to add a
   platform.
2. Install **iOS 17** simulator runtime.
3. Verify the required simulators exist:

.. code:: bash

   xcrun simctl list devices | grep -E "iPhone 15|iPad Air"

You need both **iPhone 15** and **iPad Air 11-inch (M2)** listed. If
missing, add them via Xcode → Window → Devices and Simulators.

Appium Setup
^^^^^^^^^^^^

.. code:: bash

   npm install -g appium
   appium driver install xcuitest
   appium driver install uiautomator2

   # Verify:
   appium --version        # should be 2.x
   appium driver list      # should show xcuitest and uiautomator2

Verify All Setup
^^^^^^^^^^^^^^^^

.. code:: bash

   cd app
   npm run test:platform:setup

This checks Xcode, iOS runtime, simulators, Android SDK, AVD, adb,
Appium drivers, and port availability. Failing checks include fix
instructions.

Platform Config
~~~~~~~~~~~~~~~

**Default config** ships in
``tests/platforms.config.defaults.ts``:

- Android AVD: ``Pixel_7_API_34``, CDP port ``9222``
- iOS phone: ``iPhone 15`` (iOS 17.5)
- iOS tablet: ``iPad Air 11-inch (M2)`` (iOS 17.5)
- Appium port: ``4723``
- App launch timeout: ``30000`` ms
- WebView switch timeout: ``10000`` ms

**Local overrides**: Copy defaults to
``platforms.config.local.ts`` (gitignored) and edit only the
fields you need to change:

.. code:: bash

   cp tests/platforms.config.defaults.ts tests/platforms.config.local.ts

The config loader (``platforms.config.ts``) merges local over
defaults at startup.

**Finding your simulator names:**

.. code:: bash

   xcrun simctl list devices     # iOS
   emulator -list-avds           # Android

Server Credentials
~~~~~~~~~~~~~~~~~~

E2E tests connect to a real ZoneMinder server. Set credentials in
``app/.env``:

.. code:: bash

   ZM_HOST_1=http://your-server:port
   ZM_USER_1=admin
   ZM_PASSWORD_1=password

Visual Regression
-----------------

Scenarios tagged ``@visual`` capture screenshots and compare against
per-platform baselines stored in ``tests/screenshots/<platform>/``.

Threshold
~~~~~~~~~

The pixel diff threshold is **0.2%**. Differences within this
threshold pass. Differences above it fail.

Generating Baselines
~~~~~~~~~~~~~~~~~~~~

On first run for a platform, or after intentional UI changes:

.. code:: bash

   # Web baselines
   npm run test:e2e:visual-update

   # Device baselines (via test script with update flag)
   bash scripts/test-android.sh --update-snapshots
   bash scripts/test-ios.sh phone --update-snapshots

Reviewing Failures
~~~~~~~~~~~~~~~~~~

When a visual test fails, a diff image is saved next to the baseline
file showing the changed pixels. Inspect the diff to determine whether
the change is intentional (update the baseline) or a regression (fix
the code).

Testing Workflow
----------------

Test-Driven Development (TDD)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

1. **Write failing test** (feature file or unit test)
2. **Implement the feature/fix**
3. **Run tests**: verify they pass
4. **Refactor** if needed, tests ensure behavior stays correct

Pre-Commit Checklist
~~~~~~~~~~~~~~~~~~~~~

All changes:

- Run ``npm test``: all pass
- Run ``npx tsc --noEmit``: no errors
- Run ``npm run build``: succeeds

UI changes (additional):

- ``data-testid`` added to new interactive elements
- E2E scenarios updated in ``.feature`` file with platform tags
- ``npm run test:e2e`` passes
- Visual baselines updated if layout changed
- All language files updated (en, de, es, fr, zh)

Device E2E tests are manual-invoke-only. Run them when you want to
verify cross-platform behaviour.

Debugging Tests
---------------

Unit Test Debugging
~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   it('renders monitor', () => {
     render(<MonitorCard monitor={mockMonitor} />);
     screen.debug();  // Pretty-prints DOM
   });

.. code:: bash

   npm test -- MonitorCard.test.tsx   # Run single test file

E2E Test Debugging
~~~~~~~~~~~~~~~~~~

.. code:: bash

   # See the browser
   npm run test:e2e -- --headed

   # Playwright Inspector (pause + step through)
   npm run test:e2e -- --debug

.. code:: tsx

   // Add pause in step definition
   When('I click on monitor', async ({ page }) => {
     await page.pause();  // Opens Playwright Inspector
     await page.click('[data-testid="monitor-card"]');
   });

Test Coverage
~~~~~~~~~~~~~

.. code:: bash

   npm test -- --coverage

Aim for: logic/utilities at 100%, UI components at 70%+, overall
at 90%+.

Troubleshooting
---------------

WebView context not found
~~~~~~~~~~~~~~~~~~~~~~~~~

The app may not have finished loading when the test tried to switch
context. Increase the ``webviewSwitch`` timeout in
``platforms.config.local.ts``:

.. code:: typescript

   timeouts: {
     webviewSwitch: 20000,  // increase from default 10000
   }

Appium can't find device
~~~~~~~~~~~~~~~~~~~~~~~~~

The simulator or emulator name in config does not match what is
installed. Check exact names:

.. code:: bash

   xcrun simctl list devices     # iOS
   emulator -list-avds           # Android

Update ``platforms.config.local.ts`` with the exact name shown.

Port already in use
~~~~~~~~~~~~~~~~~~~

A previous test run left a process holding the port:

.. code:: bash

   lsof -ti :4723 | xargs kill   # Appium port
   lsof -ti :9222 | xargs kill   # Android CDP port

Or change the port in ``platforms.config.local.ts``.

Emulator won't boot
~~~~~~~~~~~~~~~~~~~~

Check the AVD name matches exactly:

.. code:: bash

   emulator -list-avds

If corrupted, delete and recreate in Android Studio Virtual Device
Manager.

iOS build fails
~~~~~~~~~~~~~~~

.. code:: bash

   xcode-select --install
   sudo xcodebuild -license accept
   xcodebuild -showsdks | grep iphonesimulator
