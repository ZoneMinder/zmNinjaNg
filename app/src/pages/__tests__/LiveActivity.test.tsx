import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import LiveActivity from '../LiveActivity';
import { getMonitors, getAlarmStatus } from '../../api/monitors';
import enTranslation from '../../locales/en/translation.json';
import { ALL_PROFILES_ID, asProfileId } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';
import { useNotificationStore } from '../../stores/notifications';
import { useAuthStore } from '../../stores/auth';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
  getAlarmStatus: vi.fn(),
}));

// useScopedMonitors is All-mode's monitor fanout; kept mocked so each test
// controls exactly which (profile, monitor) pairs are in play. Overridden
// per All-mode test via vi.resetModules()+vi.doMock.
vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => ({ monitors: [], errors: [], isLoading: false, refetchProfile: vi.fn() }),
}));

// Its own tests cover the toggle (including how it resolves the page's
// Streaming Mode in All mode); stubbing keeps that resolution's hooks out of
// this file's mock surface, which several tests rebuild with doMock.
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({
  AnalysisFramesToggle: () => <div data-testid="analysis-frames-toggle-stub" />,
}));

// The default single-mode profile every test seeds unless it needs something
// else: real useCurrentProfile/useProfileScope/useProfileStore/useAuthSlice
// and the real session registry (services/sessions) all run for real now,
// backed by the fake HTTP boundary (tests/profile-fixture, fake-store-gates).
const P1_SETTINGS = {
  liveActivityPollSeconds: 5,
  liveActivityDwellSeconds: 30,
  liveActivityMaxTiles: 12,
  liveActivityIgnoredMonitorIds: [] as string[],
  liveActivityIsFullscreen: false,
  bandwidthMode: 'normal' as const,
  monitorGridCols: 2,
};

function seedSingleProfile(version = '1.36.33') {
  seedProfiles([makeProfile('p1', { portalUrl: 'https://zm.test' })], {
    settings: { p1: { ...P1_SETTINGS } },
    authenticated: false,
  });
  useAuthStore.getState().setTokens(asProfileId('p1'), {
    access_token: 'access-p1',
    access_token_expires: 3600,
    refresh_token: 'refresh-p1',
    refresh_token_expires: 86400,
    version,
  });
}

/**
 * Some tests need a different stores/notifications poll interval or a
 * different useScopedMonitors fanout, both static top-level mocks - the only
 * way to change one is vi.resetModules()+vi.doMock, then re-import. That
 * discards the module graph entirely, so the profile/session fixtures (bound
 * to the OLD graph's store instances) must be re-imported too, or seeding
 * would write to stores the freshly re-imported page never reads from.
 */
async function freshImports() {
  // A fresh stores/profile.ts rehydrates from localStorage on import (real
  // persist middleware), which a prior test's seedProfiles() call wrote real
  // profile/token data into. Clearing first stops that stray rehydration
  // from bootstrapping a stale profile session before this test seeds its own.
  localStorage.clear();
  const { default: LiveActivityFresh } = await import('../LiveActivity');
  const monitorsApi = await import('../../api/monitors');
  const fixture = await import('../../tests/profile-fixture');
  // Imported through the mocked specifier itself (not tests/fake-store-gates
  // directly): vi.mock's own dynamic-import factory does not reliably
  // re-resolve to a fresh fake-store-gates instance across
  // vi.resetModules() calls, so a direct import here silently returned a
  // stale gates instance whose `clients` map the real session registry
  // (imported through '../../api/store-gates') never actually reads from.
  const gates = (await import('../../api/store-gates')) as unknown as typeof import('../../tests/fake-store-gates');
  const settingsModule = await import('../../stores/settings');
  const notificationsModule = await import('../../stores/notifications');
  return {
    LiveActivityFresh,
    getMonitors: vi.mocked(monitorsApi.getMonitors),
    getAlarmStatus: vi.mocked(monitorsApi.getAlarmStatus),
    seedProfiles: fixture.seedProfiles,
    makeProfile: fixture.makeProfile,
    fakeApiClient: fixture.fakeApiClient,
    installApiClient: gates.installApiClient,
    useSettingsStore: settingsModule.useSettingsStore,
    useNotificationStore: notificationsModule.useNotificationStore,
  };
}


// Initializing the real i18next instance drags in its LanguageDetector setup;
// instead this stub does the same lookup + interpolation i18next does, but
// against the real English strings bundled in translation.json. That keeps
// assertions able to fail on the actual rendered copy (e.g. a changed state
// label) rather than on a fabricated key/params string.
function resolveEn(key: string): string {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }, enTranslation) as string;
}

function translate(key: string, params?: Record<string, unknown>): string {
  // A key called with a count resolves against its `_one` / `_other` family,
  // the way i18next does, so assertions still read the real English copy.
  const count = params?.count;
  const suffix = typeof count === 'number' ? (count === 1 ? '_one' : '_other') : '';
  const template = resolveEn(`${key}${suffix}`) ?? resolveEn(key);
  if (typeof template !== 'string') return key;
  if (!params) return template;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(params[name] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// Counts how many times a tile has been rendered, so a test can tell a
// settled page from one re-rendering in a loop. vi.hoisted because the mock
// factory below is hoisted above ordinary module scope.
const tileRenders = vi.hoisted(() => ({ count: 0 }));

// The tile mounts a real video stream otherwise. The header is reproduced as
// icon-then-name, the same shape the real component renders, so assertions
// about what the header says still mean something.
vi.mock('../../components/monitors/MontageMonitor', () => ({
  MontageMonitor: ({
    monitor,
    titleOverride,
    titleIcon,
    profileChip,
  }: {
    monitor: { Name: string };
    titleOverride?: string;
    titleIcon?: ReactNode;
    profileChip?: string;
  }) => {
    tileRenders.count += 1;
    return (
      <div data-testid="live-activity-tile-mock">
        {titleIcon}
        {titleOverride ?? monitor.Name}
        {profileChip && <span data-testid="montage-profile-chip">{profileChip}</span>}
      </div>
    );
  },
}));

const mockMonitors = vi.mocked(getMonitors);
const mockStatus = vi.mocked(getAlarmStatus);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const MONITORS = {
  monitors: [
    { Monitor: { Id: '3', Name: 'Front Door', Function: 'Modect', Capturing: 'Always' } },
    { Monitor: { Id: '4', Name: 'Backyard', Function: 'Modect', Capturing: 'Always' } },
  ],
};

describe('LiveActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tileRenders.count = 0;
    mockMonitors.mockResolvedValue(MONITORS as never);
    seedSingleProfile();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
    useNotificationStore.setState({ profileEvents: {} });
    localStorage.clear();
  });

  it('shows only the alarming monitor, named without its id', async () => {
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
    });
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument();
    // The header used to read "Front Door(3):Alarmed"; the id is gone and the
    // state word is now the icon's accessible name instead of body text.
    expect(screen.getByTestId('live-activity-tile-mock')).toHaveTextContent(/^Front Door$/);
  });

  it('announces the alarm state through the header icon', async () => {
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Alarmed' })).toHaveAccessibleName('Alarmed');
    });
    expect(screen.getByRole('img', { name: 'Alarmed' })).toHaveAttribute('title', 'Alarmed');
  });

  // Recording mode says nothing about what is alarming, so this page does not
  // read it. Verified against ZoneMinder 1.39.18 (#313): a monitor with an
  // open `Continuous` event still reports IDLE, because state comes from the
  // motion score alone. Servers before the 1.37 removal of TAPE report TAPE
  // while continuously recording, which isAlarmingState already rejects.
  describe('continuous-recording monitors', () => {
    const WITH_CONTINUOUS = {
      monitors: [
        ...MONITORS.monitors,
        { Monitor: { Id: '5', Name: 'Driveway', Function: 'Mocord', Capturing: 'Always' } },
      ],
    };

    beforeEach(() => {
      mockMonitors.mockResolvedValue(WITH_CONTINUOUS as never);
      // Everything alarming, so only the watched set decides what renders.
      mockStatus.mockResolvedValue({ status: 2 } as never);
    });

    it('watches a continuous recorder like any other monitor', async () => {
      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Driveway')).toHaveTextContent('Driveway');
      });
    });

    it('watches one reported through the 1.38 Recording field', async () => {
      useAuthStore.getState().setTokens(asProfileId('p1'), {
        access_token: 'access-p1',
        access_token_expires: 3600,
        refresh_token: 'refresh-p1',
        refresh_token_expires: 86400,
        version: '1.38.0',
      });
      mockMonitors.mockResolvedValue({
        monitors: [
          ...MONITORS.monitors,
          {
            Monitor: {
              Id: '5',
              Name: 'Driveway',
              Recording: 'Always',
              Analysing: 'Always',
              Capturing: 'Always',
            },
          },
        ],
      } as never);

      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Driveway')).toHaveTextContent('Driveway');
      });
    });

    it('keeps a continuous recorder out when it is ignored', async () => {
      useSettingsStore.getState().updateProfileSettings(asProfileId('p1'), { liveActivityIgnoredMonitorIds: ['5'] });

      render(<LiveActivity />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
      });
      expect(screen.queryByText('Driveway')).not.toBeInTheDocument();
    });
  });

  it('shows the quiet empty state when nothing is alarming', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet');
    });
    expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('Watching 2 monitors');
  });

  it('uses the singular form when watching a single monitor', async () => {
    // Regression: watching_count passed i18next a count with no plural family
    // behind it, so one monitor read "Watching 1 monitors".
    mockMonitors.mockResolvedValue({ monitors: [MONITORS.monitors[0]] } as never);
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('Watching 1 monitor');
    });
    expect(screen.getByTestId('live-activity-empty')).not.toHaveTextContent('1 monitors');
  });

  it('stops re-rendering once an alarming monitor has settled', async () => {
    // Regression: useAlarmStates handed back a fresh `states` object on every
    // render, the dwell effect listed it as a dependency, and the reducer
    // stamps Date.now() into every alarming entry. So each render produced a
    // new list, which set state, which rendered again, forever; the wall clock
    // advancing between iterations meant it never converged. The observable
    // symptom is render count, so that is what this measures.
    //
    // The window is real time rather than a render count taken immediately:
    // a single jsdom render is sub-millisecond, so Date.now() often does not
    // advance between two adjacent iterations and the loop stalls for a tick
    // before resuming. Over 300ms the clock advances ~300 times, so the loop
    // is guaranteed to show itself rather than depending on that timing luck.
    // The mocked poll interval is 1000ms and the cooling timer fires at 1000ms,
    // so a settled page has no legitimate reason to render at all in the
    // window.
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
    });

    const settled = tileRenders.count;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // Measured at 471 renders in this window before the fix, 0 after. Ten
    // leaves room for an unlucky poll or timer landing inside the window
    // without letting a loop through.
    expect(tileRenders.count - settled).toBeLessThan(10);
    // The tile is still on screen, so the bound above is not passing because
    // the page went blank.
    expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
  });

  it('labels a tile with how long its alarm episode has run', async () => {
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    const elapsed = await screen.findByTestId('live-activity-elapsed-3');
    // A tile that just entered reads as a stopwatch just started, and the
    // quiet monitor has no label at all.
    expect(elapsed.textContent).toMatch(/^0:0\d$/);
    expect(screen.queryByTestId('live-activity-elapsed-4')).not.toBeInTheDocument();
  });

  it('keeps a dismissed tile gone while its monitor is still alarming', async () => {
    // The trap this control exists to avoid: the monitor never stops alarming
    // here, so a dismissal that did not suppress re-entry would see the tile
    // pop straight back on the next poll and the button would read as broken.
    // A 20ms poll (via the real resolvePollIntervalMs, in normal bandwidth
    // mode a straight pass-through of the seconds setting) keeps the test fast.
    seedProfiles([makeProfile('p1', { portalUrl: 'https://zm.test' })], {
      settings: { p1: { ...P1_SETTINGS, liveActivityPollSeconds: 0.02 } },
    });
    mockMonitors.mockResolvedValue(MONITORS as never);

    let monitorThreeCalls = 0;
    mockStatus.mockImplementation(async (_client: unknown, id: string) => {
      if (id !== '3') return { status: 0 } as never;
      monitorThreeCalls += 1;
      return { status: 2 } as never;
    });

    render(<LiveActivity />, { wrapper });

    const dismiss = await screen.findByTestId('live-activity-dismiss-3');
    const callsAtDismiss = monitorThreeCalls;
    act(() => {
      dismiss.click();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('live-activity-tile')).not.toBeInTheDocument();
    });
    // Several further polls all report the same alarm.
    await waitFor(() => expect(monitorThreeCalls).toBeGreaterThanOrEqual(callsAtDismiss + 3), {
      timeout: 5000,
    });
    expect(screen.queryByTestId('live-activity-tile')).not.toBeInTheDocument();
    expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet');
  }, 10000);

  it('shows a monitor again when it alarms after a dismissal was released', async () => {
    seedProfiles([makeProfile('p1', { portalUrl: 'https://zm.test' })], {
      settings: { p1: { ...P1_SETTINGS, liveActivityPollSeconds: 0.02 } },
    });
    mockMonitors.mockResolvedValue(MONITORS as never);

    // Alarming, then quiet once dismissed, then alarming again: the second
    // alarm is new information and has to show.
    let quiet = false;
    let alarmAgain = false;
    mockStatus.mockImplementation(async (_client: unknown, id: string) => {
      if (id !== '3') return { status: 0 } as never;
      if (alarmAgain) return { status: 2 } as never;
      return { status: quiet ? 0 : 2 } as never;
    });

    render(<LiveActivity />, { wrapper });

    const dismiss = await screen.findByTestId('live-activity-dismiss-3');
    act(() => {
      dismiss.click();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('live-activity-tile')).not.toBeInTheDocument();
    });

    quiet = true;
    await waitFor(() => expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet'));
    // Give the quiet polls time to release the dismissal before it re-alarms.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    alarmAgain = true;

    await waitFor(() => expect(screen.getByText('Front Door')).toHaveTextContent('Front Door'), {
      timeout: 5000,
    });
  }, 10000);

  it('labels a tile with the cause the notification stream reported', async () => {
    // The alarm poll never carries a cause, so the notification store is the
    // only source. Its event also promotes the monitor onto the page, which is
    // the accelerant path this fixture exercises at the same time.
    seedProfiles([makeProfile('p1', { portalUrl: 'https://zm.test' })], {
      settings: { p1: { ...P1_SETTINGS } },
    });
    useNotificationStore.setState({
      profileEvents: {
        p1: [{
          MonitorId: 3,
          MonitorName: 'Front Door',
          EventId: 1,
          Cause: 'Motion: All',
          Name: 'Front Door',
          receivedAt: Date.now(),
          read: false,
          source: 'poll',
        }],
      },
    });
    mockMonitors.mockResolvedValue(MONITORS as never);
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-cause-3')).toHaveTextContent('Motion: All');
    });
    expect(screen.queryByTestId('live-activity-cause-4')).not.toBeInTheDocument();
  });

  it('keeps the page chrome out of the way in fullscreen', async () => {
    // A wall display should show tiles, not the heading, the grid controls and
    // the gear. The tiles themselves still render, so the assertion below is
    // about the chrome rather than about the page having gone blank.
    useSettingsStore.getState().updateProfileSettings(asProfileId('p1'), { liveActivityIsFullscreen: true });
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
    });
    expect(screen.getByTestId('live-activity-fullscreen')).toHaveTextContent('Live Activity');
    expect(screen.queryByTestId('live-activity-settings-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-activity-fullscreen-btn')).not.toBeInTheDocument();
    // The only control left is the way back out.
    expect(screen.getByTestId('live-activity-exit-fullscreen-btn')).toHaveAttribute(
      'aria-label',
      'Exit Fullscreen'
    );
  });

  it('offers a fullscreen control while the page chrome is showing', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    const button = await screen.findByTestId('live-activity-fullscreen-btn');
    expect(button).toHaveAttribute('aria-label', 'Fullscreen');
    expect(screen.queryByTestId('live-activity-fullscreen')).not.toBeInTheDocument();
  });

  it('shows the error instead of claiming all quiet when the server is unreachable', async () => {
    // A false "nothing is alarming" during an outage is the worst reading
    // this page can give, so the quiet state is gated on having heard back.
    mockMonitors.mockRejectedValue(new Error('Network Error'));
    mockStatus.mockRejectedValue(new Error('Network Error'));

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Network Error/)).toHaveTextContent(/Network Error/);
    });
    expect(screen.queryByTestId('live-activity-empty')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton before the first alarm poll answers', async () => {
    // A cold open used to paint the quiet empty state, so the page asserted
    // "all quiet" before it had asked anything.
    mockStatus.mockImplementation(() => new Promise(() => {}) as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      // One skeleton tile per column, times two rows - tied to this fixture's
      // monitorGridCols: 2, not a magic number.
      expect(screen.getByTestId('live-activity-loading').children).toHaveLength(
        P1_SETTINGS.monitorGridCols * 2
      );
    });
    expect(screen.queryByTestId('live-activity-empty')).not.toBeInTheDocument();
  });

  // Tiles are packed by row span rather than laid into shared rows, so a 16:9
  // camera beside a portrait one no longer leaves a hole the height of its
  // taller neighbour underneath itself.
  it('spans each tile by its own height once the grid has been measured', async () => {
    mockMonitors.mockResolvedValue({
      monitors: [
        { Monitor: { ...MONITORS.monitors[0].Monitor, Width: '1920', Height: '1080' } },
        { Monitor: { ...MONITORS.monitors[1].Monitor, Width: '1080', Height: '1920' } },
      ],
    } as never);
    mockStatus.mockResolvedValue({ status: 2 } as never);

    // jsdom lays nothing out, so every element measures zero. This stub
    // reports the width the page cannot measure for itself; the two-column
    // setting above makes that a 400px column.
    const RealResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(element: Element) {
        this.callback(
          [{ target: element, contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      render(<LiveActivity />, { wrapper });

      const landscape = await screen.findByText('Front Door');
      const portrait = screen.getByText('Backyard');
      const tileOf = (node: HTMLElement) =>
        node.closest('[data-testid="live-activity-tile"]') as HTMLElement;

      // 400 * 9/16 video + a 32px header, and 400 * 16/9 + 32 for the portrait.
      expect(tileOf(landscape).style.gridRowEnd).toBe('span 257');
      expect(tileOf(portrait).style.gridRowEnd).toBe('span 744');
      expect(tileOf(landscape).parentElement?.style.gridAutoRows).toBe('1px');
    } finally {
      global.ResizeObserver = RealResizeObserver;
    }
  });

  it('never polls a monitor on the ignore list', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    // Both monitors are pollable in this fixture; the ignore-list case itself
    // is covered by the next test, which overrides the mocked settings.
    expect(mockStatus.mock.calls.map((c) => c[1]).sort()).toEqual(['3', '4']);
  });

  it('drops an ignored monitor id from polling', async () => {
    useSettingsStore.getState().updateProfileSettings(asProfileId('p1'), { liveActivityIgnoredMonitorIds: ['4'] });
    mockStatus.mockResolvedValue({ status: 0 } as never);

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    expect(mockStatus.mock.calls.map((c) => c[1])).toEqual(['3']);
  });

  it('keeps the short enter duration on the tile', async () => {
    // Regression: the tile carried `duration-200` for the enter animation and
    // `duration-700` for a cooling transition. cn() is twMerge(clsx(...)),
    // tailwindcss-animate maps `duration-*` onto animationDuration as well as
    // core Tailwind's transitionDuration, so twMerge saw one conflict group
    // and dropped `duration-200` outright. Tiles entered over 700ms. The
    // cooling transition is gone now, but the enter duration stays an
    // arbitrary-value class so that re-adding any transition duration here
    // cannot silently swallow it again. The collision is invisible by reading
    // the source, so the resolved class list is what gets asserted.
    mockStatus.mockImplementation(async (_client: unknown, id: string) =>
      (id === '3' ? { status: 2 } : { status: 0 }) as never
    );

    render(<LiveActivity />, { wrapper });

    const tile = await screen.findByTestId('live-activity-tile');
    expect(tile.className).toMatch(/\[animation-duration:200ms\]/);
  });

  it('renders a cooling tile exactly like an alarming one', async () => {
    // Two reasons, and the rendering one is the load-bearing one. The tile
    // carries `view-transition-name`, so it is the element the browser
    // snapshots, and a captured image is generated with the element's own
    // opacity and filter already applied while ::view-transition-new is the
    // live element. The pair is composited with mix-blend-mode: plus-lighter,
    // which only cross-fades correctly when both halves are the same image, so
    // an element animating its own opacity or filter composites wrong for the
    // whole transition. The grid reorders roughly once a second while
    // ZoneMinder flaps a winding-down monitor between `alert` (alarming) and
    // `tape` (not alarming), so that repeated for the length of an event's
    // tail: exactly the window before a tile dwells out. Winding down is
    // signalled by the state icon dropping out of the header instead. refs #313
    seedProfiles([makeProfile('p1', { portalUrl: 'https://zm.test' })], {
      settings: { p1: { ...P1_SETTINGS, liveActivityPollSeconds: 0.02 } },
    });
    mockMonitors.mockResolvedValue(MONITORS as never);

    let monitorThreeCalls = 0;
    mockStatus.mockImplementation(async (_client: unknown, id: string) => {
      if (id !== '3') return { status: 0 } as never;
      monitorThreeCalls += 1;
      // Alarms once to enter the list, then stays quiet inside the 30s dwell,
      // so every later poll leaves it resident and cooling.
      return { status: monitorThreeCalls === 1 ? 2 : 0 } as never;
    });

    render(<LiveActivity />, { wrapper });

    // The tile is keyed by monitor id, so this is the same DOM node throughout;
    // capture how it looks while the monitor is still alarming.
    const tile = await screen.findByTestId('live-activity-tile');
    const whileAlarming = tile.className;
    expect(tile.style.viewTransitionName).toBe('live-activity-tile-3');

    // Let several idle polls land, which puts the entry into its cooling state.
    await waitFor(() => expect(monitorThreeCalls).toBeGreaterThanOrEqual(4), { timeout: 5000 });

    expect(tile.className).toBe(whileAlarming);
    expect(tile.className).not.toMatch(/opacity-\d|saturate-|transition-/);
    expect(tile.style.viewTransitionName).toBe('live-activity-tile-3');
  }, 10000);

  it('drops a tile once its dwell window closes', async () => {
    // The list update now runs through a shared callback that may route the
    // state change through a view transition (absent in jsdom, so it falls
    // back to a plain update). A tile that stopped alarming still has to
    // leave, which is what proves the fallback path publishes anything at all.
    seedProfiles([makeProfile('p1', { portalUrl: 'https://zm.test' })], {
      // 10ms of dwell, so the window closes between two fast polls; 20ms poll.
      settings: { p1: { ...P1_SETTINGS, liveActivityDwellSeconds: 0.01, liveActivityPollSeconds: 0.02 } },
    });
    mockMonitors.mockResolvedValue(MONITORS as never);

    let monitorThreeCalls = 0;
    mockStatus.mockImplementation(async (_client: unknown, id: string) => {
      if (id !== '3') return { status: 0 } as never;
      monitorThreeCalls += 1;
      // Alarming on the first poll only, quiet from then on.
      return { status: monitorThreeCalls === 1 ? 2 : 0 } as never;
    });

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
    });
    await waitFor(
      () => {
        expect(screen.queryByTestId('live-activity-tile')).not.toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet');
  }, 10000);

  // All mode aggregates every scope profile's alarm fanout instead of being
  // gated out (refs #337, #341): useScopedAlarmStates fans out per (profile,
  // monitor) pair via each pair's OWNING session, and the damping engine
  // keys by monitorCacheKey so two profiles sharing a raw monitor id never
  // collide.
  describe('All mode', () => {
    // Spread over the real defaults: the All-mode watch cap and poll floor are
    // ALL-bucket settings read off this object now (useLiveActivityAllMode),
    // so a hand-listed subset would leave them undefined and quietly cap the
    // watched set at nothing.
    const ALL_SETTINGS_OVERRIDE = {
      liveActivityPollSeconds: 5,
      liveActivityDwellSeconds: 30,
      liveActivityMaxTiles: 12,
      liveActivityIgnoredMonitorIds: [] as string[],
      liveActivityIsFullscreen: false,
      bandwidthMode: 'normal' as const,
      monitorGridCols: 2,
    };

    /** Seeds the real profile/settings stores for a fresh (post-resetModules)
     * module graph: every scope profile plus the ALL bucket's own settings. */
    function seedAllMode(f: Awaited<ReturnType<typeof freshImports>>, profiles: Array<{ id: string; name: string }>) {
      f.seedProfiles(profiles.map((p) => f.makeProfile(p.id, { name: p.name })), { current: ALL_PROFILES_ID });
      f.useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { ...ALL_SETTINGS_OVERRIDE });
    }

    /** Installs one distinct fake client per profile and returns a lookup
     * from that client (the first arg getAlarmStatus is called with, since
     * useLiveActivityAllMode's fanout polls through getSession(profileId).client)
     * back to its owning profile id - real getSession no longer stamps a
     * `profileId` field onto the client the way the old bare mock did. */
    function installTrackedClients(f: Awaited<ReturnType<typeof freshImports>>, ids: string[]) {
      const byClient = new Map<unknown, string>();
      for (const id of ids) {
        const client = f.fakeApiClient();
        f.installApiClient(asProfileId(id), client);
        byClient.set(client, id);
      }
      return byClient;
    }

    function scopedMonitor(profileId: string, profileName: string, id: string, name: string) {
      return { profileId, profileName, item: { Monitor: { Id: id, Name: name }, Monitor_Status: undefined } };
    }

    it('aggregates monitors across every scope profile and keeps colliding ids distinct', async () => {
      vi.resetModules();
      // Both profiles happen to number their monitor "3" - the composite key
      // (monitorCacheKey) is what keeps these from colliding into one tile.
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({
          monitors: [scopedMonitor('p1', 'One', '3', 'Front Door'), scopedMonitor('p2', 'Two', '3', 'Garage')],
          errors: [],
          isLoading: false,
          refetchProfile: vi.fn(),
        }),
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      f.getAlarmStatus.mockResolvedValue({ status: 2 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      // No gate notice: the whole point of this task is that All mode
      // renders like single mode, not a "switch profile" wall.
      expect(screen.queryByTestId('live-activity-all-mode-notice')).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Front Door')).toHaveTextContent('Front Door');
      });
      expect(screen.getByText('Garage')).toHaveTextContent('Garage');
      const chips = screen.getAllByTestId('montage-profile-chip');
      expect(chips.map((c) => c.textContent).sort()).toEqual(['One', 'Two']);
    });

    it("respects each profile's own ignore list independently", async () => {
      vi.resetModules();
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({
          monitors: [
            scopedMonitor('p1', 'One', '4', 'p1-cam4'),
            scopedMonitor('p2', 'Two', '4', 'p2-cam4'),
          ],
          errors: [],
          isLoading: false,
          refetchProfile: vi.fn(),
        }),
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      // p1 ignores monitor "4" on ITS OWN settings bucket; p2 does not.
      // scope.settings (the ALL bucket, seeded above) never carries an
      // ignore list that would apply cross-server.
      f.useSettingsStore.getState().updateProfileSettings(asProfileId('p1'), { liveActivityIgnoredMonitorIds: ['4'] });
      f.getAlarmStatus.mockResolvedValue({ status: 2 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('p2-cam4')).toHaveTextContent('p2-cam4');
      });
      expect(screen.queryByText('p1-cam4')).not.toBeInTheDocument();
    });

    it('caps the total watched set round-robin and shows the overflow notice', async () => {
      vi.resetModules();
      // 3 profiles contributing 10 monitors each (30 total), well past the
      // 24-pair cap: proves the cap is enforced AND that no single profile's
      // monitors are fully excluded by a naive profile-order truncation.
      const monitors = ['p1', 'p2', 'p3'].flatMap((pid, pi) =>
        Array.from({ length: 10 }, (_, i) => scopedMonitor(pid, `Profile ${pi}`, String(i), `${pid}-${i}`))
      );
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({ monitors, errors: [], isLoading: false, refetchProfile: vi.fn() }),
      }));

      const f = await freshImports();
      seedAllMode(f, [
        { id: 'p1', name: 'Profile 0' },
        { id: 'p2', name: 'Profile 1' },
        { id: 'p3', name: 'Profile 2' },
      ]);
      const byClient = installTrackedClients(f, ['p1', 'p2', 'p3']);
      f.getAlarmStatus.mockResolvedValue({ status: 0 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      // Cap is 24 of 30 requested: 6 dropped.
      await waitFor(() => {
        expect(screen.getByTestId('live-activity-watch-cap-notice')).toHaveTextContent('6');
      });
      expect(f.getAlarmStatus.mock.calls.length).toBe(24);
      // Round-robin, not profile-order truncation: every profile still has
      // at least one polled monitor.
      const polledProfiles = new Set(f.getAlarmStatus.mock.calls.map((c) => byClient.get(c[0])));
      expect(polledProfiles).toEqual(new Set(['p1', 'p2', 'p3']));
    });

    it('keeps a resident (currently alarming) tile watched across a cap re-slice', async () => {
      // Regression for the round-robin cap evicting an on-screen tile with
      // no dwell window: a monitor-list change re-slices the watched set,
      // and without the residency exemption a monitor still alarming right
      // now can lose its slot and vanish - the #313 failure mode reached
      // through the cap instead of the poll.
      vi.resetModules();

      // p1 alone fills the cap exactly (24 = 24): nothing dropped yet, and
      // monitor "23" (the last one drawn) is the one that alarms.
      let monitors = Array.from({ length: 24 }, (_, i) => scopedMonitor('p1', 'One', String(i), `p1-${i}`));
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({ monitors, errors: [], isLoading: false, refetchProfile: vi.fn() }),
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      const byClient = installTrackedClients(f, ['p1', 'p2']);
      f.getAlarmStatus.mockImplementation(async (_client: unknown, id: string) =>
        (id === '23' ? { status: 2 } : { status: 0 }) as never
      );

      render(<f.LiveActivityFresh />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('p1-23')).toHaveTextContent('p1-23');
      });

      // p2 joins with 4 more monitors: total 28 > the 24 cap, so a re-slice
      // is now due. A plain (unexempted) round-robin over this new grouping
      // drops p1's monitors "19"-"22" to make room for p2 - "23" falls
      // outside that too, UNLESS it is exempted for being resident.
      monitors = [
        ...monitors,
        ...Array.from({ length: 4 }, (_, i) => scopedMonitor('p2', 'Two', String(i), `p2-${i}`)),
      ];

      // No explicit rerender(): the page's own cooling-tick effect
      // (LiveActivity.tsx) re-renders once a second while a tile is
      // resident, which is what picks up the mutated useScopedMonitors()
      // return value above. Waits for a p2 poll to prove the re-slice
      // actually happened (p2 was entirely absent from round one, and a
      // pre-existing query's own 10s refetch interval wouldn't otherwise
      // produce a fresh call inside this test's short window).
      await waitFor(
        () => {
          const p2Polled = f.getAlarmStatus.mock.calls.some((c) => byClient.get(c[0]) === 'p2');
          expect(p2Polled).toBe(true);
        },
        { timeout: 5000 }
      );

      // The resident, still-alarming tile must never have left the screen.
      expect(screen.getByText('p1-23')).toHaveTextContent('p1-23');

      // The cap is still a real ceiling, not blown open by the exemption:
      // 28 requested, 24 watched (1 resident + 23 round-robin), 4 dropped.
      // A raw poll-count diff can't prove this within the test's short
      // window (a query already fetched once in round one produces no new
      // call regardless of whether it stayed watched, until its own 10s
      // refetch interval elapses), so the overflow notice - which reads
      // straight off watchOverflowCount - is the reliable signal instead.
      await waitFor(() => {
        expect(screen.getByTestId('live-activity-watch-cap-notice')).toHaveTextContent('4');
      });
    }, 10000);

    it("promotes only the owning profile's tile on a live hint, not another profile's same-id monitor", async () => {
      vi.resetModules();
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({
          monitors: [scopedMonitor('p1', 'One', '3', 'p1-cam3'), scopedMonitor('p2', 'Two', '3', 'p2-cam3')],
          errors: [],
          isLoading: false,
          refetchProfile: vi.fn(),
        }),
      }));
      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      // A real-store event for p1's monitor "3" only; p2's own "3" never
      // fired a notification.
      f.useNotificationStore.setState({
        profileEvents: {
          p1: [{
            MonitorId: 3,
            MonitorName: 'p1-cam3',
            EventId: 1,
            Cause: 'Motion: All',
            Name: 'p1-cam3',
            receivedAt: Date.now(),
            read: false,
            source: 'poll',
          }],
        },
      });
      // Both idle by poll; the hint alone must promote p1's tile.
      f.getAlarmStatus.mockResolvedValue({ status: 0 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('p1-cam3')).toHaveTextContent('p1-cam3');
      });
      expect(screen.queryByText('p2-cam3')).not.toBeInTheDocument();
    });

    // Menu buttons in All mode (refs #337 round 2): the settings dialog used
    // to render only `{currentProfile && (...)}`, and useFullscreenMode wrote
    // through `currentProfile.id` - both silently no-op in All mode
    // (currentProfile is null there). currentProfileId (the raw store value,
    // the ALL_PROFILES_ID sentinel here) is what unlocks them.
    it('opens the settings dialog in All mode, with the ignore-list profile picker', async () => {
      vi.resetModules();
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({
          monitors: [scopedMonitor('p1', 'One', '3', 'p1-cam3')],
          errors: [],
          isLoading: false,
          refetchProfile: vi.fn(),
        }),
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      f.getAlarmStatus.mockResolvedValue({ status: 0 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      const settingsButton = await screen.findByTestId('live-activity-settings-btn');
      fireEvent.click(settingsButton);

      expect(screen.getByTestId('live-activity-settings-dialog')).toHaveTextContent('Live Activity settings');
      // The ignore-list section's ProfilePicker only ever appears when
      // scopeProfiles was actually threaded through - a gate regression
      // would render the dialog with no way to pick a profile at all. Its
      // selected value is the one scope profile passed in ('One'/p1).
      expect(screen.getByTestId('page-profile-picker')).toHaveTextContent('One');
    });

    it('toggles fullscreen in All mode and persists it to the ALL bucket', async () => {
      // Before the fix, handleToggleFullscreen's `if (!currentProfile)
      // return` made this click a complete no-op in All mode (currentProfile
      // is null there), so the real store below would never have been
      // written at all.
      vi.resetModules();
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({ monitors: [], errors: [], isLoading: false, refetchProfile: vi.fn() }),
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      f.getAlarmStatus.mockResolvedValue({ status: 0 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      const fullscreenButton = await screen.findByTestId('live-activity-fullscreen-btn');
      fireEvent.click(fullscreenButton);

      expect(
        f.useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).liveActivityIsFullscreen
      ).toBe(true);
    });

    it('changes the grid column count in All mode, persisting to the ALL bucket', async () => {
      // Isolates handleGridChange from the real dropdown UI (GridColumnsMenu
      // is a Radix DropdownMenu - the same jsdom portal friction Select has):
      // captures the onGridChange callback useEventMontageGrid was given and
      // calls it directly, exactly as a real column click would.
      vi.resetModules();
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({ monitors: [], errors: [], isLoading: false, refetchProfile: vi.fn() }),
      }));
      const captured: { onGridChange?: (cols: number) => void } = {};
      vi.doMock('../../hooks/useEventMontageGrid', () => ({
        useEventMontageGrid: (opts: { onGridChange?: (cols: number) => void }) => {
          captured.onGridChange = opts.onGridChange;
          return {
            gridCols: 2,
            isCustomGridDialogOpen: false,
            setIsCustomGridDialogOpen: vi.fn(),
            customCols: '2',
            setCustomCols: vi.fn(),
            handleApplyGridLayout: vi.fn(),
            handleCustomGridSubmit: vi.fn(),
          };
        },
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      f.getAlarmStatus.mockResolvedValue({ status: 0 } as never);

      render(<f.LiveActivityFresh />, { wrapper });

      await waitFor(() => expect(typeof captured.onGridChange).toBe('function'));
      act(() => {
        captured.onGridChange!(4);
      });

      expect(
        f.useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).monitorGridCols
      ).toBe(4);
    });

    // The stacking toggle shares monitorsGroupByServer with Monitors and
    // Montage, and sections the alarming tiles by owning server (refs #529).
    it('sections the tiles by server once the group-by-server toggle is pressed', async () => {
      vi.resetModules();
      vi.doMock('../../hooks/useScopedMonitors', () => ({
        useScopedMonitors: () => ({
          monitors: [
            scopedMonitor('p1', 'One', '3', 'Front Door'),
            scopedMonitor('p2', 'Two', '3', 'Garage'),
            scopedMonitor('p1', 'One', '5', 'Porch'),
          ],
          errors: [],
          isLoading: false,
          refetchProfile: vi.fn(),
        }),
      }));

      const f = await freshImports();
      seedAllMode(f, [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]);
      f.getAlarmStatus.mockResolvedValue({ status: 2 } as never);

      render(<f.LiveActivityFresh />, { wrapper });
      await waitFor(() => expect(screen.getByText('Porch')).toHaveTextContent('Porch'));
      expect(screen.queryByTestId('live-activity-group-section-p1')).not.toBeInTheDocument();

      const toggle = screen.getByTestId('live-activity-group-by-server');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle).toHaveAttribute('aria-label', 'Group by server');
      fireEvent.click(toggle);

      expect(
        f.useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID).monitorsGroupByServer
      ).toBe(true);
      await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
      const one = screen.getByTestId('live-activity-group-section-p1');
      const two = screen.getByTestId('live-activity-group-section-p2');
      expect(one).toHaveTextContent('Front Door');
      expect(one).toHaveTextContent('Porch');
      expect(one).not.toHaveTextContent('Garage');
      expect(two).toHaveTextContent('Garage');
      expect(two).not.toHaveTextContent('Porch');
    });
  });

  it('offers no group-by-server toggle for a single profile', async () => {
    mockStatus.mockResolvedValue({ status: 0 } as never);
    render(<LiveActivity />, { wrapper });
    await screen.findByTestId('live-activity-empty');
    expect(screen.queryByTestId('live-activity-group-by-server')).not.toBeInTheDocument();
  });
});
