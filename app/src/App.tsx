/**
 * Main Application Component
 *
 * Sets up the application providers (QueryClient, Theme, Router) and defines the route structure.
 * Handles global initialization logic like profile loading and token refreshing.
 */

import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from './stores/profile';
import { useCurrentProfile } from './hooks/useCurrentProfile';
import { setQueryClient } from './stores/query-cache';
import { Toaster } from './components/ui/toast';
import { ThemeProvider } from './components/theme-provider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { useTokenRefresh } from './hooks/useTokenRefresh';
import AppLayout from './components/layout/AppLayout';
import { NotificationHandler } from './components/NotificationHandler';
import { Button } from './components/ui/button';
import { X } from 'lucide-react';
import { log, LogLevel, logger } from './lib/logger';
import { initializeLogFile, hydrateLogStoreFromFile, getLogFile } from './lib/log-file';
import { Platform } from './lib/platform';
import { PipProvider } from './contexts/PipContext';

// Lazy load route components for code splitting
const ProfileForm = lazy(() => import('./pages/ProfileForm'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Monitors = lazy(() => import('./pages/Monitors'));
const MonitorDetail = lazy(() => import('./pages/MonitorDetail'));
const Montage = lazy(() => import('./pages/Montage'));
const Events = lazy(() => import('./pages/Events'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const Timeline = lazy(() => import('./pages/Timeline'));
const Profiles = lazy(() => import('./pages/Profiles'));
const Settings = lazy(() => import('./pages/Settings'));
const Server = lazy(() => import('./pages/Server'));
const NotificationSettings = lazy(() => import('./pages/NotificationSettings'));
const NotificationHistory = lazy(() => import('./pages/NotificationHistory'));
const Logs = lazy(() => import('./pages/Logs'));

// Loading fallback component
function RouteLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Make query client available globally for cache clearing
setQueryClient(queryClient);

function AppRoutes() {
  const profiles = useProfileStore((state) => state.profiles);
  const isInitialized = useProfileStore((state) => state.isInitialized);
  const { currentProfile, settings } = useCurrentProfile();
  const { logLevel, lastRoute, componentLogLevels } = settings;

  // Enable automatic token refresh
  useTokenRefresh();

  // Initialize persistent log file and hydrate store from prior-session entries.
  // Registered first so the file is open before other effects emit logs.
  // Documented limitation: log entries from the very first ~100ms of startup
  // may end up in the file but be replaced out of the in-memory view by hydration;
  // they reappear in the next session's Logs view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initializeLogFile();
      if (cancelled) return;
      await hydrateLogStoreFromFile();
    })();
    return () => { cancelled = true; };
  }, []);

  // Flush log buffer on app lifecycle events to minimize data loss.
  useEffect(() => {
    const flush = () => { void getLogFile().flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);

    let pauseListener: { remove: () => void } | null = null;
    if (Platform.isNative) {
      void (async () => {
        try {
          const { App: CapApp } = await import('@capacitor/app');
          const handle = await CapApp.addListener('pause', flush);
          pauseListener = handle;
        } catch {
          // @capacitor/app may not be present in some test envs
        }
      })();
    }

    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      pauseListener?.remove();
    };
  }, []);

  // Always apply compact mode
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      root.classList.add('compact-mode');
    }
  }, []);

  useEffect(() => {
    logger.setLevel(logLevel);
  }, [logLevel]);

  useEffect(() => {
    logger.setComponentLevels(componentLogLevels || {});
  }, [componentLogLevels]);

  // Log app mount and profile state
  useEffect(() => {
    log.app('React app initialized', LogLevel.INFO, { totalProfiles: profiles.length,
      currentProfile: currentProfile?.name || 'None',
      profileId: currentProfile?.id || 'None',
      hasCredentials: !!(currentProfile?.username && currentProfile?.password),
      isInitialized, });
  }, [profiles.length, currentProfile, isInitialized]);

  // Hide splash screen when app initialization completes
  useEffect(() => {
    if (isInitialized) {
      const hideSplash = async () => {
        try {
          const { SplashScreen } = await import('@capacitor/splash-screen');
          await SplashScreen.hide({
            fadeOutDuration: 200,
          });
          log.app('Splash screen hidden', LogLevel.INFO, { timestamp: new Date().toISOString(), });
        } catch (error) {
          log.app('Failed to hide splash screen (may be running on web)', LogLevel.WARN, { error, });
        }
      };
      hideSplash();
    }
  }, [isInitialized]);

  // SAFETY: Timeout fallback to prevent indefinite hanging
  // If initialization doesn't complete within 5 seconds, force it to complete
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isInitialized) {
        log.app('Profile store initialization timeout - forcing initialization', LogLevel.WARN, { });
        useProfileStore.setState({ isInitialized: true });
      }
    }, 5000);

    return () => clearTimeout(timeout);
  }, [isInitialized]);

  if (!isInitialized) {
    return <RouteLoadingFallback />;
  }

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route
          path="/"
          element={
            currentProfile ? (
              <Navigate to={lastRoute || '/monitors'} replace />
            ) : profiles.length > 0 ? (
              <Navigate to="/profiles" replace />
            ) : (
              <Navigate to="/profiles/new" replace />
            )
          }
        />
        <Route
          path="/profiles/new"
          element={
            <RouteErrorBoundary routePath="/profiles/new">
              <ProfileForm />
            </RouteErrorBoundary>
          }
        />
        {/* Legacy route redirect - for backwards compatibility */}
        <Route
          path="/setup"
          element={<Navigate to="/profiles/new" replace />}
        />

        <Route element={<AppLayout />}>
          <Route
            path="dashboard"
            element={
              <RouteErrorBoundary routePath="/dashboard">
                <Dashboard />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="monitors"
            element={
              <RouteErrorBoundary routePath="/monitors">
                <Monitors />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/monitors/:id"
            element={
              <RouteErrorBoundary routePath="/monitors/:id">
                <MonitorDetail />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/montage"
            element={
              <RouteErrorBoundary routePath="/montage">
                <Montage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/events"
            element={
              <RouteErrorBoundary routePath="/events">
                <Events />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/events/:id"
            element={
              <RouteErrorBoundary routePath="/events/:id">
                <EventDetail />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/event-montage"
            element={<Navigate to="/events?view=montage" replace />}
          />
          <Route
            path="/timeline"
            element={
              <RouteErrorBoundary routePath="/timeline">
                <Timeline />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/profiles"
            element={
              <RouteErrorBoundary routePath="/profiles">
                <Profiles />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/notifications"
            element={
              <RouteErrorBoundary routePath="/notifications">
                <NotificationSettings />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/notifications/history"
            element={
              <RouteErrorBoundary routePath="/notifications/history">
                <NotificationHistory />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/settings"
            element={
              <RouteErrorBoundary routePath="/settings">
                <Settings />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/server"
            element={
              <RouteErrorBoundary routePath="/server">
                <Server />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/logs"
            element={
              <RouteErrorBoundary routePath="/logs">
                <Logs />
              </RouteErrorBoundary>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}

function App() {
  const { t } = useTranslation();
  const isBootstrapping = useProfileStore((state) => state.isBootstrapping);
  const bootstrapStep = useProfileStore((state) => state.bootstrapStep);
  const cancelBootstrap = useProfileStore((state) => state.cancelBootstrap);

  const handleCancelBootstrap = () => {
    log.app('Bootstrap cancelled by user', LogLevel.INFO);
    cancelBootstrap();
    // AppLayout will handle redirect to /profiles or /profiles/new
  };

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="slate">
          <PipProvider>
            <div
              className={isBootstrapping ? 'pointer-events-none select-none' : ''}
              aria-busy={isBootstrapping}
            >
              <HashRouter>
                <NotificationHandler />
                <AppRoutes />
              </HashRouter>
            </div>
            <Toaster />
            {isBootstrapping && (
              <div
                className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-auto touch-none"
                data-testid="app-init-blocker"
              >
                <div className="w-[min(90vw,24rem)] rounded-lg border border-border bg-background/95 px-4 py-4 text-center shadow-lg">
                  <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <div className="text-sm font-medium">{t('app_init.toast_title')}</div>
                    <div className="text-xs text-muted-foreground">
                      {bootstrapStep ? t(`app_init.step_${bootstrapStep}`) : t('app_init.step_start')}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelBootstrap}
                      className="mt-2"
                      data-testid="cancel-bootstrap-button"
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      {t('common.cancel')}
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      {t('app_init.cancel_hint_single')}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </PipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
