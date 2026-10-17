/**
 * Sidebar "Exit" item for TV mode on Android (refs #555).
 *
 * A TV remote has no obvious way out of the app besides Home, which leaves it
 * running. Hidden off Android (iOS and the web cannot exit themselves) and
 * while the kiosk lock is on.
 */

import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTvMode } from '../../hooks/useTvMode';
import { exitApp } from '../../hooks/useAndroidBackButton';
import { useKioskStore } from '../../stores/kioskStore';
import { Platform } from '../../lib/platform';
import { cn } from '../../lib/utils';

interface ExitAppNavItemProps {
  isCollapsed?: boolean;
  isMobileDrawer?: boolean;
}

export function ExitAppNavItem({ isCollapsed, isMobileDrawer }: ExitAppNavItemProps) {
  const { t } = useTranslation();
  const { isTvMode } = useTvMode();
  const isLocked = useKioskStore((state) => state.isLocked);

  if (!isTvMode || !Platform.isAndroid || isLocked) return null;

  return (
    <button
      type="button"
      onClick={() => void exitApp()}
      className={cn(
        "flex items-center rounded-lg font-medium transition-all duration-200 group relative w-full text-left",
        isMobileDrawer ? "gap-2 px-2 py-2 text-sm" : "gap-3 px-3 py-2.5 text-sm",
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        isCollapsed && "justify-center px-2"
      )}
      title={t('sidebar.exit_app')}
      aria-label={t('sidebar.exit_app')}
      data-testid="nav-item-exit"
    >
      <LogOut className="h-4 w-4 transition-transform group-hover:scale-110 flex-shrink-0" />
      {!isCollapsed && <span className="truncate">{t('sidebar.exit_app')}</span>}
    </button>
  );
}
