import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { MONTAGE_GRID } from '../../src/lib/zmninja-ng-constants';
import { openProfileRowMenu } from './profiles.steps';

const { When, Then } = createBdd();

/**
 * Asserts the event list has stopped changing before a step counts cards.
 *
 * The events query can resolve into more than one render pass (a cached
 * page, then the network response), so a bare "count > 0" check can fire on
 * a partial render - exactly what made the merged-events scenario flaky:
 * the single-profile capture and the All-mode read each grabbed a card
 * count mid-fetch instead of the settled one. Polls the card count until it
 * reads the SAME non-zero value twice in a row (each read spaced by
 * expect.poll's own retry interval - no waitForTimeout, per repo rule).
 */
async function assertEventListSettled(page: Page): Promise<void> {
  const eventCards = page.getByTestId('event-card');
  let lastCount = -1;
  let stableReads = 0;
  await expect.poll(async () => {
    const count = await eventCards.count();
    stableReads = count > 0 && count === lastCount ? stableReads + 1 : 0;
    lastCount = count;
    return stableReads >= 2;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
}

// Captured on the single-profile Monitors view before switching to All mode,
// so the aggregation scenario can assert an outcome (2x) instead of a
// hardcoded count. Module-scoped like the other step files' scenario state
// (see profiles.steps.ts); each scenario re-runs the Background, so no
// cross-scenario carryover is relied on here.
let singleProfileMonitorCount = 0;
// Same pattern as singleProfileMonitorCount above, for the merged-events
// scenario. Captured on the single-profile Events view before switching to
// All mode.
let singleProfileEventCount = 0;

/**
 * Points a newly-created profile at the SAME real test server as the
 * Background's profile - what makes "All mode aggregates N profiles"
 * observable without a second real ZM instance.
 */
async function addProfilePointingAtSameServer(page: Page, name: string): Promise<void> {
  await page.getByTestId('profiles-add-button').click();
  await expect(page.getByTestId('setup-profile-name')).toBeVisible({ timeout: testConfig.timeouts.element });
  await page.getByTestId('setup-profile-name').fill(name);

  const { host, username, password } = testConfig.server;
  const portalInput = page.getByTestId('setup-portal-url');
  await portalInput.clear();
  await portalInput.fill(host);
  if (username) await page.getByTestId('setup-username').fill(username);
  if (password) await page.getByTestId('setup-password').fill(password);

  await page.getByTestId('connect-button').click();
  // Discovery + login against the real server, then a 1s delay before nav
  // back to the page that opened this form (ProfileForm.tsx handleSubmit).
  await page.waitForURL((url) => !url.pathname.includes('/profiles/new'), {
    timeout: testConfig.timeouts.pageLoad,
  }).catch(() => {
    // The assertion below is the real source of truth if navigation didn't fire.
  });
  await expect(page.locator('[data-testid="profile-card"]').filter({ hasText: name })).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
}

When('I add a second profile named {string} pointing at the same server', async ({ page }, name: string) => {
  await addProfilePointingAtSameServer(page, name);
});

// Same helper as the Background's "second profile" step above, under a name
// that reads naturally when a scenario adds a THIRD profile (refs #337).
When('I add a profile named {string} pointing at the same server', async ({ page }, name: string) => {
  await addProfilePointingAtSameServer(page, name);
});

When('I add a profile named {string} with an unreachable server', async ({ page }, name: string) => {
  await page.getByTestId('profiles-add-button').click();
  await expect(page.getByTestId('setup-profile-name')).toBeVisible({ timeout: testConfig.timeouts.element });
  await page.getByTestId('setup-profile-name').fill(name);

  // Manual URL entry with no credentials skips both discoverUrls() and the
  // login call in ProfileForm.handleTestConnection, so the "Add" click below
  // never actually probes this host - the profile saves immediately even
  // though nothing is listening on it. The automatic post-add profile
  // switch that follows swallows every bootstrap network error internally
  // (src/services/profile-bootstrap.ts catches per-step), so it never blocks
  // the return navigation either. This is the only UI path that can create
  // an unreachable profile without a real second server.
  const unreachable = 'http://127.0.0.1:9';
  await page.getByTestId('setup-portal-url').fill(unreachable);
  await page.getByTestId('setup-manual-urls-toggle').click();
  await page.getByTestId('setup-api-url').fill(`${unreachable}/api`);
  await page.getByTestId('setup-cgi-url').fill(`${unreachable}/cgi-bin`);

  await page.getByTestId('connect-button').click();
  await page.waitForURL((url) => !url.pathname.includes('/profiles/new'), {
    timeout: testConfig.timeouts.pageLoad,
  }).catch(() => {
    // The assertion below is the real source of truth if navigation didn't fire.
  });
  await expect(page.locator('[data-testid="profile-card"]').filter({ hasText: name })).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
});

Then('I record the single-profile monitor card count', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  singleProfileMonitorCount = await page.getByTestId('monitor-card').count();
});

// refs #337: per-profile disable toggle. Same button drives both directions -
// clicking it again on an already-disabled profile re-enables it.
When('I disable the {string} profile', async ({ page }, name: string) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: name });
  await openProfileRowMenu(card);
  await page.locator('[data-testid^="profile-disable-toggle-"]').click();
  await expect(card.getByTestId('profile-disabled-badge')).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I enable the {string} profile', async ({ page }, name: string) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: name });
  await openProfileRowMenu(card);
  await page.locator('[data-testid^="profile-disable-toggle-"]').click();
  await expect(card.getByTestId('profile-disabled-badge')).toHaveCount(0, { timeout: testConfig.timeouts.element });
});

Then('I should be on the monitors page', async ({ page }) => {
  await expect(page).toHaveURL(/\/monitors$/, { timeout: testConfig.timeouts.transition });
});

Then('I should see a monitor profile chip on every monitor card', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const cardCount = await page.getByTestId('monitor-card').count();
  const chipCount = await page.getByTestId('monitor-profile-chip').count();
  expect(chipCount).toBe(cardCount);
});

Then('the monitor card count should be double the recorded single-profile count', async ({ page }) => {
  expect(singleProfileMonitorCount).toBeGreaterThan(0);
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileMonitorCount * 2);
});

// A one-member group aggregates one server's worth of monitors: the same
// count single mode showed, not the doubled All-mode one (refs #337).
Then('the monitor card count should match the recorded single-profile count', async ({ page }) => {
  expect(singleProfileMonitorCount).toBeGreaterThan(0);
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileMonitorCount);
});

Then('I should see a profile error strip for {string}', async ({ page }, name: string) => {
  await expect(
    page.locator('[data-testid^="profile-error-strip-"]').filter({ hasText: name })
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('I should see monitor cards from the healthy profiles', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
});

Then('I record the single-profile event card count', async ({ page }) => {
  await assertEventListSettled(page);
  singleProfileEventCount = await page.getByTestId('event-card').count();
});

When('I turn on grouping events by server', async ({ page }) => {
  const toggle = page.getByTestId('events-group-by-server');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

// The outcome is a partition: every card the flat list showed is still on the
// page, each one under the heading of the server it came from. Reading each
// section's own profile chips against its heading catches a section that
// renders the right count of the wrong server's events (refs #501).
Then('every event card sits in its own server section', async ({ page }) => {
  await assertEventListSettled(page);
  const sections = page.locator('[data-testid^="events-group-section-"]');
  await expect.poll(async () => sections.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(1);

  const totalCards = await page.getByTestId('event-card').count();
  const headings = new Set<string>();
  let cardsInSections = 0;
  for (const section of await sections.all()) {
    const heading = (await section.locator('h2').first().textContent())?.trim() ?? '';
    expect(heading).not.toBe('');
    headings.add(heading);
    const sectionCards = await section.getByTestId('event-card').count();
    expect(sectionCards).toBeGreaterThan(0);
    cardsInSections += sectionCards;
    const chips = await section.getByTestId('event-profile-chip').allTextContents();
    expect(new Set(chips.map((chip) => chip.trim()))).toEqual(new Set([heading]));
  }
  expect(cardsInSections).toBe(totalCards);
  expect(headings.size).toBe((await sections.count()));
});

Then('I should see an event profile chip on every event card', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('event-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const cardCount = await page.getByTestId('event-card').count();
  const chipCount = await page.getByTestId('event-profile-chip').count();
  expect(chipCount).toBe(cardCount);
});

// Both Background profiles point at the same real server, so the merged list
// is exactly 2x in principle - but unlike the monitors scenario's static
// count, live event counts can drift between the single-profile capture
// above and this aggregate read (a new motion event recorded server-side in
// between). Asserting >= keeps the outcome real (aggregation actually ran,
// chips present) without flaking on that drift. The count alone can't catch
// a broken aggregation that silently returns only one profile's events (that
// still satisfies >=): also require at least 2 DISTINCT profile-chip texts,
// so both Background profiles are provably represented (refs #337 I11).
Then('the event card count should be at least the recorded single-profile count', async ({ page }) => {
  expect(singleProfileEventCount).toBeGreaterThan(0);
  await assertEventListSettled(page);
  await expect.poll(async () => page.getByTestId('event-card').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThanOrEqual(singleProfileEventCount);

  // A one-shot snapshot here can fire before the slower of the two
  // profiles' event queries has contributed to the DOM: the total card
  // count settling (above) only means it stopped changing, not that BOTH
  // profiles are represented yet. Polled with its own generous timeout so
  // a late-arriving second profile still gets counted (refs #337 round 3).
  await expect.poll(async () => {
    const chipTexts = await page.getByTestId('event-profile-chip').allTextContents();
    return new Set(chipTexts).size;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(2);
});

When('I click a monitor card', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('monitor-player').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  await page.getByTestId('monitor-player').first().click();
});

Then('the URL should match the all-mode monitor detail route', async ({ page }) => {
  await expect(page).toHaveURL(/\/all\/monitors\/[^/]+\/[^/]+$/, { timeout: testConfig.timeouts.transition });
});

Then('the profile switcher should still show the group', async ({ page }) => {
  await expect(page.getByTestId('profile-switcher-trigger')).toHaveText(/Everything/, {
    timeout: testConfig.timeouts.element,
  });
});

// Captured on the single-profile Montage view before switching to All mode,
// same pattern as singleProfileMonitorCount above.
let singleProfileMontageTileCount = 0;

Then('I record the single-profile montage tile count', async ({ page }) => {
  // Excludes the nested montage-monitor-media testid inside each tile, which
  // also matches this prefix (refs #337 round 1 - caught by this scenario).
  const tiles = page.locator('[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])');
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  singleProfileMontageTileCount = await tiles.count();
});

Then('I should see a monitor profile chip on every montage tile', async ({ page }) => {
  // Excludes the nested montage-monitor-media testid inside each tile, which
  // also matches this prefix (refs #337 round 1 - caught by this scenario).
  const tiles = page.locator('[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])');
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const tileCount = await tiles.count();
  const chipCount = await page.getByTestId('montage-profile-chip').count();
  expect(chipCount).toBe(tileCount);
});

Then('the montage tile count should be double the recorded single-profile count', async ({ page }) => {
  expect(singleProfileMontageTileCount).toBeGreaterThan(0);
  // Excludes the nested montage-monitor-media testid inside each tile, which
  // also matches this prefix (refs #337 round 1 - caught by this scenario).
  const tiles = page.locator('[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])');
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileMontageTileCount * 2);
});

// Events montage view, All mode (refs #337 Phase 4 Task 6): the gate that
// used to block montage view in All mode is gone (refs #337 e74d02b4);
// this is a regression check that it stays gone AND that tiles actually
// render (not just an absent-gate false-positive).
Then('event montage tiles should render with no gate notice', async ({ page }) => {
  await expect.poll(async () => page.getByTestId('event-montage-tile').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  await expect(page.getByTestId('events-montage-gate')).toHaveCount(0);
});

// Captured on the single-profile Live Activity view before switching to All
// mode, same pattern as singleProfileMonitorCount above. Alarm states can't
// be forced against the live test server (no e2e hook fires a real motion
// event), so this scenario can only assert page structure and the watched
// COUNT, not that any tile actually renders - the watched count is only
// visible in the all-quiet empty state's "Watching N monitors" copy, so the
// scenario depends on the server being quiet, same as live-activity.feature's
// own all-quiet scenario.
let singleProfileLiveActivityWatchedCount = 0;

async function readLiveActivityWatchedCount(page: Page): Promise<number> {
  const empty = page.getByTestId('live-activity-empty');
  await expect(empty).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  const text = await empty.innerText();
  const match = text.match(/Watching (\d+) monitors?/i);
  expect(match, `expected a "Watching N monitor(s)" count in: ${text}`).not.toBeNull();
  return Number(match![1]);
}

Then('I record the single-profile Live Activity watched count', async ({ page }) => {
  singleProfileLiveActivityWatchedCount = await readLiveActivityWatchedCount(page);
  expect(singleProfileLiveActivityWatchedCount).toBeGreaterThan(0);
});

// The gate that used to block All mode is gone (refs #337, #341, e74d02b4
// precedent): this is a regression check that it stays gone AND that the
// page renders something real (tiles or the quiet state), not just an
// absent-gate false-positive.
Then('Live Activity should render with no gate notice', async ({ page }) => {
  await expect(page.getByTestId('live-activity-all-mode-notice')).toHaveCount(0);
  await expect(
    page.getByTestId('live-activity-empty').or(page.getByTestId('live-activity-tile'))
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('the Live Activity watched count should be double the recorded single-profile count', async ({ page }) => {
  expect(singleProfileLiveActivityWatchedCount).toBeGreaterThan(0);
  await expect.poll(async () => readLiveActivityWatchedCount(page), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(singleProfileLiveActivityWatchedCount * 2);
});

Then('I should see the page profile picker', async ({ page }) => {
  await expect(page.getByTestId('page-profile-picker')).toBeVisible({ timeout: testConfig.timeouts.element });
});

/**
 * The ZM API takes its session token as a `token=` query param, not a header
 * (see app/src/api/client.ts appendQuery) - reading it back out of the
 * request URL is the one truly per-profile-distinguishable signal available
 * here: both Background profiles point at the SAME real test server, so the
 * fetched log CONTENT is identical between them and can't be diffed. Each
 * profile still logs in independently, so its token differs - proving the
 * query actually refired for the newly-picked profile rather than reusing a
 * stale response.
 */
function extractToken(url: string): string | null {
  return new URL(url).searchParams.get('token');
}

let firstLogsRequestToken: string | null = null;
let secondLogsRequestToken: string | null = null;
let pickedLogsProfileText = '';

When('I switch the Logs page to the ZM server log source', async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().includes('/logs.json'), { timeout: testConfig.timeouts.pageLoad }),
    page.getByTestId('log-source-server').click(),
  ]);
  firstLogsRequestToken = extractToken(response.url());
  await expect(
    page.getByTestId('logs-list').or(page.getByTestId('logs-empty-state'))
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

// Picks whichever picker option ISN'T the currently-displayed profile, so
// this doesn't depend on which of the two Background profiles the page
// happens to default to.
When('I pick a different profile in the Logs page picker', async ({ page }) => {
  const picker = page.getByTestId('page-profile-picker');
  const currentText = (await picker.innerText()).trim();
  await picker.click();
  const options = page.locator('[data-testid^="page-profile-picker-option-"]');
  await expect.poll(async () => options.count(), {
    timeout: testConfig.timeouts.element,
  }).toBeGreaterThan(0);
  const texts = (await options.allTextContents()).map((text) => text.trim());
  const target = texts.find((text) => text !== currentText);
  expect(target).toBeTruthy();
  pickedLogsProfileText = target as string;

  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().includes('/logs.json'), { timeout: testConfig.timeouts.pageLoad }),
    options.filter({ hasText: pickedLogsProfileText }).click(),
  ]);
  secondLogsRequestToken = extractToken(response.url());
});

Then('the Logs page picker should show the newly picked profile', async ({ page }) => {
  expect(pickedLogsProfileText).toBeTruthy();
  await expect(page.getByTestId('page-profile-picker')).toHaveText(pickedLogsProfileText, {
    timeout: testConfig.timeouts.element,
  });
});

Then('the logs query should have refired with a different access token', async () => {
  expect(firstLogsRequestToken).toBeTruthy();
  expect(secondLogsRequestToken).toBeTruthy();
  expect(secondLogsRequestToken).not.toBe(firstLogsRequestToken);
});

Then('I should see a notification overview row for every profile', async ({ page }) => {
  await expect.poll(async () => page.locator('[data-testid^="notification-overview-row-"]').count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThanOrEqual(2);
});

// Both Background profiles point at the same real server, so a host or
// query-param diff (the Logs picker's proof-of-switch signal) isn't
// available here - the overview row's own active marker is the strongest
// assertable outcome. Clicks whichever row ISN'T currently marked active.
let clickedOverviewRowTestId = '';

When("I click a different profile's notification overview row", async ({ page }) => {
  const rows = page.locator('[data-testid^="notification-overview-row-"]');
  await expect.poll(async () => rows.count(), { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(2);

  const activeTestId = await page
    .locator('[data-testid^="notification-overview-row-"][aria-current="true"]')
    .getAttribute('data-testid');

  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const testId = await rows.nth(i).getAttribute('data-testid');
    if (testId !== activeTestId) {
      clickedOverviewRowTestId = testId as string;
      await rows.nth(i).click();
      break;
    }
  }
  expect(clickedOverviewRowTestId).toBeTruthy();
});

Then('that row should be marked as the active profile', async ({ page }) => {
  expect(clickedOverviewRowTestId).toBeTruthy();
  await expect(page.getByTestId(clickedOverviewRowTestId)).toHaveAttribute('aria-current', 'true', {
    timeout: testConfig.timeouts.element,
  });
});

// All-mode montage visibility (refs #337). Both Background profiles point at
// the same server, so every raw monitor id exists twice - the exact collision
// the composite profileId:monitorId tile id exists to keep apart. Hiding one
// server's entry must leave the other server's copy of the same monitor on
// screen.
const VISIBILITY_ENTRY =
  '[data-testid^="montage-visibility-"]:not([data-testid^="montage-visibility-chip-"])';

let hiddenEntryTileId = '';
let siblingTileTestId = '';

Then('every montage show-monitors entry should name its owning server', async ({ page }) => {
  const entries = page.locator(VISIBILITY_ENTRY);
  await expect.poll(async () => entries.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  const chips = page.locator('[data-testid^="montage-visibility-chip-"]');
  expect(await chips.count()).toBe(await entries.count());
  // A chip that renders empty would still count above, so read one.
  await expect(chips.first()).not.toBeEmpty();
});

When('I hide the first montage show-monitors entry', async ({ page }) => {
  const entry = page.locator(VISIBILITY_ENTRY).first();
  await expect(entry).toHaveAttribute('data-state', 'checked', {
    timeout: testConfig.timeouts.element,
  });
  const testId = await entry.getAttribute('data-testid');
  if (!testId) throw new Error('First show-monitors entry has no data-testid');
  hiddenEntryTileId = testId.replace('montage-visibility-', '');

  // The other server's tile for the same raw monitor id: same ":<monitorId>"
  // suffix, different profile prefix.
  //
  // This looks in the GRID, so it only finds a twin the stream cap actually
  // rendered. The scenario runs at the shipped cap with two small fixture
  // servers, so every tile is on screen; if that ever stops being true the
  // toBeVisible below fails loudly rather than the scenario passing while
  // asserting nothing.
  const rawMonitorId = hiddenEntryTileId.split(':').pop();
  const sibling = page
    .locator(
      `[data-testid^="montage-monitor-"][data-testid$=":${rawMonitorId}"]` +
        `:not([data-testid="montage-monitor-${hiddenEntryTileId}"])`
    )
    .first();
  await expect(sibling).toBeVisible({ timeout: testConfig.timeouts.element });
  siblingTileTestId = (await sibling.getAttribute('data-testid')) as string;
  expect(siblingTileTestId).not.toBe(`montage-monitor-${hiddenEntryTileId}`);

  await entry.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I show the hidden montage show-monitors entry again', async ({ page }) => {
  const entry = page.getByTestId(`montage-visibility-${hiddenEntryTileId}`);
  await expect(entry).toHaveAttribute('data-state', 'unchecked', {
    timeout: testConfig.timeouts.element,
  });
  await entry.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

Then("that entry's tile should be gone from the montage grid", async ({ page }) => {
  await expect(page.getByTestId(`montage-monitor-${hiddenEntryTileId}`)).toHaveCount(0, {
    timeout: testConfig.timeouts.element,
  });
});

Then("the other server's tile for the same monitor should still be there", async ({ page }) => {
  expect(siblingTileTestId).toBeTruthy();
  await expect(page.getByTestId(siblingTileTestId)).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

Then("that entry's tile should be back in the montage grid", async ({ page }) => {
  await expect(page.getByTestId(`montage-monitor-${hiddenEntryTileId}`)).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

// Hiding every monitor used to strand the user: the page fell through to an
// empty state with no toolbar, so the list that would bring the tiles back
// was gone (refs #337).
When('I hide every montage show-monitors entry', async ({ page }) => {
  const entries = page.locator(VISIBILITY_ENTRY);
  const count = await entries.count();
  expect(count).toBeGreaterThan(0);
  // The menu stays open across selections (each entry preventDefaults its
  // select), so every entry can be unchecked in one pass.
  for (let i = 0; i < count; i++) {
    const entry = entries.nth(i);
    if ((await entry.getAttribute('data-state')) === 'checked') await entry.click();
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

When('I show the first hidden montage show-monitors entry', async ({ page }) => {
  const entry = page.locator(`${VISIBILITY_ENTRY}[data-state="unchecked"]`).first();
  await expect(entry).toBeVisible({ timeout: testConfig.timeouts.element });
  await entry.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

Then('the montage grid should show no tiles', async ({ page }) => {
  const tiles = page.locator(
    '[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])'
  );
  await expect.poll(async () => tiles.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(0);
  // The toolbar has to survive, or the kebab that un-hides them is gone.
  await expect(page.getByTestId('montage-kebab-menu')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

// All-mode montage view controls (refs #337). These write the ALL settings
// bucket rather than a single profile's, which is only observable through the
// control's own state surviving a reload while aggregating.
/** Feed fit moved into the montage kebab menu (refs #365 follow-up). */
async function openMontageKebab(page: Page) {
  const trigger = page.getByTestId('montage-kebab-menu');
  // Keyboard: Radix leaves a dismissable layer over the page for a beat after
  // the menu closes, and a click there never reaches the trigger.
  await trigger.focus();
  await trigger.press('Enter');
}

When('I set the montage fit to {string}', async ({ page }, label: string) => {
  await openMontageKebab(page);
  const option = label === 'Fit'
    ? page.getByTestId('montage-fit-contain')
    : page.getByTestId('montage-fit-cover');
  await expect(option).toBeVisible({ timeout: testConfig.timeouts.element });
  await option.click();
});

Then('the montage fit should be {string}', async ({ page }, label: string) => {
  await openMontageKebab(page);
  const chosen = label === 'Fit'
    ? page.getByTestId('montage-fit-contain')
    : page.getByTestId('montage-fit-cover');
  await expect(chosen).toHaveAttribute('aria-checked', 'true', {
    timeout: testConfig.timeouts.element,
  });
  await page.keyboard.press('Escape');
});

Then('the montage edit-layout control should be available', async ({ page }) => {
  await expect(page.getByTestId('montage-edit-toggle')).toBeEnabled({
    timeout: testConfig.timeouts.element,
  });
});

// The aggregate Streaming Mode tri-state lives in virtual-profiles.steps.ts,
// with the rest of the steps that drive whichever aggregate is current.

// Aggregate performance (refs #337). The knobs that used to be constants:
// what proves one is wired is the aggregate surface changing, so this drives
// the montage stream cap down to a single tile and back. The number field
// commits on Enter (or blur), never per keystroke, so the step presses it.
const MONTAGE_TILES =
  '[data-testid^="montage-monitor-"]:not([data-testid="montage-monitor-media"])';

When(
  'I set the aggregate maximum live streams to {string}',
  async ({ page }, value: string) => {
    const input = page.getByTestId('all-mode-max-streams-input');
    await expect(input).toBeVisible({ timeout: testConfig.timeouts.element });
    await input.fill(value);
    await input.press('Enter');
  }
);

Then(
  'the aggregate maximum live streams should be {string}',
  async ({ page }, value: string) => {
    await expect(page.getByTestId('all-mode-max-streams-input')).toHaveValue(value, {
      timeout: testConfig.timeouts.element,
    });
  }
);

When('I reset the aggregate maximum live streams', async ({ page }) => {
  const reset = page.getByTestId('all-mode-max-streams-reset');
  await expect(reset).toBeVisible({ timeout: testConfig.timeouts.element });
  await reset.click();
});

Then(
  'the aggregate maximum live streams should be back to the shipped default',
  async ({ page }) => {
    // The constant, not a number typed into the feature file: the row's
    // default IS MONTAGE_GRID.allModeMaxStreams, so changing that constant
    // must not quietly leave this scenario asserting a stale value.
    await expect(page.getByTestId('all-mode-max-streams-input')).toHaveValue(
      String(MONTAGE_GRID.allModeMaxStreams),
      { timeout: testConfig.timeouts.element }
    );
    // The reset control goes away once the row matches its default.
    await expect(page.getByTestId('all-mode-max-streams-reset')).toHaveCount(0, {
      timeout: testConfig.timeouts.element,
    });
  }
);

Then('the montage grid should show exactly {int} tile', async ({ page }, count: number) => {
  await expect.poll(async () => page.locator(MONTAGE_TILES).count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(count);
});

// The budget is shared out per server, so a cap smaller than one server's
// monitor list must still leave every server on screen. Asserting the profile
// chips rather than the tile ids: the chip is what a user reads to tell whose
// camera a tile is. Both e2e profiles point at the same server, so this
// discriminates whenever that server has more than one monitor; the split
// arithmetic itself is covered in Montage.test.tsx and stream-budget.test.ts.
Then('the montage tiles should come from more than one server', async ({ page }) => {
  await expect
    .poll(
      async () => {
        const chips = await page
          .locator(`${MONTAGE_TILES} [data-testid="montage-profile-chip"]`)
          .allTextContents();
        return new Set(chips.map((chip) => chip.trim())).size;
      },
      { timeout: testConfig.timeouts.pageLoad }
    )
    .toBeGreaterThan(1);
});

Then('the montage stream cap overflow notice should be visible', async ({ page }) => {
  await expect(page.getByTestId('montage-stream-cap-overflow')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

Then('the montage stream cap overflow notice should be gone', async ({ page }) => {
  await expect(page.getByTestId('montage-stream-cap-overflow')).toHaveCount(0, {
    timeout: testConfig.timeouts.pageLoad,
  });
});

// Events filter persistence in All mode (refs #337). The filter hooks write
// the ALL settings bucket, which is only observable as the control coming
// back set after a reload - in All mode there is no current profile whose
// bucket could have held it instead.
Then('the favorites-only filter should be {string}', async ({ page }, state: string) => {
  await expect(page.getByTestId('events-favorites-toggle')).toHaveAttribute(
    'aria-checked',
    state === 'on' ? 'true' : 'false',
    { timeout: testConfig.timeouts.element },
  );
});

// Command palette in All mode (refs #337, audit C12). The e2e's second
// profile points at the SAME server, so both profiles carry identical monitor
// names and identical monitor ids - exactly the collision the palette has to
// keep apart.
let recordedMonitorName = '';

When('I record the first monitor name', async ({ page }) => {
  const names = page.getByTestId('monitor-name');
  await expect.poll(async () => names.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThan(0);
  recordedMonitorName = (await names.first().textContent())?.trim() ?? '';
  expect(recordedMonitorName).not.toBe('');
});

When('I type the recorded monitor name into the command palette', async ({ page }) => {
  await page.getByTestId('command-palette-input').fill(recordedMonitorName);
});

Then('the palette should list that monitor once per server, each labelled with its server', async ({ page }) => {
  const rows = page.locator('[data-testid^="command-item-monitor-"]');
  await expect.poll(async () => rows.count(), {
    timeout: testConfig.timeouts.pageLoad,
  }).toBeGreaterThanOrEqual(2);

  // Every row names the monitor, and one of them is labelled "Second" - the
  // profile added in the Background. The palette used to list no monitors at
  // all in All mode, and a bare monitor id would have collapsed the two
  // servers' identical ids into a single row.
  const texts = await rows.allTextContents();
  for (const text of texts) {
    expect(text).toContain(recordedMonitorName);
  }
  expect(texts.some((t) => t.includes('Second'))).toBe(true);
  const testIds = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  expect(new Set(testIds).size).toBe(testIds.length);
});

Then('the monitor detail page should show the recorded monitor', async ({ page }) => {
  await expect(page.getByTestId('monitor-detail-name')).toHaveText(recordedMonitorName, {
    timeout: testConfig.timeouts.pageLoad,
  });
});

// Viewport gating (refs #337). A gated tile holds no connection, so it has no
// <img>: asserting one is present asserts the observer reported the tile in
// view and the page acted on it.
When('I turn aggregate off-screen tile pausing {string}', async ({ page }, state: string) => {
  const toggle = page.getByTestId('all-mode-viewport-gating-switch');
  await expect(toggle).toBeVisible({ timeout: testConfig.timeouts.element });
  const wanted = state === 'on' ? 'checked' : 'unchecked';
  if ((await toggle.getAttribute('data-state')) !== wanted) await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', wanted, {
    timeout: testConfig.timeouts.element,
  });
});

Then('aggregate off-screen tile pausing should be {string}', async ({ page }, state: string) => {
  await expect(page.getByTestId('all-mode-viewport-gating-switch')).toHaveAttribute(
    'data-state',
    state === 'on' ? 'checked' : 'unchecked',
    { timeout: testConfig.timeouts.element }
  );
});

Then('the first montage tile should be streaming', async ({ page }) => {
  await expect(
    page.locator(MONTAGE_TILES).first().locator('[data-testid="video-player-mjpeg"]')
  ).toHaveCount(1, { timeout: testConfig.timeouts.pageLoad });
});
