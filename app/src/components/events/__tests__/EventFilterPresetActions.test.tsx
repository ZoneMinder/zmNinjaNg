/**
 * Save, load and delete beside the Events filter heading (refs #544).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventFilterPresetActions } from '../EventFilterPresetActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${Object.values(o).join(' ')}` : key),
  }),
}));

function setup(activeName: string, names: string[] = ['Driveway', 'Porch']) {
  const props = { names, activeName, onSave: vi.fn(), onLoad: vi.fn(), onDelete: vi.fn() };
  render(<EventFilterPresetActions {...props} />);
  return props;
}

describe('EventFilterPresetActions', () => {
  it('offers no delete while no preset is loaded', () => {
    setup('');
    expect(screen.queryByTestId('events-filter-preset-delete')).toBeNull();
    expect(screen.getByTestId('events-filter-preset-save')).toBeEnabled();
  });

  it('deletes the loaded preset only after the prompt is confirmed', async () => {
    const user = userEvent.setup();
    const props = setup('Porch');

    await user.click(screen.getByTestId('events-filter-preset-delete'));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Porch');
    await user.click(screen.getByTestId('events-filter-preset-delete-confirm'));

    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('saves under the typed name, starting from the loaded preset name', async () => {
    const user = userEvent.setup();
    const props = setup('Porch');

    await user.click(screen.getByTestId('events-filter-preset-save'));
    const input = screen.getByTestId('events-filter-preset-name');
    expect(input).toHaveValue('Porch');
    await user.clear(input);
    expect(screen.getByTestId('events-filter-preset-save-confirm')).toBeDisabled();
    await user.type(input, '  Back yard ');
    await user.click(screen.getByTestId('events-filter-preset-save-confirm'));

    expect(props.onSave).toHaveBeenCalledWith('Back yard');
  });

  it('loads the preset picked from the list', async () => {
    const user = userEvent.setup();
    const props = setup('');

    await user.click(screen.getByTestId('events-filter-preset-load'));
    await user.click(await screen.findByTestId('events-filter-preset-item-Porch'));

    expect(props.onLoad).toHaveBeenCalledWith('Porch');
  });

  it('cannot open the list when nothing is saved', () => {
    setup('', []);
    expect(screen.getByTestId('events-filter-preset-load')).toBeDisabled();
  });
});
