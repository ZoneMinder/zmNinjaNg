import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventsPlaybackSection } from '../EventsPlaybackSection';
import { DEFAULT_SETTINGS, type ProfileSettings } from '../../../stores/settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => (typeof d === 'string' ? d : k) }),
}));

function renderSection(settings: Partial<ProfileSettings> = {}) {
  const update = vi.fn();
  render(
    <EventsPlaybackSection
      settings={{ ...DEFAULT_SETTINGS, ...settings }}
      update={update}
      serverProfile={{ id: 'p1', name: 'Home' } as never}
      serverSettings={{ ...DEFAULT_SETTINGS }}
      updateServer={vi.fn()}
    />
  );
  return update;
}

describe('EventsPlaybackSection recent-events count', () => {
  it('renders the current count and writes changes', () => {
    const update = renderSection({ monitorDetailRecentEventsCount: 5 });
    const input = screen.getByTestId('settings-monitor-recent-events-count') as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '8' } });
    expect(update).toHaveBeenCalledWith('monitorDetailRecentEventsCount', 8);
  });

  it('applies a preset on click', () => {
    const update = renderSection();
    fireEvent.click(screen.getByTestId('monitor-recent-events-count-preset-10'));
    expect(update).toHaveBeenCalledWith('monitorDetailRecentEventsCount', 10);
  });

  it('clamps a typed value above the max down to 50', () => {
    const update = renderSection();
    fireEvent.change(screen.getByTestId('settings-monitor-recent-events-count'), { target: { value: '244' } });
    expect(update).toHaveBeenCalledWith('monitorDetailRecentEventsCount', 50);
  });

  it('writes the open-events-in-fullscreen switch (refs #462, #463)', () => {
    const update = renderSection();
    const toggle = screen.getByTestId('settings-event-fullscreen-switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith('eventPlaybackFullscreen', true);
  });
});

describe('EventsPlaybackSection nearby-event defaults', () => {
  it('writes the default window the user picked', () => {
    const update = renderSection();
    fireEvent.click(screen.getByTestId('event-context-window-30'));
    expect(update).toHaveBeenCalledWith('eventContext', { windowMinutes: 30, scope: 'all' });
  });

  it('writes the default scope the user picked', () => {
    const update = renderSection();
    fireEvent.click(screen.getByTestId('event-context-scope-linked'));
    expect(update).toHaveBeenCalledWith('eventContext', { windowMinutes: 10, scope: 'linked' });
  });
});
