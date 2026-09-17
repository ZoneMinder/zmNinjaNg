import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventContextControls } from '../EventContextControls';

const value = { windowMinutes: 10, scope: 'all' as const, view: 'list' as const };

describe('EventContextControls', () => {
  it('marks the chosen window pressed and the others not', () => {
    render(<EventContextControls value={value} onChange={vi.fn()} available={{ linked: true, group: true }} />);
    expect(screen.getByTestId('event-context-window-10')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-context-window-30')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the window the user picked', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true }} />);
    fireEvent.click(screen.getByTestId('event-context-window-30'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 30, scope: 'all', view: 'list' });
  });

  it('reports the scope the user picked', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true }} />);
    fireEvent.click(screen.getByTestId('event-context-scope-linked'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 10, scope: 'linked', view: 'list' });
  });

  it('greys a scope this server cannot offer and does not switch to it', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: false, group: true }} />);
    const linked = screen.getByTestId('event-context-scope-linked');
    expect(linked).toHaveClass('opacity-50');
    fireEvent.click(linked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the chosen view pressed and the other not', () => {
    render(<EventContextControls value={value} onChange={vi.fn()} available={{ linked: true, group: true }} />);
    expect(screen.getByTestId('event-context-view-list')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-context-view-graph')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the view the user picked, keeping window and scope', () => {
    const onChange = vi.fn();
    render(<EventContextControls value={value} onChange={onChange} available={{ linked: true, group: true }} />);
    fireEvent.click(screen.getByTestId('event-context-view-graph'));
    expect(onChange).toHaveBeenCalledWith({ windowMinutes: 10, scope: 'all', view: 'graph' });
  });
});
