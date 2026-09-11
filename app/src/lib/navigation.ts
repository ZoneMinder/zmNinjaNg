/**
 * Navigation Service
 *
 * Provides a way for non-React code (like services) to trigger navigation
 * events that can be handled by React components with access to the router.
 */

import { log, LogLevel } from './logger';
import { type ProfileId } from '../api/types';

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
   * Navigate to event detail page. When profileId is given, routes through
   * the /all/ deep route so the page resolves its session from that owning
   * profile instead of the (possibly absent) current one - used for All-mode
   * notification taps (refs #337).
   */
  public navigateToEvent(eventId: string | number, state?: NavigationState, profileId?: string): void {
    const path = profileId ? `/all/events/${profileId}/${eventId}` : `/events/${eventId}`;
    this.navigate(path, false, state);
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

/** Every section-level route and what to call it. Module scope because two
 *  things read it now: the entry banner below, and `resolveSwitchDestination`,
 *  which uses membership here as its definition of "a page, not an entity". */
const SECTION_VIEW_NAMES: Record<string, string> = {
  '/': 'Home',
  '/dashboard': 'Dashboard',
  '/monitors': 'Monitors',
  '/montage': 'Montage',
  '/live-activity': 'Live Activity',
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

/**
 * Map a pathname to the human-readable view name used in entry banners
 * and any other place that wants to refer to the current page in plain
 * language. Returns null for paths that shouldn't emit a banner (the
 * setup flow, transient redirects).
 */
export function viewNameForPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path in SECTION_VIEW_NAMES) return SECTION_VIEW_NAMES[path];

  // Setup-flow paths suppress the banner: they're transient and not "views".
  if (path === '/setup' || path === '/profiles/new') return null;

  if (/^\/monitors\/[^/]+$/.test(path)) return 'Monitor Detail';
  if (/^\/events\/[^/]+$/.test(path)) return 'Event Detail';
  if (/^\/profiles\/[^/]+\/edit$/.test(path)) return 'Profile Form';

  // All-mode deep routes: /all/monitors/:profileId/:id and /all/events/:profileId/:id
  // (see App.tsx's routes) name the same view as their single-mode counterparts,
  // so opening one from a notification or card still fires the entry banner (refs #337).
  if (/^\/all\/monitors\/[^/]+\/[^/]+$/.test(path)) return 'Monitor Detail';
  if (/^\/all\/events\/[^/]+\/[^/]+$/.test(path)) return 'Event Detail';

  return null;
}

/**
 * Which settings bucket (if any) AppLayout's route-memory effect should save
 * `pathname` into, so the app reopens on the last page visited.
 *
 * An aggregate saves to its own bucket rather than being silently dropped:
 * `currentProfile` is null there (useCurrentProfile resolves it to null for
 * any aggregate id), so a guard keyed off `currentProfile?.id` never fired and
 * no page was ever remembered while aggregating (refs #337). Each aggregate
 * remembers its own page: All Servers under the sentinel, a group under its
 * own id. Returns null - meaning "don't save" - for the setup/profile routes,
 * a notification-opened page, or when there is genuinely no profile selected
 * yet.
 *
 * @param aggregateId - The active aggregate's bucket, or null in single mode.
 * @param currentProfileId - The single-mode profile, undefined while
 *   aggregating.
 */
/** Where a profile switch lands when the target remembered nothing usable. */
const SWITCH_FALLBACK_ROUTE = '/monitors';

/**
 * Screens the app can open on, in the order the Settings picker lists them.
 *
 * Views only. Settings, Profiles, Server, Logs and Notifications are places
 * you visit and leave again, and an entity route names something that belongs
 * to one server, so neither makes sense as the screen you land on. Labels
 * reuse the sidebar keys, so a screen reads the same in the picker as in the
 * nav.
 */
export const START_SCREENS = [
  { path: '/dashboard', labelKey: 'sidebar.dashboard' },
  { path: '/monitors', labelKey: 'sidebar.monitors' },
  { path: '/montage', labelKey: 'sidebar.montage' },
  { path: '/live-activity', labelKey: 'sidebar.live_activity' },
  { path: '/events', labelKey: 'sidebar.events' },
  { path: '/timeline', labelKey: 'sidebar.timeline' },
] as const;

/** `startScreen` value meaning "reopen wherever the last session ended". */
export const START_SCREEN_LAST_USED = 'last-used';

/**
 * Where the app opens for a profile, given its `startScreen` preference and
 * the page it last had open.
 *
 * Last-used is the default and the behavior the app has always had, deep
 * routes included: ending a session on monitor 3 reopens monitor 3. A picked
 * screen wins over that, and anything the picker does not offer - a screen
 * since removed, a hand-edited settings blob - falls back to last-used rather
 * than opening a route that renders nothing.
 */
export function resolveStartRoute(
  startScreen: string | undefined,
  lastRoute: string | undefined | null
): string {
  const picked = START_SCREENS.some((screen) => screen.path === startScreen);
  if (picked) return startScreen as string;
  return lastRoute || SWITCH_FALLBACK_ROUTE;
}

/**
 * Where to navigate after switching to a profile or group, given the page that
 * profile last had open (its own `lastRoute` bucket).
 *
 * Every switch used to go to `/monitors` unconditionally, so the page the app
 * already remembers per profile - and reopens on at startup - was thrown away
 * the moment you switched (refs #337).
 *
 * Only section-level routes come back. A remembered `/monitors/3` or
 * `/all/events/:profileId/:id` names an entity on the profile being LEFT:
 * monitor 3 is a different camera on the target server, and an `/all/` route
 * names a profile that need not be in the new scope at all. Kiosk is excluded
 * separately: it is a locked full-screen mode rather than a page, and landing
 * in it straight after a switch would strand the user.
 */
export function resolveSwitchDestination(lastRoute: string | undefined | null): string {
  // '/' is the index redirect, which sends the app to `lastRoute` - returning
  // it here would bounce the switch straight back through itself.
  if (!lastRoute || lastRoute === '/kiosk' || lastRoute === '/') return SWITCH_FALLBACK_ROUTE;
  return lastRoute in SECTION_VIEW_NAMES ? lastRoute : SWITCH_FALLBACK_ROUTE;
}

export function resolveLastRouteSaveTarget(
  pathname: string,
  fromNotification: boolean,
  aggregateId: ProfileId | null,
  currentProfileId: ProfileId | undefined
): ProfileId | null {
  const excludedRoutes = ['/profiles/new', '/setup', '/profiles'];
  if (excludedRoutes.includes(pathname) || fromNotification) return null;
  return aggregateId ?? currentProfileId ?? null;
}
