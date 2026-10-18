/** Shots for docs/user-guide/monitors.md. See scripts/docs-screenshots.mjs. */
const detail = async (page, go, id = 45) => {
  await go(`/monitors/${id}`);
  await page.getByTestId('monitor-detail-name').waitFor();
};
export default [
  {
    name: 'list',
    open: async (page, go) => {
      await go('/monitors');
      await page.getByTestId('monitor-card').first().waitFor();
    },
  },
  {
    name: 'card',
    open: async (page, go) => {
      await go('/monitors');
      await page.getByTestId('monitor-card').first().waitFor();
    },
    crop: (page) => page.getByTestId('monitor-card').first(),
  },
  {
    name: 'info-popover',
    open: async (page, go) => {
      await go('/monitors');
      await page.getByTestId('monitor-info-btn').first().click();
    },
    crop: (page) => page.getByTestId('monitor-info-popover'),
    settleMs: 1000,
  },
  {
    name: 'hover-preview',
    viewport: 'desktop',
    open: async (page, go) => {
      await go('/monitors');
      const card = page.getByTestId('monitor-card').first();
      await card.waitFor();
      if (await page.getByRole('button', { name: /list/i }).count()) await page.getByRole('button', { name: /list/i }).first().click();
      await page.waitForTimeout(1500);
      await card.hover();
      await page.mouse.move(400, 300);
      await page.mouse.move(420, 320);
      await page.getByTestId('monitor-hover-preview').waitFor({ timeout: 10_000 });
    },
    settleMs: 4000,
  },
  {
    name: 'detail',
    open: (page, go) => detail(page, go),
    settleMs: 5000,
  },
  {
    name: 'detail-zones',
    open: async (page, go) => {
      await detail(page, go);
      await page.getByTestId('zone-toggle-button').click();
    },
    settleMs: 5000,
  },
  {
    name: 'detail-recent',
    open: async (page, go) => {
      await detail(page, go);
      await page.getByTestId('monitor-recent-events').scrollIntoViewIfNeeded();
    },
    crop: (page) => page.getByTestId('monitor-recent-events'),
  },
  {
    name: 'list-menu',
    open: async (page, go) => {
      await go('/monitors');
      await page.getByTestId('monitor-card').first().waitFor();
      await page.getByRole('button', { name: /view options/i }).click();
    },
    crop: (page) => page.getByRole('menu'),
    settleMs: 1000,
  },
  {
    name: 'detail-menu',
    open: async (page, go) => {
      await detail(page, go);
      await page.getByRole('button', { name: /view options/i }).click();
    },
    crop: (page) => page.getByRole('menu'),
    settleMs: 1000,
  },
];
