import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useZoomPan } from '../useZoomPan';

// Exposes the hook API to the test and wires the container/inner refs to real
// DOM nodes so zoomIn (which reads the container size) and the keyboard pan
// handler can run end to end.
let api: ReturnType<typeof useZoomPan>;
function Harness() {
  api = useZoomPan();
  return (
    <div ref={api.ref} data-testid="container">
      <div ref={api.innerRef} data-testid="inner" />
    </div>
  );
}

function mountZoomable() {
  const utils = render(<Harness />);
  const container = utils.getByTestId('container');
  const inner = utils.getByTestId('inner');
  // jsdom returns a zero-sized rect; zoom math needs a real size.
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 300,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return { container, inner };
}

/** Parse the translate X (px) from an inline transform string. */
function translateX(transform: string): number {
  const m = transform.match(/translate\((-?[\d.]+)px/);
  return m ? Number(m[1]) : NaN;
}

describe('useZoomPan keyboard pan', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('pans with arrow keys and prevents native scroll when zoomed', () => {
    const { inner } = mountZoomable();
    act(() => api.zoomIn());
    expect(api.isZoomed).toBe(true);
    const before = translateX(inner.style.transform);

    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    act(() => {
      window.dispatchEvent(ev);
    });

    // ArrowLeft pans left: content shifts right, so translateX increases.
    expect(translateX(inner.style.transform)).toBeGreaterThan(before);
    expect(ev.defaultPrevented).toBe(true);
  });

  // Old zmNinja zoomed as far as the user wanted; a 400% ceiling stopped this
  // one well short of reading a plate or a face (refs #478).
  it('keeps zooming in past the old 400% ceiling', () => {
    mountZoomable();

    for (let i = 0; i < 20; i++) act(() => api.zoomIn());

    expect(api.scale).toBeGreaterThan(4);
  });

  it('does not intercept arrow keys when not zoomed', () => {
    mountZoomable();
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(api.isZoomed).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores arrow keys while typing in a form field', () => {
    const { inner } = mountZoomable();
    act(() => api.zoomIn());
    const before = inner.style.transform;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    act(() => {
      window.dispatchEvent(ev);
    });

    expect(inner.style.transform).toBe(before);
    expect(ev.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it('zooms in on wheel scroll up over the view', () => {
    const { container } = mountZoomable();
    expect(api.isZoomed).toBe(false);

    const wheel = new WheelEvent('wheel', {
      deltaY: -120,
      clientX: 200,
      clientY: 150,
      cancelable: true,
      bubbles: true,
    });
    act(() => {
      container.dispatchEvent(wheel);
    });

    expect(api.isZoomed).toBe(true);
    expect(api.scale).toBeGreaterThan(1);
  });


  it('carries no transform at identity so a fixed descendant reaches the viewport (refs #462)', () => {
    // video.js full-window mode positions the player `fixed`; a transformed
    // ancestor would contain it inside the card instead.
    const { inner } = mountZoomable();
    expect(inner.style.transform).toBe('');
    expect(inner.style.willChange).toBe('');

    act(() => api.zoomIn());
    expect(inner.style.transform).not.toBe('');
    expect(inner.style.willChange).toBe('transform');

    act(() => api.reset());
    expect(inner.style.transform).toBe('');
    expect(inner.style.willChange).toBe('');
  });

  it('shows a grab cursor only when zoomed', () => {
    const { container } = mountZoomable();
    expect(container.style.cursor).toBe('');
    act(() => api.zoomIn());
    expect(container.style.cursor).toBe('grab');
    act(() => api.reset());
    expect(container.style.cursor).toBe('');
  });

  it('leaves vertical drags to the page until the view is zoomed', () => {
    // The tablet case: a feed filling the screen used to swallow every finger
    // drag, so scrolling meant finding whatever strip was left beside it.
    const { container } = mountZoomable();
    expect(container.style.touchAction).toBe('pan-y');

    // Zoomed, a one-finger drag has to pan the image instead.
    act(() => api.zoomIn());
    expect(container.style.touchAction).toBe('none');

    act(() => api.reset());
    expect(container.style.touchAction).toBe('pan-y');
  });
});

describe('useZoomPan arrow keys step between items at 1x (refs #533)', () => {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  function SwipeHarness({ swipeEnabled }: { swipeEnabled: boolean }) {
    const { ref, innerRef } = useZoomPan({ swipeEnabled, onSwipeLeft, onSwipeRight });
    return (
      <div ref={ref} data-testid="container">
        <div ref={innerRef} />
      </div>
    );
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    const ev = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    act(() => {
      window.dispatchEvent(ev);
    });
    return ev;
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    onSwipeLeft.mockClear();
    onSwipeRight.mockClear();
  });

  it('right arrow goes to the next item and left arrow to the previous', () => {
    render(<SwipeHarness swipeEnabled />);

    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);

    press('ArrowLeft');
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('leaves the keys alone when swiping is off', () => {
    render(<SwipeHarness swipeEnabled={false} />);

    expect(press('ArrowRight').defaultPrevented).toBe(false);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('leaves modified arrows alone, such as Alt+Left for browser back', () => {
    render(<SwipeHarness swipeEnabled />);

    expect(press('ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('leaves arrows a focused control already handled, such as a slider', () => {
    render(<SwipeHarness swipeEnabled />);
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    ev.preventDefault();

    act(() => {
      window.dispatchEvent(ev);
    });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('ignores arrows while typing in a form field', () => {
    render(<SwipeHarness swipeEnabled />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    press('ArrowRight');

    expect(onSwipeLeft).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
