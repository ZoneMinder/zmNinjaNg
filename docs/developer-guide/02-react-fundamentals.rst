React Fundamentals
==================

A primer for backend or systems programmers picking up React for the
first time. Written in roughly the order you need to know things.

zmNinjaNg renders to the DOM on every platform (web, Tauri desktop,
Capacitor mobile webview). Examples below use plain HTML tags.

The mental shift
----------------

In a typical web stack you tell the DOM what to change:

.. code:: javascript

   document.getElementById('count').textContent = count;
   if (count > 5) button.classList.add('warning');

Every event handler walks the DOM, finds elements, mutates them. As
features grow, those mutations sprawl across the file and forget about
each other.

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

Everything else in this chapter follows from that single idea.

JSX
---

JSX is the ``<button>...</button>`` syntax embedded in JavaScript. It
is not HTML; it compiles to ``React.createElement`` calls.

.. code:: tsx

   const element = <span>Hello</span>;
   // compiles to:
   const element = React.createElement('span', null, 'Hello');

Three things to know:

1. **Embed JS expressions in ``{}``**: ``<span>Hello, {name}</span>``,
   ``<button disabled={isLoading}>``, ``<ul>{items.map(...)}</ul>``.
2. **Return one root element**, or wrap multiple in a fragment ``<>...</>``.
3. **HTML attributes get JS-style names**: ``className`` (not ``class``),
   ``onClick`` (not ``onclick``), ``htmlFor`` (not ``for``).

That's it. The rest of "JSX" is just JavaScript.

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

Components compose. A page is a component that renders other
components, which render other components.

A real one from zmNinjaNg, simplified:

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx
   function MonitorCard({ monitor, status, eventCount, onShowSettings }) {
     return (
       <Card>
         <img src={monitor.streamUrl} alt={monitor.Name} />
         <Badge variant={status === 'running' ? 'default' : 'destructive'}>
           {status}
         </Badge>
         <div>{monitor.Name}</div>
         <Button onClick={() => onShowSettings(monitor)}>Settings</Button>
       </Card>
     );
   }

``Card``, ``Badge``, ``Button`` are zmNinjaNg components built on top
of the shadcn/ui primitives in ``app/src/components/ui/``. The pattern
is the same as ``Welcome``: a function that returns JSX.

Props: data flowing in
----------------------

Props are how a parent hands data to a child. They are read-only from
the child's perspective.

.. code:: tsx

   interface MonitorCardProps {
     monitor: Monitor;
     status: MonitorStatus;
     eventCount: number;
     onShowSettings: (monitor: Monitor) => void;
   }

   function MonitorCard({ monitor, eventCount, onShowSettings }: MonitorCardProps) {
     return (
       <Card>
         <p>{monitor.Name}</p>
         <p>{eventCount} events</p>
         <Button onClick={() => onShowSettings(monitor)}>Settings</Button>
       </Card>
     );
   }

To send data the *other* way (child notifies parent), the parent passes
a function as a prop. By convention these props start with ``on``
(``onClick``, ``onShowSettings``). The child calls them; the parent
decides what to do.

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

Render: what triggers it
------------------------

A component re-renders when:

1. Its own state changes (a setter was called).
2. Its props change.
3. Its parent re-renders. *Even if its props didn't change.*

Point 3 is the one that surprises people. By default, React doesn't
try to be clever. When a parent re-renders, all its children re-render
too. We'll see how to opt out (``memo``) later.

A render is just a function call. React calls your component, gets the
returned JSX, compares it to the previous result, and patches the DOM.

Each render is a snapshot
~~~~~~~~~~~~~~~~~~~~~~~~~

This is the part that trips up newcomers. Functions defined *during* a
render (event handlers, effect callbacks) capture the values from that
render via closure. They do not see future updates.

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

Ninety percent of the time this is exactly what you want. The other
ten percent (typically inside long-lived effects or cleanup callbacks),
you need to escape the snapshot. That's what refs are for (see below).

Hooks
-----

A "hook" is a function whose name starts with ``use`` (``useState``,
``useEffect``, ``useRef``, ``useNavigate``...). Hooks are how a
component opts into React features.

There are two rules. Both exist because React tracks which hook is
which by the order of calls within a render:

1. **Call hooks at the top level**, never inside loops, conditions,
   or nested functions.
2. **Call hooks only from React components or other hooks** (custom
   hooks). Plain helper functions can't use them.

If you break rule 1, React's tracking gets out of sync and your state
gets shuffled into the wrong slots. The ESLint plugin catches it.

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
   useEffect(() => {
     if (settings.viewMode !== 'snapshot') return;

     const interval = setInterval(() => {
       setCacheBuster(Date.now());
     }, settings.snapshotRefreshInterval * 1000);

     return () => clearInterval(interval);   // cleanup
   }, [settings.viewMode, settings.snapshotRefreshInterval]);

Effects fire after every render whose dependencies changed. If you
forget the dependency array entirely, your fetch runs on every render
and you get an infinite loop. See :doc:`08-common-pitfalls` for the
full taxonomy.

useRef: a value that survives renders without triggering one
------------------------------------------------------------

``useState`` triggers a re-render. Sometimes you don't want that. You
need a value that:

- persists across renders, and
- can be updated without causing a re-render.

That's a ref:

.. code:: tsx

   const playerRef = useRef<HTMLVideoElement>(null);

   const play = () => playerRef.current?.play();

   return <video ref={playerRef} src="/clip.mp4" />;

The ``ref`` attribute is a special prop: React sets ``playerRef.current``
to the DOM node after mount.

Two common uses:

**1. DOM access** (above): grab a real element to call imperative
methods like ``.play()``, ``.focus()``, ``.scrollIntoView()``.

**2. Escape the closure snapshot** in a long-lived effect or cleanup.
Refs read the latest value, not the captured one. From
``useMonitorStream``:

.. code:: tsx

   // app/src/hooks/useMonitorStream.ts
   const cleanupParamsRef = useRef({ monitorId, connKey, profile: currentProfile });

   // Keep the ref up to date with each render.
   useEffect(() => {
     cleanupParamsRef.current = { monitorId, connKey, profile: currentProfile };
   }, [monitorId, connKey, currentProfile]);

   // Cleanup runs once on unmount, but reads the *latest* values via the ref.
   useEffect(() => {
     return () => {
       const params = cleanupParamsRef.current;
       sendQuitCommand(params.connKey);
     };
   }, []);

Without the ref, the cleanup would close over the ``connKey`` from the
mount render and quit the wrong stream.

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
     const params = { userId, limit: 50 };       // new object every render
     useEffect(() => fetch(params), [params]);   // runs every render
   }

``useMemo`` caches a computed value across renders, only recomputing
when its dependencies change:

.. code:: tsx

   const params = useMemo(() => ({ userId, limit: 50 }), [userId]);
   useEffect(() => fetch(params), [params]);  // runs only when userId changes

``useCallback`` is the same idea for functions:

.. code:: tsx

   const handleSubmit = useCallback(() => {
     saveProfile(form);
   }, [form]);

Use them when:

- The value is passed to ``React.memo``-wrapped children (see below).
- The value is a hook dependency.
- The value is genuinely expensive to recompute (rare).

Don't use them everywhere. They cost memory and add reading overhead.
A function used once inside a render and never passed down doesn't
need ``useCallback``.

Object identity: the bug that hides everywhere
----------------------------------------------

Building on the previous section: this is the single most common
source of "why is this re-rendering / re-fetching forever" bugs.

.. code:: tsx

   { x: 1 } === { x: 1 }    // false
   [1, 2] === [1, 2]        // false
   () => {} === () => {}    // false

Three ways to fix an unstable dependency:

.. code:: tsx

   // 1. Memoize it.
   const config = useMemo(() => ({ width: 100, height: 200 }), []);

   // 2. Hoist it out of the component (truly constant).
   const CONFIG = { width: 100, height: 200 };
   function Component() { useEffect(() => {}, [CONFIG]); }

   // 3. Depend on the primitive fields instead.
   useEffect(() => { /* ... */ }, [config.width, config.height]);

The third option is usually the cleanest when you only need a couple
of fields.

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

In zmNinjaNg, list items use ``memo`` so a single event update doesn't
re-render every card on screen:

.. code:: tsx

   // app/src/components/monitors/MonitorCard.tsx
   export const MonitorCard = memo(MonitorCardComponent);

   // app/src/components/events/EventCard.tsx
   export const EventCard = memo(EventCardComponent);

The catch: ``memo`` does a *shallow* prop check. If you pass an inline
object or inline function, it's a new reference on every parent render
and ``memo`` is defeated:

.. code:: tsx

   // memo can't help: both props are new each render.
   <ExpensiveChild
     config={{ width: 100 }}
     onClick={() => console.log()}
   />

   // Stabilize, then memo works:
   const config = useMemo(() => ({ width: 100 }), []);
   const handleClick = useCallback(() => console.log(), []);
   <ExpensiveChild config={config} onClick={handleClick} />

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
every render, a callback fires twice), the cause is almost always one
of:

- Forgot the dependency array on ``useEffect``.
- A dependency is an inline object/array/function (object identity).
- The component reads a value via a ref but isn't updating the ref.
- A parent passes new props on every render and the child isn't ``memo``'d.

See :doc:`08-common-pitfalls` for worked examples of each.

Where to go next
----------------

State that needs to be shared across components belongs in a Zustand
store. That's :doc:`03-state-management-zustand`.
