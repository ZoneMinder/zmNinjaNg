/**
 * Hover preview sizing (refs #494).
 *
 * The preview used to open at twice the width of whatever it was hovering, so
 * the same event previewed near-fullscreen from an Events grid tile and at
 * 400px from the 64px thumbnail on a list row. Size comes from the window
 * now, so every surface shows the same preview.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { HoverPreview } from '../hover-preview';
import { UI_INTERACTIONS } from '../../../lib/zmninja-ng-constants';

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const ASPECT_RATIO = 16 / 9;

/** Opens a preview over a trigger of the given width and reports its size. */
async function previewSizeOverTrigger(triggerWidth: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT_HEIGHT });
  const triggerHeight = triggerWidth / ASPECT_RATIO;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: triggerWidth, bottom: triggerHeight,
    width: triggerWidth, height: triggerHeight, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);

  render(
    <HoverPreview
      aspectRatio={ASPECT_RATIO}
      hoverDelayMs={0}
      testId="preview"
      renderPreview={() => <div>preview</div>}
    >
      <img data-testid="trigger" src="x" alt="" />
    </HoverPreview>,
  );

  fireEvent.mouseEnter(screen.getByTestId('trigger').parentElement as HTMLElement);
  const preview = await screen.findByTestId('preview');
  // It opens at the trigger's rect and animates to its target on the second
  // frame, so wait for the size that is not the trigger's.
  await waitFor(() => expect(preview.style.width).not.toBe(`${triggerWidth}px`));
  return { width: preview.style.width, height: preview.style.height };
}

describe('HoverPreview sizing', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens at the same size over a 64px row thumbnail and a 700px grid tile', async () => {
    const overRowThumbnail = await previewSizeOverTrigger(64);
    cleanup();
    const overGridTile = await previewSizeOverTrigger(700);

    expect(overRowThumbnail).toEqual(overGridTile);
  });

  it('takes its share of the window width at the requested aspect ratio', async () => {
    const { width, height } = await previewSizeOverTrigger(64);

    const expectedWidth =
      (VIEWPORT_WIDTH - UI_INTERACTIONS.previewEdgeMarginPx * 2) *
      UI_INTERACTIONS.previewWindowFraction;
    expect(width).toBe(`${expectedWidth}px`);
    expect(height).toBe(`${expectedWidth / ASPECT_RATIO}px`);
  });

  it('takes its share of the window height when the aspect ratio is the taller one', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 64, bottom: 114, width: 64, height: 114, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    render(
      <HoverPreview aspectRatio={9 / 16} hoverDelayMs={0} testId="portrait" renderPreview={() => <div />}>
        <img data-testid="portrait-trigger" src="x" alt="" />
      </HoverPreview>,
    );
    fireEvent.mouseEnter(screen.getByTestId('portrait-trigger').parentElement as HTMLElement);
    const preview = await screen.findByTestId('portrait');

    const expectedHeight =
      (VIEWPORT_HEIGHT - UI_INTERACTIONS.previewEdgeMarginPx * 2) *
      UI_INTERACTIONS.previewWindowFraction;
    await waitFor(() => expect(preview.style.height).toBe(`${expectedHeight}px`));
    expect(preview.style.width).toBe(`${expectedHeight * (9 / 16)}px`);
  });
});
