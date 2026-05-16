import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../Settings';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const updateProfileSettings = vi.fn();
const logout = vi.fn();
const changeLanguage = vi.fn();

vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'profile-1', name: 'Test Profile' },
    settings: {
      viewMode: 'snapshot',
      displayMode: 'normal',
      snapshotRefreshInterval: 3,
      streamMaxFps: 10,
      streamScale: 50,
      defaultEventLimit: 100,
      disableLogRedaction: false,
      dashboardRefreshInterval: 30,
      hoverPreview: { eventsList: true, eventsGrid: false, monitorsList: true, monitorsGrid: false, dashboard: true, timeline: true, notifications: true },
      hoverPreviewPlaybackRate: 200,
    },
    hasProfile: true,
  }),
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: { currentProfile: () => { id: string } | null }) => unknown) =>
    selector({
      currentProfile: () => ({ id: 'profile-1' }),
    }),
}));

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({
    logout,
  }),
}));

vi.mock('../../stores/settings', () => ({
  DEFAULT_SETTINGS: {
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'light',
    snapshotRefreshInterval: 3,
    defaultEventLimit: 300,
    disableLogRedaction: false,
  },
  HOVER_PREVIEW_PLAYBACK_RATES: [50, 100, 150, 200, 400],
  DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE: 200,
  useSettingsStore: (selector: (state: { getProfileSettings: () => unknown; updateProfileSettings: typeof updateProfileSettings }) => unknown) =>
    selector({
      getProfileSettings: () => ({
        viewMode: 'snapshot',
        displayMode: 'normal',
        snapshotRefreshInterval: 3,
        defaultEventLimit: 100,
        disableLogRedaction: false,
        hoverPreview: { eventsList: true, eventsGrid: false, monitorsList: true, monitorsGrid: false, dashboard: true, timeline: true, notifications: true },
        hoverPreviewPlaybackRate: 200,
      }),
      updateProfileSettings,
    }),
}));

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

vi.mock('../../components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

describe('Settings Page', () => {
  beforeEach(() => {
    updateProfileSettings.mockClear();
    logout.mockClear();
    changeLanguage.mockClear();
  });

  it('updates view mode and event limit settings', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByTestId('settings-view-mode-switch'));
    expect(updateProfileSettings).toHaveBeenCalledWith('profile-1', { viewMode: 'streaming' });

    const eventLimitInput = screen.getByTestId('settings-event-limit');
    fireEvent.change(eventLimitInput, { target: { value: '400' } });
    expect(updateProfileSettings).toHaveBeenCalledWith('profile-1', { defaultEventLimit: 400 });
  });

  it('updates log redaction toggle', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByTestId('settings-log-redaction-switch'));
    expect(updateProfileSettings).toHaveBeenCalledWith('profile-1', { disableLogRedaction: true });
  });

  it('changes language selection', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByTestId('settings-language-select'));
    await user.click(screen.getByText('languages.es'));

    expect(changeLanguage).toHaveBeenCalledWith('es');
  });
});
