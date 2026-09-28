import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import Logs from '../Logs';
import { seedProfiles, resetProfileFixture, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

// Real Radix Select needs pointer capture jsdom doesn't implement; mock it to
// plain buttons like Logs.allmode.test.tsx and Settings.test.tsx do, so the
// level picker is directly clickable.
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

const clearLogs = vi.fn();
const logs = [
  {
    id: 'log-1',
    timestamp: '2024-01-01T00:00:00Z',
    level: 'INFO',
    message: 'Auth log',
    context: { component: 'Auth' },
  },
  {
    id: 'log-2',
    timestamp: '2024-01-01T00:00:01Z',
    level: 'WARN',
    message: 'API log',
    context: { component: 'API' },
  },
  {
    id: 'log-3',
    timestamp: '2024-01-01T00:00:02Z',
    level: 'ERROR',
    message: 'Unassigned log',
  },
];

vi.mock('../../stores/logs', () => ({
  useLogStore: (selector: (state: { logs: any[]; clearLogs: typeof clearLogs }) => unknown) =>
    selector({
      logs,
      clearLogs,
    }),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    getLevel: () => 1,
    setLevel: vi.fn(),
  },
  // A Proxy rather than a fixed set of names: seeding the real profile/auth
  // stores now exercises whichever component logger they call
  // (log.profileService, log.auth, ...), not just the log.server this page uses.
  log: new Proxy({}, { get: () => vi.fn() }),
  LogLevel: {
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    NONE: 5,
  },
}));

// One ZoneMinder server log line of the shape zmc writes: the ffmpeg command
// with the camera credential in it (refs #307).
vi.mock('../../api/logs', () => ({
  getZMLogs: vi.fn().mockResolvedValue({
    logs: [
      {
        Log: {
          Id: 1,
          TimeKey: '1700000000.0',
          Component: 'zmc_m1',
          Level: 0,
          Message: "Starting capture: ffmpeg -i rtsp://admin:S3cret@cam.lan:554/h264",
          File: 'zmc.cpp',
          Line: '42',
          Pid: '123',
        },
      },
    ],
  }),
  getZMLogLevel: () => 'INFO',
  getUniqueZMComponents: () => ['zmc_m1'],
}));

vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn(),
  },
}));

vi.mock('../../lib/version', () => ({
  getAppVersion: () => '1.0.0',
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockTruncate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/log-file', () => ({
  getLogFile: () => ({
    truncate: mockTruncate,
    readAll: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    revealLocation: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    capabilities: { share: false, reveal: false },
  }),
}));

describe('Logs Page', () => {
  beforeEach(() => {
    seedProfiles(['profile-1']);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('renders log entries and clears logs', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    expect(screen.getAllByTestId('log-entry')).toHaveLength(3);

    await user.click(screen.getByTestId('logs-clear-button'));
    await user.click(screen.getByTestId('logs-clear-confirm'));
    expect(clearLogs).toHaveBeenCalled();
    expect(mockTruncate).toHaveBeenCalled();
  });

  it('filters logs by component', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    await user.click(screen.getByTestId('log-component-filter-trigger'));
    await user.click(screen.getByTestId('log-component-filter-checkbox-auth'));

    expect(screen.getAllByTestId('log-entry')).toHaveLength(1);
  });

  it('redacts the camera credential in a ZoneMinder server log line', async () => {
    const user = userEvent.setup();
    render(<Logs />);

    await user.click(screen.getByTestId('log-source-server'));

    const entry = await screen.findByText(/Starting capture/);
    expect(entry.textContent).not.toContain('S3cret');
    expect(entry.textContent).toContain('cam.lan');
  });

  it('keeps the toolbar level control, which clears overrides, and has no log settings strip (refs #536)', () => {
    useSettingsStore.getState().updateProfileSettings(asProfileId('profile-1'), { componentLogLevels: { Auth: 1 } });
    render(<Logs />);

    expect(screen.queryByTestId('logs-log-settings')).toBeNull();
    expect(screen.queryByTestId('settings-log-redaction-switch')).toBeNull();

    fireEvent.click(screen.getByTestId('log-level-option-ERROR'));
    const stored = useSettingsStore.getState().getProfileSettings(asProfileId('profile-1'));
    expect(stored.logLevel).toBe(4);
    expect(stored.componentLogLevels).toEqual({});
  });
});
