/**
 * Event Poller Service
 *
 * Polls the ZM events API for new events in Direct notification mode on desktop (Tauri).
 * New events are fed into the notification store, which triggers the existing
 * sonner toast display via NotificationHandler.
 */

import { getEvents, getEventImageUrl } from '../api/events';
import type { EventFilters } from '../api/events';
import { getMonitors } from '../api/monitors';
import { getPortalUrlForEvent } from '../lib/server-resolver';
import { useNotificationStore } from '../stores/notifications';
import { useProfileStore } from '../stores/profile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { getBandwidthSettings } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

function parseEventId(id: string | number): number {
  return parseInt(String(id), 10);
}

class EventPollerService {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private profileId: string | null = null;
  private seenEventIds = new Set<number>();
  private isFirstPoll = true;
  private monitorNames = new Map<string, string>();
  private monitorData: Array<{ Monitor: { Id: string; ServerId: string | null } }> = [];

  /**
   * Start polling for new events.
   * Loads monitor names first, then begins the poll cycle.
   */
  async start(profileId: string): Promise<void> {
    // Idempotent for the same profile: a duplicate start() call is a no-op
    // rather than a stop/restart. A different profile *does* tear down and
    // re-init.
    if (this.timerId && this.profileId === profileId) {
      log.notifications('Event poller already running — skipping duplicate start', LogLevel.DEBUG, { profileId });
      return;
    }
    if (this.timerId) {
      this.stop();
    }

    this.profileId = profileId;
    this.seenEventIds.clear();
    this.isFirstPoll = true;

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
    this.seenEventIds.clear();
    this.isFirstPoll = true;
    this.monitorNames.clear();
    this.monitorData = [];

    log.notifications('Stopped event poller', LogLevel.INFO);
  }

  /**
   * Check if the poller is running.
   */
  isRunning(): boolean {
    return this.timerId !== null;
  }

  private async _loadMonitorNames(): Promise<void> {
    try {
      const result = await getMonitors();
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

  private _getIntervalMs(): number {
    if (!this.profileId) return 30000;
    const profileSettings = useSettingsStore.getState().getProfileSettings(this.profileId);
    const bandwidth = getBandwidthSettings(profileSettings.bandwidthMode);
    return bandwidth.eventPollerInterval;
  }

  private _pollAndSchedule(): void {
    if (!this.profileId) return;

    this._poll().finally(() => {
      // Schedule next poll only if still running (not stopped during _poll)
      if (this.profileId) {
        this.timerId = setTimeout(() => this._pollAndSchedule(), this._getIntervalMs());
      }
    });
  }

  private async _poll(): Promise<void> {
    if (!this.profileId) return;

    try {
      const settings = useNotificationStore.getState().getProfileSettings(this.profileId);
      const filters: EventFilters = {
        limit: 5,
        sort: 'StartDateTime',
        direction: 'desc',
      };
      if (settings.onlyDetectedEvents) {
        filters.notesRegexp = 'detected:';
      }

      const result = await getEvents(filters);
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

      const notificationStore = useNotificationStore.getState();
      const { profiles, currentProfileId } = useProfileStore.getState();
      const currentProfile = profiles.find(p => p.id === currentProfileId);
      const accessToken = useAuthStore.getState().accessToken;

      for (const event of events) {
        const eventId = parseEventId(event.Event.Id);
        if (this.seenEventIds.has(eventId)) continue;

        this.seenEventIds.add(eventId);

        const monitorId = parseEventId(event.Event.MonitorId);
        const monitorName = this.monitorNames.get(String(event.Event.MonitorId)) || `Monitor ${monitorId}`;
        const cause = event.Event.Cause || 'Motion';

        const eventPortalUrl = currentProfile
          ? getPortalUrlForEvent(String(event.Event.MonitorId), this.monitorData, currentProfile.portalUrl)
          : undefined;
        const imageUrl = eventPortalUrl && accessToken
          ? getEventImageUrl(eventPortalUrl, String(eventId), 'snapshot', {
              token: accessToken,
              width: 600,
              minStreamingPort: currentProfile?.minStreamingPort,
              monitorId: String(event.Event.MonitorId),
            })
          : undefined;

        log.notifications('Event poller found new event', LogLevel.INFO, {
          eventId, monitorName, cause,
        });

        notificationStore.addEvent(this.profileId, {
          MonitorId: monitorId,
          MonitorName: monitorName,
          EventId: eventId,
          Cause: cause,
          Name: monitorName,
          Notes: event.Event.Notes || undefined,
          ImageUrl: imageUrl,
        }, 'poll');
      }

      // Prevent unbounded growth of seen set
      if (this.seenEventIds.size > 500) {
        this.seenEventIds = new Set(events.map(e => parseEventId(e.Event.Id)));
      }
    } catch (error) {
      log.notifications('Event poller failed', LogLevel.ERROR, error);
    }
  }
}

// Singleton
let eventPoller: EventPollerService | null = null;

export function getEventPoller(): EventPollerService {
  if (!eventPoller) {
    eventPoller = new EventPollerService();
  }
  return eventPoller;
}
