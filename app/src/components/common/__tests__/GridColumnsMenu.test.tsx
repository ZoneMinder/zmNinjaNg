/**
 * Tests for GridColumnsMenu and CustomColumnsDialog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutGrid, GripVertical } from 'lucide-react';
import { GridColumnsMenu, CustomColumnsDialog } from '../GridColumnsMenu';
import { Button } from '../../ui/button';
import { DropdownMenuItem } from '../../ui/dropdown-menu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const presets = [1, 2, 3].map((cols) => ({
  cols,
  icon: LayoutGrid,
  label: `${cols} columns`,
  testId: `test-grid-preset-${cols}`,
}));

const baseProps = {
  gridCols: 2,
  title: 'Layout',
  triggerIcon: LayoutGrid,
  triggerLabel: '2 columns',
  presets,
  customIcon: GripVertical,
  customLabel: 'Custom',
  onApplyGridLayout: vi.fn(),
  onCustomSelect: vi.fn(),
};

describe('GridColumnsMenu (desktop)', () => {
  beforeEach(() => {
    baseProps.onApplyGridLayout.mockClear();
    baseProps.onCustomSelect.mockClear();
  });

  it('offers only the presets on an icon-only trigger when no custom entry or label is given', async () => {
    const { customIcon: _icon, customLabel: _label, onCustomSelect: _select, triggerLabel: _trigger, ...bare } = baseProps;
    render(<GridColumnsMenu {...bare} isMobile={false} triggerTestId="bare-trigger" />);
    const trigger = screen.getByTestId('bare-trigger');
    expect(trigger).toHaveTextContent('');
    expect(trigger).toHaveAttribute('aria-label', 'Layout');
    await userEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['1 columns', '2 columns', '3 columns']);
  });

  it('renders the trigger with testid and grid-cols attribute when enabled', () => {
    render(
      <GridColumnsMenu
        {...baseProps}
        isMobile={false}
        triggerTestId="layout-trigger"
        showGridColsAttr
      />
    );
    const trigger = screen.getByTestId('layout-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('data-grid-cols', '2');
    expect(trigger).toHaveAttribute('title', 'Layout');
  });

  it('omits testid and grid-cols attribute when not provided', () => {
    render(<GridColumnsMenu {...baseProps} isMobile={false} />);
    const trigger = screen.getByTitle('Layout');
    expect(trigger).not.toHaveAttribute('data-testid');
    expect(trigger).not.toHaveAttribute('data-grid-cols');
  });

  it('calls onApplyGridLayout when a preset is clicked', async () => {
    const user = userEvent.setup();
    render(<GridColumnsMenu {...baseProps} isMobile={false} />);
    await user.click(screen.getByTitle('Layout'));
    await user.click(screen.getByTestId('test-grid-preset-3'));
    expect(baseProps.onApplyGridLayout).toHaveBeenCalledWith(3);
  });

  it('calls onCustomSelect when the custom item is clicked', async () => {
    const user = userEvent.setup();
    render(<GridColumnsMenu {...baseProps} isMobile={false} />);
    await user.click(screen.getByTitle('Layout'));
    await user.click(screen.getByText('Custom'));
    expect(baseProps.onCustomSelect).toHaveBeenCalledTimes(1);
  });

  it('renders menu extras only when provided', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <GridColumnsMenu
        {...baseProps}
        isMobile={false}
        renderMenuExtras={() => (
          <DropdownMenuItem data-testid="menu-extra">Saved layout</DropdownMenuItem>
        )}
      />
    );
    await user.click(screen.getByTitle('Layout'));
    expect(screen.getByTestId('menu-extra')).toBeInTheDocument();
    unmount();

    render(<GridColumnsMenu {...baseProps} isMobile={false} />);
    await user.click(screen.getByTitle('Layout'));
    expect(screen.queryByTestId('menu-extra')).not.toBeInTheDocument();
  });
});

describe('GridColumnsMenu (mobile)', () => {
  beforeEach(() => {
    baseProps.onApplyGridLayout.mockClear();
    baseProps.onCustomSelect.mockClear();
  });

  it('opens the sheet and applies a preset, then closes the sheet', async () => {
    const user = userEvent.setup();
    render(<GridColumnsMenu {...baseProps} isMobile />);
    await user.click(screen.getByTitle('Layout'));
    const preset = await screen.findByTestId('test-grid-preset-1');
    await user.click(preset);
    expect(baseProps.onApplyGridLayout).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('test-grid-preset-1')).not.toBeInTheDocument();
  });

  it('closes the sheet and calls onCustomSelect when custom is clicked', async () => {
    const user = userEvent.setup();
    render(<GridColumnsMenu {...baseProps} isMobile />);
    await user.click(screen.getByTitle('Layout'));
    await user.click(await screen.findByText('Custom'));
    expect(baseProps.onCustomSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
  });

  it('renders sheet extras only when provided, with a working closeSheet callback', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <GridColumnsMenu
        {...baseProps}
        isMobile
        renderSheetExtras={(closeSheet) => (
          <Button data-testid="sheet-extra" onClick={closeSheet}>
            Saved layout
          </Button>
        )}
      />
    );
    await user.click(screen.getByTitle('Layout'));
    const extra = await screen.findByTestId('sheet-extra');
    await user.click(extra);
    expect(screen.queryByTestId('sheet-extra')).not.toBeInTheDocument();
    unmount();

    render(<GridColumnsMenu {...baseProps} isMobile />);
    await user.click(screen.getByTitle('Layout'));
    await screen.findByText('Custom');
    expect(screen.queryByTestId('sheet-extra')).not.toBeInTheDocument();
  });
});

describe('CustomColumnsDialog', () => {
  const dialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    value: '4',
    onValueChange: vi.fn(),
    onSubmit: vi.fn(),
    title: 'Custom grid',
    description: 'Enter columns',
    columnsLabel: 'Columns',
    applyLabel: 'Apply',
  };

  beforeEach(() => {
    dialogProps.onOpenChange.mockClear();
    dialogProps.onValueChange.mockClear();
    dialogProps.onSubmit.mockClear();
  });

  it('renders title, description, and current value', () => {
    render(<CustomColumnsDialog {...dialogProps} />);
    expect(screen.getByText('Custom grid')).toBeInTheDocument();
    expect(screen.getByText('Enter columns')).toBeInTheDocument();
    expect(screen.getByLabelText('Columns')).toHaveValue(4);
  });

  it('does not render when closed', () => {
    render(<CustomColumnsDialog {...dialogProps} open={false} />);
    expect(screen.queryByText('Custom grid')).not.toBeInTheDocument();
  });

  it('propagates input changes', () => {
    render(<CustomColumnsDialog {...dialogProps} />);
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '6' } });
    expect(dialogProps.onValueChange).toHaveBeenCalledWith('6');
  });

  it('submits on Apply click', async () => {
    const user = userEvent.setup();
    render(<CustomColumnsDialog {...dialogProps} />);
    await user.click(screen.getByText('Apply'));
    expect(dialogProps.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits on Enter in the input', () => {
    render(<CustomColumnsDialog {...dialogProps} />);
    fireEvent.keyDown(screen.getByLabelText('Columns'), { key: 'Enter' });
    expect(dialogProps.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('cancels via the cancel button', async () => {
    const user = userEvent.setup();
    render(<CustomColumnsDialog {...dialogProps} />);
    await user.click(screen.getByText('common.cancel'));
    expect(dialogProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(dialogProps.onSubmit).not.toHaveBeenCalled();
  });
});
