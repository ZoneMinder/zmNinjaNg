import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { Given, When, Then } = createBdd();

// Authentication
Given('I am logged into zmNinjaNg', async ({ page }) => {
  // Navigate to application
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.waitForTimeout(100);
  await expect(page.getByTestId('app-init-blocker')).toBeHidden({
    timeout: testConfig.timeouts.transition * 3,
  });

  // Wait for either setup page or authenticated page to load (content-based, not URL-based)
  await Promise.race([
    page.waitForSelector('text=/Welcome to zmNinjaNg/i', { timeout: testConfig.timeouts.transition }),
    page.waitForSelector('[data-testid="nav-item-dashboard"]', { timeout: testConfig.timeouts.transition })
  ]);

  // Check if on setup page by looking for the Connect button or Server URL field
  const isSetupPage = await page.getByRole('button', { name: /connect/i }).isVisible().catch(() => false)
    || await page.getByLabel(/server url/i).isVisible().catch(() => false);

  if (isSetupPage) {
    log.info('E2E setup page detected; proceeding with login', { component: 'e2e', action: 'login' });
    const { host, username, password } = testConfig.server;

    await page.getByLabel(/server url/i).clear();
    await page.getByLabel(/server url/i).fill(host);
    if (username) {
      await page.getByLabel(/username/i).clear();
      await page.getByLabel(/username/i).fill(username);
    }
    if (password) {
      await page.getByLabel(/password/i).clear();
      await page.getByLabel(/password/i).fill(password);
    }

    const connectBtn = page.getByRole('button', { name: /connect/i });
    await expect(connectBtn).toBeEnabled();
    await connectBtn.click();

    // Wait for navigation to complete (URL changes from /profiles/new or /setup to another route)
    // The app waits 1 second before navigating, plus login time
    await page.waitForURL((url) => !url.pathname.includes('/profiles/new') && !url.pathname.includes('/setup'), {
      timeout: testConfig.timeouts.transition * 2, // 10 seconds to account for login + 1s delay + navigation
    });

    // Then wait for navigation elements or mobile menu button to appear
    await Promise.race([
      page.waitForSelector('[data-testid^="nav-item-"]', { timeout: testConfig.timeouts.transition }),
      page.waitForSelector('[data-testid="mobile-menu-button"]', { timeout: testConfig.timeouts.transition }),
    ]);
    log.info('E2E login successful', { component: 'e2e', action: 'login' });
  } else {
    log.info('E2E session already authenticated', { component: 'e2e', action: 'login' });
  }
});

// Navigation
When('I navigate to the {string} page', async ({ page }, pageName: string) => {
  await page.waitForTimeout(100);

  const pageRoutes: Record<string, string> = {
    'Dashboard': 'dashboard',
    'Monitors': 'monitors',
    'Montage': 'montage',
    'Events': 'events',
    'Timeline': 'timeline',
    'Notifications': 'notifications',
    'Profiles': 'profiles',
    'Settings': 'settings',
    'Server': 'server',
    'Logs': 'logs',
    'Live Activity': 'live-activity',
  };

  const route = pageRoutes[pageName];
  if (!route) {
    throw new Error(`Unknown page: ${pageName}`);
  }

  const navItemSelector = `[data-testid="nav-item-${route}"]`;
  const mobileMenuButton = page.getByTestId('mobile-menu-button');

  // Check if we need to open mobile menu
  if (await mobileMenuButton.isVisible()) {
    // Mobile layout - open menu first
    await mobileMenuButton.click();
    // Wait for menu to open and show the nav item
    await page.waitForTimeout(300);
  }

  // Click the nav item (filter to visible ones to avoid aria-hidden desktop nav)
  try {
    const clickableNav = page.locator(navItemSelector).locator('visible=true').first();
    await clickableNav.click({ timeout: testConfig.timeouts.transition });
  } catch {
    // Fallback: navigate directly via URL hash (some nav items may be scrolled
    // off-screen in the sidebar, e.g. the Logs link at the bottom)
    await page.evaluate((r) => { window.location.hash = `#/${r}`; }, route);
  }

  await page.waitForURL(new RegExp(`.*${route}`), { timeout: testConfig.timeouts.transition });
});

When('I navigate back', async ({ page }) => {
  await page.goBack();
  await page.waitForTimeout(500);
});

When('I refresh the page', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
});

// Page Headings
Then('I should see the page heading {string}', async ({ page }, heading: string) => {
  await expect(page.getByRole('heading', { name: new RegExp(heading, 'i') }).first()).toBeVisible();
});

// Generic assertions used across multiple features
Then('I should be on the {string} page', async ({ page }, pageName: string) => {
  const pageRoutes: Record<string, string> = { 'Events': 'events', 'Live Activity': 'live-activity', 'Notifications': 'notifications' };
  const route = pageRoutes[pageName];
  if (!route) {
    throw new Error(`E2E: no route mapped for page "${pageName}"`);
  }
  await expect(page).toHaveURL(new RegExp(`.*${route}$`), {
    timeout: testConfig.timeouts.transition,
  });
});

// Generic viewport steps used across multiple features
Given('the viewport is landscape phone size', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
});

Given('the viewport is mobile size', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
});

// iPad Air landscape. Callers assert layout with auto-retrying expects, so no
// settle wait here: the resize handlers (WidthProvider, the grid column hooks)
// run before the first assertion retry succeeds.
Given('the viewport is tablet size', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
});

// Phone held sideways: the shortest screen the app has to work on, and where
// a dialog that cannot scroll hides its own buttons (refs #322).
Given('the viewport is phone landscape size', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 });
});

// Shorter than the tallest confirmation the app renders (158px measured).
// Contrived as a window size, but a confirmation is a title, one sentence and
// two buttons, so nothing else makes one overflow. The overflow it produces is
// the real thing: what a phone in landscape hits with a longer translation, and
// what Dialog was fixed for in #322 while AlertDialog was not.
Given('the viewport is shorter than a dialog', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 140 });
});

// Generic dialog steps used across multiple features
When('I click outside the dialog', async ({ page }) => {
  await page.locator('body').click({ position: { x: 10, y: 10 } });
});

Then('the dialog should close', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeHidden({ timeout: testConfig.timeouts.transition });
});

When('I press Escape key', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});
