import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import Settings from '../Settings';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { seedProfiles, resetProfileFixture, asProfileId } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { useSettingsStore } from '../../stores/settings';
import { collapsedDisclosures, unfilterableText, visibleText } from '../../tests/settings-search-gate';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
// AdvancedSection's kiosk-PIN check calls hasSecureValue, which
// tests/fake-secure-storage.ts does not export (fixture gap - reported
// separately). Patched locally rather than editing the shared fixture.
vi.mock('../../lib/security/secureStorage', async () => {
  const fake = await import('../../tests/fake-secure-storage');
  return { ...fake, hasSecureValue: async (key: string) => (await fake.getSecureValue(key)) !== null };
});

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

// HiddenMonitorsSection pulls in React Query (useQueryClient/useQuery), which
// needs a QueryClientProvider. It is not the subject of these tests, so stub it.
vi.mock('../../components/settings/HiddenMonitorsSection', () => ({
  HiddenMonitorsSection: () => null,
}));


// LiveStreamingSection reads the monitor count through React Query to explain
// its Streaming Mode recommendation (refs #385), so the page needs a client.
const queryWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('Settings Page', () => {
  beforeEach(() => {
    seedProfiles(['profile-1']);
    changeLanguage.mockClear();
    // Section open state persists; start every test from the defaults.
    localStorage.clear();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('updates view mode and event limit settings', async () => {
    const user = userEvent.setup();
    render(<Settings />, { wrapper: queryWrapper });

    await user.click(screen.getByTestId('settings-view-mode-switch'));
    let stored = useSettingsStore.getState().getProfileSettings(asProfileId('profile-1'));
    expect(stored.viewMode).toBe('streaming');
    expect(stored.viewModeChosen).toBe(true);

    const eventLimitInput = screen.getByTestId('settings-event-limit');
    fireEvent.change(eventLimitInput, { target: { value: '400' } });
    stored = useSettingsStore.getState().getProfileSettings(asProfileId('profile-1'));
    expect(stored.defaultEventLimit).toBe(400);
  });

  it('updates log redaction toggle', async () => {
    const user = userEvent.setup();
    render(<Settings />, { wrapper: queryWrapper });

    // Advanced is collapsed by default; expand it to reach its controls.
    await user.click(screen.getByTestId('settings-section-advanced-toggle'));
    await user.click(screen.getByTestId('settings-log-redaction-switch'));
    const stored = useSettingsStore.getState().getProfileSettings(asProfileId('profile-1'));
    expect(stored.disableLogRedaction).toBe(true);
  });

  it('changes language selection', async () => {
    const user = userEvent.setup();
    render(<Settings />, { wrapper: queryWrapper });

    await user.click(screen.getByTestId('settings-language-select'));
    await user.click(screen.getByText('languages.es'));

    expect(changeLanguage).toHaveBeenCalledWith('es');
  });

  // Search gate (refs #531): the whole page, so new settings are covered too.
  it('search opens every disclosure and can hide every piece of text', async () => {
    const user = userEvent.setup();
    render(<Settings />, { wrapper: queryWrapper });

    await user.click(screen.getByTestId('settings-search-button'));
    await user.type(screen.getByTestId('settings-search-input'), 'zz-no-such-setting');

    const sections = screen.getByTestId('settings-sections');
    expect(collapsedDisclosures(sections)).toEqual([]);
    expect(unfilterableText(sections)).toEqual([]);
    expect(visibleText(sections)).toEqual([]);
    expect(screen.getByTestId('settings-search-empty').textContent).toBe('settings.search.no_results');
  });

  it('search finds a row in a collapsed section, and clearing restores the page', async () => {
    const user = userEvent.setup();
    render(<Settings />, { wrapper: queryWrapper });
    expect(screen.queryByTestId('settings-log-redaction-switch')).toBeNull();

    await user.click(screen.getByTestId('settings-search-button'));
    await user.type(screen.getByTestId('settings-search-input'), 'log_redaction');
    const sections = screen.getByTestId('settings-sections');
    expect(visibleText(sections)).toContain('settings.disable_log_redaction');

    await user.click(screen.getByTestId('settings-search-clear'));
    expect(screen.queryByTestId('settings-log-redaction-switch')).toBeNull();
    expect(visibleText(sections)).toContain('settings.section_appearance');
  });
});
