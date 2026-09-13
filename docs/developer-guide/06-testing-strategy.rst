Testing Strategy
================

Tests are layered:

1. **Unit tests**: functions, stores, and components, in isolation, in Node.
2. **Web E2E**: user journeys in a real browser against a real ZoneMinder server.
3. **Device E2E**: an Appium harness that drives the built app on an Android
   emulator and iOS simulators.

Every test verifies what a human tester would verify: can I do the task, did
the data change, does it survive a refresh.

Reading one unit test
---------------------

Start with the simplest kind. ``formatEventCount`` in ``lib/utils.ts`` turns an
event count into a badge label. Its test imports the function and calls it.
There is no React here at all, and most of the ``lib/`` suite looks like this:

.. code:: ts

   // src/lib/__tests__/utils.test.ts, trimmed
   import { cn, escapeHtml, formatEventCount } from '../utils';

   describe('formatEventCount', () => {
     it('formats numbers under 1000 as-is', () => {
       expect(formatEventCount(0)).toBe('0');
       expect(formatEventCount(42)).toBe('42');
       expect(formatEventCount(999)).toBe('999');
     });

     it('formats 1000+ as "k+"', () => {
       expect(formatEventCount(1000)).toBe('1k+');
       expect(formatEventCount(50000)).toBe('50k+');
     });

     it('handles undefined', () => {
       expect(formatEventCount(undefined)).toBe('0');
     });
   });

``npm test`` runs Vitest, which finds every ``*.test.ts`` and ``*.test.tsx``
under ``src/``. Nothing above needs a browser.

A component test needs more, because a React component is not a value you can
call and inspect. It is a function that describes what the screen should look
like, and React turns that description into DOM nodes. So the test needs
somewhere to put those nodes. ``app/vitest.config.ts`` sets
``environment: 'jsdom'``, which gives each test file a fake ``document`` and
``window`` implemented in JavaScript. No browser process is started.

Here are two tests from
``components/common/__tests__/RefreshButton.test.tsx`` (the file also
mocks ``react-i18next``, which the component imports; trimmed here):

.. code:: tsx

   import { describe, it, expect, vi } from 'vitest';
   import { render, screen } from '@testing-library/react';
   import userEvent from '@testing-library/user-event';
   import { RefreshButton } from '../RefreshButton';

   describe('RefreshButton', () => {
     it('fires onRefresh when clicked', async () => {
       const handle = vi.fn();
       const user = userEvent.setup();
       render(<RefreshButton onRefresh={handle} />);
       await user.click(screen.getByTestId('refresh-button'));
       expect(handle).toHaveBeenCalledTimes(1);
     });

     it('disables the button when isLoading is true', () => {
       render(<RefreshButton onRefresh={() => {}} isLoading />);
       expect(screen.getByTestId('refresh-button')).toBeDisabled();
     });
   });

Four pieces carry that test: ``render()``, ``screen``, ``vi.fn()``, and the
awaited ``user.click()``.

``render()`` mounts the component into that jsdom document, exactly as the app
mounts it into a real one at startup.

``screen`` queries that document. It hands back DOM nodes, not React objects,
so the assertions can only see what a user could see. A test
written this way keeps passing when the component is rewritten with different
internal state, and starts failing when the button stops being clickable, which
is the failure a user would notice.

``vi.fn()`` creates a stand-in function that records the calls made to it. Here
it stands in for whatever the real parent passes as ``onRefresh``.

``await user.click(...)`` is awaited because the click is not over when the DOM
event fires. Clicking a button calls the handler, the handler may set state,
React then re-renders the component and updates the DOM. React batches that
work and flushes it asynchronously. Awaiting the click waits for the flush, so
the assertion on the next line runs against the settled DOM rather than the DOM
as it was mid-update. Forget the ``await`` and the test reads a stale screen.

Test behavior, not implementation: assert that clicking delete removes the
monitor, not that ``handleDelete`` called ``removeMonitor``. The second test breaks on every refactor and passes even when
the button is unreachable.

Where tests live
----------------

Tests sit next to the code they cover, in a ``__tests__/`` subdirectory:

::

   src/
   ├── components/
   │   └── monitors/
   │       ├── MonitorCard.tsx
   │       └── __tests__/
   │           └── MonitorCard.test.tsx
   ├── lib/
   │   ├── utils.ts
   │   └── __tests__/
   │       └── utils.test.ts
   └── stores/
       ├── monitors.ts
       └── __tests__/
           └── monitors.test.ts

Vitest loads ``src/tests/setup.ts`` before any test file. That is where the
Capacitor plugin mocks live, so a component that dynamically imports
``@capacitor/haptics`` on a native platform does not explode under Node.

Mocking at the boundary
---------------------------------

``MonitorCard`` reaches for a Zustand store, the current profile, React Router,
i18next, and a child component that opens a live video stream. Rendering it
untouched in Node would try to hit a ZoneMinder server. The test would be slow,
would fail when the server is down, and would no longer be a unit test.

``vi.mock(path, factory)`` replaces a module. Vitest hoists these calls above
the imports and registers the factory against the resolved module id, so the
test's ``'../../../api/store-gates'`` and the app's ``'../api/store-gates'``
resolve to the same module and the app receives what the factory returned.
Always pass the factory: a bare ``vi.mock(path)`` auto-stubs at runtime while
the import keeps the real types, and TypeScript rejects the
``.mockReturnValue()`` you were about to write.

The testing playbook fixes what to mock: the boundary, never the app. The
boundary is ``api/*`` (the HTTP
client and the functions that call it), platform plugins (``setup.ts`` already
mocks Capacitor), third-party modules such as React Router, i18next and toast,
and a heavy leaf child that would open a stream or a canvas. The stores,
hooks, services and components in between run for real.

The reason is a failure mode a mocked store cannot show. In production
``useShallow`` wraps a selector and compares its result field by field; a
selector that mints a fresh array or object on every call defeats that and the
component re-renders forever through ``useSyncExternalStore``. A test that
stubs the store, or stubs ``useShallow`` to the identity function, sees a clean
pass. Seven test files in this repository carried exactly that stub; against
the real store three of them looped with "Maximum update depth exceeded", and
the quality ratchet now fails any file that reintroduces it.

Seeding the real stores
~~~~~~~~~~~~~~~~~~~~~~~

``src/tests/profile-fixture.ts`` is the one way to do it. Two hoisted
one-liners swap the boundary for fakes; ``seedProfiles`` fills the real
profile, settings and auth stores; ``installApiClient`` scripts the responses
the real session registry's client will return. An unscripted request rejects,
so a test cannot pass on a request nobody scripted.

.. code:: tsx

   // src/components/dashboard/__tests__/DashboardConfig.test.tsx, trimmed
   vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
   vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

   import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
   import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
   import { useDashboardStore } from '../../../stores/dashboard';

   beforeEach(() => seedProfiles(['profile-1']));
   afterEach(() => { resetProfileFixture(); resetFakeStoreGates(); });

The test then asserts on the store, which is where a user's click ends up.
No ``addWidget`` spy: the real action ran, and the widget is either in the
real store or it is not.

.. code:: tsx

   it('adds a monitor widget when a monitor is selected', () => {
     render(<DashboardConfig />);

     fireEvent.click(screen.getByTestId('add-widget-trigger'));
     fireEvent.click(screen.getByTestId('monitor-checkbox-1'));
     fireEvent.change(screen.getByTestId('widget-title-input'), {
       target: { value: 'My Monitor' },
     });
     fireEvent.click(screen.getByTestId('widget-add-button'));

     const widgets = useDashboardStore.getState().widgets['profile-1'];
     expect(widgets).toHaveLength(1);
     expect(widgets[0]).toMatchObject({
       type: 'monitor',
       title: 'My Monitor',
       settings: { monitorIds: ['1'], feedFit: 'contain' },
     });
   });

Assert values, not existence. ``toBeInTheDocument()`` says an element
rendered and nothing about what it shows; the quality ratchet counts those
too. The first file converted this way found a real bug: "the progress bar
exists" became "the bar reports 40%", and it did not, because ``Progress``
never forwarded ``value`` to its Radix root.

Mocking React Query
~~~~~~~~~~~~~~~~~~~

``useQuery`` normally fetches over the network and caches the result. Replace it
with a function that returns the cache entry you want the component to see:

.. code:: tsx

   vi.mock('@tanstack/react-query', () => ({
     useQuery: () => ({
       data: {
         monitors: [
           { Monitor: { Id: '1', Name: 'Front Door', Deleted: false } },
           { Monitor: { Id: '2', Name: 'Back Door', Deleted: false } },
         ],
       },
     }),
   }));

Return ``{ data: undefined, isLoading: true }`` from the same factory to test
the loading branch, and an ``error`` to test the error wall.

Mocking a streaming hook
~~~~~~~~~~~~~~~~~~~~~~~~

``useMonitorStream`` opens an MJPEG connection. ``LiveMonitorPlayer.test.tsx``
swaps it for a plain object, which lets the test drive stream errors and
connection-key changes by hand:

.. code:: tsx

   // src/components/monitors/__tests__/LiveMonitorPlayer.test.tsx
   let mockMjpegReturn: {
     streamUrl: string;
     imageSrc: string;
     imgRef: { current: HTMLImageElement | null };
     regenerateConnection: () => void;
     reportStreamError: () => void;
     reportStreamLoad: () => void;
   };

   vi.mock('../../../hooks/useMonitorStream', () => ({
     useMonitorStream: () => mockMjpegReturn,
   }));

``MonitorCard.test.tsx`` takes the other route and mocks the whole
``LiveMonitorPlayer`` child down to a ``<div data-testid="video-player">``.
Mock at whichever boundary keeps the component's own behavior under test.

Testing a store directly
------------------------

A Zustand store is a plain object outside React, so it needs no ``render()``.
Reset it in ``beforeEach``, call actions through ``getState()``, and assert on
the state afterwards. From ``src/stores/__tests__/monitors.test.ts``:

.. code:: ts

   import { useMonitorStore } from '../monitors';

   describe('Monitor Store', () => {
     beforeEach(() => {
       useMonitorStore.setState({ connKeys: {} });
       vi.spyOn(Math, 'random').mockReturnValue(0.12345);
     });

     it('creates a new connection key when missing', () => {
       const key = useMonitorStore.getState().getConnKey('2');

       expect(key).toBe(12345);
       expect(useMonitorStore.getState().connKeys['2']).toBe(12345);
     });

     it('clears a stored connection key without touching other monitors', () => {
       useMonitorStore.setState({ connKeys: { '1': 999, '2': 888 } });

       useMonitorStore.getState().clearConnKey('1');

       expect(useMonitorStore.getState().connKeys['1']).toBeUndefined();
       expect(useMonitorStore.getState().connKeys['2']).toBe(888);
     });
   });

The ``beforeEach`` reset matters because the store module is imported once per
test file and its state survives between ``it`` blocks. Without the reset, test
order decides the result.

Running unit tests
------------------

All commands run from ``app/``.

.. code:: bash

   npm test                            # Vitest (watch mode in a TTY)
   npm run test:unit                   # single run, no watch
   npm test -- MonitorCard.test.tsx    # one file
   npm test -- dashboard               # every file matching the pattern
   npm test -- --coverage              # with a coverage report

Before every commit, run the verification sequence P3 in ``AGENTS.md`` names.
The commands above are what that sequence runs for the unit tier.

Coverage
~~~~~~~~

``app/vitest.config.ts`` sets one threshold for the whole suite: **60%** for
lines, functions, branches, and statements, using the v8 provider. Drop below
any of them and ``npm test -- --coverage`` fails. ``src/tests/``, config files,
and mock data are excluded from the measurement.

There is no per-directory target. Raise the four numbers in the ``thresholds``
block of ``app/vitest.config.ts`` rather than adding a rule here.

End-to-end tests
----------------

E2E tests drive the real app in a real browser against a real ZoneMinder
server. They are written in Gherkin (``.feature`` files) and executed by
Playwright through ``playwright-bdd``, which generates Playwright specs from
the feature files at run time (``bddgen``, in the ``test:e2e`` script).

::

   app/tests/
   ├── features/               # 19 Gherkin feature files
   │   ├── dashboard.feature
   │   ├── monitors.feature
   │   ├── events.feature
   │   └── ...
   ├── steps/                  # step definitions, one file per screen
   │   ├── common.steps.ts     # login, navigation
   │   ├── monitors.steps.ts
   │   ├── ptz.steps.ts
   │   └── ...
   ├── helpers/
   │   ├── config.ts           # server credentials from .env
   │   ├── zm-api.ts           # direct ZoneMinder API queries for test setup
   │   └── ios-launcher.ts     # Appium capabilities for the iOS simulators
   ├── device-screenshots/specs/     # Appium screenshot capture
   ├── platforms.config.defaults.ts  # simulator names, ports, timeouts
   └── platforms.config.local.ts     # local overrides (gitignored)

Feature files
~~~~~~~~~~~~~

Each scenario is one user goal, not one element:

.. code:: gherkin

   # tests/features/monitors.feature
   Feature: Monitor List and Navigation

     Background:
       Given I am logged into zmNinjaNg
       When I navigate to the "Monitors" page

     @all
     Scenario: Monitor list shows all monitors with names and status
       Then I should see at least 1 monitor cards
       And each monitor card should show a name and status indicator

     @all
     Scenario: Tap monitor card navigates to detail page with live feed
       And I should see at least 1 monitor cards
       When I click into the first monitor detail page
       Then I should see the monitor player

Note ``at least 1``, not ``5``. The test server's contents change. A scenario
that says ``When I select "Front Door" monitor`` or ``Then I should see 5
events`` passes on one server and fails on every other one. Use ``.first()``,
``.nth(n)``, and "at least N" instead of hardcoding names, IDs, or counts.

Tags mark which platforms a scenario is meant for. The tags in use are
``@all``, ``@web``, ``@android``, ``@ios-phone``, ``@ios-tablet``, ``@tauri``,
and ``@native``; the feature files are the only list, since nothing validates
the set. Today the Playwright config defines a single ``chromium`` project and
no runner filters on tags, so the tags document intent rather than select a
device.

Step definitions
~~~~~~~~~~~~~~~~

Steps live in per-screen files under ``tests/steps/`` and use Playwright's
``page`` fixture directly. There is no driver abstraction layer.

.. code:: ts

   // tests/steps/monitors.steps.ts
   import { createBdd } from 'playwright-bdd';
   import { expect } from '@playwright/test';
   import { testConfig } from '../helpers/config';

   const { When, Then } = createBdd();

   Then('I should see at least {int} monitor cards', async ({ page }, count: number) => {
     const monitorCards = page.getByTestId('monitor-card');
     if (count > 0) {
       await expect(monitorCards.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
     }
     const actualCount = await monitorCards.count();
     expect(actualCount).toBeGreaterThanOrEqual(count);
   });

``await expect(locator).toBeVisible()`` retries until the timeout expires. That
is why new steps never call ``waitForTimeout``: a fixed sleep either wastes time
or races the app. The testing playbook (``agents/project/testing.md``) bans it
outright. Calls that predate the rule still sit in several step files, so
copying a neighbouring step is not a safe way to learn the convention.

Selectors come from ``data-testid``, never from visible text. Text is
translated into seven languages, so ``getByText('Delete')`` fails the moment the
locale changes, and it is not unique. Every interactive element gets one:

.. code:: tsx

   <Button onClick={handleDelete} data-testid="delete-monitor-button">
     {t('common.delete')}
   </Button>

Capability guards
^^^^^^^^^^^^^^^^^

Gate on capability, never on the UI under test. Some features exist only when
the server or device supports them: PTZ controls render only for a controllable
monitor. The tempting guard is to check whether the panel is on screen and skip
if not. That guard is self-defeating: if the panel regresses and stops
rendering, the guard goes false and every assertion below it silently no-ops,
so the test passes when the feature breaks.

The testing playbook requires the capability to come from an independent
source, API or fixture data. ``tests/steps/ptz.steps.ts`` asks ZoneMinder:

.. code:: ts

   import { isMonitorControllable } from '../helpers/zm-api';

   let hasPTZ = false;

   Given('the current monitor supports PTZ', async ({ page }) => {
     const urlMatch = page.url().match(/monitors\/(\d+)/);
     if (!urlMatch) {
       throw new Error('E2E: PTZ scenario ran without a monitor id in the URL');
     }
     hasPTZ = await isMonitorControllable(urlMatch[1]);
   });

   Then('I should see directional arrows', async ({ page }) => {
     if (!hasPTZ) return;               // monitor genuinely has no PTZ
     const arrows = page.locator('[data-testid*="ptz"]');
     await expect(arrows.first()).toBeVisible();   // capability present: hard assert
   });

``isMonitorControllable`` in ``tests/helpers/zm-api.ts`` reads the monitor's
``Controllable`` field straight from ``/api/monitors/<id>.json``. When it
returns true the ``Then`` step asserts without escape hatches. The arrows it
looks for are the ``ptz-up``, ``ptz-down``, ``ptz-left`` and ``ptz-right``
buttons that ``components/monitors/PTZControls.tsx`` renders.

A ``Then`` step may still skip when an earlier step legitimately did nothing,
for example a server with zero events. The skip condition must be data
(``eventCount === 0``), never a swallowed locator failure.

Running E2E tests
-----------------

.. list-table::
   :header-rows: 1

   * - Command
     - What it does
   * - ``npm run test:e2e``
     - Web E2E in Chromium. The only e2e suite CI runs, and only when the
       ``ZM_HOST_1``/``ZM_USER_1``/``ZM_PASSWORD_1`` secrets are configured.
   * - ``npm run test:e2e -- monitors.feature``
     - One feature file
   * - ``npm run test:e2e -- --headed``
     - Same, with a visible browser
   * - ``npm run test:e2e -- --debug``
     - Playwright Inspector: pause and step
   * - ``npm run test:e2e:ui``
     - Playwright's interactive UI mode

``app/playwright.config.ts`` starts two servers before the suite and waits for
both: the CORS proxy on port 3001 and Vite on 5173. Web login fails without the
proxy, and waiting only on Vite let tests start before the proxy was up. Test
timeout is 30 seconds; retries are 2 in CI and 1 locally.

Server credentials come from ``app/.env``:

.. code:: bash

   ZM_HOST_1=http://your-server:port
   ZM_USER_1=admin
   ZM_PASSWORD_1=password

Device tests
------------

Device tests are manual-invoke-only. Only the web suite runs in the automated
CI workflow.

.. list-table::
   :header-rows: 1

   * - Profile
     - Device
     - Driver
     - Runs
   * - ``web-chromium``
     - Desktop browser
     - Playwright
     - the Gherkin feature files
   * - ``android-phone``
     - Pixel 7 emulator
     - WebDriverIO + Appium (UiAutomator2, ``autoWebview``)
     - ``tests/device-screenshots/specs/``
   * - ``ios-phone``
     - iPhone 15 simulator
     - WebDriverIO + Appium (XCUITest)
     - ``tests/device-screenshots/specs/``
   * - ``ios-tablet``
     - iPad Air 11-inch (M2) simulator
     - WebDriverIO + Appium (XCUITest)
     - ``tests/device-screenshots/specs/``

The Gherkin suite is web-only today. The three device profiles run a separate
WebDriverIO harness (``app/wdio.config.device-screenshots.ts``) that installs
the built app, switches into its WebView, walks the screens, and captures
screenshots into ``tests/screenshots/devices/``. Android goes through Appium's
UiAutomator2 driver on port 4724; iOS through XCUITest on port 4723.

.. code:: bash

   npm run test:e2e:android      # sync + run the Android device harness
   npm run test:e2e:ios-phone    # sync + run on the iPhone simulator
   npm run test:e2e:ios-tablet   # sync + run on the iPad simulator
   npm run test:e2e:all-platforms  # web, Android, iOS phone, iOS tablet, in order

Each of those scripts runs ``npm run android:sync`` or ``npm run ios:sync``
first, which builds the web bundle and copies it into the native project. To
capture screenshots against an already-synced app, skip the sync:

.. code:: bash

   npm run test:screenshots:android
   npm run test:screenshots:ios-phone
   npm run test:screenshots:ios-tablet

Visual baselines
~~~~~~~~~~~~~~~~

There are none. Nothing in this repo diffs a screenshot against a baseline: the
device harness captures PNGs and stops there, and no step, helper, or npm
script performs a pixel comparison. The one layout assertion that does run is
``Then no element should overflow the viewport horizontally`` in
``tests/steps/platform.steps.ts``, which walks the DOM for elements extending
past ``window.innerWidth`` outside a scroll container. Screenshots are for a
human to look at.

Device setup
------------

Prerequisites
~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1

   * - Tool
     - Version
     - Used for
   * - Xcode
     - 15+
     - iOS simulators and ``xcrun simctl``
   * - Android Studio
     - Latest
     - AVD manager and Android SDK
   * - Node.js
     - 20+
     - all npm scripts
   * - Appium
     - 2.x
     - drives all three device profiles

Android
~~~~~~~

1. Android Studio, Virtual Device Manager, Create Device.
2. Hardware profile: **Pixel 7**.
3. System image: **API 34**, **arm64-v8a**, ``google_apis`` (required on Apple
   Silicon).
4. Name the AVD ``Pixel_7_API_34``, the default in
   ``tests/platforms.config.defaults.ts``.
5. Check ``adb`` is on your PATH:

.. code:: bash

   adb version
   # if not found, add $ANDROID_HOME/platform-tools to your shell PATH

iOS
~~~

1. Xcode, Settings, Platforms, **+**, install the **iOS 17** simulator runtime.
2. Confirm both simulators exist:

.. code:: bash

   xcrun simctl list devices | grep -E "iPhone 15|iPad Air"

You need **iPhone 15** and **iPad Air 11-inch (M2)**. Add missing ones through
Xcode, Window, Devices and Simulators.

Appium
~~~~~~

.. code:: bash

   npm install -g appium
   appium driver install xcuitest
   appium driver install uiautomator2

   appium --version        # 2.x
   appium driver list      # xcuitest and uiautomator2

Verify everything
~~~~~~~~~~~~~~~~~

.. code:: bash

   cd app
   npm run test:platform:setup

``scripts/verify-platform-setup.ts`` runs twelve checks: Xcode, the iOS
runtime, both simulators, the Android SDK, the AVD, ``adb``, Appium, both
drivers, port 4723, and whether you have a local config override. Each failure
prints its own fix.

Platform config
~~~~~~~~~~~~~~~

``tests/platforms.config.defaults.ts`` holds:

- Android AVD ``Pixel_7_API_34``, API level 34, app id
  ``com.zoneminder.zmNinjaNG``
- iOS phone ``iPhone 15``, runtime ``iOS-17-5``
- iOS tablet ``iPad Air 11-inch (M2)``, runtime ``iOS-17-5``
- Appium port ``4723``
- Timeouts: app launch ``30000`` ms, navigation ``10000`` ms, element ``5000``
  ms, WebView switch ``10000`` ms

To change any of them on your machine, copy the file and edit only the fields
you need. ``platforms.config.ts`` merges the local file over the defaults at
startup, and the local file is gitignored:

.. code:: bash

   cp tests/platforms.config.defaults.ts tests/platforms.config.local.ts

Finding the exact names your machine uses:

.. code:: bash

   xcrun simctl list devices     # iOS
   emulator -list-avds           # Android

Debugging tests
---------------

``screen.debug()`` pretty-prints the current jsdom document, which is the
fastest way to find out why a query matched nothing:

.. code:: tsx

   it('renders monitor', () => {
     render(<MonitorCard monitor={mockMonitor} status={mockStatus} onShowSettings={vi.fn()} />);
     screen.debug();
   });

For E2E, ``page.pause()`` in a step definition opens the Playwright Inspector at
that point:

.. code:: ts

   When('I click on monitor', async ({ page }) => {
     await page.pause();
     await page.getByTestId('monitor-card').first().click();
   });

Playwright is configured with ``trace: 'on'`` and ``screenshot: 'on'``, so every
run leaves a trace with a screenshot of each action. Open the HTML report after
a failure rather than re-running with more logging.

Troubleshooting
---------------

WebView context not found
~~~~~~~~~~~~~~~~~~~~~~~~~

The app had not finished loading when the harness tried to switch context.
Raise the timeout in ``platforms.config.local.ts``:

.. code:: typescript

   timeouts: {
     webviewSwitch: 20000,  // default is 10000
   }

Appium cannot find the device
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The simulator or AVD name in the config does not match what is installed:

.. code:: bash

   xcrun simctl list devices     # iOS
   emulator -list-avds           # Android

Put the exact name into ``platforms.config.local.ts``.

Port already in use
~~~~~~~~~~~~~~~~~~~

A previous run left a process holding the port:

.. code:: bash

   lsof -ti :4723 | xargs kill   # Appium, iOS
   lsof -ti :4724 | xargs kill   # Appium, Android

Emulator will not boot
~~~~~~~~~~~~~~~~~~~~~~

Check the AVD name matches exactly with ``emulator -list-avds``. If the image is
corrupted, delete and recreate it in Android Studio's Virtual Device Manager.

iOS build fails
~~~~~~~~~~~~~~~

.. code:: bash

   xcode-select --install
   sudo xcodebuild -license accept
   xcodebuild -showsdks | grep iphonesimulator
