import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { getMonitorCount } from '../helpers/zm-api';
import { log } from '../../src/lib/logger';

const { When, Then } = createBdd();

// Zoom / pan (keyboard + mouse) - issue #191
let panTransformBefore = '';

// Stepping to a neighbour needs a neighbour to step to. Ask the ZM API, never
// the buttons under test: a guard that reads their visibility skips exactly
// when the bug it guards has hidden them, and reports green (refs #382).
// Cached per worker, one call per run.
let monitorCount: number | null = null;
async function serverHasTwoMonitors(): Promise<boolean> {
  if (monitorCount === null) {
    monitorCount = await getMonitorCount();
    log.info('E2E server monitor count', { component: 'e2e', count: monitorCount });
  }
  return monitorCount > 1;
}

async function readZoomTransform(page: import('@playwright/test').Page): Promise<string> {
  return page
    .getByTestId('monitor-zoom-content')
    .evaluate((el) => (el as HTMLElement).style.transform);
}

When('I scroll the wheel up over the monitor view', async ({ page }) => {
  const box = await page.getByTestId('monitor-zoom-content').boundingBox();
  if (!box) throw new Error('monitor-zoom-content has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Negative deltaY = scroll up = zoom in. Several notches to clear the threshold.
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -120);
  }
  // Zooming past the threshold is what makes the pan buttons appear; wait for
  // that observable effect instead of guessing how long the state update takes.
  await expect(page.getByTestId('pan-left-button')).toBeVisible({ timeout: testConfig.timeouts.transition });
});

When('I zoom into the monitor view', async ({ page }) => {
  const zoomIn = page.getByTestId('zoom-in-button');
  await expect(zoomIn).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
  // Two steps so the view is well past the zoom threshold with room to pan.
  await zoomIn.click();
  await zoomIn.click();
});

Then('the pan controls should be visible', async ({ page }) => {
  await expect(page.getByTestId('pan-left-button')).toBeVisible();
  await expect(page.getByTestId('pan-right-button')).toBeVisible();
});

When('I pan the view with the {string} arrow key', async ({ page }, key: string) => {
  panTransformBefore = await readZoomTransform(page);
  await page.keyboard.press(key);
  // Pan animates over 0.2s; wait for the transform value to actually change
  // rather than sleeping a fixed duration that may outrun or undershoot it.
  await expect.poll(() => readZoomTransform(page), { timeout: testConfig.timeouts.transition })
    .not.toBe(panTransformBefore);
});

When('I drag the monitor view with the mouse', async ({ page }) => {
  panTransformBefore = await readZoomTransform(page);
  // Aim at the card, not the zoomed content: the content's box is scaled and
  // shifted, so its centre can sit under the sticky header once the page has
  // scrolled. hover() scrolls the card into view and checks it is the hit target.
  const player = page.getByTestId('monitor-player');
  await player.hover();
  const box = await player.boundingBox();
  if (!box) throw new Error('monitor-player has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Several intermediate moves so use-gesture registers a drag, not a tap.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx - (60 * i) / 8, cy);
  }
  await page.mouse.up();
  await expect.poll(() => readZoomTransform(page), { timeout: testConfig.timeouts.transition })
    .not.toBe(panTransformBefore);
});

// Zoom belongs to the picture, not the page (refs #382). Stepping to another
// monitor keeps the page mounted, so the zoom has to be cleared explicitly.
Then('the monitor view should be back at fit', async ({ page }) => {
  if (!(await serverHasTwoMonitors())) {
    log.info('E2E: Skipping zoom-reset assertion - server has one monitor', { component: 'e2e' });
    return;
  }
  // The pan controls only render while the hook itself reports more than 1x,
  // so their absence is the zoom state being cleared, not just a repainted
  // element: the <img> remounts on the switch and paints unzoomed either way.
  await expect(page.getByTestId('pan-left-button')).toBeHidden({ timeout: testConfig.timeouts.transition });
  // '' on a freshly mounted element, 'scale(1)' on one the reset wrote to.
  // Polled: the reset animates over 0.2s, so the inline style can still carry
  // the old scale for a frame after the controls have gone.
  await expect
    .poll(() => readZoomTransform(page), { timeout: testConfig.timeouts.transition })
    .toMatch(/^$|scale\(1\)/);
});

Then('the view should pan', async ({ page }) => {
  const after = await readZoomTransform(page);
  expect(after).not.toBe(panTransformBefore);
});
