/**
 * The hover delay row (refs #611) shows only where previews open on hover:
 * the iOS and Android builds open them with a long press on its own timer.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoverPreviewEditor } from '../HoverPreviewEditor';
import { DEFAULT_HOVER_PREVIEW } from '../../../stores/settings';

const platform = vi.hoisted(() => ({ isDesktopOrWeb: true }));
vi.mock('../../../lib/platform', () => ({ Platform: platform }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

function renderEditor(onDelayChange = vi.fn()) {
  render(
    <HoverPreviewEditor
      value={DEFAULT_HOVER_PREVIEW}
      onChange={vi.fn()}
      playbackRate={200}
      onPlaybackRateChange={vi.fn()}
      delayMs={700}
      onDelayChange={onDelayChange}
    />,
  );
  fireEvent.click(screen.getByTestId('settings-hover-preview-trigger'));
  return screen.queryByTestId('settings-hover-preview-delay') as HTMLInputElement | null;
}

function typeDelay(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('HoverPreviewEditor hover delay', () => {
  beforeEach(() => {
    platform.isDesktopOrWeb = true;
    localStorage.clear(); // the fold remembers being open
  });

  it('shows the stored delay in the desktop and web builds', () => {
    expect(renderEditor()?.value).toBe('700');
  });

  it('saves a typed delay when the box loses focus', () => {
    const onDelayChange = vi.fn();
    typeDelay(renderEditor(onDelayChange)!, '1200');

    expect(onDelayChange).toHaveBeenCalledWith(1200);
  });

  it('raises a delay under 300 ms to 300', () => {
    const onDelayChange = vi.fn();
    const input = renderEditor(onDelayChange)!;
    typeDelay(input, '100');

    expect(onDelayChange).toHaveBeenCalledWith(300);
    expect(input.value).toBe('300');
  });

  it('puts back 700 ms when the box is left empty', () => {
    const input = renderEditor()!;
    typeDelay(input, '');

    expect(input.value).toBe('700');
  });

  it('hides the delay box in the iOS and Android builds', () => {
    platform.isDesktopOrWeb = false;

    expect(renderEditor()).toBeNull();
  });
});
