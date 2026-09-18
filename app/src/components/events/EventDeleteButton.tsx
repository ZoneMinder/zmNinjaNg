/**
 * Trash toggle that queues/unqueues a ZoneMinder event for bulk deletion
 * (refs #213). Used by the compact recent-events row and the full EventCard.
 * Click propagation is stopped so it never triggers the parent row navigation.
 */
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useDeleteSelectionStore, eventSelectionKey } from '../../stores/deleteSelection';
import type { ProfileId } from '../../api/types';
import { HintButton } from '../ui/button';
import { usePermissions } from '../../hooks/usePermissions';
import { canEditEvents } from '../../lib/permissions/zm-permissions';
import { useDeniedControl } from '../../hooks/useDeniedControl';
import { useIsPermissionDenied } from '../../stores/permissions';

interface EventDeleteButtonProps {
  eventId: string;
  /** Owning profile. Raw ZM event ids collide across servers, so the selection
   *  is keyed by profile too (refs #337). */
  profileId?: ProfileId;
  className?: string;
}

export function EventDeleteButton({ eventId, profileId, className }: EventDeleteButtonProps) {
  const { t } = useTranslation();
  const selectionKey = eventSelectionKey(profileId, eventId);
  const selected = useDeleteSelectionStore((s) => s.selectedKeys.includes(selectionKey));
  const toggle = useDeleteSelectionStore((s) => s.toggle);
  const iconSize = 'h-4 w-4';

  // Deleting needs Events: Edit. Greyed rather than hidden, so an
  // administrator can see which permission their account is missing (refs #344).
  const { permissions } = usePermissions(profileId);
  const deleteRefused = useIsPermissionDenied(profileId, 'events-edit');
  const deniedProps = useDeniedControl({
    denied: canEditEvents(permissions) === 'denied' || deleteRefused,
    message: t('events.delete_permission_denied'),
    onClick: (e) => {
      e.stopPropagation();
      toggle(selectionKey);
    },
    title: t('events.delete_toggle_aria'),
    className: cn(
      'p-1 rounded transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className
    ),
  });

  return (
    <HintButton
      type="button"
      {...deniedProps}
      aria-label={t('events.delete_toggle_aria')}
      aria-pressed={selected}
      data-testid="event-delete-button"
    >
      <Trash2
        className={cn(
          iconSize,
          'transition-colors',
          selected ? 'text-destructive' : 'stroke-muted-foreground hover:stroke-destructive'
        )}
      />
    </HintButton>
  );
}
