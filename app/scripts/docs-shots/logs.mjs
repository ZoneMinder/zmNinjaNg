/** Shots for docs/user-guide/logs.md. See scripts/docs-screenshots.mjs. */
const openLogs = async (page, go) => {
  await go('/logs');
  await page.getByTestId('logs-list').or(page.getByTestId('logs-empty-state')).waitFor();
};
export default [
  { name: 'page', open: openLogs },
  { name: 'status', open: openLogs, crop: (page) => page.getByTestId('logs-status-line').locator('xpath=..') },
  {
    name: 'components',
    open: async (page, go) => {
      await openLogs(page, go);
      await page.getByTestId('log-component-filter-trigger').click();
      await page.getByTestId('log-component-filter-options').waitFor();
    },
  },
];
