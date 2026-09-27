import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// Count of delete buttons captured just before a single delete, so the
// follow-up assertion can check it went down by exactly one.
let countBeforeDelete = 0;

Given('I am on the developer notices page', async ({ page }) => {
  // The next step waits for the list; here we only need the navigation to land.
  await page.goto('/#/developer-notice', { waitUntil: 'domcontentloaded' });
});

Given('the notice list has at least one notice', async ({ page }) => {
  const list = page.getByTestId('developer-notice-list');
  await expect(list).toBeVisible();
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  await expect(deletes.first()).toBeVisible();
});

When('I delete the first notice', async ({ page }) => {
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  countBeforeDelete = await deletes.count();
  await deletes.first().click();
});

Then('the notice count should decrease by one', async ({ page }) => {
  const deletes = page.locator('[data-testid^="developer-notice-delete-"]');
  await expect(deletes).toHaveCount(countBeforeDelete - 1);
});

When('I clear all notices', async ({ page }) => {
  await page.getByTestId('developer-notice-actions-menu').click();
  await page.getByTestId('developer-notice-clear-all').click();
  await page.getByTestId('developer-notice-clear-all-confirm').click();
});

Then('the notice list should be empty', async ({ page }) => {
  await expect(page.getByTestId('developer-notice-list')).toHaveCount(0);
});

When('I restore deleted notices', async ({ page }) => {
  const emptyRestore = page.getByTestId('developer-notice-restore-deleted-empty');
  if (await emptyRestore.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emptyRestore.click();
    return;
  }
  await page.getByTestId('developer-notice-actions-menu').click();
  await page.getByTestId('developer-notice-restore-deleted').click();
});

Then('the notice list should not be empty', async ({ page }) => {
  await expect(page.getByTestId('developer-notice-list')).toBeVisible();
  await expect(page.locator('[data-testid^="developer-notice-delete-"]').first()).toBeVisible();
});

// --- Show Developer Notices toggle ---

// Set the Radix switch to the desired state only if it is not already there,
// so "turn off" then "turn on" are idempotent regardless of the starting value.
async function setNoticeToggle(page: import('@playwright/test').Page, on: boolean) {
  const sw = page.getByTestId('settings-show-developer-notices');
  await expect(sw).toBeVisible();
  const checked = (await sw.getAttribute('aria-checked')) === 'true';
  if (checked !== on) await sw.click();
}

// Note: "I expand the {string} settings section" is defined in settings.steps.ts
// and reused here.

When('I turn off developer notices in settings', async ({ page }) => {
  await setNoticeToggle(page, false);
});

When('I turn on developer notices in settings', async ({ page }) => {
  await setNoticeToggle(page, true);
});

Then('the developer notices sidebar entry should be hidden', async ({ page }) => {
  await expect(page.getByTestId('nav-item-developer-notice')).toHaveCount(0);
});

Then('the developer notices sidebar entry should be visible', async ({ page }) => {
  await expect(page.getByTestId('nav-item-developer-notice').first()).toBeVisible();
});
