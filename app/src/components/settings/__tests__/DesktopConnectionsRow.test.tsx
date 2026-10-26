/**
 * Desktop connection limit row (refs #156)
 *
 * The limit lives in the Electron main process (Chromium reads it once at
 * startup), so the row talks to `window.electronConnections`. What matters to
 * the user: the stored value shows up, what they type is what gets written,
 * a clamp by main is shown rather than hidden, and non-Electron builds see
 * nothing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopConnectionsRow } from '../DesktopConnectionsRow';
import { Platform } from '../../../lib/platform';
import { ZM_INTEGRATION } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const get = vi.fn();
const set = vi.fn();

function box() {
  return screen.getByTestId('settings-desktop-connections') as HTMLInputElement;
}

describe('DesktopConnectionsRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Platform, 'isElectron', 'get').mockReturnValue(true);
    get.mockResolvedValue(48);
    window.electronConnections = { get, set };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronConnections;
  });

  it('reads the current value on mount and shows it', async () => {
    render(<DesktopConnectionsRow />);
    await waitFor(() => expect(box().value).toBe('48'));
    expect(box().min).toBe(String(ZM_INTEGRATION.desktopConnections.min));
    expect(box().max).toBe(String(ZM_INTEGRATION.desktopConnections.max));
  });

  it('writes the value the user types and shows the restart note', async () => {
    set.mockResolvedValue(64);
    render(<DesktopConnectionsRow />);
    await waitFor(() => expect(box().value).toBe('48'));
    expect(screen.queryByTestId('settings-desktop-connections-restart')).toBeNull();

    fireEvent.change(box(), { target: { value: '64' } });
    fireEvent.blur(box());

    await waitFor(() => expect(set).toHaveBeenCalledWith(64));
    expect((await screen.findByTestId('settings-desktop-connections-restart')).textContent).toBe(
      'settings.desktop_connections_restart',
    );
  });

  it('shows the clamped value when main clamps it', async () => {
    set.mockResolvedValue(256);
    render(<DesktopConnectionsRow />);
    await waitFor(() => expect(box().value).toBe('48'));

    fireEvent.change(box(), { target: { value: '9999' } });
    fireEvent.blur(box());

    await waitFor(() => expect(box().value).toBe('256'));
  });

  it('puts the stored value back when the write is rejected', async () => {
    set.mockRejectedValue(new Error('disk full'));
    render(<DesktopConnectionsRow />);
    await waitFor(() => expect(box().value).toBe('48'));

    fireEvent.change(box(), { target: { value: '64' } });
    fireEvent.blur(box());

    await waitFor(() => expect(box().value).toBe('48'));
    expect(screen.queryByTestId('settings-desktop-connections-restart')).toBeNull();
  });

  it('renders nothing when the app is not Electron', () => {
    vi.spyOn(Platform, 'isElectron', 'get').mockReturnValue(false);
    const { container } = render(<DesktopConnectionsRow />);
    expect(container.innerHTML).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('renders nothing on an Electron build whose preload lacks the bridge', () => {
    delete window.electronConnections;
    const { container } = render(<DesktopConnectionsRow />);
    expect(container.innerHTML).toBe('');
  });
});
