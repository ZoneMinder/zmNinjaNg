/**
 * Inline notification badge — small bell icon with unread count.
 * Only renders when there are unread notifications.
 * Rings when new notifications arrive.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useProfileStore } from '../stores/profile';
import { useNotificationStore } from '../stores/notifications';
import { NOTIFICATION_UI } from '../lib/zmninja-ng-constants';

// Module-level: persists across component mount/unmount cycles so
// navigating between pages doesn't re-trigger the animation.
let lastKnownUnreadCount = 0;

export function NotificationBadge() {
  const navigate = useNavigate();
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const unreadCount = useNotificationStore((state) => {
    if (!currentProfileId) return 0;
    const events = state.profileEvents[currentProfileId] || [];
    return events.filter((e) => !e.read).length;
  });

  // ringKey increments to force the Bell element to remount, which restarts the CSS animation.
  // Without this, adding the animation class to an existing element doesn't replay the animation.
  const [ringKey, setRingKey] = useState(0);
  const [isRinging, setIsRinging] = useState(false);
  const prevCountRef = useRef(lastKnownUnreadCount);

  useEffect(() => {
    if (unreadCount > prevCountRef.current) {
      setRingKey((k) => k + 1);
      setIsRinging(true);
      const timeout = setTimeout(() => setIsRinging(false), NOTIFICATION_UI.badgeRingDurationMs);
      prevCountRef.current = unreadCount;
      lastKnownUnreadCount = unreadCount;
      return () => clearTimeout(timeout);
    }
    prevCountRef.current = unreadCount;
    lastKnownUnreadCount = unreadCount;
  }, [unreadCount]);

  if (unreadCount === 0) return null;

  return (
    <button
      className={
        isRinging
          ? "relative inline-flex items-center justify-center h-7 w-7 rounded-full bg-destructive/20 transition-colors duration-500"
          : "relative inline-flex items-center justify-center h-7 w-7 rounded-full bg-muted hover:bg-muted/80 transition-colors duration-500"
      }
      onClick={(e) => { e.stopPropagation(); navigate('/notifications/history'); }}
      aria-label={`${unreadCount} unread notifications`}
      data-testid="notification-badge"
    >
      <Bell
        key={ringKey}
        className={
          isRinging
            ? "h-3.5 w-3.5 text-muted-foreground animate-[ring_1.5s_ease-in-out_2]"
            : "h-3.5 w-3.5 text-muted-foreground"
        }
      />
      <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 flex items-center justify-center text-[9px] font-bold rounded-full bg-destructive text-destructive-foreground">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    </button>
  );
}
