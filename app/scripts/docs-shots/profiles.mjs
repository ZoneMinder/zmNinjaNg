/** Shots for docs/user-guide/profiles.md. See scripts/docs-screenshots.mjs. */
export default [
  {
    name: 'list',
    open: (page, go) => go('/profiles'),
  },
  {
    name: 'add',
    open: (page, go) => go('/profiles/new'),
  },
  {
    name: 'card',
    open: (page, go) => go('/profiles'),
    crop: (page) => page.getByTestId('profile-card').first(),
  },
  {
    name: 'edit',
    open: async (page, go) => {
      await go('/profiles');
      await page.getByTestId('profile-card').first().getByRole('button', { name: /more|menu|⋮/i }).last().click();
      await page.getByRole('menuitem', { name: /edit/i }).click();
      await page.getByTestId('profile-edit-dialog').waitFor();
    },
    crop: (page) => page.getByTestId('profile-edit-dialog'),
  },
  {
    name: 'menu',
    open: async (page, go) => {
      await go('/profiles');
      await page.locator('[data-testid="profiles-menu"]:visible').click();
      await page.getByRole('menu').waitFor();
    },
  },
];
