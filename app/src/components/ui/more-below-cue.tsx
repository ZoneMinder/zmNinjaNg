/**
 * More Below Cue
 *
 * A small chevron in the bottom-right corner while the page is scrolled to the
 * top and has more content below the fold. When the fold lands in the gap
 * between two cards (or right under a player), the page looks finished and
 * nothing on screen says more exists below. The cue goes away as soon as the
 * page moves. AppLayout mounts it on <main> (see layoutShowsMoreBelowCue for
 * the pages that skip it); a page that scrolls inside its own container mounts
 * it there. Off with the Appearance "Scroll hint" setting.
 */

import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from './button';
import { findScrollParent } from '../../lib/scroll-parent';
import { SCROLL_PAD } from '../../lib/zmninja-ng-constants';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';

interface MoreBelowCueProps {
  /** The page's content container; the cue watches it or its scrolling ancestor. */
  targetRef: RefObject<HTMLElement | null>;
}

export function MoreBelowCue({ targetRef }: MoreBelowCueProps) {
  const { t } = useTranslation();
  const { settings } = useCurrentProfile();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let scroller: HTMLElement | null = null;
    // findScrollParent returns null until something overflows, so content
    // that loads late (cards, the frame strip) is picked up by the observer.
    // Once a scroller is found its children are watched too: on pages where
    // the app's <main> scrolls, content outside the target can still grow.
    const update = () => {
      const next = findScrollParent(el);
      if (next !== scroller) {
        scroller?.removeEventListener('scroll', update);
        next?.addEventListener('scroll', update, { passive: true });
        if (next) for (const child of Array.from(next.children)) observer.observe(child);
        scroller = next;
      }
      setVisible(!!scroller && scroller.scrollTop === 0);
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    update();
    return () => {
      observer.disconnect();
      scroller?.removeEventListener('scroll', update);
    };
  }, [targetRef]);

  if (!visible || !settings.showMoreBelowCue) return null;
  const label = t('common.scroll_down');
  return (
    <Button
      variant="outline"
      size="icon"
      className="fixed right-3 bottom-[calc(0.75rem+var(--sai-bottom,env(safe-area-inset-bottom)))] z-30 h-9 w-9 rounded-full bg-background/85 shadow-lg backdrop-blur-sm animate-nudge-down"
      onClick={() => {
        const target = findScrollParent(targetRef.current);
        target?.scrollBy({ top: target.clientHeight * SCROLL_PAD.stepFraction, behavior: 'smooth' });
      }}
      title={label}
      aria-label={label}
      data-testid="more-below-cue"
    >
      <ChevronDown className="h-5 w-5" />
    </Button>
  );
}
