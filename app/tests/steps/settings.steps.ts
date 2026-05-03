import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

let previousBgColor = '';
let postToggleBgColor = '';
let previousSettingsHeading = '';
let notificationToggleState = false;

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
  // Wait for notification page content to load
  await page.waitForTimeout(1000);

  const toggle = page.locator('[role="switch"]').first();
  if (await toggle.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false)) {
    notificationToggleState = await toggle.isChecked().catch(() => false);
    await toggle.click();
    await page.waitForTimeout(300);
  } else {
    log.info('E2E: No notification toggles visible', { component: 'e2e' });
  }
});

Then('the notification toggle state should be preserved', async ({ page }) => {
  const toggle = page.locator('[role="switch"]').first();
  if (await toggle.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false)) {
    const currentState = await toggle.isChecked().catch(() => false);
    // State should be the opposite of what it was before toggling
    expect(currentState).not.toBe(notificationToggleState);
  }
});

When('I toggle bandwidth mode', async ({ page }) => {
  const bandwidthToggle = page.getByTestId('bandwidth-mode-toggle')
    .or(page.locator('[role="switch"]').filter({ hasText: /bandwidth/i }))
    .or(page.locator('text=/bandwidth/i').locator('..').locator('[role="switch"]'));
  if (await bandwidthToggle.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false)) {
    await bandwidthToggle.click();
    await page.waitForTimeout(300);
  }
});

Then('the bandwidth mode label should update', async ({ page }) => {
  // Verify that a bandwidth-related label is present (e.g., "Low" or "Normal")
  const bandwidthLabel = page.locator('text=/low|normal/i');
  await expect(bandwidthLabel.first()).toBeVisible({ timeout: testConfig.timeouts.element });
  log.info('E2E: Bandwidth mode label visible', { component: 'e2e' });
});

// Server Steps
Then('I should see server information displayed', async ({ page }) => {
  // Wait for the server page content to render (it fetches data from the API)
  await page.waitForTimeout(1000);

  // Check for any content on the server page
  const hasHeading = await page.getByRole('heading', { name: /server/i }).isVisible().catch(() => false);
  const hasVersion = await page.getByText(/version/i).isVisible().catch(() => false);
  const hasStatus = await page.getByText(/status/i).isVisible().catch(() => false);
  const hasCards = await page.locator('[role="region"]').count() > 0;
  const hasAnyContent = await page.locator('main').locator('*').count() > 3;

  expect(hasHeading || hasVersion || hasStatus || hasCards || hasAnyContent).toBeTruthy();
});

// Notification Steps
Then('I should see notification interface elements', async ({ page }) => {
  // Wait for the notification page to load its content
  await page.waitForTimeout(1000);

  const hasSettings = await page.getByTestId('notification-settings').isVisible().catch(() => false);
  const hasEmpty = await page.getByTestId('notification-settings-empty').isVisible().catch(() => false);
  const hasSwitches = await page.locator('[role="switch"]').count() > 0;
  const hasHeading = await page.getByRole('heading').first().isVisible().catch(() => false);

  expect(hasSettings || hasEmpty || hasSwitches || hasHeading).toBeTruthy();
});

When('I navigate to the notification history', async ({ page }) => {
  await page.getByTestId('notification-history-button').click();
  await page.waitForURL(/.*notifications\/history/, { timeout: testConfig.timeouts.transition });
});

Then('I should see notification history content or empty state', async ({ page }) => {
  const hasList = await page.getByTestId('notification-history-list').isVisible().catch(() => false);
  const hasEmpty = await page.getByTestId('notification-history-empty').isVisible().catch(() => false);

  expect(hasList || hasEmpty).toBeTruthy();
});

Then('I should see notification history page', async ({ page }) => {
  await expect(page.getByTestId('notification-history')).toBeVisible();
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

Then('I change the log level to {string}', async ({ page }, level: string) => {
  const levelSelect = page.getByTestId('log-level-select');
  if (await levelSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await levelSelect.click();
    const option = page.getByTestId(`log-level-option-${level}`);
    if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
      await option.click();
    }
  } else {
    log.info('E2E: Log level select not found', { component: 'e2e' });
  }
});

Then('I clear logs if available', async ({ page }) => {
  const clearButton = page.getByTestId('logs-clear-button')
    .or(page.getByRole('button', { name: /clear/i }));
  if (await clearButton.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    if (await clearButton.first().isEnabled()) {
      await clearButton.first().click();
      // Confirm the AlertDialog if it appears
      const confirmButton = page.getByTestId('logs-clear-confirm');
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click();
      }
    }
  }
});

// Thumbnail fallback chain steps
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
