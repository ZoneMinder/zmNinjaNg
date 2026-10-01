import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

// Event filter presets (refs #544). The panel is open when these run.

When('I save the event filter as preset {string}', async ({ page }, name: string) => {
  await page.getByTestId('events-filter-preset-save').click();
  const input = page.getByTestId('events-filter-preset-name');
  await input.fill(name);
  await page.getByTestId('events-filter-preset-save-confirm').click();
  await expect(input).toBeHidden({ timeout: testConfig.timeouts.transition });
});

When('I load the event filter preset {string}', async ({ page }, name: string) => {
  await page.getByTestId('events-filter-preset-load').click();
  await page.getByTestId(`events-filter-preset-item-${name}`).click();
});

When('I delete the loaded event filter preset', async ({ page }) => {
  await page.getByTestId('events-filter-preset-delete').click();
  await page.getByTestId('events-filter-preset-delete-confirm').click();
});

Then('the event filter preset delete button should be visible', async ({ page }) => {
  await expect(page.getByTestId('events-filter-preset-delete')).toBeVisible({ timeout: testConfig.timeouts.transition });
});

Then('the event filter preset delete button should be gone', async ({ page }) => {
  await expect(page.getByTestId('events-filter-preset-delete')).toBeHidden({ timeout: testConfig.timeouts.transition });
});

Then('the favorites only filter should be on', async ({ page }) => {
  await expect(page.getByTestId('events-favorites-toggle')).toHaveAttribute('aria-checked', 'true');
});

Then('the favorites only filter should be off', async ({ page }) => {
  await expect(page.getByTestId('events-favorites-toggle')).toHaveAttribute('aria-checked', 'false');
});

Then('the events start date field should be empty', async ({ page }) => {
  await expect(page.getByTestId('events-start-date')).toHaveValue('');
});

// The field reports seconds (step="1"), so the minute the step typed may come
// back with ":00" on the end.
Then('the events start date field should show {string}', async ({ page }, value: string) => {
  await expect(page.getByTestId('events-start-date')).toHaveValue(new RegExp(`^${value}(:00)?$`));
});

Then('the loaded event filter preset should be named {string}', async ({ page }, name: string) => {
  await expect(page.getByTestId('events-filter-preset-active')).toHaveText(name);
});
