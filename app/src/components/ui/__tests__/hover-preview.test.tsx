import { describe, expect, it, vi } from 'vitest';
import { render, screen, createEvent, fireEvent } from '@testing-library/react';
import { HoverPreview } from '../hover-preview';

// Run as a native platform so the long-press / native-gesture branch is active.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}));

function renderNative() {
  return render(
    <HoverPreview aspectRatio={16 / 9} renderPreview={() => <div>preview</div>}>
      <img data-testid="trigger-img" src="x" alt="" />
    </HoverPreview>,
  );
}

describe('HoverPreview native gesture suppression', () => {
  it('prevents the native context menu on the wrapper', () => {
    renderNative();
    const wrapper = screen.getByTestId('trigger-img').parentElement as HTMLElement;

    const event = createEvent.contextMenu(wrapper);
    fireEvent(wrapper, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('marks the wrapper to disable native image drag', () => {
    renderNative();
    const wrapper = screen.getByTestId('trigger-img').parentElement as HTMLElement;

    expect(wrapper.className).toContain('no-native-drag');
  });
});
