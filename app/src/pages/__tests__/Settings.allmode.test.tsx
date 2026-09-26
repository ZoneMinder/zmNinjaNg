import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Settings from '../Settings';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../stores/settings';
import { useProfileStore } from '../../stores/profile';
import { getMonitors } from '../../api/monitors';
import { seedProfiles, resetProfileFixture, fakeApiClient, makeProfile } from '../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../tests/fake-store-gates';
import { collapsedDisclosures, unfilterableText } from '../../tests/settings-search-gate';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));

// Interpolation values are appended so a test can assert which aggregate a
// section named, not just which key it used.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
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
vi.mock('../../components/settings/HiddenMonitorsSection', () => ({
  HiddenMonitorsSection: () => null,
}));
// AssistantSection and AdvancedSection pull in WebGPU/model-download/native-LLM
// probes and other effects unrelated to this test's two-tier-picker subject,
// which fire post-assert and produce act() noise. Stub them the same way.
vi.mock('../../components/settings/AssistantSection', () => ({
  AssistantSection: () => null,
}));
vi.mock('../../components/settings/AdvancedSection', () => ({
  AdvancedSection: () => null,
}));

const profileA = makeProfile('profile-a', { name: 'Home' });
const profileB = makeProfile('profile-b', { name: 'Work' });

function setSettings(id: string, overrides: Record<string, unknown>) {
  useSettingsStore.getState().updateProfileSettings(id, overrides);
}

// LiveStreamingSection reads the monitor count through React Query to explain
// its Streaming Mode recommendation (refs #385), so the page needs a client.
const queryWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('Settings page - All mode two-tier picker (refs #337)', () => {
  beforeEach(() => {
    seedProfiles([profileA, profileB], {
      current: ALL_PROFILES_ID,
      settings: { [profileA.id]: { viewMode: 'snapshot' }, [profileB.id]: { viewMode: 'snapshot' } },
    });
    installApiClient(profileA.id, fakeApiClient({ '/servers.json': { servers: [] } }));
    installApiClient(profileB.id, fakeApiClient({ '/servers.json': { servers: [] } }));
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('Streaming Mode reason follows the picked server, not the aggregate (refs #385)', async () => {
    vi.mocked(getMonitors).mockImplementation(async (_client, profileId) => ({
      monitors: Array.from({ length: profileId === profileA.id ? 3 : 20 }, (_, i) => ({ id: String(i + 1) })),
    }) as never);
    render(<Settings />, { wrapper: queryWrapper });

    expect((await screen.findByTestId('settings-view-mode-reason')).textContent).toBe(
      'settings.view_mode_reason_few_monitors:{"monitorCount":3}'
    );

    fireEvent.click(screen.getByTestId(`page-profile-picker-option-${profileB.id}`));

    await screen.findByText('settings.view_mode_reason_many_monitors:{"monitorCount":20}');
  });

  it('AppearanceSection (view-level) writes to the ALL bucket, not a real profile', async () => {
    render(<Settings />, { wrapper: queryWrapper });

    await screen.findByTestId('settings-tv-mode');
    fireEvent.click(screen.getByTestId('settings-tv-mode'));

    expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).tvMode).toBe(true);
  });

  // The other side of the same helper: single mode still writes the real
  // profile's own bucket, so the aggregate resolution never leaks into it.
  it('AppearanceSection writes to the real profile in single mode', async () => {
    useProfileStore.setState({ currentProfileId: profileA.id });

    render(<Settings />, { wrapper: queryWrapper });

    await screen.findByTestId('settings-tv-mode');
    fireEvent.click(screen.getByTestId('settings-tv-mode'));

    expect(useSettingsStore.getState().getProfileSettings(profileA.id).tvMode).toBe(true);
  });

  // Search gate (refs #531) over the sections only aggregate mode renders.
  it('search opens every disclosure and can hide every piece of text', () => {
    render(<Settings />, { wrapper: queryWrapper });
    fireEvent.click(screen.getByTestId('settings-search-button'));
    fireEvent.change(screen.getByTestId('settings-search-input'), { target: { value: 'zz' } });

    const sections = screen.getByTestId('settings-sections');
    expect(collapsedDisclosures(sections)).toEqual([]);
    expect(unfilterableText(sections)).toEqual([]);
  });

  it('shows the picker above the server-scoped block, defaulted to the first profile', () => {
    render(<Settings />, { wrapper: queryWrapper });
    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
  });

  // The All-Servers Streaming Mode row: without it the ALL bucket's viewMode
  // is unwritable, and the stream path's two-tier read has no way to be told
  // anything but "follow each server" (refs #337).
  describe('All Servers Streaming Mode', () => {
    it('imposes streaming on every server when picked', () => {
      render(<Settings />, { wrapper: queryWrapper });

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-streaming'));

      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeViewMode).toBe('streaming');
    });

    it('imposes snapshot on every server when picked', () => {
      render(<Settings />, { wrapper: queryWrapper });

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-snapshot'));

      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeViewMode).toBe('snapshot');
    });

    it('hands every server back its own mode when "Per server" is picked', () => {
      setSettings(ALL_PROFILES_ID, { allModeViewMode: 'streaming' });
      render(<Settings />, { wrapper: queryWrapper });

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-per-server'));

      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeViewMode).toBe('per-server');
    });

    // The row's description is what tells the user which state they are in;
    // the trigger's own label comes from Radix, which is stubbed here.
    it('describes the current state, defaulting to per-server', () => {
      const { unmount } = render(<Settings />, { wrapper: queryWrapper });
      expect(
        screen.getByText('settings.all_mode_streaming_per_server_desc')
      ).toBeInTheDocument();
      unmount();

      setSettings(ALL_PROFILES_ID, { allModeViewMode: 'snapshot' });
      render(<Settings />, { wrapper: queryWrapper });
      expect(
        screen.getByText('settings.all_mode_streaming_snapshot_desc')
      ).toBeInTheDocument();
    });

    // The legacy half of the label: only the retired All Servers sentinel has
    // no stored name, so this arm covers a pre-migration frame. The live case
    // is "names the group in both aggregate section headers" below (refs #337).
    it('names All Servers in its label', () => {
      render(<Settings />, { wrapper: queryWrapper });

      expect(
        screen.getByText('settings.all_mode_streaming_label:{"name":"profiles.all_servers"}')
      ).toBeInTheDocument();
    });

    it('is absent in single mode, where Streaming Mode is per-profile', () => {
      useProfileStore.setState({ currentProfileId: profileA.id });

      render(<Settings />, { wrapper: queryWrapper });

      expect(screen.queryByTestId('all-mode-streaming-select')).not.toBeInTheDocument();
    });
  });

  // The All Servers performance section: the one place the aggregate's
  // guardrails are editable, so what matters here is that its writes land in
  // the ALL bucket and that it stays out of single mode entirely (refs #337).
  describe('All Servers performance', () => {
    it('writes a reset knob back to the ALL bucket', () => {
      setSettings(ALL_PROFILES_ID, { allModeMaxStreams: 2 });
      render(<Settings />, { wrapper: queryWrapper });

      fireEvent.click(screen.getByTestId('all-mode-max-streams-reset'));

      expect(useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).allModeMaxStreams).toBe(
        DEFAULT_SETTINGS.allModeMaxStreams
      );
    });

    it('is absent in single mode, where none of these guardrails apply', () => {
      useProfileStore.setState({ currentProfileId: profileA.id });

      render(<Settings />, { wrapper: queryWrapper });

      expect(screen.queryByTestId('all-mode-max-streams-input')).not.toBeInTheDocument();
    });
  });

  // A group is an aggregate in its own right, with its own settings bucket:
  // every write these sections make lands under the group's id, never the ALL
  // sentinel's (refs #337).
  describe('a named group', () => {
    const GROUP = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: [profileA.id, profileB.id] };

    beforeEach(() => {
      useProfileStore.setState({ virtualProfiles: [GROUP], currentProfileId: GROUP.id });
    });

    it('writes a view-level setting to the group bucket', async () => {
      render(<Settings />, { wrapper: queryWrapper });

      await screen.findByTestId('settings-tv-mode');
      fireEvent.click(screen.getByTestId('settings-tv-mode'));

      expect(useSettingsStore.getState().getProfileSettings(GROUP.id).tvMode).toBe(true);
    });

    it('writes the imposed Streaming Mode to the group bucket', () => {
      render(<Settings />, { wrapper: queryWrapper });

      fireEvent.click(screen.getByTestId('all-mode-streaming-option-streaming'));

      expect(useSettingsStore.getState().getProfileSettings(GROUP.id).allModeViewMode).toBe('streaming');
    });

    // Both aggregate sections are titled after the aggregate they govern, so
    // "every tile" reads as the group's tiles rather than every server's.
    it('names the group in both aggregate section headers', () => {
      render(<Settings />, { wrapper: queryWrapper });

      expect(
        screen.getByText('settings.all_mode_streaming_label:{"name":"Backyard"}')
      ).toBeInTheDocument();
      expect(
        screen.getByText('settings.all_mode_perf.title:{"name":"Backyard"}')
      ).toBeInTheDocument();
    });

    it('writes a performance knob to the group bucket', () => {
      setSettings(GROUP.id, { allModeMaxStreams: 2 });
      render(<Settings />, { wrapper: queryWrapper });

      fireEvent.click(screen.getByTestId('all-mode-max-streams-reset'));

      expect(useSettingsStore.getState().getProfileSettings(GROUP.id).allModeMaxStreams).toBe(
        DEFAULT_SETTINGS.allModeMaxStreams
      );
    });
  });
});
