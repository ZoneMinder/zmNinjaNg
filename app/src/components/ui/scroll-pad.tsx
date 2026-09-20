/**
 * Scroll Pad
 *
 * Moves a scroll container by tapping instead of swiping, for the screens
 * where every surface is already a gesture target and no swipe is left over:
 * montage edit mode, where a drag reorders monitors rather than scrolling
 * (refs #321), and monitor/event detail on a tablet, where video and controls
 * fill the viewport and the rest of the page is unreachable (refs #365).
 *
 * Montage shows it on request from the toolbar; the detail pages show it when
 * useScrollAffordance says the page needs it.
 */

import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import { Button } from './button';
import { SCROLL_PAD } from '../../lib/zmninja-ng-constants';

/** Top to bottom, as they sit in the pad. `jump` goes to the end, not a step. */
const BUTTONS = [
  { icon: ChevronsUp, labelKey: 'common.scroll_top', testId: 'scroll-top', jump: true, direction: -1 },
  { icon: ChevronUp, labelKey: 'common.scroll_up', testId: 'scroll-up', jump: false, direction: -1 },
  { icon: ChevronDown, labelKey: 'common.scroll_down', testId: 'scroll-down', jump: false, direction: 1 },
  { icon: ChevronsDown, labelKey: 'common.scroll_bottom', testId: 'scroll-bottom', jump: true, direction: 1 },
] as const;

/**
 * The grid container declares `overflow-auto`, but its height is content-driven
 * outside fullscreen, so the element that actually scrolls is the app's `<main>`
 * further up. Which one it is depends on the layout the page is rendered in, so
 * find it rather than assume it.
 */
function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  for (let node = from; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (node.scrollHeight > node.clientHeight && (overflowY === 'auto' || overflowY === 'scroll')) {
      return node;
    }
  }
  return null;
}

interface ScrollPadProps {
  /**
   * The grid container. The pad scrolls it or the nearest scrolling ancestor.
   * A ref rather than the element itself: the element is only read on a tap, so
   * the pad does not need to re-render when the grid mounts.
   */
  targetRef: RefObject<HTMLElement | null>;
}

export function ScrollPad({ targetRef }: ScrollPadProps) {
  const { t } = useTranslation();

  const scrollBy = (direction: 1 | -1) => {
    const target = findScrollParent(targetRef.current);
    if (!target) return;
    target.scrollBy({
      top: direction * target.clientHeight * SCROLL_PAD.stepFraction,
      behavior: 'smooth',
    });
  };

  const scrollToEnd = (direction: 1 | -1) => {
    const target = findScrollParent(targetRef.current);
    if (!target) return;
    target.scrollTo({ top: direction > 0 ? target.scrollHeight : 0, behavior: 'smooth' });
  };

  // Fixed, not absolute: the page root is as tall as the grid, so an
  // absolutely positioned pad would sit halfway down the content instead of
  // halfway down the screen, which is exactly where it is not needed.
  return (
    <div
      className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1 rounded-full bg-background/85 p-1 shadow-lg backdrop-blur-sm border"
      data-testid="scroll-pad"
    >
      {BUTTONS.map(({ icon: Icon, labelKey, testId, jump, direction }) => {
        const label = t(labelKey);
        return (
          <Button
            key={testId}
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={() => (jump ? scrollToEnd(direction) : scrollBy(direction))}
            title={label}
            aria-label={label}
            data-testid={testId}
          >
            <Icon className="h-5 w-5" />
          </Button>
        );
      })}
    </div>
  );
}
