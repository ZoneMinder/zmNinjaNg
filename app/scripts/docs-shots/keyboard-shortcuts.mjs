/** Shots for docs/user-guide/keyboard-shortcuts.md. See scripts/docs-screenshots.mjs. */
export default [
  {
    name: 'help',
    viewport: 'desktop',
    open: async (page, go) => {
      await go('/dashboard');
      await page.waitForTimeout(1500);
      await page.keyboard.type('?');
      await page.getByTestId('keyboard-shortcuts-help').waitFor();
    },
    crop: (page) => page.getByTestId('keyboard-shortcuts-help'),
    settleMs: 800,
  },
  {
    name: 'palette',
    viewport: 'desktop',
    open: async (page, go) => {
      await go('/dashboard');
      await page.waitForTimeout(1500);
      await page.keyboard.press('/');
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Backspace');
    },
    crop: (page) => page.getByRole('dialog'),
    settleMs: 800,
  },
];
