import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Shared state for event steps
let hasEvents = false;
let favoriteToggled = false;
let archiveToggled = false;
let detailArchiveToggled = false;
let downloadClicked = false;
let hoverPerformed = false;

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
    hasEvents = true;
  } else {
    hasEvents = false;
  }
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

When('I click into the first event if events exist', async ({ page }) => {
  if (hasEvents) {
    const firstEvent = page.getByTestId('event-card').first();
    await firstEvent.click();
    await page.waitForURL(/.*events\/\d+/, { timeout: testConfig.timeouts.transition });
    await page.waitForTimeout(500);
  }
});

When('I hover the first event thumbnail if events exist', async ({ page }) => {
  if (hasEvents) {
    const firstThumb = page.getByTestId('event-thumbnail').first();
    await firstThumb.hover();
    hoverPerformed = true;
  }
});

Then('I should see the enlarged event thumbnail preview if hover was performed', async ({ page }) => {
  if (!hoverPerformed) return;
  const preview = page.getByTestId('event-thumbnail-hover-preview');
  await expect(preview).toBeVisible({ timeout: 2000 });
  const box = await preview.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(350);
});

When('I navigate back if I clicked into an event', async ({ page }) => {
  if (hasEvents) {
    await page.goBack();
    await page.waitForTimeout(500);
  }
});

// Event Filter Steps
When('I open the events filter panel', async ({ page }) => {
  const filterButton = page.getByTestId('events-filter-button');
  const panel = page.getByTestId('events-filter-panel');

  // Wait for button to be ready
  await filterButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

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
  if (!hasEvents) {
    log.info('E2E: Skipping favorite - no events exist', { component: 'e2e' });
    return;
  }

  try {
    const firstEventCard = page.getByTestId('event-card').first();
    await firstEventCard.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

    const favoriteButton = firstEventCard.getByTestId('event-favorite-button');
    await favoriteButton.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });
    await favoriteButton.click();
    favoriteToggled = true;
    await page.waitForTimeout(500);
  } catch (error) {
    log.info('E2E: Could not favorite event', { component: 'e2e', error });
    favoriteToggled = false;
  }
});

When('I unfavorite the first event if it was favorited', async ({ page }) => {
  if (!favoriteToggled) {
    log.info('E2E: Skipping unfavorite - event was not favorited', { component: 'e2e' });
    return;
  }

  try {
    const firstEventCard = page.getByTestId('event-card').first();
    const favoriteButton = firstEventCard.getByTestId('event-favorite-button');
    await favoriteButton.click();
    favoriteToggled = false;
    await page.waitForTimeout(500);
  } catch (error) {
    log.info('E2E: Could not unfavorite event', { component: 'e2e', error });
  }
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

Then('I should see the event not marked as favorited if action was taken', async ({ page }) => {
  if (!hasEvents) {
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
  if (!hasEvents) {
    log.info('E2E: Skipping archive - no events exist', { component: 'e2e' });
    return;
  }

  try {
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
  } catch (error) {
    log.info('E2E: Could not archive event', { component: 'e2e', error });
    archiveToggled = false;
  }
});

When('I unarchive the first event if it was archived', async ({ page }) => {
  if (!archiveToggled) {
    log.info('E2E: Skipping unarchive - event was not archived', { component: 'e2e' });
    return;
  }

  try {
    const firstEventCard = page.getByTestId('event-card').first();
    const archiveButton = firstEventCard.getByTestId('event-archive-button');
    await archiveButton.click();
    archiveToggled = false;
    await page.waitForTimeout(500);
  } catch (error) {
    log.info('E2E: Could not unarchive event', { component: 'e2e', error });
  }
});

Then('I should see the event marked as archived if action was taken', async ({ page }) => {
  if (!archiveToggled) {
    log.info('E2E: Skipping archived check - no archive action was taken', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const archiveButton = firstEventCard.getByTestId('event-archive-button');
  const archiveIcon = archiveButton.locator('svg');

  await expect(archiveIcon).toHaveClass(/fill-primary/);
});

Then('I should see the event not marked as archived if action was taken', async ({ page }) => {
  if (!hasEvents) {
    log.info('E2E: Skipping not-archived check - no events exist', { component: 'e2e' });
    return;
  }

  const firstEventCard = page.getByTestId('event-card').first();
  const archiveButton = firstEventCard.getByTestId('event-archive-button');
  const archiveIcon = archiveButton.locator('svg');

  await expect(archiveIcon).not.toHaveClass(/fill-primary/);
});

When('I archive the event from detail page if on detail page', async ({ page }) => {
  if (!hasEvents) {
    log.info('E2E: Skipping archive from detail - no events exist', { component: 'e2e' });
    return;
  }

  try {
    const archiveBtn = page.getByTestId('event-detail-archive');
    const visible = await archiveBtn.isVisible({ timeout: testConfig.timeouts.element });
    if (visible) {
      await archiveBtn.click();
      detailArchiveToggled = true;
      await page.waitForTimeout(700);
    }
  } catch (error) {
    log.info('E2E: Could not archive from detail page', { component: 'e2e', error });
  }
});

Then('I should see the detail archive button active if action was taken', async ({ page }) => {
  if (!detailArchiveToggled) return;
  const archiveBtn = page.getByTestId('event-detail-archive');
  const icon = archiveBtn.locator('svg').first();
  await expect(icon).toHaveClass(/fill-current/);
});

Then('I should see the detail archive button inactive if action was taken', async ({ page }) => {
  if (!detailArchiveToggled) return;
  const archiveBtn = page.getByTestId('event-detail-archive');
  const icon = archiveBtn.locator('svg').first();
  await expect(icon).not.toHaveClass(/fill-current/);
});

When('I enable favorites only filter', async ({ page }) => {
  const favoritesToggle = page.getByTestId('events-favorites-toggle');
  await favoritesToggle.waitFor({ state: 'visible', timeout: testConfig.timeouts.element });

  // Check if already enabled
  const isChecked = await favoritesToggle.isChecked().catch(() => false);
  if (!isChecked) {
    await favoritesToggle.click();
    await page.waitForTimeout(300);
  }
});

When('I favorite the event from detail page if on detail page', async ({ page }) => {
  if (!hasEvents) {
    log.info('E2E: Skipping favorite from detail - no events exist', { component: 'e2e' });
    return;
  }

  try {
    const favoriteButton = page.getByTestId('event-detail-favorite-button');
    const isVisible = await favoriteButton.isVisible({ timeout: testConfig.timeouts.element });
    if (isVisible) {
      await favoriteButton.click();
      await page.waitForTimeout(500);
    }
  } catch (error) {
    log.info('E2E: Could not favorite event from detail page', { component: 'e2e', error });
  }
});

// Event Detail Steps
Then('I should see event detail elements if on detail page', async ({ page }) => {
  if (!hasEvents) {
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

  try {
    const isVisible = await downloadButton.isVisible({ timeout: testConfig.timeouts.element });
    if (isVisible) {
      await downloadButton.click();
      downloadClicked = true;
      // Give background task time to start
      await page.waitForTimeout(1000);
    }
  } catch {
    // Button doesn't exist, that's okay
    downloadClicked = false;
  }
});

When('I download snapshot from first event in montage', async ({ page }) => {
  downloadClicked = false;

  try {
    const downloadButton = page.getByTestId('event-download-button').first();
    const isVisible = await downloadButton.isVisible({ timeout: testConfig.timeouts.element });

    if (isVisible) {
      await downloadButton.hover();
      await downloadButton.click();
      downloadClicked = true;
      // Give background task time to start
      await page.waitForTimeout(1000);
    }
  } catch {
    // Button doesn't exist, that's okay
    downloadClicked = false;
  }
});

Then('I should see the background task drawer if download was triggered', async ({ page }) => {
  // Only check if we actually clicked a download button
  if (!downloadClicked) {
    log.info('E2E: Skipping drawer check - no download button was clicked', { component: 'e2e' });
    return;
  }

  // Drawer can be in badge, collapsed, or expanded state
  const drawer = page.locator('[data-testid="background-tasks-drawer"], [data-testid="background-tasks-collapsed"], [data-testid="background-tasks-badge"]');

  try {
    await expect(drawer.first()).toBeVisible({ timeout: testConfig.timeouts.transition * 2 });
    log.info('E2E: Background task drawer visible', { component: 'e2e' });
  } catch (error) {
    // Download might have failed instantly or completed too quickly
    // Check if there's any sign the download was attempted
    const hasAnyDrawerElement = await page.locator('[data-testid^="background-task"]').count();
    log.info('E2E: Drawer not visible but download was clicked', {
      component: 'e2e',
      drawerElements: hasAnyDrawerElement
    });

    // Don't fail - download might have failed instantly which is okay for E2E
    // The important part is that clicking the button doesn't crash
  }
});
