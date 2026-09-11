Key Libraries
=============

zmNinjaNg leans on a small number of third-party libraries, and each one is
here because it solves a problem the platform does not. What follows is what
each library is used for in this codebase and where it bites. One dependency,
``@capacitor/preferences``, is declared in ``app/package.json`` and imported
nowhere in ``app/src``: storage goes through ``localStorage`` under Zustand's
``persist`` middleware, or through ``lib/security/secureStorage.ts`` when the
value is a credential.

UI and Visualization
--------------------

react-grid-layout
~~~~~~~~~~~~~~~~~

The Dashboard's drag-and-drop grid.
``components/dashboard/DashboardLayout.tsx`` imports ``GridLayout`` and wraps it
once at module scope: ``const WrappedGridLayout = WidthProvider(GridLayout)``.
``WidthProvider`` measures the container and feeds its width down, which the
grid needs because it positions items in pixels rather than CSS columns.

The reason it fits here is the shape of what it hands back. A layout is a plain
object: ``{ i, x, y, w, h }``, with optional ``minW`` and ``minH``. That is the
``WidgetLayout`` interface in ``stores/dashboard.ts``, and it drops straight
into the persisted store (keyed by profile id, under
``STORAGE_KEYS.dashboardStore``) with no adapter and no reconstruction on load.
A dragged widget stays where the user put it across restarts because saving the
layout is just saving that object. Each widget keeps both a single ``layout``
and a ``layouts`` map of one entry per breakpoint.

The gotcha is drag capture: a widget whose content is itself interactive will
fight the grid for the pointer, which is why ``DashboardWidget.tsx`` is
particular about where the drag handle lives.

The montage screen borrows react-grid-layout's ``Layout`` type
(``components/montage/hooks/useMontageGrid.ts``, and ``MontageSavedLayout`` in
``stores/settings.ts``) without ever rendering a ``GridLayout``. Montage tiles
are positioned by the montage code itself.

video.js
~~~~~~~~

MP4 event playback, in ``components/events/Mp4EventPlayer.tsx``, the only file
that imports the video.js runtime. (``contexts/PipContext.tsx`` imports its
types only, with ``import type videojs from 'video.js'``.) ``videojs-markers``
draws event points on the seek bar; the marker configs are built in
``lib/event/video-markers.ts`` and applied to the player there.

ZoneMinder streams vary in format (MJPEG, multiple MP4 profiles), and the
native ``<video>`` element handles those inconsistently across browsers.
video.js gives one API and a plugin surface over the differences.

Neither live monitor streams nor ZMS event playback go through video.js. ZMS
delivers a multipart JPEG stream, not a container format a video element can
consume, so ``components/events/ZmsEventPlayer.tsx`` binds it to an ``<img>``
element instead. ``components/monitors/LiveMonitorPlayer.tsx`` does the same for
the MJPEG path, and falls back to it when the WebRTC path (go2rtc, via
``lib/vendor/go2rtc/video-rtc.js``) is unavailable or fails. See
:doc:`go2rtc-integration`.

lucide-react
~~~~~~~~~~~~

The icon set. Icons are imported by name and sized with Tailwind classes rather
than props, and ``h-4 w-4`` is the size almost every call site uses:
``<RefreshCw className="h-4 w-4" />``.

@radix-ui/\*
~~~~~~~~~~~~

Headless primitives behind the popovers, dialogs, dropdowns, and switches,
styled with Tailwind through the ``shadcn/ui`` pattern. Radix ships no visual
design at all, which leaves the look entirely to Tailwind while keeping
keyboard navigation and screen-reader semantics correct, and those are the part
that is expensive to get right by hand (I3).

recharts
~~~~~~~~

Charting for dashboard widgets. ``components/dashboard/widgets/TimelineWidget.tsx``
uses ``BarChart``, ``Bar``, ``XAxis``, ``YAxis``, ``Tooltip``, and
``ResponsiveContainer`` to plot event counts over time.

Data and Logic
--------------

date-fns
~~~~~~~~

Date arithmetic and formatting. The functions actually imported across
``app/src`` are ``format``, ``parseISO``, ``formatDistanceToNow``, ``isToday``,
``isYesterday``, and arithmetic helpers such as ``addHours``, ``addDays``,
``subDays``, ``startOfHour``, ``startOfDay``, ``startOfWeek``, ``startOfMonth``,
and ``differenceInDays``.

Never call date-fns ``format()`` with a literal pattern for anything a user
sees. User-visible dates and times go through ``useDateTimeFormat()`` inside
React components, or ``formatAppDate`` / ``formatAppTime`` / ``formatAppDateTime``
from ``lib/format-date-time.ts`` outside React. Those wrappers are the only
place that calls date-fns ``format()``, and they read the user's chosen date and
time format from profile settings before doing so. This is the Date and time
contract in ``AGENTS.project.md``, and it covers canvas rendering, tooltips, and
scrubber overlays as much as it covers JSX.

Two things that look like date-fns but are not. Relative labels such as "5m ago"
come from ``Intl.RelativeTimeFormat`` in ``lib/relative-time.ts``, because it
localizes into all five bundled languages without shipping locale files.
Converting ZoneMinder's server-local timestamps for display uses
``Intl.DateTimeFormat`` with an explicit ``timeZone`` in ``lib/time.ts``. The
separate ``date-fns-tz`` package is used only by the assistant, where
``toZonedTime`` and ``fromZonedTime`` resolve a spoken time range ("yesterday
evening") into the server's timezone before it becomes an API query
(``lib/assistant/event-range.ts``, ``window-interpreter.ts``,
``timeframe-stage.ts``, ``system-prompt.ts``).

react-hook-form & zod
~~~~~~~~~~~~~~~~~~~~~

Profile creation and the settings forms. Zod schemas describe the data shape and
its validation rules, react-hook-form owns the field state and the render
cycle.

Pairing them pays off because a Zod schema is two things at once: a runtime
check and, through ``z.infer``, a TypeScript type. Form input and the API
payload are derived from the same declaration, so they cannot drift apart while
one side is edited.

That runtime half matters at the network boundary, where TypeScript has nothing
to offer. An ``interface`` is erased before the code runs, so nothing stops a
ZoneMinder server from returning a login response with no ``access_token`` and
nothing stops the app from reading it as a string. ``api/auth.ts`` therefore
runs ``LoginResponseSchema.parse(response.data)`` (the schema lives in
``api/types.ts``) and fails at the seam, with the received keys logged, instead
of far downstream where the symptom is an unexplained 401.

@tanstack/react-query
~~~~~~~~~~~~~~~~~~~~~

React Query holds every piece of data that came from a ZoneMinder server: the
monitor list, event pages, server status, daemon health. The problem it solves
is that this data is a cache of somebody else's state, not this app's state. It
can go stale while the user is looking at it, two screens can want it at once,
and a request can fail halfway. Putting it in a Zustand store would mean
hand-writing loading flags, error flags, deduplication, and refetch timers for
each screen.

Instead, each piece of server data is identified by a **query key**, and React
Query owns the cache entry behind that key: who is fetching it, when it last
succeeded, whether it needs refetching. Two components asking for the same key
share one network request and one cache entry. Every key in this codebase comes
from the ``queryKeys`` factory in ``lib/query/query-keys.ts`` rather than an
inline array, so that a mutation invalidating a key cannot drift out of sync
with the queries reading it (the Server queries contract in ``AGENTS.project.md``).

The Events page's endless list is the exception worth knowing about. It is not
``useInfiniteQuery``: ``hooks/useEventPagination.ts`` keeps a growing result
count in ``useState`` (mirrored into a store so it survives remounts) and
``pages/Events.tsx`` re-runs a plain ``useQuery`` with
``placeholderData: keepPreviousData``, so the visible rows do not blank out
while the larger page is in flight.

``staleTime`` and ``refetchInterval`` are the two options that get configured
most. Never hardcode the interval: read it from ``useBandwidthSettings()`` so
that low-bandwidth mode slows every poller at once (the Polling contract).

React Query's model (queries, keys, the cache, and why a component re-renders
when the cache entry changes) is taught in :doc:`02-react-fundamentals`. How
this app wires it to ZoneMinder, including the query-key factory, invalidation,
error walls, and the polling intervals, is in :doc:`07-api-and-data-fetching`.

Mobile and Platform
-------------------

@capacitor/\*
~~~~~~~~~~~~~

Native device feature access for iOS and Android. The plugins imported by
``app/src`` are:

- **Core** (``@capacitor/core``): platform detection (``isNativePlatform``).
- **App** (``@capacitor/app``): the ``appStateChange`` and ``pause`` lifecycle
  events. Used to flush the log buffer on background and to clear the
  notification badge on resume.
- **Filesystem**: writes the persistent log file (``lib/log-file/capacitor.ts``)
  and exports logs from the Logs page.
- **Network**: detects network status changes on native platforms
  (WiFi/cellular transitions). Used by ``useNotificationAutoConnect`` to
  trigger an immediate WebSocket reconnect when connectivity is restored.
- **Haptics**, **Share**, **SplashScreen**: as their names suggest.

Saved snapshots and videos do not go through Filesystem alone.
``services/download.ts`` writes the file, then hands it to
``@capacitor-community/media`` (``Media.savePhoto`` / ``Media.saveVideo``) so it
lands in the device gallery rather than in app-private storage.

Push notifications do not use ``@capacitor/push-notifications``. They use
``@capacitor-firebase/messaging``, which handles APNS and FCM tokens through
one Firebase API. Badge counts use ``@capawesome/capacitor-badge``.

Credentials are encrypted through ``lib/security/secureStorage.ts``, which
delegates to ``@aparajita/capacitor-secure-storage`` on iOS and Android.
Biometric unlock uses ``@aparajita/capacitor-biometric-auth``.

Capacitor exists here so iOS and Android ship from the same web codebase, with
a drop into a native plugin only where the web API has nothing to offer. Per
the Native contract in ``AGENTS.project.md``, those plugins are loaded with
dynamic ``import()`` behind a platform check, never a static import, because a
static import of a native-only plugin breaks the web and Electron builds at
bundle time.

Internationalization
--------------------

i18next & react-i18next
~~~~~~~~~~~~~~~~~~~~~~~

Translations reach components through ``const { t } = useTranslation()``, and
the strings live in one JSON file per language under ``src/locales/``. No
hardcoded user-facing strings, and all seven languages (en, de, es, fr, it, ru,
zh) are updated in the same commit; that is the Localization contract, and
:doc:`09-contributing` explains why a missing key does not look like a bug.

Neither language picker keeps its own list. ``hooks/useLanguageOptions.ts``
reads the codes in ``locales/resources.ts``, labels each with the name that
language uses for itself, and returns English first with the rest sorted by
label. Adding the locale to that map is therefore the only edit a new
language needs on the React side.

Constants
---------

Named constants are first-party code, not a library, and the Constants contract
in ``AGENTS.project.md`` owns where they live: app-level values in
``lib/zmninja-ng-constants.ts``, ZoneMinder protocol values in
``lib/zm/zm-constants.ts``. The split is by who owns the value. ZoneMinder owns
what is in ``zm-constants.ts``, so changing one of those is a protocol
violation rather than tuning.
