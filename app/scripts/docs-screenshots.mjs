/**
 * Captures the screenshots used in docs/user-guide.
 *
 * Needs `npm run dev` and `npm run proxy` running. Credentials come from the
 * environment, never from this file:
 *
 *   DOCS_ZM_HOST=https://demo.zoneminder.com DOCS_ZM_USER=... DOCS_ZM_PASSWORD=... \
 *     node scripts/docs-screenshots.mjs <doc> [shot ...]
 *
 * <doc> names a shot list in scripts/docs-shots/<doc>.mjs; with shot names,
 * only those are retaken. Output: docs/_static/img/screens/<doc>/<shot>.jpg.
 *
 * A shot is { name, viewport?, open, crop?, settleMs?, loggedOut? }:
 * - viewport: 'phone' (390x844, the default) or 'desktop' (1280x800), both 2x.
 * - open(page, go): gets the page into the state to capture. go(route)
 *   navigates in place (HashRouter), keeping the logged-in session.
 * - crop(page): optional; returns a locator to capture instead of the whole
 *   viewport, e.g. one toolbar, dialog or card.
 * - settleMs: wait before capture, default 3000, for streams and thumbnails.
 * - loggedOut: capture in a fresh browser that never logged in (first run).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseURL = 'http://localhost:5173';
const { DOCS_ZM_HOST, DOCS_ZM_USER, DOCS_ZM_PASSWORD } = process.env;
const [doc, ...wanted] = process.argv.slice(2);
if (!doc || !DOCS_ZM_HOST || !DOCS_ZM_USER || !DOCS_ZM_PASSWORD) {
  console.error('Usage: DOCS_ZM_HOST=.. DOCS_ZM_USER=.. DOCS_ZM_PASSWORD=.. node scripts/docs-screenshots.mjs <doc> [shot ...]');
  process.exit(1);
}

// Without the proxy, login waits out its 30s timeout and the failure names
// neither server. The proxy answers 400 on a bare /proxy, which still counts.
for (const [url, command] of [[baseURL, 'npm run dev'], ['http://localhost:3001/proxy', 'npm run proxy']]) {
  try {
    await fetch(url);
  } catch {
    console.error(`Nothing answers at ${url} - start \`${command}\` first.`);
    process.exit(1);
  }
}

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};

const { default: allShots } = await import(pathToFileURL(path.join(here, 'docs-shots', `${doc}.mjs`)).href);
const shots = wanted.length ? allShots.filter((s) => wanted.includes(s.name)) : allShots;
const outDir = path.resolve(here, '../../docs/_static/img/screens', doc);
mkdirSync(outDir, { recursive: true });

async function login(page) {
  await page.goto(baseURL);
  await page.getByTestId('app-init-blocker').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.getByLabel(/server url/i).fill(DOCS_ZM_HOST);
  await page.getByLabel(/username/i).fill(DOCS_ZM_USER);
  await page.getByLabel(/password/i).fill(DOCS_ZM_PASSWORD);
  await page.getByRole('button', { name: /connect/i }).click();
  await page.locator('[data-testid="mobile-menu-button"]:visible, [data-testid="nav-item-dashboard"]:visible')
    .first().waitFor({ timeout: 30_000 });
}

const browser = await chromium.launch({ args: ['--disable-web-security'] });
const pages = {};
async function pageFor(kind, loggedOut) {
  const key = loggedOut ? `${kind}-out` : kind;
  if (!pages[key]) {
    const context = await browser.newContext({ ...VIEWPORTS[kind], deviceScaleFactor: 2, colorScheme: 'dark' });
    pages[key] = await context.newPage();
    if (loggedOut) {
      await pages[key].goto(baseURL);
      await pages[key].getByTestId('app-init-blocker').waitFor({ state: 'hidden', timeout: 30_000 });
    } else {
      await login(pages[key]);
    }
  }
  return pages[key];
}

let failed = 0;
for (const shot of shots) {
  try {
    const page = await pageFor(shot.viewport ?? 'phone', shot.loggedOut);
    // HashRouter: changing the hash navigates in place. page.goto would reload
    // the app, which lands on its start page instead of the route.
    const go = (route) => page.evaluate((r) => { window.location.hash = r; }, route);
    await shot.open(page, go);
    await page.waitForTimeout(shot.settleMs ?? 3000);
    const target = shot.crop ? shot.crop(page) : page;
    await target.screenshot({ path: path.join(outDir, `${shot.name}.jpg`), type: 'jpeg', quality: 80 });
    console.log(`ok   ${doc}/${shot.name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${doc}/${shot.name}: ${err.message.split('\n')[0]}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
