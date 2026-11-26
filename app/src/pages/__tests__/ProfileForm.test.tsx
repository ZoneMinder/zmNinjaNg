/**
 * Add-server, end to end against the real stores and a scripted server.
 *
 * Two things the old flow did that a user paid for on every first connect:
 * it logged in twice (discovery logged in to read ZM_PATH_ZMS and threw the
 * token away, then the form logged in again; ZoneMinder's login.json hashes
 * the password server-side at ~0.6s a call), and it slept a fixed second
 * before navigating. Both are asserted here as what the server saw and when
 * the user moved on, not as which function was called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));
const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
  useSearchParams: () => [new URLSearchParams('returnTo=/monitors')],
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// The stream-path frame check (refs #613) goes through lib/http.
const httpGet = vi.fn();
vi.mock('../../lib/http', async (orig) => ({
  ...(await orig<typeof import('../../lib/http')>()),
  httpGet: (...args: unknown[]) => httpGet(...args),
}));

import { toast } from 'sonner';
import ProfileForm from '../ProfileForm';
import { seedProfiles, resetProfileFixture, fakeApiClient } from '../../tests/profile-fixture';
import { installDefaultApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useProfileStore } from '../../stores/profile';
import { useAuthStore } from '../../stores/auth';

const server = (zmsPath = '/zm/cgi-bin/nph-zms', extra: Record<string, unknown> = {}) =>
  fakeApiClient({
    '/host/getVersion.json': { version: '1.36.0', apiversion: '2.0' },
    '/host/login.json': {
      access_token: 'tok', access_token_expires: 3600,
      refresh_token: 'ref', refresh_token_expires: 86400,
      version: '1.36.0', apiversion: '2.0',
    },
    'ZM_PATH_ZMS': { config: { Value: zmsPath } },
    'ZM_GO2RTC_PATH': { config: { Value: '' } },
    '/servers.json': { servers: [] },
    ...extra,
  });

describe('ProfileForm add-server', () => {
  let client: ReturnType<typeof server>;

  beforeEach(() => {
    seedProfiles([], { current: null });
    client = server();
    installDefaultApiClient(client);
    navigateSpy.mockClear();
    vi.mocked(toast.warning).mockClear();
  });
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // The background glow hangs off the right edge, and the page scrolls, so
  // the glow made it swipe sideways unless clipped (refs #587).
  it('clips the background glow so the page does not scroll sideways', () => {
    render(<ProfileForm />);
    expect(screen.getByTestId('setup-background').className).toContain('overflow-hidden');
  });

  // A min-height root grows to fit the form, so nothing scrolls and iOS has
  // nothing to move when the keyboard covers a field (refs #587).
  it('scrolls inside a screen-high page so iOS can lift a field above the keyboard', () => {
    render(<ProfileForm />);
    const page = screen.getByTestId('setup-background').parentElement!;
    expect(page.className).toMatch(/\bh-dvh\b/);
    expect(page.className).not.toContain('min-h-screen');
  });

  it('logs in once, saves the profile, and moves on without a pause', async () => {
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByTestId('setup-portal-url'));
    await user.type(screen.getByTestId('setup-portal-url'), 'http://zm.example.com');
    await user.type(screen.getByTestId('setup-username'), 'admin');
    await user.type(screen.getByTestId('setup-password'), 'pw');
    await user.click(screen.getByTestId('connect-button'));

    // The destination page is the confirmation; no fixed sleep in between.
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/monitors'), { timeout: 900 });

    const logins = client.calls.filter((c) => c.method === 'POST' && c.url.includes('/host/login.json'));
    expect(logins).toHaveLength(1);

    const profile = useProfileStore.getState().profiles[0];
    expect(profile?.cgiUrl).toBe('http://zm.example.com/zm/cgi-bin/nph-zms');
    expect(useAuthStore.getState().slices[profile.id]?.accessToken).toBe('tok');
    expect(toast.warning).not.toHaveBeenCalled();
  });

  // ZM 1.39.45 answers an empty ZM_PATH_ZMS (refs #584, #603): the saved path
  // is a guess, and the user hears so after the form moves on.
  it('warns that the stream path is a guess when the server reports none', async () => {
    client = server('');
    installDefaultApiClient(client);
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByTestId('setup-portal-url'));
    await user.type(screen.getByTestId('setup-portal-url'), 'http://zm.example.com');
    await user.type(screen.getByTestId('setup-username'), 'admin');
    await user.type(screen.getByTestId('setup-password'), 'pw');
    await user.click(screen.getByTestId('connect-button'));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/monitors'));
    // Long enough to read a URL; a few seconds was missed (refs #603).
    expect(toast.warning).toHaveBeenCalledWith('setup.cgi_url_guessed', { duration: 15_000, closeButton: true });
    // Kept on the profile, so the edit dialog can still say so later.
    expect(useProfileStore.getState().profiles[0]?.cgiUrlGuessed).toBe(true);
  });

  // Discovery asked both stream URLs for a frame and got none (refs #613).
  it('warns when neither streaming URL returned a frame', async () => {
    client = server('/zm/cgi-bin/nph-zms', {
      '/monitors.json': { monitors: [{ Monitor: { Id: '4', Capturing: 'Always' } }] },
    });
    installDefaultApiClient(client);
    httpGet.mockResolvedValue({ status: 404, statusText: '', data: '', headers: { 'content-type': 'text/html' } });
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByTestId('setup-portal-url'));
    await user.type(screen.getByTestId('setup-portal-url'), 'http://zm.example.com');
    await user.type(screen.getByTestId('setup-username'), 'admin');
    await user.type(screen.getByTestId('setup-password'), 'pw');
    await user.click(screen.getByTestId('connect-button'));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/monitors'));
    expect(toast.warning).toHaveBeenCalledWith('setup.cgi_url_unverified', { duration: 15_000, closeButton: true });
    expect(useProfileStore.getState().profiles[0]?.cgiUrlGuessed).toBe(true);
  });

  // A failed connect used to leave nothing to do but try again (refs #613).
  it('saves a profile whose login fails when the user asks to save anyway', async () => {
    client = server('/zm/cgi-bin/nph-zms', {
      '/host/login.json': () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); },
    });
    installDefaultApiClient(client);
    const user = userEvent.setup();
    render(<ProfileForm />);

    await user.clear(screen.getByTestId('setup-portal-url'));
    await user.type(screen.getByTestId('setup-portal-url'), 'http://zm.example.com');
    await user.type(screen.getByTestId('setup-username'), 'admin');
    await user.type(screen.getByTestId('setup-password'), 'wrong');
    await user.click(screen.getByTestId('connect-button'));
    await user.click(await screen.findByTestId('setup-save-anyway'));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/monitors'));
    const profile = useProfileStore.getState().profiles[0];
    expect(profile).toMatchObject({
      portalUrl: 'http://zm.example.com/zm',
      apiUrl: 'http://zm.example.com/zm/api',
      cgiUrl: 'http://zm.example.com/zm/cgi-bin/nph-zms',
      username: 'admin',
    });
    expect(useAuthStore.getState().slices[profile.id]?.accessToken ?? null).toBeNull();
  });
});

