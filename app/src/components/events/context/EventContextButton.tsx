/**
 * Trigger for the "around this event" panel (refs #494). Wraps the row's
 * `Event` into the `EventData` shape the panel's data hook expects, stops the
 * click from reaching the card underneath, and greys itself when the owning
 * profile may not read events, the same way the archive button does.
 */
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { useEventContextStore } from '../../../stores/eventContext';
import { useCurrentProfile } from '../../../hooks/useCurrentProfile';
import { usePermissions } from '../../../hooks/usePermissions';
import { canViewEvents } from '../../../lib/permissions/zm-permissions';
import { useDeniedControl } from '../../../hooks/useDeniedControl';
import { HintButton } from '../../ui/button';
import type { Event, EventData, ProfileId } from '../../../api/types';

interface EventContextButtonProps {
  event: Event;
  profileId?: ProfileId;
  className?: string;
}

export function EventContextButton({ event, profileId, className }: EventContextButtonProps) {
  const { t } = useTranslation();
  const openPanel = useEventContextStore((s) => s.openPanel);
  const { currentProfile } = useCurrentProfile();
  const ownerProfileId = profileId ?? currentProfile?.id;
  const { permissions } = usePermissions(ownerProfileId);

  const props = useDeniedControl({
    denied: canViewEvents(permissions) === 'denied',
    message: t('events.around.permission_denied'),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      openPanel({ Event: event } as EventData, ownerProfileId);
    },
    title: t('events.around.open'),
    className: cn('p-1 rounded-full hover:bg-accent transition-colors', className),
  });

  return (
    <HintButton {...props} aria-label={t('events.around.open')} data-testid="event-context-open">
      <Link2 className="h-4 w-4 sm:h-5 sm:w-5 stroke-muted-foreground hover:stroke-primary" />
    </HintButton>
  );
}
