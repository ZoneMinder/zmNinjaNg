/**
 * Settings search
 *
 * Filters the Settings page by text. It works on the rendered DOM rather than
 * on a list of setting names: rows are built by hand in each section, with
 * labels, descriptions, and current values in varied markup, and a registry
 * would drift from them. A row is a direct child of a SettingsCard; a section
 * is anything marked data-settings-section with a data-settings-section-label
 * inside, such as a CollapsibleSection, and renders its content while a search
 * is active even when collapsed.
 */

import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

const SECTION = '[data-settings-section]';
const SECTION_LABEL = '[data-settings-section-label]';

/** The active search text; '' when not searching. */
export const SettingsSearchContext = createContext('');

/** True while a search is active. Anything collapsible in Settings opens for
 *  it, since collapsed content is unmounted and could not be matched. */
export function useSettingsSearching(): boolean {
  return useContext(SettingsSearchContext) !== '';
}

/**
 * Shows the rows under `root` whose text contains `query`, and hides the rest,
 * along with cards and sections left with nothing to show. A section whose
 * title matches keeps all its rows. Returns whether anything is shown.
 */
export function filterSettings(root: HTMLElement, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  const matches = (el: Element | null | undefined) =>
    !!el?.textContent?.toLocaleLowerCase().includes(q);
  // The inline style hides it (a `flex` class would beat [hidden]); the
  // attribute keeps the card's divide-y borders off the rows that remain.
  const setShown = (el: HTMLElement, show: boolean) => {
    el.style.display = show ? '' : 'none';
    el.hidden = !show;
  };

  const hitSections = new Set<Element>();
  let any = false;
  for (const card of root.querySelectorAll<HTMLElement>('[data-settings-card]')) {
    // Every section around the card, innermost first: a nested section is part
    // of the one around it, so either title matching shows the whole card.
    const sections: Element[] = [];
    for (let s = card.closest(SECTION); s; s = s.parentElement?.closest(SECTION) ?? null) {
      sections.push(s);
    }
    const whole = !q || sections.some((s) => matches(s.querySelector(SECTION_LABEL)));
    let hit = false;
    for (const row of Array.from(card.children) as HTMLElement[]) {
      const show = whole || matches(row);
      setShown(row, show);
      hit ||= show;
    }
    setShown(card, hit);
    if (hit) sections.forEach((s) => hitSections.add(s));
    any ||= hit;
  }
  for (const section of root.querySelectorAll<HTMLElement>(SECTION)) {
    setShown(section, !q || hitSections.has(section));
  }
  return any;
}

/**
 * Keeps the Settings content under the returned ref filtered by `query`, and
 * re-filters when rows mount or change while searching (a section's data can
 * arrive after it opens). `noMatch` is true when a search shows nothing.
 */
export function useSettingsFilter(query: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [noMatch, setNoMatch] = useState(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const searching = query.trim() !== '';
    const run = () => setNoMatch(!filterSettings(root, query) && searching);
    run();
    if (!searching) return;
    // Only DOM content changes: the filter writes styles, which this does not
    // watch, so it cannot trigger itself.
    const observer = new MutationObserver(run);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [query]);

  return { ref, noMatch };
}
