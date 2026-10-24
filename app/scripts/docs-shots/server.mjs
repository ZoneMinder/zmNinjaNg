/** Shots for docs/user-guide/server.md. See scripts/docs-screenshots.mjs. */
const openServer = async (page, go) => {
  await go('/server');
  await page.getByTestId('server-refresh-button').waitFor();
};
export default [
  { name: 'page', open: openServer },
  { name: 'stats', open: openServer, crop: (page) => page.getByTestId('stat-load').locator('xpath=../../..') },
  { name: 'permissions', open: openServer, crop: (page) => page.getByTestId('account-permissions-card') },
  { name: 'zm-control', open: openServer, crop: (page) => page.getByTestId('server-zm-control-card') },
];
