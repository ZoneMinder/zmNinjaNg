/**
 * The element a page actually scrolls in.
 *
 * A page's own container often declares `overflow-auto` while its height stays
 * content-driven, so the element that really scrolls is the app's `<main>`
 * further up. Which one it is depends on the layout the page is rendered in
 * (fullscreen montage vs. the normal shell), so callers find it rather than
 * assume it.
 *
 * Returns null when nothing between `from` and the root scrolls, which means
 * the content fits: there is no scrollback, and nothing off-screen to act on.
 */
export function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  for (let node = from; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (node.scrollHeight > node.clientHeight && (overflowY === 'auto' || overflowY === 'scroll')) {
      return node;
    }
  }
  return null;
}
