/** Shots for docs/user-guide/settings.md. See scripts/docs-screenshots.mjs. */
const section = (id) => (page) => page.getByTestId(`settings-section-${id}`);
// A tall viewport lets a whole section fit, so the sticky header stays out of the crop.
const openSettings = async (page, go, height = 3000) => {
  await page.setViewportSize({ width: 390, height });
  await go('/dashboard');
  await page.waitForTimeout(500);
  await go('/settings');
  await page.getByTestId('settings-sections').waitFor();
};
const folded = (triggerId) => async (page, go) => {
  await openSettings(page, go);
  await page.getByTestId(triggerId).scrollIntoViewIfNeeded();
  await page.getByTestId(triggerId).click();
};
export default [
  { name: 'page', open: (page, go) => openSettings(page, go, 844) },
  { name: 'general', open: openSettings, crop: section('general') },
  {
    name: 'previews',
    open: folded('settings-hover-preview-trigger'),
    crop: (page) => page.getByTestId('settings-hover-preview-trigger').locator('xpath=..'),
  },
  {
    name: 'hidden-monitors',
    open: async (page, go) => {
      await openSettings(page, go);
      await page.getByTestId('hidden-monitors-dropdown').scrollIntoViewIfNeeded();
      await page.getByTestId('hidden-monitors-dropdown').click();
      await page.getByTestId('hidden-monitors-list').waitFor();
    },
    crop: (page) => page.getByTestId('hidden-monitors-panel').locator('xpath=..'),
  },
  { name: 'live-streaming', open: openSettings, crop: section('live-streaming') },
  {
    name: 'advanced-streaming',
    open: folded('settings-advanced-streaming-trigger'),
    crop: (page) => page.getByTestId('settings-advanced-streaming-trigger').locator('xpath=..'),
  },
  { name: 'events-playback', open: openSettings, crop: section('events-playback') },
  {
    name: 'thumbnail-chain',
    open: folded('settings-thumbnail-chain-trigger'),
    crop: (page) => page.getByTestId('settings-thumbnail-chain-trigger').locator('xpath=..'),
  },
  { name: 'network', open: openSettings, crop: section('network') },
  {
    name: 'component-logs',
    open: folded('component-log-levels-toggle'),
    crop: (page) => page.getByTestId('component-log-levels-toggle').locator('xpath=..'),
  },
];
