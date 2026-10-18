/** Shots for docs/user-guide/live-activity.md. See scripts/docs-screenshots.mjs. */
export default [
  {
    name: 'page',
    open: (page, go) => go('/live-activity'),
    settleMs: 6000,
  },
  {
    name: 'settings',
    open: async (page, go) => {
      await go('/live-activity');
      await page.getByTestId('live-activity-settings-btn').click();
      await page.getByTestId('live-activity-settings-dialog').waitFor();
      await page.getByRole('heading', { name: /settings/i }).click();
    },
    crop: (page) => page.getByTestId('live-activity-settings-dialog'),
    settleMs: 1500,
  },
];
