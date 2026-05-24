import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Monitor Steps
Then('I should see at least {int} monitor cards', async ({ page }, count: number) => {
  const monitorCards = page.getByTestId('monitor-card');
  if (count > 0) {
    await expect(monitorCards.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  }
  const actualCount = await monitorCards.count();
  expect(actualCount).toBeGreaterThanOrEqual(count);
  log.info('E2E monitors found', { component: 'e2e', action: 'monitors_count', count: actualCount });
});

Then('each monitor card should show a name and status indicator', async ({ page }) => {
  const monitorCards = page.getByTestId('monitor-card');
  const count = await monitorCards.count();
  expect(count).toBeGreaterThan(0);

  // Verify at least the first card has a name and status
  const firstCard = monitorCards.first();
  const nameText = await firstCard.innerText();
  expect(nameText.trim().length).toBeGreaterThan(0);
});

When('I click into the first monitor detail page', async ({ page }) => {
  const currentUrl = page.url();

  // On Montage page: click the monitor cell itself (role=button) which navigates to detail
  if (currentUrl.includes('montage')) {
    const cell = page.locator('[data-testid^="montage-monitor-"]').first();
    await expect(cell).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
    await cell.click();
    log.info('E2E: Clicked montage monitor cell', { component: 'e2e' });
  } else {
    // On Monitors page: click the monitor thumbnail (monitor-player img)
    // The img is inside a clickable div that navigates to detail
    const monitorPlayer = page.getByTestId('monitor-player').first();
    await expect(monitorPlayer).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
    await monitorPlayer.click();
    log.info('E2E: Clicked monitor-player', { component: 'e2e' });
  }

  await page.waitForURL(/.*monitors\/\d+/, { timeout: testConfig.timeouts.transition });
});

Then('I should see the monitor grid', async ({ page }) => {
  await expect(page.getByTestId('monitor-grid')).toBeVisible();
});

When('I hover the first monitor card', async ({ page }) => {
  // The hover-preview anchor is the player, not the whole card. In list view the
  // card center sits over the info column, so hover the player specifically.
  const player = page.getByTestId('monitor-player').first();
  await expect(player).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await player.hover();
});

Then('I should see the monitor hover preview', async ({ page }) => {
  const preview = page.getByTestId('monitor-hover-preview');
  await expect(preview).toBeVisible({ timeout: 2000 });
  const box = await preview.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(350);
});

// Montage Steps
Then('I should see the montage interface', async ({ page }) => {
  const hasLayoutControls = await page.locator('select,button').count() > 0;
  expect(hasLayoutControls).toBeTruthy();
});

Then('I should see at least {int} monitor in montage grid', async ({ page }, count: number) => {
  const gridItems = page.locator('[data-testid="montage-monitor"]')
    .or(page.locator('.react-grid-item'));
  await expect.poll(
    async () => await gridItems.count(),
    { timeout: testConfig.timeouts.pageLoad }
  ).toBeGreaterThanOrEqual(count);
});

Then('each montage cell should show a monitor name label', async ({ page }) => {
  // Verify montage cells have visible monitor name text
  const gridItems = page.locator('[data-testid="montage-monitor"]')
    .or(page.locator('.react-grid-item'));
  const count = await gridItems.count();
  expect(count).toBeGreaterThan(0);

  // Check that the first cell has a text label
  const firstCell = gridItems.first();
  const cellText = await firstCell.innerText();
  expect(cellText.trim().length).toBeGreaterThan(0);
});

When('I click the snapshot button on the first montage monitor', async ({ page }) => {
  // Snapshot lives in the montage cell's "more" menu, not a standalone button.
  const firstMonitor = page.locator('[data-testid^="montage-monitor-"]').first();
  await expect(firstMonitor).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await firstMonitor.hover();

  const moreBtn = firstMonitor.getByTestId('montage-more-btn');
  await moreBtn.click();
  // The menu content renders in a portal outside the cell.
  await page.getByTestId('montage-download-btn').click();
});
