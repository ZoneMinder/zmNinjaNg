import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import Settings from '../Settings';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { seedProfiles, resetProfileFixture, asProfileId, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';
import { getMonitors } from '../../api/monitors';
import { SELECTION_SCOPED_SETTINGS, SERVER_SCOPED_SETTINGS } from '../../stores/settings-scope';
import { ThemeProvider, useTheme } from '../../components/theme-provider';
import { collapsedDisclosures, unfilterableText, visibleText } from '../../tests/settings-search-gate';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
// The kiosk-PIN row calls hasSecureValue, which tests/fake-secure-storage.ts
// does not export (fixture gap - reported separately). Patched locally rather
// than editing the shared fixture.
vi.mock('../../lib/security/secureStorage', async () => {
  const fake = await import('../../tests/fake-secure-storage');
  return { ...fake, hasSecureValue: async (key: string) => (await fake.getSecureValue(key)) !== null };
});
vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn(async () => ({ monitors: [] })) }));

const changeLanguage = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      changeLanguage,
    },
  }),
}));

const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});

// data-select-value exposes the controlled value, which the real Radix value
// display would show, so a test can read what a select currently holds.
vi.mock('../../components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>
      <div data-select-value={value}>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" {...props} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

const PROFILE = makeProfile('profile-1', { name: 'Home', portalUrl: 'https://profile-1.test' });

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" data-testid="theme-probe" onClick={() => setTheme('dark')}>
      {theme}
    </button>
  );
}

// The page reads the monitor count through React Query and links to other
// routes, so it needs a client and a router; the theme row reads useTheme.
function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<><Settings /><ThemeProbe /></>} />
            <Route path="/notifications" element={<p>notifications-page</p>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const stored = () => useSettingsStore.getState().getProfileSettings(asProfileId('profile-1'));

async function search(query: string) {
  fireEvent.click(screen.getByTestId('settings-search-button'));
  fireEvent.change(screen.getByTestId('settings-search-input'), { target: { value: query } });
}

describe('Settings Page', () => {
  beforeEach(() => {
    seedProfiles([PROFILE], { settings: { 'profile-1': { viewMode: 'snapshot', dateFormat: 'custom', timeFormat: 'custom' } } });
    changeLanguage.mockClear();
    vi.mocked(getMonitors).mockResolvedValue({ monitors: [] } as never);
    // Section and fold open state persists; start every test from the defaults.
    localStorage.clear();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('updates view mode and event limit settings', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByTestId('settings-view-mode-switch'));
    expect(stored().viewMode).toBe('streaming');
    expect(stored().viewModeChosen).toBe(true);

    fireEvent.change(screen.getByTestId('settings-event-limit'), { target: { value: '400' } });
    expect(stored().defaultEventLimit).toBe(400);
  });

  it('changes language selection', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByTestId('settings-language-select'));
    await user.click(screen.getByText('languages.es'));

    expect(changeLanguage).toHaveBeenCalledWith('es');
  });

  it('lists the sections in the spec order', () => {
    renderSettings();
    const ids = Array.from(
      screen.getByTestId('settings-sections').querySelectorAll(':scope > section[data-testid]')
    ).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'settings-section-general',
      'settings-section-live-streaming',
      'settings-section-events-playback',
      'settings-section-network',
      'settings-section-assistant',
      'settings-section-more',
    ]);
  });

  // With one profile the server's name says nothing the page does not, so the
  // server rows run on as plain rows with no divider or name.
  it('has no profile picker and names no server with one profile selected', () => {
    renderSettings();
    expect(screen.queryByTestId('page-profile-picker')).toBeNull();
    expect(screen.getAllByTestId('settings-server-subcard').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('settings-subcard-name')).toEqual([]);
    expect(visibleText(screen.getByTestId('settings-sections'))).not.toContain('Home');
  });

  // With one profile, server rows continue the section's card: no second card
  // and no gap between the selection rows and the server rows.
  it('keeps server rows in the same card as the section rows before them', () => {
    renderSettings();
    search('zz'); // mounts every fold
    const card = (testId: string) => screen.getByTestId(testId).closest('[data-settings-card]');
    expect(card('hidden-monitors-dropdown')).toBe(card('settings-show-developer-notices'));
    expect(card('stream-fps-input')).toBe(card('settings-live-fullscreen-switch'));
    expect(card('settings-thumbnail-chain-trigger')).toBe(card('settings-event-limit'));
    expect(card('settings-force-disable-multiport-switch')).toBe(card('settings-live-fullscreen-switch'));
    expect(card('settings-api-timeout-input')).toBe(card('settings-bandwidth-mode-switch'));
  });

  it('search filters a server row on its own with one profile selected', () => {
    renderSettings();
    search('api_timeout');
    const text = visibleText(screen.getByTestId('settings-section-network'));
    expect(text).toContain('settings.api_timeout');
    expect(text).not.toContain('settings.allow_self_signed_certs');
    expect(text).not.toContain('settings.bandwidth_mode');
  });

  // Only the six topics have caps headers; Hidden monitors is a row of its card.
  it('shows Hidden monitors as a card row whose button opens the monitor list', async () => {
    vi.mocked(getMonitors).mockResolvedValue({
      monitors: [{ Monitor: { Id: '7', Name: 'Porch' } }],
    } as never);
    const user = userEvent.setup();
    renderSettings();
    expect(screen.queryByTestId('settings-section-hidden-monitors-toggle')).toBeNull();
    const row = screen.getByText('settings.hidden_monitors.section').closest('[data-settings-card] > *');
    expect(row?.contains(screen.getByTestId('hidden-monitors-dropdown'))).toBe(true);

    const button = screen.getByTestId('hidden-monitors-dropdown');
    await vi.waitFor(() => expect(button).not.toBeDisabled());
    await user.click(button);
    expect((await screen.findByTestId('hidden-monitors-list')).textContent).toContain('Porch');
  });

  // Placement gate (spec "Contract change"): a server-scoped row sits in the
  // server sub-card and a selection-scoped row never does. Each key names one
  // control of its row; a key added to a scope list fails here until mapped.
  it('puts every server-scoped row in the server sub-card and no selection-scoped row there', () => {
    const selectionRows: Record<(typeof SELECTION_SCOPED_SETTINGS)[number], string | null> = {
      startScreen: 'settings-start-screen-select',
      dateFormat: 'settings-date-format',
      timeFormat: 'settings-time-format',
      customDateFormat: 'settings-custom-date-format',
      customTimeFormat: 'settings-custom-time-format',
      theme: 'settings-theme-select',
      hoverPreview: 'settings-hover-preview-trigger',
      hoverPreviewPlaybackRate: 'settings-hover-preview-playback-rate',
      insomnia: 'settings-insomnia-switch',
      landscapeFullscreen: 'settings-landscape-fullscreen-switch',
      tvMode: 'settings-tv-mode',
      monitorsPerPage: 'settings-monitors-per-page',
      skipOfflineMonitors: 'settings-skip-offline-monitors-switch',
      monitorDetailFullscreen: 'settings-live-fullscreen-switch',
      defaultEventLimit: 'settings-event-limit',
      eventVideoAutoplay: 'settings-event-autoplay-switch',
      eventPlaybackFullscreen: 'settings-event-fullscreen-switch',
      monitorDetailRecentEventsCount: 'settings-monitor-recent-events-count',
      eventContext: 'event-context-window-30',
      eventContextReplayTiles: 'settings-replay-tiles-12',
      bandwidthMode: 'settings-bandwidth-mode-switch',
      // On the Logs page, not here.
      logLevel: null,
      componentLogLevels: null,
      disableLogRedaction: null,
    };
    // A settings card sits wholly inside or outside a sub-card, so the
    // assistant keys rendered further down the same card as the enable switch
    // (backend-dependent rows) share its placement.
    const serverRows: Record<(typeof SERVER_SCOPED_SETTINGS)[number], string> = {
      excludedMonitorIds: 'hidden-monitors-dropdown',
      viewMode: 'settings-view-mode-switch',
      snapshotRefreshInterval: 'settings-refresh-interval',
      streamMaxFps: 'stream-fps-input',
      streamScale: 'stream-scale-input',
      streamingMethod: 'settings-go2rtc-switch',
      webrtcProtocols: 'protocol-webrtc-checkbox',
      webrtcUseStun: 'settings-webrtc-use-stun-switch',
      showProtocolLabel: 'settings-protocol-label-switch',
      thumbnailFallbackChain: 'settings-thumbnail-chain-trigger',
      allowSelfSignedCerts: 'settings-self-signed-certs-switch',
      trustedCertFingerprint: 'settings-self-signed-certs-switch',
      apiTimeoutSeconds: 'settings-api-timeout-input',
      forceDisableMultiPort: 'settings-force-disable-multiport-switch',
      assistantEnabled: 'assistant-enabled-toggle',
      assistantInToolbar: 'assistant-enabled-toggle',
      assistantBackend: 'assistant-enabled-toggle',
      assistantModelId: 'assistant-enabled-toggle',
      assistantOllamaBaseUrl: 'assistant-enabled-toggle',
      assistantOllamaModel: 'assistant-enabled-toggle',
      assistantTemperature: 'assistant-enabled-toggle',
      assistantTimeoutSec: 'assistant-enabled-toggle',
      assistantHistoryTurns: 'assistant-enabled-toggle',
    };
    renderSettings();
    // Any search opens every fold, so every row is mounted.
    search('zz');

    const inSubCard = (testId: string) =>
      screen.getByTestId(testId).closest('[data-testid="settings-server-subcard"]') !== null;
    for (const [key, testId] of Object.entries(serverRows)) {
      expect(inSubCard(testId), key).toBe(true);
    }
    for (const [key, testId] of Object.entries(selectionRows)) {
      if (testId) expect(inSubCard(testId), key).toBe(false);
    }
  });

  it('theme row and the header theme state are one', () => {
    renderSettings();
    const themeValue = () =>
      screen.getByTestId('settings-theme-select').closest('[data-select-value]')!.getAttribute('data-select-value');

    fireEvent.click(screen.getByTestId('settings-theme-option-light'));
    expect(screen.getByTestId('theme-probe').textContent).toBe('light');
    expect(stored().theme).toBe('light');

    fireEvent.click(screen.getByTestId('theme-probe'));
    expect(themeValue()).toBe('dark');
  });

  it('keep screen awake row writes the key and bucket the sidebar toggle writes', () => {
    renderSettings();
    const toggle = screen.getByTestId('settings-insomnia-switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(stored().insomnia).toBe(true);

    act(() => useSettingsStore.getState().updateProfileSettings('profile-1', { insomnia: false }));
    expect(screen.getByTestId('settings-insomnia-switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('sideways row turns landscapeFullscreen off for the current selection', () => {
    renderSettings();
    const toggle = screen.getByTestId('settings-landscape-fullscreen-switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(stored().landscapeFullscreen).toBe(false);
  });

  it('More settings links only to Notifications', async () => {
    const user = userEvent.setup();
    renderSettings();
    const links = Array.from(screen.getByTestId('settings-section-more').querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/notifications']);
    await user.click(screen.getByTestId('settings-link-notifications'));
    expect(screen.getByText('notifications-page')).toBeVisible();
  });

  it('General log rows save to the current selection, and Log level clears component overrides', async () => {
    const user = userEvent.setup();
    renderSettings();
    const general = within(screen.getByTestId('settings-section-general'));

    fireEvent.click(general.getByTestId('component-log-levels-toggle'));
    fireEvent.change(general.getByTestId('component-log-level-Auth'), { target: { value: '1' } });
    expect(stored().componentLogLevels.Auth).toBe(1);

    await user.click(general.getByTestId('settings-log-level-option-ERROR'));
    expect(stored().logLevel).toBe(3);
    expect(stored().componentLogLevels).toEqual({});

    await user.click(general.getByTestId('settings-log-redaction-switch'));
    expect(stored().disableLogRedaction).toBe(true);
    expect(general.getByTestId('settings-log-redaction-warning').textContent).toBe(
      'settings.disable_log_redaction_warning'
    );
  });

  it('search finds a component inside the folded Component log levels row', () => {
    renderSettings();
    expect(screen.queryByText('SecureStorage')).toBeNull();
    search('SecureStorage');
    expect(visibleText(screen.getByTestId('settings-sections'))).toContain('SecureStorage');
    expect(screen.getByTestId('component-log-levels-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it.each([
    ['Previews', 'hover_preview.events_grid', 'settings.appearance.hover_preview.events_grid'],
    ['Advanced streaming', 'webrtc_use_stun_desc', 'settings.webrtc_use_stun_desc'],
    ['WebRTC protocols', 'protocol_mse_desc', 'settings.protocol_mse_desc'],
    ['Event thumbnails', 'thumbnail_chain.objdetect', 'settings.appearance.thumbnail_chain.objdetect'],
  ])('search finds a row inside the folded %s part', (_part, query, text) => {
    renderSettings();
    expect(screen.queryByText(text)).toBeNull();
    search(query);
    expect(visibleText(screen.getByTestId('settings-sections'))).toContain(text);
  });

  // Search gate (refs #531): the whole page, so new settings are covered too.
  it('search opens every disclosure and can hide every piece of text', async () => {
    renderSettings();
    search('zz-no-such-setting');

    const sections = screen.getByTestId('settings-sections');
    expect(collapsedDisclosures(sections)).toEqual([]);
    expect(unfilterableText(sections)).toEqual([]);
    expect(visibleText(sections)).toEqual([]);
    expect(screen.getByTestId('settings-search-empty').textContent).toBe('settings.search.no_results');
  });

  it('search finds a row in a collapsed section, and clearing restores the page', async () => {
    const user = userEvent.setup();
    localStorage.setItem('zmng-settings-section-open-live-streaming', 'false');
    renderSettings();
    expect(screen.queryByTestId('settings-force-disable-multiport-switch')).toBeNull();

    await user.click(screen.getByTestId('settings-search-button'));
    await user.type(screen.getByTestId('settings-search-input'), 'multiport');
    const sections = screen.getByTestId('settings-sections');
    expect(visibleText(sections)).toContain('settings.force_disable_multiport');

    await user.click(screen.getByTestId('settings-search-clear'));
    expect(screen.queryByTestId('settings-force-disable-multiport-switch')).toBeNull();
    expect(visibleText(sections)).toContain('settings.section_general');
  });
});
