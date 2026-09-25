/**
 * Heatmap Dashboard Widget
 *
 * Displays event density as a heatmap over a selected time range.
 * Features:
 * - Time range selection (24h, 48h, week, etc.)
 * - Color-coded density visualization
 * - Click to navigate to Events page with time filter
 */

import { useState, useMemo, memo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getEvents } from '../../../api/events';
import { getSession } from '../../../services/sessions';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { useGroupByServerScope } from '../../../hooks/useGroupByServerScope';
import { groupByOwningProfile, type OwnedByProfile } from '../../../lib/profile/profile-sections';
import { ProfileSectionList } from '../../profiles/ProfileSectionList';
import { queryKeys } from '../../../lib/query/query-keys';
import { useBandwidthSettings } from '../../../hooks/useBandwidthSettings';
import { staggeredRefetchInterval } from '../../../lib/query/stagger-interval';
import type { ProfileError } from '../../../api/scoped-types';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Loader2, Activity } from 'lucide-react';
import { EventHeatmap, type TzEvent } from '../../events/EventHeatmap';
import { formatForServer } from '../../../lib/time';
import { EmptyState } from '../../ui/empty-state';
import { ErrorBanner } from '../../ui/query-state';
import { resolveQueryError } from '../../../lib/query/query-error';

interface HeatmapWidgetProps {
  title?: string;
}

type TimeRange = '24h' | '48h' | '7d' | '14d' | '30d';

export const HeatmapWidget = memo(function HeatmapWidget({ title }: HeatmapWidgetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const bandwidth = useBandwidthSettings();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const scope = useProfileScope();
  const profiles = scope?.profiles ?? [];
  const groupScopeId = useGroupByServerScope('eventsGroupByServer');

  // Calculate date range based on selection
  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    const start = new Date();

    switch (timeRange) {
      case '24h':
        start.setHours(start.getHours() - 24);
        break;
      case '48h':
        start.setHours(start.getHours() - 48);
        break;
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '14d':
        start.setDate(start.getDate() - 14);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
    }

    return { startDate: start, endDate: end };
  }, [timeRange]);



  // ... (inside component)

  // One query per profile in scope - single mode's array of one shares the
  // exact key+session the old single query used (byte-identical). All mode
  // merges raw events across profiles for the density visualization, each
  // tagged with its owner so group-by-server can split it per server.
  // Partial-failure tolerant: one profile's error never blanks the heatmap
  // once another profile has data (mirrors useScopedEvents' anyHasData) -
  // but zero data AND at least one error still needs the error branch below
  // (zero-data suppression, same rule Montage.tsx applies for its strip).
  const { events, isLoading, errors } = useQueries({
    queries: profiles.map((p, i) => ({
      queryKey: queryKeys.eventsHeatmap(p.id, timeRange),
      queryFn: () =>
        getEvents(getSession(p.id).client, p.id, {
          startDateTime: formatForServer(startDate),
          endDateTime: formatForServer(endDate),
          limit: 1000,
        }),
      refetchInterval: staggeredRefetchInterval(i, profiles.length, bandwidth.timelineHeatmapInterval),
    })),
    combine: (results) => {
      // Tag each event with its OWNING profile's timezone so EventHeatmap
      // buckets by real chronological instant, not a naive local Date parse
      // of the server wall-clock string (refs #337).
      const events: Array<TzEvent & OwnedByProfile> = [];
      const errors: ProfileError[] = [];
      let anyData = false;
      profiles.forEach((p, i) => {
        const q = results[i];
        if (!q) return;
        if (q.data) {
          anyData = true;
          // The owner rides along for the group-by-server sections below.
          events.push(...q.data.events.map((item) => ({
            item,
            timezone: p.timezone ?? 'UTC',
            profileId: p.id,
            profileChip: p.name,
          })));
        }
        if (q.error) errors.push({ profileId: p.id, profileName: p.name, error: q.error });
      });
      return { events, isLoading: !anyData, errors };
    },
  });

  const handleTimeRangeClick = (start: string, end: string) => {
    // Navigate to events page with time filter
    // URL params for Events page -> The events page logic will need to handle this
    // Users instruction: "ALWAYS call /host/getTimeZone.json... ALWAYS convert to server time zone but ALWAYS display in local timezone"
    // So we should pass the ISO string (local) to the Events page, and it should convert to Server Time when querying API
    // OR we pass server times. 
    // BUT HeatmapWidget -> Events Page uses `startDateTime` param which populates the Inputs.
    // The Inputs are datetime-local. So they expect LOCAL time.
    // So we should pass LOCAL time to URL, and Events page will convert to SERVER time for API.

    // Logic: 
    // Heatmap "Past 24H" -> Local Start/End
    // API Query -> Convert Local to Server Time
    // Click -> Pass Local ISO to URL
    // Events Page -> Init State from URL (Local) taking "2023-10-10T10:00"
    // Events Page API Query -> Convert Input (Local) to Server Time

    const startParam = new Date(start).toISOString(); // Keep standard ISO for URL params (Events page handles parsing)
    const endParam = new Date(end).toISOString();
    navigate(
      `/events?startDateTime=${encodeURIComponent(startParam)}&endDateTime=${encodeURIComponent(endParam)}`,
      { state: { from: location.pathname } }
    );
  };

  const renderHeatmap = (list: TzEvent[]) => (
    <EventHeatmap
      events={list}
      startDate={startDate}
      endDate={endDate}
      onTimeRangeClick={handleTimeRangeClick}
      collapsible={false}
      showCard={false}
    />
  );

  const timeRangeButtons: { value: TimeRange; label: string }[] = [
    { value: '24h', label: t('events.past_24_hours') },
    { value: '48h', label: t('events.past_48_hours') },
    { value: '7d', label: t('events.past_week') },
    { value: '14d', label: t('events.past_2_weeks') },
    { value: '30d', label: t('events.past_month') },
  ];

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            <CardTitle className="text-lg">{title || t('dashboard.widget_heatmap')}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Time range selector */}
        <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
          {timeRangeButtons.map((btn) => (
            <Button
              key={btn.value}
              variant={timeRange === btn.value ? 'default' : 'outline'}
              aria-pressed={timeRange === btn.value}
              size="sm"
              onClick={() => setTimeRange(btn.value)}
              className="text-xs flex-shrink-0"
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {/* Heatmap or loading state */}
        <div className="flex-1 min-h-0 overflow-auto">
          {isLoading && errors.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 && errors.length > 0 ? (
            <ErrorBanner
              message={resolveQueryError(errors[0].error, t)}
              className="mx-4 mt-4"
            />
          ) : events.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={t('events.no_events')}
              className="text-center py-12 text-muted-foreground"
            />
          ) : groupScopeId ? (
            <ProfileSectionList
              sections={groupByOwningProfile(events)}
              surface="dashboard-heatmap-group"
              scopeId={groupScopeId}
              className="space-y-4"
              renderItems={renderHeatmap}
            />
          ) : (
            renderHeatmap(events)
          )}
        </div>
      </CardContent>
    </Card>
  );
});
