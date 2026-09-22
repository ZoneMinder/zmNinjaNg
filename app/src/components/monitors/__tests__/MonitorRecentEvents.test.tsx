/**
 * MonitorRecentEvents thumbnail-chain profile scoping (refs #337 I2).
 *
 * On the All-mode deep route this component receives an explicit profileId
 * for a profile that may differ from whichever profile is globally current.
 * Thumbnail URLs must be built against THAT profile's token, never the
 * current profile's - otherwise a cross-profile token gets sent to the
 * wrong host.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { MonitorRecentEvents } from '../MonitorRecentEvents';
import { asProfileId, type Event, type Monitor } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../../../stores/monitorSeen', () => ({
  useMonitorSeenStore: (sel: (s: { markSeen: () => void }) => unknown) => sel({ markSeen: vi.fn() }),
}));

const useMonitorRecentEventsMock = vi.fn((..._args: unknown[]) => ({}) as unknown);
vi.mock('../../../hooks/useMonitorRecentEvents', () => ({
  useMonitorRecentEvents: (...args: unknown[]) => useMonitorRecentEventsMock(...args),
}));

const buildThumbnailChainForEventMock = vi.fn((..._args: unknown[]) => ['url1']);
vi.mock('../../../lib/event/thumbnail-chain', () => ({
  buildThumbnailChainForEvent: (...args: unknown[]) => buildThumbnailChainForEventMock(...args),
  eventHasAlarmFrame: () => false,
}));

// Surfaces ownerProfileId so the parent's job - resolving the owning profile
// once for every row - is assertable.
vi.mock('../../events/CompactEventRow', () => ({
  CompactEventRow: ({ ownerProfileId }: { ownerProfileId?: string }) => (
    <div data-testid="event-row" data-owner-profile-id={ownerProfileId ?? ''} />
  ),
}));

const monitor: Monitor = {
  Id: '5',
  Name: 'Front Door',
  Width: '640',
  Height: '480',
} as Monitor;

const event: Event = {
  Id: 'e1',
  MonitorId: '5',
  StartDateTime: '2026-01-01 00:00:00',
} as Event;

describe('MonitorRecentEvents thumbnail-chain profile scoping (refs #337 I2)', () => {
  beforeEach(() => {
    buildThumbnailChainForEventMock.mockClear();
    useMonitorRecentEventsMock.mockReset();
    useMonitorRecentEventsMock.mockReturnValue({
      events: [{ Event: event }],
      isLoading: false,
      isError: false,
      isFetching: false,
      hidden: false,
      count: 5,
      toggleHidden: vi.fn(),
      refetch: vi.fn(),
    });
    seedProfiles([makeProfile('current-profile'), makeProfile('profile-b')], {
      current: 'current-profile',
      settings: {
        'current-profile': { thumbnailFallbackChain: [], forceDisableMultiPort: false },
        'profile-b': { thumbnailFallbackChain: [], forceDisableMultiPort: false },
      },
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('builds the thumbnail chain with the deep route profileId, not the current profile', () => {
    render(<MonitorRecentEvents monitor={monitor} profileId={asProfileId('profile-b')} />);

    expect(buildThumbnailChainForEventMock).toHaveBeenCalledTimes(1);
    const options = buildThumbnailChainForEventMock.mock.calls[0][5] as unknown as { profileId?: string };
    expect(options.profileId).toBe('profile-b');
  });

  // Each row's delete-selection key needs the owning profile. Resolving it
  // here, once, is why the rows no longer subscribe to the profile store.
  it('hands every row the owning profile id', () => {
    const { getByTestId } = render(
      <MonitorRecentEvents monitor={monitor} profileId={asProfileId('profile-b')} />
    );

    expect(getByTestId('event-row').getAttribute('data-owner-profile-id')).toBe('profile-b');
  });

  it('falls back to the current profile when the route names none', () => {
    const { getByTestId } = render(<MonitorRecentEvents monitor={monitor} />);

    expect(getByTestId('event-row').getAttribute('data-owner-profile-id')).toBe('current-profile');
  });
});
