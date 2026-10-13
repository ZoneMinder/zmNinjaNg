import { expect, type Page } from '@playwright/test';
import { testConfig } from './config';

/**
 * Wait until the monitor detail page has replaced the Monitors page.
 *
 * The URL changes as soon as a monitor card is clicked, but the detail page's
 * code is loaded lazily, so for a moment the Monitors page is still rendered.
 * A step that runs then and uses a locator not unique to the detail page (a
 * "Settings" button, the first view-options menu) acts on the outgoing page:
 * it clicks the card's own settings button, or opens the Monitors page's view
 * options. Waiting for the detail page's view-options trigger, and for the
 * Monitors page's to be gone, closes that window.
 */
export async function waitForMonitorDetail(page: Page): Promise<void> {
  await expect(page.getByTestId('monitor-detail-menu')).toBeVisible({
    timeout: testConfig.timeouts.pageLoad,
  });
  await expect(page.getByTestId('monitors-menu')).toHaveCount(0, {
    timeout: testConfig.timeouts.pageLoad,
  });
}
