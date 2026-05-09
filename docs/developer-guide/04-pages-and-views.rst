Pages and Views
===============

A tour of the application screens and the routing that connects them.

Routing
-------

zmNinjaNg uses **React Router v7** (``react-router-dom``). Routes
are defined in ``AppRoutes`` inside ``src/App.tsx``.

Two route types:

1. **Standalone routes** render outside the main layout (e.g. the
   Setup Wizard).
2. **Layout routes** render inside ``AppLayout``, which provides the
   sidebar and header.

.. code:: tsx

   // src/App.tsx
   <Routes>
     <Route path="/profiles/new" element={<ProfileForm />} />

     <Route element={<AppLayout />}>
       <Route path="dashboard" element={<Dashboard />} />
       <Route path="monitors" element={<Monitors />} />
       {/* ... */}
     </Route>
   </Routes>

Each route is wrapped in a ``RouteErrorBoundary`` so a crash in one
page doesn't take down the rest of the app.

Programmatic Navigation
~~~~~~~~~~~~~~~~~~~~~~~

Use ``useNavigate``:

.. code:: tsx

   import { useNavigate } from 'react-router-dom';

   const navigate = useNavigate();
   navigate(`/monitors/${monitorId}`);            // forward
   navigate(-1);                                  // back
   navigate('/dashboard', { replace: true });     // replace history entry

Page Structure
--------------

Pages live in ``src/pages/``:

::

   src/pages/
   ├── Dashboard.tsx       # Dashboard with widgets
   ├── Montage.tsx         # Multi-monitor grid
   ├── Monitors.tsx        # Monitor list/grid
   ├── MonitorDetail.tsx   # Single monitor + live stream
   ├── EventDetail.tsx     # Event playback
   ├── Events.tsx          # Events list/timeline
   ├── ProfileForm.tsx     # Profile create/edit
   ├── Profiles.tsx        # Profile selection
   └── Settings.tsx        # App settings

Pages are plain React components built with Tailwind and shadcn/ui
primitives from ``src/components/ui/`` (``Button``, ``Card``, ``Input``,
``Select``, etc.). The outer chrome (sidebar, header) comes from
``AppLayout`` (``src/components/layout/AppLayout.tsx``); pages don't
render their own shell. Toasts use ``toast`` from ``sonner``.

Dashboard
---------

**Location**: ``src/pages/Dashboard.tsx``

Displays user-customizable widgets via ``react-grid-layout``.

.. code:: tsx

   export default function Dashboard() {
     const { currentProfile } = useCurrentProfile();
     const widgets = useDashboardStore((state) => state.widgets);
     const layout = useDashboardStore((state) => state.layout);

     if (!currentProfile) return <ProfileRequired />;

     return (
       <div className="p-4 md:p-6 space-y-4">
         <DashboardHeader />
         <DashboardLayout
           widgets={widgets}
           layout={layout}
           onLayoutChange={saveLayout}
         />
       </div>
     );
   }

DashboardLayout: ResizeObserver + Zustand
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardLayout.tsx``

The component watches container width with ``ResizeObserver``,
recomputes the column count, and saves the result via
``useSettingsStore``. The naive version causes an infinite loop:

.. code:: tsx

   // Buggy version
   const handleWidthChange = useCallback((width: number) => {
     const maxCols = calculateMaxCols(width);
     if (gridCols > maxCols) {
       setGridCols(maxCols);
       if (currentProfile) {
         updateSettings(currentProfile.id, { gridCols: maxCols });
       }
     }
   }, [gridCols, currentProfile, updateSettings]);

   const containerRef = useCallback((node: HTMLDivElement | null) => {
     if (node) {
       const observer = new ResizeObserver(entries => {
         handleWidthChange(entries[0].contentRect.width);
       });
       observer.observe(node);
       return () => observer.disconnect();
     }
   }, [handleWidthChange]);

The loop:

1. ``currentProfile`` and ``updateSettings`` come from Zustand and
   change reference each render.
2. ``handleWidthChange`` recreates → ``containerRef`` recreates.
3. ``containerRef`` callback runs → new ``ResizeObserver`` → fires
   immediately.
4. ``handleWidthChange`` calls ``updateSettings`` → re-render.
5. Back to step 1.

Fix: hold the unstable values in refs, keep the callback's deps to
primitives.

.. code:: tsx

   const currentProfileRef = useRef(currentProfile);
   const updateSettingsRef = useRef(updateSettings);

   useEffect(() => {
     currentProfileRef.current = currentProfile;
     updateSettingsRef.current = updateSettings;
   }, [currentProfile, updateSettings]);

   const handleWidthChange = useCallback((width: number) => {
     const maxCols = calculateMaxCols(width);
     if (gridCols > maxCols) {
       setGridCols(maxCols);
       if (currentProfileRef.current) {
         updateSettingsRef.current(currentProfileRef.current.id, {
           gridCols: maxCols,
         });
       }
     }
   }, [gridCols]);

Apply this pattern whenever a callback owned by an external observer
(``ResizeObserver``, timers, listeners) reads Zustand or hook values
and writes back to state.

Montage
-------

**Location**: ``src/pages/Montage.tsx``

Edge-to-edge grid of all monitors. Uses ``react-grid-layout`` with a
fixed 12-column internal grid; the user's "display columns" setting
(1–5) controls the default item width, but items can be resized to
any width 1–12.

Layout logic lives in hooks under ``src/components/montage/``:

- **useMontageGrid**: layout state, column math, aspect-ratio-aware
  height, saved-layout persistence, migration from older formats.
- **useContainerResize**: ``ResizeObserver`` wrapper with debounced
  width tracking (first measurement immediate; subsequent changes
  debounced 500 ms).
- **useFullscreenMode**: Fullscreen API toggle.

.. code:: tsx

   import {
     GridLayoutControls,
     FullscreenControls,
     useMontageGrid,
     useContainerResize,
     useFullscreenMode,
   } from '../components/montage';
   import { INTERNAL_COLS } from '../components/montage/hooks/useMontageGrid';

   export default function Montage() {
     const { currentProfile, settings } = useCurrentProfile();
     const { data: monitors } = useQuery({ /* ... */ });

     const {
       layout, gridCols, isScreenTooSmall, monitorMap,
       currentWidthRef, hasWidth,
       handleApplyGridLayout, handleLoadSavedLayout,
       handleLayoutChange, handleResizeStop, handleWidthChange,
     } = useMontageGrid({ monitors, currentProfile, settings, isEditMode });

     const { containerRef } = useContainerResize({
       onWidthChange: handleWidthChange,
       currentWidthRef,
     });

     return (
       <WrappedGridLayout
         cols={INTERNAL_COLS}          // always 12
         layout={layout}
         rowHeight={GRID_LAYOUT.montageRowHeight}
         margin={[0, 0]}
         containerPadding={[0, 0]}
         onLayoutChange={handleLayoutChange}
         onResizeStop={handleResizeStop}
       >
         {layout.map(item => (
           <MontageMonitor key={item.i} monitor={/* ... */} />
         ))}
       </WrappedGridLayout>
     );
   }

12-Column Internal Grid
~~~~~~~~~~~~~~~~~~~~~~~

``INTERNAL_COLS = 12`` is the fixed column count. The user's display-
columns value sets default item width as ``w = 12 / displayCols``.
Vertical compaction reflows items automatically.

Saved Layouts
~~~~~~~~~~~~~

Each saved layout stores the ``Layout[]`` array and the
``displayCols`` at save time.

- **Save**: ``handleSaveLayout(name)`` → persists via
  ``saveMontageLayout()`` in the settings store.
- **Load**: ``handleLoadSavedLayout(layout, displayCols)``.
- **Delete**: ``handleDeleteLayout(index)``.
- **Active name**: ``settings.montageActiveLayoutName`` tracks the
  currently loaded saved layout (cleared when the user switches to a
  preset column count).

Layout Migration
~~~~~~~~~~~~~~~~

``migrateLayout()`` in ``useMontageGrid`` handles old layouts where
``w`` ranged 1–5. If ``max(w) <= 5``, it scales ``w`` and ``x`` into
the 12-column space: ``w * (12 / displayCols)``.

Aspect-Ratio Height
~~~~~~~~~~~~~~~~~~~

.. code:: typescript

   const CARD_HEADER_HEIGHT = 32;  // h-8 header bar
   const columnWidth = (gridWidth - margin * (INTERNAL_COLS - 1)) / INTERNAL_COLS;
   const itemWidth = columnWidth * widthUnits + margin * (widthUnits - 1);
   const videoPx = itemWidth * (height / width);
   const heightPx = videoPx + CARD_HEADER_HEIGHT;
   const unit = (heightPx + margin) / (rowHeight + margin);
   return Math.max(2, Math.ceil(unit));

Toolbar Toggle
~~~~~~~~~~~~~~

An eye-toggle button shows/hides the toolbar (group filter, grid
controls, fit selector, refresh, edit, fullscreen). Stored per
profile in ``settings.montageShowToolbar``. i18n key:
``montage.toggle_toolbar``.

ResizeObserver + Zustand: Same Trap
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Montage hits the same infinite-loop trap as DashboardLayout when
callbacks reference unstable Zustand selectors or
``useTranslation()``'s ``t`` function. ``useMontageGrid`` uses the
same ref pattern:

.. code:: tsx

   const currentProfileRef = useRef(currentProfile);
   const settingsRef = useRef(settings);
   const tRef = useRef(t);

   useEffect(() => {
     currentProfileRef.current = currentProfile;
   }, [currentProfile]);

   const handleWidthChange = useCallback((width: number) => {
     // reads currentProfileRef.current, settingsRef.current
   }, []);

Watch for it whenever ``ResizeObserver`` and Zustand appear together.

Monitors
--------

**Location**: ``src/pages/Monitors.tsx``

List/grid view of all monitors for the current profile.

.. code:: tsx

   export default function Monitors() {
     const { t } = useTranslation();
     const { currentProfile, settings } = useCurrentProfile();
     const bandwidth = useBandwidthSettings();
     const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
     const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

     const { data, isLoading, error, refetch } = useQuery({
       queryKey: ['monitors', currentProfile?.id],
       queryFn: getMonitors,
       enabled: !!currentProfile && isAuthenticated,
       refetchInterval: bandwidth.monitorStatusInterval,
     });

     if (!currentProfile) return <ProfileRequired />;
     if (isLoading) return <MonitorListSkeleton />;
     if (error) return <ErrorDisplay error={error} />;

     return (
       <div className="p-3 sm:p-4 md:p-6 space-y-4">
         <div className="flex items-center justify-between">
           <h1 className="text-base sm:text-lg font-bold tracking-tight">
             {t('monitors.title')}
           </h1>
           <Button variant="outline" size="icon" onClick={() => refetch()}>
             <RefreshCw className="h-4 w-4" />
           </Button>
         </div>
         {settings.monitorsViewMode === 'grid' ? (
           <MonitorGrid monitors={data!.monitors} />
         ) : (
           <MonitorList monitors={data!.monitors} />
         )}
       </div>
     );
   }

Notes:

- Refetch interval comes from ``useBandwidthSettings()``: never hardcoded.
- View mode is profile-scoped via ``settings.monitorsViewMode``.

MonitorDetail
-------------

**Location**: ``src/pages/MonitorDetail.tsx``

Full-screen view of a single monitor with live stream.

.. code:: tsx

   export default function MonitorDetail() {
     const { id } = useParams<{ id: string }>();
     const navigate = useNavigate();
     const { currentProfile } = useCurrentProfile();

     const { data: monitor } = useQuery({
       queryKey: ['monitor', id],
       queryFn: () => getMonitor(id!),
       enabled: !!id && !!currentProfile,
     });

     return (
       <div className="flex flex-col h-full">
         <div className="flex items-center gap-2 p-3 border-b">
           <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
             <ArrowLeft className="h-4 w-4" />
           </Button>
           <h1 className="text-base font-semibold truncate">
             {monitor?.Monitor.Name}
           </h1>
         </div>
         <div className="flex-1 min-h-0">
           <VideoPlayer monitor={monitor?.Monitor} />
           <MonitorControls monitorId={id!} />
         </div>
       </div>
     );
   }

Stream URLs are built by helpers in ``src/lib/url-builder.ts``
(``getMonitorStreamUrl``, ``getMonitorControlUrl``, ``getEventZmsUrl``,
``getGo2RTCStreamUrl``, etc.). These handle ``connkey`` generation,
token attachment, and protocol selection, never hand-build a ZM
stream URL in a page or component.

Event thumbnails go through ``src/lib/thumbnail-chain.ts``, which
chooses among ``zms``, cached, or API sources.

Non-stream HTTP traffic uses ``httpGet`` / ``httpPost`` /
``httpPut`` / ``httpDelete`` from ``src/lib/http.ts``: never raw
``fetch()`` or ``axios``.

Events
------

**Location**: ``src/pages/Events.tsx``

Timeline/list of recorded events with infinite scroll via
``useInfiniteQuery``.

.. code:: tsx

   export default function Events() {
     const { t } = useTranslation();
     const { currentProfile } = useCurrentProfile();
     const [filters, setFilters] = useState({ monitorId: null, date: null });

     const { data, isLoading, fetchNextPage, hasNextPage } = useInfiniteQuery({
       queryKey: ['events', currentProfile?.id, filters],
       queryFn: ({ pageParam = 0 }) => getEvents({ ...filters, page: pageParam }),
       getNextPageParam: (lastPage) => lastPage.nextPage,
       enabled: !!currentProfile,
     });

     return (
       <div className="p-3 sm:p-4 md:p-6 space-y-4">
         <h1 className="text-base sm:text-lg font-bold tracking-tight">
           {t('events.title')}
         </h1>
         <EventFilters filters={filters} onChange={setFilters} />
         <EventTimeline
           events={data?.pages.flatMap((p) => p.events)}
           onLoadMore={fetchNextPage}
           hasMore={hasNextPage}
         />
       </div>
     );
   }

ProfileForm
-----------

**Location**: ``src/pages/ProfileForm.tsx``

Create or edit ZoneMinder server profiles. The same form handles
both flows; the URL ``id`` param distinguishes them.

.. code:: tsx

   export default function ProfileForm() {
     const { id } = useParams<{ id?: string }>();
     const navigate = useNavigate();
     const { t } = useTranslation();
     const addProfile = useProfileStore((state) => state.addProfile);
     const updateProfile = useProfileStore((state) => state.updateProfile);

     const [formData, setFormData] = useState({
       name: '',
       portalUrl: '',
       username: '',
       password: '',
     });

     useEffect(() => {
       if (id) {
         const profile = getProfile(id);
         if (profile) setFormData(profile);
       }
     }, [id]);

     const handleTestConnection = async () => {
       try {
         await testConnection(formData);
         toast.success(t('profile.connection_success'));
       } catch {
         toast.error(t('profile.connection_failed'));
       }
     };

     const handleSave = () => {
       if (id) {
         updateProfile(id, formData);
       } else {
         addProfile({ ...formData, id: generateId() });
       }
       navigate(-1);
     };

     return (
       <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
         {/* form fields... */}
         <div className="flex gap-2">
           <Button variant="outline" onClick={handleTestConnection}>
             {t('profile.test_connection')}
           </Button>
           <Button onClick={handleSave}>{t('common.save')}</Button>
         </div>
       </div>
     );
   }

Connection testing happens before save, credentials and server
reachability are verified inline.

Secondary Views
---------------

Logs (``src/pages/Logs.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Unified view of zmNinjaNg app logs (in-memory, ephemeral) and
ZoneMinder server logs (fetched via API). Toggle between App and
Server, filter by level (DEBUG / INFO / WARN / ERROR) and component,
and export or share to file.

Notifications
~~~~~~~~~~~~~

- **History** (``src/pages/NotificationHistory.tsx``), past
  notifications with read status, event thumbnails, tap-to-navigate.
- **Settings** (``src/pages/NotificationSettings.tsx``),
  configuration:

  - Connection status badge (connected / disconnected for ES mode,
    "Direct mode active" for Direct mode).
  - Mode selector (Event Server vs Direct). Direct mode is auto-
    detected and disabled if the ZM server lacks the Notifications API.
  - ES-mode settings: WebSocket host, port, SSL, connect/disconnect,
    advanced options (toasts, sounds).
  - Direct-mode settings: polling interval (10–120 s),
    detected-events-only filter.
  - Per-monitor filters with configurable check intervals.
  - Push registration: FCM token registered with ES (via WebSocket)
    or ZM (via REST) depending on mode.

Server (``src/pages/Server.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Server health and control: API/Core version, system load, disk usage,
daemon status, ZM Run State (Start/Stop/Restart).

Timeline (``src/pages/Timeline.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Events visualized on a hand-rolled HTML5 ``<canvas>`` timeline
(``src/components/timeline/TimelineCanvas.tsx``). Rows group by
monitor, color-coded by monitor ID, with zoom/pan, quick-range buttons
(1h, 8h, 24h), and an interactive scrubber. The renderer
(``timeline-renderer.ts``), viewport
(``useTimelineViewport.ts``), gestures (``useTimelineGestures.ts``),
and hit-testing (``timeline-hit-test.ts``) are split into focused
modules so each can be tested in isolation.

Common Page Patterns
--------------------

Profile requirement
~~~~~~~~~~~~~~~~~~~

Most pages require a selected profile. Read it via ``useCurrentProfile()``
(``src/hooks/useCurrentProfile.ts``); it returns
``{ currentProfile, settings, hasProfile }``. The Zustand store only
holds ``currentProfileId: string | null`` plus the profile list, there
is no ``currentProfile`` field on the store.

.. code:: tsx

   const { currentProfile } = useCurrentProfile();
   if (!currentProfile) return <ProfileRequired />;

If you only need the id (e.g. for a query key), select it directly:

.. code:: tsx

   const currentProfileId = useProfileStore((state) => state.currentProfileId);

React Query for data
~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const { data, isLoading, error } = useQuery({
     queryKey: ['resource', id],
     queryFn: () => fetchResource(id),
     enabled: !!currentProfile,
   });

Loading / error states
~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   if (isLoading) return <Skeleton />;
   if (error) return <ErrorDisplay error={error} />;
   if (!data) return <EmptyState />;
   return <Content data={data} />;

Navigation
~~~~~~~~~~

.. code:: tsx

   const navigate = useNavigate();
   navigate('/monitor/123');
   navigate('/dashboard', { replace: true });
   navigate(-1);
