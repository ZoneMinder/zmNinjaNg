/** Shots for docs/user-guide/getting-started.md. See scripts/docs-screenshots.mjs. */
export default [
  {
    name: 'setup',
    loggedOut: true,
    open: (page) => page.getByText(/welcome to zmninjang/i).waitFor(),
  },
  {
    name: 'sidebar-bottom',
    open: async (page, go) => {
      await go('/dashboard');
      await page.getByTestId('mobile-menu-button').click();
      await page.locator('[data-testid="sidebar-kiosk-lock"]:visible').scrollIntoViewIfNeeded();
    },
  },
];
