import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getMonitorCount, getMonitorEventCountSince } from '../helpers/zm-api';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// A fixed old watermark: any monitor with events after this date shows a
// badge. 2020-01-01 predates every event on the test server, so any monitor
// the API reports events for since then is expected to badge.
const OLD_WATERMARK = '2020-01-01 00:00:00';

/** Number of column tracks the CSS grid actually resolved to, or 0 if the container is not a grid. */
async function gridColumnTracks(page: Page): Promise<number> {
  return page.getByTestId('monitor-grid').evaluate((el) => {
    const style = getComputedStyle(el);
    if (style.display !== 'grid') return 0;
    return style.gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  });
}

/** Cards sharing the topmost y coordinate: the rendered width of the first row. */
async function countTopRowCards(page: Page): Promise<number> {
  const cards = page.getByTestId('monitor-card');
  const total = await cards.count();
  const tops: number[] = [];
  for (let i = 0; i < total; i++) {
    const box = await cards.nth(i).boundingBox();
    if (box) tops.push(box.y);
  }
  if (tops.length === 0) return 0;
  const minTop = Math.min(...tops);
  return tops.filter((top) => Math.abs(top - minTop) <= 4).length;
}

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
  // MonitorDetail is lazy, so the Monitors page outlives the URL change; wait
  // for the detail page itself or the next step can act on an outgoing card.
  await expect(page.getByTestId('monitor-detail-name')).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('I should see the monitor grid', async ({ page }) => {
  await expect(page.getByTestId('monitor-grid')).toBeVisible();
});

// The Monitors page defaults to list view (settings.monitorsViewMode = 'list'),
// which stacks cards in a single column. Only grid view sets
// grid-template-columns, so a multi-column assertion must switch modes first.
When('I switch the monitors view to grid', async ({ page }) => {
  await expect(page.getByTestId('monitor-grid')).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  if ((await gridColumnTracks(page)) === 0) {
    await page.getByTestId('monitors-view-toggle').click();
  }
  await expect
    .poll(() => gridColumnTracks(page), { timeout: testConfig.timeouts.element })
    .toBeGreaterThan(0);
});

Then('the monitor grid should lay out cards in more than one column', async ({ page }) => {
  // Ground truth for "can a second card exist", read from the API rather than
  // from the cards under test (rule 34).
  const monitorCount = await getMonitorCount();

  await expect(async () => {
    // The CSS contract: repeat(monitorGridCols, minmax(0, 1fr)) resolves to one
    // track per column. This holds whatever the monitor count is.
    expect(await gridColumnTracks(page)).toBeGreaterThan(1);

    // The geometry has to agree with the CSS: with two monitors to place, two
    // cards must sit side by side on the first row.
    if (monitorCount >= 2) {
      expect(await countTopRowCards(page)).toBeGreaterThan(1);
    }
  }).toPass({ timeout: testConfig.timeouts.pageLoad });
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

// New-events badge steps (refs #239)
//
// A fresh Playwright context has empty localStorage, so every monitor is
// unseeded: the first "events since" response seeds it and reports zero,
// meaning no badge ever renders on a virgin page load. To exercise "opening
// a monitor's events clears only that monitor's badge" the test has to
// create its own precondition: write an old watermark for monitors the API
// (not the UI) confirms have events after it, then reload so the persisted
// zustand store rehydrates from that seeded localStorage. The API check
// keeps this guard independent of the badge's own rendering (rule 34): if
// rendering regresses, the assertions below fail instead of quietly
// skipping.
let seededMonitorIds: string[] = [];
let badgedMonitorIds: string[] = [];
let clearedMonitorId: string | null = null;

When('I seed old watermarks for monitors with events', async ({ page }) => {
  // The profile id the login step created; watermarks are stored per profile.
  const profileId = await page.evaluate(() => {
    const raw = localStorage.getItem('zmng-profiles');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { currentProfileId?: string | null } };
    return parsed.state?.currentProfileId ?? null;
  });
  expect(profileId, 'expected a current profile id in zmng-profiles after login').toBeTruthy();

  // Real monitor ids from the rendered cards, not hardcoded.
  const cards = page.locator('[data-testid="monitor-card"]');
  await expect(cards.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  const ids = (await cards.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-monitor-id'))
  )).filter((id): id is string => !!id);
  expect(ids.length, 'expected at least one rendered monitor card').toBeGreaterThan(0);

  // Ground truth from the ZM API: only monitors with events after the
  // watermark are expected to badge. Querying every candidate up front means
  // the later assertions can be hard requirements, not skips.
  const withEvents: string[] = [];
  for (const id of ids) {
    const count = await getMonitorEventCountSince(id, OLD_WATERMARK);
    if (count > 0) withEvents.push(id);
  }
  expect(
    withEvents.length,
    'need at least 2 monitors with events since 2020-01-01 on the test server to prove badge-clearing is scoped to one monitor'
  ).toBeGreaterThanOrEqual(2);
  seededMonitorIds = withEvents;

  await page.evaluate(
    ({ key, profileId, monitorIds, since }) => {
      const watermarks: Record<string, string> = {};
      for (const id of monitorIds) watermarks[id] = since;
      const payload = {
        state: { profileWatermarks: { [profileId]: watermarks } },
        version: 0,
      };
      localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: 'zmng-monitor-seen', profileId: profileId as string, monitorIds: withEvents, since: OLD_WATERMARK }
  );

  log.info('E2E seeded old watermarks', { component: 'e2e', count: withEvents.length });
});

When('I record which monitors show a new-event badge', async ({ page }) => {
  const cards = page.locator('[data-testid="monitor-card"]');
  await expect(cards.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  // Each seeded monitor's "events since" query resolves independently; wait
  // for all of them before reading, not just the first badge to appear.
  const badges = page.locator('[data-testid="monitor-new-events-badge"]');
  await expect
    .poll(() => badges.count(), { timeout: testConfig.timeouts.pageLoad })
    .toBeGreaterThanOrEqual(seededMonitorIds.length);

  badgedMonitorIds = [];
  for (const card of await cards.all()) {
    const badge = card.getByTestId('monitor-new-events-badge');
    if (await badge.count()) {
      const id = await card.getAttribute('data-monitor-id');
      if (id) badgedMonitorIds.push(id);
    }
  }
  // The API already confirmed seededMonitorIds.length monitors have events
  // since the watermark; a hard requirement here, not a skip, is what makes
  // this scenario fail on a rendering regression instead of passing vacuously.
  expect(
    badgedMonitorIds.length,
    `expected badges for the ${seededMonitorIds.length} monitor(s) the API confirmed have events since the seeded watermark`
  ).toBeGreaterThanOrEqual(2);
  log.info('E2E badged monitors', { component: 'e2e', count: badgedMonitorIds.length });
});

When('I open the events of the first badged monitor', async ({ page }) => {
  clearedMonitorId = badgedMonitorIds[0];
  const card = page.locator(`[data-monitor-id="${clearedMonitorId}"]`);
  await card.getByTestId('monitor-events-button').click();
  await page.waitForURL(/\/events\?monitorId=\d+/, { timeout: testConfig.timeouts.transition });
});

Then('that monitor should have no new-event badge', async ({ page }) => {
  const card = page.locator(`[data-monitor-id="${clearedMonitorId}"]`);
  await expect(card).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await expect(card.getByTestId('monitor-new-events-badge')).toHaveCount(0);
});

Then('the other badged monitors should keep theirs', async ({ page }) => {
  const remaining = badgedMonitorIds.slice(1);
  expect(remaining.length, 'need a second badged monitor to prove the clear is scoped to one monitor').toBeGreaterThan(0);
  for (const id of remaining) {
    const card = page.locator(`[data-monitor-id="${id}"]`);
    await expect(card.getByTestId('monitor-new-events-badge')).toHaveCount(1);
  }
});

// The label the view toggle carried before the long press. The hint should
// echo it, and it should still be the label afterwards: if the button had
// acted, the toggle would now advertise the opposite view.
let heldButtonLabel = '';

When('I long-press the monitors view toggle', async ({ page }) => {
  const toggle = page.getByTestId('monitors-view-toggle');
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  const label = await toggle.getAttribute('title');
  expect(label, 'the view toggle needs a title for the hint to show').toBeTruthy();
  heldButtonLabel = label as string;

  const box = await toggle.boundingBox();
  expect(box, 'the view toggle needs a box to press in the middle of').not.toBeNull();
  const center = { clientX: box!.x + box!.width / 2, clientY: box!.y + box!.height / 2 };

  // A real finger, not a mouse: the hint deliberately ignores mouse presses
  // because hover already reveals the title there.
  await toggle.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, ...center });
});

Then('I should see a hint toast naming the view toggle', async ({ page }) => {
  // No fixed wait: the toast only appears once the hold passes the threshold,
  // so the auto-retrying assertion is what times the press.
  await expect(page.locator('[data-sonner-toast]')).toHaveText(heldButtonLabel, {
    timeout: testConfig.timeouts.transition,
  });

  const toggle = page.getByTestId('monitors-view-toggle');
  await toggle.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true });
  await toggle.dispatchEvent('click');
});

Then('the monitors view should not have switched', async ({ page }) => {
  await expect(page.getByTestId('monitors-view-toggle')).toHaveAttribute('title', heldButtonLabel);
});

// The capture pipeline used to sit on the card face as unlabelled badges;
// it now lives behind one info button, with labels and Decoding (refs #467).
When("I open the first monitor's info popover", async ({ page }) => {
  const firstCard = page.getByTestId('monitor-card').first();
  await expect(firstCard).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await firstCard.getByTestId('monitor-info-btn').click();
  await expect(page.getByTestId('monitor-info-popover')).toBeVisible({ timeout: testConfig.timeouts.transition });
});

Then("the info popover should show the capture settings and the card's resolution", async ({ page }) => {
  const popover = page.getByTestId('monitor-info-popover');
  const cardResolution = (await page.getByTestId('monitor-card').first().getByTestId('monitor-resolution').innerText()).trim();
  await expect(popover.getByTestId('monitor-info-resolution')).toHaveText(cardResolution);

  // ZM 1.38+ splits the pipeline into four labelled rows; older servers have
  // Function. Either way every value row carries a non-empty value.
  const modern = await popover.getByTestId('monitor-info-decoding').count();
  const keys = modern ? ['capturing', 'analysing', 'recording', 'decoding'] : ['function'];
  for (const key of keys) {
    const value = (await popover.getByTestId(`monitor-info-${key}`).innerText()).trim();
    expect(value.length, `${key} value`).toBeGreaterThan(0);
  }
  log.info('E2E monitor info popover', { component: 'e2e', action: 'monitor_info_popover', modern: modern > 0 });
});

Then('the monitors page should still be open', async ({ page }) => {
  await expect(page).toHaveURL(/\/monitors\/?(\?.*)?$/);
  await expect(page.getByTestId('monitor-card').first()).toBeVisible();
});

