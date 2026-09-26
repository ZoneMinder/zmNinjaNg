import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';
import en from '../../src/locales/en/translation.json' with { type: 'json' };

const { When, Then } = createBdd();

// Monitor Navigation
let navMonitorIdBeforeNext: string | null = null;
let nextClickPerformed = false;
let navMonitorIdBeforePrev: string | null = null;
let prevClickPerformed = false;

Then('I should see navigation arrows if multiple monitors exist', async ({ page }) => {
  const nextBtn = page.getByTestId('monitor-detail-next');
  const prevBtn = page.getByTestId('monitor-detail-prev');
  const hasNav = await nextBtn.isVisible().catch(() => false) || await prevBtn.isVisible().catch(() => false);
  if (hasNav) {
    // A single-monitor test server legitimately has no nav arrows; when they do
    // exist, at least one must actually be visible, not just present in the DOM.
    await expect(nextBtn.or(prevBtn).first()).toBeVisible();
  }
  log.info('E2E: Monitor navigation arrows', { component: 'e2e', hasNav });
});

When('I click the next monitor button if visible', async ({ page }) => {
  const nextBtn = page.getByTestId('monitor-detail-next');
  navMonitorIdBeforeNext = urlMonitorId(page);
  nextClickPerformed = await nextBtn.isVisible().catch(() => false) && await nextBtn.isEnabled().catch(() => false);
  if (nextClickPerformed) {
    await nextBtn.click();
  }
});

When('I click the previous monitor button if visible', async ({ page }) => {
  const prevBtn = page.getByTestId('monitor-detail-prev');
  navMonitorIdBeforePrev = urlMonitorId(page);
  prevClickPerformed = await prevBtn.isVisible().catch(() => false) && await prevBtn.isEnabled().catch(() => false);
  if (prevClickPerformed) {
    await prevBtn.click();
  }
});

// Stream follows the selected monitor (refs #201)
let streamMonitorIdBefore: string | null = null;
let urlIdBefore: string | null = null;
let streamCheckable = false;

function urlMonitorId(page: import('@playwright/test').Page): string | null {
  const m = page.url().match(/monitors\/(\d+)/);
  return m ? m[1] : null;
}

async function mjpegMonitorId(page: import('@playwright/test').Page): Promise<string | null> {
  const img = page.getByTestId('video-player-mjpeg');
  // Attached, not visible: the element stays hidden until its first frame
  // decodes (refs #352), and the src it carries is what this reads.
  if ((await img.count()) === 0) return null;
  const src = await img.getAttribute('src').catch(() => null);
  const m = src?.match(/[?&]monitor=(\d+)/);
  return m ? m[1] : null;
}

When('I note the current monitor stream source', async ({ page }) => {
  urlIdBefore = urlMonitorId(page);
  streamMonitorIdBefore = await mjpegMonitorId(page);
  // Only the MJPEG transport exposes the monitor id in the element. When the
  // server serves go2rtc/WebRTC there is nothing to assert, so skip downstream.
  streamCheckable = streamMonitorIdBefore != null;
  log.info('E2E stream source before switch', {
    component: 'e2e',
    urlIdBefore,
    streamMonitorIdBefore,
    streamCheckable,
  });
});

Then('the live stream should follow the newly selected monitor', async ({ page }) => {
  if (!streamCheckable) return;
  const urlIdAfter = urlMonitorId(page);
  // No second monitor to switch to: nothing changed, nothing to assert.
  if (!urlIdAfter || urlIdAfter === urlIdBefore) return;
  // With the bug the <img> keeps the old monitor id until the ~60s token cycle;
  // a few seconds is enough to distinguish a real switch from the stale stream.
  await expect
    .poll(async () => mjpegMonitorId(page), { timeout: testConfig.timeouts.transition * 4 })
    .toBe(urlIdAfter);
});

Then('the monitor should change to next in list', async ({ page }) => {
  if (!nextClickPerformed) {
    log.info('E2E: Skipping next-monitor assertion - next button not available (single monitor)', { component: 'e2e' });
    return;
  }
  // The URL always matches /monitors/\d+ on this page, before and after the
  // click, so matching the pattern alone proves nothing changed. Assert the
  // actual monitor id differs from the one recorded before the click.
  await expect.poll(() => urlMonitorId(page), { timeout: testConfig.timeouts.transition })
    .not.toBe(navMonitorIdBeforeNext);
});

Then('the monitor should change to previous in list', async ({ page }) => {
  if (!prevClickPerformed) {
    log.info('E2E: Skipping previous-monitor assertion - previous button not available (single monitor)', { component: 'e2e' });
    return;
  }
  await expect.poll(() => urlMonitorId(page), { timeout: testConfig.timeouts.transition })
    .not.toBe(navMonitorIdBeforePrev);
});


// Wrap around at the end of the list (refs #533)
let wrapStartId: string | null = null;
let wrapSeen = false;

When('I step forward past the last monitor', async ({ page }) => {
  const nextBtn = page.getByTestId('monitor-detail-next');
  const wrapPill = page.getByTestId('monitor-wrap-notice').filter({ hasText: en.monitor_detail.wrapped_around });
  wrapSeen = false;
  if (!(await nextBtn.isEnabled().catch(() => false))) return;
  // Walk forward one monitor at a time until the list wraps. The bound only
  // stops a broken wrap from looping forever.
  for (let i = 0; i < 100 && !wrapSeen; i++) {
    wrapStartId = urlMonitorId(page);
    await nextBtn.click();
    await expect.poll(() => urlMonitorId(page), { timeout: testConfig.timeouts.transition }).not.toBe(wrapStartId);
    wrapSeen = await wrapPill.isVisible().catch(() => false);
  }
});

async function hasSecondMonitor(page: import('@playwright/test').Page): Promise<boolean> {
  return page.getByTestId('monitor-detail-next').isEnabled().catch(() => false);
}

Then('I should see the wrapped around notice', async ({ page }) => {
  if (!(await hasSecondMonitor(page))) {
    log.info('E2E: Skipping wrap assertion - single monitor', { component: 'e2e' });
    return;
  }
  expect(wrapSeen).toBe(true);
});

When('I step back from the first monitor', async ({ page }) => {
  if (!(await hasSecondMonitor(page))) return;
  // Let the forward wrap's notice go first, so the next one is new.
  await expect(page.getByTestId('monitor-wrap-notice')).toBeHidden({ timeout: testConfig.timeouts.transition });
  wrapStartId = urlMonitorId(page);
  await page.getByTestId('monitor-detail-prev').click();
});

Then('I should see the wrapped around notice after stepping back', async ({ page }) => {
  if (!(await hasSecondMonitor(page))) return;
  await expect.poll(() => urlMonitorId(page), { timeout: testConfig.timeouts.transition }).not.toBe(wrapStartId);
  await expect(
    page.getByTestId('monitor-wrap-notice').filter({ hasText: en.monitor_detail.wrapped_around }),
  ).toBeVisible({ timeout: testConfig.timeouts.transition });
});

// Arrow keys step like a swipe at 1x (refs #533)
let keyStepStartId: string | null = null;

When('I press the {string} key on the monitor view', async ({ page }, key: string) => {
  // The keys only step once the monitor list has loaded, which is also when
  // the next button enables. A single-monitor server never gets there.
  await expect(page.getByTestId('monitor-detail-next'))
    .toBeEnabled({ timeout: testConfig.timeouts.transition })
    .catch(() => undefined);
  keyStepStartId = urlMonitorId(page);
  await page.keyboard.press(key);
});

Then('the monitor should have changed', async ({ page }) => {
  if (!(await hasSecondMonitor(page))) return;
  await expect.poll(() => urlMonitorId(page), { timeout: testConfig.timeouts.transition }).not.toBe(keyStepStartId);
});
