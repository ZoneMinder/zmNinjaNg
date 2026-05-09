Pages and Views
===============

This chapter provides a tour of the application screens and the routing
logic that connects them.

Routing and Navigation
----------------------

zmNinjaNg uses **React Router v7** (``react-router-dom``) for client-side
routing. The router integration is handled in ``src/App.tsx``.

Route Structure
~~~~~~~~~~~~~~~

Routes are defined in the ``AppRoutes`` component. There are two main
types of routes:

1. **Standalone Routes**: Render outside the main layout (e.g., Setup
   Wizard).
2. **Layout Routes**: Render inside ``AppLayout``, which provides the
   sidebar navigation and header.

.. code:: tsx

   // src/App.tsx
   <Routes>
     {/* Standalone Route */}
     <Route path="/profiles/new" element={<ProfileForm />} />

     {/* Layout Routes - wrapped in AppLayout */}
     <Route element={<AppLayout />}>
       <Route path="dashboard" element={<Dashboard />} />
       <Route path="monitors" element={<Monitors />} />
       {/* ... other pages ... */}
     </Route>
   </Routes>

Route Error Boundaries
~~~~~~~~~~~~~~~~~~~~~~

Each route is wrapped in a ``RouteErrorBoundary`` component. This
ensures that if a specific page crashes (e.g., due to a rendering bug),
it doesn’t crash the entire application. The user sees an error message
for that page but can still use the navigation sidebar to go elsewhere.

Programmatic Navigation
~~~~~~~~~~~~~~~~~~~~~~~

To navigate imperatively from code, use the ``useNavigate`` hook from
React Router v7:

.. code:: tsx

   import { useNavigate } from 'react-router-dom';

   function MyComponent() {
     const navigate = useNavigate();

     const handleSave = () => {
       navigate(`/monitors/${monitorId}`);            // forward
     };

     const handleCancel = () => {
       navigate(-1);                                  // back
     };

     const handleReplace = () => {
       navigate('/dashboard', { replace: true });     // replace history entry
     };
   }

Page Structure
--------------

Pages are plain React components built with Tailwind CSS and shadcn/ui
primitives from ``src/components/ui/`` (``Button``, ``Card``, ``Input``,
``Select``, etc.). They live in ``src/pages/``:

::

   src/pages/
   ├── Dashboard.tsx       # Main dashboard with widgets
   ├── Montage.tsx        # Multi-monitor grid view
   ├── Monitors.tsx       # Monitor list/grid view
   ├── MonitorDetail.tsx  # Single monitor view with live stream
   ├── EventDetail.tsx    # Event playback and details
   ├── Events.tsx         # Events list/timeline
   ├── ProfileForm.tsx    # Profile creation/editing
   ├── Profiles.tsx       # Profile selection screen
   └── Settings.tsx       # App settings

Each page is a top-level ``<div>`` (or fragment) with Tailwind layout
classes, renders shadcn/ui primitives for chrome, and handles its own
data fetching and state management. The outer chrome (sidebar, header)
is supplied by ``AppLayout`` (``src/components/layout/AppLayout.tsx``)
through the layout route in ``src/App.tsx``; pages do not render their
own page shell. User-facing notifications go through ``toast`` from
``sonner``.

Dashboard Page
--------------

**Location**: ``src/pages/Dashboard.tsx``

The dashboard displays customizable widgets using ``react-grid-layout``.
Users can add, remove, reorder, and resize widgets.

Architecture
~~~~~~~~~~~~

.. code:: tsx

   export default function Dashboard() {
     const { currentProfile } = useCurrentProfile();
     const widgets = useDashboardStore((state) => state.widgets);
     const layout = useDashboardStore((state) => state.layout);

     if (!currentProfile) {
       return <ProfileRequired />;
     }

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

DashboardLayout Component
~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardLayout.tsx``

This component handles the grid layout and responds to window resize
events.

**Key Implementation Detail - The ResizeObserver Pattern:**

The component needs to: 1. Detect when the container width changes 2.
Calculate how many grid columns fit 3. Save the preference to user
settings

.. code:: tsx

   function DashboardLayout() {
     const { currentProfile } = useCurrentProfile();
     const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
     const gridCols = useDashboardStore((state) => state.gridCols);

     // Calculate max columns based on container width
     const handleWidthChange = useCallback((width: number) => {
       const maxCols = calculateMaxCols(width);

       if (gridCols > maxCols) {
         setGridCols(maxCols);

         // Save to profile settings
         if (currentProfile) {
           updateSettings(currentProfile.id, { gridCols: maxCols });
         }
       }
     }, [gridCols, currentProfile, updateSettings]);

     // Set up ResizeObserver
     const containerRef = useCallback((node: HTMLDivElement | null) => {
       if (node) {
         const observer = new ResizeObserver(entries => {
           handleWidthChange(entries[0].contentRect.width);
         });
         observer.observe(node);

         return () => observer.disconnect();
       }
     }, [handleWidthChange]);

     return <div ref={containerRef}>...</div>;
   }

**The Problem: Infinite Loop**

The above code has a critical bug. Here’s what happens:

1. Component renders
2. ``currentProfile`` and ``updateSettings`` from Zustand get new object
   references
3. ``handleWidthChange`` recreates (dependencies changed)
4. ``containerRef`` recreates (depends on ``handleWidthChange``)
5. ``containerRef`` callback runs (ref changed)
6. Creates **new** ResizeObserver
7. New observer immediately fires (element has size)
8. Calls ``handleWidthChange`` → updates settings → triggers re-render
9. Back to step 1 → **infinite loop**

Even though ``currentProfile`` and ``updateSettings`` have the same
**values**, Zustand returns new **references** on every render. React
sees them as different and recreates the callback.

**The Solution: Use Refs**

We need to decouple the Zustand values from the callback dependencies:

.. code:: tsx

   function DashboardLayout() {
     const { currentProfile } = useCurrentProfile();
     const updateSettings = useSettingsStore((state) => state.updateProfileSettings);
     const gridCols = useDashboardStore((state) => state.gridCols);

     // Store Zustand values in refs - doesn't trigger re-renders
     const currentProfileRef = useRef(currentProfile);
     const updateSettingsRef = useRef(updateSettings);

     // Keep refs synchronized with latest values
     useEffect(() => {
       currentProfileRef.current = currentProfile;
       updateSettingsRef.current = updateSettings;
     }, [currentProfile, updateSettings]);

     // Now callback only depends on gridCols (a primitive value, stable)
     const handleWidthChange = useCallback((width: number) => {
       const maxCols = calculateMaxCols(width);

       if (gridCols > maxCols) {
         setGridCols(maxCols);

         // Access via ref - always has current value
         if (currentProfileRef.current) {
           updateSettingsRef.current(currentProfileRef.current.id, {
             gridCols: maxCols
           });
         }
       }
     }, [gridCols]);  // Only gridCols - stable dependency

     const containerRef = useCallback((node: HTMLDivElement | null) => {
       if (node) {
         const observer = new ResizeObserver(entries => {
           handleWidthChange(entries[0].contentRect.width);
         });
         observer.observe(node);

         return () => observer.disconnect();
       }
     }, [handleWidthChange]);

     return <div ref={containerRef}>...</div>;
   }

**Why This Works:**

- Refs don’t trigger re-renders when updated
- ``handleWidthChange`` only recreates when ``gridCols`` changes (actual
  layout change)
- Refs always hold the latest ``currentProfile`` and ``updateSettings``
- ResizeObserver doesn’t get recreated unnecessarily
- No infinite loop

**When to Apply This Pattern:**

Anytime you have: - A callback with Zustand/hook values in dependencies
(``useCallback``, ``useEffect``) - That callback is triggered by
external events (ResizeObserver, timers, listeners) - The callback
updates state or calls actions

Use refs to hold the unstable values instead of putting them in
dependencies.

Montage Page
------------

**Location**: ``src/pages/Montage.tsx``

Displays all monitors in an edge-to-edge grid layout for simultaneous
viewing. Uses ``react-grid-layout`` with a fixed 12-column internal grid
so items can be resized to any width while the user selects 1–5 "display
columns" as a default.

.. _architecture-1:

Architecture
~~~~~~~~~~~~

The page delegates layout logic to dedicated hooks from
``src/components/montage/``:

- **useMontageGrid** – manages layout state, column calculations,
  aspect-ratio-aware height, saved layout persistence, and migration
  from older layout formats.
- **useContainerResize** – wraps ``ResizeObserver`` with debounced
  width tracking (first measurement fires immediately; subsequent
  changes debounce at 500 ms).
- **useFullscreenMode** – toggles fullscreen via the Fullscreen API.

.. code:: tsx

   import {
     GridLayoutControls,
     FullscreenControls,
     useMontageGrid,
     useContainerResize,
     useFullscreenMode,
   } from ‘../components/montage’;
   import { INTERNAL_COLS } from ‘../components/montage/hooks/useMontageGrid’;

   export default function Montage() {
     const { currentProfile, settings } = useCurrentProfile();
     const { data: monitors } = useQuery({ ... });

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
         margin={[0, 0]}              // edge-to-edge
         containerPadding={[0, 0]}
         onLayoutChange={handleLayoutChange}
         onResizeStop={handleResizeStop}
       >
         {layout.map(item => (
           <MontageMonitor key={item.i} monitor={...} />
         ))}
       </WrappedGridLayout>
     );
   }

12-Column Internal Grid
~~~~~~~~~~~~~~~~~~~~~~~

``INTERNAL_COLS = 12`` is the fixed column count passed to
``react-grid-layout``. The user’s "display columns" setting (1–5)
controls default item width: ``w = 12 / displayCols``. Items can be
resized to any width 1–12 for mixed sizes; vertical compaction reflows
items automatically.

Saved Layouts
~~~~~~~~~~~~~

Users can save, load, and delete named layouts. Each saved layout stores
the ``Layout[]`` array and the ``displayCols`` at save time.

- **Save**: ``handleSaveLayout(name)`` persists to profile settings via
  ``saveMontageLayout()`` in the settings store.
- **Load**: ``handleLoadSavedLayout(layout, displayCols)`` restores the
  grid and column count.
- **Delete**: ``handleDeleteLayout(index)`` removes from the saved list.
- **Active name**: ``settings.montageActiveLayoutName`` tracks which
  saved layout is currently loaded (cleared when the user switches to a
  preset column count).

Layout Migration
~~~~~~~~~~~~~~~~

``migrateLayout()`` in ``useMontageGrid`` handles old layouts where
``w`` values ranged 1–5 (matching the old column count). If
``max(w) <= 5``, it scales ``w`` and ``x`` into the 12-column space:
``w * (12 / displayCols)``.

Aspect-Ratio Height Calculation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Each grid item’s height is computed from the monitor’s aspect ratio:

.. code:: typescript

   const CARD_HEADER_HEIGHT = 32;  // h-8 header bar
   const columnWidth = (gridWidth - margin * (INTERNAL_COLS - 1)) / INTERNAL_COLS;
   const itemWidth = columnWidth * widthUnits + margin * (widthUnits - 1);
   const videoPx = itemWidth * (height / width);  // from monitor dimensions
   const heightPx = videoPx + CARD_HEADER_HEIGHT;
   const unit = (heightPx + margin) / (rowHeight + margin);
   return Math.max(2, Math.ceil(unit));

Toolbar Toggle
~~~~~~~~~~~~~~

An eye-toggle button in the title row shows/hides the toolbar
(group filter, grid controls, fit selector, refresh, edit, fullscreen).
State is stored in ``settings.montageShowToolbar`` and persisted per
profile. The i18n key is ``montage.toggle_toolbar``.

The ResizeObserver / Zustand Infinite Loop
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Montage uses ``ResizeObserver`` to track container width and Zustand to
persist settings. This combination can cause infinite loops when
callbacks reference unstable Zustand selectors or ``useTranslation()``’s
``t`` function (both create new references each render).

The fix is the ref-based pattern used throughout ``useMontageGrid``:

.. code:: tsx

   // Refs for unstable values
   const currentProfileRef = useRef(currentProfile);
   const settingsRef = useRef(settings);
   const tRef = useRef(t);

   useEffect(() => {
     currentProfileRef.current = currentProfile;
   }, [currentProfile]);

   // Callbacks only use refs + primitives – no unstable deps
   const handleWidthChange = useCallback((width: number) => {
     // ... uses currentProfileRef.current, settingsRef.current
   }, []);  // stable

This same pattern was applied in DashboardLayout first, then Montage.
Watch for it whenever ``ResizeObserver`` + Zustand appear together.

Monitors Page
-------------

**Location**: ``src/pages/Monitors.tsx``

Displays all monitors for the current profile in a list or grid view.

.. _architecture-2:

Architecture
~~~~~~~~~~~~

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
           <div className="flex items-center gap-2">
             <Button variant="outline" size="icon" onClick={() => refetch()}>
               <RefreshCw className="h-4 w-4" />
             </Button>
           </div>
         </div>
         {settings.monitorsViewMode === 'grid' ? (
           <MonitorGrid monitors={data!.monitors} />
         ) : (
           <MonitorList monitors={data!.monitors} />
         )}
       </div>
     );
   }

**Key Points:**

- Uses React Query for data fetching
- Refetch interval comes from ``useBandwidthSettings()`` — never hardcoded
- Handles loading/error states
- Switches between list/grid view modes via profile-scoped settings
- All state managed via Zustand stores

MonitorDetail Page
------------------

**Location**: ``src/pages/MonitorDetail.tsx``

Full-screen view of a single monitor with live stream.

.. _architecture-3:

Architecture
~~~~~~~~~~~~

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

**Stream URL Generation:**

Stream URLs are built by helpers in ``src/lib/url-builder.ts``
(``getMonitorStreamUrl``, ``getMonitorControlUrl``, ``getEventZmsUrl``,
``getGo2RTCStreamUrl``, etc.). These helpers handle ``connkey``
generation, token attachment, and protocol selection — pages and
components should never hand-build ZM stream URLs.

Event thumbnails go through ``src/lib/thumbnail-chain.ts`` which
chooses among ``zms``, cached, or API sources based on availability.

All non-stream HTTP traffic uses ``httpGet`` / ``httpPost`` /
``httpPut`` / ``httpDelete`` from ``src/lib/http.ts`` — never raw
``fetch()`` or ``axios``.

Events Page
-----------

**Location**: ``src/pages/Events.tsx``

Displays a timeline/list of recorded events.

.. _architecture-4:

Architecture
~~~~~~~~~~~~

.. code:: tsx

   export default function Events() {
     const { t } = useTranslation();
     const { currentProfile } = useCurrentProfile();
     const [filters, setFilters] = useState({ monitorId: null, date: null });

     const { data, isLoading, fetchNextPage, hasNextPage } = useInfiniteQuery({
       queryKey: ['events', currentProfile?.id, filters],
       queryFn: ({ pageParam = 0 }) =>
         getEvents({ ...filters, page: pageParam }),
       getNextPageParam: (lastPage) => lastPage.nextPage,
       enabled: !!currentProfile,
     });

     return (
       <div className="p-3 sm:p-4 md:p-6 space-y-4">
         <div className="flex items-center justify-between">
           <h1 className="text-base sm:text-lg font-bold tracking-tight">
             {t('events.title')}
           </h1>
         </div>
         <EventFilters filters={filters} onChange={setFilters} />
         <EventTimeline
           events={data?.pages.flatMap((p) => p.events)}
           onLoadMore={fetchNextPage}
           hasMore={hasNextPage}
         />
       </div>
     );
   }

**Infinite Scroll:**

Uses ``useInfiniteQuery`` from React Query to load events incrementally
as the user scrolls.

ProfileForm Page
----------------

**Location**: ``src/pages/ProfileForm.tsx``

Create and edit ZoneMinder server profiles.

.. _architecture-5:

Architecture
~~~~~~~~~~~~

.. code:: tsx

   export default function ProfileForm() {
     const { id } = useParams<{ id?: string }>();  // Optional - create vs edit
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

     // Load existing profile if editing
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
       } catch (error) {
         toast.error(t('profile.connection_failed'));
       }
     };

     const handleSave = () => {
       if (id) {
         updateProfile(id, formData);
       } else {
         const newProfile = { ...formData, id: generateId() };
         addProfile(newProfile);
       }

       navigate(-1);
     };

     return (
       <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
         <div className="flex items-center gap-2">
           <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
             <ArrowLeft className="h-4 w-4" />
           </Button>
           <h1 className="text-lg font-bold tracking-tight">
             {id ? t('profile.edit') : t('profile.create')}
           </h1>
         </div>

         <Card>
           <CardContent className="space-y-4 pt-6">
             <div className="space-y-2">
               <Label htmlFor="profile-name">{t('profile.name')}</Label>
               <Input
                 id="profile-name"
                 value={formData.name}
                 onChange={(e) =>
                   setFormData({ ...formData, name: e.target.value })
                 }
               />
             </div>
             {/* More form fields... */}
           </CardContent>
         </Card>

         <div className="flex gap-2">
           <Button variant="outline" onClick={handleTestConnection}>
             {t('profile.test_connection')}
           </Button>
           <Button onClick={handleSave}>{t('common.save')}</Button>
         </div>
       </div>
     );
   }

**Connection Testing:**

Before saving, users can test the connection to verify credentials and
server accessibility.

Secondary Views
---------------

Logs Page
~~~~~~~~~

**Location**: ``src/pages/Logs.tsx``

Provides a unified view of both application logs (ephemeral, stored in
memory) and ZoneMinder server logs (fetched via API).

**Key Features**:

- Toggle between App (zmNinjaNg) and Server logs
- Filter by log level (DEBUG, INFO, WARN, ERROR)
- Filter by component (e.g., specific monitor or service)
- Export logs to file or share (mobile)
- Live server log fetching

Notification System
~~~~~~~~~~~~~~~~~~~

**Pages**:

- **History**: ``src/pages/NotificationHistory.tsx`` - List of past
  notifications with read status, event thumbnails, and tap-to-navigate.
- **Settings**: ``src/pages/NotificationSettings.tsx`` - Notification
  configuration, including:

- **Connection status badge**: Shows connected/disconnected (ES mode)
  or "Direct mode active" (Direct mode)
- **Mode selector**: Choose between Event Server (ES) and Direct mode.
  Direct mode is auto-detected and greyed out if the ZM server lacks
  the Notifications API.
- **ES mode settings**: WebSocket host, port, SSL toggle, connect/
  disconnect controls, advanced options (toasts, sounds)
- **Direct mode settings**: Polling interval (10s–120s), detected-
  events-only filter
- **Per-monitor filters**: Toggle notifications per camera with
  configurable check intervals
- **Push notification registration**: FCM token registered with either
  ES (via WebSocket) or ZM (via REST API) depending on mode

Server Status
~~~~~~~~~~~~~

**Location**: ``src/pages/Server.tsx``

Dashboard for server health and control.

**Features**:

- Version information (API & Core)
- System Load and Disk Usage metrics
- Daemon status check
- ZoneMinder Run State management (Start/Stop/Restart)

Timeline View
~~~~~~~~~~~~~

**Location**: ``src/pages/Timeline.tsx``

A visualization of events over time using ``vis-timeline``.

**Implementation details**:

- Uses ``vis-timeline/standalone`` for rendering
- Groups events by Monitor
- Color-coded by Monitor ID for visual distinction
- Interactive zooming and panning
- “Quick Range” buttons for common timeframes (1h, 8h, 24h)

Common Page Patterns
--------------------

1. Profile Requirement Check
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Most pages require a selected profile. Read the active profile via the
``useCurrentProfile()`` hook (``src/hooks/useCurrentProfile.ts``) — it
returns ``{ currentProfile, settings, hasProfile }``. The Zustand store
itself only holds ``currentProfileId: string | null`` plus the profile
list, so don't try to select a ``currentProfile`` field on the store
directly.

.. code:: tsx

   const { currentProfile } = useCurrentProfile();

   if (!currentProfile) {
     return <ProfileRequired />;
   }

If you only need the id (e.g., for a query key), select it from the
store directly:

.. code:: tsx

   const currentProfileId = useProfileStore((state) => state.currentProfileId);

2. Data Fetching with React Query
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const { data, isLoading, error } = useQuery({
     queryKey: ['resource', id],
     queryFn: () => fetchResource(id),
     enabled: !!currentProfile,  // Only fetch if profile exists
   });

3. Loading/Error States
~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   if (isLoading) return <Skeleton />;
   if (error) return <ErrorDisplay error={error} />;
   if (!data) return <EmptyState />;

   return <Content data={data} />;

4. Navigation
~~~~~~~~~~~~~

.. code:: tsx

   const navigate = useNavigate();

   // Push new route (can go back)
   navigate('/monitor/123');

   // Replace route (can't go back)
   navigate('/dashboard', { replace: true });

   // Go back
   navigate(-1);

Key Takeaways
-------------

1. **Infinite loops from ResizeObserver**: Use refs for Zustand values
   in callbacks
2. **React Query for data**: Server state with automatic caching and
   refetching; intervals come from ``useBandwidthSettings()``
3. **Profile requirement**: Most pages need a selected profile — read it
   via ``useCurrentProfile()``
4. **Page shell**: Plain ``<div>`` with Tailwind classes plus shadcn/ui
   primitives (``Button``, ``Card``, ``Input``, ``Select``); outer
   chrome comes from ``AppLayout``
5. **Error boundaries**: Wrap pages to catch component errors
6. **Loading states**: Always show skeleton/spinner while fetching
7. **Internationalization**: All user-facing text uses ``t()`` function
8. **Navigation**: Use React Router v7's ``useNavigate`` hook
9. **HTTP**: Use ``httpGet`` / ``httpPost`` from ``lib/http.ts``; build
   stream URLs with ``lib/url-builder.ts`` helpers

Next Steps
----------

Continue to `Chapter 5: Component
Architecture <05-component-architecture>` to learn about the
reusable components used across these pages.
