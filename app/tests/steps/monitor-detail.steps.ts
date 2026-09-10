import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';
import { getZmVersion } from '../helpers/zm-api';
import { isZmVersionAtLeast } from '../../src/lib/zm/zm-version';

const { When, Then } = createBdd();

// Video Player / Monitor Detail
Then('I should see the monitor player', async ({ page }) => {
  // MonitorDetail page has video-player (from LiveMonitorPlayer) and monitor-detail-settings
  const videoPlayer = page.getByTestId('video-player');
  const detailSettings = page.getByTestId('monitor-detail-settings');
  const monitorPlayer = page.getByTestId('monitor-player');

  // Check for any of these to be visible
  await expect.poll(async () => {
    const hasVideoPlayer = await videoPlayer.isVisible().catch(() => false);
    const hasDetailSettings = await detailSettings.isVisible().catch(() => false);
    const hasMonitorPlayer = await monitorPlayer.isVisible().catch(() => false);
    return hasVideoPlayer || hasDetailSettings || hasMonitorPlayer;
  }, { timeout: testConfig.timeouts.pageLoad }).toBeTruthy();
});

// Go2RTC / LiveMonitorPlayer Steps
Then('I should see a video player element', async ({ page }) => {
  const videoPlayer = page.getByTestId('video-player');
  await expect(videoPlayer).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('the snapshot should be saved successfully', async ({ page }) => {
  // The montage handler always toasts: montage.snapshot_saved on success,
  // montage.snapshot_failed on failure (MontageMonitor.tsx:147-150). Racing the
  // two and swallowing the timeout meant the step also passed when the click
  // did nothing at all.
  const successToast = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(successToast.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await expect(successToast.first()).toContainText(/snapshot saved/i);
});

When('I click the snapshot button in monitor detail', async ({ page }) => {
  const snapshotBtn = page.getByTestId('snapshot-button')
    .or(page.getByRole('button', { name: /snapshot/i }));
  await snapshotBtn.first().click();
});

Then('I should see snapshot download initiated', async ({ page }) => {
  // MonitorDetail.tsx:422-430 toasts monitor_detail.snapshot_saved once the
  // capture resolves and monitor_detail.snapshot_failed if it rejects, on both
  // the canvas-capture and fetch paths. Assert the success toast rather than
  // treating "no error toast within 5s" as a pass.
  const successToast = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(successToast.first()).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  await expect(successToast.first()).toContainText(/snapshot saved/i);
});

// Monitor Settings Dialog
When('I open the monitor settings dialog', async ({ page }) => {
  const settingsBtn = page.getByTestId('monitor-detail-settings')
    .or(page.getByRole('button', { name: /settings/i }));
  await expect(settingsBtn.first()).toBeVisible({ timeout: 10000 });
  await settingsBtn.first().click();
});

Then('I should see the monitor mode dropdown', async ({ page }) => {
  // The Function dropdown only exists below ZM 1.38, which replaced one mode
  // with separate capture/analyse/record states. Which side of that gate the
  // server sits on comes from the API: the old fallback matched any combobox
  // on the page, so it passed against a 1.38 server by finding the feed-fit
  // control instead, and asserted nothing about modes at all.
  const version = await getZmVersion();
  if (isZmVersionAtLeast(version, '1.38.0')) {
    await expect(page.getByTestId('monitor-controls-card')).toBeVisible({
      timeout: testConfig.timeouts.transition,
    });
    return;
  }
  await expect(page.getByTestId('monitor-mode-select')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

Then('the current mode should be displayed', async ({ page }) => {
  const modeDisplay = page.locator('text=/Monitor|Modect|Record|Mocord|None|Nodect/');
  await expect(modeDisplay.first()).toBeVisible();
});

// Settings Button & Dialog
When('I click the settings button', async ({ page }) => {
  const settingsBtn = page.getByTestId('monitor-detail-settings');
  await expect(settingsBtn).toBeVisible({ timeout: 10000 });
  await settingsBtn.click();
});

Then('I should see the monitor settings dialog', async ({ page }) => {
  const dialog = page.getByRole('dialog').or(page.locator('[data-testid="monitor-settings-dialog"]'));
  await expect(dialog.first()).toBeVisible({ timeout: 10000 });
});

/**
 * The permission gating (refs #344) hands an account without System Edit a
 * read-only dialog. The configured test account has Edit, so the editor must
 * survive: this fails if the probe ever mistakes an administrator for a
 * restricted user, which is the regression that would hurt most.
 */
Then('the dialog should offer the camera source field', async ({ page }) => {
  await expect(page.getByTestId('settings-source-input')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('monitor-settings-restricted-note')).toHaveCount(0);
});

// MJPEG streaming regression steps (issue #155, Tauri socket pool)

/**
 * Verify the MJPEG <img> element has a non-empty src with positive naturalWidth,
 * confirming the Rust blob-push path delivered at least one frame.
 */
async function assertMjpegFrameLoaded(page: import('@playwright/test').Page): Promise<void> {
  const mjpegImg = page.getByTestId('video-player-mjpeg');
  await expect(mjpegImg).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  // src must be set (blob URL from Rust MJPEG push, or direct URL)
  const src = await mjpegImg.getAttribute('src');
  expect(src, 'MJPEG img src must not be empty').toBeTruthy();
  // naturalWidth > 0 confirms the browser decoded a real image frame
  const naturalWidth = await mjpegImg.evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(naturalWidth, 'MJPEG img naturalWidth must be > 0 (frame must have loaded)').toBeGreaterThan(0);
}

When('I cycle through up to {int} monitors using the next arrow and verify each shows a live MJPEG frame', async ({ page }, maxCount: number) => {
  for (let i = 0; i < maxCount; i++) {
    await assertMjpegFrameLoaded(page);
    log.info('E2E: MJPEG frame verified', { component: 'e2e', monitorIndex: i });

    const nextBtn = page.getByTestId('monitor-detail-next');
    const nextEnabled = await nextBtn.isVisible().catch(() => false)
      && await nextBtn.isEnabled().catch(() => false);

    if (!nextEnabled) {
      log.info('E2E: No next monitor available, stopping cycle', { component: 'e2e', stoppedAt: i });
      break;
    }

    await nextBtn.click();
    // Wait for the new monitor URL and player to be ready before verifying the next frame
    await page.waitForURL(/monitors\/\d+/, { timeout: testConfig.timeouts.transition });
    await page.getByTestId('video-player').waitFor({ state: 'visible', timeout: testConfig.timeouts.pageLoad });
  }
});

Then('the currently open monitor should show a live MJPEG frame', async ({ page }) => {
  await assertMjpegFrameLoaded(page);
  log.info('E2E: Final monitor MJPEG frame verified', { component: 'e2e' });
});

When('I maximize the monitor feed', async ({ page }) => {
  // A touch device in landscape is already fullscreen from the rotation
  // term (useAutoFullscreen), and then there is no header button to press.
  const exitButton = page.getByTestId('monitor-detail-exit-fullscreen');
  if (!(await exitButton.isVisible().catch(() => false))) {
    await page.getByTestId('monitor-detail-maximize').click();
  }
  await expect(exitButton).toBeVisible({ timeout: testConfig.timeouts.transition });
});

// The feed card sat in a flex item whose min-height defaulted to its content,
// so in landscape it grew past the screen and the frame lost its bottom. The
// card has to be the screen for object-fit contain to mean anything.
Then('the fullscreen feed should fit within the viewport', async ({ page }) => {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await expect(page.getByTestId('monitor-player')).toBeVisible();
  // Polled: the card slides in on navigation, so the first box can be mid-flight.
  const box = () => page.getByTestId('monitor-player').boundingBox();
  await expect.poll(async () => { const c = await box(); return c ? c.y + c.height : Infinity; }, { message: 'card bottom' }).toBeLessThanOrEqual(viewport.height + 1);
  await expect.poll(async () => { const c = await box(); return c ? c.x + c.width : Infinity; }, { message: 'card right' }).toBeLessThanOrEqual(viewport.width + 1);
  await expect.poll(async () => (await box())?.height ?? 0, { message: 'card height' }).toBeGreaterThan(viewport.height * 0.6);
  // The exit control floats over the feed rather than sitting in a strip above
  // it, so the picture starts at the very top of the screen (refs #479).
  await expect.poll(async () => (await box())?.y ?? Infinity, { message: 'card top' }).toBeLessThanOrEqual(1);
});

