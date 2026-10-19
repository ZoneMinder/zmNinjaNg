/**
 * Tests for MoreBelowCue: the "more content below" chevron on the detail
 * pages and the timeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { MoreBelowCue } from '../more-below-cue';
import { SCROLL_PAD } from '../../../lib/zmninja-ng-constants';
import { resetProfileFixture, seedProfiles } from '../../../tests/profile-fixture';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

const CLIENT_HEIGHT = 500;

function makeElement(clientHeight: number, scrollHeight: number) {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  Object.defineProperty(element, 'clientHeight', { value: clientHeight });
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight });
  element.scrollBy = vi.fn();
  return element;
}

/** The page's shape: the content sits inside `<main>`, which scrolls. */
let scroller: HTMLDivElement;
let content: HTMLDivElement;

function setup(scrollHeight: number) {
  scroller = makeElement(CLIENT_HEIGHT, scrollHeight);
  content = makeElement(scrollHeight, scrollHeight);
  scroller.appendChild(content);
  document.body.appendChild(scroller);
  const ref = createRef<HTMLDivElement>();
  (ref as { current: HTMLDivElement }).current = content;
  render(<MoreBelowCue targetRef={ref} />);
}

beforeEach(() => {
  document.body.innerHTML = '';
  seedProfiles(['home']);
});

afterEach(() => {
  scroller.remove();
  resetProfileFixture();
});

describe('MoreBelowCue', () => {
  it('shows at the top of a page that overflows, and a tap scrolls the page down', async () => {
    setup(2000);
    await userEvent.click(screen.getByTestId('more-below-cue'));
    expect(scroller.scrollBy).toHaveBeenCalledWith({
      top: CLIENT_HEIGHT * SCROLL_PAD.stepFraction,
      behavior: 'smooth',
    });
  });

  it('goes away once the page scrolls', () => {
    setup(2000);
    expect(screen.queryByTestId('more-below-cue')).not.toBeNull();
    act(() => {
      scroller.scrollTop = 40;
      fireEvent.scroll(scroller);
    });
    expect(screen.queryByTestId('more-below-cue')).toBeNull();
  });

  it('stays hidden when the Scroll hint setting is off', () => {
    seedProfiles(['home'], { settings: { home: { showMoreBelowCue: false } } });
    setup(2000);
    expect(screen.queryByTestId('more-below-cue')).toBeNull();
  });

  it('stays hidden when everything fits on screen', () => {
    setup(CLIENT_HEIGHT);
    expect(screen.queryByTestId('more-below-cue')).toBeNull();
  });
});
