/**
 * Navigation Service
 *
 * Provides a way for non-React code (like services) to trigger navigation
 * events that can be handled by React components with access to the router.
 */

import { log, LogLevel } from './logger';

export interface NavigationState {
  from?: string;
  fromNotification?: boolean;
  [key: string]: unknown;
}

export interface NavigationEvent {
  path: string;
  replace?: boolean;
  state?: NavigationState;
}

type NavigationListener = (event: NavigationEvent) => void;

class NavigationService {
  private listeners: NavigationListener[] = [];

  /**
   * Navigate to a path
   */
  public navigate(path: string, replace = false, state?: NavigationState): void {
    log.navigation('Navigation requested', LogLevel.INFO, { path, replace });

    const event: NavigationEvent = { path, replace, state };
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.navigation('Navigation listener error', LogLevel.ERROR, { path, error });
      }
    });
  }

  /**
   * Navigate to event detail page
   */
  public navigateToEvent(eventId: string | number, state?: NavigationState): void {
    this.navigate(`/events/${eventId}`, false, state);
  }

  /**
   * Navigate to monitor detail page
   */
  public navigateToMonitor(monitorId: string | number): void {
    this.navigate(`/monitors/${monitorId}`);
  }

  /**
   * Add a navigation listener
   * @returns Cleanup function to remove the listener
   */
  public addListener(listener: NavigationListener): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Remove all listeners (useful for cleanup)
   */
  public removeAllListeners(): void {
    this.listeners = [];
  }
}

// Singleton instance
export const navigationService = new NavigationService();

/**
 * Map a pathname to the human-readable view name used in entry banners
 * and any other place that wants to refer to the current page in plain
 * language. Returns null for paths that shouldn't emit a banner (the
 * setup flow, transient redirects).
 */
export function viewNameForPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  const exact: Record<string, string> = {
    '/': 'Home',
    '/dashboard': 'Dashboard',
    '/monitors': 'Monitors',
    '/montage': 'Montage',
    '/events': 'Events',
    '/event-montage': 'Event Montage',
    '/timeline': 'Timeline',
    '/notifications': 'Notifications',
    '/notification-settings': 'Notification Settings',
    '/notification-history': 'Notification History',
    '/server': 'Server',
    '/profiles': 'Profiles',
    '/settings': 'Settings',
    '/logs': 'Logs',
    '/kiosk': 'Kiosk',
  };
  if (path in exact) return exact[path];

  // Setup-flow paths suppress the banner — they're transient and not "views".
  if (path === '/setup' || path === '/profiles/new') return null;

  if (/^\/monitors\/[^/]+$/.test(path)) return 'Monitor Detail';
  if (/^\/events\/[^/]+$/.test(path)) return 'Event Detail';
  if (/^\/profiles\/[^/]+\/edit$/.test(path)) return 'Profile Form';

  return null;
}
