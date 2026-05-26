import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

let capturedMonitorTestId: string | null = null;

When('I capture the first montage monitor id', async ({ page }) => {
  const tile = page.locator('[data-testid^="montage-monitor-"]').first();
  await expect(tile).toBeVisible({ timeout: testConfig.timeouts.transition });
  const id = await tile.getAttribute('data-testid');
  if (!id) throw new Error('First montage tile has no data-testid');
  capturedMonitorTestId = id;
});

When('I open the montage kebab menu', async ({ page }) => {
  await page.getByTestId('montage-kebab-menu').click();
});

When('I open the montage show-monitors submenu', async ({ page }) => {
  await page.getByTestId('montage-kebab-visibility').hover();
  // Wait for the submenu content to render
  await page.waitForTimeout(150);
});

When('I uncheck the visibility for the captured monitor', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  const monitorId = capturedMonitorTestId.replace('montage-monitor-', '');
  const cb = page.getByTestId(`montage-visibility-${monitorId}`);
  await expect(cb).toHaveAttribute('data-state', 'checked');
  await cb.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I check the visibility for the captured monitor', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  const monitorId = capturedMonitorTestId.replace('montage-monitor-', '');
  const cb = page.getByTestId(`montage-visibility-${monitorId}`);
  await expect(cb).toHaveAttribute('data-state', 'unchecked');
  await cb.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I reload the current page', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
});

Then('the captured monitor tile should not be present in the montage grid', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  await expect(page.getByTestId(capturedMonitorTestId)).toHaveCount(0);
});

Then('the captured monitor tile should be present in the montage grid', async ({ page }) => {
  if (!capturedMonitorTestId) throw new Error('No monitor captured');
  await expect(page.getByTestId(capturedMonitorTestId)).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});
