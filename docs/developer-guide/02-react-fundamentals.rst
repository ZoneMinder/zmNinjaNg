React Fundamentals
==================

A primer for backend or systems programmers picking up React for the
first time. Written in roughly the order you need to know things.

zmNinjaNg renders to the DOM on every platform (web, Electron desktop,
Capacitor mobile webview). Examples below use plain HTML tags.

Mental shift
------------

In a typical web stack you tell the DOM what to change:

.. code:: javascript

   document.getElementById('count').textContent = count;
   if (count > 5) button.classList.add('warning');

Every event handler walks the DOM, finds elements, mutates them. As
features grow, handlers mutate the same elements without knowing about
each other, and the page drifts out of step with the data.

React inverts that. You write a function that returns *what the UI
should look like for the current data*, and React handles the DOM:

.. code:: jsx

   function CounterDisplay({ count }) {
     return (
       <button className={count > 5 ? 'warning' : ''}>
         Clicked {count} times
       </button>
     );
   }

When ``count`` changes, React re-runs ``CounterDisplay``, compares the
new output to the old one, and updates only the parts of the DOM that
changed. You never write the update code.

JSX
---

JSX is the ``<button>...</button>`` syntax embedded in JavaScript. It
is not HTML; it compiles to ``React.createElement`` calls.

.. code:: tsx

   const element = <span>Hello</span>;
   // compiles to:
   const element = React.createElement('span', null, 'Hello');

``React.createElement`` does not touch the DOM. It returns an
**element**: a plain JavaScript object describing what should be
rendered. React compares this render's elements against the previous
render's elements and uses the difference to decide which DOM nodes to
create, update, or remove.

JSX adds three rules on top of JavaScript:

1. **Embed JS expressions in ``{}``**: ``<span>Hello, {name}</span>``,
   ``<button disabled={isLoading}>``, ``<ul>{items.map(...)}</ul>``.
2. **Return one root element**, or wrap multiple in a fragment ``<>...</>``.
3. **HTML attributes get JS-style names**: ``className`` (not ``class``),
   ``onClick`` (not ``onclick``), ``htmlFor`` (not ``for``).

Components
----------

A component is a function whose name starts with a capital letter and
which returns JSX. Capitalization matters: ``<welcome>`` is treated as
an HTML element, ``<Welcome>`` as your component.

.. code:: tsx

   function Welcome({ name }: { name: string }) {
     return <p>Hello, {name}!</p>;
   }

   // Use it like an HTML tag:
   <Welcome name="Alice" />   // renders: Hello, Alice!

The Monitors page (``app/src/pages/Monitors.tsx``) is a component that
renders one ``MonitorCard`` per monitor, and each card renders a player,
badges, and buttons.

A real one from zmNinjaNg, simplified from
``app/src/components/monitors/MonitorCard.tsx`` (the original also
handles hover previews, muting, and a compact layout). It uses a few
things not introduced yet: calls starting with ``use`` are hooks,
covered later in this chapter; take them on faith for now:

.. code:: tsx

   function MonitorCardComponent({ monitor, status, onShowSettings }: MonitorCardComponentProps) {
     const navigate = useNavigate();
     const runState = getMonitorRunState(monitor, status, zmVersion);

     return (
       <Card data-testid="monitor-card">
         <div onClick={() => navigate(`/monitors/${monitor.Id}`)} data-testid="monitor-player">
           <LiveMonitorPlayer monitor={monitor} profile={currentProfile} />
         </div>
         <span className={cn('block h-2 w-2 rounded-full', monitorDotColor(runState))} />
         <div data-testid="monitor-name">{monitor.Name}</div>
         <Badge variant="outline">{monitor.Id}</Badge>
         <Button onClick={handleShowSettings} data-testid="monitor-settings-button">
           {t('sidebar.settings')}
         </Button>
       </Card>
     );
   }

``Card``, ``Badge``, ``Button`` are zmNinjaNg components built on top
of the shadcn/ui primitives in ``app/src/components/ui/``. The pattern
is the same as ``Welcome``: a function that returns JSX.

Not everything in that snippet is React. Every interactive element
carries a ``data-testid`` because the e2e suite selects on it, and no
user-facing string is written inline: ``t()`` looks it up in the seven
translation files. Both are house rules. No lint checks either one;
code review does.

Props: data flowing in
----------------------

Props are how a parent hands data to a child. They are read-only from
the child's perspective.

.. code:: tsx

   // app/src/api/types.ts
   export interface MonitorCardProps {
     monitor: Monitor;
     status: MonitorStatus | undefined;
     eventCount?: number;
     objectFit?: React.CSSProperties['objectFit'] | 'flex';
     compact?: boolean;
   }

   // app/src/components/monitors/MonitorCard.tsx
   interface MonitorCardComponentProps extends MonitorCardProps {
     /** Callback to open the settings dialog for this monitor */
     onShowSettings: (monitor: MonitorCardProps['monitor']) => void;
   }

``status`` is ``MonitorStatus | undefined`` because a card can render
before the status query has returned, so the component handles the gap
rather than assuming the data is there.

To send data the *other* way (child notifies parent), the parent passes
a function as a prop. By convention these props start with ``on``
(``onClick``, ``onShowSettings``). The child calls them; the parent
decides what to do. That is why ``onShowSettings`` lives on
``MonitorCardComponentProps`` and not on the shared ``MonitorCardProps``
in ``api/types.ts``: the data shape is common to every consumer, the
callback belongs to the one component that renders a settings button.

How this codebase writes a component
------------------------------------

A few conventions that React does not enforce but the rest of the guide
assumes. ``ZoneLegend`` shows most of them at once:

.. code:: tsx

   // app/src/components/monitors/ZoneLegend.tsx
   interface ZoneLegendProps {
     zones: Zone[];
     monitorId: string;
     visible: boolean;
     positionClassName?: string;
   }

   export function ZoneLegend({ zones, monitorId, visible, positionClassName = 'top-2 left-2' }: ZoneLegendProps) {
     // ... hooks first ...
     if (!visible || presentTypes.length === 0) {
       return null;
     }
     return ( /* ... */ );
   }

**Props get an interface**, named ``<Component>Props``. Use ``type``
instead when you are naming a union or an intersection rather than an
object shape: ``export type MonitorRunState = 'live' | 'warning' |
'offline' | 'disabled'`` in ``lib/monitor/monitor-status.ts``.

**Destructure props in the parameter list**, not in the body. Defaults
go right there too (``positionClassName = 'top-2 left-2'``), which is
why the component never has to test for ``undefined``.

**Exported functions declare their return type.** The compiler then
flags a body that returns something other than the declared type:
``export const getMaxColsForWidth = (width: number, minWidth: number, gap: number): number =>``
in ``lib/event/event-utils.ts``.

**Never ``any``.** Use ``unknown`` and narrow. React Query hands errors
back as ``unknown`` because a query function can throw anything, so
``resolveQueryError(err: unknown, t: TFunction)`` narrows before it
touches a field (``lib/query/query-error.ts``). ``any`` turns off
checking for that value, so reading a field it does not have still
compiles. ``unknown`` forces the
narrowing to be written down.

**Guard with early returns.** ``if (!visible) return null;`` reads
better than wrapping the whole tree in a conditional, and returning
``null`` from a component is how you render nothing. One constraint,
from the rules of hooks below: every hook the component calls must run
before any conditional ``return``, or the hook count changes between
renders.

State: data the component owns
------------------------------

Props come from outside. **State** is data a component owns and can
change. When state changes, the component re-renders.

.. code:: tsx

   import { useState } from 'react';

   function Counter() {
     const [count, setCount] = useState(0);  // declare state with initial value 0
     return (
       <button onClick={() => setCount(count + 1)}>
         Count: {count}
       </button>
     );
   }

``useState`` returns ``[currentValue, setterFunction]``. Calling the
setter schedules a re-render with the new value.

State updates are batched
~~~~~~~~~~~~~~~~~~~~~~~~~

State updates inside the same event handler are queued and applied
together. The variable you read in your handler is **the value from
this render**. It does not update mid-handler.

.. code:: tsx

   const [count, setCount] = useState(0);

   const incrementTwice = () => {
     setCount(count + 1);  // count is 0 here, so this queues "set to 1"
     setCount(count + 1);  // count is STILL 0, so this queues "set to 1" again
     // Result: 1, not 2.
   };

If the new value depends on the previous one, use the **updater form**.
React will pass the latest queued value:

.. code:: tsx

   setCount(prev => prev + 1);
   setCount(prev => prev + 1);  // Result: 2

Rule of thumb: if your call to the setter mentions the current value
(``count + 1``, ``[...items, x]``), use the updater form.

How this goes wrong: mutating state in place
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

React decides whether state changed by comparing the new value to the
old one **by reference**. Mutating the existing array or object leaves
the reference identical, so React concludes nothing changed and skips
the re-render.

.. code:: tsx

   // Wrong: same array reference, no re-render.
   const addItem = (item) => {
     items.push(item);
     setItems(items);
   };

   // Right: a new array.
   const addItem = (item) => setItems(prev => [...prev, item]);

The same rule applies to Zustand store state, where mutating an object read from
``getState()`` silently skips every subscriber (:doc:`03-state-management-zustand`).

Render: what triggers it
------------------------

A component re-renders when:

1. Its own state changes (a setter was called).
2. Its props change.
3. Its parent re-renders. *Even if its props didn't change.*

By default, React does not compare props before re-rendering a child:
when a parent re-renders, all its children re-render too. We'll see how to opt out (``memo``) later.

A render is just a function call. React calls your component, gets the
returned JSX, compares it to the previous result, and patches the DOM.

Lists need stable keys
~~~~~~~~~~~~~~~~~~~~~~

When you render an array, React has to match each element in the new
render to the corresponding element in the old one. It cannot do that
positionally, because items get inserted, removed, and reordered. So it
matches on the ``key`` prop.

.. code:: tsx

   // app/src/pages/Monitors.tsx, trimmed
   {allMonitors.map(({ Monitor, Monitor_Status }) => (
     <MonitorCard
       key={Monitor.Id}
       monitor={Monitor}
       status={Monitor_Status}
       eventCount={eventCounts?.[Monitor.Id]}
       onShowSettings={handleShowSettings}
       objectFit={settings.monitorsFeedFit}
     />
   ))}

The key must identify the *item*, not its position. Using the array
index means that deleting the first monitor tells React "item 0 changed
its data" rather than "item 0 was removed". React keeps the first card's
DOM node and component state and pours the second monitor's data into
it. In this app that hands the wrong card a live video element, so the
stream keeps playing under the wrong monitor's name. ``Monitor.Id``
never moves, so the match is always right.

Each render is a snapshot
~~~~~~~~~~~~~~~~~~~~~~~~~

Functions defined *during* a render (event handlers, effect callbacks)
capture that render's values through closure. The variable they read
belongs to a call of the component function that has already returned,
so it can never be updated: a later render produces a different call,
with different variables, and a different set of functions closing over
them.

.. code:: tsx

   function Message() {
     const [text, setText] = useState('Hello');

     const handleClick = () => {
       setText('Goodbye');
       alert(text);   // alerts 'Hello', not 'Goodbye'.
                      // text in this closure is from the render that
                      // created handleClick.
     };

     return <button onClick={handleClick}>{text}</button>;
   }

After the click:

- ``setText('Goodbye')`` schedules a re-render with the new text.
- ``alert(text)`` runs immediately, *before* the re-render, using the
  ``text`` captured when ``handleClick`` was created.
- React then re-renders the component, which creates a *new*
  ``handleClick`` whose closure sees ``'Goodbye'``.

For an event handler this is the behavior you want: the handler acts on
the data the user was looking at when they pressed the button, not on
whatever arrived while the click was in flight. It stops being right in
long-lived effects and cleanup callbacks, which are created once and
called much later, by which time the values they captured describe a
state the app has left. Refs are the escape hatch there (see below).

Hooks
-----

A "hook" is a function whose name starts with ``use`` (``useState``,
``useEffect``, ``useRef``, ``useNavigate``...). Hooks are how a
component opts into React features.

Both rules below exist because React tracks which hook is which by the
order of calls within a render:

1. **Call hooks at the top level**, never inside loops, conditions,
   or nested functions.
2. **Call hooks only from React components or other hooks** (custom
   hooks). Plain helper functions can't use them.

If you break the first one, React's tracking gets out of sync and your state
gets shuffled into the wrong slots. The ESLint plugin catches it.

How this goes wrong: a hook behind an ``if``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

React stores hook state in a per-component list and walks that list in
call order on every render. Skipping a call on one render shifts every
later hook down a slot, so the second ``useState`` starts reading the
third one's value.

.. code:: tsx

   // Wrong: the hook count changes with userId.
   function Component({ userId }) {
     if (userId) {
       const [name, setName] = useState('');
     }
     const [error, setError] = useState(null);
   }

   // Right: call it unconditionally, branch on the value.
   function Component({ userId }) {
     const [name, setName] = useState('');
     const [error, setError] = useState(null);
     if (!userId) return <p>Select a user</p>;
   }

The same rule covers early ``return`` statements: every hook the component uses must be called before any conditional
return. For data fetching, the hook that must not be skipped has a
built-in way to sit idle instead, the ``enabled`` option described in
:doc:`07-api-and-data-fetching`.

The next sections cover the hooks you'll use constantly:
``useEffect``, ``useRef``, ``useMemo``, ``useCallback``.

useEffect: doing things after render
------------------------------------

Render functions should be pure: same inputs → same JSX, no side
effects. If you need to fetch data, set up a subscription, start a
timer, or touch the DOM directly, do it in ``useEffect``. The effect
runs *after* React has committed the render to the DOM.

.. code:: tsx

   useEffect(() => {
     fetchUser(userId).then(setUser);
   }, [userId]);

The second argument is the **dependency array**. It controls when the
effect re-runs:

.. code:: tsx

   useEffect(() => {});                 // every render
   useEffect(() => {}, []);             // once, on mount
   useEffect(() => {}, [userId]);       // whenever userId changes
   useEffect(() => {}, [a, b]);         // whenever a or b changes

If your effect creates something that needs tearing down (timer,
subscription, event listener), return a cleanup function. React calls
it before the next run of the effect, and once when the component
unmounts.

.. code:: tsx

   // app/src/hooks/useMonitorStream.ts
   // Snapshot mode: periodic refresh
   useEffect(() => {
     if (!enabled || effectiveViewMode !== 'snapshot') return;

     const interval = setInterval(() => {
       setCacheBuster(Date.now());
     }, settings.snapshotRefreshInterval * 1000);

     return () => clearInterval(interval);   // cleanup
   }, [enabled, effectiveViewMode, settings.snapshotRefreshInterval]);

Read the guard and the dependency array together. ``enabled`` is false
for a monitor card that the montage page has scrolled out of view. It
appears in the guard so no interval starts, and it appears in the deps
so that when a visible card scrolls away, the effect re-runs, the
cleanup fires, and the timer stops. A dependency you read in the effect
but leave out of the array is a dependency React cannot see: it will
keep running the old effect body against the old values.

Effects fire after every render whose dependencies changed. If you omit
the dependency array entirely, the effect runs after every render. An
effect that sets state and has no dependency array renders, sets state,
renders again, and never stops.

How this goes wrong: no cleanup
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

An effect that starts something and never stops it leaks. The component
unmounts, the interval keeps firing, and the callback keeps calling a
setter on a component React has already discarded.

.. code:: tsx

   // Wrong: the timer outlives the component.
   useEffect(() => {
     const timer = setInterval(() => refetchData(), 5000);
   }, []);

   // Right: return the teardown.
   useEffect(() => {
     const timer = setInterval(() => refetchData(), 5000);
     return () => clearInterval(timer);
   }, []);

The rule generalizes past timers. If the effect adds an event listener,
opens a WebSocket, or starts a ZoneMinder stream, the cleanup removes
the listener, closes the socket, or quits the stream. React calls the
cleanup before each re-run of the effect and once at unmount.

``main.tsx`` renders ``<App />`` inside ``<StrictMode>``, which changes
what you see while developing. On a development build React mounts each
component, runs its effects, runs every cleanup, and mounts again. An
effect that logs on setup therefore logs twice in ``npm run dev`` and
once in a production build, and that is not a bug. The double mount
exposes the opposite case. If the thing your effect
started is still running twice afterwards (two intervals ticking, two
streams open), the cleanup is not undoing everything the setup did.

useRef: a value that survives renders without triggering one
------------------------------------------------------------

``useState`` triggers a re-render. Sometimes you don't want that. You
need a value that:

- persists across renders, and
- can be updated without causing a re-render.

``useRef`` gives you that value.

.. code:: tsx

   const playerRef = useRef<HTMLVideoElement>(null);

   const play = () => playerRef.current?.play();

   return <video ref={playerRef} src="/clip.mp4" />;

The ``ref`` attribute is a special prop: React sets ``playerRef.current``
to the DOM node after mount.

**1. DOM access** (above): grab a real element to call imperative
methods like ``.play()``, ``.focus()``, ``.scrollIntoView()``.

**2. Escape the closure snapshot** in a long-lived effect or cleanup.
An unmount cleanup with ``[]`` deps is created during the mount render,
so by "Each render is a snapshot" above it closes over the values from
that render and nothing else. This is called
a **stale closure**. A ref is how you break out of one, because
``.current`` is read at call time rather than captured at definition
time.

zmNinjaNg needs this when it tears a stream down. Simplified
from ``app/src/hooks/useStreamLifecycle.ts``, which carries four more
fields (``token``, ``viewMode``, ``minStreamingPort``,
``cmdQuitTimeoutMs``) through the same ref:

.. code:: tsx

   // app/src/hooks/useStreamLifecycle.ts
   // Store cleanup parameters in ref to access latest values on unmount
   const cleanupParamsRef = useRef({
     monitorId: monitorId || '',
     monitorName: monitorName || '',
     connKey: 0,
     portalUrl,
   });

   // Update cleanup params whenever they change.
   useEffect(() => {
     if (!enabled) return;
     cleanupParamsRef.current = {
       monitorId: monitorId || '',
       monitorName: monitorName || '',
       connKey,
       portalUrl,
     };
   }, [enabled, monitorId, monitorName, connKey, portalUrl]);

   // Cleanup runs once on unmount, but reads the *latest* values via the ref.
   useEffect(() => {
     return () => {
       const params = cleanupParamsRef.current;
       void quitStreamForParams(params, logFn, 'unmount');
     };
   }, []);

``quitStreamForParams`` sends ZoneMinder's ``CMD_QUIT`` for
``params.connKey``. The connection key is regenerated whenever the
monitor changes, so it is almost never the value present at mount.
Without the ref the cleanup would quit a connection key that no longer
exists, the real stream would stay open on the server, and the user
would accumulate one orphaned ZMS process (``nph-zms``, ZoneMinder's
streaming server, which runs one process per open stream) per monitor
viewed.

The same ref feeds the teardown function the hook registers with
``app/src/lib/monitor/active-streams.ts`` for profile switches, for the
same reason: that function is registered once but called much later, and it must quit the stream that is running *then*.

Quick contrast:

================== ================== =======================
Feature            useState           useRef
================== ================== =======================
Triggers re-render Yes                No
Read/write         Async (via setter) Sync (via ``.current``)
Use for            UI state           DOM nodes, escape hatches
================== ================== =======================

useMemo and useCallback: stable references
------------------------------------------

Every render creates new objects, arrays, and functions, even if their
contents are identical. ``{ x: 1 }`` from this render is a different
reference than ``{ x: 1 }`` from the next.

That matters because React (and hooks like ``useEffect``) compare
values **by reference**. A new reference on every render means a hook
that depends on it re-runs on every render.

.. code:: tsx

   function Component({ userId }) {
     const params = { userId, limit: 50 };            // new object every render
     useEffect(() => { loadEvents(params); }, [params]);  // runs every render
   }

``useMemo`` caches a computed value across renders, only recomputing
when its dependencies change:

.. code:: tsx

   const params = useMemo(() => ({ userId, limit: 50 }), [userId]);
   useEffect(() => { loadEvents(params); }, [params]);  // runs only when userId changes

``useCallback`` is the same idea for functions:

.. code:: tsx

   const handleSubmit = useCallback(() => {
     saveProfile(form);
   }, [form]);

The second use of ``useMemo`` is to skip work rather than to stabilize
a reference. The Montage page sorts the list behind the kebab menu's
show-monitors entries, by owning server, then sequence number, then name:

.. code:: tsx

   // app/src/pages/Montage.tsx
   const visibilityItems = useMemo((): MontageVisibilityItem[] => {
     // ...profileRank/rank/sequence helpers omitted
     return [...scopedMonitors]
       .sort(
         (a, b) =>
           rank(a) - rank(b) ||
           sequence(a) - sequence(b) ||
           (a.item.Monitor.Name ?? '').localeCompare(b.item.Monitor.Name ?? '')
       )
       .map((s) => ({ /* id, name, profileChip */ }));
   }, [scopedMonitors, isAllMode]);

Note the ``[...scopedMonitors]``. ``Array.prototype.sort`` sorts in place
and returns the same array, so sorting ``scopedMonitors`` directly would
reorder the hook's array. The hook still holds that array, React Query still
has it in cache, and neither reference changed, so nothing re-renders to
show the new order and the cache is now silently corrupted. Copy first,
then sort. The same applies to ``reverse`` and ``splice``.

Use them when:

- The value is passed to ``React.memo``-wrapped children (see below).
- The value is a hook dependency.
- The computation is expensive (sorting a list, building a
  ``Set``).

Don't use them everywhere. They cost memory and add reading overhead.
A function used once inside a render and never passed down doesn't
need ``useCallback``.

Object identity and unstable dependencies
----------------------------------------------

Building on the previous section: this is a common
source of "why is this re-rendering / re-fetching forever" bugs.

.. code:: tsx

   { x: 1 } === { x: 1 }    // false
   [1, 2] === [1, 2]        // false
   () => {} === () => {}    // false

Hidden allocations are the easy ones to miss. ``new Date()`` in
a render body, an inline ``style={{ width: 100 }}``, an inline
``onChange={(e) => ...}``, and a ``{ ...defaults, ...props }`` spread
all mint a fresh reference on every render.

Four ways to fix an unstable dependency, in the order to reach for them:

.. code:: tsx

   // 1. Hoist it out of the component (it never depends on props or state).
   const CONFIG = { width: 100, height: 200 };
   function Component() { useEffect(() => { apply(CONFIG); }, []); }

   // 2. Depend on the primitive fields instead.
   useEffect(() => { resize(config.width); }, [config.width, config.height]);

   // 3. Memoize it.
   const config = useMemo(() => ({ width: props.width, height: 200 }), [props.width]);

   // 4. Mirror it in a ref (see below for when).
   const configRef = useRef(config);
   useEffect(() => { configRef.current = config; }, [config]);

Options 1 and 2 are free; prefer them. Option 3, ``useMemo``, is the
default for anything derived from props or state, and it is the right
answer for effect dependencies.

Option 4 is not interchangeable with option 3. A ref mirror holds the latest value where an effect
can read it without listing it as a dependency, so an effect that reads
``configRef.current`` will not re-run when ``config`` changes. Reach for it only when re-running is
what you must avoid, which in practice means a callback that would
otherwise tear down and rebuild a subscription, a listener, or a stream
on every keystroke. That is why ``useStreamLifecycle`` mirrors its
cleanup parameters rather than memoizing them: the unmount effect must
never re-run, and it must still see the current connection key.

If you use option 4 where option 3 belonged, you get an effect that
silently keeps working from data that has since moved on. That is the
stale closure again.

React.memo: skipping unnecessary renders
----------------------------------------

Recall that a child re-renders whenever its parent re-renders, by
default. For most components that's fine; re-rendering is cheap.

For expensive components (long lists, charts, video players),
``memo`` adds a shallow prop comparison. If every prop has the same
reference as last time, React skips the render entirely.

.. code:: tsx

   import { memo } from 'react';

   const ExpensiveChild = memo(function ExpensiveChild({ name }) {
     return <p>Hello, {name}</p>;
   });

In zmNinjaNg, list items use ``memo`` so one monitor's status update
doesn't re-render every card on screen:

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx
   export const MonitorCard = memo(MonitorCardComponent);

   // app/src/components/events/EventCard.tsx
   export const EventCard = memo(EventCardComponent);

The monitors page refetches monitor status every 20 seconds
(``bandwidth.monitorStatusInterval``), and each refetch re-renders the
page and therefore every card. A ``MonitorCard`` is a deep subtree: a
player, a hover preview, badges, a dropdown. ``memo`` lets the cards
whose ``monitor`` and ``status`` objects are unchanged skip that work
entirely.

Re-rendering a card does not by itself restart its stream. React
reconciles the existing player element in place, and the stream URL it
computes is the same string as before, so the ``<img>`` is never
re-fetched. What *does* restart a stream is a remount, which is what an
unstable ``key`` causes.

The catch: ``memo`` does a *shallow* prop check. If you pass an inline
object or inline function, it's a new reference on every parent render
and ``memo`` is defeated:

.. code:: tsx

   // memo can't help: both props are new each render.
   <ExpensiveChild
     config={{ width: 100 }}
     onSelect={(id) => setSelected(id)}
   />

   // Stabilize, then memo works:
   const config = useMemo(() => ({ width: 100 }), []);
   const handleSelect = useCallback((id) => setSelected(id), []);
   <ExpensiveChild config={config} onSelect={handleSelect} />

This codebase does not get this right everywhere.
``Monitors.tsx`` declares ``handleShowSettings`` in the render body
rather than wrapping it in ``useCallback``, so it is a new reference on
every render, and the ``memo`` on ``MonitorCard`` compares it and finds
it different. The cards re-render on every status poll regardless. The
memo is harmless, but it saves no renders until the callback is
stabilized. Check both halves before you assume a ``memo`` is working.

React Query: server state
-------------------------

Everything so far treats state as something a component owns. Data that
lives on the ZoneMinder server is owned by no component. Several screens
want the same monitor list at once, it goes out of date on its own
while nobody is looking, fetching it is slow, and every fetch can fail.

Written with ``useState`` and ``useEffect``, each screen re-implements
the same four things: a cache so the second screen doesn't refetch,
deduplication so two components mounting together fire one request,
loading and error flags, and some way to refresh after a write. That is
the code React Query replaces. zmNinjaNg uses it
(``@tanstack/react-query``) for every read of server data.

useQuery
~~~~~~~~

A query is a **key** that identifies some data plus a function that
fetches it. React Query caches the result under the key.

.. code:: tsx

   // app/src/hooks/useMonitors.ts
   import { useQuery } from '@tanstack/react-query';
   import { queryKeys } from '../lib/query/query-keys';
   import { getMonitors } from '../api/monitors';

   const { data, isLoading, error, refetch } = useQuery({
     queryKey: queryKeys.monitors(currentProfile?.id),
     queryFn: () => getMonitors(),
     enabled: (options?.enabled ?? true) && !!currentProfile?.id && isAuthenticated,
     refetchInterval: options?.refetchInterval ?? bandwidth.monitorStatusInterval,
   });

The key is the cache address. Two components that call ``useMonitors()`` produce the same
key, so they read the same cache entry, and if the request is still in
flight the second one attaches to it instead of issuing another. Both
re-render when the data lands. Nothing had to be lifted into a shared
parent or a store to make that happen.

Fresh and stale
~~~~~~~~~~~~~~~

A cache entry is *fresh* or *stale*. Fresh means React Query serves it and does
nothing else. Stale means React Query **still serves it** and starts a
background refetch, then re-renders the component when the new data
lands.

Stale does not mean hidden, missing, or loading. A stale query still
hands you ``data``. Misreading it as "no data yet" is how code ends up
treating a perfectly good cached list as an empty one.

Beyond those two ideas, what is left is this app's use of the library
rather than React itself, and it lives in
:doc:`07-api-and-data-fetching`: where query keys come from and why
they are never written inline, what
``staleTime`` is set to and why, how writes invalidate the reads they
affect, how ``enabled`` keeps a hook alive but idle, and where polling
intervals come from. Loading and error states get shared UI rather than
hand-rolled markup, covered there too.

Component communication
-----------------------

Data flows down through props; notifications flow back up through
callback props. Context can also hand data to a deep child without the
props in between; it is covered later (see the last section).

.. code:: tsx

   // app/src/pages/Monitors.tsx, trimmed  (parent owns the state)
   const handleShowSettings = (monitor: Monitor) => {
     setSelectedMonitor(monitor);
     setShowPropertiesDialog(true);
   };

   <MonitorCard monitor={Monitor} status={Monitor_Status} onShowSettings={handleShowSettings} />

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx  (child reports, doesn't decide)
   const handleShowSettings = (e: React.MouseEvent) => {
     e.stopPropagation();
     onShowSettings(monitor);
   };

The child does not open the dialog and does not know a dialog exists.
It reports that its settings button was pressed. The parent, which owns
``showPropertiesDialog``, decides what that means. Keeping the decision
next to the state is what stops two components from disagreeing about
whether the dialog is open.

State that belongs to no single parent (the active profile,
the log level) does not get threaded through six layers of props. It
goes in a Zustand store: :doc:`03-state-management-zustand`.

Clicks bubble
~~~~~~~~~~~~~

Note the ``e.stopPropagation()`` in that handler. A DOM click fires on
the element you pressed, then on each of its ancestors in turn. React
attaches its handlers on top of that mechanism, so an ``onClick`` on a
parent runs after the child's ``onClick``, without either one knowing
about the other.

That matters in card layouts, where a clickable region contains its own
buttons. Press the mute toggle and, if the toggle sits inside the
region that navigates to the monitor detail page, you toggle the audio
and then immediately leave the page.

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx
   <button
     onClick={(e) => { e.stopPropagation(); setIsMuted((m) => !m); }}
     data-testid="monitor-volume-btn"
   >

``stopPropagation`` ends the walk at that element, so the ancestor's
handler never runs. In ``MonitorCard`` as currently laid out these
guards are precautionary: only the thumbnail ``<div>`` carries the
navigate handler, and the buttons are siblings of it rather than
children. If someone later moves a button inside the clickable region,
a one-line JSX change, the guards stop that button from also navigating
away, a bug that would otherwise show up nowhere near the line that
caused it.

Putting it together
-------------------

A typical hook-heavy component does roughly this:

1. Reads props.
2. Calls ``useState`` for any UI-owned values.
3. Calls custom hooks (``useCurrentProfile``, ``useBandwidthSettings``,
   ``useQuery``...) to read shared data.
4. Computes derived values, sometimes wrapped in ``useMemo``.
5. Defines event handlers, sometimes wrapped in ``useCallback``.
6. Sets up effects (``useEffect``) for fetches, timers, subscriptions.
7. Returns JSX.

If something feels wrong (re-renders too often, an effect runs on
every render, a callback fires twice), common causes are:

- Forgot the dependency array on ``useEffect``.
- A dependency is an inline object/array/function (object identity).
- The component reads a value via a ref but isn't updating the ref.
- A parent passes new props on every render and the child isn't ``memo``'d.
- A ``memo``'d child receives one unstable prop, which defeats the rest.

Concepts taught elsewhere
-------------------------

Four more React mechanisms are deliberately absent here, because each
reads better against the code that first needs it. Context
(``contexts/PipContext.tsx``), error boundaries
(``components/montage/MontageTileErrorBoundary.tsx``), portals
(``components/ui/hover-preview.tsx``), and Suspense (``App.tsx``) are
introduced in the chapters covering the features that use them.
