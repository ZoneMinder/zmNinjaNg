/**
 * Tests for RefreshButton component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefreshButton } from '../RefreshButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common.refresh': 'Refresh',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('RefreshButton', () => {
  it('renders with the default i18n label', () => {
    render(<RefreshButton onRefresh={() => {}} />);
    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
    expect(screen.getByLabelText('Refresh')).toBeInTheDocument();
  });

  it('fires onRefresh when clicked', async () => {
    const handle = vi.fn();
    const user = userEvent.setup();
    render(<RefreshButton onRefresh={handle} />);
    await user.click(screen.getByTestId('refresh-button'));
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('applies the spin class on the icon when isLoading is true', () => {
    const { container } = render(<RefreshButton onRefresh={() => {}} isLoading />);
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.className.baseVal ?? icon?.getAttribute('class') ?? '').toContain('animate-spin');
  });

  it('does not apply the spin class when isLoading is false', () => {
    const { container } = render(<RefreshButton onRefresh={() => {}} />);
    const icon = container.querySelector('svg');
    expect(icon?.className.baseVal ?? icon?.getAttribute('class') ?? '').not.toContain('animate-spin');
  });

  it('disables the button when isLoading is true', () => {
    render(<RefreshButton onRefresh={() => {}} isLoading />);
    expect(screen.getByTestId('refresh-button')).toBeDisabled();
  });

  it('disables the button when disabled prop is true', () => {
    render(<RefreshButton onRefresh={() => {}} disabled />);
    expect(screen.getByTestId('refresh-button')).toBeDisabled();
  });

  it('respects a custom data-testid override', () => {
    render(<RefreshButton onRefresh={() => {}} data-testid="monitors-refresh-button" />);
    expect(screen.getByTestId('monitors-refresh-button')).toBeInTheDocument();
    expect(screen.queryByTestId('refresh-button')).toBeNull();
  });

  it('uses a custom label when provided', () => {
    render(<RefreshButton onRefresh={() => {}} label="Reload" />);
    expect(screen.getByLabelText('Reload')).toBeInTheDocument();
  });

  it('uses a custom aria-label when provided', () => {
    render(
      <RefreshButton
        onRefresh={() => {}}
        aria-label="Refresh events"
        data-testid="events-refresh"
      />
    );
    expect(screen.getByLabelText('Refresh events')).toBeInTheDocument();
  });

  it('hides the label visually when showLabel is "never"', () => {
    render(<RefreshButton onRefresh={() => {}} showLabel="never" />);
    const span = screen.getByText('Refresh');
    expect(span.className).toContain('sr-only');
  });

  it('shows the label always when showLabel is "always"', () => {
    render(<RefreshButton onRefresh={() => {}} showLabel="always" />);
    const span = screen.getByText('Refresh');
    expect(span.className).not.toContain('sr-only');
    expect(span.className).not.toContain('hidden');
  });

  it('shows the label only on sm+ when showLabel is "sm-and-up"', () => {
    render(<RefreshButton onRefresh={() => {}} showLabel="sm-and-up" />);
    const span = screen.getByText('Refresh');
    expect(span.className).toContain('hidden');
    expect(span.className).toContain('sm:inline');
  });
});
