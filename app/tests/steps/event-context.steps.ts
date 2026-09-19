import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

const panel = (page: Page) => page.getByTestId('event-context-panel');
const contextRows = (page: Page) => panel(page).locator('[data-testid^="event-context-row-"]');

// The panel's row ids at the default window, captured right after it settles,
// so "reflect the N minute window" can prove the widened fetch actually
// changed what's on screen (C6) instead of asserting the chip's own pressed
// state. The anchor event itself is always a member of its own window, so
// this is never empty once the panel has data.
let baselineRowIds: (string | null)[] | null = null;

When('I open the around-this-event panel on the first event', async ({ page }) => {
  const firstCard = page.getByTestId('event-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await firstCard.getByTestId('event-context-open').click();

  await expect(panel(page)).toBeVisible({ timeout: testConfig.timeouts.transition });

  const rows = contextRows(page);
  const emptyState = panel(page).getByTestId('event-context-empty');
  await expect.poll(async () => {
    const count = await rows.count();
    const empty = await emptyState.isVisible().catch(() => false);
    return count > 0 || empty;
  }, { timeout: testConfig.timeouts.transition * 3 }).toBeTruthy();

  baselineRowIds = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  log.info('E2E event-context baseline captured', { component: 'e2e', count: baselineRowIds.length });
});

Then('I should see the event context panel', async ({ page }) => {
  await expect(panel(page)).toBeVisible({ timeout: testConfig.timeouts.transition });
});

Then('I should not see the event context panel', async ({ page }) => {
  await expect(panel(page)).toBeHidden({ timeout: testConfig.timeouts.transition });
});

When('I choose the {int} minute window', async ({ page }, minutes: number) => {
  await panel(page).getByTestId(`event-context-window-${minutes}`).click();
});

// Widening the window can only grow the result set (same scope, a wider time
// bound), so the row ids after must differ from the pre-widen snapshot -
// either more rows, or the anchor-only baseline giving way to neighbours.
Then('the event context list should reflect the {int} minute window', async ({ page }, minutes: number) => {
  if (baselineRowIds === null) {
    throw new Error('E2E: no baseline row snapshot captured before widening the window');
  }
  const rows = contextRows(page);
  await expect.poll(async () => {
    const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    return JSON.stringify(ids) !== JSON.stringify(baselineRowIds);
  }, { timeout: testConfig.timeouts.transition * 4 }).toBeTruthy();

  log.info('E2E event-context window widened', { component: 'e2e', minutes });
});
