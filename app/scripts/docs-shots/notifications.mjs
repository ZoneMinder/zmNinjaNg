/** Shots for docs/user-guide/notifications.md. See scripts/docs-screenshots.mjs. */
export default [
  {
    name: 'settings',
    open: async (page, go) => {
      await go('/notifications');
      await page.getByTestId('notification-settings').waitFor();
    },
    crop: (page) => page.getByTestId('notification-settings'),
  },
];
