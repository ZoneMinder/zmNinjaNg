/**
 * Favorite toggle for a ZoneMinder event. Click propagation is stopped so it
 * never triggers the parent card/tile's navigation.
 */
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useEventFavoritesStore } from '../../stores/eventFavorites';
import type { ProfileId } from '../../api/types';
import { HintButton } from '../ui/button';

interface EventFavoriteButtonProps {
  eventId: string;
  /** Owning profile: the row's own profileId in All mode, the current
   *  profile in single mode (refs #337). */
  profileId?: ProfileId;
  className?: string;
}

export function EventFavoriteButton({ eventId, profileId, className }: EventFavoriteButtonProps) {
  const { t } = useTranslation();
  const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);
  // Subscribe to the specific favorite state for this event so this button
  // re-renders when favorite status changes.
  const isFav = useEventFavoritesStore((state) =>
    profileId ? state.isFavorited(profileId, eventId) : false
  );

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (profileId) {
      toggleFavorite(profileId, eventId);
    }
  };

  return (
    <HintButton
      onClick={handleFavoriteClick}
      className={cn(
        "shrink-0 p-1 rounded-full hover:bg-accent transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        className
      )}
      title={isFav ? t('events.unfavorite') : t('events.favorite')}
      aria-label={isFav ? t('events.unfavorite') : t('events.favorite')}
      data-testid="event-favorite-button"
    >
      <Star
        className={cn(
          "h-4 w-4 transition-colors",
          isFav
            ? "fill-yellow-500 stroke-yellow-500"
            : "stroke-muted-foreground hover:stroke-yellow-500"
        )}
      />
    </HintButton>
  );
}
