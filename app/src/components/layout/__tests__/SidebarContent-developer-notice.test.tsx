import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { SidebarContent } from '../SidebarContent';
import { useDeveloperNoticeStore } from '../../../stores/developerNotices';
import { resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

// The logo is a png asset; give it a stub so the import resolves in jsdom.
vi.mock('../../../../assets/logo.png', () => ({ default: 'logo.png' }));

// Side-effecting hooks the sidebar pulls in; stub them to keep the render pure.
vi.mock('../../../hooks/useDeveloperNotices', () => ({
  useDeveloperNotices: () => ({ unreadCount: 0 }),
}));
vi.mock('../../../hooks/useTvMode', () => ({
  useTvMode: () => ({ isTvMode: false }),
}));
vi.mock('../../../hooks/useKioskLock', () => ({
  useKioskLock: () => ({
    isLocked: false,
    showSetPin: false,
    setPinMode: 'set',
    pinError: null,
    handleLockToggle: vi.fn(),
    handleSetPinSubmit: vi.fn(),
    handleSetPinCancel: vi.fn(),
  }),
}));
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: string) => d ?? k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SidebarContent />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SidebarContent developer-notice nav item', () => {
  beforeEach(() => {
    useDeveloperNoticeStore.setState({
      readIds: [],
      dismissedBannerIds: [],
      deletedIds: [],
      showNotices: true,
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows the developer-notice nav item when showNotices is true', () => {
    renderSidebar();
    expect(screen.getByTestId('nav-item-developer-notice')).toBeInTheDocument();
  });

  it('hides the developer-notice nav item when showNotices is false', () => {
    useDeveloperNoticeStore.setState({ showNotices: false });
    renderSidebar();
    expect(screen.queryByTestId('nav-item-developer-notice')).not.toBeInTheDocument();
    // Other nav items remain present.
    expect(screen.getByTestId('nav-item-dashboard')).toBeInTheDocument();
  });
});

describe('SidebarContent app version', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows the version in the header, above the nav items', () => {
    renderSidebar();
    const version = screen.getByTestId('sidebar-app-version');
    expect(version.textContent).toMatch(/^v\d+\.\d+\.\d+/);
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(version.compareDocumentPosition(screen.getByTestId('nav-item-dashboard')) & follows).toBeTruthy();
  });
});
