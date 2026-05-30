/**
 * Sidebar Content Component
 * Renders the navigation links and user controls within the sidebar.
 */

import { Link, useLocation } from 'react-router-dom';
import logoUrl from '../../../assets/logo.png';
import { useProfileStore } from '../../stores/profile';
import { useNotificationStore } from '../../stores/notifications';
import { useSettingsStore } from '../../stores/settings';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../ui/button';
import { ModeToggle } from '../mode-toggle';
import { ProfileSwitcher } from '../profile-switcher';
import { useToast } from '../../hooks/use-toast';
import {
  LayoutGrid,
  Video,
  Clock,
  ChartGantt,
  Settings,
  Users,
  Bell,
  FileText,
  GripVertical,
  LayoutDashboard,
  RotateCcw,
  Server,
  Eye,
  EyeOff,
  ArrowUpDown,
  Check,
  Lock,
  LockOpen,
  HelpCircle,
  Megaphone,
} from 'lucide-react';
import { useDeveloperNotices } from '../../hooks/useDeveloperNotices';

const HELP_DOCS_URL = 'https://zmninjang.readthedocs.io/en/latest/';

async function openHelpDocs(): Promise<void> {
  if (typeof window !== 'undefined') {
    window.open(HELP_DOCS_URL, '_blank', 'noopener,noreferrer');
  }
}
import { cn } from '../../lib/utils';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppVersion } from '../../lib/version';
import { useKioskStore } from '../../stores/kioskStore';
import { PinPad } from '../kiosk/PinPad';
import { useKioskLock } from '../../hooks/useKioskLock';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useTvMode } from '../../hooks/useTvMode';

export interface SidebarContentProps {
  onMobileClose?: () => void;
  isCollapsed?: boolean;
}

export function SidebarContent({ onMobileClose, isCollapsed }: SidebarContentProps) {
  const location = useLocation();
  const isMobileDrawer = !!onMobileClose;
  const { isTvMode } = useTvMode();
  const { unreadCount: developerNoticeUnread } = useDeveloperNotices();
  const currentProfile = useProfileStore(
    useShallow((state) => {
      const { profiles, currentProfileId } = state;
      return profiles.find((p) => p.id === currentProfileId) || null;
    })
  );
  const { connectionState, getProfileSettings } = useNotificationStore(
    useShallow((state) => ({
      connectionState: state.connectionState,
      getProfileSettings: state.getProfileSettings,
    }))
  );
  const { getProfileSettings: getSettings, updateProfileSettings } = useSettingsStore(
    useShallow((state) => ({
      getProfileSettings: state.getProfileSettings,
      updateProfileSettings: state.updateProfileSettings,
    }))
  );

  // Get notification data for current profile
  const settings = currentProfile ? getProfileSettings(currentProfile.id) : null;
  const profileSettings = currentProfile ? getSettings(currentProfile.id) : null;

  const { t } = useTranslation();
  const { toast } = useToast();

  const handleInsomniaToggle = () => {
    if (currentProfile && profileSettings) {
      const newValue = !profileSettings.insomnia;
      updateProfileSettings(currentProfile.id, { insomnia: newValue });
      toast({
        description: t(newValue ? 'montage.insomnia_enabled' : 'montage.insomnia_disabled'),
      });
    }
  };

  const {
    isLocked: kioskIsLocked, showSetPin, setPinMode, pinError,
    handleLockToggle, handleSetPinSubmit, handleSetPinCancel,
  } = useKioskLock({ onLocked: () => onMobileClose?.() });
  const requestUnlock = useKioskStore((s) => s.requestUnlock);

  const defaultNavItems = [
    { path: '/dashboard', label: t('sidebar.dashboard'), icon: LayoutDashboard },
    { path: '/monitors', label: t('sidebar.monitors'), icon: Video },
    { path: '/montage', label: t('sidebar.montage'), icon: LayoutGrid },
    { path: '/events', label: t('sidebar.events'), icon: Clock },
    { path: '/timeline', label: t('sidebar.timeline'), icon: ChartGantt },
    { path: '/notifications', label: t('sidebar.notifications'), icon: Bell },
    { path: '/profiles', label: t('sidebar.profiles'), icon: Users },
    { path: '/settings', label: t('sidebar.settings'), icon: Settings },
    { path: '/server', label: t('sidebar.server'), icon: Server },
    { path: '/logs', label: t('sidebar.logs'), icon: FileText },
    { path: '/developer-notice', label: t('sidebar.developer_notice'), icon: Megaphone },
  ];

  const savedOrder = profileSettings?.sidebarNavOrder;
  const navItems = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return defaultNavItems;
    const orderMap = new Map(savedOrder.map((path, idx) => [path, idx]));
    return [...defaultNavItems].sort((a, b) => {
      const ai = orderMap.get(a.path) ?? 999;
      const bi = orderMap.get(b.path) ?? 999;
      return ai - bi;
    });
    // `defaultNavItems` is rebuilt every render; `t` covers label refresh on language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOrder, t]);

  const [isReordering, setIsReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const navListRef = useRef<HTMLElement>(null);
  const dragOriginY = useRef(0);

  const saveNavOrder = useCallback((reordered: typeof navItems) => {
    if (!currentProfile) return;
    updateProfileSettings(currentProfile.id, {
      sidebarNavOrder: reordered.map((item) => item.path),
    });
  }, [currentProfile, updateProfileSettings]);

  const resetNavOrder = useCallback(() => {
    if (!currentProfile) return;
    updateProfileSettings(currentProfile.id, { sidebarNavOrder: [] });
  }, [currentProfile, updateProfileSettings]);

  const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragIndex(index);
    setDragOffsetY(0);
    dragOriginY.current = e.clientY;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragIndex === null || !navListRef.current) return;

    // Move the dragged item visually with the pointer
    setDragOffsetY(e.clientY - dragOriginY.current);

    // Live swap when crossing another item's midpoint
    const items = navListRef.current.querySelectorAll('[data-nav-reorder]');
    for (let i = 0; i < items.length; i++) {
      if (i === dragIndex) continue;
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        if ((i < dragIndex && e.clientY < midY) || (i > dragIndex && e.clientY > midY)) {
          const reordered = [...navItems];
          [reordered[dragIndex], reordered[i]] = [reordered[i], reordered[dragIndex]];
          saveNavOrder(reordered);
          setDragIndex(i);
          // Reset origin to current pointer so offset stays smooth after swap
          dragOriginY.current = e.clientY;
          setDragOffsetY(0);
        }
        return;
      }
    }
  }, [dragIndex, navItems, saveNavOrder]);

  const handlePointerUp = useCallback(() => {
    setDragIndex(null);
    setDragOffsetY(0);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={cn(
        "transition-all duration-300",
        isCollapsed ? "p-2 flex flex-col items-center" : isMobileDrawer ? "px-3 py-2" : "p-6"
      )}>
        <div className={cn("flex items-center gap-2 mb-1", isCollapsed && "flex-col mb-2")}>
          <img src={logoUrl} alt={t('app.logo_alt')} className={cn("rounded-lg", isMobileDrawer ? "h-6 w-6" : "h-8 w-8")} />
          {!isCollapsed && (
            <>
              <h1 className="text-base font-bold tracking-tight whitespace-nowrap">{t('app.name')}</h1>
              <LanguageSwitcher />
            </>
          )}
        </div>
        {isCollapsed && <LanguageSwitcher collapsed />}
        {!isCollapsed && currentProfile && (
          <p className="text-xs text-muted-foreground font-medium px-1 truncate">
            {currentProfile.name}
          </p>
        )}
      </div>

      <div className={cn("flex-1 overflow-y-auto overflow-x-hidden", isMobileDrawer ? "px-2 py-1" : "px-3 py-2")}>
        {/* Reorder toggle — only when expanded */}
        {!isCollapsed && (
          <div className="flex justify-end gap-1 mb-1 px-1">
            {isReordering && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={resetNavOrder}
                title={t('settings.nav_order_reset')}
                data-testid="nav-reorder-reset"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsReordering((prev) => !prev)}
              title={isReordering ? t('dashboard.done') : t('settings.nav_order')}
              data-testid="nav-reorder-toggle"
            >
              {isReordering ? <Check className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3 w-3" />}
            </Button>
          </div>
        )}
        <nav
          ref={navListRef}
          className={isMobileDrawer ? "space-y-1" : "space-y-1.5"}
          onPointerMove={isReordering ? handlePointerMove : undefined}
          onPointerUp={isReordering ? handlePointerUp : undefined}
        >
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            if (isReordering && !isCollapsed) {
              const isDragging = dragIndex === index;
              return (
                <div
                  key={item.path}
                  data-nav-reorder
                  onPointerDown={(e) => handlePointerDown(e, index)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium select-none touch-none",
                    isDragging
                      ? "bg-primary/15 text-foreground shadow-md z-10 relative scale-[1.03]"
                      : "text-muted-foreground cursor-grab transition-all duration-200"
                  )}
                  style={isDragging ? { transform: `translateY(${dragOffsetY}px) scale(1.03)` } : undefined}
                  data-testid={`nav-reorder-${item.path.replace('/', '')}`}
                >
                  <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                </div>
              );
            }

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => onMobileClose?.()}
                className={cn(
                  "flex items-center rounded-lg font-medium transition-all duration-200 group relative",
                  isMobileDrawer ? "gap-2 px-2 py-2 text-sm" : "gap-3 px-3 py-2.5 text-sm",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  isCollapsed && "justify-center px-2"
                )}
                title={isCollapsed ? item.label : undefined}
                data-testid={`nav-item-${item.path.replace('/', '')}`}
              >
                <span className="relative flex-shrink-0">
                  <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", isActive && "text-primary-foreground")} />
                  {item.path === '/developer-notice' && developerNoticeUnread > 0 && (
                    <span
                      className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-amber-500 animate-pulse"
                      style={{ animationDuration: '2s' }}
                      aria-label={t('developer_notice.unread')}
                      data-testid="developer-notice-unread-dot"
                    />
                  )}
                </span>
                {!isCollapsed && (
                  <>
                    <span className="truncate">{item.label}</span>

                    {item.path === '/montage' && isActive && (() => {
                      return (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 ml-auto flex-shrink-0"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (currentProfile) {
                              updateProfileSettings(currentProfile.id, {
                                montageShowToolbar: !profileSettings?.montageShowToolbar,
                              });
                            }
                          }}
                          title={t('montage.toggle_toolbar')}
                          data-testid="sidebar-montage-toolbar-toggle"
                        >
                          {profileSettings?.montageShowToolbar
                            ? <Eye className="h-3.5 w-3.5" />
                            : <EyeOff className="h-3.5 w-3.5" />}
                        </Button>
                      );
                    })()}

                    {item.path === '/notifications' && (() => {
                      const statusLabel =
                        !settings?.enabled ? t('notifications.status.disabled') :
                        settings?.notificationMode === 'direct' ? t('notifications.status.direct_active') :
                        connectionState === 'connected' ? t('notifications.status.connected') :
                        connectionState === 'disconnected' ? t('notifications.status.disconnected') :
                        t('notifications.status.connecting');
                      const dotColor =
                        !settings?.enabled ? "bg-muted-foreground/50" :
                        settings?.notificationMode === 'direct' ? "bg-blue-400" :
                        connectionState === 'connected' ? "bg-green-500" :
                        connectionState === 'disconnected' || connectionState === 'error' ? "bg-red-500" :
                        "bg-orange-500 animate-pulse";
                      return (
                        <div
                          className={cn("h-2 w-2 rounded-full ml-2 flex-shrink-0", dotColor)}
                          title={statusLabel}
                          role="status"
                          aria-live="polite"
                          aria-label={statusLabel}
                          data-testid="notification-status-indicator"
                        />
                      );
                    })()}

                  </>
                )}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => {
              void openHelpDocs();
              onMobileClose?.();
            }}
            className={cn(
              "flex items-center rounded-lg font-medium transition-all duration-200 group relative w-full text-left",
              isMobileDrawer ? "gap-2 px-2 py-2 text-sm" : "gap-3 px-3 py-2.5 text-sm",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              isCollapsed && "justify-center px-2"
            )}
            title={isCollapsed ? t('sidebar.help') : undefined}
            data-testid="nav-item-help"
          >
            <HelpCircle className="h-4 w-4 transition-transform group-hover:scale-110 flex-shrink-0" />
            {!isCollapsed && <span className="truncate">{t('sidebar.help')}</span>}
          </button>
        </nav>

      <div className={cn("border-t bg-card/50 backdrop-blur-sm transition-all duration-300 mt-4", isCollapsed ? "p-2 space-y-3" : isMobileDrawer ? "px-2 py-2 space-y-1" : "px-3 py-2 space-y-1.5")}>
        {!isCollapsed ? (
          <>
            <div className={isMobileDrawer ? "space-y-0.5" : "space-y-1"}>
              <span className="text-xs font-medium text-muted-foreground px-1">{t('sidebar.profile')}</span>
              <ProfileSwitcher />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('settings.theme')}</span>
              <ModeToggle className={isMobileDrawer ? "h-7 w-7" : "h-8 w-8"} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('monitor_detail.insomnia_label')}</span>
              <Button
                onClick={handleInsomniaToggle}
                variant={profileSettings?.insomnia ? "default" : "outline"}
                size="icon"
                className={isMobileDrawer ? "h-7 w-7" : "h-8 w-8"}
                title={profileSettings?.insomnia ? t('montage.insomnia_enabled') : t('montage.insomnia_disabled')}
                data-testid="sidebar-insomnia-toggle"
              >
                {profileSettings?.insomnia ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {kioskIsLocked ? t('kiosk.unlock_label') : t('kiosk.lock_label')}
              </span>
              <Button
                onClick={kioskIsLocked ? requestUnlock : handleLockToggle}
                variant={kioskIsLocked ? "default" : "outline"}
                size="icon"
                className={isMobileDrawer ? "h-7 w-7" : "h-8 w-8"}
                title={kioskIsLocked ? t('kiosk.unlock_label') : t('kiosk.lock_label')}
                data-testid="sidebar-kiosk-lock"
              >
                {kioskIsLocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              onClick={handleInsomniaToggle}
              variant={profileSettings?.insomnia ? "default" : "outline"}
              size="icon"
              className="h-8 w-8"
              title={profileSettings?.insomnia ? t('montage.insomnia_enabled') : t('montage.insomnia_disabled')}
              data-testid="sidebar-insomnia-toggle-collapsed"
            >
              {profileSettings?.insomnia ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
            <Button
              onClick={kioskIsLocked ? requestUnlock : handleLockToggle}
              variant={kioskIsLocked ? "default" : "outline"}
              size="icon"
              className="h-8 w-8"
              title={kioskIsLocked ? t('kiosk.unlock_label') : t('kiosk.lock_label')}
              data-testid="sidebar-kiosk-lock-collapsed"
            >
              {kioskIsLocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </Button>
          </>
        )}
        {isTvMode && (
          <span className={cn("block text-[10px] pt-1 text-primary/60 font-medium", isCollapsed ? "text-center" : "px-1")}>
            {isCollapsed ? 'TV' : t('sidebar.tv_mode')}
          </span>
        )}
        <span className={cn("block text-[10px] pt-1 opacity-40", isCollapsed ? "text-center" : "px-1")} style={{ fontSize: '10px' }}>
          v{getAppVersion()}
        </span>
      </div>
      </div>
      {showSetPin && (
        <PinPad
          mode={setPinMode}
          onSubmit={handleSetPinSubmit}
          onCancel={handleSetPinCancel}
          error={pinError}
        />
      )}
    </div>
  );
}
