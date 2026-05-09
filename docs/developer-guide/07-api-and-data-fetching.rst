API and Data Fetching
=====================

How zmNinjaNg talks to ZoneMinder's REST API and manages server data.

ZoneMinder API
--------------

Base URL: ``https://your-server.com/zm/api/<endpoint>``

Endpoint Reference
~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 10 40 30 20

   * - Method
     - Endpoint
     - Description
     - Module
   * - POST
     - ``/host/login.json``
     - Authenticate and receive tokens
     - ``auth.ts``
   * - GET
     - ``/host/getVersion.json``
     - Server version info
     - ``auth.ts``
   * - GET
     - ``/monitors.json``
     - List all monitors with status
     - ``monitors.ts``
   * - GET
     - ``/monitors/<id>.json``
     - Single monitor details
     - ``monitors.ts``
   * - POST
     - ``/monitors/<id>.json``
     - Update monitor settings
     - ``monitors.ts``
   * - GET
     - ``/controls/<controlId>.json``
     - PTZ control definition
     - ``monitors.ts``
   * - GET
     - ``/monitors/alarm/id:<id>/command:<cmd>.json``
     - Trigger/cancel/query alarm (cmd: on, off, status)
     - ``monitors.ts``
   * - GET
     - ``/monitors/daemonStatus/id:<id>/daemon:<daemon>.json``
     - Check daemon status for a monitor
     - ``monitors.ts``
   * - GET
     - ``/events/index.json``
     - List events (with query params)
     - ``events.ts``
   * - GET
     - ``/events/index/<filterPath>.json``
     - List events with URL-based filters
     - ``events.ts``
   * - GET
     - ``/events/<id>.json``
     - Single event details
     - ``events.ts``
   * - PUT
     - ``/events/<id>.json``
     - Update event metadata
     - ``events.ts``
   * - DELETE
     - ``/events/<id>.json``
     - Delete an event
     - ``events.ts``
   * - GET
     - ``/events/consoleEvents/<interval>.json``
     - Event counts per monitor for a time interval
     - ``events.ts``
   * - GET
     - ``/servers.json``
     - List ZoneMinder servers
     - ``server.ts``
   * - GET
     - ``/host/daemonCheck.json``
     - Check if ZoneMinder daemon is running
     - ``server.ts``
   * - GET
     - ``/host/getLoad.json``
     - Server CPU load
     - ``server.ts``
   * - GET
     - ``/host/getDiskPercent.json``
     - Disk usage percentage
     - ``server.ts``
   * - GET
     - ``/host/getTimeZone.json``
     - Server timezone
     - ``time.ts``
   * - GET
     - ``/configs.json``
     - All ZoneMinder config entries
     - ``server.ts``
   * - GET
     - ``/configs/viewByName/<key>.json``
     - Single config value (ZM_PATH_ZMS, ZM_GO2RTC_PATH, ZM_MIN_STREAMING_PORT)
     - ``server.ts``
   * - GET
     - ``/groups.json``
     - List monitor groups
     - ``groups.ts``
   * - GET
     - ``/states.json``
     - List run states
     - ``states.ts``
   * - POST
     - ``/states/change/<stateName>.json``
     - Switch to a run state
     - ``states.ts``
   * - GET
     - ``/notifications.json``
     - List push notification registrations
     - ``notifications.ts``
   * - POST
     - ``/notifications.json``
     - Register for push notifications
     - ``notifications.ts``
   * - PUT
     - ``/notifications/<id>.json``
     - Update a notification registration
     - ``notifications.ts``
   * - DELETE
     - ``/notifications/<id>.json``
     - Remove a notification registration
     - ``notifications.ts``
   * - GET
     - ``/tags.json``
     - List all tags
     - ``tags.ts``
   * - GET
     - ``/tags/index/Events.Id:<ids>.json``
     - Tags for specific events
     - ``tags.ts``
   * - GET
     - ``/zones.json?MonitorId=<id>``
     - Zones for a monitor
     - ``zones.ts``
   * - GET
     - ``/logs.json``
     - List server logs
     - ``logs.ts``
   * - GET
     - ``/logs/index/<filterPath>.json``
     - Filtered server logs
     - ``logs.ts``

Authentication
~~~~~~~~~~~~~~

Token-based: POST credentials to ``/host/login.json``, receive an
access and refresh token, send the access token on subsequent
requests, refresh when it expires.

**Implementation** (``src/api/auth.ts``):

.. code:: tsx

   import { getApiClient } from './client';
   import { LoginResponseSchema, type LoginCredentials, type LoginResponse } from './types';

   export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
     const client = getApiClient();

     // ZoneMinder expects form-encoded data for login
     const formData = new URLSearchParams();
     formData.append('user', credentials.user);
     formData.append('pass', credentials.pass);

     const response = await client.post<LoginResponse>(
       '/host/login.json',
       formData.toString(),
       { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
     );

     // Validate response shape with Zod
     return LoginResponseSchema.parse(response.data);
   }

The returned ``LoginResponse`` carries ``access_token``,
``access_token_expires`` (seconds), ``refresh_token``, and
``refresh_token_expires``. The auth store converts the *_expires* fields to
absolute ms-epoch deadlines before persisting. All HTTP goes through
``getApiClient()`` from ``api/client.ts`` (CapacitorHttp on native, Axios on
web), never raw ``fetch()``.

Tokens are stored encrypted in ``SecureStorage``:

.. code:: tsx

   await SecureStorage.set(`auth_tokens_${profileId}`, JSON.stringify(tokens));

Proactive Authentication
^^^^^^^^^^^^^^^^^^^^^^^^

Profiles rehydrate from localStorage at startup, but login takes a
few seconds. To avoid 401s, ``createApiClient`` (``src/api/client.ts``)
checks for an access token before any non-login request, triggers login
first, then retries the original request:

.. code:: typescript

   // Before making HTTP request
   if (!accessToken && !skipAuth && !isLoginRequest && reLogin && !hasRetried) {
     // Trigger login first
     const loginSuccess = await reLogin();

     if (!loginSuccess) {
       throw new Error('Authentication required but login failed');
     }

     // Retry original request with token
     return request(method, url, data, config, true);
   }

**Concurrent requests** share the same login promise so login only
runs once:

.. code:: typescript

   let loginInProgress = false;
   let loginPromise: Promise<boolean> | null = null;

   if (loginInProgress && loginPromise) {
     // Wait for ongoing login
     loginSuccess = await loginPromise;
   } else {
     // Start new login
     loginInProgress = true;
     loginPromise = reLogin();
     // ...
   }

**Reactive 401 handling.** If a request still returns 401 (e.g.
token expired mid-flight), the client refreshes the token and retries
once:

.. code:: typescript

   catch (error) {
     if (httpError.status === 401 && !hasRetried && !skipAuth && !isLoginRequest) {
       // Try refresh token
       await refreshAccessToken();
       return request(method, url, data, config, true); // hasRetried=true prevents loops
     }
   }

``hasRetried`` ensures each request attempts auth only once.

Connection Keys (connkey)
~~~~~~~~~~~~~~~~~~~~~~~~~

Streaming URLs use connection keys instead of tokens. Connkeys are
short-lived auth keys for media streams, appended to stream URLs and
expiring server-side after a configured period.

**Generation** (``src/stores/monitors.ts``):

Connection keys are generated and managed by the monitors store.
``regenerateConnKey(monitorId)`` produces a new random key for a given
monitor and stores it in ``connKeys``. The ``useMonitorStream`` hook
calls this when a stream needs a new key.

.. code:: tsx

   // From stores/monitors.ts
   regenerateConnKey: (monitorId: string) => {
     const newKey = Math.floor(Math.random() * 100000);
     set((state) => ({
       connKeys: { ...state.connKeys, [monitorId]: newKey },
     }));
     return newKey;
   }

**Usage in stream URLs:**

.. code:: tsx

   const streamUrl = `${portalUrl}/cgi-bin/nph-zms?mode=jpeg&monitor=${monitorId}&connkey=${connkey}`;

**Persistence:**

Connection keys are stored in the Zustand monitors store (persisted via
``localStorage``). ``getConnKey(monitorId)`` returns the existing key if
one is already stored, or generates a new one. ``regenerateConnKey``
always creates a fresh key (used on stream failure).

Streaming Mechanics
~~~~~~~~~~~~~~~~~~~

1. Cache busting (``_t``)
^^^^^^^^^^^^^^^^^^^^^^^^^

Browsers cache image URLs aggressively. In ``mode=single`` (snapshot)
or after a stream reconnects, the same URL would yield a stale frame.
``src/lib/url-builder.ts`` appends a ``_t=<timestamp>`` cache buster:

::

   /cgi-bin/nph-zms?mode=jpeg&monitor=1&token=xyz&_t=1704358000000

2. Multi-port streaming
^^^^^^^^^^^^^^^^^^^^^^^

Browsers cap concurrent connections per origin (typically 6). With
``minStreamingPort`` set (e.g. 30000) in the profile, each monitor
loads from a different port, monitor 1 from 30001, monitor 2 from
30002, and so on. Different ports are treated as different origins, so
the per-origin limit doesn't apply.

3. Streaming vs snapshot
^^^^^^^^^^^^^^^^^^^^^^^^

- **Streaming** (``mode=jpeg``), long-lived MJPEG connection. Low
  latency, high bandwidth, holds an HTTP slot.
- **Snapshot** (``mode=single``), single JPEG fetched every
  ``snapshotRefreshInterval`` seconds. Lower resource use, lower
  frame rate.

In snapshot mode, ``useMonitorStream`` preloads the next frame via
``Image()`` and swaps ``src`` only after it's decoded, avoiding
flicker.

React Query
-----------

Server state is managed via ``@tanstack/react-query``. See the
`TanStack Query docs <https://tanstack.com/query/latest>`_ for general
behaviour. zmNinjaNg-specific notes follow.

zmNinjaNg runs with ``staleTime: 0``, so React Query's "cache" is
effectively last-response storage rather than a hit/miss cache,
``refetchInterval`` always hits the server, but stored data prevents
loading spinners between polls and deduplicates concurrent subscribers.

Key Settings
~~~~~~~~~~~~

+---------------------+------------------------+---------------------------+
| Setting             | zmNinjaNg Value        | What It Does              |
+=====================+========================+===========================+
| ``staleTime``       | ``0`` (default)        | How long data is “fresh”. |
|                     |                        | At 0, data is immediately |
|                     |                        | stale, so any new         |
|                     |                        | subscriber triggers a     |
|                     |                        | background refetch.       |
+---------------------+------------------------+---------------------------+
| ``gcTime``          | ``5 min`` (default)    | How long unused data      |
|                     |                        | stays in memory. After 5  |
|                     |                        | min with no subscribers,  |
|                     |                        | data is garbage           |
|                     |                        | collected.                |
+---------------------+------------------------+---------------------------+
| ``refetchInterval`` | varies                 | **Always makes a network  |
|                     |                        | request** at this         |
|                     |                        | interval. Not cached.     |
+---------------------+------------------------+---------------------------+

``refetchOnWindowFocus`` is disabled globally; the client otherwise
behaves per the TanStack defaults.

Example: Monitor Polling
^^^^^^^^^^^^^^^^^^^^^^^^

.. code:: tsx

   // useMonitors.ts
   const { data } = useQuery({
     queryKey: ['monitors', currentProfile?.id],
     queryFn: getMonitors,
     refetchInterval: bandwidth.monitorStatusInterval,  // 20-40 sec
   });

Every 20-40 seconds, this makes a real network request to
``/monitors.json``. Between polls, any component using ``useMonitors()``
gets the stored response instantly without a new request.

Query Client Setup
~~~~~~~~~~~~~~~~~~

**Location**: ``src/App.tsx``

.. code:: tsx

   import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

   const queryClient = new QueryClient({
     defaultOptions: {
       queries: {
         retry: 1,                      // Single retry on failure
         refetchOnWindowFocus: false,   // Don't refetch when window focused
         // staleTime: 0 (default)      // Data immediately stale
         // gcTime: 5 min (default)     // Unused data kept 5 min
       },
     },
   });

With ``staleTime: 0``, every query subscriber triggers a fetch. The
HTTP layer (``lib/http.ts``) logs every call with a correlation ID;
there are no skipped-network "cache hits" to log separately.

Basic Queries
~~~~~~~~~~~~~

**Fetching monitors:**

.. code:: tsx

   function MonitorList() {
     const { currentProfile } = useCurrentProfile();
     const bandwidth = useBandwidthSettings();

     const { data, isLoading, error, refetch } = useQuery({
       queryKey: ['monitors', currentProfile?.id],
       queryFn: getMonitors,
       enabled: !!currentProfile,
       refetchInterval: bandwidth.monitorStatusInterval,  // 20-40 sec polling
     });

     if (isLoading) return <Skeleton />;
     if (error) return <ErrorDisplay error={error} onRetry={refetch} />;
     if (!data) return null;

     return (
       <div>
         {data.monitors.map(m => <MonitorCard key={m.Monitor.Id} monitor={m} />)}
       </div>
     );
   }

**Query key structure:**

.. code:: tsx

   ['monitors']                    // All monitors
   ['monitors', profileId]         // Monitors for specific profile
   ['monitor', monitorId]          // Single monitor
   ['events', profileId]           // Events for profile
   ['events', profileId, filters]  // Filtered events
   ['groups', profileId]           // Monitor groups for profile

Query keys are used for:

- Caching (same key = same cache entry)
- Invalidation (clear specific cached data)
- Deduplication (prevent duplicate requests)

Dependent Queries
~~~~~~~~~~~~~~~~~

Sometimes one query depends on another’s result:

.. code:: tsx

   function MonitorStream({ monitorId }: { monitorId: string }) {
     const { currentProfile } = useCurrentProfile();

     // First query: Get monitor data
     const { data: monitor } = useQuery({
       queryKey: ['monitor', monitorId],
       queryFn: () => fetchMonitor(monitorId),
     });

     // Second query: Only run if monitor exists
     const { data: streamUrl } = useQuery({
       queryKey: ['stream', monitorId, currentProfile?.id],
       queryFn: () => generateStreamUrl(currentProfile!.id, monitorId),
       enabled: !!monitor && !!currentProfile,  // Wait for monitor to load
     });

     return streamUrl ? <VideoPlayer src={streamUrl} /> : <Spinner />;
   }

Polling / Auto-Refetch
~~~~~~~~~~~~~~~~~~~~~~

Keep data fresh with automatic refetching:

.. code:: tsx

   const { data } = useQuery({
     queryKey: ['monitors', profileId],
     queryFn: () => fetchMonitors(profileId),
     refetchInterval: 30000,  // Refetch every 30 seconds
     refetchIntervalInBackground: false,  // Stop when app in background
   });

Timers and Polling
~~~~~~~~~~~~~~~~~~

App-level timers
^^^^^^^^^^^^^^^^

- **Token refresh** (``hooks/useTokenRefresh.ts``), every 60 s; if the
  access token expires within 30 min, refresh it.
- **WebSocket keepalive** (``services/notifications.ts``), every 60 s;
  sends a version-request ping. On disconnect, reconnects with
  exponential backoff.

**Token Refresh Implementation:**

.. code:: tsx

   // hooks/useTokenRefresh.ts
   export function useTokenRefresh(): void {
     const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
     const accessTokenExpires = useAuthStore((state) => state.accessTokenExpires);
     const refreshAccessToken = useAuthStore((state) => state.refreshAccessToken);

     useEffect(() => {
       if (!isAuthenticated) return;

       const checkAndRefresh = async () => {
         if (accessTokenExpires) {
           const timeUntilExpiry = accessTokenExpires - Date.now();
           // Refresh once we're within accessTokenLeewayMs (30 min) of expiry
           if (timeUntilExpiry < ZM_INTEGRATION.accessTokenLeewayMs && timeUntilExpiry > 0) {
             await refreshAccessToken();
           }
         }
       };

       checkAndRefresh();
       const interval = setInterval(checkAndRefresh, ZM_INTEGRATION.tokenCheckInterval);
       return () => clearInterval(interval);
     }, [isAuthenticated, accessTokenExpires, refreshAccessToken]);
   }

Screen-specific timers
^^^^^^^^^^^^^^^^^^^^^^

**Monitors** (``pages/Monitors.tsx``), event counts refresh every 60 s:

.. code:: tsx

   const { data: eventCounts } = useQuery({
     queryKey: ['consoleEvents', '24 hour'],
     queryFn: () => getConsoleEvents('24 hour'),
     refetchInterval: 60000,
   });

**Monitor Detail** (``pages/MonitorDetail.tsx``), alarm status polls
every 5 s; monitor cycling on a user-configured interval.

.. code:: tsx

   const { data: alarmStatus } = useQuery({
     queryKey: ['monitor-alarm-status', monitor?.Monitor.Id],
     queryFn: () => getAlarmStatus(monitor!.Monitor.Id),
     refetchInterval: 5000,
     refetchIntervalInBackground: true,
   });

   // Monitor cycling (if enabled)
   useEffect(() => {
     const cycleSeconds = settings.monitorDetailCycleSeconds;
     if (!cycleSeconds || cycleSeconds <= 0) return;
     
     const intervalId = window.setInterval(() => {
       // Navigate to next monitor
     }, cycleSeconds * 1000);
     
     return () => window.clearInterval(intervalId);
   }, [settings.monitorDetailCycleSeconds]);

**Montage** (``pages/Montage.tsx`` + ``MontageMonitor.tsx``), snapshot
mode reloads each image at ``snapshotRefreshInterval`` seconds; no
timer in streaming mode.

.. code:: tsx

   // hooks/useMonitorStream.ts - Used by montage monitors
   useEffect(() => {
     if (settings.viewMode !== 'snapshot') return;

     const interval = setInterval(() => {
       setCacheBuster(Date.now());  // Forces image reload
     }, settings.snapshotRefreshInterval * 1000);

     return () => clearInterval(interval);
   }, [settings.viewMode, settings.snapshotRefreshInterval]);

**Server** (``pages/Server.tsx``), daemon-status check every 30 s:

.. code:: tsx

   const { data: isDaemonRunning } = useQuery({
     queryKey: ['daemon-check', currentProfile?.id],
     queryFn: getDaemonCheck,
     refetchInterval: 30000,
   });

Dashboard widget timers
^^^^^^^^^^^^^^^^^^^^^^^

- **EventsWidget**: events refetch every 30 s (default, configurable
  via prop).
- **TimelineWidget** / **HeatmapWidget**: events refetch every 60 s.
- **MonitorWidget**: snapshot reload at ``snapshotRefreshInterval``
  in snapshot mode; no timer in streaming mode.

Configuration Constants
^^^^^^^^^^^^^^^^^^^^^^^

Static defaults are defined in ``lib/zmninja-ng-constants.ts``:

.. code:: tsx

   export const ZM_INTEGRATION = {
     // API timeouts
     httpTimeout: 10000,              // 10 sec - standard API calls
     streamMaxFps: 10,                // Max FPS for live monitor streams

     // Token management
     tokenCheckInterval: 60 * 1000,        // 60 sec - poll cadence for expiry check
     accessTokenLeewayMs: 30 * 60 * 1000,  // 30 min - refresh once within this window of expiry
     loginInterval: 1800000,               // 30 min - re-login interval
   } as const;

Bandwidth Mode Settings
^^^^^^^^^^^^^^^^^^^^^^^

Most polling intervals are controlled by the user’s **bandwidth mode**
setting (Normal or Low). This allows users to reduce network usage on
metered connections.

**Configuration** (``lib/zmninja-ng-constants.ts``):

.. code:: tsx

   export const BANDWIDTH_SETTINGS: Record<BandwidthMode, BandwidthSettings> = {
     normal: {
       monitorStatusInterval: 20000,   // 20 sec
       alarmStatusInterval: 5000,      // 5 sec
       snapshotRefreshInterval: 3,     // 3 sec
       eventsWidgetInterval: 30000,    // 30 sec
       timelineHeatmapInterval: 60000, // 60 sec
       consoleEventsInterval: 60000,   // 60 sec
       daemonCheckInterval: 30000,     // 30 sec
       imageScale: 100,                // 100%
       imageQuality: 100,              // 100%
       streamMaxFps: 10,               // 10 FPS
     },
     low: {
       monitorStatusInterval: 40000,   // 40 sec
       alarmStatusInterval: 10000,     // 10 sec
       snapshotRefreshInterval: 10,    // 10 sec
       eventsWidgetInterval: 60000,    // 60 sec
       timelineHeatmapInterval: 120000,// 120 sec
       consoleEventsInterval: 60000,   // 60 sec
       daemonCheckInterval: 60000,     // 60 sec
       imageScale: 50,                 // 50%
       imageQuality: 50,               // 50%
       streamMaxFps: 5,                // 5 FPS
     },
   };

**Accessing bandwidth settings** (``hooks/useBandwidthSettings.ts``):

.. code:: tsx

   import { useBandwidthSettings } from '../hooks/useBandwidthSettings';

   function MyComponent() {
     const bandwidth = useBandwidthSettings();

     const { data } = useQuery({
       queryKey: ['monitors'],
       queryFn: getMonitors,
       refetchInterval: bandwidth.monitorStatusInterval,
     });
   }

Components should use ``useBandwidthSettings()`` instead of hardcoded
intervals for any polling that affects network usage.

**What uses bandwidth settings:**

+------------------+-----------------------------+------------+-------+------------------+
| Feature          | Property                    | Normal     | Low   | Where Used       |
+==================+=============================+============+=======+==================+
| Monitor status   | ``monitorStatusInterval``   | 20s        | 40s   | Monitors,        |
| polling          |                             |            |       | Montage pages    |
+------------------+-----------------------------+------------+-------+------------------+
| Alarm state      | ``alarmStatusInterval``     | 5s         | 10s   | useAlarmControl  |
| checking         |                             |            |       | hook             |
+------------------+-----------------------------+------------+-------+------------------+
| Event count      | ``consoleEventsInterval``   | 60s        | 60s   | Monitors page    |
| refresh          |                             |            |       | event badges     |
+------------------+-----------------------------+------------+-------+------------------+
| Dashboard events | ``eventsWidgetInterval``    | 30s        | 60s   | EventsWidget     |
| widget           |                             |            |       |                  |
+------------------+-----------------------------+------------+-------+------------------+
| Timeline/heatmap | ``timelineHeatmapInterval`` | 60s        | 120s  | TimelineWidget,  |
| data             |                             |            |       | HeatmapWidget    |
+------------------+-----------------------------+------------+-------+------------------+
| Daemon health    | ``daemonCheckInterval``     | 30s        | 60s   | Server page      |
| checks           |                             |            |       |                  |
+------------------+-----------------------------+------------+-------+------------------+
| Snapshot image   | ``snapshotRefreshInterval`` | 3s         | 10s   | useMonitorStream |
| refresh          |                             |            |       | (snapshot mode)  |
+------------------+-----------------------------+------------+-------+------------------+
| Stream FPS limit | ``streamMaxFps``            | 10         | 5     | Video streaming  |
+------------------+-----------------------------+------------+-------+------------------+
| Image scaling    | ``imageScale``              | 100%       | 50%   | Image requests   |
+------------------+-----------------------------+------------+-------+------------------+
| Image quality    | ``imageQuality``            | 100%       | 50%   | Image requests   |
+------------------+-----------------------------+------------+-------+------------------+

**What does NOT use bandwidth settings:**

+-----------------------+-------------------------+---------------------+
| Feature               | Interval                | Reason              |
+=======================+=========================+=====================+
| Groups data           | ``staleTime: 5min``     | Groups rarely       |
| (``useGroups``)       |                         | change, uses React  |
|                       |                         | Query cache         |
+-----------------------+-------------------------+---------------------+
| Event tags            | ``staleTime: 5min``     | Tags rarely change, |
| (``useEventTags``)    |                         | uses React Query    |
|                       |                         | cache               |
+-----------------------+-------------------------+---------------------+
| Token expiry check    | 60s (hardcoded)         | Security            |
|                       |                         | requirement, must   |
|                       |                         | check regularly     |
+-----------------------+-------------------------+---------------------+
| Monitor cycle         | User-configured         | User-controlled     |
| navigation            |                         | timer, not data     |
|                       |                         | fetching            |
+-----------------------+-------------------------+---------------------+
| WebSocket keepalive   | 60s (hardcoded)         | Protocol            |
|                       |                         | requirement for     |
|                       |                         | connection          |
|                       |                         | stability           |
+-----------------------+-------------------------+---------------------+
| One-time queries      | N/A                     | Queries without     |
|                       |                         | ``refetchInterval`` |
|                       |                         | (event lists,       |
|                       |                         | states, timezone)   |
+-----------------------+-------------------------+---------------------+

**When to add bandwidth settings:**

Use bandwidth settings for:

- Background polling that fetches server data repeatedly
- Auto-refresh features that run on timers
- Any operation that adds up to noticeable bandwidth over time

Do NOT use bandwidth settings for:

- User-triggered actions (button clicks, navigation)
- One-time data fetches
- Protocol requirements (authentication, keepalives)
- Data that rarely changes (use ``staleTime`` instead)

Timer rules
^^^^^^^^^^^

- Prefer ``refetchInterval`` to manual ``setInterval``: React Query
  handles cleanup.
- For data polling, set ``refetchIntervalInBackground: false`` so the
  poll stops when the app is backgrounded.
- For manual ``setInterval``, always return a ``clearInterval`` from
  the effect.
- Guard the effect with the conditions that determine whether the
  timer should run at all (don't start a no-op interval).

Mutations
~~~~~~~~~

For creating, updating, or deleting data:

.. code:: tsx

   import { useMutation, useQueryClient } from '@tanstack/react-query';

   function MonitorEditor({ monitor }: { monitor: Monitor }) {
     const queryClient = useQueryClient();

     const updateMutation = useMutation({
       mutationFn: (updates: Partial<Monitor>) =>
         updateMonitor(monitor.Id, updates),

       onSuccess: (updatedMonitor) => {
         // Invalidate related queries to trigger refetch
         queryClient.invalidateQueries({ queryKey: ['monitor', monitor.Id] });
         queryClient.invalidateQueries({ queryKey: ['monitors'] });

         toast.success('Monitor updated');
       },

       onError: (error) => {
         toast.error(`Failed to update monitor: ${error.message}`);
       },
     });

     const handleSave = (formData: MonitorFormData) => {
       updateMutation.mutate(formData);
     };

     return (
       <Form
         onSubmit={handleSave}
         isLoading={updateMutation.isPending}
         error={updateMutation.error}
       />
     );
   }

**Optimistic Updates:**

For better UX, update the UI immediately before the server responds:

.. code:: tsx

   const deleteMutation = useMutation({
     mutationFn: (monitorId: string) => deleteMonitor(monitorId),

     onMutate: async (monitorId) => {
       // Cancel ongoing queries
       await queryClient.cancelQueries({ queryKey: ['monitors'] });

       // Snapshot current data
       const previousMonitors = queryClient.getQueryData(['monitors']);

       // Optimistically update cache
       queryClient.setQueryData(['monitors'], (old: MonitorsResponse) => ({
         monitors: old.monitors.filter(m => m.Id !== monitorId),
       }));

       // Return context for rollback
       return { previousMonitors };
     },

     onError: (err, monitorId, context) => {
       // Rollback on error
       if (context?.previousMonitors) {
         queryClient.setQueryData(['monitors'], context.previousMonitors);
       }
       toast.error('Failed to delete monitor');
     },

     onSettled: () => {
       // Refetch to sync with server
       queryClient.invalidateQueries({ queryKey: ['monitors'] });
     },
   });

Infinite Queries (Pagination)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

For paginated data like event lists:

.. code:: tsx

   function EventTimeline() {
     const { currentProfile } = useCurrentProfile();

     const {
       data,
       isLoading,
       fetchNextPage,
       hasNextPage,
       isFetchingNextPage,
     } = useInfiniteQuery({
       queryKey: ['events', currentProfile?.id],
       queryFn: ({ pageParam = 0 }) =>
         fetchEvents(currentProfile!.id, { page: pageParam }),
       getNextPageParam: (lastPage) => lastPage.nextPage,
       enabled: !!currentProfile,
     });

     // Flatten pages into single array
     const events = data?.pages.flatMap(page => page.events) ?? [];

     return (
       <div>
         {events.map(event => <EventCard key={event.Id} event={event} />)}

         {hasNextPage && (
           <Button
             onClick={() => fetchNextPage()}
             disabled={isFetchingNextPage}
           >
             {isFetchingNextPage ? 'Loading...' : 'Load More'}
           </Button>
         )}
       </div>
     );
   }

HTTP Client Architecture
------------------------

Overview
~~~~~~~~

The application uses a **unified HTTP client** (``src/lib/http.ts``)
that provides platform-agnostic HTTP requests across Web, iOS, Android,
and Desktop (Tauri). This architecture provides:

- Automatic platform detection (Native/Tauri/Web/Proxy)
- CORS handling via native HTTP or development proxy
- Token injection for authenticated requests
- Response type handling (json, blob, arraybuffer, text, base64)
- Request/response correlation logging
- Progress callbacks for downloads

**IMPORTANT:** Always use the ``httpGet``, ``httpPost``, ``httpPut``,
``httpDelete`` functions from ``lib/http.ts``. Never use raw ``fetch()``
or third-party HTTP libraries directly.

**Components:**

::

   src/lib/
   ├── http.ts          # Unified HTTP client (USE THIS)
   ├── platform.ts      # Platform detection utilities
   └── logger.ts        # Logging utilities

   src/api/
   ├── auth.ts          # Authentication endpoints
   ├── client.ts        # HTTP client setup
   ├── events.ts        # Event endpoints
   ├── groups.ts        # Monitor group endpoints
   ├── logs.ts          # Server log endpoints
   ├── monitors.ts      # Monitor endpoints and stream URL generation
   ├── notifications.ts # Push notification endpoints
   ├── server.ts        # Server info and config endpoints
   ├── states.ts        # Run state endpoints
   ├── tags.ts          # Tag endpoints
   ├── time.ts          # Timezone endpoint
   ├── types.ts         # TypeScript types for API responses
   └── zones.ts         # Zone endpoints

Unified HTTP Client (``src/lib/http.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The HTTP client automatically selects the appropriate implementation
based on platform:

+---------------------+--------------------------------+----------------+
| Platform            | Implementation                 | Notes          |
+=====================+================================+================+
| iOS/Android         | Capacitor HTTP plugin          | Bypasses CORS, |
|                     |                                | uses native    |
|                     |                                | networking     |
+---------------------+--------------------------------+----------------+
| Desktop (Tauri)     | Tauri fetch plugin             | Native         |
|                     |                                | performance    |
+---------------------+--------------------------------+----------------+
| Web (dev)           | fetch + proxy                  | Routes through |
|                     |                                | localhost:3001 |
+---------------------+--------------------------------+----------------+
| Web (prod)          | fetch                          | Standard       |
|                     |                                | browser fetch  |
+---------------------+--------------------------------+----------------+

**Basic Usage:**

.. code:: tsx

   import { httpGet, httpPost, httpPut, httpDelete } from '../lib/http';

   // GET request
   const response = await httpGet<MonitorsResponse>(
     `${apiUrl}/api/monitors.json`,
     { token: accessToken }
   );
   const monitors = response.data;

   // POST request
   const result = await httpPost<AuthResponse>(
     `${apiUrl}/api/host/login.json`,
     { user: username, pass: password }
   );

   // PUT request with token
   await httpPut(
     `${apiUrl}/api/monitors/${id}.json`,
     { Monitor: updates },
     { token: accessToken }
   );

   // DELETE request
   await httpDelete(`${apiUrl}/api/events/${eventId}.json`, { token });

**Options Interface:**

.. code:: tsx

   interface HttpOptions {
     method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
     headers?: Record<string, string>;
     params?: Record<string, string | number>;  // Query parameters
     body?: unknown;                              // Request body (POST/PUT)
     responseType?: 'json' | 'blob' | 'arraybuffer' | 'text' | 'base64';
     token?: string;                              // Auth token (added to params)
     timeoutMs?: number;                          // Request timeout
     signal?: AbortSignal;                        // For cancellation
     validateStatus?: (status: number) => boolean;
     onDownloadProgress?: (progress: HttpProgress) => void;
   }

Request/Response Correlation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

All HTTP requests are assigned a monotonically increasing correlation ID
for debugging.

**How it works:**

1. Request generates correlation ID: ``1, 2, 3, ...``
2. Logs request with ID: ``[HTTP] Request #1 GET /api/monitors.json``
3. Logs response with same ID:
   ``[HTTP] Response #1 GET /api/monitors.json``
4. Logs errors with same ID: ``[HTTP] Failed #1 GET /api/monitors.json``

**Example logs:**

::

   [HTTP] Request #1 GET https://server.com/api/monitors.json
     { requestId: 1, platform: 'Web', method: 'GET', url: '...' }

   [HTTP] Response #1 GET https://server.com/api/monitors.json
     { requestId: 1, platform: 'Web', status: 200, duration: '145ms' }

   [HTTP] Request #2 POST https://server.com/api/host/login.json
     { requestId: 2, platform: 'Native', method: 'POST', url: '...' }

   [HTTP] Failed #2 POST https://server.com/api/host/login.json
     { requestId: 2, platform: 'Native', duration: '50ms', error: {...} }

Correlation IDs let you match request/response pairs in logs when
many requests overlap, trace auth flows (request → 401 → refresh →
retry), and attribute durations per call.

Platform-Specific Implementations
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Native (iOS/Android) - Capacitor HTTP:**

.. code:: tsx

   // Automatically used when Platform.isNative is true
   const { CapacitorHttp } = await import('@capacitor/core');
   const response = await CapacitorHttp.request({
     method: 'GET',
     url: fullUrl,
     headers,
     data: body,
     responseType: 'json', // or 'blob', 'arraybuffer'
   });

Bypasses CORS, uses the native networking stack, handles TLS
natively, and supports self-signed certificates via the ``SSLTrust``
Capacitor plugin (see ``lib/ssl-trust.ts``).

**Tauri (Desktop) - Tauri Fetch Plugin:**

.. code:: tsx

   // Automatically used when Platform.isTauri is true
   import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

   // When self-signed certs are enabled, danger options are added
   const { isTauriSslTrustEnabled } = await import('./ssl-trust');
   const dangerOpts = isTauriSslTrustEnabled()
     ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }
     : {};

   const response = await tauriFetch(url, {
     method,
     headers,
     body: JSON.stringify(body),
     signal,
     ...dangerOpts,
   });

Note: The ``danger`` option requires the ``dangerous-settings`` Cargo feature
on ``tauri-plugin-http`` in ``src-tauri/Cargo.toml``.

**Web (Browser) - Standard Fetch:**

.. code:: tsx

   // Automatically used on web platform
   const response = await fetch(url, {
     method,
     headers,
     body: JSON.stringify(body),
     signal,
   });

Proxy Support (Development)
~~~~~~~~~~~~~~~~~~~~~~~~~~~

In development (web only), requests are routed through a local proxy to
bypass CORS.

**How it works:**

1. ``Platform.shouldUseProxy`` returns true in dev mode on web
2. HTTP client rewrites URLs: ``https://server.com/api`` →
   ``http://localhost:3001/proxy/api``
3. Adds ``X-Target-Host: https://server.com`` header
4. Proxy server forwards request and returns response

**Example:**

.. code:: tsx

   // Original URL
   const url = 'https://zm.example.com/api/monitors.json';

   // With proxy enabled (dev mode on web):
   // Request URL: http://localhost:3001/proxy/api/monitors.json
   // Header: X-Target-Host: https://zm.example.com

**When proxy is used:**

- Platform: Web
- Environment: Development (``import.meta.env.DEV``)
- NOT used on native platforms (they bypass CORS natively)
- NOT used in production builds

Response Types
~~~~~~~~~~~~~~

The HTTP client supports multiple response types:

================== ===================== ====================
Type               Description           Use Case
================== ===================== ====================
``json`` (default) Parses JSON response  API responses
``text``           Returns raw text      HTML, plain text
``blob``           Returns Blob object   File downloads (web)
``arraybuffer``    Returns ArrayBuffer   Binary data
``base64``         Returns base64 string Mobile downloads
================== ===================== ====================

**Example: Downloading a file**

.. code:: tsx

   // For web (blob)
   const response = await httpGet<Blob>(url, {
     responseType: 'blob',
     onDownloadProgress: (progress) => {
       console.log(`Downloaded ${progress.percentage}%`);
     },
   });

   // For mobile (base64 to avoid OOM)
   const response = await httpGet<string>(url, {
     responseType: 'base64',
   });

**Mobile downloads:** never convert to Blob on mobile, use
``responseType: 'base64'`` and write directly to the filesystem.
Large files OOM the WebView otherwise.

Error Handling
~~~~~~~~~~~~~~

The HTTP client throws ``HttpError`` for non-2xx responses:

.. code:: tsx

   interface HttpError extends Error {
     status: number;
     statusText: string;
     data: unknown;
     headers: Record<string, string>;
   }

**Example:**

.. code:: tsx

   try {
     const response = await httpGet(url, { token });
     return response.data;
   } catch (error) {
     if ((error as HttpError).status === 401) {
       // Token expired - refresh and retry
       await refreshAccessToken();
       return httpGet(url, { token: newToken });
     }
     if ((error as HttpError).status === 404) {
       toast.error('Resource not found');
       return null;
     }
     // Network error or other issue
     toast.error('Request failed');
     throw error;
   }

API Functions
~~~~~~~~~~~~~

API functions are thin wrappers around the HTTP client.

**Example: Fetching monitors**

.. code:: tsx

   // src/api/monitors.ts
   import { httpGet, httpPut } from '../lib/http';
   import { useAuthStore } from '../stores/auth';

   export async function fetchMonitors(apiUrl: string): Promise<MonitorsResponse> {
     const { accessToken } = useAuthStore.getState();
     const response = await httpGet<MonitorsResponse>(
       `${apiUrl}/api/monitors.json`,
       { token: accessToken }
     );
     return response.data;
   }

   export async function updateMonitor(
     apiUrl: string,
     monitorId: string,
     updates: Partial<Monitor>
   ): Promise<Monitor> {
     const { accessToken } = useAuthStore.getState();
     const response = await httpPut<{ monitor: Monitor }>(
       `${apiUrl}/api/monitors/${monitorId}.json`,
       { Monitor: updates },
       { token: accessToken }
     );
     return response.data.monitor;
   }

**API organization:**

::

   src/api/
   ├── auth.ts          # login(), logout(), refreshAccessToken()
   ├── monitors.ts      # fetchMonitors(), updateMonitor(), getAlarmStatus(), getDaemonStatus()
   ├── events.ts        # fetchEvents(), fetchEvent(), deleteEvent(), getAdjacentEvent()
   ├── groups.ts        # getGroups() - monitor groups for filtering
   ├── tags.ts          # getTags(), getEventTags() - event tagging (ZM 1.37+)
   ├── states.ts        # fetchStates(), changeState()
   ├── server.ts        # getServers(), getStorages(), getDaemonCheck(), getLoad(), getDiskPercent()
   └── streaming.ts     # generateConnKey(), getStreamUrl()

Server API (``api/server.ts``)
------------------------------

Functions for querying ZoneMinder server info, storage, and health
checks. Several functions accept an optional ``apiBaseUrl`` parameter for
multi-server routing (see ``lib/server-resolver.ts``).

**Key functions:**

.. code:: typescript

   import {
     getServers,
     getStorages,
     getDaemonCheck,
     getLoad,
     getDiskPercent,
   } from '../api/server';

   // Fetch all configured servers
   const servers = await getServers();
   // Returns Server[] with routing fields:
   // Protocol, Hostname, Port, PathToIndex, PathToZMS, PathToApi

   // Fetch storage info
   const storages = await getStorages();
   // Returns Storage[] with ServerId, DiskTotalSpace, DiskUsedSpace

   // Health checks, optional apiBaseUrl routes to a specific server
   const daemonOk = await getDaemonCheck();                     // default server
   const daemonOk2 = await getDaemonCheck('https://server2/zm'); // specific server
   const load = await getLoad(apiBaseUrl);
   const disk = await getDiskPercent(apiBaseUrl);

When ``apiBaseUrl`` is omitted, requests go to the profile's default API
URL. When provided, the request is routed to that server directly. This
is used by the Server page to display per-server health.

Monitor API Updates (``api/monitors.ts``)
-----------------------------------------

Monitor functions that interact with per-monitor daemons or alarms now
accept an optional ``apiBaseUrl`` for multi-server routing.

**Multi-server-aware functions:**

.. code:: typescript

   import {
     getDaemonStatus,
     getAlarmStatus,
     triggerAlarm,
     cancelAlarm,
     controlMonitor,
   } from '../api/monitors';

   // Daemon status, routes to the server hosting this monitor
   const status = await getDaemonStatus(monitorId, 'zmc', apiBaseUrl);

   // Alarm operations, same routing
   const alarm = await getAlarmStatus(monitorId, apiBaseUrl);
   await triggerAlarm(monitorId, apiBaseUrl);
   await cancelAlarm(monitorId, apiBaseUrl);

   // Control monitor, multi-port support
   await controlMonitor(portalUrl, monitorId, command, token, minStreamingPort);

``controlMonitor`` accepts ``minStreamingPort`` to calculate the
per-monitor port using the formula
``port = minStreamingPort + parseInt(monitorId)``.

Event API Updates (``api/events.ts``)
-------------------------------------

Event URL helpers now support HLS detection and multi-port routing.

**Updated functions:**

.. code:: typescript

   import {
     getEventVideoUrl,
     getEventImageUrl,
     getEventZmsUrl,
   } from '../api/events';

   // Video URL, hls flag detects HLS vs MP4 from DefaultVideo field
   const videoUrl = getEventVideoUrl(event, { hls: true });

   // Image and ZMS URLs accept minStreamingPort and monitorId for multi-port
   const imageUrl = getEventImageUrl(event, {
     minStreamingPort: 7100,
     monitorId: '4',
   });
   const zmsUrl = getEventZmsUrl(event, {
     minStreamingPort: 7100,
     monitorId: '4',
   });

When ``hls`` is true, ``getEventVideoUrl`` checks the event's
``DefaultVideo`` field to determine whether the video is an HLS playlist
or an MP4 file and returns the appropriate URL.

Monitor Groups API
------------------

The groups API (``src/api/groups.ts``) fetches monitor groups for
filtering monitors.

**Usage:**

.. code:: tsx

   import { getGroups } from '../api/groups';

   const response = await getGroups();
   // response.groups: Array of group objects with Id, Name, ParentId, MonitorIds

**Response structure:**

.. code:: tsx

   interface Group {
     Id: string;
     Name: string;
     ParentId: string | null;  // For hierarchical groups
     MonitorIds: string;       // Comma-separated list of monitor IDs
   }

Groups are used with the ``GroupFilterSelect`` component for filtering
monitors in views.

Event Tags API
--------------

The tags API (``src/api/tags.ts``) handles event tagging functionality.
Tags are labels assigned to events (e.g., “person”, “car”, “cat”). Not
all ZoneMinder servers support tags - the API handles graceful
degradation.

**Key functions:**

.. code:: tsx

   import { getTags, getEventTags, checkTagsSupported } from '../api/tags';

   // Check if tags are supported on this server
   const supported = await checkTagsSupported();

   // Get all available tags
   const tagsResponse = await getTags();
   // Returns null if tags not supported (404) or permission denied (401/403)

   // Get tags for specific events (batched automatically)
   const eventTagMap = await getEventTags(['123', '456', '789']);
   // Returns Map<eventId, Tag[]> or null if not supported

**Features:**

- Graceful degradation for servers without tag support
- Automatic batching for large event ID lists (avoids URL length limits)
- Returns ``null`` instead of throwing on 404/401/403 responses

**Response structure:**

.. code:: tsx

   interface Tag {
     Id: string;
     Name: string;
     CreateDate: string;
     CreatedBy: string;
     LastAssignedDate: string;
   }

**Query key pattern:**

.. code:: tsx

   ['tags', profileId]           // All available tags
   ['eventTags', profileId, eventIds]  // Tags for specific events

Adjacent Event Navigation
-------------------------

The ``getAdjacentEvent`` function (``src/api/events.ts``) fetches a single
event adjacent to a given timestamp. It is used by the ``useEventNavigation``
hook to provide prev/next event navigation in EventDetail.

**Signature:**

.. code:: typescript

   export async function getAdjacentEvent(
     direction: 'next' | 'prev',
     currentStartDateTime: string,
     filters?: EventFilters
   ): Promise<EventData | null>

**How it works:**

1. Builds a ZM API filter path using ``StartDateTime >`` (for next) or
   ``StartDateTime <`` (for prev) relative to the provided timestamp
2. Applies the same server-side filters as the events list: ``monitorId``,
   ``minAlarmFrames``, and ``notesRegexp``
3. Requests a single result (``limit: 1``) sorted by ``StartDateTime`` in
   ascending order (next) or descending order (prev)
4. Returns the closest matching event, or ``null`` if none exists

**Usage:**

.. code:: typescript

   const nextEvent = await getAdjacentEvent('next', currentEvent.StartDateTime, filters);
   const prevEvent = await getAdjacentEvent('prev', currentEvent.StartDateTime, filters);

Notifications API
-----------------

The notifications API (``src/api/notifications.ts``) manages FCM push token
registration via ZoneMinder’s Notifications REST API. Used in Direct ZM
notification mode where tokens are registered via REST instead of the Event
Server WebSocket.

**Key functions:**

.. code:: tsx

   import {
     registerToken,
     updateNotification,
     deleteNotification,
     listNotifications,
     checkNotificationsApiSupport,
   } from ‘../api/notifications’;

   // Check if server supports the Notifications API
   const supported = await checkNotificationsApiSupport();
   // Returns false on 404 (older ZM versions)

   // Register or upsert an FCM token
   const notif = await registerToken({
     token: fcmToken,
     platform: ‘android’,
     monitorList: ‘1,2,3’,
     interval: 60,
     pushState: ‘enabled’,
     appVersion: ‘2.0.0’,
   });

   // Update monitor filter or push state
   await updateNotification(notif.Id, { monitorList: ‘1,2’, interval: 30 });

   // Delete a registration
   await deleteNotification(notif.Id);

**Features:**

- Upsert semantics (POST with existing token updates the row)
- User-scoped (server returns only the current user’s tokens)
- Feature detection via 404 response for older ZM versions

Event Poller Service
--------------------

The event poller (``src/services/eventPoller.ts``) polls the ZM events API
for new events in Direct notification mode on desktop (Tauri). New events
are fed into the notification store, which triggers toast display via
``NotificationHandler``.

**Usage:** The poller is started automatically by ``NotificationHandler``
when ``notificationMode === ‘direct’`` on desktop/web (``Platform.isDesktopOrWeb``).
On mobile (iOS/Android), FCM push notifications handle event delivery instead.
The polling interval is configurable per-profile via ``pollingInterval`` in
notification settings (default 30 seconds). The poller uses recursive
``setTimeout`` so interval changes take effect on the next tick.

**Filters:** When ``onlyDetectedEvents`` is enabled in notification settings,
the poller adds a ``Notes REGEXP:detected:`` filter to the events API request,
limiting results to events with object detection data.

WebSocket Notification Service
------------------------------

The WebSocket service (``src/services/notifications.ts``) connects to
ZoneMinder’s Event Server (``zmeventnotification.pl``) for real-time alarm
notifications in ES mode.

**Reconnection strategy:**

- Exponential backoff with jitter: 2s, 4s, 8s, 16s, ... capped at 2 minutes
- Jitter of ±25% prevents thundering herd when multiple clients reconnect
- Reconnection continues indefinitely until the user explicitly disconnects
- An ``intentionalDisconnect`` flag distinguishes user-initiated disconnect from
  network failures, only the former stops reconnection
- ``reconnectAttempts`` counter resets after successful authentication (not on
  socket open), preventing auth failures from resetting the backoff

**Liveness detection:**

- **Keepalive ping**: Sends a version-request every 60 seconds
- ``checkAlive(timeoutMs)``: Sends a version request and resolves
  ``true``/``false`` based on whether a response arrives within the timeout.
  Used by ``NotificationHandler`` on app resume (mobile) and tab visibility
  change (desktop) to detect dead connections
- **Network change listener**: ``NotificationHandler`` listens to
  ``window.addEventListener(‘online’)`` (desktop/web) and
  ``@capacitor/network`` (mobile) to trigger immediate reconnect via
  ``reconnectNow()`` when connectivity is restored
- **App resume check** (mobile): On ``appStateChange`` active, a liveness
  probe is sent; if unresponsive, reconnect is triggered
- **Visibility change** (desktop): On ``visibilitychange`` to visible, a
  liveness probe is sent to detect connections killed during tab backgrounding

End-to-end Flow: Viewing Monitors
---------------------------------

1. ``Monitors.tsx`` calls ``useQuery({ queryKey: ['monitors', profileId],
   queryFn: () => fetchMonitors(profileId), enabled: !!currentProfile })``.
2. ``fetchMonitors`` (``src/api/monitors.ts``) calls
   ``httpGet('/api/monitors.json', { token })``.
3. ``lib/http.ts`` injects the token, assigns a correlation ID, and
   dispatches via the platform implementation: ``fetch`` on web (with
   dev proxy), Capacitor HTTP on iOS/Android, Tauri fetch on desktop.
4. Response and duration are logged with the same correlation ID, then
   stored under the query key.
5. ``MonitorGrid`` renders ``MonitorCard`` per monitor; each card calls
   ``useMonitorStream({ monitorId })`` to get a connkey-authenticated
   stream URL via ``lib/url-builder.ts`` and renders an ``<img>``.

.. _error-handling-1:

Error Handling
--------------

API Errors
~~~~~~~~~~

.. code:: tsx

   class ApiError extends Error {
     constructor(
       public status: number,
       public statusText: string,
       message?: string
     ) {
       super(message || `API Error: ${status} ${statusText}`);
     }
   }

**Usage:**

.. code:: tsx

   try {
     const data = await fetchMonitors(profileId);
   } catch (error) {
     if (error instanceof ApiError) {
       if (error.status === 401) {
         // Unauthorized - refresh tokens
         await refreshAuthTokens(profileId);
         // Retry request
       } else if (error.status === 404) {
         // Not found
         toast.error('Monitor not found');
       } else {
         // Other error
         toast.error(`Server error: ${error.statusText}`);
       }
     } else {
       // Network error
       toast.error('Network error - check connection');
     }
   }

React Query Error Handling
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const { data, error } = useQuery({
     queryKey: ['monitors'],
     queryFn: fetchMonitors,
     retry: (failureCount, error) => {
       // Don't retry on 404
       if (error instanceof ApiError && error.status === 404) {
         return false;
       }
       // Retry network errors up to 3 times
       return failureCount < 3;
     },
   });

   if (error) {
     return <ErrorDisplay error={error} onRetry={refetch} />;
   }

ZoneMinder Streaming Protocol
-----------------------------

Video streams are served by a separate ZoneMinder daemon (ZMS).
Tracking the stream lifecycle correctly avoids leaving zombie streams
on the server.

Stream Lifecycle
~~~~~~~~~~~~~~~~

**1. Connection Key Generation**

Each stream requires a unique connection key (connkey):

.. code:: tsx

   // src/stores/monitors.ts
   const connKeyCounter = useRef(0);

   export const regenerateConnKey = (monitorId: string) => {
     connKeyCounter.current += 1;
     return connKeyCounter.current;
   };

**2. Stream URL Construction**

.. code:: tsx

   // src/api/monitors.ts
   export function getStreamUrl(
     cgiUrl: string,
     monitorId: string,
     options: StreamOptions
   ): string {
     const params = new URLSearchParams({
       view: 'view_video',
       mode: options.mode || 'jpeg',  // 'jpeg' for streaming, 'single' for snapshot
       monitor: monitorId,
       connkey: options.connkey.toString(),
       scale: options.scale?.toString() || '100',
       maxfps: options.maxfps?.toString() || '',
       token: options.token || '',
     });

     return `${cgiUrl}/nph-zms?${params.toString()}`;
   }

**3. Stream Cleanup with CMD_QUIT**

When a stream is no longer needed, send ``CMD_QUIT`` to the ZMS daemon:

.. code:: tsx

   import { getZmsControlUrl } from '../lib/url-builder';
   import { ZMS_COMMANDS } from '../lib/zm-constants';
   import { httpGet } from '../lib/http';

   useEffect(() => {
     return () => {
       // Cleanup on unmount
       if (connKey !== 0 && currentProfile) {
         const controlUrl = getZmsControlUrl(
           currentProfile.portalUrl,
           ZMS_COMMANDS.cmdQuit,
           connKey.toString(),
           { token: accessToken }
         );

         httpGet(controlUrl).catch(() => {
           // Silently ignore errors - connection may already be closed
         });
       }
     };
   }, []); // Empty deps - only run on unmount

Never Render Without a Valid ConnKey
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A stream started with ``connKey=0`` creates a zombie that can't be
terminated. Only build a stream URL once ``connKey !== 0``:

.. code:: tsx

   const [connKey, setConnKey] = useState(0);

   // Generate connKey in effect
   useEffect(() => {
     const newKey = regenerateConnKey(monitorId);
     setConnKey(newKey);
   }, [monitorId]);

   // Check connKey before building URL
   const streamUrl = currentProfile && connKey !== 0
     ? getStreamUrl(currentProfile.cgiUrl, monitorId, {
         connkey: connKey,
         mode: 'jpeg',
         // ...
       })
     : '';  // Empty string until connKey is valid

   return <img src={streamUrl} />;

Stream Modes
~~~~~~~~~~~~

Defined in ``src/lib/zm-constants.ts``:

- ``jpeg``: MJPEG streaming (continuous multipart JPEG frames)
- ``single``: Single frame snapshot (one JPEG image)
- ``stream``: Raw stream (rarely used)

ZMS Commands
~~~~~~~~~~~~

The ZMS daemon accepts various control commands via HTTP requests:

.. code:: tsx

   // src/lib/zm-constants.ts
   export const ZMS_COMMANDS = {
     cmdPlay: 1,      // Start/resume playback
     cmdPause: 2,     // Pause playback
     cmdStop: 3,      // Stop playback
     cmdQuit: 17,     // Close stream connection
     cmdQuery: 18,    // Query stream status
     // ... more commands
   } as const;

``cmdQuit`` (17) is the one that matters for cleanup, always send it
when unmounting to prevent zombie streams.

See :doc:`08-common-pitfalls` (pitfall #3) for the zombie-stream
pattern and how to avoid it: never render with ``connKey === 0``,
always send ``CMD_QUIT`` on unmount via ``httpGet`` (not raw
``fetch``), and keep effect deps to primitive IDs.
