import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../sheet';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// A phone in landscape has the Dynamic Island or a cutout on one side. The
// sheet box itself is inset, so its content and its close button clear it
// even when a caller overrides the padding (refs #534).
describe('SheetContent', () => {
  it.each([
    ['bottom', ['left-[var(--sai-left,0px)]', 'right-[var(--sai-right,0px)]']],
    ['top', ['left-[var(--sai-left,0px)]', 'right-[var(--sai-right,0px)]']],
    ['left', ['left-[var(--sai-left,0px)]']],
    ['right', ['right-[var(--sai-right,0px)]']],
  ] as const)('keeps a %s sheet inside the side safe areas', (side, insets) => {
    render(
      <Sheet open>
        <SheetContent side={side} className="p-0" data-testid="sheet">
          <SheetTitle>t</SheetTitle>
          <SheetDescription>d</SheetDescription>
        </SheetContent>
      </Sheet>
    );
    const classes = screen.getByTestId('sheet').className.split(' ');
    for (const inset of insets) expect(classes).toContain(inset);
  });
});
