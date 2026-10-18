/** Shots for docs/user-guide/events.md. See scripts/docs-screenshots.mjs. */
const openFilters = async (page, go) => {
  await go('/events');
  await page.getByTestId('event-card').first().waitFor();
  // Early taps are lost to the page's first re-renders.
  await page.waitForTimeout(6000);
  const panel = page.getByTestId('events-filter-panel');
  for (let i = 0; i < 3 && !(await panel.isVisible()); i++) {
    await page.getByTestId('events-filter-button').tap();
    await panel.waitFor({ timeout: 5000 }).catch(() => {});
  }
  await panel.waitFor();
};

const openFirstEvent = async (page, go) => {
  await go('/events');
  const card = await page.getByTestId('event-card').first().textContent();
  await go(`/events/${/Event-(\d+)/.exec(card ?? '')?.[1]}`);
  await page.getByTestId('event-detail-start').waitFor();
};

export default [
  {
    name: 'list',
    open: (page, go) => go('/events'),
  },
  {
    name: 'detail',
    open: openFirstEvent,
    settleMs: 14000,
  },
  {
    name: 'filters',
    open: openFilters,
    crop: (page) => page.getByTestId('events-filter-panel'),
  },
  {
    name: 'saved-filters',
    open: async (page, go) => {
      await openFilters(page, go);
      await page.getByTestId('events-filter-preset-save').tap();
      await page.getByTestId('events-filter-preset-name').waitFor();
    },
    crop: (page) => page.getByRole('dialog'),
  },
  {
    name: 'toolbar',
    open: (page, go) => go('/events'),
    crop: (page) => page.getByTestId('events-view-toggle').locator('xpath=ancestor::div[2]'),
  },
  {
    name: 'player-options',
    open: async (page, go) => {
      await openFirstEvent(page, go);
      await page.getByTestId('zms-options-card').scrollIntoViewIfNeeded();
    },
    crop: (page) => page.getByTestId('zms-options-card'),
  },
  {
    name: 'frames',
    open: async (page, go) => {
      await openFirstEvent(page, go);
      await page.getByTestId('event-frames-card').scrollIntoViewIfNeeded();
    },
    crop: (page) => page.getByTestId('event-frames-card'),
  },
  {
    name: 'details-card',
    open: async (page, go) => {
      await openFirstEvent(page, go);
      await page.getByTestId('event-detail-details').scrollIntoViewIfNeeded();
    },
    crop: (page) => page.getByTestId('event-detail-details'),
  },
  {
    name: 'nearby',
    open: async (page, go) => {
      await openFirstEvent(page, go);
      await page.getByTestId('event-context-open').first().click();
      await page.getByTestId('event-context-panel').waitFor();
    },
    settleMs: 4000,
  },
  {
    name: 'montage',
    open: async (page, go) => {
      await go('/events');
      await page.getByTestId('event-card').first().waitFor();
      await page.waitForTimeout(6000);
      await page.getByTestId('events-view-toggle').tap();
      await page.getByTestId('events-montage-grid').waitFor();
    },
  },
  {
    name: 'download',
    open: async (page, go) => {
      await openFirstEvent(page, go);
    },
    crop: (page) => page.getByTestId('download-video-button').locator('xpath=ancestor::div[1]'),
  },
];
