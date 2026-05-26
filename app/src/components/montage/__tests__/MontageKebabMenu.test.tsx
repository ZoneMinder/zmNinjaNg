import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MontageKebabMenu } from '../MontageKebabMenu';
import type { Monitor } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const monitors: Monitor[] = [
  { Id: '1', Name: 'Front Door', Sequence: '1' } as Monitor,
  { Id: '2', Name: 'Backyard', Sequence: '2' } as Monitor,
  { Id: '3', Name: 'Garage', Sequence: '3' } as Monitor,
];

describe('MontageKebabMenu', () => {
  const onRefresh = vi.fn();
  const onToggleVisibility = vi.fn();

  beforeEach(() => {
    onRefresh.mockClear();
    onToggleVisibility.mockClear();
  });

  it('renders the kebab trigger button', () => {
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    expect(screen.getByTestId('montage-kebab-menu')).toBeInTheDocument();
  });

  it('opens menu and shows refresh + visibility entries', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    expect(screen.getByTestId('montage-kebab-refresh')).toBeInTheDocument();
    expect(screen.getByTestId('montage-kebab-visibility')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh entry is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.click(screen.getByTestId('montage-kebab-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refresh entry is disabled while refreshing', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={true}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    const refreshItem = screen.getByTestId('montage-kebab-refresh');
    expect(refreshItem).toHaveAttribute('data-disabled');
  });

  it('shows a checkbox per monitor, checked when visible, unchecked when hidden', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={['2']}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    const cb1 = await screen.findByTestId('montage-visibility-1');
    const cb2 = await screen.findByTestId('montage-visibility-2');
    const cb3 = await screen.findByTestId('montage-visibility-3');

    expect(cb1).toHaveAttribute('data-state', 'checked');
    expect(cb2).toHaveAttribute('data-state', 'unchecked');
    expect(cb3).toHaveAttribute('data-state', 'checked');
  });

  it('calls onToggleVisibility with the monitor id when a checkbox is toggled', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={monitors}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));
    const cb2 = await screen.findByTestId('montage-visibility-2');
    // userEvent.click triggers focus/blur that collapses the Radix submenu in jsdom
    // before the select event fires. Use pointer press without pointer move instead.
    await user.pointer({ target: cb2, keys: '[MouseLeft]' });
    expect(onToggleVisibility).toHaveBeenCalledWith('2');
  });

  it('hides the visibility submenu when there are zero monitors', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        monitors={[]}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    expect(screen.queryByTestId('montage-kebab-visibility')).not.toBeInTheDocument();
  });

  it('sorts monitors by Sequence ascending', async () => {
    const user = userEvent.setup();
    const unordered: Monitor[] = [
      { Id: '10', Name: 'Z-Last', Sequence: '3' } as Monitor,
      { Id: '11', Name: 'A-First', Sequence: '1' } as Monitor,
      { Id: '12', Name: 'B-Middle', Sequence: '2' } as Monitor,
    ];
    render(
      <MontageKebabMenu
        monitors={unordered}
        hiddenMonitorIds={[]}
        isRefreshing={false}
        onRefresh={onRefresh}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    const items = await screen.findAllByTestId(/^montage-visibility-/);
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual([
      'montage-visibility-11',
      'montage-visibility-12',
      'montage-visibility-10',
    ]);
  });
});
