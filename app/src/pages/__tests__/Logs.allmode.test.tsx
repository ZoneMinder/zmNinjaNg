import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Logs from '../Logs';
import { getZMLogs } from '../../api/logs';
import { getSession } from '../../services/sessions';
import { ALL_PROFILES_ID } from '../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../stores/logs', () => ({
  useLogStore: (selector: (state: { logs: unknown[]; clearLogs: () => void }) => unknown) =>
    selector({ logs: [], clearLogs: vi.fn() }),
}));

vi.mock('../../lib/logger', () => ({
  logger: { getLevel: () => 1, setLevel: vi.fn() },
  log: { server: vi.fn(), profileService: vi.fn(), auth: vi.fn() },
  LogLevel: { DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, NONE: 5 },
}));

vi.mock('../../api/logs', () => ({
  getZMLogs: vi.fn().mockResolvedValue({ logs: [] }),
  getZMLogLevel: () => 'INFO',
  getUniqueZMComponents: () => [],
}));

vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../lib/log-file', () => ({
  getLogFile: () => ({
    truncate: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    revealLocation: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    capabilities: { share: false, reveal: false },
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

describe('Logs page - All mode profile picker (refs #337)', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows the picker defaulted to the first profile, and switches the server-log source on pick', async () => {
    const [profileA, profileB] = seedProfiles(
      [makeProfile('profile-a', { name: 'Home' }), makeProfile('profile-b', { name: 'Work' })],
      { current: ALL_PROFILES_ID },
    );

    render(<Logs />);

    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('log-source-server'));
    // getSession(profile.id).client is the real per-profile session client
    // (fake HTTP boundary); each profile's session builds its own client
    // instance, so identity pins which profile's session actually fetched.
    await waitFor(() => expect(vi.mocked(getZMLogs).mock.calls.at(-1)?.[0]).toBe(getSession(profileA.id).client));

    fireEvent.click(screen.getByTestId('page-profile-picker-option-profile-b'));
    await waitFor(() => expect(vi.mocked(getZMLogs).mock.calls.at(-1)?.[0]).toBe(getSession(profileB.id).client));
  });

  it('saves the log level, a component override and log redaction to the aggregate bucket, leaving the member unchanged (refs #536)', async () => {
    const user = userEvent.setup();
    const [profileA] = seedProfiles(
      [makeProfile('profile-a', { name: 'Home' }), makeProfile('profile-b', { name: 'Work' })],
      { current: ALL_PROFILES_ID },
    );

    render(<Logs />);

    // The top-toolbar level picker: must write the aggregate's own bucket,
    // never the picked member's (this is the fix under review; it used to
    // write via `currentProfile?.id`, which in All mode is the picked
    // member's id).
    fireEvent.click(screen.getByTestId('log-level-option-ERROR'));
    fireEvent.click(screen.getByTestId('component-log-levels-toggle'));
    fireEvent.change(screen.getByTestId('component-log-level-Auth'), { target: { value: '1' } });
    await user.click(screen.getByTestId('settings-log-redaction-switch'));

    const { getProfileSettings } = useSettingsStore.getState();
    expect(getProfileSettings(ALL_PROFILES_ID).logLevel).toBe(4);
    expect(getProfileSettings(ALL_PROFILES_ID).componentLogLevels.Auth).toBe(1);
    expect(getProfileSettings(ALL_PROFILES_ID).disableLogRedaction).toBe(true);
    expect(getProfileSettings(profileA.id).logLevel).not.toBe(4);
    expect(getProfileSettings(profileA.id).componentLogLevels.Auth).toBeUndefined();
    expect(getProfileSettings(profileA.id).disableLogRedaction).toBe(false);
  });
});
