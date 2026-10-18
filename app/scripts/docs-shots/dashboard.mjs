/** Shots for docs/user-guide/dashboard.md. See scripts/docs-screenshots.mjs. */
const addWidget = async (page, type, monitor) => {
  await page.getByTestId('add-widget-trigger').click();
  await page.getByTestId(`widget-type-${type}`).click();
  if (monitor) await page.getByRole('checkbox').first().click();
  await page.getByTestId('widget-add-button').click();
  await page.getByTestId('add-widget-dialog').waitFor({ state: 'hidden' });
};
export default [
  {
    name: 'overview',
    open: async (page, go) => {
      await go('/dashboard');
      await addWidget(page, 'monitor', true);
      await addWidget(page, 'timeline');
    },
    settleMs: 6000,
  },
  {
    name: 'add-widget',
    open: async (page, go) => {
      await go('/dashboard');
      await page.getByTestId('add-widget-trigger').click();
      await page.getByTestId('add-widget-dialog').waitFor();
      await page.getByRole('checkbox').first().click();
    },
    crop: (page) => page.getByTestId('add-widget-dialog'),
  },
];
