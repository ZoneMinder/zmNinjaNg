/**
 * Montage Page - All-mode aggregation tests (refs #337, Phase 4 Task 1).
 *
 * Grid layout mechanics (drag/resize/heights/legacy migration) are already
 * covered by useMontageGrid.test.ts; react-grid-layout and useMontageGrid are
 * stubbed here so these tests exercise only the data plumbing this task adds:
 * scoped tiles, profile chips, the global stream cap, and per-profile error
 * strips. Single-mode assertions guard the byte-identical requirement.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Children, cloneElement, isValidElement } from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import Montage from '../Montage';
import { ALL_PROFILES_ID } from '../../api/types';
import { DEFAULT_SETTINGS, useSettingsStore, mergeProfileSettings } from '../../stores/settings';
import { log } from '../../lib/logger';
import { MONTAGE_GRID } from '../../lib/zmninja-ng-constants';
import {
  installMockIntersectionObserver,
  latestIntersectionObserver,
} from '../../tests/mock-intersection-observer';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

const useScopedMonitorsMock = vi.fn();
const useMontageGridMock = vi.fn();
const useGroupFilterMock = vi.fn();

vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => useScopedMonitorsMock(),
}));

vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => useGroupFilterMock(),
}));

// Mutable so a test can seed a stored hidden list and assert what the page
// then renders; reset in beforeEach.
let hiddenMonitorIds: string[] = [];

// update() forwards to the settings-store mock exactly as the real hook does
// (against currentProfileId, which is the ALL sentinel in All mode), so page
// tests can assert the bucket a write lands in. The hook's own targeting is
// covered by useMontageGroupState.test.ts.
vi.mock('../../hooks/useMontageGroupState', () => ({
  useMontageGroupState: () => ({
    groupKey: 'ALL',
    bucket: {
      workingLayout: [],
      savedLayouts: [],
      activeLayoutName: null,
      gridCols: 2,
      hiddenMonitorIds,
    },
    update: (patch: unknown) => updateMontageGroupLayoutMock(currentProfileId, 'ALL', patch),
  }),
}));

vi.mock('../../hooks/useMonitorNewEvents', () => ({
  useMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  useScopedMonitorNewEvents: () => ({ counts: {}, newest: {} }),
  scopedMonitorEventKey: (profileId: string, monitorId: string) => `${profileId}:${monitorId}`,
}));

// react-grid-layout measures its container width via ResizeObserver/DOM rects,
// none of which resolve meaningfully in jsdom; the mock renders children
// directly so tile presence/count is what these tests actually assert.
//
// It does clone each child with a ref of its own, because the real GridItem
// does (`cloneElement(child, { ref: this.elementRef, ... })`) and that ref
// REPLACES any the caller put on the same element. A mock that rendered
// children untouched would let a ref on the tile root work in tests and
// silently do nothing in the browser, which is exactly how viewport gating
// first shipped broken (refs #337).
vi.mock('react-grid-layout', () => {
  const ownedRef = () => {};
  return {
    default: ({ children }: { children?: React.ReactNode }) => (
      <div>
        {Children.map(children, (child) =>
          isValidElement(child) ? cloneElement(child, { ref: ownedRef } as never) : child
        )}
      </div>
    ),
    WidthProvider: (Component: React.ComponentType<{ children?: React.ReactNode }>) => Component,
  };
});

// MontageErrorStrips/MontageGridSections stay the REAL implementations (via
// importOriginal): they're this task's own new code, so stubbing them would
// test the stub instead. Their own dependencies (MontageMonitor,
// react-grid-layout) are mocked separately above/below.
vi.mock('../../components/montage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/montage')>();
  return {
    ...actual,
    // Buttons for each callback so a test can fire one and assert what the
    // page persists; the control's own rendering is covered by
    // GridLayoutControls.test.tsx.
    GridLayoutControls: ({
      onApplyGridLayout,
      onSaveLayout,
      onLoadLayout,
      onDeleteLayout,
    }: {
      onApplyGridLayout: (cols: number) => void;
      onSaveLayout: (name: string) => void;
      onLoadLayout: (saved: { name: string; layout: unknown[]; displayCols: number }) => void;
      onDeleteLayout: (index: number) => void;
    }) => (
      <div data-testid="grid-layout-controls-stub">
        <button data-testid="grid-apply-stub" onClick={() => onApplyGridLayout(3)} />
        <button data-testid="grid-save-stub" onClick={() => onSaveLayout('Wall')} />
        <button
          data-testid="grid-load-stub"
          onClick={() => onLoadLayout({ name: 'Wall', layout: [], displayCols: 3 })}
        />
        <button data-testid="grid-delete-stub" onClick={() => onDeleteLayout(0)} />
      </div>
    ),
    FullscreenControls: () => <div data-testid="fullscreen-controls-stub" />,
    // Rendered as buttons so a test can toggle an entry and assert what the
    // page does with the id it hands back; the real list rendering (chips,
    // checked state) is covered by MontageKebabMenu's own tests.
    MontageKebabMenu: ({
      items,
      onToggleVisibility,
      onFeedFitChange,
    }: {
      items: Array<{ id: string; name: string; profileChip?: string }>;
      onToggleVisibility: (id: string) => void;
      onFeedFitChange: (value: string) => void;
    }) => (
      <>
        {/* Feed fit moved into this menu. Kept outside the stub's own element:
            tests enumerate the buttons inside it as the monitor list. */}
        <button data-testid="montage-fit-select" onClick={() => onFeedFitChange('contain')} />
        <div data-testid="montage-kebab-stub">
        {items.map((item) => (
          <button
            key={item.id}
            data-testid={`montage-kebab-item-${item.id}`}
            onClick={() => onToggleVisibility(item.id)}
          >
            {item.profileChip ? `${item.name} (${item.profileChip})` : item.name}
          </button>
        ))}
        </div>
      </>
    ),
    MontageTileErrorBoundary: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useMontageGrid: (options: unknown) => useMontageGridMock(options),
    useContainerResize: () => ({ containerRef: vi.fn() }),
  };
});

// Every `paused` a tile has been rendered with, in order. The DOM only ever
// shows the latest one, and "was this tile ever rendered streaming" is a
// question about the renders in between: a tile that mounts unpaused has
// already minted a connkey by the time a later render pauses it.
const pausedRenders: boolean[] = [];

vi.mock('../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/logger')>();
  return { ...actual, log: { ...actual.log, monitor: vi.fn() } };
});

vi.mock('../../components/monitors/MontageMonitor', () => ({
  MontageMonitor: ({
    monitor,
    profileChip,
    reduceStream,
    paused,
    forceViewMode,
  }: {
    monitor: { Id: string; Name: string };
    profileChip?: string;
    reduceStream?: boolean;
    paused?: boolean;
    forceViewMode?: string;
  }) => {
    pausedRenders.push(paused ?? false);
    return (
      <div>
        {monitor.Name}
        {profileChip && <span data-testid="montage-profile-chip">{profileChip}</span>}
        {/* Attribute rather than text: every tile renders this and the text
            would land in the name assertions above. */}
        <span
          data-testid="montage-tile-tuning"
          data-reduce-stream={String(reduceStream ?? false)}
          data-paused={String(paused ?? false)}
          data-force-view-mode={forceViewMode ?? 'none'}
        />
      </div>
    );
  },
}));

// Its own tests cover the toggle (including how it resolves the page's
// Streaming Mode in All mode); stubbing keeps that resolution's stores out of
// this file's mock surface.
vi.mock('../../components/monitors/AnalysisFramesToggle', () => ({
  AnalysisFramesToggle: () => <div data-testid="analysis-frames-toggle-stub" />,
}));

vi.mock('../../components/filters/GroupFilterSelect', () => ({
  GroupFilterSelect: () => <div data-testid="group-filter-select-stub" />,
}));

// Radix Select needs pointer geometry jsdom does not provide; the stub keeps
// the value; the montage fit control now lives in the kebab menu.
vi.mock('../../components/ui/select', () => ({
  Select: ({ value, onValueChange }: { value: string; onValueChange: (v: string) => void }) => (
    <button data-testid="select-stub" onClick={() => onValueChange('contain')}>
      {value}
    </button>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

// The page's settings-write target: the real profile id in single mode, the
// ALL sentinel in All mode (where currentProfile is null). Set by
// singleProfile()/allMode() below, and mirrored into the real profile store.
let currentProfileId = 'profile-1';

const updateMontageGroupLayoutMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolated values are appended so a dropped one is visible in the
    // assertion rather than silently rendering the bare key. Composed rather
    // than first-match: a key carrying both a count and a label used to
    // assert only the count, so the label could go missing unnoticed.
    // A string second argument is a default value, not params.
    t: (key: string, params?: unknown) => {
      if (typeof params !== 'object' || params === null) return key;
      const values = Object.values(params).filter((v) => v !== undefined);
      return values.length > 0 ? `${key}-${values.join('-')}` : key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Spread over the real defaults rather than hand-listed: the page reads
// ALL-bucket settings that grow over time, and a subset silently hands the
// page `undefined` for any it does not list (which is how the Live Activity
// fixture emptied its own grid). Overrides below are what these tests vary.
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  insomnia: false,
  montageShowToolbar: true,
  montageFeedFit: 'cover' as const,
  montageIsFullscreen: false,
  monitorsGroupByServer: false,
  tvMode: false,
};

function singleProfile(settingsOverrides: Partial<typeof SETTINGS> = {}) {
  currentProfileId = 'profile-1';
  seedProfiles([makeProfile('profile-1', { name: 'Home' })], {
    settings: { 'profile-1': { ...SETTINGS, ...settingsOverrides } },
  });
}

function allMode(
  profiles: Array<{ id: string; name: string }>,
  settingsOverrides: Partial<typeof SETTINGS> = {}
) {
  currentProfileId = ALL_PROFILES_ID;
  seedProfiles(
    profiles.map((p) => makeProfile(p.id, { name: p.name })),
    { current: ALL_PROFILES_ID }
  );
  useSettingsStore.setState((state) => ({
    profileSettings: {
      ...state.profileSettings,
      [ALL_PROFILES_ID]: mergeProfileSettings({ ...SETTINGS, ...settingsOverrides }),
    },
  }));
}

const monitor = (id: string, name: string, sequence?: string) => ({
  Monitor: { Id: id, Name: name, Deleted: false, Sequence: sequence },
  Monitor_Status: { Status: 'Connected' },
});

describe('Montage Page', () => {
  beforeEach(() => {
    hiddenMonitorIds = [];
    pausedRenders.length = 0;
    updateMontageGroupLayoutMock.mockClear();
    useScopedMonitorsMock.mockReset();
    useMontageGridMock.mockReset();
    useGroupFilterMock.mockReset();
    useGroupFilterMock.mockReturnValue({ isFilterActive: false, filteredMonitorIds: [], isFilterReady: true });
    useMontageGridMock.mockReturnValue({
      layout: [],
      gridCols: 2,
      currentWidthRef: { current: 800 },
      handleApplyGridLayout: vi.fn(),
      handleLoadSavedLayout: vi.fn(),
      handleLayoutChange: vi.fn(),
      handleDragStop: vi.fn(),
      handleFillWidth: vi.fn(),
      handleResizeStop: vi.fn(),
      handleWidthChange: vi.fn(),
      togglePinMonitor: vi.fn(),
      isMonitorPinned: () => false,
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows the empty state when no monitors are available', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByText('montage.no_monitors')).toBeInTheDocument();
  });

  // The page's own wiring, not the hook's: useMontageGrid persists every
  // layout write against the id it is handed, so handing it currentProfile
  // (null in All mode) instead of currentProfileId silently disables editing
  // there again (refs #337).
  it('hands useMontageGrid the ALL sentinel in All mode and the real id in single mode', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { rerender } = render(<Montage />);
    expect(useMontageGridMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: 'profile-1' })
    );

    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });
    rerender(<Montage />);

    expect(useMontageGridMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: ALL_PROFILES_ID })
    );
  });

  it('single mode renders tiles with no profile chip', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Door') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-monitor-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('montage-monitor-2')).toHaveTextContent('Back Door');
    expect(screen.queryByTestId('montage-profile-chip')).not.toBeInTheDocument();
    expect(screen.getByTestId('montage-edit-toggle')).not.toBeDisabled();
  });

  // Layout is a view preference, so All mode edits it against the ALL bucket
  // like every other view-level control - the toggle is live, not disabled
  // with an explanatory tooltip (refs #337).
  it('enables the edit-layout toggle in All mode', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    const toggle = screen.getByTestId('montage-edit-toggle');
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('title', 'montage.edit_layout');

    fireEvent.click(toggle);
    expect(screen.getByTestId('montage-edit-toggle')).toHaveTextContent('montage.done_editing');
  });

  // Edit mode used to be force-reset on the way into All mode because the
  // toggle was disabled there; now that it is live, the mode must survive
  // the switch (refs #337).
  it('keeps edit mode on when switching into All mode', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { rerender } = render(<Montage />);
    fireEvent.click(screen.getByTestId('montage-edit-toggle'));
    expect(screen.getByTestId('montage-edit-toggle')).toHaveTextContent('montage.done_editing');

    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });
    rerender(<Montage />);

    const toggle = screen.getByTestId('montage-edit-toggle');
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveTextContent('montage.done_editing');
  });

  // Every view-level montage control writes to the ALL bucket in All mode
  // rather than dropping the change on the floor (refs #337).
  describe('All-mode view-level writes target the ALL bucket', () => {
    const renderAllMode = () => {
      allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
      useScopedMonitorsMock.mockReturnValue({
        monitors: [
          { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        ],
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });
      render(<Montage />);
    };

    it('persists the feed-fit choice', () => {
      renderAllMode();
      fireEvent.click(screen.getByTestId('montage-fit-select'));
      expect(useSettingsStore.getState().profileSettings[ALL_PROFILES_ID].montageFeedFit).toBe('contain');
    });

    it('clears the active saved-layout name when a column count is applied', () => {
      renderAllMode();
      fireEvent.click(screen.getByTestId('grid-apply-stub'));
      expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(ALL_PROFILES_ID, 'ALL', {
        activeLayoutName: null,
      });
    });

    it('persists a saved layout', () => {
      renderAllMode();
      fireEvent.click(screen.getByTestId('grid-save-stub'));
      expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(
        ALL_PROFILES_ID,
        'ALL',
        expect.objectContaining({ activeLayoutName: 'Wall' })
      );
    });

    it('persists the loaded layout name', () => {
      renderAllMode();
      fireEvent.click(screen.getByTestId('grid-load-stub'));
      expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(ALL_PROFILES_ID, 'ALL', {
        activeLayoutName: 'Wall',
      });
    });

    it('persists a saved-layout deletion', () => {
      renderAllMode();
      fireEvent.click(screen.getByTestId('grid-delete-stub'));
      expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(ALL_PROFILES_ID, 'ALL', {
        savedLayouts: [],
      });
    });
  });

  // A hidden monitor must stay un-hideable regardless of the active group
  // filter: the kebab's own list is a DIFFERENT list than the grid's (the
  // grid is group-filtered, the kebab must not be), else a monitor hidden
  // while outside the active group becomes permanently stuck (refs #337,
  // single-mode regression in the final fix wave).
  it('kebab lists every monitor even when the grid is narrowed by an active group filter', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Door') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });
    useGroupFilterMock.mockReturnValue({ isFilterActive: true, filteredMonitorIds: ['1'], isFilterReady: true });

    render(<Montage />);

    // Grid: narrowed to the active group (monitor 2 excluded).
    expect(screen.getByTestId('montage-monitor-1')).toBeInTheDocument();
    expect(screen.queryByTestId('montage-monitor-2')).not.toBeInTheDocument();
    // Kebab: still lists both, so the excluded one stays toggleable. Neither
    // monitor has a Sequence, so the list falls back to sorting by name.
    const entries = within(screen.getByTestId('montage-kebab-stub')).getAllByRole('button');
    expect(entries.map((el) => el.textContent)).toEqual(['Back Door', 'Front Door']);
  });

  // The list has to say which server each entry belongs to: in All mode two
  // servers can expose the same monitor name, and entries cluster by server
  // in the same order the grid sections use (refs #337).
  it('All mode labels every kebab entry with its owning server, clustered by server', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door', '2') },
        { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Door', '1') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam', '1') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    const entries = within(screen.getByTestId('montage-kebab-stub')).getAllByRole('button');
    expect(entries.map((el) => el.textContent)).toEqual([
      'Back Door (Home)',
      'Front Door (Home)',
      'Lobby Cam (Office)',
    ]);
  });

  // The whole point of the composite id: hiding one server's monitor 1 must
  // not touch the other server's monitor 1 (refs #337).
  it('All mode hides only the composite-keyed tile, leaving the other server\'s same-id monitor visible', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    hiddenMonitorIds = ['profile-1:1'];
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.queryByTestId('montage-monitor-profile-1:1')).not.toBeInTheDocument();
    expect(screen.getByTestId('montage-monitor-profile-2:1')).toHaveTextContent('Lobby Cam');
  });

  // All mode has no real profile to persist against, so the hidden list lives
  // in the ALL bucket keyed by the sentinel - the same ALL-bucket write the
  // group-by-server toggle uses. Before this, the toggle silently no-oped.
  it('All mode writes the composite id into the ALL bucket when an entry is toggled off', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);
    fireEvent.click(screen.getByTestId('montage-kebab-item-profile-1:1'));

    expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(ALL_PROFILES_ID, 'ALL', {
      hiddenMonitorIds: ['profile-1:1'],
    });
  });

  it('All mode removes the composite id again when a hidden entry is toggled back on', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    hiddenMonitorIds = ['profile-1:1'];
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);
    fireEvent.click(screen.getByTestId('montage-kebab-item-profile-1:1'));

    expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(ALL_PROFILES_ID, 'ALL', {
      hiddenMonitorIds: [],
    });
  });

  // Hiding every monitor used to be a one-way door: the page fell through to
  // the empty state, which renders without the toolbar, so the kebab that
  // would un-hide them was gone - in All mode and in single mode alike
  // (refs #337). The empty state now keys off the pre-hide list.
  it('All mode keeps the kebab reachable when every monitor is hidden, and un-hiding restores the tile', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    hiddenMonitorIds = ['profile-1:1', 'profile-2:1'];
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { rerender } = render(<Montage />);

    // No tiles, but the list that can bring them back is still on screen, and
    // the page says why the grid is empty.
    expect(screen.queryByTestId('montage-monitor-profile-1:1')).not.toBeInTheDocument();
    expect(screen.getByTestId('montage-all-hidden')).toHaveTextContent('montage.all_hidden-montage.menu_show_monitors');
    const entries = within(screen.getByTestId('montage-kebab-stub')).getAllByRole('button');
    expect(entries.map((el) => el.textContent)).toEqual([
      'Front Door (Home)',
      'Lobby Cam (Office)',
    ]);

    fireEvent.click(screen.getByTestId('montage-kebab-item-profile-1:1'));
    expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith(ALL_PROFILES_ID, 'ALL', {
      hiddenMonitorIds: ['profile-2:1'],
    });

    // What the store write then renders: the tile is back.
    hiddenMonitorIds = ['profile-2:1'];
    rerender(<Montage />);
    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('montage-all-hidden')).not.toBeInTheDocument();
  });

  it('single mode keeps the kebab reachable when every monitor is hidden, and un-hiding restores the tile', () => {
    singleProfile();
    hiddenMonitorIds = ['1', '2'];
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Door') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { rerender } = render(<Montage />);

    expect(screen.queryByTestId('montage-monitor-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('montage-all-hidden')).toHaveTextContent('montage.all_hidden-montage.menu_show_monitors');

    fireEvent.click(screen.getByTestId('montage-kebab-item-1'));
    expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith('profile-1', 'ALL', {
      hiddenMonitorIds: ['2'],
    });

    hiddenMonitorIds = ['2'];
    rerender(<Montage />);
    expect(screen.getByTestId('montage-monitor-1')).toHaveTextContent('Front Door');
  });

  // The notice names the kebab's "Show monitors" list, and fullscreen renders
  // its own thin toolbar with no kebab on it - so in fullscreen the notice
  // pointed the user at a control that is not on screen (refs #337).
  it('drops the all-hidden notice in fullscreen, where the menu it names does not exist', () => {
    allMode([{ id: 'profile-1', name: 'Home' }], { montageIsFullscreen: true });
    hiddenMonitorIds = ['profile-1:1'];
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.queryByTestId('montage-all-hidden')).not.toBeInTheDocument();
    // Fullscreen really is on, so the assertion above is about the notice and
    // not about a page that failed to render.
    expect(screen.getByTestId('fullscreen-controls-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('montage-kebab-stub')).not.toBeInTheDocument();
  });

  // A profile that genuinely has no monitors keeps the old empty state, with
  // no toolbar and nothing to un-hide.
  it('keeps the plain empty state when the server has no monitors at all', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByText('montage.no_monitors')).toBeInTheDocument();
    expect(screen.queryByTestId('montage-kebab-stub')).not.toBeInTheDocument();
  });

  // Single mode keeps bare ids so hidden lists stored before this change keep
  // working - no migration of stored data.
  it('single mode keeps bare monitor ids, for the stored list and for new writes', () => {
    singleProfile();
    hiddenMonitorIds = ['2'];
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Door') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    // The stored bare id still hides its tile.
    expect(screen.getByTestId('montage-monitor-1')).toHaveTextContent('Front Door');
    expect(screen.queryByTestId('montage-monitor-2')).not.toBeInTheDocument();
    // And a new toggle stores a bare id against the real profile.
    fireEvent.click(screen.getByTestId('montage-kebab-item-1'));
    expect(updateMontageGroupLayoutMock).toHaveBeenCalledWith('profile-1', 'ALL', {
      hiddenMonitorIds: ['2', '1'],
    });
  });

  it('All mode renders both profiles\' tiles with a profile chip each, composite-keyed', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        // Colliding raw monitor id "1" on both servers: composite tile ids
        // (profileId:monitorId) must keep both distinct on screen.
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('1', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('montage-monitor-profile-2:1')).toHaveTextContent('Lobby Cam');
    const chips = screen.getAllByTestId('montage-profile-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Home', 'Office']);
  });

  it('caps total tiles across profiles at the All-mode stream cap and reports the overflow', () => {
    const profiles = [{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }];
    allMode(profiles);
    const scoped = [
      ...Array.from({ length: 10 }, (_, i) => ({
        profileId: 'profile-1',
        profileName: 'Home',
        item: monitor(`h${i}`, `Home ${i}`),
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        profileId: 'profile-2',
        profileName: 'Office',
        item: monitor(`o${i}`, `Office ${i}`),
      })),
    ];
    useScopedMonitorsMock.mockReturnValue({
      monitors: scoped,
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    // 20 monitors total, cap is the default allModeMaxStreams (16).
    const tiles = container.querySelectorAll('[data-testid^="montage-monitor-"]');
    expect(tiles.length).toBe(16);
    expect(screen.getByTestId('montage-stream-cap-overflow')).toHaveTextContent(
      'montage.stream_cap_overflow-4'
    );
  });

  it('caps at the stream limit the ALL bucket sets, not the shipped default', () => {
    // The cap is a user setting now: a montage told to show 2 shows 2 and
    // reports the other 18 as overflow, whatever the shipped default says.
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }], {
      allModeMaxStreams: 2,
    });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        ...Array.from({ length: 10 }, (_, i) => ({
          profileId: 'profile-1',
          profileName: 'Home',
          item: monitor(`h${i}`, `Home ${i}`),
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          profileId: 'profile-2',
          profileName: 'Office',
          item: monitor(`o${i}`, `Office ${i}`),
        })),
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    const tiles = container.querySelectorAll('[data-testid^="montage-monitor-"]');
    expect(tiles.length).toBe(2);
    expect(screen.getByTestId('montage-stream-cap-overflow')).toHaveTextContent(
      'montage.stream_cap_overflow-18'
    );
  });

  describe('pause while hidden', () => {
    const oneMonitor = () => {
      useScopedMonitorsMock.mockReturnValue({
        monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });
    };

    const setVisibility = (state: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    beforeEach(() => {
      vi.useFakeTimers();
      setVisibility('visible');
    });

    afterEach(() => {
      vi.useRealTimers();
      setVisibility('visible');
    });

    it('stops its tiles once All mode has been hidden past the grace period', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModePauseHidden: true });
      oneMonitor();

      render(<Montage />);
      expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-paused', 'false');

      act(() => { setVisibility('hidden'); });
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.pauseHiddenGraceMs); });

      expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-paused', 'true');

      act(() => { setVisibility('visible'); });

      expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-paused', 'false');
    });

    it('keeps streaming while hidden when the setting is off', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModePauseHidden: false });
      oneMonitor();

      render(<Montage />);

      act(() => { setVisibility('hidden'); });
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.pauseHiddenGraceMs * 2); });

      expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-paused', 'false');
    });

    it('never pauses in single mode, whatever the ALL bucket says', () => {
      singleProfile({ allModePauseHidden: true });
      oneMonitor();

      render(<Montage />);

      act(() => { setVisibility('hidden'); });
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.pauseHiddenGraceMs * 2); });

      expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-paused', 'false');
    });
  });

  describe('idle downgrade', () => {
    const IDLE_MINUTES = 5;
    const IDLE_MS = IDLE_MINUTES * 60_000;

    const oneMonitor = () => {
      useScopedMonitorsMock.mockReturnValue({
        monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });
    };

    const viewMode = () =>
      screen.getByTestId('montage-tile-tuning').getAttribute('data-force-view-mode');

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('drops All-mode tiles to snapshots after the idle period, and streams again on a touch', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeIdleMinutes: IDLE_MINUTES });
      oneMonitor();

      render(<Montage />);
      expect(viewMode()).toBe('none');

      act(() => { vi.advanceTimersByTime(IDLE_MS); });
      expect(viewMode()).toBe('snapshot');

      act(() => { document.dispatchEvent(new Event('pointerdown')); });
      expect(viewMode()).toBe('none');
    });

    it('keeps streaming when the idle downgrade is switched off', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeIdleMinutes: 0 });
      oneMonitor();

      render(<Montage />);
      act(() => { vi.advanceTimersByTime(IDLE_MS * 4); });

      expect(viewMode()).toBe('none');
    });

    it('never downgrades in single mode, whatever the ALL bucket says', () => {
      singleProfile({ allModeIdleMinutes: IDLE_MINUTES });
      oneMonitor();

      render(<Montage />);
      act(() => { vi.advanceTimersByTime(IDLE_MS * 4); });

      expect(viewMode()).toBe('none');
    });
  });

  describe('viewport gating', () => {
    const TILE = 'montage-monitor-profile-1:1';

    const oneMonitor = () => {
      useScopedMonitorsMock.mockReturnValue({
        monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });
    };

    const manyMonitors = (count: number) => {
      useScopedMonitorsMock.mockReturnValue({
        monitors: Array.from({ length: count }, (_, i) => ({
          profileId: 'profile-1',
          profileName: 'Home',
          item: monitor(String(i + 1), `Cam ${i + 1}`),
        })),
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });
    };

    const paused = () =>
      screen.getByTestId('montage-tile-tuning').getAttribute('data-paused');

    const allPaused = () =>
      screen.getAllByTestId('montage-tile-tuning').map((el) => el.getAttribute('data-paused'));

    /**
     * The element the page actually handed the observer for this tile, found
     * through the observer rather than by walking the tile's DOM: which node
     * carries the ref is the page's business, but it has to be one inside the
     * tile, and there has to be one at all.
     */
    const observedIn = (testId: string): Element => {
      const tile = screen.getByTestId(testId);
      const target = [...latestIntersectionObserver().targets].find((el) => tile.contains(el));
      if (!target) throw new Error(`no observed element inside ${testId}`);
      return target;
    };

    /** Report the tile's position the way the browser's observer would. */
    const report = (isIntersecting: boolean) => {
      const target = observedIn(TILE);
      act(() => { latestIntersectionObserver().fire([{ target, isIntersecting }]); });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      installMockIntersectionObserver();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('holds an unmeasured tile closed and opens it once it is reported in view', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: true });
      oneMonitor();

      render(<Montage />);
      expect(paused()).toBe('true');

      report(true);

      expect(paused()).toBe('false');
    });

    it('never renders a tile streaming before the observer has placed it', () => {
      // The DOM assertion above only sees the settled state, and the cost this
      // feature exists to avoid is paid in the renders before that: a tile
      // rendered unpaused even once has already minted a connkey, which the
      // next render's gate then quits. Every render's `paused` is recorded, so
      // a single unpaused one fails here.
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: true });
      oneMonitor();

      render(<Montage />);

      expect(pausedRenders.length).toBeGreaterThan(0);
      expect(pausedRenders).not.toContain(false);

      // And the recorder does see the other answer, so the assertion above is
      // not passing because nothing was ever recorded.
      report(true);
      expect(pausedRenders).toContain(false);
    });

    it('stops a tile that scrolled out, but only after the linger', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: true });
      oneMonitor();

      render(<Montage />);
      report(true);
      report(false);
      expect(paused()).toBe('false');

      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.viewportGatingLingerMs - 1); });
      expect(paused()).toBe('false');

      act(() => { vi.advanceTimersByTime(1); });
      expect(paused()).toBe('true');

      report(true);
      expect(paused()).toBe('false');
    });

    it('leaves every tile streaming while the setting is off', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: false });
      oneMonitor();

      render(<Montage />);

      expect(paused()).toBe('false');
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.viewportGatingLingerMs * 2); });
      expect(paused()).toBe('false');
    });

    // A montage only has tiles nobody is looking at once it outgrows the screen,
    // and below that the observer would run for nothing. Past the threshold the
    // off-screen tiles are what starve the visible ones of the handful of
    // connections a browser opens to one host, so gating turns itself on
    // without waiting for a setting nobody in single mode can reach (refs #507).
    // Six rounds of #507 were spent inferring from logs that say nothing about
    // gating. This line is what a device log can be read against: it reports
    // how many of the montage's tiles hold no connection right now.
    it('reports how many tiles are gated', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);
      // Other tests in this file render montages too; only this render's line
      // should be read.
      vi.mocked(log.monitor).mockClear();

      render(<Montage />);

      const reported = vi.mocked(log.monitor).mock.calls.find(([message]) =>
        String(message).includes('Viewport gating'),
      );
      expect(reported?.[2]).toMatchObject({
        gated: MONTAGE_GRID.viewportGatingMinTiles + 1,
        tiles: MONTAGE_GRID.viewportGatingMinTiles + 1,
        enabled: true,
      });
    });

    it('gates a single-profile montage once it passes the tile threshold', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles + 1);

      render(<Montage />);

      // Nothing has been measured yet, and an unmeasured tile counts as gated,
      // so no tile mints a connkey it would have to quit a frame later.
      expect(allPaused()).not.toContain('false');
    });

    it('leaves a montage at the threshold alone, setting or no setting', () => {
      singleProfile();
      manyMonitors(MONTAGE_GRID.viewportGatingMinTiles);

      render(<Montage />);

      expect(allPaused()).not.toContain('true');
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.viewportGatingLingerMs * 2); });
      expect(allPaused()).not.toContain('true');
    });

    it('never gates in single mode, whatever the ALL bucket says', () => {
      singleProfile({ allModeViewportGating: true });
      oneMonitor();

      render(<Montage />);

      expect(paused()).toBe('false');
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.viewportGatingLingerMs * 2); });
      expect(paused()).toBe('false');
    });

    it('gates each tile on its own position rather than the grid as a whole', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: true });
      useScopedMonitorsMock.mockReturnValue({
        monitors: [
          { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
          { profileId: 'profile-1', profileName: 'Home', item: monitor('2', 'Back Yard') },
        ],
        errors: [],
        isLoading: false,
        refetchProfile: vi.fn(),
      });

      render(<Montage />);
      act(() => {
        latestIntersectionObserver().fire([
          { target: observedIn('montage-monitor-profile-1:1'), isIntersecting: true },
          { target: observedIn('montage-monitor-profile-1:2'), isIntersecting: false },
        ]);
      });
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.viewportGatingLingerMs); });

      const [first, second] = screen.getAllByTestId('montage-tile-tuning');
      expect(first).toHaveAttribute('data-paused', 'false');
      expect(second).toHaveAttribute('data-paused', 'true');
    });

    it('keeps a hidden page paused even where the tile is in view', () => {
      // Two guardrails, one answer: either reason to stop is enough, so the
      // tile stays closed until BOTH say it may stream.
      allMode([{ id: 'profile-1', name: 'Home' }], {
        allModeViewportGating: true,
        allModePauseHidden: true,
      });
      oneMonitor();

      render(<Montage />);
      report(true);
      expect(paused()).toBe('false');

      act(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.pauseHiddenGraceMs); });
      expect(paused()).toBe('true');

      act(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(paused()).toBe('false');
    });

    it('stops an off-screen tile outright rather than downgrading it to snapshots', () => {
      // The idle downgrade asks for snapshots; gating asks for no connection
      // at all. A tile both apply to holds no connection: pausing wins,
      // because a snapshot poll is still traffic for a tile nobody can see.
      allMode([{ id: 'profile-1', name: 'Home' }], {
        allModeViewportGating: true,
        allModeIdleMinutes: 5,
      });
      oneMonitor();

      render(<Montage />);
      report(true);
      act(() => { vi.advanceTimersByTime(5 * 60_000); });
      expect(paused()).toBe('false');
      expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute(
        'data-force-view-mode',
        'snapshot'
      );

      report(false);
      act(() => { vi.advanceTimersByTime(MONTAGE_GRID.viewportGatingLingerMs); });

      expect(paused()).toBe('true');
    });

    it('releases a gated tile when the setting is turned off', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: true });
      oneMonitor();

      const { rerender } = render(<Montage />);
      expect(paused()).toBe('true');

      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: false });
      rerender(<Montage />);

      expect(paused()).toBe('false');
    });

    it('leaves no linger timer behind when the montage unmounts', () => {
      allMode([{ id: 'profile-1', name: 'Home' }], { allModeViewportGating: true });
      oneMonitor();

      const { unmount } = render(<Montage />);
      report(true);
      report(false);
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('tells its tiles to reduce when All mode asks for reduced stream tuning', () => {
    allMode([{ id: 'profile-1', name: 'Home' }], { allModeStreamTuning: 'reduced' });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-reduce-stream', 'true');
  });

  it('leaves tiles at full quality when All-mode tuning is off', () => {
    allMode([{ id: 'profile-1', name: 'Home' }], { allModeStreamTuning: 'off' });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-reduce-stream', 'false');
  });

  it('never reduces in single mode, whatever the ALL bucket says', () => {
    // The knob lives in the ALL bucket, but a single profile's own settings
    // carry the same key. Reading it outside All mode would throttle a server
    // the user never asked to throttle.
    singleProfile({ allModeStreamTuning: 'reduced' });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') }],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-tile-tuning')).toHaveAttribute('data-reduce-stream', 'false');
  });

  it('splits the stream budget across servers instead of letting the first one eat it', () => {
    // A global first-N slice let profile-1's ten monitors consume the whole
    // budget, so profile-2 rendered nothing at all - the aggregate view showed
    // one server. Four slots over two servers is two each (refs #337).
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }], {
      allModeMaxStreams: 4,
    });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        ...Array.from({ length: 10 }, (_, i) => ({
          profileId: 'profile-1',
          profileName: 'Home',
          item: monitor(`h${i}`, `Home ${i}`),
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          profileId: 'profile-2',
          profileName: 'Office',
          item: monitor(`o${i}`, `Office ${i}`),
        })),
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    const tiles = [...container.querySelectorAll('[data-testid^="montage-monitor-"]')].map(
      (tile) => tile.getAttribute('data-testid')
    );
    expect(tiles).toEqual([
      'montage-monitor-profile-1:h0',
      'montage-monitor-profile-1:h1',
      'montage-monitor-profile-2:o0',
      'montage-monitor-profile-2:o1',
    ]);
    expect(screen.getByTestId('montage-stream-cap-overflow')).toHaveTextContent(
      'montage.stream_cap_overflow-16'
    );
  });

  it('hands the odd slot to the first server when the budget does not divide evenly', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }], {
      allModeMaxStreams: 5,
    });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        ...Array.from({ length: 10 }, (_, i) => ({
          profileId: 'profile-1',
          profileName: 'Home',
          item: monitor(`h${i}`, `Home ${i}`),
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          profileId: 'profile-2',
          profileName: 'Office',
          item: monitor(`o${i}`, `Office ${i}`),
        })),
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    const tiles = [...container.querySelectorAll('[data-testid^="montage-monitor-"]')].map(
      (tile) => tile.getAttribute('data-testid')
    );
    expect(tiles).toEqual([
      'montage-monitor-profile-1:h0',
      'montage-monitor-profile-1:h1',
      'montage-monitor-profile-1:h2',
      'montage-monitor-profile-2:o0',
      'montage-monitor-profile-2:o1',
    ]);
  });

  it('caps a single server in profile order, exactly as it did before', () => {
    allMode([{ id: 'profile-1', name: 'Home' }], { allModeMaxStreams: 3 });
    useScopedMonitorsMock.mockReturnValue({
      monitors: Array.from({ length: 10 }, (_, i) => ({
        profileId: 'profile-1',
        profileName: 'Home',
        item: monitor(`h${i}`, `Home ${i}`),
      })),
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    const tiles = [...container.querySelectorAll('[data-testid^="montage-monitor-"]')].map(
      (tile) => tile.getAttribute('data-testid')
    );
    expect(tiles).toEqual([
      'montage-monitor-profile-1:h0',
      'montage-monitor-profile-1:h1',
      'montage-monitor-profile-1:h2',
    ]);
  });

  it('single mode never caps tiles, even past the All-mode limit', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: Array.from({ length: 20 }, (_, i) => ({
        profileId: 'profile-1',
        profileName: 'Home',
        item: monitor(`m${i}`, `Monitor ${i}`),
      })),
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    const { container } = render(<Montage />);

    const tiles = container.querySelectorAll('[data-testid^="montage-monitor-"]');
    expect(tiles.length).toBe(20);
    expect(screen.queryByTestId('montage-stream-cap-overflow')).not.toBeInTheDocument();
  });

  it('All mode shows an error strip for a failed profile while the healthy profile still renders', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    const refetchProfile = vi.fn();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
      ],
      errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('network down') }],
      isLoading: false,
      refetchProfile,
    });

    render(<Montage />);

    expect(screen.getByTestId('profile-error-strip-profile-2')).toBeInTheDocument();
    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');

    screen.getByTestId('profile-error-strip-retry-profile-2').click();
    expect(refetchProfile).toHaveBeenCalledWith('profile-2');
  });

  it('suppresses the error strip for a profile with cached monitors despite a background refetch error', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }]);
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('2', 'Lobby Cam') },
      ],
      errors: [{ profileId: 'profile-2', profileName: 'Office', error: new Error('offline') }],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-monitor-profile-2:2')).toHaveTextContent('Lobby Cam');
    expect(screen.queryByTestId('profile-error-strip-profile-2')).not.toBeInTheDocument();
  });

  it('single mode shows the byte-identical cold-start error wall, not a strip', () => {
    singleProfile();
    useScopedMonitorsMock.mockReturnValue({
      monitors: [],
      errors: [{ profileId: 'profile-1', profileName: 'Home', error: new Error('network down') }],
      isLoading: true,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.queryByTestId('profile-error-strip-profile-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('montage-grid')).not.toBeInTheDocument();
  });

  it('All mode groups tiles into per-server sections when monitorsGroupByServer is on', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }], {
      monitorsGroupByServer: true,
    });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('2', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    expect(screen.getByTestId('montage-group-toggle-profile-1')).toHaveTextContent('Home');
    expect(screen.getByTestId('montage-group-toggle-profile-2')).toHaveTextContent('Office');
    expect(screen.getByTestId('montage-monitor-profile-1:1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('montage-monitor-profile-2:2')).toHaveTextContent('Lobby Cam');
  });

  // Collapsing takes the section's tiles out of the tree, which is what stops
  // their streams; the other server keeps playing (refs #503).
  it('collapsing a montage section unmounts that server\'s tiles only', () => {
    allMode([{ id: 'profile-1', name: 'Home' }, { id: 'profile-2', name: 'Office' }], {
      monitorsGroupByServer: true,
    });
    useScopedMonitorsMock.mockReturnValue({
      monitors: [
        { profileId: 'profile-1', profileName: 'Home', item: monitor('1', 'Front Door') },
        { profileId: 'profile-2', profileName: 'Office', item: monitor('2', 'Lobby Cam') },
      ],
      errors: [],
      isLoading: false,
      refetchProfile: vi.fn(),
    });

    render(<Montage />);

    fireEvent.click(screen.getByTestId('montage-group-toggle-profile-1'));

    expect(screen.queryByTestId('montage-monitor-profile-1:1')).toBeNull();
    expect(screen.getByTestId('montage-monitor-profile-2:2')).toHaveTextContent('Lobby Cam');
    // The section itself, and its count, stay: this is not the server filter.
    expect(screen.getByTestId('montage-group-toggle-profile-1')).toHaveTextContent('Home');
    expect(screen.getByTestId('montage-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'false');
  });
});
