/** Shots for docs/user-guide/montage.md. See scripts/docs-screenshots.mjs. */
const montage = async (page, go) => {
  await go('/montage');
  await page.getByTestId('montage-grid').waitFor();
};
export default [
  {
    name: 'grid-desktop',
    viewport: 'desktop',
    open: montage,
    settleMs: 6000,
  },
  {
    name: 'toolbar',
    open: montage,
    crop: (page) => page.getByTestId('montage-edit-toggle').locator('xpath=../../*[1]'),
  },
  {
    name: 'menu',
    open: async (page, go) => {
      await montage(page, go);
      await page.getByTestId('montage-kebab-menu').click();
    },
    crop: (page) => page.getByRole('menu'),
    settleMs: 1000,
  },
  {
    name: 'fullscreen',
    open: async (page, go) => {
      await montage(page, go);
      await page.getByTestId('montage-fullscreen-button').click({ force: true });
      await page.getByTestId('montage-fullscreen-toolbar').waitFor();
    },
    settleMs: 5000,
  },
  {
    name: 'edit',
    open: async (page, go) => {
      const exit = page.getByTestId('montage-exit-fullscreen');
      if (await exit.isVisible()) await exit.click();
      await montage(page, go);
      await page.getByTestId('montage-edit-toggle').click({ force: true });
    },
    settleMs: 5000,
  },
];
