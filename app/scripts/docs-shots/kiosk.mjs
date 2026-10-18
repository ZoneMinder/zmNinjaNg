/** Shots for docs/user-guide/kiosk.md. See scripts/docs-screenshots.mjs. */
const openSidebar = async (page, go) => {
  await go('/dashboard');
  await page.getByTestId('mobile-menu-button').click();
  await page.locator('[data-testid="sidebar-kiosk-lock"]:visible').waitFor();
};
const setPin = async (page) => {
  await page.locator('[data-testid="sidebar-kiosk-lock"]:visible').click();
  await page.getByTestId('kiosk-pin-pad').waitFor();
};
export default [
  {
    name: 'pin-setup',
    open: async (page, go) => { await openSidebar(page, go); await setPin(page); },
    settleMs: 1000,
  },
];
