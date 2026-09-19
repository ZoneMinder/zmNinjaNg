/**
 * Collapse Storage
 *
 * Per-device open/closed state for collapsible UI, stored in localStorage
 * under STORAGE_KEYS. Shared by CollapsibleCard and the per-server section
 * lists; both read at mount and write on every toggle, and both have to
 * survive storage being unavailable (private windows, blocked site data).
 */

export function readStoredOpen(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
  } catch { /* ignore */ }
  return fallback;
}

export function writeStoredOpen(key: string | undefined, open: boolean): void {
  if (!key) return;
  try {
    localStorage.setItem(key, String(open));
  } catch { /* ignore */ }
}
