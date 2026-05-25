/**
 * App Layout Component
 *
 * The main layout component for the application.
 * It provides the responsive sidebar navigation, mobile header, and main content area.
 * It also handles the sidebar resizing logic and mobile drawer state.
 */

import { Outlet, useLocation, Navigate } from 'react-router-dom';
import logoUrl from '../../../assets/logo.png';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';
import { Button } from '../ui/button';
import { log, LogLevel } from '../../lib/logger';
import { viewNameForPath } from '../../lib/navigation';
import { useInsomnia } from '../../hooks/useInsomnia';
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet';
import { useTranslation } from 'react-i18next';
import { BackgroundTaskDrawer } from '../BackgroundTaskDrawer';
import { CertTrustDialog } from '../CertTrustDialog';
import { onCertTrustRequest, type PendingCertTrust } from '../../lib/cert-trust-event';
import { useTvMode } from '../../hooks/useTvMode';
import { enableSpatialNavigation, checkIsTV } from '../../lib/tv-spatial-nav';
import { useKioskStore } from '../../stores/kioskStore';
import { KioskOverlay } from '../kiosk/KioskOverlay';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SidebarContent } from './SidebarContent';


/**
 * AppLayout Component
 * The main layout wrapper that includes the sidebar and main content area.
 */
export default function AppLayout() {
  const { currentProfile, settings } = useCurrentProfile();
  const updateProfileSettings = useSettingsStore((state) => state.updateProfileSettings);
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => (settings.sidebarWidth ?? 256) <= 80);
  const { t } = useTranslation();
  const { isTvMode } = useTvMode();

  useEffect(() => {
    document.documentElement.classList.toggle('tv-mode', isTvMode);
    return () => document.documentElement.classList.remove('tv-mode');
  }, [isTvMode]);

  useEffect(() => {
    if (isTvMode) {
      enableSpatialNavigation();
    }
  }, [isTvMode]);

  const profileId = currentProfile?.id;
  const tvAutoDetectedRef = useRef(false);

  useEffect(() => {
    if (!profileId || tvAutoDetectedRef.current) return;
    tvAutoDetectedRef.current = true;

    checkIsTV().then((isTV) => {
      if (isTV && !settings.tvMode) {
        updateProfileSettings(profileId, { tvMode: true });
      }
    });
  }, [profileId, settings.tvMode, updateProfileSettings]);

  // Track route changes and save to settings
  useEffect(() => {
    if (!currentProfile?.id) return;

    // Bold banner so view transitions are easy to spot in the console
    const viewName = viewNameForPath(location.pathname);
    if (viewName) {
      log.banner(`Entering ${viewName} View`);
    }

    // Exclude setup/profile routes and notification-opened pages from being saved as lastRoute
    const excludedRoutes = ['/profiles/new', '/setup', '/profiles'];
    const fromNotification = (location.state as Record<string, unknown>)?.fromNotification === true;
    const shouldSave = !excludedRoutes.includes(location.pathname) && !fromNotification;

    if (shouldSave) {
      updateProfileSettings(currentProfile.id, { lastRoute: location.pathname });
      log.app('Storing route', LogLevel.DEBUG, { route: location.pathname });
    }
  }, [location.pathname, currentProfile?.id, updateProfileSettings]);

  // Apply global insomnia setting
  useInsomnia({ enabled: settings.insomnia });

  const { isLocked, previousInsomniaState } = useKioskStore();

  useEffect(() => {
    if (isLocked && !isCollapsed) {
      setIsCollapsed(true);
    }
  }, [isLocked]);

  const handleKioskUnlock = useCallback(() => {
    if (currentProfile) {
      updateProfileSettings(currentProfile.id, { insomnia: previousInsomniaState });
    }
  }, [currentProfile, previousInsomniaState, updateProfileSettings]);


  const expandedWidth = 180;
  const collapsedWidth = 60;
  const sidebarWidth = isCollapsed ? collapsedWidth : expandedWidth;

  const toggleSidebar = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    if (currentProfile) {
      updateProfileSettings(currentProfile.id, { sidebarWidth: next ? collapsedWidth : expandedWidth });
    }
  };

  // TOFU certificate trust migration dialog — hooks must be above any early return
  const [pendingCert, setPendingCert] = useState<PendingCertTrust | null>(null);

  useEffect(() => {
    return onCertTrustRequest((pending) => {
      setPendingCert(pending);
    });
  }, []);

  const handleCertTrust = useCallback(async () => {
    if (!pendingCert) return;
    const { profileId, certInfo } = pendingCert;
    setPendingCert(null);

    updateProfileSettings(profileId, { trustedCertFingerprint: certInfo.fingerprint });
    const { applySSLTrustSetting } = await import('../../lib/ssl-trust');
    await applySSLTrustSetting(true, certInfo.fingerprint);
    log.app('Certificate trusted via TOFU migration', LogLevel.INFO);
  }, [pendingCert, updateProfileSettings]);

  const handleCertCancel = useCallback(async () => {
    if (!pendingCert) return;
    const { profileId } = pendingCert;
    setPendingCert(null);

    // Disable self-signed certs since user rejected the certificate
    updateProfileSettings(profileId, { allowSelfSignedCerts: false, trustedCertFingerprint: null });
    const { applySSLTrustSetting } = await import('../../lib/ssl-trust');
    await applySSLTrustSetting(false);
    log.app('Certificate rejected, disabling self-signed cert support', LogLevel.INFO);
  }, [pendingCert, updateProfileSettings]);

  // Check for profile after all hooks are called to avoid hooks violation
  if (!currentProfile) {
    if (location.pathname === '/profiles') {
      // Allow access to profiles page without a current profile
    } else {
      const profiles = useProfileStore.getState().profiles;
      return <Navigate to={profiles.length > 0 ? "/profiles" : "/profiles/new"} replace />;
    }
  }

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden pl-[var(--sai-left,env(safe-area-inset-left))] pr-[var(--sai-right,env(safe-area-inset-right))]">
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex flex-col border-r bg-card/50 backdrop-blur-xl z-20 transition-all duration-300 relative group pt-[var(--sai-top,env(safe-area-inset-top))]"
        style={{ width: `${sidebarWidth}px` }}
        data-tv-region="sidebar"
      >
        <SidebarContent isCollapsed={isCollapsed} />

        {/* Toggle Button */}
        <div
          className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-5 h-10 bg-primary hover:bg-primary/90 rounded-full flex items-center justify-center cursor-pointer shadow-lg z-50 transition-all duration-200 ${isTvMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={toggleSidebar}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSidebar(); } }}
          tabIndex={0}
          role="button"
          title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          data-testid="sidebar-toggle"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-primary-foreground" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-primary-foreground" />
          )}
        </div>
      </aside>

      {/* Mobile Header */}
      {!isLocked && (
      <div className="md:hidden fixed top-0 left-0 right-0 h-[calc(3rem+var(--sai-top,env(safe-area-inset-top)))] pt-[var(--sai-top,env(safe-area-inset-top))] border-b bg-background z-30 flex items-center px-3 justify-between">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt={t('app.logo_alt')} className="h-8 w-8 rounded-lg" />
          <span className="font-bold">{t('app.name')}</span>
          <LanguageSwitcher />
        </div>
        <div className="flex items-center gap-1">
          {location.pathname === '/montage' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (currentProfile) {
                  updateProfileSettings(currentProfile.id, {
                    montageShowToolbar: !settings.montageShowToolbar,
                  });
                }
              }}
              title={t('montage.toggle_toolbar')}
              data-testid="montage-toolbar-toggle"
            >
              {settings.montageShowToolbar ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </Button>
          )}
          <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="mobile-menu-button">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
          <SheetContent side="left" className="p-0 w-64 sm:w-72 flex flex-col pt-[var(--sai-top,env(safe-area-inset-top))]">
            <SheetTitle className="sr-only">{t('app.navigation_menu')}</SheetTitle>
            <SheetDescription className="sr-only">{t('app.navigation_menu_desc')}</SheetDescription>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent onMobileClose={() => setIsMobileOpen(false)} />
            </div>
          </SheetContent>
          </Sheet>
        </div>
      </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative w-full pt-[calc(3rem+var(--sai-top,env(safe-area-inset-top)))] md:pt-[var(--sai-top,env(safe-area-inset-top))] pb-[var(--sai-bottom,env(safe-area-inset-bottom))]" data-tv-region="main">
        {/* Background gradient blob for visual interest */}
        <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-primary/5 to-transparent -z-10 pointer-events-none" />

        <Outlet />
      </main>

      {/* Global Background Task Drawer */}
      <BackgroundTaskDrawer />


      {/* TOFU certificate trust migration dialog */}
      <CertTrustDialog
        open={!!pendingCert}
        certInfo={pendingCert?.certInfo ?? null}
        isChanged={false}
        onTrust={handleCertTrust}
        onCancel={handleCertCancel}
      />

      <KioskOverlay onUnlock={handleKioskUnlock} />
    </div>
  );
}
