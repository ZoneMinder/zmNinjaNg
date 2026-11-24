/**
 * Event Poller Service
 *
 * Polls the ZM events API for new events in Direct notification mode on desktop (Electron) and web.
 * New events are fed into the notification store, which triggers the existing
 * sonner toast display via NotificationHandler.
 *
 * The poller has no zustand imports. Store-derived values (event sink, auth
 * token, poll interval, portal URL) are injected via EventPollerDeps, which
 * `startEventPoller` in stores/notifications.ts assembles.
 */

import { getEvents, getEventImageUrl } from '../api/events';
import type { EventFilters } from '../api/events';
import { getMonitors } from '../api/monitors';
import { getPortalUrlForEvent } from '../lib/zm/server-resolver';
import { NOTIFICATIONS_SERVICE } from '../lib/zmninja-ng-constants';
import type { ZMAlarmEvent } from '../types/notifications';
import { log, LogLevel } from '../lib/logger';
import { getSession } from './sessions';
import { asProfileId } from '../api/types';

/**
 * Store-derived values injected into the poller at start time.
 */
export interface EventPollerDeps {
  /** Receives each newly detected event (the caller assigns profile and source). */
  onEvent: (event: ZMAlarmEvent) => void;
  /** Notification setting: restrict polling to object-detection events. */
  getOnlyDetectedEvents: () => boolean;
  /** Returns a fresh ZM access token for image URLs, or null when unavailable. */
  getFreshAccessToken: () => Promise<string | null>;
  /** Poll interval in milliseconds (bandwidth-mode aware). */
  getPollIntervalMs: () => number;
  /** Portal URL of the connected profile, or undefined when unavailable. */
  getPortalUrl: () => string | undefined;
  /** Effective multi-port streaming base port, or undefined when disabled. */
  getMinStreamingPort: () => number | undefined;
}

function parseEventId(id: string | number): number {
  return parseInt(String(id), 10);
}

/**
 * Poller run-state is observable so UI can react to it: the notification
 * settings badge subscribes here instead of reading isRunning() during
 * render, which never re-ran when a poller started or stopped.
 */
const pollerChangeListeners = new Set<() => void>();

function notifyPollerChange(): void {
  for (const listener of pollerChangeListeners) listener();
}

/** Subscribe to any poller starting or stopping. Returns an unsubscribe. */
export function subscribeEventPollers(listener: () => void): () => void {
  pollerChangeListeners.add(listener);
  return () => {
    pollerChangeListeners.delete(listener);
  };
}

/**
 * Whether this profile's poller is running. Unlike
 * `getEventPoller(id).isRunning()`, this never creates a registry entry for
 * a profile that has never polled.
 */
export function isEventPollerRunning(profileId: string): boolean {
  return eventPollers.get(profileId)?.isRunning() ?? false;
}

class EventPollerService {
  private running = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private profileId: string | null = null;
  private deps: EventPollerDeps | null = null;
  private seenEventIds = new Set<number>();
  private isFirstPoll = true;
  private monitorNames = new Map<string, string>();
  private monitorData: Array<{ Monitor: { Id: string; ServerId: string | null } }> = [];
  /** In-flight name reload, so a burst of unknown ids triggers one fetch. */
  private namesReloadPromise: Promise<void> | null = null;
  /** Earliest epoch ms at which another reload may run. */
  private namesReloadAfter = 0;

  /**
   * Start polling for new events.
   * Loads monitor names first, then begins the poll cycle.
   */
  async start(profileId: string, deps: EventPollerDeps): Promise<void> {
    // Idempotent for the same profile: a duplicate start() call is a no-op
    // rather than a stop/restart. A different profile *does* tear down and
    // re-init.
    if (this.timerId && this.profileId === profileId) {
      log.notifications('Event poller already running: skipping duplicate start', LogLevel.DEBUG, { profileId });
      return;
    }
    if (this.timerId) {
      this.stop();
    }

    this.profileId = profileId;
    this.deps = deps;
    this.seenEventIds.clear();
    this.isFirstPoll = true;
    // Running from here, not from the first timer: start() awaits the monitor
    // load and the first poll, and a UI reading timerId in that window showed
    // "not running" for a poller that was already working.
    this.running = true;
    notifyPollerChange();

    log.notifications('Starting event poller for direct mode', LogLevel.INFO, { profileId });

    // Load monitor names before first poll so events have real names
    await this._loadMonitorNames();
    this._pollAndSchedule();
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.profileId = null;
    this.deps = null;
    this.seenEventIds.clear();
    this.isFirstPoll = true;
    this.monitorNames.clear();
    this.monitorData = [];
    this.namesReloadPromise = null;
    this.namesReloadAfter = 0;
    this.running = false;
    notifyPollerChange();

    log.notifications('Stopped event poller', LogLevel.INFO);
  }

  /**
   * Check if the poller is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  private async _loadMonitorNames(): Promise<void> {
    if (!this.profileId) return;
    try {
      const result = await getMonitors(getSession(asProfileId(this.profileId)).client, asProfileId(this.profileId));
      this.monitorNames.clear();
      this.monitorData = result.monitors.map((m) => ({
        Monitor: { Id: m.Monitor.Id, ServerId: m.Monitor.ServerId ?? null },
      }));
      for (const m of result.monitors) {
        this.monitorNames.set(m.Monitor.Id, m.Monitor.Name);
      }
      log.notifications('Event poller loaded monitor names', LogLevel.DEBUG, {
        count: this.monitorNames.size,
      });
    } catch (error) {
      log.notifications('Event poller failed to load monitor names', LogLevel.WARN, error);
    }
  }

  /**
   * Reload the name map when an event names a monitor we have never heard of.
   *
   * The initial load runs while the profile is still bootstrapping and can
   * lose a race with authentication: a profile switch deliberately suppresses
   * re-login while it is in flight, so `getMonitors` fails and the map is left
   * empty. Nothing retried it, so every notification for the rest of the
   * session fell back to "Monitor 4" instead of the camera's name.
   *
   * Debounced, because an unknown id is not always a stale map: a monitor
   * deleted since the last load will never resolve, and that must not refetch
   * the whole monitor list on every poll. A miss also leaves the existing
   * names intact, since `_loadMonitorNames` only clears the map once the new
   * response is in hand.
   */
  private async _ensureMonitorName(monitorId: string): Promise<void> {
    if (this.monitorNames.has(monitorId)) return;

    const now = Date.now();
    if (!this.namesReloadPromise) {
      if (now < this.namesReloadAfter) return;
      this.namesReloadAfter = now + NOTIFICATIONS_SERVICE.monitorNamesReloadMs;
      this.namesReloadPromise = this._loadMonitorNames().finally(() => {
        this.namesReloadPromise = null;
      });
    }
    await this.namesReloadPromise;
  }

  private _pollAndSchedule(): void {
    if (!this.profileId) return;

    this._poll().finally(() => {
      // Schedule next poll only if still running (not stopped during _poll)
      if (this.profileId && this.deps) {
        this.timerId = setTimeout(() => this._pollAndSchedule(), this.deps.getPollIntervalMs());
      }
    });
  }

  private async _poll(): Promise<void> {
    const deps = this.deps;
    if (!this.profileId || !deps) return;

    try {
      const filters: EventFilters = {
        limit: 5,
        sort: 'StartDateTime',
        direction: 'desc',
      };
      if (deps.getOnlyDetectedEvents()) {
        filters.notesRegexp = 'detected:';
      }

      const result = await getEvents(getSession(asProfileId(this.profileId)).client, asProfileId(this.profileId), filters);
      const events = result.events || [];

      if (this.isFirstPoll) {
        // Seed the seen set without triggering notifications
        for (const event of events) {
          this.seenEventIds.add(parseEventId(event.Event.Id));
        }
        this.isFirstPoll = false;
        log.notifications('Event poller seeded with existing events', LogLevel.DEBUG, {
          count: events.length,
        });
        return;
      }

      const portalUrl = deps.getPortalUrl();
      const accessToken = await deps.getFreshAccessToken();

      for (const event of events) {
        const eventId = parseEventId(event.Event.Id);
        if (this.seenEventIds.has(eventId)) continue;

        this.seenEventIds.add(eventId);

        const monitorId = parseEventId(event.Event.MonitorId);
        // A name we have never seen usually means the startup load lost its
        // race with auth, not that the monitor is unknown. Try once more
        // before falling back to a bare id in the notification title.
        await this._ensureMonitorName(String(event.Event.MonitorId));
        const monitorName = this.monitorNames.get(String(event.Event.MonitorId)) || `Monitor ${monitorId}`;
        const cause = event.Event.Cause || 'Motion';

        const eventPortalUrl = portalUrl
          ? getPortalUrlForEvent(
              String(event.Event.MonitorId),
              this.monitorData,
              portalUrl,
              asProfileId(this.profileId),
            )
          : undefined;
        const imageUrl = eventPortalUrl && accessToken
          ? getEventImageUrl(eventPortalUrl, String(eventId), 'snapshot', {
              token: accessToken,
              width: NOTIFICATIONS_SERVICE.snapshotImageWidth,
              minStreamingPort: deps.getMinStreamingPort(),
              monitorId: String(event.Event.MonitorId),
            })
          : undefined;

        log.notifications('Event poller found new event', LogLevel.INFO, {
          eventId, monitorName, cause,
        });

        deps.onEvent({
          MonitorId: monitorId,
          MonitorName: monitorName,
          EventId: eventId,
          Cause: cause,
          Name: monitorName,
          Notes: event.Event.Notes || undefined,
          ImageUrl: imageUrl,
        });
      }

      // Prevent unbounded growth of seen set
      if (this.seenEventIds.size > 500) {
        this.seenEventIds = new Set(events.map(e => parseEventId(e.Event.Id)));
      }
    } catch (error) {
      // Non-blocking: the next scheduled poll retries
      log.notifications('Event poller failed', LogLevel.WARN, error);
    }
  }
}

// Per-profile registry: every profile can run its own poller (refs #337).
const eventPollers = new Map<string, EventPollerService>();

export function getEventPoller(profileId: string): EventPollerService {
  let poller = eventPollers.get(profileId);
  if (!poller) {
    poller = new EventPollerService();
    eventPollers.set(profileId, poller);
  }
  return poller;
}

/** Stop every running poller. Used on full logout (refs #337). */
export function stopAllEventPollers(): void {
  for (const poller of eventPollers.values()) {
    poller.stop();
  }
  eventPollers.clear();
}

/**
 * Stop and evict this profile's poller. A no-op if it never had one -
 * unlike `getEventPoller(id).stop()`, this never creates a phantom registry
 * entry just to immediately stop a poller that was never started, which
 * would otherwise orphan a never-referenced instance in the map on every
 * teardown of a profile that only ever used ES mode (refs #337 I5).
 */
export function stopEventPoller(profileId: string): void {
  const poller = eventPollers.get(profileId);
  if (poller) {
    poller.stop();
    eventPollers.delete(profileId);
  }
}
