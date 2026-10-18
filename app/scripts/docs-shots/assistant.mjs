/** Shots for docs/user-guide/assistant.md. See scripts/docs-screenshots.mjs. */
export default [
  {
    name: 'settings',
    open: async (page, go) => {
      await go('/settings');
      const toggle = page.getByTestId('settings-section-assistant-toggle');
      await toggle.waitFor();
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      const sw = page.getByTestId('assistant-enabled-toggle');
      await sw.waitFor();
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
      await page.getByTestId('assistant-backend-select').waitFor();
    },
    crop: (page) => page.getByTestId('settings-section-assistant'),
  },
];
