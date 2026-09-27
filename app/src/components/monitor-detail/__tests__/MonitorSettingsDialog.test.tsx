/**
 * MonitorSettingsDialog save-diff tests.
 *
 * The dialog derives reset, change-detection, and the save payload from one
 * field-descriptor list. These tests lock the behavior that matters: Save is
 * disabled until something changes, and the payload contains only the fields
 * the user actually edited.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { MonitorSettingsDialog } from '../MonitorSettingsDialog';
import { asProfileId, type Monitor } from '../../../api/types';
import { useSettingsStore } from '../../../stores/settings';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

// Seeds the real settings/profile stores. 'p1' is the current profile (the
// dialog falls back to it when no owning profileId prop is given); 'profile-b'
// backs the All-mode owning-profile describe below.
function seedSettings(overrides: {
  disableLogRedaction?: boolean;
  forceZmsMonitorIds?: string[];
  fullscreenMonitorIds?: string[];
  profileB?: { disableLogRedaction?: boolean; forceZmsMonitorIds?: string[] };
} = {}) {
  seedProfiles([makeProfile('p1'), makeProfile('profile-b')], {
    current: 'p1',
    settings: {
      p1: {
        disableLogRedaction: overrides.disableLogRedaction ?? false,
        forceZmsMonitorIds: overrides.forceZmsMonitorIds ?? [],
        fullscreenMonitorIds: overrides.fullscreenMonitorIds ?? [],
      },
      'profile-b': {
        disableLogRedaction: overrides.profileB?.disableLogRedaction ?? false,
        forceZmsMonitorIds: overrides.profileB?.forceZmsMonitorIds ?? [],
      },
    },
  });
}

const baseMonitor = {
  Id: '1',
  Name: 'Front Door',
  Type: 'Ffmpeg',
  Capturing: 'Always',
  Analysing: 'Always',
  Recording: 'OnMotion',
  Function: 'Modect',
  Enabled: '1',
  SaveJPEGs: '0',
  VideoWriter: '0',
  Path: 'rtsp://cam/stream',
  User: '',
  Pass: '',
  Method: 'rtpRtsp',
  MaxFPS: '',
  AlarmMaxFPS: '',
  Orientation: 'ROTATE_0',
  EventStartCommand: '',
  EventEndCommand: '',
  Width: '640',
  Height: '480',
  Colours: '4',
  Controllable: '0',
  Go2RTCEnabled: false,
} as unknown as Monitor;

describe('MonitorSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSettings();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('keeps Save disabled until a field changes', () => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={vi.fn()}
      />
    );
    expect(screen.getByTestId('settings-video-save-button')).toBeDisabled();
  });

  it('sends only the edited field in the save payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByTestId('settings-source-input'), {
      target: { value: 'rtsp://cam/new-stream' },
    });

    const saveButton = screen.getByTestId('settings-video-save-button');
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://cam/new-stream' });
  });
});

/**
 * "Always use ZMS for events" (#313).
 *
 * An app-local preference keyed by monitor id, not a ZoneMinder monitor column.
 * It applies the moment it is toggled, so it must never enter the dialog's
 * change detection nor its save payload: sending it would ask ZM to write a
 * field it does not have.
 */
describe('MonitorSettingsDialog force-ZMS toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSettings();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  const renderDialog = (onSave = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
      />
    );
    return onSave;
  };

  const toggle = () => screen.getByTestId('settings-monitor-force-zms-switch');

  it('is off for a monitor that is not on the list', () => {
    renderDialog();
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('is on for a monitor already on the list', () => {
    seedSettings({ forceZmsMonitorIds: ['1'] });
    renderDialog();
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('adds the monitor to the setting the moment it is switched on', () => {
    renderDialog();

    fireEvent.click(toggle());

    expect(useSettingsStore.getState().getProfileSettings(asProfileId('p1')).forceZmsMonitorIds).toEqual(['1']);
  });

  it('removes only this monitor when switched off', () => {
    seedSettings({ forceZmsMonitorIds: ['1', '4'] });
    renderDialog();

    fireEvent.click(toggle());

    expect(useSettingsStore.getState().getProfileSettings(asProfileId('p1')).forceZmsMonitorIds).toEqual(['4']);
  });

  it('leaves Save disabled and keeps the setting out of the ZM payload', async () => {
    const onSave = renderDialog();

    fireEvent.click(toggle());
    expect(screen.getByTestId('settings-video-save-button')).toBeDisabled();

    fireEvent.change(screen.getByTestId('settings-source-input'), {
      target: { value: 'rtsp://cam/new-stream' },
    });
    fireEvent.click(screen.getByTestId('settings-video-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://cam/new-stream' });
  });
});

/**
 * Camera credentials on screen (refs #307).
 *
 * Pre-1.38 ZoneMinder has nowhere to put a camera password but the source URL,
 * so `Path` is where the secret usually is. While log redaction is on, the
 * password segment is masked and the reveal toggle is gone, but both fields
 * stay editable: a user changing a camera's hostname must not be forced to
 * retype a password they cannot see.
 */
describe('MonitorSettingsDialog credential masking', () => {
  const credentialMonitor = {
    ...baseMonitor,
    Path: 'rtsp://admin:S3cret@cam.lan:554/h264',
    Pass: 'S3cret',
  } as unknown as Monitor;

  const renderDialog = (onSave = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={credentialMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
      />
    );
    return onSave;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    seedSettings();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('masks the password in the source path but keeps the host readable', () => {
    renderDialog();
    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;
    expect(input.value).not.toContain('S3cret');
    expect(input.value).toContain('cam.lan:554/h264');
    expect(input.value).toContain('admin');
  });

  it('hides the password reveal toggle while redaction is on', () => {
    renderDialog();
    expect(screen.queryByLabelText('common.show_password')).toBeNull();
  });

  it('restores the real password when the user edits the host around the mask', async () => {
    const onSave = renderDialog();
    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: input.value.replace('cam.lan', 'newcam.lan') } });
    fireEvent.click(screen.getByTestId('settings-video-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://admin:S3cret@newcam.lan:554/h264' });
  });

  it('saves a password the user typed over the mask', async () => {
    const onSave = renderDialog();

    fireEvent.change(screen.getByTestId('settings-source-input'), {
      target: { value: 'rtsp://admin:brandNew@cam.lan:554/h264' },
    });
    fireEvent.click(screen.getByTestId('settings-video-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ Path: 'rtsp://admin:brandNew@cam.lan:554/h264' });
  });

  it('keeps Save disabled when only the mask is on screen', () => {
    renderDialog();
    expect(screen.getByTestId('settings-video-save-button')).toBeDisabled();
  });

  it('shows the real path and the reveal toggle once redaction is turned off', () => {
    seedSettings({ disableLogRedaction: true });
    renderDialog();

    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;
    expect(input.value).toBe('rtsp://admin:S3cret@cam.lan:554/h264');
    expect(screen.getByLabelText('common.show_password')).toBeTruthy();
  });
});

/**
 * All-mode: monitor owned by profile B, opened while profile A is globally
 * current (refs #337). Both the app-local preferences (MonitorAppPreferences)
 * and the credential-masking read used to go through useCurrentProfile()
 * directly, so a monitor from B's `/all/monitors/B/:id` deep route (or B's
 * card in the All-mode monitor grid) would read A's settings and write
 * preference changes into A's bucket - a cross-profile settings leak and,
 * for disableLogRedaction, a camera-credential exposure bug. profileId must
 * now override the current-profile default at both read and write sites.
 */
const profileB = asProfileId('profile-b');

describe('MonitorSettingsDialog owning-profile scoping (refs #337)', () => {
  const renderDialog = (profileId?: string, onSave = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={baseMonitor}
        zmVersion="1.38.0"
        onSave={onSave}
        profileId={profileId ? asProfileId(profileId) : undefined}
      />
    );
    return onSave;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    seedSettings();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('writes a preference change to the owning profile (B), not the globally-current one (A=p1)', () => {
    renderDialog('profile-b');

    fireEvent.click(screen.getByTestId('settings-monitor-force-zms-switch'));

    expect(useSettingsStore.getState().getProfileSettings(profileB).forceZmsMonitorIds).toEqual(['1']);
    expect(useSettingsStore.getState().getProfileSettings(asProfileId('p1')).forceZmsMonitorIds).toEqual([]);
  });

  it('reads credential masking from the current selection (A=p1), not the owning profile (B) (refs #536)', () => {
    // disableLogRedaction is selection-scoped: A (current) has turned redaction
    // off, B (the monitor's server) keeps it on, and A decides.
    seedSettings({ disableLogRedaction: true, profileB: { disableLogRedaction: false } });

    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={{ ...baseMonitor, Path: 'rtsp://admin:S3cret@cam.lan:554/h264', Pass: 'S3cret' } as unknown as Monitor}
        zmVersion="1.38.0"
        onSave={vi.fn()}
        profileId={profileB}
      />
    );

    const input = screen.getByTestId('settings-source-input') as HTMLInputElement;
    expect(input.value).toBe('rtsp://admin:S3cret@cam.lan:554/h264');
    expect(screen.getByLabelText('common.show_password')).toBeTruthy();
  });

  it('falls back to the current profile when profileId is omitted (single mode, zero change)', () => {
    renderDialog(undefined);

    fireEvent.click(screen.getByTestId('settings-monitor-force-zms-switch'));

    expect(useSettingsStore.getState().getProfileSettings(asProfileId('p1')).forceZmsMonitorIds).toEqual(['1']);
  });
});

/**
 * The restricted dialog (refs #344).
 *
 * A ZoneMinder account without System Edit gets no editor. The gear stays,
 * because the app-local preferences behind it - force-ZMS, per-monitor Go2RTC,
 * cycle - are the stream troubleshooting knobs a restricted user most needs,
 * and they are not ZoneMinder fields at all. What goes away is every ZM field,
 * and with it the camera's address and password.
 */
describe('MonitorSettingsDialog without permission to edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSettings();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  const credentialed = {
    ...baseMonitor,
    Path: 'rtsp://192.168.1.10:554/h264',
    User: 'admin',
    Pass: 'hunter2',
  } as unknown as Monitor;

  function renderRestricted(props: Record<string, unknown> = {}) {
    return render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={credentialed}
        zmVersion="1.38.0"
        profileId={asProfileId('p1')}
        {...props}
      />
    );
  }

  it('shows no camera address, username, or password', () => {
    renderRestricted();

    expect(screen.queryByTestId('settings-source-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-username-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-password-row')).not.toBeInTheDocument();
    // The password must not reach the DOM at all, masked or otherwise.
    expect(document.body.innerHTML).not.toContain('hunter2');
    expect(document.body.innerHTML).not.toContain('192.168.1.10');
  });

  it('offers no way to write a ZoneMinder field', () => {
    renderRestricted();

    expect(screen.queryByTestId('settings-video-save-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-save-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-capturing-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-orientation-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-event-start-cmd-row')).not.toBeInTheDocument();
  });

  it('keeps the app-local preferences usable', () => {
    renderRestricted();

    expect(screen.getByTestId('settings-monitor-force-zms-switch')).toBeInTheDocument();
  });

  it('keeps the read-only facts a viewer is entitled to', () => {
    renderRestricted({ orientedResolution: '640x480' });

    expect(screen.getByTestId('monitor-settings-readonly')).toHaveTextContent('640x480');
  });

  it('says why the fields are gone, naming the ZoneMinder permission', () => {
    renderRestricted();

    expect(screen.getByTestId('monitor-settings-restricted-note')).toHaveTextContent(
      'monitor_detail.settings_restricted_account'
    );
  });

  it('names the monitor, not the account, when ZoneMinder refused this one monitor', () => {
    // Per-monitor permission rows override the account columns and are not in
    // the API, so an account with System Edit can still be refused here.
    renderRestricted({ restrictedReason: 'monitor' });

    expect(screen.getByTestId('monitor-settings-restricted-note')).toHaveTextContent(
      'monitor_detail.settings_restricted_monitor'
    );
  });
});

describe('MonitorSettingsDialog open-in-fullscreen (refs #462, #463)', () => {
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  const toggle = () => screen.getByTestId('settings-monitor-open-fullscreen-switch');

  it('reads the monitor list and writes it the moment the switch flips', () => {
    seedSettings({ fullscreenMonitorIds: ['1'] });
    render(<MonitorSettingsDialog open onOpenChange={vi.fn()} monitor={baseMonitor} zmVersion="1.38.0" onSave={vi.fn()} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle());
    expect(useSettingsStore.getState().getProfileSettings(asProfileId('p1')).fullscreenMonitorIds).toEqual([]);

    fireEvent.click(toggle());
    expect(useSettingsStore.getState().getProfileSettings(asProfileId('p1')).fullscreenMonitorIds).toEqual(['1']);
  });
});

describe('MonitorSettingsDialog Decoding row (refs #467)', () => {
  beforeEach(() => seedSettings());
  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('shows the monitor Decoding value read-only on ZM 1.38+', () => {
    render(
      <MonitorSettingsDialog
        open
        onOpenChange={vi.fn()}
        monitor={{ ...baseMonitor, Decoding: 'Ondemand' } as unknown as Monitor}
        zmVersion="1.38.0"
        onSave={vi.fn()}
      />
    );
    fireEvent.mouseDown(screen.getByTestId('settings-tab-capture'));
    expect(screen.getByTestId('settings-decoding-row')).toHaveTextContent('Ondemand');
  });
});
