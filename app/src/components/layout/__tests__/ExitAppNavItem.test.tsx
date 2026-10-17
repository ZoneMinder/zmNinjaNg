import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

const platform = vi.hoisted(() => ({ name: 'android', native: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.name,
  },
}));

const exitApp = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@capacitor/app', () => ({ App: { exitApp } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

import { ExitAppNavItem } from '../ExitAppNavItem';
import { useKioskStore } from '../../../stores/kioskStore';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

function seed(tvMode: boolean) {
  seedProfiles(['p1'], { settings: { p1: { tvMode } } });
}

describe('ExitAppNavItem', () => {
  beforeEach(() => {
    platform.name = 'android';
    platform.native = true;
    exitApp.mockClear();
    useKioskStore.setState({ isLocked: false });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('exits the app when pressed in TV mode on Android', async () => {
    seed(true);
    render(<ExitAppNavItem />);
    fireEvent.click(screen.getByTestId('nav-item-exit'));
    await waitFor(() => expect(exitApp).toHaveBeenCalledTimes(1));
  });

  it('is hidden outside TV mode', () => {
    seed(false);
    render(<ExitAppNavItem />);
    expect(screen.queryByTestId('nav-item-exit')).toBeNull();
  });

  it('is hidden off Android, where the app cannot exit itself', () => {
    platform.name = 'web';
    platform.native = false;
    seed(true);
    render(<ExitAppNavItem />);
    expect(screen.queryByTestId('nav-item-exit')).toBeNull();
  });

  it('is hidden while the kiosk lock is on', () => {
    useKioskStore.setState({ isLocked: true });
    seed(true);
    render(<ExitAppNavItem />);
    expect(screen.queryByTestId('nav-item-exit')).toBeNull();
  });
});
