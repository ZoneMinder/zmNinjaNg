import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppearanceSection } from '../AppearanceSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: string | Record<string, unknown>) => (typeof d === 'string' ? d : k),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

describe('AppearanceSection event context defaults', () => {
  it('writes the default window the user picked', () => {
    const update = vi.fn();
    render(<AppearanceSection settings={{ ...DEFAULT_SETTINGS }} update={update} />);
    fireEvent.click(screen.getByTestId('event-context-window-30'));
    expect(update).toHaveBeenCalledWith('eventContext', { windowMinutes: 30, scope: 'all' });
  });

  it('writes the default scope the user picked', () => {
    const update = vi.fn();
    render(<AppearanceSection settings={{ ...DEFAULT_SETTINGS }} update={update} />);
    fireEvent.click(screen.getByTestId('event-context-scope-linked'));
    expect(update).toHaveBeenCalledWith('eventContext', { windowMinutes: 10, scope: 'linked' });
  });
});
