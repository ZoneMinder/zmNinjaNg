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

When('I pick the {int} by {int} sequence play grid', async ({ page }, n: number) => {
  if (!sequenceListIds) return;
  const sequence = page.getByTestId('event-context-sequence');
  await sequence.getByTestId('event-context-sequence-grid').click();
  await page.getByTestId(`event-context-sequence-grid-${n}`).click();
});

// N x N sets N tiles to a row; how many tiles show does not change.
Then('sequence play lays its tiles out in {int} columns', async ({ page }, cols: number) => {
  if (!sequenceListIds) return;
  const sequence = page.getByTestId('event-context-sequence');
  const tiles = sequence.locator('[data-testid^="event-context-sequence-tile-"]');
  await expect.poll(() => tiles.count(), { timeout: testConfig.timeouts.transition }).toBe(Math.min(12, sequenceListIds.length));
  const tops = await tiles.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(tops.filter((top) => top === tops[0])).toHaveLength(Math.min(cols, tops.length));
});

// Sizes before the corner drag, so the outcome compares against them.
let beforeDrag: { tile: { width: number; height: number }; grid: { width: number; height: number } } | null = null;

When('I press the sequence play resize pencil', async ({ page }) => {
  if (!sequenceListIds) return;
  const toggle = page.getByTestId('event-context-sequence-resize-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

When("I drag the first sequence play tile's bottom right corner outward", async ({ page }) => {
  if (!sequenceListIds) return;
  const sequence = page.getByTestId('event-context-sequence');
  const tile = sequence.locator('[data-testid^="event-context-sequence-tile-"]').first();
  const grid = sequence.getByTestId('event-context-sequence-grid-tiles');
  // The dialog zooms in as it opens; measure once it has settled.
  // Its own animation only: playing tiles blink forever.
  await sequence.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const tileBox = (await tile.boundingBox())!;
  const gridBox = (await grid.boundingBox())!;
  beforeDrag = { tile: tileBox, grid: gridBox };
  const handle = sequence.locator('[data-testid^="event-context-sequence-resize-"][data-testid$="-br"]').first();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + tileBox.width / 2, h.y + tileBox.height / 2, { steps: 5 });
  await page.mouse.up();
});

Then('the first sequence play tile is larger and the grid keeps its size', async ({ page }) => {
  if (!sequenceListIds || !beforeDrag) return;
  const sequence = page.getByTestId('event-context-sequence');
  const tile = (await sequence.locator('[data-testid^="event-context-sequence-tile-"]').first().boundingBox())!;
  const grid = (await sequence.getByTestId('event-context-sequence-grid-tiles').boundingBox())!;
  // Area, not each side: with one row of tiles only the width can give.
  expect(tile.width * tile.height).toBeGreaterThan(beforeDrag.tile.width * beforeDrag.tile.height * 1.2);
  expect(Math.abs(grid.width - beforeDrag.grid.width)).toBeLessThan(2);
  expect(Math.abs(grid.height - beforeDrag.grid.height)).toBeLessThan(2);
});

When('I pick {int} replay tiles in settings', async ({ page }, n: number) => {
  const choice = page.getByTestId(`settings-replay-tiles-${n}`);
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
});

Then('sequence play shows up to {int} tiles', async ({ page }, max: number) => {
  if (!sequenceListIds) return;
  const tiles = page.getByTestId('event-context-sequence').locator('[data-testid^="event-context-sequence-tile-"]');
  await expect.poll(() => tiles.count(), { timeout: testConfig.timeouts.transition }).toBe(Math.min(max, sequenceListIds.length));
});

// One tap plays a tile on its own, so the other tiles stop (refs #534).
let lastTileEventId: string | null = null;

When('I tap the last sequence play tile', async ({ page }) => {
  if (!sequenceListIds) return;
  const last = page.getByTestId('event-context-sequence').locator('[data-testid^="event-context-sequence-tile-"]').last();
  lastTileEventId = (await last.getAttribute('data-testid'))!.replace('event-context-sequence-tile-', '');
  await last.click();
});

Then('only the last sequence play tile plays', async ({ page }) => {
  if (!sequenceListIds || !lastTileEventId) return;
  const playing = page.getByTestId('event-context-sequence').locator('[data-playing="true"]');
  await expect(playing).toHaveCount(1, { timeout: testConfig.timeouts.transition });
  await expect(playing).toHaveAttribute('data-testid', `event-context-sequence-tile-${lastTileEventId}`);
});

When('I double tap the first sequence play tile', async ({ page }) => {
  if (!sequenceTileEventId) return;
  await page.getByTestId(`event-context-sequence-tile-${sequenceTileEventId}`).dblclick();
});

Then("that sequence play tile's event detail opens", async ({ page }) => {
  if (!sequenceTileEventId) return;
  await expect(page).toHaveURL(new RegExp(`/events/(.+/)?${sequenceTileEventId}$`), { timeout: testConfig.timeouts.transition });
  await expect(page.getByTestId('event-context-sequence')).toBeHidden();
});

When("I go back from the sequence play tile's event", async ({ page }) => {
  if (!sequenceTileEventId) return;
  await page.goBack();
});

Then('sequence play is back, marking the tile I opened', async ({ page }) => {
  if (!sequenceTileEventId) return;
  const tile = page.getByTestId(`event-context-sequence-tile-${sequenceTileEventId}`);
  await expect(tile).toBeVisible({ timeout: testConfig.timeouts.transition });
  await expect(tile).toHaveAttribute('data-flash', 'true');
  // Playback holds on return, so the triangle means "you came from here".
  await expect(page.getByTestId('event-context-sequence').locator('[data-playing="true"]')).toHaveCount(0);
});

// Filtered follows the Events page filters (refs #534). The monitor deep link
// is the one filter the page applies from the URL before its first render, so
// the filter is known exactly rather than picked from whatever the popover shows.
let filteredMonitorId: string | null = null;

When("I filter the Events page to the first event's monitor", async ({ page }) => {
  const firstCard = page.getByTestId('event-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  filteredMonitorId = await firstCard.getAttribute('data-monitor-id');
  await page.goto(`/#/events?monitorId=${filteredMonitorId}`);
  // Every card, not just the first: the first is from this monitor either way.
  await expect
    .poll(async () => [...new Set(await page.getByTestId('event-card').evaluateAll((els) => els.map((el) => el.getAttribute('data-monitor-id'))))], {
      timeout: testConfig.timeouts.transition * 3,
    })
    .toEqual([filteredMonitorId]);
});

When('I choose the Filtered scope', async ({ page }) => {
  const chip = panel(page).getByTestId('event-context-scope-filtered');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
});

Then('every nearby event is from the filtered monitor', async ({ page }) => {
  const rows = contextRows(page);
  await expect(rows.first()).toBeVisible({ timeout: testConfig.timeouts.transition * 3 });
  await expect
    .poll(async () => [...new Set(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-monitor-id'))))], {
      timeout: testConfig.timeouts.transition * 3,
    })
    .toEqual([filteredMonitorId]);
});
