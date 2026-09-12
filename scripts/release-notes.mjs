/**
 * Turning a developer notice into store release notes.
 *
 * Both stores publish the same text, written once in docs/notices.json and
 * reviewed by a human during make_release, so neither store needs its notes
 * retyped. They differ in what they accept: neither renders Markdown, and
 * Google Play allows a fraction of the text Apple does.
 */

/** App Store Connect rejects release notes longer than this. */
export const APP_STORE_MAX = 4000;

/** Google Play rejects release notes longer than this, per language. */
export const PLAY_MAX = 500;

/** The release notice for a version, or null when none was written. */
export function releaseNoticeFor(notices, version) {
  return notices.find((n) => n.id === `release-${version}`) ?? null;
}

/**
 * A notice body as the plain text both stores expect. Neither renders markup,
 * so `**bold**` would reach users with its asterisks showing.
 */
export function toPlainNotes(body) {
  return body
    // The changelog link belongs to the in-app notice. A bare URL in release
    // notes is not clickable and only eats the character budget.
    .replace(/\n*\[Full changelog\]\([^)]*\)\s*$/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Trim notes to a store's limit by dropping whole lines from the end, and say
 * which lines went. Half a bullet reads as a bug to users, and silently losing
 * one reads as nothing at all, which is worse: the caller shows the list.
 */
export function fitToLimit(text, max) {
  const lines = text.split('\n');
  if (text.length <= max) return { text, dropped: [] };

  const kept = [];
  let length = 0;
  for (const line of lines) {
    const added = kept.length === 0 ? line.length : length + 1 + line.length;
    if (added > max) break;
    kept.push(line);
    length = added;
  }
  return { text: kept.join('\n'), dropped: lines.slice(kept.length) };
}
