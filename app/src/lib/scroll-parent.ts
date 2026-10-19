/**
 * The nearest element at or above `from` that scrolls. A page's container can
 * declare `overflow-auto` while its height is content-driven, so the element
 * that actually scrolls is the app's `<main>` further up. Which one it is
 * depends on the layout the page is rendered in, so find it rather than assume
 * it.
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
