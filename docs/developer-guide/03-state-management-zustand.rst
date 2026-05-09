State Management with Zustand
=============================

This chapter explains how zmNinjaNg manages global application state using
Zustand.

Why Do We Need Global State Management?
---------------------------------------

React’s ``useState`` works great for component-local state, but
applications need to share state across many components:

::

   ProfileSettings (needs: currentProfile)
      ├── MonitorList (needs: currentProfile)
      │      └── MonitorCard (needs: currentProfile)
      └── DashboardConfig (needs: currentProfile)

Without global state, you’d have to: 1. Store state in a common parent
component 2. Pass it down through every intermediate component (“prop
drilling”) 3. Pass callback functions back up to update it

This becomes unmaintainable quickly.

What is Zustand?
----------------

Zustand is a lightweight state management library. Think of it as a
global ``useState`` that any component can access.

**Key features**:

- Simple API (less boilerplate than Redux)
- No Context Provider needed
- TypeScript-friendly
- Works outside React components
- Automatic persistence to storage

Creating a Store
----------------

A store is created using the ``create`` function:

.. code:: tsx

   // src/stores/profile.ts
   import { create } from 'zustand';

   interface ProfileState {
     // State
     currentProfileId: string | null;
     profiles: Profile[];

     // Actions (functions that modify state)
     setCurrentProfile: (id: string) => void;
     addProfile: (profileData: Omit<Profile, 'id' | 'createdAt'>) => Promise<string>;
   }

   export const useProfileStore = create<ProfileState>((set) => ({
     // Initial state
     currentProfileId: null,
     profiles: [],

     // Actions
     setCurrentProfile: (id) =>
       set({ currentProfileId: id }),

     addProfile: async (profileData) => {
       const id = crypto.randomUUID();
       set((state) => ({
         profiles: [...state.profiles, { ...profileData, id, createdAt: Date.now() }],
       }));
       return id;
     },
   }));

The ``set`` Function
~~~~~~~~~~~~~~~~~~~~

``set`` is how you update the store. It has two forms:

**Object form** (merge state):

.. code:: tsx

   set({ currentProfileId: id })  // Merges { currentProfileId: id } into state

**Function form** (access current state):

.. code:: tsx

   set((state) => ({
     profiles: [...state.profiles, newProfile]
   }))

**Important**: Like React state, you must return a **new object/array**,
not mutate:

.. code:: tsx

   // ❌ Wrong - mutates state
   set((state) => {
     state.profiles.push(newProfile);
     return state;
   })

   // ✅ Correct - creates new array
   set((state) => ({
     profiles: [...state.profiles, newProfile]
   }))

Using a Store in Components
---------------------------

Import the hook and call it to get state and actions:

.. code:: tsx

   import { useProfileStore } from '../stores/profile';

   function ProfileSelector() {
     // Get everything
     const { currentProfileId, profiles, setCurrentProfile } = useProfileStore();

     return (
       <View>
         {profiles.map(profile => (
           <Pressable
             key={profile.id}
             onPress={() => setCurrentProfile(profile.id)}
           >
             <Text>{profile.name}</Text>
           </Pressable>
         ))}
       </View>
     );
   }

In application code, prefer the ``useCurrentProfile`` hook
(``hooks/useCurrentProfile.ts``) when you need the active profile object —
it derives ``currentProfile`` from ``currentProfileId`` + ``profiles`` using
``useShallow`` and ``useMemo`` to avoid infinite re-renders, and also
returns the merged profile settings:

.. code:: tsx

   import { useCurrentProfile } from '../hooks/useCurrentProfile';

   function UserName() {
     const { currentProfile, settings, hasProfile } = useCurrentProfile();
     if (!hasProfile) return null;
     return <Text>{currentProfile?.name}</Text>;
   }

Selectors: Optimizing Re-renders
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Important**: When you call ``useProfileStore()`` without arguments,
the component re-renders whenever **any** state in the store changes,
even if you don’t use it.

.. code:: tsx

   function CurrentProfileId() {
     const { currentProfileId } = useProfileStore();
     // ⚠️ This re-renders when profiles array changes, even though we don't use it!

     return <Text>{currentProfileId}</Text>;
   }

**Selectors** let you subscribe to specific parts of state:

.. code:: tsx

   function CurrentProfileId() {
     // Only re-renders when currentProfileId changes
     const currentProfileId = useProfileStore((state) => state.currentProfileId);

     return <Text>{currentProfileId}</Text>;
   }

**When to use selectors**:

- When you only need a small part of the store
- In frequently-rendered components
- To prevent unnecessary re-renders

**When NOT to use selectors**:

- When you need multiple pieces of state (use destructuring instead)
- In components that rarely render

Multiple Selectors
~~~~~~~~~~~~~~~~~~

.. code:: tsx

   function ProfileView() {
     const currentProfileId = useProfileStore((state) => state.currentProfileId);
     const setCurrentProfile = useProfileStore((state) => state.setCurrentProfile);
     // Each selector is independent - component re-renders only when these specific values change
   }

Computed Values in Selectors
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Selectors can derive data:

.. code:: tsx

   function ActiveMonitorsCount() {
     const activeCount = useMonitorStore((state) =>
       state.monitors.filter(m => !m.deleted).length
     );

     return <Text>Active: {activeCount}</Text>;
   }

**Performance caveat**: This creates a new number on every store update.
For complex derivations, use ``useMemo``:

.. code:: tsx

   function MonitorList() {
     const monitors = useMonitorStore((state) => state.monitors);

     const activeMonitors = useMemo(
       () => monitors.filter(m => !m.deleted),
       [monitors]
     );

     // ...
   }

useShallow: Preventing Infinite Loops with Arrays and Objects
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

When selecting arrays or objects from Zustand, you can encounter
infinite re-render loops because JavaScript compares objects by
**reference**, not by **value**.

The Problem
^^^^^^^^^^^

.. code:: tsx

   function EventList() {
     // ❌ Creates new array reference every time selector runs!
     const favoriteIds = useEventFavoritesStore((state) =>
       state.profileFavorites[profileId] || []
     );

     useEffect(() => {
       console.log('Favorites changed');
     }, [favoriteIds]);  // Runs on EVERY render!
   }

**Why this happens:**

1. Selector runs: ``state.profileFavorites[profileId] || []``
2. Returns ``[1, 2, 3]`` (new array reference)
3. Component re-renders
4. Selector runs again: returns ``[1, 2, 3]`` (different reference!)
5. React sees new reference → triggers effect
6. → Infinite loop

Even though the array *values* are identical ``[1, 2, 3]``, they’re
different *objects*:

.. code:: tsx

   [1, 2, 3] !== [1, 2, 3]  // true - different references!

The Solution: useShallow
^^^^^^^^^^^^^^^^^^^^^^^^

``useShallow`` does **shallow comparison** - it compares array/object
contents, not references:

.. code:: tsx

   import { useShallow } from 'zustand/react/shallow';

   function EventList() {
     // ✅ Returns same reference if array contents haven't changed
     const favoriteIds = useEventFavoritesStore(
       useShallow((state) => state.getFavorites(profileId))
     );

     useEffect(() => {
       console.log('Favorites actually changed');
     }, [favoriteIds]);  // Only runs when array contents change
   }

**How it works:**

.. code:: tsx

   // Without useShallow:
   [1, 2, 3] !== [1, 2, 3]  // true (different references)

   // With useShallow:
   shallowEquals([1, 2, 3], [1, 2, 3])  // true (same contents)

It compares each element:
``arr1[0] === arr2[0] && arr1[1] === arr2[1] && ...``

When to Use useShallow
^^^^^^^^^^^^^^^^^^^^^^

**Use for:**

- Selecting arrays: ``(state) => state.items``
- Selecting objects: ``(state) => state.config``
- Selecting multiple values: ``(state) => ({ a: state.a, b: state.b })``

**Don’t use for:**

- Primitives: ``(state) => state.count`` (numbers/strings/booleans are
  fine)
- Single object properties: ``(state) => state.currentProfileId`` (already
  stable if unchanged)
- Actions/functions: ``(state) => state.addItem`` (functions don’t need
  shallow comparison)

Examples
^^^^^^^^

.. code:: tsx

   // ✅ Array - use useShallow
   const monitors = useMonitorStore(
     useShallow((state) => state.monitors)
   );

   // ✅ Object - use useShallow
   const settings = useSettingsStore(
     useShallow((state) => state.getProfileSettings(profileId))
   );

   // ✅ Multiple values - use useShallow
   const { name, email } = useUserStore(
     useShallow((state) => ({
       name: state.currentUser?.name,
       email: state.currentUser?.email,
     }))
   );

   // ✅ Primitive - no useShallow needed
   const count = useCountStore((state) => state.count);

   // ✅ Function - no useShallow needed
   const increment = useCountStore((state) => state.increment);

Debugging Infinite Loops
^^^^^^^^^^^^^^^^^^^^^^^^

If you suspect an infinite loop from Zustand:

1. Add console.log to see how often selector runs:

   .. code:: tsx

      const data = useStore((state) => {
        console.log('Selector running');
        return state.data;
      });

2. Check if you’re selecting an array/object without useShallow

3. Wrap with useShallow and test

useShallow vs useMemo
^^^^^^^^^^^^^^^^^^^^^

Both prevent unnecessary re-renders, but for different reasons:

- **useShallow**: Compares array/object contents to return stable
  reference
- **useMemo**: Caches expensive calculation results

.. code:: tsx

   // useShallow - for Zustand arrays/objects
   const favorites = useEventStore(
     useShallow((state) => state.getFavorites(profileId))
   );

   // useMemo - for expensive derivations
   const sortedMonitors = useMemo(
     () => monitors.sort((a, b) => a.name.localeCompare(b.name)),
     [monitors]
   );

Store Actions: Best Practices
-----------------------------

Actions should encapsulate business logic:

.. code:: tsx

   export const useProfileStore = create<ProfileState>((set, get) => ({
     currentProfileId: null,
     profiles: [],

     // Simple action
     setCurrentProfile: (id) =>
       set({ currentProfileId: id }),

     // Action with logic
     deleteProfile: (profileId) => {
       const { profiles, currentProfileId } = get();

       // Remove profile
       const newProfiles = profiles.filter(p => p.id !== profileId);

       // If we deleted the current profile, select another (or null)
       const newCurrentId =
         currentProfileId === profileId
           ? newProfiles[0]?.id ?? null
           : currentProfileId;

       set({ profiles: newProfiles, currentProfileId: newCurrentId });
     },
   }));

**The** ``get`` **function**: Second parameter to ``create``, returns
current state:

.. code:: tsx

   create<State>((set, get) => ({
     count: 0,
     increment: () => {
       const current = get().count;  // Access current state
       set({ count: current + 1 });
     }
   }))

Persistence
-----------

Zustand can persist state to storage automatically. zmNinjaNg runs on web,
Tauri, and Capacitor — all of which expose ``localStorage`` — so the
``persist`` middleware uses the default browser storage, no custom
``createJSONStorage`` needed:

.. code:: tsx

   import { create } from 'zustand';
   import { persist } from 'zustand/middleware';

   export const useProfileStore = create<ProfileState>()(
     persist(
       (set, get) => ({
         // State and actions here
       }),
       {
         name: 'zmng-profiles',  // localStorage key
       }
     )
   );

**How it works**: 1. When state changes, Zustand saves it to
``localStorage``. 2. On app launch, Zustand loads state from
``localStorage``. 3. Everything is automatic.

**Sensitive data** (passwords, tokens) is **not** stored via the
``persist`` middleware. Profile passwords go through ``lib/secureStorage.ts``,
which wraps ``@aparajita/capacitor-secure-storage`` (native Keychain /
Keystore on iOS / Android, encrypted localStorage on web). The persisted
profile keeps a flag like ``'stored-securely'`` instead of the real value.

**Caveats**:

- ``localStorage`` is synchronous and limited (~5 MB) — keep persisted state small.
- Versioning is manual (detect and handle format changes yourself).

Advanced Persistence: Hydration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Hydration runs once at startup and may invoke async work (e.g.
re-initializing the API client and re-authenticating). When the app
launches, the store starts with its initial state (empty) and then
“hydrates” with data from storage a few milliseconds later.

This can cause UI flashes or errors if the app tries to use state before
it’s loaded. To handle this, we use the ``onRehydrateStorage`` callback.

**Implementation Pattern** (``src/stores/profile.ts``):

.. code:: tsx

   export const useProfileStore = create<ProfileState>()(
     persist(
       (set, get) => ({
         // ... state and actions
         isInitialized: false,
       }),
       {
         name: 'zmng-profiles',

         // Callback when hydration starts
         onRehydrateStorage: () => {
           console.log('Hydration starting...');

           // Returns a function that runs when hydration finishes
           return (state, error) => {
             if (error) {
               console.error('Hydration failed', error);
             } else {
               console.log('Hydration finished');
               // Flag that we are ready to render
               state?.setInitialized(true);
             }
           };
         },
       }
     )
   );

**Usage in App Logic**:

In the main ``App.tsx``, we wait for ``isInitialized`` before rendering
routes:

.. code:: tsx

   function AppRoutes() {
     const isInitialized = useProfileStore((state) => state.isInitialized);

     if (!isInitialized) {
       return <LoadingScreen />;
     }

     return <Routes>...</Routes>;
   }

Calling Stores Outside React
----------------------------

Unlike React state, Zustand works outside components:

.. code:: tsx

   import { useProfileStore } from '../stores/profile';

   // In a regular function (not a component)
   // Access primitives directly and look up the profile by id
   export function getCurrentProfile(): Profile | null {
     const { profiles, currentProfileId } = useProfileStore.getState();
     return profiles.find(p => p.id === currentProfileId) ?? null;
   }

   // Switch profile from outside React
   export async function switchToProfile(id: string): Promise<void> {
     await useProfileStore.getState().switchProfile(id);
   }

This is useful for:

- Utility functions
- API clients
- Event handlers outside React

The Critical Issue: Object References
-------------------------------------

**This is the source of our infinite loop bugs (detailed in Chapter
4).**

Zustand stores return **new object references** on every access, even if
the values haven’t changed:

.. code:: tsx

   function MyComponent() {
     const settings = useProfileStore((state) => state.settings);

     useEffect(() => {
       console.log('Settings changed!');
     }, [settings]);  // ⚠️ Runs on EVERY render!
   }

**Why?** Even though ``settings`` value might be identical, Zustand
can’t guarantee it’s the same reference.

**This causes infinite loops when**: 1. You use a Zustand value as a
dependency in ``useCallback`` or ``useEffect`` 2. That callback/effect
updates state 3. State update triggers re-render 4. Re-render creates
new Zustand reference 5. New reference triggers callback/effect again 6.
→ Infinite loop

Example: The Infinite Loop
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   function DashboardLayout() {
     const { currentProfile } = useCurrentProfile();
     const updateSettings = useSettingsStore((state) => state.updateSettings);

     // ⚠️ INFINITE LOOP!
     const handleResize = useCallback((width: number) => {
       if (currentProfile) {
         updateSettings(currentProfile.id, { layoutWidth: width });
       }
     }, [currentProfile, updateSettings]);  // These change on every render!

     // handleResize changes → triggers ResizeObserver → updates settings
     // → triggers re-render → currentProfile/updateSettings get new references
     // → handleResize changes again → infinite loop
   }

The Solution: Refs (Preview)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

We solve this using ``useRef`` to hold Zustand values without making
them dependencies:

.. code:: tsx

   function DashboardLayout() {
     const { currentProfile } = useCurrentProfile();
     const updateSettings = useSettingsStore((state) => state.updateSettings);

     // Store in refs
     const currentProfileRef = useRef(currentProfile);
     const updateSettingsRef = useRef(updateSettings);

     // Keep refs updated
     useEffect(() => {
       currentProfileRef.current = currentProfile;
       updateSettingsRef.current = updateSettings;
     }, [currentProfile, updateSettings]);

     // ✅ Now stable - no Zustand values as dependencies
     const handleResize = useCallback((width: number) => {
       if (currentProfileRef.current) {
         updateSettingsRef.current(currentProfileRef.current.id, { layoutWidth: width });
       }
     }, []);  // Empty dependencies - never recreates

     // handleResize is stable → no infinite loop
   }

See Chapter 4 for detailed analysis of this pattern.

Zustand Store Structure in zmNinjaNg
-------------------------------

We use multiple stores for different domains:

::

   src/stores/
   ├── profile.ts                  # User profiles management (exports useProfileStore)
   ├── profile-bootstrap.ts        # Bootstrap helpers used by profile.ts
   ├── profile-initialization.ts   # Rehydration helpers used by profile.ts
   ├── auth.ts                     # Authentication tokens and state (useAuthStore)
   ├── settings.ts                 # Application and profile settings (useSettingsStore)
   ├── dashboard.ts                # Dashboard configuration (useDashboardStore)
   ├── monitors.ts                 # Monitor data cache (useMonitorsStore)
   ├── notifications.ts            # Push notifications (useNotificationsStore)
   ├── notifications-trash.ts      # Trashed notifications
   ├── logs.ts                     # Application logs (ephemeral)
   ├── query-cache.ts              # React Query cache helpers
   ├── backgroundTasks.ts          # Background download/upload tasks
   ├── eventFavorites.ts           # Per-profile favorited events
   └── kioskStore.ts               # Kiosk mode lock state (ephemeral)

**Why multiple stores?**

- Separation of concerns
- Better performance (components subscribe to relevant store only)
- Easier to test and reason about

Kiosk Store (``stores/kioskStore.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages kiosk (lock) mode state. The store is **ephemeral** — it is not
persisted, so the app always starts unlocked after a restart.

**State:**

- ``isLocked`` — whether kiosk mode is currently active
- ``previousInsomniaState`` — the insomnia setting value captured just before
  locking, so it can be restored on unlock
- ``pinAttempts`` — number of consecutive failed PIN attempts in the current
  cooldown window
- ``cooldownUntil`` — Unix timestamp (ms) until which PIN entry is blocked;
  ``null`` when not in cooldown
- ``unlockRequested`` — flag set by external UI (e.g. sidebar) to ask
  KioskOverlay to initiate the unlock flow

**Actions:**

- ``lock(currentInsomniaState)`` — activates kiosk mode and captures the
  current insomnia state
- ``unlock()`` — deactivates kiosk mode and resets attempt counters
- ``requestUnlock()`` — sets ``unlockRequested`` to ``true`` so that
  KioskOverlay can pick it up and begin the unlock flow
- ``clearUnlockRequest()`` — resets ``unlockRequested`` to ``false``
- ``recordFailedAttempt()`` — increments ``pinAttempts``; after 5 consecutive
  failures, sets a 30-second ``cooldownUntil``. If a previous cooldown has
  already expired, the counter resets to 0 before incrementing (so the user
  gets a fresh set of 5 attempts after waiting out a cooldown).
- ``isCoolingDown()`` — returns ``true`` if the current time is before
  ``cooldownUntil``

**Usage:**

.. code:: typescript

   import { useKioskStore } from '../stores/kioskStore';

   // In a component
   const { isLocked, lock, unlock } = useKioskStore();

   // Lock with current insomnia state
   lock(currentInsomniaState);

   // Outside React
   useKioskStore.getState().isCoolingDown();

PIN storage is handled separately by ``lib/kioskPin.ts`` (not in this store).

Background Tasks Store (``stores/backgroundTasks.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages long-running operations such as file downloads and uploads. The
store is **ephemeral** — not persisted. Tasks are tracked in memory only
for the current app session.

**State:**

- ``tasks`` — array of ``BackgroundTask`` objects (each with id, type,
  status, progress 0–100, metadata, optional error, timestamps, and
  optional ``cancelFn``)
- ``drawerState`` — controls the task-progress UI drawer
  (``'hidden'``, ``'badge'``, ``'collapsed'``, ``'expanded'``)

**Task types:** ``'download'``, ``'upload'``, ``'sync'``, ``'export'``

**Task statuses:** ``'pending'``, ``'in_progress'``, ``'completed'``,
``'failed'``, ``'cancelled'``

**Actions:**

- ``addTask(task)`` — registers a new task; returns the generated task
  id; auto-expands the drawer
- ``updateProgress(taskId, progress, bytesProcessed?)`` — updates
  progress (0–100) and optional bytes count
- ``completeTask(taskId)`` — marks the task completed; collapses the
  drawer to badge when all tasks finish
- ``failTask(taskId, error)`` — marks the task failed
- ``cancelTask(taskId)`` — calls the task's ``cancelFn`` (if any) and
  marks it cancelled
- ``removeTask(taskId)`` — removes a task from the list
- ``clearCompleted()`` — removes all completed, failed, and cancelled tasks
- ``setDrawerState(state)`` — manually control the drawer

**Computed getters (call as functions):**

- ``activeTasks()`` — pending or in-progress tasks
- ``completedTasks()`` — completed, failed, or cancelled tasks
- ``hasActiveTasks()`` — ``true`` if any task is pending or in progress

**Usage:**

.. code:: typescript

   import { useBackgroundTasks } from '../stores/backgroundTasks';

   const taskStore = useBackgroundTasks.getState();
   const taskId = taskStore.addTask({
     type: 'download',
     metadata: { title: 'Video.mp4', description: 'Event 12345' },
     cancelFn: () => abortController.abort(),
   });
   taskStore.updateProgress(taskId, 50, 512000);
   taskStore.completeTask(taskId);

Event Favorites Store (``stores/eventFavorites.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages favorited events, scoped per profile. Persisted to storage so
favorites survive app restarts.

**State:**

- ``profileFavorites`` — ``Record<profileId, string[]>`` mapping each
  profile to its list of favorited event IDs

**Actions:**

- ``isFavorited(profileId, eventId)`` — returns ``true`` if the event
  is favorited for that profile
- ``toggleFavorite(profileId, eventId)`` — adds or removes the event
- ``addFavorite(profileId, eventId)`` — adds an event to favorites
- ``removeFavorite(profileId, eventId)`` — removes an event from favorites
- ``getFavorites(profileId)`` — returns the array of favorited event IDs
- ``clearFavorites(profileId)`` — removes all favorites for a profile
- ``getFavoriteCount(profileId)`` — returns the count

**Usage:**

.. code:: typescript

   import { useEventFavoritesStore } from '../stores/eventFavorites';
   import { useShallow } from 'zustand/react/shallow';

   // Read (use useShallow to avoid infinite re-renders on arrays)
   const favorites = useEventFavoritesStore(
     useShallow((state) => state.getFavorites(profileId))
   );

   // Toggle
   const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);
   toggleFavorite(profileId, eventId);

Store Organization Pattern
--------------------------

Each store follows this pattern:

.. code:: tsx

   // 1. Define state interface
   interface MyState {
     // Data
     items: Item[];
     selectedId: string | null;

     // Actions
     addItem: (item: Item) => void;
     selectItem: (id: string) => void;
     clearSelection: () => void;
   }

   // 2. Create store with persistence (uses default localStorage)
   export const useMyStore = create<MyState>()(
     persist(
       (set, get) => ({
         // 3. Initial state
         items: [],
         selectedId: null,

         // 4. Actions
         addItem: (item) =>
           set((state) => ({ items: [...state.items, item] })),

         selectItem: (id) =>
           set({ selectedId: id }),

         clearSelection: () =>
           set({ selectedId: null }),
       }),
       {
         name: 'zmng-my-storage',
       }
     )
   );

Testing Zustand Stores
----------------------

Stores can be tested independently:

.. code:: tsx

   import { useProfileStore } from '../profile';

   describe('ProfileStore', () => {
     beforeEach(() => {
       // Reset store before each test
       useProfileStore.setState({
         currentProfileId: null,
         profiles: [],
       });
     });

     it('sets current profile', () => {
       useProfileStore.setState({
         profiles: [{ id: '1', name: 'Test' } as any],
       });

       useProfileStore.getState().setCurrentProfile('1');

       expect(useProfileStore.getState().currentProfileId).toBe('1');
     });

     it('adds profile to list', async () => {
       const id = await useProfileStore.getState().addProfile({
         name: 'Test',
       } as any);

       const profiles = useProfileStore.getState().profiles;
       expect(profiles.find((p) => p.id === id)?.name).toBe('Test');
     });
   });

Key Takeaways
-------------

1. **Zustand is global state**: Any component can access it
2. **Use selectors**: Subscribe to specific parts of state to optimize
   re-renders
3. **Actions encapsulate logic**: Don’t manipulate state directly from
   components
4. **Object references change**: Zustand values get new references even
   if unchanged
5. **Refs prevent loops**: Don’t use Zustand values as
   ``useCallback``/``useEffect`` dependencies directly
6. **Multiple stores**: Separate concerns for better organization
7. **Persistence is automatic**: With the persist middleware
8. **Works outside React**: Can call ``getState()`` from anywhere

Common Patterns
---------------

Pattern 1: Derived State with Selectors
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const hasActiveMonitors = useMonitorStore((state) =>
     state.monitors.some(m => !m.deleted)
   );

Pattern 2: Multiple Actions in Sequence
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const resetApp = () => {
     useProfileStore.getState().clearProfiles();
     useDashboardStore.getState().resetDashboard();
     useMonitorStore.getState().clearCache();
   };

Pattern 3: Conditional Updates
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   addMonitor: (monitor) =>
     set((state) => {
       // Don't add duplicates
       if (state.monitors.some(m => m.id === monitor.id)) {
         return state;  // Return current state unchanged
       }
       return { monitors: [...state.monitors, monitor] };
     }),

Next Steps
----------

Continue to `Chapter 4: Pages and Views <04-pages-and-views>` to
see real examples of how Zustand object references caused infinite loops
in our codebase and how we fixed them.
