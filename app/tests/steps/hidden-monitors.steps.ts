import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Name of the monitor captured from the Monitors page, used across steps so the
// scenario can hide that exact monitor and then assert it disappears/reappears.
let notedMonitorName = '';

When('I note the name of the first monitor', async ({ page }) => {
  const firstName = page.getByTestId('monitor-name').first();
  await expect(firstName).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  notedMonitorName = (await firstName.innerText()).trim();
  expect(notedMonitorName.length).toBeGreaterThan(0);
  log.info('E2E noted monitor name', { component: 'e2e', notedMonitorName });
});

Then('I should see the hidden monitors list', async ({ page }) => {
  const list = page.getByTestId('hidden-monitors-list');
  await expect(list).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

// Toggle the Switch in the row whose monitor name matches the noted name.
// The Switch's aria-label is set to the monitor name (see HiddenMonitorsSection),
// so we scope the search by name rather than relying on a known monitor id.
async function setNotedMonitorHidden(page: import('@playwright/test').Page, hidden: boolean) {
  const list = page.getByTestId('hidden-monitors-list');
  await expect(list).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  const toggle = list.getByRole('switch', { name: notedMonitorName, exact: true });
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.element });

  const isChecked = (await toggle.getAttribute('data-state')) === 'checked';
  if (isChecked !== hidden) {
    await toggle.click();
    await page.waitForTimeout(300);
  }
  await expect(toggle).toHaveAttribute('data-state', hidden ? 'checked' : 'unchecked');
}

When('I hide the noted monitor', async ({ page }) => {
  await setNotedMonitorHidden(page, true);
  log.info('E2E hid noted monitor', { component: 'e2e', notedMonitorName });
});

When('I restore the noted monitor', async ({ page }) => {
  await setNotedMonitorHidden(page, false);
  log.info('E2E restored noted monitor', { component: 'e2e', notedMonitorName });
});

Then('the hidden monitors count should be at least {int}', async ({ page }, min: number) => {
  const countEl = page.getByTestId('hidden-monitors-count');
  await expect(countEl).toBeVisible({ timeout: testConfig.timeouts.element });
  await expect
    .poll(async () => {
      const text = (await countEl.innerText()).trim();
      const match = text.match(/\d+/);
      return match ? Number(match[0]) : 0;
    }, { timeout: testConfig.timeouts.element })
    .toBeGreaterThanOrEqual(min);
});

Then('the noted monitor should not be listed', async ({ page }) => {
  // Wait for the monitor grid to render its (now reduced) set of cards.
  await expect(page.getByTestId('monitor-grid')).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await expect
    .poll(async () => {
      const names = await page.getByTestId('monitor-name').allInnerTexts();
      return names.map((n) => n.trim());
    }, { timeout: testConfig.timeouts.pageLoad })
    .not.toContain(notedMonitorName);
  log.info('E2E noted monitor absent from list', { component: 'e2e', notedMonitorName });
});

Then('the noted monitor should be listed', async ({ page }) => {
  await expect(page.getByTestId('monitor-grid')).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await expect
    .poll(async () => {
      const names = await page.getByTestId('monitor-name').allInnerTexts();
      return names.map((n) => n.trim());
    }, { timeout: testConfig.timeouts.pageLoad })
    .toContain(notedMonitorName);
  log.info('E2E noted monitor present in list', { component: 'e2e', notedMonitorName });
});
