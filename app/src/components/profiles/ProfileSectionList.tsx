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
import { prefersReducedMotion } from '../../lib/view-transition';
import type { ProfileSections } from '../../lib/profile/profile-sections';
import type { ProfileId } from '../../api/types';

interface ProfileSectionListProps<T> {
  sections: ProfileSections<T>;
  /** Names this surface in the testids and the storage keys, e.g.
   *  `events-group`. The Events list and the Events grid pass the same name
   *  on purpose: they are one screen behind a view toggle, so a folded server
   *  stays folded across it. */
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

  // This session's toggles, keyed by the same storage key the write uses, so
  // switching to another group (or to another surface) never carries one
  // group's folds onto another's sections. Anything not toggled here is read
  // through to storage below.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());

  // Read-through rather than state seeded at mount: the section list grows
  // while a group's servers answer, and scopeId changes under a mounted page
  // when the user switches groups, both of which a mount-time seed misses.
  // It costs one getItem per section per render, for a handful of sections.
  const isOpen = (profileId: ProfileId): boolean => {
    const key = storageKeyFor(surface, scopeId, profileId);
    return toggled.get(key) ?? readStoredOpen(key, true);
  };

  const setOpen = useCallback((profileId: ProfileId, open: boolean) => {
    const key = storageKeyFor(surface, scopeId, profileId);
    writeStoredOpen(key, open);
    setToggled((previous) => new Map(previous).set(key, open));
  }, [surface, scopeId]);

  // Jumping to a collapsed section would scroll to a header with nothing
  // under it, so open it on the way. Focus lands on the section's own header
  // so a keyboard or screen-reader user arrives where the page scrolled to,
  // and preventScroll leaves the scrolling to the line below.
  const jumpTo = (profileId: ProfileId) => {
    setOpen(profileId, true);
    const section = sectionRefs.current.get(profileId);
    section?.querySelector<HTMLElement>(`[data-testid="${surface}-toggle-${profileId}"]`)
      ?.focus({ preventScroll: true });
    section?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
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
          const open = isOpen(profileId);
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
                {/* The server name stays a heading, as it was before the
                    section became collapsible: it is how a screen reader
                    moves from one server to the next. */}
                <h2 className="mb-2">
                  <CollapsibleTrigger
                    className="flex w-full items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground min-w-0"
                    data-testid={`${surface}-toggle-${profileId}`}
                  >
                    <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', !open && '-rotate-90')} />
                    <span className="truncate" title={section.profileName}>{section.profileName}</span>
                    <span className="font-normal">{section.items.length}</span>
                  </CollapsibleTrigger>
                </h2>
                <CollapsibleContent>{renderItems(section.items, profileId)}</CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </div>
    </>
  );
}
