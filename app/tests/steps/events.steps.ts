import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getEventCount } from '../helpers/zm-api';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Whether the server has any events at all. Asked of the ZM API, not inferred
// from the rendered cards: a flag set by one step and read by another is scoped
// to the worker, not the scenario, so under parallel workers a scenario that
// never ran the setter silently skipped its own assertions, and one that
// inherited a stale `true` raced the page load. Cached per worker: one API call
// per run (rule 34, refs #237).
let serverEventCount: number | null = null;
async function serverHasEvents(): Promise<boolean> {
  if (serverEventCount === null) {
    serverEventCount = await getEventCount();
    log.info('E2E server event count', { component: 'e2e', count: serverEventCount });
  }
  return serverEventCount > 0;
}

// Shared state for event steps
let favoriteToggled = false;
let favoritedEventId: string | null = null;
let tagFilterApplied = false;
let archiveToggled = false;
let detailArchiveToggled = false;
let detailFavoriteToggled = false;
let downloadClicked = false;

// Event List Steps
Then('I should see events list or empty state', async ({ page }) => {
  const filterButton = page.getByTestId('events-filter-button');
  await expect(filterButton).toBeVisible({ timeout: testConfig.timeouts.transition * 3 });

  const eventCards = page.getByTestId('event-card');
  const emptyState = page.getByTestId('events-empty-state');

  await expect.poll(async () => {
    const count = await eventCards.count();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    return count > 0 || emptyVisible;
  }, { timeout: testConfig.timeouts.transition * 3 }).toBeTruthy();

  const eventCount = await eventCards.count();
  const emptyVisible = await emptyState.isVisible().catch(() => false);
  expect(eventCount > 0 || emptyVisible).toBeTruthy();

  if (eventCount > 0) {
    log.info('E2E events found', { component: 'e2e', action: 'events_count', count: eventCount });
  }

  preFilterEventIds = await eventCards.evaluateAll((els) => els.map((el) => el.getAttribute('data-event-id')));
});

// Date-range filter actually changes the result set (refs #217, events.feature
// "Filter events by date range and verify results change").
let preFilterEventIds: (string | null)[] = [];

Then('the filtered event set should differ from the unfiltered list', async ({ page }) => {
  if (preFilterEventIds.length === 0) {
    log.info('E2E: Skipping date-filter diff check - no events existed before filtering', { component: 'e2e' });
    return;
  }

  const eventCards = page.getByTestId('event-card');
  const emptyState = page.getByTestId('events-empty-state');

  // useQuery keeps the previous (unfiltered) page visible via keepPreviousData
  // while the filtered request is in flight, so the unfiltered list would
  // satisfy a naive "list or empty" check immediately. Poll until the DOM
  // actually reflects a different result set (or a real empty state) instead
  // of accepting the stale snapshot.
  await expect.poll(async () => {
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    if (emptyVisible) return true;
    const ids = await eventCards.evaluateAll((els) => els.map((el) => el.getAttribute('data-event-id')));
    return JSON.stringify(ids) !== JSON.stringify(preFilterEventIds);
  }, { timeout: testConfig.timeouts.transition * 4 }).toBeTruthy();

  const emptyVisible = await emptyState.isVisible().catch(() => false);
  if (emptyVisible) {
    // The fixed 2024-01-01 hour window returned zero events: a real, verifiable
    // change from the unfiltered "most recent" list, which was non-empty.
    return;
  }
  const idsAfter = await eventCards.evaluateAll((els) => els.map((el) => el.getAttribute('data-event-id')));
  expect(idsAfter).not.toEqual(preFilterEventIds);
});

Then('the events list should return to a non-empty state', async ({ page }) => {
  if (preFilterEventIds.length === 0) {
    log.info('E2E: Skipping post-clear check - no events existed before filtering', { component: 'e2e' });
    return;
  }
  const eventCards = page.getByTestId('event-card');
  await expect.poll(() => eventCards.count(), {
    timeout: testConfig.timeouts.transition * 3,
  }).toBeGreaterThan(0);
});

// Scroll restoration (refs #197)
let savedScrollTop = 0;
let scrolledList = false;
let openedAfterScroll = false;

When('I scroll the events list down if it is scrollable', async ({ page }) => {
  savedScrollTop = 0;
  scrolledList = false;

  const container = page.getByTestId('events-scroll-container');
  await container.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

  // Wait for cards to render so the list has scrollable height.
  const cards = page.getByTestId('event-card');
  await expect
    .poll(async () => cards.count(), { timeout: testConfig.timeouts.transition * 3 })
    .toBeGreaterThan(0);

  await container.evaluate((el) => el.scrollTo(0, 800));
  savedScrollTop = await container.evaluate((el) => el.scrollTop);
  scrolledList = savedScrollTop > 0;
  log.info('E2E events scrolled', { component: 'e2e', action: 'scroll', savedScrollTop });
});

When('I open a visible event after scrolling if the list was scrolled', async ({ page }) => {
  openedAfterScroll = false;
  if (!scrolledList) return;

  // Click a card already within the viewport so Playwright does not auto-scroll
  // (which would change the position we are trying to preserve).
  const viewport = page.viewportSize();
  const maxY = viewport?.height ?? 800;
  const cards = page.getByTestId('event-card');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const box = await card.boundingBox();
    if (box && box.y >= 0 && box.y + box.height <= maxY) {
      await card.click();
      await page.waitForURL(/.*events\/\d+/, { timeout: testConfig.timeouts.transition });
      openedAfterScroll = true;
      return;
    }
  }
});

When('I navigate back to the events list if I opened an event', async ({ page }) => {
  if (!openedAfterScroll) return;
  await page.goBack();
  await page.getByTestId('events-scroll-container').waitFor({
    state: 'visible',
    timeout: testConfig.timeouts.element,
  });
});

// The in-app back arrow takes a different path than browser/Esc back: it must
// pop history so the list scroll position is restored, not push a fresh entry
// (refs #197).
When('I press the event detail back button if I opened an event', async ({ page }) => {
  if (!openedAfterScroll) return;
  await page.getByTestId('event-detail-back').click();
  await page.getByTestId('events-scroll-container').waitFor({
    state: 'visible',
    timeout: testConfig.timeouts.element,
  });
});

Then('the events list scroll position should be restored if it was scrolled', async ({ page }) => {
  if (!openedAfterScroll) return;
  const container = page.getByTestId('events-scroll-container');
  await expect
    .poll(async () => container.evaluate((el) => el.scrollTop), {
      timeout: testConfig.timeouts.transition * 3,
    })
    // Allow tolerance for layout settling; a reset would read ~0.
    .toBeGreaterThan(savedScrollTop - 100);
});

When('I switch events view to montage', async ({ page }) => {
  const montageGrid = page.getByTestId('events-montage-grid');
  if (await montageGrid.isVisible().catch(() => false)) {
    return;
  }
  const montageToggle = page.getByTestId('events-view-toggle');
  await expect(montageToggle).toBeVisible();
  await montageToggle.click();
});

Then('I should see the events montage grid', async ({ page }) => {
  await expect(page.getByTestId('events-montage-grid')).toBeVisible();
});

When('I switch events view to list', async ({ page }) => {
  // Deliberately not short-circuiting the way the montage direction does: one
  // button carries both directions, so a click that landed while the page was
  // already in list would switch INTO montage. Asserting the grid is on screen
  // first means this step cannot quietly do nothing.
  await expect(page.getByTestId('events-montage-grid')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
  await page.getByTestId('events-view-toggle').click();
});

Then('I should see the events list', async ({ page }) => {
  // Both halves. The montage grid going away is what proves ?view=montage was
  // cleared; the list rendering is what proves the page landed somewhere real
  // rather than on an empty state.
  await expect(page.getByTestId('events-montage-grid')).toHaveCount(0, {
    timeout: testConfig.timeouts.transition,
  });
  await expect(page.getByTestId('event-list')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

When('I click into the first event if events exist', async ({ page }) => {
  if (await serverHasEvents()) {
    const firstEvent = page.getByTestId('event-card').first();
    await firstEvent.click();
    await page.waitForURL(/.*events\/\d+/, { timeout: testConfig.timeouts.transition });
    await page.waitForTimeout(500);
  }
});

When('I navigate back if I clicked into an event', async ({ page }) => {
  if (await serverHasEvents()) {
    await page.goBack();
    await page.waitForTimeout(500);
  }
});

// Event Filter Steps
When('I open the events filter panel', async ({ page }) => {
  const filterButton = page.getByTestId('events-filter-button');
  const panel = page.getByTestId('events-filter-panel');

  // The whole Events header, this button included, sits behind the page's
  // loading skeleton until the first profile's events query resolves, so this
  // is a full data load rather than a plain element wait - and All mode adds
  // one events query per profile on top (refs #337).
  await filterButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.pageLoad });

  // Click to open if not already open
  if (!(await panel.isVisible().catch(() => false))) {
    await filterButton.click();
    await expect(panel).toBeVisible({ timeout: testConfig.timeouts.transition });
  }
});

When('I set the events date range', async ({ page }) => {
  const panel = page.getByTestId('events-filter-panel');
  const filterButton = page.getByTestId('events-filter-button');

  // Ensure panel is open
  if (!(await panel.isVisible().catch(() => false))) {
    await filterButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
    await filterButton.click();
    await expect(panel).toBeVisible({ timeout: testConfig.timeouts.transition });
  }

  const startInput = page.getByTestId('events-start-date');
  const endInput = page.getByTestId('events-end-date');

  await startInput.scrollIntoViewIfNeeded();
  await endInput.scrollIntoViewIfNeeded();

  // datetime-local expects minutes precision without seconds.
  await startInput.fill('2024-01-01T00:00', { timeout: testConfig.timeouts.transition });
  await endInput.fill('2024-01-01T01:00', { timeout: testConfig.timeouts.transition });
});

When('I apply event filters', async ({ page }) => {
  await page.getByTestId('events-apply-filters').click();
});

// Applying does not close the popover (the Popover in Events.tsx is
// uncontrolled), and the open panel sits over the top of the event list. Any
// step that then clicks a card is clicking through it and never lands, so the
// popover must be dismissed first (refs #237).
When('I close the events filter panel', async ({ page }) => {
  const panel = page.getByTestId('events-filter-panel');
  // Escape is also the global back shortcut, so it only gets pressed when
  // there is a panel for it to close. Applying a filter can dismiss the
  // popover on its own, and a speculative Escape then navigates the app off
  // the Events page entirely - which is what All mode surfaced, since the
  // shortcuts run there now too (refs #337).
  if (await panel.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  await expect(panel).toBeHidden({
    timeout: testConfig.timeouts.transition,
  });
});

When('I clear event filters', async ({ page }) => {
  const panel = page.getByTestId('events-filter-panel');
  const filterButton = page.getByTestId('events-filter-button');
  const clearButton = page.getByTestId('events-clear-filters');

  // Wait for filter button to be available
  await filterButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

  // Open panel if not already visible
  if (!(await panel.isVisible().catch(() => false))) {
    await filterButton.click();
    await expect(panel).toBeVisible({ timeout: testConfig.timeouts.transition });
  }

  // Wait for clear button to be visible and clickable within the panel
  await clearButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await clearButton.click();
});

When('I select the past week quick time filter', async ({ page }) => {
  // hours=168 (past week) is wide enough to usually include events on a live server.
  const weekChip = page.getByTestId('quick-range-168');
  await weekChip.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await weekChip.click();
});

When('I clear the quick time filter', async ({ page }) => {
  const clearButton = page.getByTestId('events-clear-quick-range');
  await clearButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await clearButton.click();
});

Then('the quick time filter clear button should be gone', async ({ page }) => {
  await expect(page.getByTestId('events-clear-quick-range')).toHaveCount(0, {
    timeout: testConfig.timeouts.transition,
  });
});

// A monitor card's Events button deep-links to ?monitorId=<id>&startDateTime=<watermark>
// (refs #239). This URL sets a date range without ever going through the quick-range
// chips, so the clear button must show up for that source too, not only after "I select
// the past week quick time filter" above.
Then('the quick time filter clear button should be visible', async ({ page }) => {
  await expect(page.getByTestId('events-clear-quick-range')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

/** Query params from a HashRouter URL, e.g. ".../#/events?monitorId=5" -> {monitorId: "5"}. */
function hashSearchParams(url: string): URLSearchParams {
  const afterHash = url.split('#')[1] ?? '';
  const queryString = afterHash.split('?')[1] ?? '';
  return new URLSearchParams(queryString);
}

Then('the date filter should be gone from the URL but the monitor filter should remain', async ({ page }) => {
  await expect.poll(() => hashSearchParams(page.url()).has('startDateTime'), {
    timeout: testConfig.timeouts.transition,
  }).toBe(false);

  const params = hashSearchParams(page.url());
  expect(params.has('endDateTime')).toBe(false);
  expect(params.get('monitorId'), 'expected monitorId to survive clearing the date range (refs #194)').toBeTruthy();
});

Then('the events list should only show events for that monitor', async ({ page }) => {
  const monitorId = hashSearchParams(page.url()).get('monitorId');
  expect(monitorId, 'expected a monitorId in the URL to compare event cards against').toBeTruthy();

  const cards = page.getByTestId('event-card');
  await expect(cards.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  const cardMonitorIds = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-monitor-id')));
  // Ground truth for "this monitor has events" was already established via the ZM API
  // in "I seed old watermarks for monitors with events" (getMonitorEventCountSince),
  // so a hard assert here is not vacuous even though the date filter was just removed.
  expect(cardMonitorIds.length).toBeGreaterThan(0);
  for (const id of cardMonitorIds) {
    expect(id).toBe(monitorId);
  }
});

When('I select a monitor filter if available', async ({ page }) => {
  const panel = page.getByTestId('events-filter-panel');
  // Look for a monitor select/checkbox in the filter panel
  const monitorFilter = panel.locator('[data-testid="events-monitor-filter"]')
    .or(panel.locator('select').first())
    .or(panel.locator('[role="checkbox"]').first());

  const isVisible = await monitorFilter.isVisible({ timeout: 2000 }).catch(() => false);
  if (isVisible) {
    await monitorFilter.click();
    await page.waitForTimeout(300);
  }
});

// Event Favorite Steps
When('I favorite the first event if events exist', async ({ page }) => {
  favoriteToggled = false;
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping favorite - no events exist', { component: 'e2e' });
    return;
  }

  // The server has events, so a card must be rendered, and the favorite button is
  // part of every event card, so a failure here is a real regression, not
  // absent content - let it propagate instead of masking it as "skipped".
  const firstEventCard = page.getByTestId('event-card').first();
  await firstEventCard.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  favoritedEventId = await firstEventCard.getAttribute('data-event-id');

  const favoriteButton = firstEventCard.getByTestId('event-favorite-button');
  await favoriteButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await favoriteButton.click();
  favoriteToggled = true;
  await page.waitForTimeout(500);
});

When('I unfavorite the first event if it was favorited', async ({ page }) => {
  if (!favoriteToggled) {
    log.info('E2E: Skipping unfavorite - event was not favorited', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const favoriteButton = firstEventCard.getByTestId('event-favorite-button');
  await favoriteButton.click();
  favoriteToggled = false;
  await page.waitForTimeout(500);
});

Then('I should see the event marked as favorited if action was taken', async ({ page }) => {
  if (!favoriteToggled) {
    log.info('E2E: Skipping favorited check - no favorite action was taken', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const favoriteButton = firstEventCard.getByTestId('event-favorite-button');
  const starIcon = favoriteButton.locator('svg');

  // Star should have fill-yellow-500 class when favorited
  await expect(starIcon).toHaveClass(/fill-yellow-500/);
});

Then('I should see the favorited event in the filtered list if action was taken', async ({ page }) => {
  if (!favoriteToggled || !favoritedEventId) {
    log.info('E2E: Skipping favorites-filter outcome check - no favorite action was taken', { component: 'e2e' });
    return;
  }

  // The favorites filter is applied server-side via the "Id IN:" event query
  // (refs #205), so the favorited event must be present in the filtered list,
  // not filtered away after a server page. Verify the specific event is shown.
  const favoritedCard = page.locator(`[data-testid="event-card"][data-event-id="${favoritedEventId}"]`);
  await expect(favoritedCard).toBeVisible({ timeout: testConfig.timeouts.transition * 3 });

  // And the list must not be empty while a favorite exists.
  await expect(page.getByTestId('events-empty-state')).toBeHidden();
});

Then('I should see the event not marked as favorited if action was taken', async ({ page }) => {
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping not favorited check - no events exist', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const favoriteButton = firstEventCard.getByTestId('event-favorite-button');
  const starIcon = favoriteButton.locator('svg');

  // Star should not have fill-yellow-500 class when not favorited
  await expect(starIcon).not.toHaveClass(/fill-yellow-500/);
});

// Event Archive Steps
When('I archive the first event if events exist', async ({ page }) => {
  archiveToggled = false;
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping archive - no events exist', { component: 'e2e' });
    return;
  }

  // Same reasoning as favorite above: the card and archive button are
  // guaranteed to exist here, so let a real failure fail the test.
  const firstEventCard = page.getByTestId('event-card').first();
  await firstEventCard.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

  const archiveButton = firstEventCard.getByTestId('event-archive-button');
  await archiveButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await archiveButton.click();
  archiveToggled = true;
  // Wait for toast (also confirms API completed)
  await expect(page.getByText(/archived|archivé|archiviert|archivad/i).first())
    .toBeVisible({ timeout: testConfig.timeouts.transition });
  await page.waitForTimeout(500);
});

When('I unarchive the first event if it was archived', async ({ page }) => {
  if (!archiveToggled) {
    log.info('E2E: Skipping unarchive - event was not archived', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const archiveButton = firstEventCard.getByTestId('event-archive-button');
  await archiveButton.click();
  archiveToggled = false;
  await page.waitForTimeout(500);
});

Then('I should see the event marked as archived if action was taken', async ({ page }) => {
  if (!archiveToggled) {
    log.info('E2E: Skipping archived check - no archive action was taken', { component: 'e2e' });
    return;
  }

  // Archived state is carried by the icon's SHAPE, not a fill: EventCard
  // swaps Archive for ArchiveRestore because a solid box loses its lid at
  // this size and colour alone says nothing to a colourblind reader. The
  // component exposes a testid per state for exactly this assertion; the old
  // /fill-primary/ check was left behind by that change.
  const firstEventCard = page.getByTestId('event-card').first();
  const archiveButton = firstEventCard.getByTestId('event-archive-button');

  await expect(archiveButton.getByTestId('event-archive-icon-on')).toBeVisible();
});

Then('I should see the event not marked as archived if action was taken', async ({ page }) => {
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping not-archived check - no events exist', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const archiveButton = firstEventCard.getByTestId('event-archive-button');

  await expect(archiveButton.getByTestId('event-archive-icon-off')).toBeVisible();
});

When('I archive the event from detail page if on detail page', async ({ page }) => {
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping archive from detail - no events exist', { component: 'e2e' });
    return;
  }

  // The server has events, so the earlier "I click into the first event if
  // events exist" step navigated here and waited for the /events/:id URL, so
  // we are genuinely on the detail page and its archive button must exist.
  // Swallowing a missing button behind isVisible().catch() masked a real
  // rendering regression as "nothing to do here" - assert it hard instead.
  const archiveBtn = page.getByTestId('event-detail-archive');
  await expect(archiveBtn).toBeVisible({ timeout: testConfig.timeouts.element });
  await archiveBtn.click();
  detailArchiveToggled = true;
  await page.waitForTimeout(700);
});

Then('I should see the detail archive button active if action was taken', async ({ page }) => {
  if (!detailArchiveToggled) return;
  // Same shape-not-fill conveyance as the card (EventDetail swaps Archive for
  // ArchiveRestore), with a testid per state.
  const archiveBtn = page.getByTestId('event-detail-archive');
  await expect(archiveBtn.getByTestId('event-detail-archive-icon-on')).toBeVisible();
});

Then('I should see the detail archive button inactive if action was taken', async ({ page }) => {
  if (!detailArchiveToggled) return;
  const archiveBtn = page.getByTestId('event-detail-archive');
  await expect(archiveBtn.getByTestId('event-detail-archive-icon-off')).toBeVisible();
});

When('I enable favorites only filter', async ({ page }) => {
  const favoritesToggle = page.getByTestId('events-favorites-toggle');
  await favoritesToggle.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

  // Radix Switch exposes state via aria-checked (role="switch"), not isChecked.
  const isChecked = (await favoritesToggle.getAttribute('aria-checked')) === 'true';
  if (!isChecked) {
    await favoritesToggle.click();
    await page.waitForTimeout(300);
  }
});

When('I disable favorites only filter', async ({ page }) => {
  const favoritesToggle = page.getByTestId('events-favorites-toggle');
  await favoritesToggle.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

  const isChecked = (await favoritesToggle.getAttribute('aria-checked')) === 'true';
  if (isChecked) {
    await favoritesToggle.click();
    await page.waitForTimeout(300);
  }
});

When('I toggle the archived-only filter', async ({ page }) => {
  const toggle = page.getByTestId('events-archived-toggle');
  await toggle.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

When('I select the first available tag if tags exist', async ({ page }) => {
  tagFilterApplied = false;
  // Concrete tag options are data-testid="tag-option-<id>" (the "all" option is
  // tag-option-all). Skip when the server has no tags configured.
  const tagOption = page.locator('[data-testid^="tag-option-"]:not([data-testid="tag-option-all"])').first();
  if (!(await tagOption.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false))) {
    log.info('E2E: Skipping tag filter - no tags available', { component: 'e2e' });
    return;
  }
  await tagOption.click();
  tagFilterApplied = true;
  await page.waitForTimeout(300);
});

Then('I should see only tagged events if a tag was applied', async ({ page }) => {
  if (!tagFilterApplied) {
    log.info('E2E: Skipping tagged-events check - no tag was applied', { component: 'e2e' });
    return;
  }

  const eventCards = page.getByTestId('event-card');
  const emptyState = page.getByTestId('events-empty-state');

  // The tag filter is applied server-side (refs #205), so the list settles into
  // either tagged events or an empty state, never a partial/stuck list.
  await expect
    .poll(async () => {
      const count = await eventCards.count();
      const emptyVisible = await emptyState.isVisible().catch(() => false);
      return count > 0 || emptyVisible;
    }, { timeout: testConfig.timeouts.transition * 3 })
    .toBeTruthy();

  // When events come back, every one of them must carry a tag chip: a tag filter
  // that returned untagged events would mean the filter did not actually apply.
  const count = await eventCards.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      await expect(eventCards.nth(i).getByTestId('tag-chip').first()).toBeVisible({
        timeout: testConfig.timeouts.transition * 3,
      });
    }
  }
});

// Relative-time chip assertion (refs #210)
Then('any relative time labels in the list read as a duration', async ({ page }) => {
  // Wait for the list to settle: either cards rendered or empty state visible.
  const eventCards = page.getByTestId('event-card');
  const emptyState = page.getByTestId('events-empty-state');

  await expect.poll(async () => {
    const count = await eventCards.count();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    return count > 0 || emptyVisible;
  }, { timeout: testConfig.timeouts.transition * 3 }).toBeTruthy();

  const cardCount = await eventCards.count();
  if (cardCount === 0) {
    log.info('E2E: Skipping relative-time check - no event cards (empty state)', { component: 'e2e' });
    return;
  }

  // Cards are present. This test runs against a live server that records continuously,
  // so events within the 7-day chip window must exist. Missing chips while cards are
  // present is a rendering regression that the test must catch.
  const chips = page.getByTestId('event-relative-time');
  const chipCount = await chips.count();
  expect(chipCount).toBeGreaterThan(0);

  // Assert the first chip is visible and shows a recognisable relative-time string.
  // Pattern covers Intl.RelativeTimeFormat narrow output ("ago", "vor", "hace", "il y a", "前")
  // and the app's now translations across all 7 supported languages:
  // en: "now", de: "jetzt", es: "ahora", fr: "maintenant", it: "ora", ru: "сейчас", zh: "现在".
  const relativeTimePattern = /(ago|vor|hace|il y a|ora|назад|сейчас|前|now|jetzt|ahora|maintenant|现在)/i;
  const firstChip = chips.first();
  await expect(firstChip).toBeVisible();
  const text = await firstChip.innerText();
  expect(text.trim()).not.toBe('');
  expect(text).toMatch(relativeTimePattern);
});

Then('any relative time labels in the montage read as a duration', async ({ page }) => {
  const grid = page.getByTestId('events-montage-grid');
  const emptyState = page.getByTestId('events-empty-state');
  const tiles = grid.getByTestId('event-montage-tile');

  // Wait for the montage to settle: tiles rendered or the empty state shown.
  await expect.poll(async () => {
    const count = await tiles.count();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    return count > 0 || emptyVisible;
  }, { timeout: testConfig.timeouts.transition * 3 }).toBeTruthy();

  const tileCount = await tiles.count();
  if (tileCount === 0) {
    log.info('E2E: Skipping montage relative-time check - no event tiles', { component: 'e2e' });
    return;
  }

  // Same reasoning as the list: the live server records continuously, so events
  // within the 7-day window exist. Missing chips while tiles are present is a
  // rendering regression the test must catch.
  const chips = page.getByTestId('event-montage-relative-time');
  expect(await chips.count()).toBeGreaterThan(0);

  const relativeTimePattern = /(ago|vor|hace|il y a|前|now|jetzt|ahora|maintenant|现在)/i;
  const firstChip = chips.first();
  await expect(firstChip).toBeVisible();
  const text = await firstChip.innerText();
  expect(text.trim()).not.toBe('');
  expect(text).toMatch(relativeTimePattern);
});

When('I favorite the event from detail page if on detail page', async ({ page }) => {
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping favorite from detail - no events exist', { component: 'e2e' });
    return;
  }

  // The server has events, so the earlier "I click into the first event if
  // events exist" step navigated here and waited for the /events/:id URL, so
  // we are genuinely on the detail page and its favorite button must exist.
  // Same reasoning as the sibling detail-archive step: swallowing a missing
  // button behind isVisible().catch() masked a real rendering regression as
  // "nothing to do here" - assert it hard instead.
  const favoriteButton = page.getByTestId('event-detail-favorite-button');
  await expect(favoriteButton).toBeVisible({ timeout: testConfig.timeouts.element });
  await favoriteButton.click();
  detailFavoriteToggled = true;
  await page.waitForTimeout(700);
});

Then('I should see the detail favorite button active if action was taken', async ({ page }) => {
  if (!detailFavoriteToggled) return;
  const favoriteButton = page.getByTestId('event-detail-favorite-button');
  const icon = favoriteButton.locator('svg').first();
  await expect(icon).toHaveClass(/fill-current/);
});

Then('I should see the detail favorite button inactive if action was taken', async ({ page }) => {
  if (!detailFavoriteToggled) return;
  const favoriteButton = page.getByTestId('event-detail-favorite-button');
  const icon = favoriteButton.locator('svg').first();
  await expect(icon).not.toHaveClass(/fill-current/);
});

// Event Detail Steps
Then('I should see event detail elements if on detail page', async ({ page }) => {
  if (!(await serverHasEvents())) {
    log.info('E2E: Skipping event detail check - no events exist', { component: 'e2e' });
    return;
  }

  // Check for common event detail elements
  const videoPlayer = page.getByTestId('video-player').or(page.locator('video'));
  const favoriteBtn = page.getByTestId('event-detail-favorite-button');
  const downloadBtn = page.getByTestId('download-video-button');

  // At least one of these should be visible
  const hasVideo = await videoPlayer.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false);
  const hasFavorite = await favoriteBtn.isVisible({ timeout: 500 }).catch(() => false);
  const hasDownload = await downloadBtn.isVisible({ timeout: 500 }).catch(() => false);

  expect(hasVideo || hasFavorite || hasDownload).toBeTruthy();
  log.info('E2E: Event detail elements visible', { component: 'e2e', hasVideo, hasFavorite, hasDownload });
});

// Downloads & Background Tasks
When('I click the download video button if video exists', async ({ page }) => {
  downloadClicked = false;
  const downloadButton = page.getByTestId('download-video-button');
  // Visibility is the genuinely conditional part (no video on this event);
  // once visible, addTask() runs synchronously on click, so the follow-up
  // "Then" step's poll for the drawer replaces the need for a blind sleep here.
  const isVisible = await downloadButton.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false);
  if (isVisible) {
    await downloadButton.click();
    downloadClicked = true;
  } else {
    log.info('E2E: Skipping download click - button not visible (no video)', { component: 'e2e' });
  }
});

When('I download snapshot from first event in montage', async ({ page }) => {
  downloadClicked = false;
  const downloadButton = page.getByTestId('event-download-button').first();
  const isVisible = await downloadButton.isVisible({ timeout: testConfig.timeouts.element }).catch(() => false);
  if (isVisible) {
    await downloadButton.hover();
    await downloadButton.click();
    downloadClicked = true;
  } else {
    log.info('E2E: Skipping snapshot download - button not visible', { component: 'e2e' });
  }
});

Then('I should see the background task drawer if download was triggered', async ({ page }) => {
  // Only check if we actually clicked a download button
  if (!downloadClicked) {
    log.info('E2E: Skipping drawer check - no download button was clicked', { component: 'e2e' });
    return;
  }

  // Drawer can be in badge, collapsed, or expanded state. addTask() runs
  // synchronously in the click handler (src/services/download.ts) before any
  // network request, so once the button was clicked the drawer must appear -
  // a missing drawer here is a real regression, not a timing fluke to shrug off.
  const drawer = page.locator('[data-testid="background-tasks-drawer"], [data-testid="background-tasks-collapsed"], [data-testid="background-tasks-badge"]');
  await expect(drawer.first()).toBeVisible({ timeout: testConfig.timeouts.transition * 2 });
  log.info('E2E: Background task drawer visible', { component: 'e2e' });
});

// Event frame carousel (#272). Every stored event has a snapshot frame, so the
// card must appear for any event the server has; the only genuine skip is a
// server with no events at all, which serverHasEvents() answers from the API.
Then('I should see the event frames carousel if events exist', async ({ page }) => {
  if (!(await serverHasEvents())) return;
  await expect(page.getByTestId('event-frames-card')).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I open the first event frame if events exist', async ({ page }) => {
  if (!(await serverHasEvents())) return;
  await page.locator('[data-testid^="event-frame-thumb-"]').first().click();
});

Then('I should see the full-size event frame if events exist', async ({ page }) => {
  if (!(await serverHasEvents())) return;
  await expect(page.getByTestId('event-frame-viewer-image')).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I close the full-size event frame if events exist', async ({ page }) => {
  if (!(await serverHasEvents())) return;
  await page.getByTestId('dialog-close-button').click();
});

Then('the full-size event frame is gone if events exist', async ({ page }) => {
  if (!(await serverHasEvents())) return;
  await expect(page.getByTestId('event-frame-viewer-image')).toBeHidden({ timeout: testConfig.timeouts.element });
});

/** The event detail page scrolls its own container, not the app shell's main. */
function eventDetailScroller(page: Page) {
  return page.locator('[data-testid="event-detail-scroller"]');
}

When('I show the scroll pad on the event', async ({ page }) => {
  await page.getByTestId('scroll-pad-toggle').click();
  await expect(page.getByTestId('scroll-pad')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

When('I tap the event scroll pad down button', async ({ page }) => {
  await eventDetailScroller(page).evaluate((el) => el.scrollTo({ top: 0 }));
  await page.getByTestId('scroll-down').click();
});

Then('the event detail should have scrolled down', async ({ page }) => {
  // The pad walks up from what it is pointed at, so aiming it at an element
  // with no scrolling ancestor left every button doing nothing (refs #365).
  await expect
    .poll(() => eventDetailScroller(page).evaluate((el) => el.scrollTop), {
      timeout: testConfig.timeouts.element,
    })
    .toBeGreaterThan(0);
});

