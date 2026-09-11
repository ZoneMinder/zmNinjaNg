/**
 * Both language pickers list the same order: English first, then the rest by
 * the name each language uses for itself. The lists used to be hand-written in
 * two components, so a new locale landed wherever it was appended.
 *
 * The dropdown primitives are stubbed to plain elements, as in
 * profile-switcher.test.tsx: jsdom cannot drive Radix's pointer-capture
 * sequence, and the order under test is in the item list, not the popover.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
}));

import '../../../i18n';
import { LanguageSwitcher } from '../LanguageSwitcher';

/** English, Deutsch, Español, Français, Italiano, Русский, 中文. */
const EXPECTED = ['en', 'de', 'es', 'fr', 'it', 'ru', 'zh'];

describe('LanguageSwitcher', () => {
  it('lists English first, then the other languages by their own name', () => {
    render(<LanguageSwitcher />);

    const codes = screen
      .getAllByTestId(/^language-option-/)
      .map((item) => item.getAttribute('data-testid')?.replace('language-option-', ''));

    expect(codes).toEqual(EXPECTED);
  });
});
