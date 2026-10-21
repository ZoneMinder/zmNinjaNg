import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

const cue = (page: Page) => page.getByTestId('more-below-cue');

// The element that scrolls on this page: the app's <main>, or a page's own
// scroller nested inside it (events, montage).
async function scrollState(page: Page) {
  return page.evaluate(() => {
    const scrollers = [...document.querySelectorAll<HTMLElement>('main, main *')].filter((el) => {
      const overflowY = getComputedStyle(el).overflowY;
      return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    return {
      overflows: scrollers.length > 0,
      scrolled: scrollers.some((el) => el.scrollTop > 0),
    };
  });
}

Then('the scroll cue should be visible', async ({ page }) => {
  await expect(cue(page)).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

Then('the scroll cue should be hidden', async ({ page }) => {
  await expect(cue(page)).toHaveCount(0);
});

Then('the page should have more content below', async ({ page }) => {
  await expect.poll(async () => (await scrollState(page)).overflows, {
    timeout: testConfig.timeouts.pageLoad,
  }).toBe(true);
});

When('I tap the scroll cue', async ({ page }) => {
  await cue(page).click();
});

Then('the page should have scrolled down', async ({ page }) => {
  await expect.poll(async () => (await scrollState(page)).scrolled).toBe(true);
});

async function setScrollHint(page: Page, on: boolean) {
  const sw = page.getByTestId('settings-more-below-cue');
  await expect(sw).toBeVisible();
  const checked = (await sw.getAttribute('aria-checked')) === 'true';
  if (checked !== on) await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', String(on));
}

When('I turn off the scroll hint in settings', async ({ page }) => {
  await setScrollHint(page, false);
});

When('I turn on the scroll hint in settings', async ({ page }) => {
  await setScrollHint(page, true);
});
