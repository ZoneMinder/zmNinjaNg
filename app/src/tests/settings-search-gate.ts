/**
 * Gate for Settings search (refs #531), run over the whole rendered page so a
 * setting added later is covered without touching this file.
 *
 * Search works on the DOM (components/settings/settings-search.ts), so a new
 * setting is searchable when it follows two rules, and these checks catch the
 * ways it can break them:
 *  - collapsed disclosures: collapsed content is unmounted, so anything that
 *    folds must open while searching (useSettingsSearching) and say so with
 *    aria-expanded. Popup triggers (selects, menus) carry aria-haspopup and are
 *    not disclosures.
 *  - unfilterable text: search hides card rows, and sections left without
 *    one. Text anywhere else (a note between cards, a heading inside a
 *    section) shows for every query that matches its neighbours. Content that
 *    must stay during a search opts out with data-settings-search-keep.
 */

const FILTERABLE =
  '[data-settings-card] > *, [data-settings-section-label], [data-settings-search-keep]';

/** Disclosures under `root` still collapsed; expected empty while searching. */
export function collapsedDisclosures(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('[aria-expanded="false"]:not([aria-haspopup])')).map(
    (el) => el.getAttribute('data-testid') ?? el.textContent ?? el.tagName,
  );
}

/** Text under `root` that search cannot hide; expected empty. */
export function unfilterableText(root: HTMLElement): string[] {
  return textNodes(root)
    .filter((node) => !node.parentElement?.closest(FILTERABLE))
    .map((node) => node.textContent!.trim());
}

function textNodes(root: HTMLElement): Node[] {
  const nodes: Node[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) nodes.push(node);
  }
  return nodes;
}

/** Text under `root` not inside a hidden element. */
export function visibleText(root: HTMLElement): string[] {
  const hidden = (node: Node) => {
    for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
      if (el.style.display === 'none') return true;
    }
    return false;
  };
  return textNodes(root)
    .filter((node) => !hidden(node))
    .map((node) => node.textContent!.trim());
}
