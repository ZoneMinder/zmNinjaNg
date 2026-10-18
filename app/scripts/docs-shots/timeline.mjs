/** Shots for docs/user-guide/timeline.md. See scripts/docs-screenshots.mjs. */
// The demo server's newest events are from August, so the default last-day range is empty.
const openRange = async (page, go) => {
  await go('/timeline');
  await page.getByTestId('timeline-start-date').waitFor();
  await page.waitForTimeout(4000);
  await page.getByTestId('timeline-start-date').fill('2026-08-09T00:00');
  await page.getByTestId('timeline-end-date').fill('2026-08-11T00:00');
  await page.getByTestId('timeline-end-date').press('Enter');
};

export default [
  {
    name: 'page',
    open: async (page, go) => {
      await openRange(page, go);
      await page.getByTestId('timeline-canvas').waitFor({ timeout: 30000 });
      await page.getByTestId('timeline-filters-toggle').tap();
    },
    settleMs: 6000,
  },
  {
    name: 'toolbar',
    open: async (page, go) => {
      await openRange(page, go);
      await page.getByTestId('timeline-canvas').waitFor({ timeout: 30000 });
    },
    crop: (page) => page.getByTestId('timeline-zoom-in-button').locator('xpath=ancestor::div[2]'),
    settleMs: 4000,
  },
  {
    name: 'filters',
    open: async (page, go) => {
      await go('/timeline');
      const toggle = page.getByTestId('timeline-filters-toggle');
      await toggle.waitFor();
      await page.waitForTimeout(4000);
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    },
    crop: (page) => page.getByTestId('timeline-filters-toggle').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
  },
];
