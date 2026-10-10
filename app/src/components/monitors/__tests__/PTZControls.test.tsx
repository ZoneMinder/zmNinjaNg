import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { PTZControls } from '../PTZControls';
import { asProfileId, type ZMControl } from '../../../api/types';
import { UI_INTERACTIONS } from '../../../lib/zmninja-ng-constants';
import { seedProfiles, resetProfileFixture, makeProfile, fakeApiClient } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// usePermissions is real; no profile is ever seeded outside the permission
// describe below, so its query stays disabled (unknown, never denied) - the
// same default the old blanket mock gave every other describe here.
function withQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

// jsdom does not implement pointer capture; the pointerdown handler calls it.
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  resetProfileFixture();
  resetFakeStoreGates();
});

/** Continuous-drive control: one start command, no repeat timer. */
const continuousControl = {
  CanMove: '1',
  CanMoveCon: '1',
} as ZMControl;

/** Relative-drive control: the step command repeats on a timer while held. */
const relativeControl = {
  CanMove: '1',
  CanMoveRel: '1',
} as ZMControl;

const POINTER = { pointerId: 1 };

describe('PTZControls panel', () => {
  // tests/steps/ptz.steps.ts asserts this testid. It went missing once and the
  // e2e guard (Controllable === 0 on the test server) hid the breakage.
  it('marks the panel root with the ptz-controls testid', () => {
    render(withQuery(<PTZControls onCommand={vi.fn()} control={continuousControl} />));
    expect(screen.getByTestId('ptz-controls')).toBeInTheDocument();
  });

  it('renders nothing when the monitor has no control definition', () => {
    const { container } = render(withQuery(<PTZControls onCommand={vi.fn()} />));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows and dispatches camera wake, sleep, reset, and reboot actions when supported', () => {
    const onCommand = vi.fn();
    const control = { CanWake: '1', CanSleep: '1', CanReset: '1', CanReboot: '1' } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={onCommand} control={control} />));

    fireEvent.click(screen.getByTestId('ptz-wake'));
    fireEvent.click(screen.getByTestId('ptz-sleep'));
    fireEvent.click(screen.getByTestId('ptz-reset'));
    fireEvent.click(screen.getByTestId('ptz-reboot'));
    expect(onCommand).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByTestId('ptz-reboot-confirm'));

    expect(onCommand).toHaveBeenNthCalledWith(1, 'wake');
    expect(onCommand).toHaveBeenNthCalledWith(2, 'sleep');
    expect(onCommand).toHaveBeenNthCalledWith(3, 'reset');
    expect(onCommand).toHaveBeenNthCalledWith(4, 'reboot');
  });

  it('does not reboot the camera when the confirm is cancelled', () => {
    const onCommand = vi.fn();
    const control = { CanReboot: '1' } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={onCommand} control={control} />));

    fireEvent.click(screen.getByTestId('ptz-reboot'));
    fireEvent.click(screen.getByTestId('ptz-reboot-cancel'));

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('hides camera wake, sleep, reset, and reboot actions when unsupported', () => {
    const control = { CanWake: '0', CanSleep: '0', CanReset: '0', CanReboot: '0' } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={vi.fn()} control={control} />));

    expect(screen.queryByTestId('ptz-wake')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ptz-sleep')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ptz-reset')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ptz-reboot')).not.toBeInTheDocument();
  });
});

describe('PTZControls hold button', () => {
  it('sends the stop command when unmounted while a button is held', () => {
    const onCommand = vi.fn();
    const { unmount } = render(withQuery(<PTZControls onCommand={onCommand} control={continuousControl} />));

    fireEvent.pointerDown(screen.getByTestId('ptz-right'), POINTER);
    expect(onCommand).toHaveBeenCalledWith('moveConRight');
    onCommand.mockClear();

    unmount();

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith('moveStop');
  });

  it('clears the repeat interval when unmounted while a button is held', () => {
    vi.useFakeTimers();
    const onCommand = vi.fn();
    const { unmount } = render(withQuery(<PTZControls onCommand={onCommand} control={relativeControl} />));

    fireEvent.pointerDown(screen.getByTestId('ptz-up'), POINTER);
    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs);
    // One press + one repeat tick.
    expect(onCommand.mock.calls.filter(([c]) => c === 'moveRelUp')).toHaveLength(2);

    unmount();
    onCommand.mockClear();

    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs * 5);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('sends no command when unmounted with no button held', () => {
    const onCommand = vi.fn();
    const { unmount } = render(withQuery(<PTZControls onCommand={onCommand} control={continuousControl} />));

    unmount();

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('sends no stop command after the pointer was already released', () => {
    const onCommand = vi.fn();
    const { unmount } = render(withQuery(<PTZControls onCommand={onCommand} control={continuousControl} />));

    const button = screen.getByTestId('ptz-left');
    fireEvent.pointerDown(button, POINTER);
    fireEvent.pointerUp(button, POINTER);
    expect(onCommand).toHaveBeenNthCalledWith(1, 'moveConLeft');
    expect(onCommand).toHaveBeenNthCalledWith(2, 'moveStop');
    onCommand.mockClear();

    unmount();

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('fires the command on press and the stop command on release, ending the repeat', () => {
    vi.useFakeTimers();
    const onCommand = vi.fn();
    render(withQuery(<PTZControls onCommand={onCommand} control={relativeControl} />));

    const button = screen.getByTestId('ptz-down');
    fireEvent.pointerDown(button, POINTER);
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('moveRelDown');

    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs * 2);
    expect(onCommand.mock.calls.filter(([c]) => c === 'moveRelDown')).toHaveLength(3);

    fireEvent.pointerUp(button, POINTER);
    expect(onCommand).toHaveBeenLastCalledWith('moveStop');
    onCommand.mockClear();

    vi.advanceTimersByTime(UI_INTERACTIONS.ptzHoldRepeatMs * 5);
    expect(onCommand).not.toHaveBeenCalled();
  });
});

/**
 * PTZ needs its own ZoneMinder permission (refs #344).
 *
 * `ajax/control.php` gates on canView('Control', id): a camera being
 * controllable is a property of the hardware, and Control is the user's right
 * to use it. Those are different questions, and only the second one decides
 * whether these buttons can do anything.
 */
describe('PTZControls without control permission', () => {
  const control = { CanMove: '1', CanMoveCon: '1', CanZoom: '1' } as unknown as ZMControl;

  it('renders nothing when ZoneMinder denies control', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(asProfileId('p1'), fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Control: 'None' } }] } }));

    render(withQuery(<PTZControls onCommand={vi.fn()} control={control} />));

    await waitFor(() => expect(screen.queryByTestId('ptz-controls')).not.toBeInTheDocument());
  });

  it('renders at View, which is all ZoneMinder asks for', async () => {
    seedProfiles([makeProfile('p1', { username: 'bob' })]);
    installApiClient(asProfileId('p1'), fakeApiClient({ '/users.json': { users: [{ User: { Username: 'bob', Control: 'View' } }] } }));

    render(withQuery(<PTZControls onCommand={vi.fn()} control={control} />));

    await waitFor(() => expect(screen.getByTestId('ptz-controls')).toBeInTheDocument());
  });

  it('renders while the permission is unknown', () => {
    // No profile seeded at all: currentProfile is null, so usePermissions'
    // query stays disabled - permissions never resolve past unknown.
    render(withQuery(<PTZControls onCommand={vi.fn()} control={control} />));

    expect(screen.getByTestId('ptz-controls')).toBeInTheDocument();
  });
});

/**
 * The pad must offer only the axes the driver has. ZoneMinder's own pad hides
 * up/down without CanTilt and left/right without CanPan
 * (skins/classic/includes/control_functions.php); a pan-only driver such as a
 * single-servo mount rejects every tilt command, so an arrow that sends one is
 * a button that cannot work.
 *
 * `invisible` keeps the 3x3 grid from reflowing, which is how the diagonals
 * were already handled.
 */
describe('PTZControls axis capabilities', () => {
  const expectHidden = (testId: string) =>
    expect(screen.getByTestId(testId)).toHaveClass('invisible');
  const expectShown = (testId: string) =>
    expect(screen.getByTestId(testId)).not.toHaveClass('invisible');

  it('hides the tilt arrows and keeps pan when the driver cannot tilt', () => {
    const panOnly = {
      CanMove: '1', CanMoveCon: '1', CanPan: '1', CanTilt: '0',
    } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={vi.fn()} control={panOnly} />));

    expectHidden('ptz-up');
    expectHidden('ptz-down');
    expectShown('ptz-left');
    expectShown('ptz-right');
  });

  it('hides the pan arrows and keeps tilt when the driver cannot pan', () => {
    const tiltOnly = {
      CanMove: '1', CanMoveCon: '1', CanPan: '0', CanTilt: '1',
    } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={vi.fn()} control={tiltOnly} />));

    expectHidden('ptz-left');
    expectHidden('ptz-right');
    expectShown('ptz-up');
    expectShown('ptz-down');
  });

  it('hides the diagonals when an axis is missing, even with CanMoveDiag', () => {
    const panOnlyDiag = {
      CanMove: '1', CanMoveCon: '1', CanPan: '1', CanTilt: '0', CanMoveDiag: '1',
    } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={vi.fn()} control={panOnlyDiag} />));

    for (const id of ['ptz-up-left', 'ptz-up-right', 'ptz-down-left', 'ptz-down-right']) {
      expectHidden(id);
    }
  });

  it('shows every arrow when a control definition omits the axis fields', () => {
    const legacy = { CanMove: '1', CanMoveCon: '1', CanMoveDiag: '1' } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={vi.fn()} control={legacy} />));

    for (const id of ['ptz-up', 'ptz-down', 'ptz-left', 'ptz-right', 'ptz-up-left']) {
      expectShown(id);
    }
  });

  it('hides an axis the server reports as anything other than capable', () => {
    // ZMControlSchema coerces the field to a string, so a server that answers
    // with a JSON boolean or an empty column arrives here as 'false' or ''.
    // Those mean the same as '0' and must hide the axis; only an absent field
    // is treated as capable.
    const coercedFalse = {
      CanMove: '1', CanMoveCon: '1', CanPan: 'false', CanTilt: '',
    } as unknown as ZMControl;

    render(withQuery(<PTZControls onCommand={vi.fn()} control={coercedFalse} />));

    expectHidden('ptz-left');
    expectHidden('ptz-right');
    expectHidden('ptz-up');
    expectHidden('ptz-down');
  });
});
