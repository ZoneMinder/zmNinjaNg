import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventContextControls } from '../EventContextControls';
import en from '../../../../locales/en/translation.json';

// Every key the controls ask for, so a test can check each exists in English.
const askedKeys = vi.hoisted(() => new Set<string>());
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      askedKeys.add(key);
      return key;
    },
  }),
}));

const lookup = (key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
// A plural key lives on as its `_other` form.
const hasKey = (key: string) => lookup(key) !== undefined || lookup(`${key}_other`) !== undefined;

const value = { windowMinutes: 10, scope: 'all' as const };

describe('EventContextControls', () => {
  it('marks the chosen window pressed and the others not', () => {
    render(<EventContextControls value={value} onChange={vi.fn()} available={{ linked: true, group: true, filtered: true }} />);
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the window the user picked', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true, filtered: true }} />);
    fireEvent.click(screen.getByTestId('event-context-window-30'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 30, scope: 'all' });
  });

  it('reports the scope the user picked', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true, filtered: true }} />);
    fireEvent.click(screen.getByTestId('event-context-scope-linked'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 10, scope: 'linked' });
  });

  it('greys a scope this server cannot offer and does not switch to it', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: false, group: true, filtered: true }} />);
    const linked = screen.getByTestId('event-context-scope-linked');
    expect(linked).toHaveClass('opacity-50');
    fireEvent.click(linked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks only for translation keys that exist', () => {
    askedKeys.clear();
    render(<EventContextControls value={value} onChange={vi.fn()} available={{ linked: false, group: false, filtered: false }} />);
    expect([...askedKeys].filter((key) => !hasKey(key))).toEqual([]);
  });
});
