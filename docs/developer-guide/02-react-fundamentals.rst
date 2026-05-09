React Fundamentals
==================

A primer for programmers unfamiliar with React's mental model. Examples
are taken from the zmNinjaNg codebase.

What is React?
--------------

React is a library for building UIs. Instead of manually mutating the DOM,
you describe what the UI should look like for any given data, and React
updates the DOM to match.

.. code:: jsx

   function MyButton({ count }) {
     return (
       <button style={{ color: count > 5 ? 'red' : 'black' }}>
         Clicked {count} times
       </button>
     );
   }

When ``count`` changes, React re-renders the function and patches the
DOM. You don't write code to update the DOM — you re-describe the UI
and React figures out the diff.

Components: The Building Blocks
-------------------------------

A component is a function that returns UI.

.. code:: tsx

   function Welcome({ name }: { name: string }) {
     return <Text>Hello, {name}!</Text>;
   }

   <Welcome name="Alice" />

Real example from zmNinjaNg (simplified):

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx
   function MonitorCard({ monitor, status, eventCount, onShowSettings }) {
     const navigate = useNavigate();
     const { t } = useTranslation();

     return (
       <Card>
         <div className="flex flex-col sm:flex-row gap-4 p-4">
           <div onClick={() => navigate(`/monitors/${monitor.Id}`)}>
             <img src={streamUrl} alt={monitor.Name} />
             <Badge variant={isRunning ? 'default' : 'destructive'}>
               {isRunning ? t('monitors.live') : t('monitors.offline')}
             </Badge>
           </div>
           <div>
             <div>{monitor.Name}</div>
             <Button onClick={() => navigate(`/events?monitorId=${monitor.Id}`)}>
               {t('sidebar.events')}
             </Button>
           </div>
         </div>
       </Card>
     );
   }

JSX
~~~

JSX (the ``<Card>...`` syntax) compiles to ``React.createElement`` calls.

.. code:: tsx

   const element = <Text>Hello</Text>;
   // compiles to:
   const element = React.createElement(Text, null, 'Hello');

Rules:

1. Embed JS expressions inside ``{}``.
2. Components must return a single root element (or a fragment ``<>...</>``).
3. Use ``className`` not ``class``, ``onClick`` not ``onclick``.

Props: Passing Data
-------------------

Props are how a parent passes data into a child. They are read-only —
the child cannot mutate them.

.. code:: tsx

   interface MonitorCardProps {
     monitor: Monitor;
     status: MonitorStatus;
     eventCount: number;
     onShowSettings: (monitor: Monitor) => void;
   }

   function MonitorCard({ monitor, status, eventCount, onShowSettings }: MonitorCardProps) {
     return (
       <Card>
         <Text>{monitor.Name}</Text>
         <Button onClick={() => onShowSettings(monitor)}>Settings</Button>
       </Card>
     );
   }

The parent passes props down; the child notifies the parent by calling
callback props (e.g. ``onShowSettings``).

State: Component Memory
-----------------------

State is data a component owns and can change. Changing state triggers
a re-render.

.. code:: tsx

   import { useState } from 'react';

   function Counter() {
     const [count, setCount] = useState(0);
     return (
       <View>
         <Text>Count: {count}</Text>
         <Pressable onPress={() => setCount(count + 1)}>
           <Text>Increment</Text>
         </Pressable>
       </View>
     );
   }

Real example — ``useMonitorStream`` tracks several pieces of state:

.. code:: tsx

   // app/src/hooks/useMonitorStream.ts
   export function useMonitorStream({ monitorId }) {
     const [connKey, setConnKey] = useState(0);
     const [cacheBuster, setCacheBuster] = useState(Date.now());
     const [displayedImageUrl, setDisplayedImageUrl] = useState('');

     const regenerateConnection = () => {
       setConnKey(generateKey());
       setCacheBuster(Date.now());
     };
     // ...
   }

State updates are asynchronous and batched
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const incrementTwice = () => {
     setCount(count + 1);  // count is 0, queues update to 1
     setCount(count + 1);  // count is STILL 0, queues update to 1
     // Result: count becomes 1, not 2
   };

Use the updater form when the new value depends on the previous one:

.. code:: tsx

   setCount(prev => prev + 1);
   setCount(prev => prev + 1);  // becomes 2

Rendering and Re-rendering
--------------------------

A component re-renders when:

1. Its state changes.
2. Its props change.
3. Its parent re-renders (even if its own props are unchanged).

Each render is a snapshot
~~~~~~~~~~~~~~~~~~~~~~~~~

Functions defined during a render close over that render's values.

.. code:: tsx

   function Message() {
     const [text, setText] = useState('Hello');

     const handleClick = () => {
       setText('Goodbye');
       alert(text);  // Shows 'Hello' — text is captured from this render
     };

     return <Button onClick={handleClick}>{text}</Button>;
   }

Stale closures matter for cleanup. ``useMonitorStream`` uses a ref to
keep cleanup logic pointing at the latest values:

.. code:: tsx

   // app/src/hooks/useMonitorStream.ts
   export function useMonitorStream({ monitorId }) {
     const [connKey, setConnKey] = useState(0);
     const { currentProfile } = useCurrentProfile();

     const cleanupParamsRef = useRef({ monitorId, connKey, profile: currentProfile });

     useEffect(() => {
       cleanupParamsRef.current = { monitorId, connKey, profile: currentProfile };
     }, [monitorId, connKey, currentProfile]);

     useEffect(() => {
       return () => {
         const params = cleanupParamsRef.current;
         sendQuitCommand(params.connKey);  // latest value via ref
       };
     }, []);
   }

Hooks
-----

Hooks are functions that let a component opt into React features
(state, effects, context).

Two rules:

1. Only call hooks at the top level — not in loops, conditions, or
   nested functions.
2. Only call hooks from React components or other custom hooks.

React tracks hooks by call order, so conditional calls break the model.

useEffect: Side Effects
~~~~~~~~~~~~~~~~~~~~~~~

``useEffect`` runs after render. Use it for fetches, subscriptions,
timers, manual DOM work, and cleanup.

.. code:: tsx

   useEffect(() => {
     fetchUser(userId).then(setUser);
   }, [userId]);

The dependency array controls when the effect re-runs:

.. code:: tsx

   useEffect(() => {});                 // every render
   useEffect(() => {}, []);             // once on mount
   useEffect(() => {}, [userId]);       // when userId changes
   useEffect(() => {}, [a, b]);         // when a or b changes

Real example — periodic snapshot refresh:

.. code:: tsx

   // app/src/hooks/useMonitorStream.ts
   useEffect(() => {
     if (settings.viewMode !== 'snapshot') return;

     const interval = setInterval(() => {
       setCacheBuster(Date.now());
     }, settings.snapshotRefreshInterval * 1000);

     return () => clearInterval(interval);
   }, [settings.viewMode, settings.snapshotRefreshInterval]);

Cleanup runs before the effect re-runs and when the component unmounts.

useRef: Mutable Storage Without Re-renders
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``useRef`` returns a mutable container that persists across renders.
Updating ``ref.current`` does **not** trigger a re-render.

.. code:: tsx

   const playerRef = useRef(null);
   const play = () => playerRef.current?.play();
   return <video ref={playerRef} />;

================== ================== =======================
Feature            useState           useRef
================== ================== =======================
Triggers re-render Yes                No
Read/write         Async (via setter) Sync (via ``.current``)
Use for            UI state           DOM refs, non-UI values
================== ================== =======================

Common uses: storing DOM elements, capturing previous values, holding
unstable Zustand values for cleanup (see ``useMonitorStream``).

useCallback: Stable Function References
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every render creates new function instances. ``useCallback`` returns
the same function across renders if dependencies are unchanged.

.. code:: tsx

   const handleClick = useCallback(() => {
     console.log('Clicked');
   }, []);

Use it when:

- Passing callbacks to ``React.memo``-wrapped children.
- Using a function as a dependency of another hook.

Skip it when the function isn't passed down or used in deps — it adds
overhead with no benefit.

useMemo: Memoizing Values
~~~~~~~~~~~~~~~~~~~~~~~~~

``useMemo`` caches a computed value across renders.

.. code:: tsx

   const sortedMonitors = useMemo(
     () => monitors.sort((a, b) => a.name.localeCompare(b.name)),
     [monitors]
   );

Use it for expensive calculations, or to keep object/array references
stable when they're used as hook dependencies. Don't reach for it
without a reason.

Object Identity and References
------------------------------

Objects and arrays are compared by reference, not by value.

.. code:: tsx

   { x: 1 } === { x: 1 }    // false
   [1, 2] === [1, 2]        // false

This matters when an inline object is used as a hook dependency:

.. code:: tsx

   function Component() {
     const config = { width: 100, height: 200 };  // new object every render
     useEffect(() => { /* ... */ }, [config]);    // runs every render
   }

Three fixes:

.. code:: tsx

   // 1. Stabilize with useMemo
   const config = useMemo(() => ({ width: 100, height: 200 }), []);

   // 2. Move outside the component
   const CONFIG = { width: 100, height: 200 };

   // 3. Depend on primitives instead
   useEffect(() => { /* ... */ }, [config.width, config.height]);

React.memo: Skipping Unchanged Renders
--------------------------------------

By default, a child re-renders whenever its parent re-renders, even
if its props are identical. ``memo`` adds a shallow prop comparison
that skips the render when props are the same.

.. code:: tsx

   import { memo } from 'react';

   const ExpensiveChild = memo(function ExpensiveChild({ name }) {
     return <Text>Hello, {name}</Text>;
   });

Real usage in zmNinjaNg:

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx
   export const MonitorCard = memo(MonitorCardComponent);

   // app/src/components/events/EventCard.tsx
   export const EventCard = memo(EventCardComponent);

Use ``memo`` for list items and components with heavy rendering. It
relies on shallow equality, so inline objects and inline functions
break it:

.. code:: tsx

   // memo doesn't help — config and onClick are new each render
   <ExpensiveChild
     config={{ width: 100 }}
     onClick={() => console.log()}
   />

Pair ``memo`` with ``useMemo``/``useCallback`` so the props have stable
references:

.. code:: tsx

   const config = useMemo(() => ({ width: 100 }), []);
   const handleClick = useCallback(() => console.log(), []);
   <ExpensiveChild config={config} onClick={handleClick} />

memo with Zustand
~~~~~~~~~~~~~~~~~

``memo`` only compares props. A component that subscribes to a Zustand
store still re-renders when that store changes — which is what you
want.

.. code:: tsx

   const EventCard = memo(function EventCard({ event }) {
     const isFav = useEventFavoritesStore((state) =>
       state.isFavorited(currentProfile.id, event.Id)
     );
     return <Star filled={isFav} />;
   });

Don't extract a function from the store without subscribing — the
component won't re-render when the underlying data changes:

.. code:: tsx

   // Wrong — no subscription, memo blocks parent re-renders, value goes stale
   const { isFavorited } = useEventFavoritesStore();
   const isFav = isFavorited(event.Id);

See :doc:`03-state-management-zustand` for more on selectors and
subscriptions.

React Native / DOM
------------------

zmNinjaNg renders to the DOM (via Vite) for web, Tauri (desktop), and
Capacitor (mobile webview). All React concepts above apply unchanged.
