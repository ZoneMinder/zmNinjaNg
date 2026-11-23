import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { testConfig } from '../helpers/config';
import { log } from '../../src/lib/logger';

const { Given, When, Then } = createBdd();

let updatedProfileName = '';
let newProfileName = '';

// Profile Steps
Then('I should see at least {int} profile cards', async ({ page }, count: number) => {
  // Wait for profile data to load - the profiles page renders cards with data-testid="profile-card"
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(count);

  const profileCount = await page.locator('[data-testid="profile-card"]').count();
  log.info('E2E profiles found', { component: 'e2e', action: 'profiles_count', count: profileCount });
});

Then('I should see the active profile indicator', async ({ page }) => {
  // Wait for profiles to load first, then check for the active indicator
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(1);

  await expect(page.getByTestId('profile-active-indicator').first()).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
});

When('I open the edit dialog for the first profile', async ({ page }) => {
  await openProfileRowMenu(page.locator('[data-testid="profile-card"]').first());
  await page.locator('[data-testid^="profile-edit-button-"]').first().click();
});

Then('I should see the profile edit dialog', async ({ page }) => {
  await expect(page.getByTestId('profile-edit-dialog')).toBeVisible();
});

Then('I should see the profile delete dialog', async ({ page }) => {
  await expect(page.getByTestId('profile-delete-dialog')).toBeVisible();
});

When('I cancel profile deletion', async ({ page }) => {
  await page.getByTestId('profile-delete-cancel').click();
});

// New profile interaction steps

When('I change the profile name to a new value', async ({ page }) => {
  updatedProfileName = `Test Profile ${Date.now()}`;
  const nameInput = page.getByTestId('profile-edit-name')
    .or(page.getByLabel(/name|profile name/i));
  await nameInput.first().clear();
  await nameInput.first().fill(updatedProfileName);
});

When('I save profile edits', async ({ page }) => {
  const saveBtn = page.getByTestId('profile-edit-save')
    .or(page.getByRole('button', { name: /save/i }));
  await saveBtn.first().click();
  await page.waitForTimeout(500);
});

Then('the updated profile name should appear in the list', async ({ page }) => {
  if (!updatedProfileName) return;
  const profileCard = page.locator('[data-testid="profile-card"]').filter({ hasText: updatedProfileName });
  await expect(profileCard).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I click the add profile button', async ({ page }) => {
  // Wait for profiles page to be ready
  await expect.poll(async () => {
    return await page.locator('[data-testid="profile-card"]').count();
  }, { timeout: testConfig.timeouts.pageLoad }).toBeGreaterThanOrEqual(0);

  const addBtn = page.getByRole('button', { name: /add/i })
    .or(page.getByTestId('add-profile-button'));
  await addBtn.first().click();
  await page.waitForTimeout(300);
});

Then('I should see the profile form', async ({ page }) => {
  // The add profile page shows an "Add New Profile" heading and a form
  // It may be a dialog or a full page depending on the route
  const form = page.getByText(/Add New Profile/i)
    .or(page.getByTestId('profile-edit-dialog'))
    .or(page.getByRole('dialog'));
  await expect(form.first()).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I fill in new profile connection details', async ({ page }) => {
  // The add profile page has: Profile Name, Server URL, Username, Password.
  // Saving only actually creates a profile once discoverUrls()/login() succeed
  // against a real server (src/pages/ProfileForm.tsx handleSubmit), so this
  // must point at the real, reachable test server - a made-up host makes the
  // "Add" submit fail validation/connection and no profile is ever created.
  const { host, username, password } = testConfig.server;

  // Every field is asserted, not probed. A renamed testid used to leave
  // newProfileName unset, which sent the Then down its count-based fallback
  // where the pre-existing default profile satisfied it, so a broken add-server
  // form shipped green.
  const nameInput = page.getByTestId('setup-profile-name');
  await expect(nameInput).toBeVisible({ timeout: testConfig.timeouts.element });
  newProfileName = `New Profile ${Date.now()}`;
  await nameInput.fill(newProfileName);

  const urlInput = page.getByTestId('setup-portal-url');
  await expect(urlInput).toBeVisible({ timeout: testConfig.timeouts.element });
  await urlInput.fill(host);

  // Username and password must both be set or both left blank - a lone
  // username throws "credentials_incomplete" and blocks profile creation.
  if (username && password) {
    const usernameInput = page.getByTestId('setup-username');
    await expect(usernameInput).toBeVisible({ timeout: testConfig.timeouts.element });
    await usernameInput.fill(username);

    const passwordInput = page.getByTestId('setup-password');
    await expect(passwordInput).toBeVisible({ timeout: testConfig.timeouts.element });
    await passwordInput.fill(password);
  }
});

When('I save the new profile', async ({ page }) => {
  // The add profile page has an "Add" button
  const saveBtn = page.getByRole('button', { name: /^add$/i })
    .or(page.getByRole('button', { name: /save|connect/i }));
  // The previous step filled every required field, so a disabled Add button is
  // a form regression, not a condition to log past.
  await expect(saveBtn.first()).toBeEnabled({ timeout: testConfig.timeouts.element });
  await saveBtn.first().click();
  // Saving discovers URLs (trying multiple candidate API paths) and logs in
  // against the real server before the profile is created, then waits 1s
  // before navigating - this can take several seconds. Wait for that full
  // round-trip; a validation error leaves us on this page with no nav, which
  // the assertion step below correctly still fails on.
  await page.waitForURL((url) => !url.pathname.includes('/profiles/new'), {
    timeout: testConfig.timeouts.pageLoad,
  }).catch(() => {
    // Some flows (e.g. dialog-based add) don't navigate; the assertion step
    // below is the real source of truth.
  });
});

Then('I should see the new profile in the list', async ({ page }) => {
  // IMPORTANT: do not click "Cancel" here to "get back to the list" if no
  // card is visible yet. On this page "Cancel" is wired to abort an in-flight
  // discovery/login request (src/pages/ProfileForm.tsx handleCancelDiscovery)
  // whenever the previous step's waitForURL timed out because the real
  // network round-trip was still running - clicking it does not navigate,
  // it silently kills the profile creation that was about to succeed. Just
  // wait for the real outcome instead.
  //
  // The new profile must actually be present by name, not just "some card
  // exists" - the latter is already true from the pre-existing default
  // profile and would pass even if the add silently failed.
  // No count fallback: the fill step asserts newProfileName is set, so the only
  // honest assertion is that this profile, by name, is on screen.
  await expect(
    page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName })
  ).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

// Delete-profile scenarios (refs #217): profiles are local connection config,
// not data on the ZM server, so creating and deleting a throwaway one here is
// safe and lets these scenarios exercise a real delete/cancel instead of a
// dialog that can never even open (the delete button only renders once a
// second profile exists - see src/pages/Profiles.tsx `profiles.length > 1`).
Then('the newly added profile should appear in the list', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await expect(card).toBeVisible({ timeout: testConfig.timeouts.pageLoad });
});

When('I open the delete dialog for the newly added profile', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await openProfileRowMenu(card);
  await page.locator('[data-testid^="profile-delete-button-"]').click();
});

When('I confirm profile deletion', async ({ page }) => {
  await page.getByTestId('profile-delete-confirm').click();
});

Then('the newly added profile should no longer appear in the list', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await expect(card).toHaveCount(0, { timeout: testConfig.timeouts.pageLoad });
});

Then('the newly added profile should still appear in the list', async ({ page }) => {
  const card = page.locator('[data-testid="profile-card"]').filter({ hasText: newProfileName });
  await expect(card).toBeVisible({ timeout: testConfig.timeouts.element });
});

// The edit dialog is the tallest in the app, so it is where a dialog that
// cannot scroll first hides its own Save and Cancel buttons (refs #322).
function dialogBody(page: import('@playwright/test').Page) {
  return page.getByTestId('profile-edit-dialog').getByTestId('dialog-body');
}

async function isWithinViewport(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) return false;
  const viewport = locator.page().viewportSize();
  if (!viewport) throw new Error('E2E: no viewport size set');
  return box.y >= 0 && box.y + box.height <= viewport.height;
}

Then('the profile edit dialog should fit within the viewport', async ({ page }) => {
  expect(await isWithinViewport(page.getByTestId('profile-edit-dialog'))).toBe(true);
});

Then('the profile edit dialog body should be scrollable', async ({ page }) => {
  const overflow = await dialogBody(page).evaluate((el) => el.scrollHeight - el.clientHeight);
  // The fixture profile's fields are what make this dialog overflow a 375px
  // tall screen; if they ever stop doing so the scenario is vacuous, so this
  // is an assertion rather than a skip.
  expect(overflow).toBeGreaterThan(0);
});

When('I scroll the profile edit dialog to the bottom', async ({ page }) => {
  await dialogBody(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
});

Then('the profile edit save button should be within the viewport', async ({ page }) => {
  await expect(page.getByTestId('profile-edit-save')).toBeVisible();
  expect(await isWithinViewport(page.getByTestId('profile-edit-save'))).toBe(true);
});

Then('the dialog close button should be within the viewport', async ({ page }) => {
  const close = page.getByTestId('profile-edit-dialog').getByTestId('dialog-close-button');
  await expect(close).toBeVisible();
  expect(await isWithinViewport(close)).toBe(true);
});

// iPhone Duo in landscape reports its clock and wifi area as a right inset
// (top 0, right 84). The insets here are larger than that and narrow the
// screen enough that a 500px dialog centred on the full width overlaps the
// right one. iOS sets them inline on the root the same way (refs #595).
const SAFE_AREA = { top: 40, right: 150, bottom: 20, left: 0 };

Given('the viewport is phone landscape size with safe-area insets on the top and right', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 375 });
  await page.evaluate((insets) => {
    for (const [side, px] of Object.entries(insets)) {
      document.documentElement.style.setProperty(`--sai-${side}`, `${px}px`);
    }
  }, SAFE_AREA);
});

Then('the profile edit dialog should sit inside the safe area', async ({ page }) => {
  const box = await page.getByTestId('profile-edit-dialog').boundingBox();
  const close = await page
    .getByTestId('profile-edit-dialog')
    .getByTestId('dialog-close-button')
    .boundingBox();
  const viewport = page.viewportSize();
  if (!box || !close || !viewport) throw new Error('E2E: dialog or viewport not measurable');
  expect(box.x).toBeGreaterThanOrEqual(SAFE_AREA.left);
  expect(box.y).toBeGreaterThanOrEqual(SAFE_AREA.top);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - SAFE_AREA.right);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - SAFE_AREA.bottom);
  expect(close.x + close.width).toBeLessThanOrEqual(viewport.width - SAFE_AREA.right);
});

// AlertDialog is a separate component from Dialog and needs its own height cap
// (refs #322).
When('I open the delete all profiles dialog', async ({ page }) => {
  // Delete All sits behind the page's overflow menu, deliberately out of reach
  // of a stray tap (663df183). The step predates that move and had been
  // clicking a menu item that only exists while the menu is open.
  await openRadixMenu(page.getByTestId('profiles-menu'));
  await page.getByTestId('profiles-delete-all-button').click();
  await expect(page.getByTestId('profiles-delete-all-dialog')).toBeVisible({
    timeout: testConfig.timeouts.transition,
  });
});

Then('the delete all profiles dialog should fit within the viewport', async ({ page }) => {
  expect(await isWithinViewport(page.getByTestId('profiles-delete-all-dialog'))).toBe(true);
});

Then('the delete all profiles buttons should be reachable', async ({ page }) => {
  const dialog = page.getByTestId('profiles-delete-all-dialog');
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  for (const testId of ['profiles-delete-all-cancel', 'profiles-delete-all-confirm']) {
    const button = page.getByTestId(testId);
    await expect(button).toBeVisible();
    expect(await isWithinViewport(button), `${testId} is off screen`).toBe(true);
  }
  await page.getByTestId('profiles-delete-all-cancel').click();
});

Then('the profile server addresses should be hidden', async ({ page }) => {
  const first = page.locator('[data-testid="profile-card"]').first();
  await expect(first.locator('[data-testid^="profile-urls-"][data-testid$="-toggle"]')).toBeVisible({
    timeout: testConfig.timeouts.element,
  });
  // The toggle exists; the addresses it guards do not.
  await expect(
    first.locator('[data-testid^="profile-urls-"]:not([data-testid$="-toggle"])')
  ).toHaveCount(0);
});

When('I open the profile server addresses', async ({ page }) => {
  await page
    .locator('[data-testid="profile-card"]')
    .first()
    .locator('[data-testid^="profile-urls-"][data-testid$="-toggle"]')
    .click();
});

Then('I should see the profile portal address', async ({ page }) => {
  const urls = page
    .locator('[data-testid="profile-card"]')
    .first()
    .locator('[data-testid^="profile-urls-"]:not([data-testid$="-toggle"])');
  await expect(urls).toBeVisible({ timeout: testConfig.timeouts.element });
  // A real address, not an empty shell: every profile has a portal URL.
  await expect(urls).toContainText(/https?:\/\//);
});

/**
 * Open a Radix dropdown from the keyboard. Radix leaves a dismissable layer
 * over the page for a beat after any menu closes, and a click landing on it
 * never reaches the trigger, so a second open in the same scenario would
 * silently do nothing.
 */
export async function openRadixMenu(trigger: Locator) {
  await trigger.focus();
  await trigger.press('Enter');
}

/** Row actions live behind a per-row menu. */
export async function openProfileRowMenu(card: Locator) {
  await openRadixMenu(card.locator('[data-testid^="profile-actions-menu-"]'));
}
