/**
 * Profile Section List
 *
 * Renders items already sectioned by owning profile (see
 * `lib/profile/profile-sections`) for every surface that offers the
 * group-by-server toggle: the Events list, the Events grid, the Monitors grid
 * and the Montage. Each section collapses on its own, and a row of jump
 * buttons above them scrolls to a section, expanding it first when it was
 * collapsed (refs #503).
 *
 * Collapse state is per device, not per profile setting: it is a view
 * preference on this screen, so it lives in localStorage under
 * STORAGE_KEYS.profileSectionOpenPrefix, keyed by surface, aggregate and
 * profile.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../../lib/utils';
import { readStoredOpen, writeStoredOpen } from '../../lib/collapse-storage';
import { STORAGE_KEYS } from '../../lib/zmninja-ng-constants';
import type { ProfileSections } from '../../lib/profile/profile-sections';
import type { ProfileId } from '../../api/types';

interface ProfileSectionListProps<T> {
  sections: ProfileSections<T>;
  /** Names this surface in the testids and the storage keys, e.g.
   *  `events-group`, so two surfaces never share a section's state. */
  surface: string;
  /** The aggregate these sections belong to. */
  scopeId: ProfileId;
  renderItems: (items: T[], profileId: ProfileId) => ReactNode;
  /** Applied to the element wrapping the sections, for per-surface spacing. */
  className?: string;
}

function storageKeyFor(surface: string, scopeId: ProfileId, profileId: ProfileId): string {
  return `${STORAGE_KEYS.profileSectionOpenPrefix}${surface}-${scopeId}-${profileId}`;
}

export function ProfileSectionList<T>({
  sections,
  surface,
  scopeId,
  renderItems,
  className,
}: ProfileSectionListProps<T>) {
  const { t } = useTranslation();
  const sectionRefs = useRef(new Map<ProfileId, HTMLElement>());

  // One entry per section that is closed. Seeded from storage on first
  // render, so a section the user folded away stays folded across a reload
  // and a trip into an event.
  const [closed, setClosed] = useState<Set<ProfileId>>(() => {
    const stored = new Set<ProfileId>();
    for (const [profileId] of sections) {
      if (!readStoredOpen(storageKeyFor(surface, scopeId, profileId), true)) stored.add(profileId);
    }
    return stored;
  });

  const setOpen = useCallback((profileId: ProfileId, open: boolean) => {
    writeStoredOpen(storageKeyFor(surface, scopeId, profileId), open);
    setClosed((previous) => {
      const next = new Set(previous);
      if (open) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }, [surface, scopeId]);

  // Jumping to a collapsed section would scroll to a header with nothing
  // under it, so open it on the way.
  const jumpTo = (profileId: ProfileId) => {
    setOpen(profileId, true);
    sectionRefs.current.get(profileId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <nav
        className="flex items-center gap-1.5 flex-wrap pb-3"
        aria-label={t('profiles.jump_to_server')}
        data-testid={`${surface}-jump-bar`}
      >
        {sections.map(([profileId, section]) => (
          <button
            key={profileId}
            type="button"
            onClick={() => jumpTo(profileId)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-accent min-w-0"
            data-testid={`${surface}-jump-${profileId}`}
          >
            <span className="truncate max-w-[10rem]" title={section.profileName}>{section.profileName}</span>
            <span className="text-muted-foreground">{section.items.length}</span>
          </button>
        ))}
      </nav>

      <div className={className}>
        {sections.map(([profileId, section]) => {
          const open = !closed.has(profileId);
          return (
            <div
              key={profileId}
              ref={(element) => {
                if (element) sectionRefs.current.set(profileId, element);
                else sectionRefs.current.delete(profileId);
              }}
              data-testid={`${surface}-section-${profileId}`}
            >
              <Collapsible open={open} onOpenChange={(next) => setOpen(profileId, next)}>
                <CollapsibleTrigger
                  className="flex w-full items-center gap-1.5 mb-2 px-1 text-sm font-semibold text-muted-foreground min-w-0"
                  data-testid={`${surface}-toggle-${profileId}`}
                >
                  <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', !open && '-rotate-90')} />
                  <span className="truncate" title={section.profileName}>{section.profileName}</span>
                  <span className="font-normal">{section.items.length}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>{renderItems(section.items, profileId)}</CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </div>
    </>
  );
}
