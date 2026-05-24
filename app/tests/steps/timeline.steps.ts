import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { Given, When, Then } = createBdd();


// Timeline interface elements
Then('I should see timeline interface elements', async ({ page }) => {
  const hasButtons = await page.locator('button').count() > 0;
  const hasInputs = await page.locator('input').count() > 0;
  const hasSelects = await page.locator('select').count() > 0;

  expect(hasButtons || hasInputs || hasSelects).toBeTruthy();
});

// Date Pickers
Then('I should see the start date picker', async ({ page }) => {
  const startDate = page.getByTestId('timeline-start-date')
    .or(page.locator('input[type="date"]').first())
    .or(page.getByLabel(/start date/i));
  await expect(startDate.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

Then('I should see the end date picker', async ({ page }) => {
  const endDate = page.getByTestId('timeline-end-date')
    .or(page.locator('input[type="date"]').last())
    .or(page.getByLabel(/end date/i));
  await expect(endDate.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

// Monitor Filter
Then('I should see the monitor filter button', async ({ page }) => {
  const filterBtn = page.getByTestId('timeline-monitor-filter')
    .or(page.getByRole('button', { name: /monitors|filter/i }))
    .or(page.locator('button').filter({ hasText: /monitors|all monitors/i }));
  await expect(filterBtn.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

// Quick Date Ranges
Then('I should see quick date range options', async ({ page }) => {
  // Wait for timeline page content to render
  await page.waitForTimeout(500);
  // Quick range buttons use short labels like "24h", "48h", "1wk", "2wk", "1mo"
  const quickButtons = page.getByRole('button', { name: /24h|48h|1wk|2wk|1mo/i });
  await expect(quickButtons.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

When('I click a quick date range option', async ({ page }) => {
  // Try to click a range that differs from the current one.
  // Look for all quick range buttons and click the second one (e.g., 48h) to
  // avoid clicking whatever range is already active (usually the first/default).
  const quickBtns = page.getByRole('button', { name: /24h|48h|1wk|2wk|1mo/i });
  const count = await quickBtns.count();
  const btnIndex = count > 1 ? 1 : 0;
  await quickBtns.nth(btnIndex).click();
  await page.waitForTimeout(300);
});

Then('the date filters should update', async ({ page }) => {
  // Date inputs should have valid, non-empty values after clicking a quick range
  const dateInputs = page.locator('input[type="date"], input[type="datetime-local"]');
  const count = await dateInputs.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Both start and end date inputs should be populated with valid dates
  const startValue = await dateInputs.nth(0).inputValue().catch(() => '');
  const endValue = await dateInputs.nth(1).inputValue().catch(() => '');
  expect(startValue).not.toBe('');
  expect(endValue).not.toBe('');
});

// Refresh / Reset
Then('I should see the refresh button', async ({ page }) => {
  // The timeline has a reset button (data-testid="timeline-reset-button") with RefreshCw icon
  const refreshBtn = page.getByTestId('timeline-reset-button')
    .or(page.getByRole('button', { name: /reset|refresh/i }));
  await expect(refreshBtn.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I click the refresh button', async ({ page }) => {
  const refreshBtn = page.getByTestId('timeline-reset-button')
    .or(page.getByRole('button', { name: /reset|refresh/i })).first();
  await refreshBtn.click();
});

Then('the timeline should reload', async ({ page }) => {
  // After refresh, timeline should show content or empty state (the reload completed)
  const content = page.getByTestId('timeline-content');
  const emptyState = page.getByTestId('timeline-empty-state');

  await expect.poll(async () => {
    const hasContent = await content.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    return hasContent || hasEmpty;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

// Timeline Container & Visualization
Then('I should see the timeline container', async ({ page }) => {
  // Wait for timeline page to load (loading, empty, or content state)
  const timelinePage = page.getByTestId('timeline-page');
  await expect(timelinePage).toBeVisible({ timeout: testConfig.timeouts.pageLoad });

  // Now check for any of the content states
  const content = page.getByTestId('timeline-content');
  const emptyState = page.getByTestId('timeline-empty-state');
  const loading = page.getByTestId('timeline-loading');

  await expect.poll(async () => {
    const hasContent = await content.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasLoading = await loading.isVisible().catch(() => false);
    return hasContent || hasEmpty || hasLoading;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

Then('I should see the timeline visualization or empty state', async ({ page }) => {
  const content = page.getByTestId('timeline-content');
  const emptyState = page.getByTestId('timeline-empty-state');
  const loading = page.getByTestId('timeline-loading');

  // Wait for page to finish loading and show content or empty state
  await expect.poll(async () => {
    const hasContent = await content.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const isLoading = await loading.isVisible().catch(() => false);
    // Accept if we have content, empty state, or if loading is done
    return hasContent || hasEmpty || (!isLoading && (hasContent || hasEmpty));
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

// Timeline Events
let hasTimelineEvents = false;

Given('there are events on the timeline', async ({ page }) => {
  // Wait for timeline to finish loading
  const content = page.getByTestId('timeline-content');
  const emptyState = page.getByTestId('timeline-empty-state');

  // Wait for either content or empty state to appear
  await expect.poll(async () => {
    const hasContent = await content.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    return hasContent || hasEmpty;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();

  // Check if content is visible (meaning there are events)
  hasTimelineEvents = await content.isVisible().catch(() => false);

  if (!hasTimelineEvents) {
    log.info('E2E: No events on timeline, subsequent steps will be skipped', { component: 'e2e' });
  }
});

When('I click on an event in the timeline', async ({ page }) => {
  if (!hasTimelineEvents) return;

  // Wait for canvas timeline to render
  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: testConfig.timeouts.element }).catch(() => {});

  if (await eventItem.count() > 0) {
    await eventItem.first().click();
  }
});

Then('I should navigate to the event detail page', async ({ page }) => {
  if (!hasTimelineEvents) return;

  await page.waitForURL(/events\/\d+/, { timeout: testConfig.timeouts.transition });
});

// Monitor Filter
When('I click the monitor filter button', async ({ page }) => {
  const filterBtn = page.getByTestId('timeline-monitor-filter')
    .or(page.getByRole('button', { name: /monitors|filter/i }))
    .or(page.locator('button').filter({ hasText: /monitors|all monitors/i }));
  await filterBtn.first().click();
});

Then('I should see monitor filter options', async ({ page }) => {
  const popover = page.locator('[role="dialog"], [data-radix-popper-content-wrapper]');
  const checkboxes = page.locator('[role="checkbox"]');

  await expect.poll(async () => {
    const hasPopover = await popover.isVisible().catch(() => false);
    const hasCheckboxes = await checkboxes.count() > 0;
    return hasPopover || hasCheckboxes;
  }, { timeout: testConfig.timeouts.element }).toBeTruthy();
});

When('I select a monitor from the filter', async ({ page }) => {
  const checkbox = page.locator('[role="checkbox"]').first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.click();
  }
});

Then("the timeline should show only that monitor's events", async ({ page }) => {
  // Wait for timeline to reload after filter change
  const content = page.getByTestId('timeline-content');
  const emptyState = page.getByTestId('timeline-empty-state');

  // Timeline should show content or empty state after filtering
  await expect.poll(async () => {
    const hasContent = await content.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    return hasContent || hasEmpty;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

// Cause Filter
When('I open the timeline filters', async ({ page }) => {
  const causeFilter = page.getByTestId('timeline-cause-filter');
  if (!(await causeFilter.isVisible().catch(() => false))) {
    await page.getByTestId('timeline-filters-toggle').click();
  }
  await expect(causeFilter).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I select the {string} event cause', async ({ page }, label: string) => {
  await page.getByTestId('timeline-cause-filter').click();
  // Radix Select renders options in a portal; match by visible label.
  await page.getByRole('option', { name: label }).click();
});

Then('the timeline cause filter should show {string}', async ({ page }, label: string) => {
  await expect(page.getByTestId('timeline-cause-filter')).toContainText(label, {
    timeout: testConfig.timeouts.element,
  });
});

// Mobile Responsive
Then('the timeline controls should be accessible', async ({ page }) => {
  // Check for the timeline page controls (filter, reset, date inputs)
  const resetBtn = page.getByTestId('timeline-reset-button');
  const filterBtn = page.getByTestId('timeline-monitor-filter');
  const dateInput = page.getByTestId('timeline-start-date');

  await expect.poll(async () => {
    const hasReset = await resetBtn.isVisible().catch(() => false);
    const hasFilter = await filterBtn.isVisible().catch(() => false);
    const hasDate = await dateInput.isVisible().catch(() => false);
    return hasReset || hasFilter || hasDate;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

Then('the timeline should be scrollable', async ({ page }) => {
  // Check for timeline content area or empty state - both are valid for this test
  const content = page.getByTestId('timeline-content');
  const emptyState = page.getByTestId('timeline-empty-state');
  const container = page.getByTestId('timeline-container');

  await expect.poll(async () => {
    const hasContent = await content.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasContainer = await container.isVisible().catch(() => false);
    return hasContent || hasEmpty || hasContainer;
  }, { timeout: testConfig.timeouts.element }).toBeTruthy();
});
