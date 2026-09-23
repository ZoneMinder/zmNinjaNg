/**
 * The fullscreen title label (refs #527).
 *
 * A fullscreen page hides the header that normally names what you are looking
 * at, and the name used to live only in the exit button's tooltip, which a
 * touch device never shows. Swiping between monitors then gave no way to tell
 * which camera was on screen without leaving fullscreen.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FullscreenExitButton } from '../fullscreen-exit-button';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('FullscreenExitButton', () => {
  it('shows the subject name on screen, not only in the tooltip', () => {
    render(<FullscreenExitButton title="Front Yard 4k" onExit={vi.fn()} testIdPrefix="monitor-detail" />);

    expect(screen.getByTestId('monitor-detail-fullscreen-title')).toHaveTextContent('Front Yard 4k');
  });

  it('keeps the exit button reachable by its own label', () => {
    render(<FullscreenExitButton title="Front Yard 4k" onExit={vi.fn()} testIdPrefix="monitor-detail" />);

    expect(screen.getByTestId('monitor-detail-exit-fullscreen')).toHaveAccessibleName(
      'monitor_detail.exit_fullscreen',
    );
  });
});
