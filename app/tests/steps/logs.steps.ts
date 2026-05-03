import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

When('I trigger a sample log entry via the {string} component', async ({ page }, componentName: string) => {
  await page.evaluate((name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (typeof w.__zmng_test_log === 'function') {
      w.__zmng_test_log(name);
    } else {
      // Fallback: a no-op so the test does not crash if the dev hook isn't installed.
      // The next step will gate on visible entries; if none are present the test surfaces the issue.
    }
  }, componentName);
});

When('I tap the Clear button', async ({ page }) => {
  const btn = page.getByTestId('logs-clear-button');
  await expect(btn).toBeVisible({ timeout: testConfig.timeouts.element });
  await btn.click();
});

Then('a Clear confirmation dialog should appear', async ({ page }) => {
  const cancel = page.getByTestId('logs-clear-cancel');
  await expect(cancel).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I confirm Clear', async ({ page }) => {
  const confirm = page.getByTestId('logs-clear-confirm');
  await expect(confirm).toBeVisible({ timeout: testConfig.timeouts.element });
  await confirm.click();
});

Then('the Logs page should show no entries', async ({ page }) => {
  const empty = page.getByTestId('logs-empty-state');
  const list = page.getByTestId('logs-list');
  const emptyVisible = await empty.isVisible({ timeout: 1000 }).catch(() => false);
  if (emptyVisible) return;
  const count = await list.locator('[data-testid="log-entry"]').count();
  expect(count).toBe(0);
});

Then('the Logs page should show at least one entry', async ({ page }) => {
  const list = page.getByTestId('logs-list');
  await expect(list.locator('[data-testid="log-entry"]').first()).toBeVisible({ timeout: testConfig.timeouts.element });
});
