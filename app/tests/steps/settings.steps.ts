import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

let previousBgColor = '';
let postToggleBgColor = '';
let previousSettingsHeading = '';
let notificationToggleState = false;
let bandwidthModeBefore = false;

// Settings Steps
Then('I should see settings interface elements', async ({ page }) => {
  // Wait for the settings heading to appear first
  await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });

  const hasThemeControls = await page.getByText(/theme/i).isVisible().catch(() => false);
  const hasLanguageControls = await page.getByText(/language/i).isVisible().catch(() => false);
  const hasSwitches = await page.locator('[role="switch"]').count() > 0;

  expect(hasThemeControls || hasLanguageControls || hasSwitches).toBeTruthy();
});

Then('the Streaming Mode row explains which mode it recommends', async ({ page }) => {
  const reason = page.getByTestId('settings-view-mode-reason');
  await expect(reason).toBeVisible({ timeout: testConfig.timeouts.element });

  // The line names the mode this server should start in; the badge with the
  // matching testid sits beside that mode's label.
  const text = (await reason.textContent()) ?? '';
  const match = text.match(/^Recommended: (Streaming|Snapshot)\./);
  expect(match, `unexpected reason line: ${text}`).not.toBeNull();
  await expect(
    page.getByTestId(`settings-view-mode-recommended-${match![1].toLowerCase()}`)
  ).toBeVisible();
});

Then('I should see theme selector', async ({ page }) => {
  // Wait for settings page content to load
  await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
  const themeSelector = page.locator('text=/theme/i')
    .or(page.getByRole('combobox', { name: /theme/i }))
    .or(page.locator('[data-testid*="theme"]'));
  await expect(themeSelector.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

Then('I should see language selector', async ({ page }) => {
  const langSelector = page.locator('text=/language/i')
    .or(page.getByRole('combobox', { name: /language/i }))
    .or(page.locator('[data-testid*="language"]'));
  await expect(langSelector.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I toggle the theme', async ({ page }) => {
  // Capture the current background color before toggling
  previousBgColor = await page.evaluate(() => {
    return window.getComputedStyle(document.body).backgroundColor;
  });

  // Find and click the theme toggle/selector
  const themeToggle = page.getByTestId('theme-toggle')
    .or(page.getByRole('button', { name: /theme/i }))
    .or(page.locator('[data-testid*="theme"]').first());
  await themeToggle.click();
  await page.waitForTimeout(500);

  // If it's a dropdown/select, pick an option that differs from the current theme.
  // Try to find options and click one that is not already selected.
  const themeOptions = page.getByRole('option').or(page.locator('[data-testid*="theme-option"]'));
  const optionCount = await themeOptions.count().catch(() => 0);
  if (optionCount > 0) {
    // Try each option until we find one that changes the background
    for (let i = 0; i < optionCount; i++) {
      const option = themeOptions.nth(i);
      if (await option.isVisible({ timeout: 500 }).catch(() => false)) {
        const ariaSelected = await option.getAttribute('aria-selected').catch(() => null);
        // Skip the currently selected option
        if (ariaSelected === 'true') continue;
        await option.click();
        await page.waitForTimeout(300);
        break;
      }
    }
  }
});

Then('the app background color should change', async ({ page }) => {
  // Wait briefly for theme transition to complete
  await page.waitForTimeout(300);
  postToggleBgColor = await page.evaluate(() => {
    return window.getComputedStyle(document.body).backgroundColor;
  });
  log.info('E2E: Theme toggle result', { component: 'e2e', previousBgColor, postToggleBgColor });

  // Verify the theme changed: check background color or the class/attribute on <html>
  const themeChanged = postToggleBgColor !== previousBgColor;
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  const hasThemeClass = htmlClass.includes('dark') || htmlClass.includes('light');

  // At least one indicator of theme change must be present
  expect(themeChanged || hasThemeClass).toBeTruthy();
});

Then('the theme selection should persist', async ({ page }) => {
  // After navigating away and back, the theme should still match the post-toggle state
  const currentBgColor = await page.evaluate(() => {
    return window.getComputedStyle(document.body).backgroundColor;
  });
  log.info('E2E: Theme persistence check', { component: 'e2e', previousBgColor, postToggleBgColor, currentBgColor });
  // The background color should match what it was right after toggling (theme persisted)
  expect(currentBgColor).toBe(postToggleBgColor);
});

When('I change the language to a different option', async ({ page }) => {
  // Capture the current settings heading text before changing language
  const heading = page.getByRole('heading', { name: /settings/i });
  previousSettingsHeading = await heading.textContent().catch(() => '') ?? '';

  const langSelector = page.getByTestId('language-select')
    .or(page.getByRole('combobox', { name: /language/i }))
    .or(page.locator('[data-testid*="language"]').first());
  await langSelector.click();
  await page.waitForTimeout(300);

  // Select a non-English option if available
  const option = page.getByRole('option').nth(1)
    .or(page.locator('[data-testid*="language-option"]').nth(1));
  if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(500);
  }
});

Then('a visible menu item should change to the selected language', async ({ page }) => {
  // After a language change, visible UI text should be translated.
  // Verify the settings page heading text has changed from the pre-change value.
  if (previousSettingsHeading !== '') {
    const heading = page.getByRole('heading').first();
    const currentHeading = await heading.textContent().catch(() => '') ?? '';
    log.info('E2E: Language change heading check', { component: 'e2e', previousSettingsHeading, currentHeading });
    expect(currentHeading).not.toBe(previousSettingsHeading);
  } else {
    // If we couldn't capture a heading before, fall back to verifying the page loaded
    await expect(page.locator('body')).toBeVisible();
    log.info('E2E: Language change applied (no prior heading captured)', { component: 'e2e' });
  }
});

When('I toggle a notification setting', async ({ page }) => {
  // NotificationSettings renders either "notification-settings" or its
  // "-empty" variant once the profile/settings are ready (src/pages/
  // NotificationSettings.tsx:297-312). Wait for that real "page settled"
  // signal before looking for a switch, instead of a blind sleep that could
  // race the initial render on a slow run.
  const container = page.getByTestId('notification-settings');
  const empty = page.getByTestId('notification-settings-empty');
  await expect(container.or(empty).first()).toBeVisible({ timeout: testConfig.timeouts.transition });

  // The scenario is "toggle persists across navigation", so a missing toggle
  // is a failure of the thing under test, not a reason to skip. Assert it
  // rather than logging past it.
  const toggle = container.locator('[role="switch"]').first();
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.element });
  notificationToggleState = await toggle.isChecked();
  await toggle.click();
  // Wait for the flip itself instead of a fixed sleep.
  await expect
    .poll(() => toggle.isChecked(), { timeout: testConfig.timeouts.element })
    .toBe(!notificationToggleState);
});

Then('the notification toggle state should be preserved', async ({ page }) => {
  const toggle = page.locator('[role="switch"]').first();
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.element });

  // "I navigate to the ... page" only waits for the URL to change
  // (common.steps.ts), not for the destination route to render. Notifications
  // is a React.lazy route (src/App.tsx) behind a Suspense boundary, and its
  // toggle state is read from the notification store at render time
  // (src/pages/NotificationSettings.tsx:61,366), so the first paint after
  // navigating back can lag the URL update by a tick and briefly show a
  // stale/default value before settling on the real persisted state. Poll for
  // that real state instead of taking a single reading, so the assertion
  // reflects what actually persisted rather than a race with initial render.
  await expect.poll(() => toggle.isChecked().catch(() => false), {
    timeout: testConfig.timeouts.element,
  }).toBe(!notificationToggleState);
});

When('I toggle bandwidth mode', async ({ page }) => {
  // The old locator chained three guesses, none of which was the real testid
  // (`settings-bandwidth-mode-switch`), behind an isVisible probe, so the
  // toggle was never clicked and the scenario passed anyway.
  const bandwidthToggle = page.getByTestId('settings-bandwidth-mode-switch');
  await expect(bandwidthToggle).toBeVisible({ timeout: testConfig.timeouts.element });
  bandwidthModeBefore = await bandwidthToggle.isChecked();
  await bandwidthToggle.click();
});

Then('the bandwidth mode label should update', async ({ page }) => {
  // Bandwidth mode drives every polling interval (Polling contract), so the
  // switch actually changing state is the thing under test. The old assertion
  // looked for the words "low" or "normal", which label both ends of the
  // control and are on screen before and after any click.
  const bandwidthToggle = page.getByTestId('settings-bandwidth-mode-switch');
  await expect
    .poll(() => bandwidthToggle.isChecked(), { timeout: testConfig.timeouts.element })
    .toBe(!bandwidthModeBefore);
  const bandwidthLabel = page.locator('text=/low|normal/i');
  await expect(bandwidthLabel.first()).toBeVisible({ timeout: testConfig.timeouts.element });
  log.info('E2E: Bandwidth mode label visible', { component: 'e2e' });
});

// Server Steps
Then('I should see server information displayed', async ({ page }) => {
  // The previous version of this step passed whenever <main> had more than
  // three descendants, so it could not tell a loaded page from an error state.
  // Assert fetched values instead. Only the unconditional cards are checked:
  // the server list and storage cards render solely when ZM returns rows, and
  // a single-server install commonly returns none.
  const main = page.locator('main');

  // The version card carries a real version from the API rather than the
  // common.unknown placeholder it falls back to when the request fails. Only
  // the ZM version is asserted: timezone, load average and disk usage are all
  // legitimately absent on some installs, and server run state changes between
  // runs, so none of them are invariants a test can hold.
  await expect.poll(
    async () => (await main.textContent()) ?? '',
    { timeout: testConfig.timeouts.transition },
  ).toMatch(/ZoneMinder Version\s*\d+\.\d+/);

  // The state control is present and enabled once states have loaded.
  await expect(page.getByTestId('server-state-select')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
  await expect(page.getByTestId('server-refresh-button')).toBeEnabled();
});

// Notification Steps
Then('I should see notification interface elements', async ({ page }) => {
  // Poll for the notification page's content instead of a fixed sleep.
  await expect.poll(async () => {
    const hasSettings = await page.getByTestId('notification-settings').isVisible().catch(() => false);
    const hasEmpty = await page.getByTestId('notification-settings-empty').isVisible().catch(() => false);
    const hasSwitches = await page.locator('[role="switch"]').count() > 0;
    const hasHeading = await page.getByRole('heading').first().isVisible().catch(() => false);
    return hasSettings || hasEmpty || hasSwitches || hasHeading;
  }, { timeout: testConfig.timeouts.transition }).toBeTruthy();
});

// Logs Steps
Then('I should see log entries or empty state', async ({ page }) => {
  // Wait for the logs page to load
  await page.waitForTimeout(500);

  const logEntries = page.getByTestId('log-entry');
  const emptyState = page.getByTestId('logs-empty-state');

  // Check for any log content at all (the page may show ZM logs or app logs)
  await expect.poll(async () => {
    const count = await logEntries.count();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    // Also check for any table rows or list items
    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasContent = await page.locator('main').locator('h1, h2, table, [role="table"]').count() > 0;
    return count > 0 || emptyVisible || hasTable || hasContent;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

Then('I should see log control elements', async ({ page }) => {
  // Look for any filter/control elements on the logs page
  const hasLevelFilter = await page.getByRole('combobox').isVisible().catch(() => false);
  const hasComponentFilter = await page.getByTestId('log-component-filter-trigger').isVisible().catch(() => false);
  const hasClearButton = await page.getByRole('button', { name: /clear/i }).isVisible().catch(() => false);
  const hasSaveButton = await page.getByRole('button', { name: /save|download|share/i }).isVisible().catch(() => false);
  const hasAnyButton = await page.locator('main').locator('button').count() > 0;

  expect(hasLevelFilter || hasComponentFilter || hasClearButton || hasSaveButton || hasAnyButton).toBeTruthy();
});

When('I change the log level to {string}', async ({ page }, level: string) => {
  // The level select always renders on the logs page (Logs.tsx:405). Skipping
  // the change when it was not found meant a regression that stopped it
  // rendering read as "nothing to do here".
  const levelSelect = page.getByTestId('log-level-select');
  await expect(levelSelect).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await levelSelect.click();
  await page.getByTestId(`log-level-option-${level}`).click();
  await expect(levelSelect).toContainText(level);
});

When('I clear logs if available', async ({ page }) => {
  // The clear button is present whenever the app-log source is selected and is
  // disabled only when there is nothing to clear (Logs.tsx:499-507), so both
  // branches have something to assert: cleared, or empty to begin with.
  const clearButton = page.getByTestId('logs-clear-button');
  await expect(clearButton).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  if (!(await clearButton.isEnabled())) {
    await expect(page.getByTestId('log-entry')).toHaveCount(0);
    return;
  }

  await clearButton.click();
  await page.getByTestId('logs-clear-confirm').click();
  await expect
    .poll(() => page.getByTestId('log-entry').count(), {
      timeout: testConfig.timeouts.element,
    })
    .toBe(0);
});

// Thumbnail fallback chain steps
When('I expand the Advanced settings section', async ({ page }) => {
  const trigger = page.getByTestId('settings-section-advanced-toggle');
  await expect(trigger).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(page.getByTestId('settings-force-disable-multiport-switch')).toBeVisible();
});

When('I enable the force-disable multiport toggle', async ({ page }) => {
  const toggle = page.getByTestId('settings-force-disable-multiport-switch');
  if (!(await toggle.isChecked().catch(() => false))) {
    await toggle.click();
  }
  await expect(toggle).toBeChecked();
});

Then('the force-disable multiport toggle should be enabled', async ({ page }) => {
  await expect(page.getByTestId('settings-force-disable-multiport-switch')).toBeChecked();
});

// Log redaction: turning it off puts credentials in the log file, so the row
// warns while it is on. The scenario turns it back off, leaving the profile as
// it found it.
When('I enable the log redaction toggle', async ({ page }) => {
  const toggle = page.getByTestId('settings-log-redaction-switch');
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  if (!(await toggle.isChecked().catch(() => false))) {
    await toggle.click();
  }
  await expect(toggle).toBeChecked();
});

When('I disable the log redaction toggle', async ({ page }) => {
  const toggle = page.getByTestId('settings-log-redaction-switch');
  if (await toggle.isChecked().catch(() => false)) {
    await toggle.click();
  }
  await expect(toggle).not.toBeChecked();
});

Then('I should see the log redaction warning', async ({ page }) => {
  const warning = page.getByTestId('settings-log-redaction-warning');
  await expect(warning).toBeVisible({ timeout: testConfig.timeouts.element });
  await expect(warning).not.toBeEmpty();
});

Then('the log redaction warning should be gone', async ({ page }) => {
  await expect(page.getByTestId('settings-log-redaction-warning')).toHaveCount(0);
});

// WebRTC STUN toggle (visible only when go2rtc/auto streaming is on, the default)
When('I enable the WebRTC STUN toggle', async ({ page }) => {
  const toggle = page.getByTestId('settings-webrtc-use-stun-switch');
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  if (!(await toggle.isChecked().catch(() => false))) {
    await toggle.click();
  }
  await expect(toggle).toBeChecked();
});

Then('the WebRTC STUN toggle should be enabled', async ({ page }) => {
  await expect(page.getByTestId('settings-webrtc-use-stun-switch')).toBeChecked();
});

When('I expand the thumbnail fallback chain editor', async ({ page }) => {
  const trigger = page.getByTestId('settings-thumbnail-chain-trigger');
  await trigger.waitFor({ state: 'visible' });
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
});

Then('I should see the thumbnail fallback chain editor', async ({ page }) => {
  await expect(page.getByTestId('settings-thumbnail-chain')).toBeVisible();
});

When('I move the {string} thumbnail fallback entry up', async ({ page }, type: string) => {
  await page.getByTestId(`settings-thumbnail-chain-${type}-up`).click();
});

When('I disable the {string} thumbnail fallback entry', async ({ page }, type: string) => {
  const toggle = page.getByTestId(`settings-thumbnail-chain-${type}-toggle`);
  if ((await toggle.getAttribute('data-state')) === 'checked') {
    await toggle.click();
  }
});

Then('the {string} thumbnail fallback entry should be above the {string} entry', async ({ page }, above: string, below: string) => {
  const chain = page.getByTestId('settings-thumbnail-chain');
  await expect(chain).toBeVisible();
  await chain.getByTestId(`settings-thumbnail-chain-row-${above}`).waitFor({ state: 'visible' });
  const rows = await chain.locator('[data-testid^="settings-thumbnail-chain-row-"]').all();
  const types: string[] = [];
  for (const row of rows) {
    const testId = await row.getAttribute('data-testid');
    if (testId) types.push(testId.replace('settings-thumbnail-chain-row-', ''));
  }
  const aboveIdx = types.indexOf(above);
  const belowIdx = types.indexOf(below);
  expect(aboveIdx).toBeGreaterThanOrEqual(0);
  expect(belowIdx).toBeGreaterThan(aboveIdx);
});

Then('the {string} thumbnail fallback entry should be disabled', async ({ page }, type: string) => {
  const toggle = page.getByTestId(`settings-thumbnail-chain-${type}-toggle`);
  await expect(toggle).toHaveAttribute('data-state', 'unchecked');
});

// Section collapse. The assertion is outcome-based: a collapsed section
// unmounts its rows, so the section element holds nothing but its own header
// button, and the remembered state survives leaving and re-entering the page.
When('I collapse the {string} settings section', async ({ page }, id: string) => {
  const trigger = page.getByTestId(`settings-section-${id}-toggle`);
  await expect(trigger).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
});

When('I expand the {string} settings section', async ({ page }, id: string) => {
  const trigger = page.getByTestId(`settings-section-${id}-toggle`);
  await expect(trigger).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
});

Then('the {string} settings section should be collapsed', async ({ page }, id: string) => {
  const section = page.getByTestId(`settings-section-${id}`);
  await expect(section.getByTestId(`settings-section-${id}-toggle`)).toHaveAttribute('aria-expanded', 'false');
  await expect(section.locator('.rounded-lg.border.bg-card')).toHaveCount(0);
});

Then('the {string} settings section should be expanded', async ({ page }, id: string) => {
  const section = page.getByTestId(`settings-section-${id}`);
  await expect(section.getByTestId(`settings-section-${id}-toggle`)).toHaveAttribute('aria-expanded', 'true');
  await expect(section.locator('.rounded-lg.border.bg-card').first()).toBeVisible();
});

// Start screen: the picker writes a profile setting, and the index redirect
// reads it on the next cold start, so the outcome is the route the app lands
// on rather than anything visible in Settings.
When('I set the start screen to {string}', async ({ page }, screen: string) => {
  await page.getByTestId('settings-start-screen-select').click();
  await page.getByTestId(`settings-start-screen-option-${screen.toLowerCase()}`).click();
  await expect(page.getByTestId('settings-start-screen-select')).toContainText(new RegExp(screen, 'i'));
});

When('I restart the app', async ({ page }) => {
  // The index route, not a reload of the current page: that is where the
  // start-screen redirect happens.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

Then('the app should open on the {string} page', async ({ page }, route: string) => {
  await expect(page).toHaveURL(new RegExp(`.*${route}`), { timeout: testConfig.timeouts.transition });
});
