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

// Sequence play needs two events (refs #534). Whether the window has them comes
// from the server's data, rendered as list rows; with fewer, the button must
// be disabled and the sequence play steps below have nothing to check.
let sequenceListIds: string[] | null = null;
let sequenceTileEventId: string | null = null;

When('I open sequence play if there are two events', async ({ page }) => {
  const rows = contextRows(page);
  await expect(rows.first()).toBeVisible({ timeout: testConfig.timeouts.transition * 3 });
  const ids = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid')!.replace('event-context-row-', ''))
  );
  const button = panel(page).getByTestId('event-context-sequence-open');
  if (ids.length < 2) {
    await expect(button).toBeDisabled();
    sequenceListIds = null;
    log.info('E2E event-context sequence play: fewer than two events, button disabled', { component: 'e2e' });
    return;
  }
  sequenceListIds = ids;
  await button.click();
  await expect(page.getByTestId('event-context-sequence')).toBeVisible({ timeout: testConfig.timeouts.transition });
});

Then('sequence play shows the nearby events in time order, playing', async ({ page }) => {
  if (!sequenceListIds) return;
  const sequence = page.getByTestId('event-context-sequence');
  const tiles = sequence.locator('[data-testid^="event-context-sequence-tile-"]');
  const tileIds = await tiles.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid')!.replace('event-context-sequence-tile-', ''))
  );
  // The list is in time order, so the tiles must be a run of it in the same order.
  const start = sequenceListIds.indexOf(tileIds[0]);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(sequenceListIds.slice(start, start + tileIds.length)).toEqual(tileIds);
  await expect(sequence.locator('[aria-current="true"]')).toHaveCount(1);
  // The first tile's slot starts at zero, so it is streaming the event now.
  await expect(tiles.first()).toHaveAttribute('data-playing', 'true', { timeout: testConfig.timeouts.transition });
  await expect(tiles.first().locator('img')).toHaveAttribute('src', new RegExp(`source=event&event=${tileIds[0]}\\b`));
  sequenceTileEventId = tileIds[0];
});

When('I switch sequence play to play all together', async ({ page }) => {
  if (!sequenceListIds) return;
  const toggle = page.getByTestId('event-context-sequence-together');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-mode', 'together');
});

// Together mode starts every tile, up to five on a server without multiport,
// so any two tiles play at once; sequence mode only overlaps real overlaps.
Then('more than one sequence play tile plays at once', async ({ page }) => {
  if (!sequenceListIds) return;
  const playing = page.getByTestId('event-context-sequence').locator('[data-playing="true"]');
  await expect.poll(() => playing.count(), { timeout: testConfig.timeouts.transition }).toBeGreaterThan(1);
});

When('I open the first sequence play tile', async ({ page }) => {
  if (!sequenceTileEventId) return;
  await page.getByTestId(`event-context-sequence-tile-${sequenceTileEventId}`).click();
});

Then("that sequence play tile's event detail opens", async ({ page }) => {
  if (!sequenceTileEventId) return;
  await expect(page).toHaveURL(new RegExp(`/events/(.+/)?${sequenceTileEventId}$`), { timeout: testConfig.timeouts.transition });
  await expect(page.getByTestId('event-context-sequence')).toBeHidden();
});
