/**
 * Settings Layout Components
 *
 * Shared layout primitives used across all settings sections.
 */

import type React from 'react';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { STORAGE_KEYS } from '../../lib/zmninja-ng-constants';
import { useSettingsSearching } from './settings-search';

/**
 * A whole settings section behind its own header. The open state is remembered
 * per section id, so a user who collapses the parts they never touch keeps that
 * arrangement across visits and app restarts.
 *
 * Collapsed content is unmounted rather than hidden, which is what makes
 * collapsing worth doing here: a closed Assistant section stops probing its
 * backend, and a closed Advanced section stops rendering the log-level table.
 * A search shows every section's content, so it can match collapsed ones,
 * without touching the remembered state.
 */
export function CollapsibleSection({
  id,
  label,
  defaultOpen = true,
  children,
}: {
  /** Stable id: it keys the remembered open state, so renaming one forgets it. */
  id: string;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const storageKey = `${STORAGE_KEYS.settingsSectionOpenPrefix}${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch { /* ignore */ }
    return defaultOpen;
  });
  const searching = useSettingsSearching();
  const shown = open || searching;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
  };

  return (
    <section data-testid={`settings-section-${id}`} data-settings-section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={shown}
        data-testid={`settings-section-${id}-toggle`}
        className="flex w-full items-center gap-1.5 text-sm font-semibold text-primary uppercase tracking-wide mb-2 cursor-pointer"
      >
        {shown ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span data-settings-section-label>{label}</span>
      </button>
      {shown && children}
    </section>
  );
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card divide-y" data-settings-card>
      {children}
    </div>
  );
}

export function SettingsRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3">
      {children}
    </div>
  );
}

export function RowLabel({ label, desc }: { label: string; desc?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium">{label}</div>
      {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
    </div>
  );
}
