/**
 * Archive toggle for a ZoneMinder event (refs #344). Click propagation is
 * stopped so it never triggers the parent card/tile's navigation. Archiving
 * needs Events: Edit; the control stays live and greys itself so it can
 * still say why it does nothing.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { ProfileId } from '../../api/types';
import { setEventArchived } from '../../api/events';
import { usePermissions } from '../../hooks/usePermissions';
import { canEditEvents } from '../../lib/permissions/zm-permissions';
import { useDeniedControl } from '../../hooks/useDeniedControl';
import { isPermissionDenied } from '../../lib/permissions/permission-error';
import { isNotFound } from '../../lib/http/types';
import { markPermissionDenied, useIsPermissionDenied } from '../../stores/permissions';
import { getSession } from '../../services/sessions';
import { log, LogLevel } from '../../lib/logger';
import { queryKeys } from '../../lib/query/query-keys';
import { HintButton } from '../ui/button';

interface EventArchiveButtonProps {
  eventId: string;
  isArchived: boolean;
  /** Owning profile: the row's own profileId in All mode, the current
   *  profile in single mode (refs #337). */
  profileId?: ProfileId;
  className?: string;
}

export function EventArchiveButton({ eventId, isArchived, profileId, className }: EventArchiveButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isArchiving, setIsArchiving] = useState(false);

  const { permissions } = usePermissions(profileId);
  const archiveRefused = useIsPermissionDenied(profileId, 'events-edit');

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving || !profileId) return;
    const next = !isArchived;
    setIsArchiving(true);
    try {
      await setEventArchived(getSession(profileId).client, eventId, next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events(profileId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.event(profileId, eventId) }),
      ]);
      toast.success(next ? t('events.archived_success') : t('events.unarchived_success'));
    } catch (err) {
      log.eventCard('Archive toggle failed', LogLevel.ERROR, { eventId, next, error: err });
      // An account too restricted to read its own permissions leaves this
      // control ungated, so the refusal is the only thing that can explain
      // itself. Spend it once: say what happened, and grey the control so the
      // next press is not the same discovery (refs #344).
      if (isNotFound(err) && profileId) {
        // A server that prunes deletes events under an open list, so the card
        // outlives the row. Refresh the list rather than leaving a ghost that
        // fails the same way on every press.
        void queryClient.invalidateQueries({ queryKey: queryKeys.events(profileId) });
        toast.error(t('events.event_gone'));
      } else if (isPermissionDenied(err) && profileId) {
        markPermissionDenied(profileId, 'events-edit');
        toast.error(t('events.archive_permission_denied'));
      } else {
        toast.error(t('events.archive_failed'));
      }
    } finally {
      setIsArchiving(false);
    }
  };

  // Archiving needs Events: Edit. The control stays live and greyed so it can
  // still say why it does nothing (refs #344).
  const archiveProps = useDeniedControl({
    denied: canEditEvents(permissions) === 'denied' || archiveRefused,
    message: t('events.archive_permission_denied'),
    onClick: handleArchiveClick,
    title: isArchived ? t('events.unarchive') : t('events.archive'),
    className: cn(
      'p-1 rounded-full hover:bg-accent transition-colors',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      className
    ),
  });

  return (
    <HintButton
      {...archiveProps}
      disabled={isArchiving}
      aria-label={isArchived ? t('events.unarchive') : t('events.archive')}
      data-testid="event-archive-button"
    >
      {/* Shape carries the state, not fill: a solid archive box
          loses its lid and reads as a blob at this size, and colour
          alone says nothing to a colourblind reader. The restore
          arrow doubles as a hint at what the tap does, which is
          what the label already says. */}
      {isArchived ? (
        <ArchiveRestore
          className="h-4 w-4 transition-colors stroke-primary"
          data-testid="event-archive-icon-on"
        />
      ) : (
        <Archive
          className="h-4 w-4 transition-colors stroke-muted-foreground hover:stroke-primary"
          data-testid="event-archive-icon-off"
        />
      )}
    </HintButton>
  );
}
