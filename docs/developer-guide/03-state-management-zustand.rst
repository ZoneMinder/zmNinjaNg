State Management with Zustand
=============================

zmNinjaNg uses `Zustand <https://github.com/pmndrs/zustand>`_ for global
state. This chapter covers how stores are structured, how components
subscribe, and the reference-equality pitfalls that caused us trouble.

Why Global State
----------------

``useState`` is fine for component-local state, but profile, auth,
settings, monitors, and notifications need to be visible to many
components across the tree. Without a shared store, you end up
prop-drilling.

What Zustand Gives You
----------------------

- A global ``useState``-like hook any component can call.
- No Context Provider needed.
- Works outside React via ``store.getState()``.
- Optional persistence middleware.

Creating a Store
----------------

.. code:: tsx

   // src/stores/profile.ts
   import { create } from 'zustand';

   interface ProfileState {
     currentProfileId: string | null;
     profiles: Profile[];

     setCurrentProfile: (id: string) => void;
     addProfile: (profileData: Omit<Profile, 'id' | 'createdAt'>) => Promise<string>;
   }

   export const useProfileStore = create<ProfileState>((set) => ({
     currentProfileId: null,
     profiles: [],

     setCurrentProfile: (id) => set({ currentProfileId: id }),

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

Object form merges into state:

.. code:: tsx

   set({ currentProfileId: id })

Function form receives current state:

.. code:: tsx

   set((state) => ({ profiles: [...state.profiles, newProfile] }))

Always return new objects/arrays, don't mutate:

.. code:: tsx

   // Wrong
   set((state) => { state.profiles.push(newProfile); return state; })

   // Right
   set((state) => ({ profiles: [...state.profiles, newProfile] }))

Reading State in Components
---------------------------

.. code:: tsx

   import { useProfileStore } from '../stores/profile';

   function ProfileSelector() {
     const { currentProfileId, profiles, setCurrentProfile } = useProfileStore();
     // ...
   }

For the active profile object, prefer the ``useCurrentProfile`` hook
(``hooks/useCurrentProfile.ts``). It derives ``currentProfile`` from
``currentProfileId`` + ``profiles`` using ``useShallow`` and ``useMemo``,
and also returns merged profile settings:

.. code:: tsx

   import { useCurrentProfile } from '../hooks/useCurrentProfile';

   function UserName() {
     const { currentProfile, settings, hasProfile } = useCurrentProfile();
     if (!hasProfile) return null;
     return <Text>{currentProfile?.name}</Text>;
   }

Selectors
~~~~~~~~~

Calling ``useProfileStore()`` without a selector subscribes to the
whole store, the component re-renders on any change. A selector
narrows the subscription:

.. code:: tsx

   // Re-renders only when currentProfileId changes
   const currentProfileId = useProfileStore((state) => state.currentProfileId);

Use selectors for primitives and individual fields. Skip them when
you genuinely need most of the store and the component renders rarely.

Computed Selectors
~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const activeCount = useMonitorStore((state) =>
     state.monitors.filter(m => !m.deleted).length
   );

This is fine for a primitive result. For an object/array result,
use ``useShallow`` (next section).

useShallow: Stable Array/Object Selections
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A selector that returns a new array or object on each call will look
"changed" to React even when its contents are identical. That breaks
``useEffect`` deps and causes infinite loops.

.. code:: tsx

   // Bad, new array reference every selector run
   const favoriteIds = useEventFavoritesStore((state) =>
     state.profileFavorites[profileId] || []
   );
   useEffect(() => { /* ... */ }, [favoriteIds]);  // fires every render

``useShallow`` does element-by-element comparison and returns the
previous reference if contents match:

.. code:: tsx

   import { useShallow } from 'zustand/react/shallow';

   const favoriteIds = useEventFavoritesStore(
     useShallow((state) => state.getFavorites(profileId))
   );

Use ``useShallow`` when the selector returns:

- An array.
- An object literal (e.g. ``{ a: state.a, b: state.b }``).
- A computed/derived collection.

Skip it for primitives and for selecting a single store function, both
are already reference-stable.

Actions
-------

Actions live inside the store and encapsulate logic. Use ``get`` (the
second argument to ``create``) to read current state inside an action:

.. code:: tsx

   export const useProfileStore = create<ProfileState>((set, get) => ({
     currentProfileId: null,
     profiles: [],

     deleteProfile: (profileId) => {
       const { profiles, currentProfileId } = get();
       const newProfiles = profiles.filter(p => p.id !== profileId);
       const newCurrentId =
         currentProfileId === profileId
           ? newProfiles[0]?.id ?? null
           : currentProfileId;
       set({ profiles: newProfiles, currentProfileId: newCurrentId });
     },
   }));

Persistence
-----------

The ``persist`` middleware writes to ``localStorage`` automatically.
zmNinjaNg runs on web, Electron, and Capacitor, all expose
``localStorage``: so no custom storage adapter is needed:

.. code:: tsx

   import { create } from 'zustand';
   import { persist } from 'zustand/middleware';

   export const useProfileStore = create<ProfileState>()(
     persist(
       (set, get) => ({ /* state and actions */ }),
       { name: 'zmng-profiles' }
     )
   );

Sensitive data (passwords, tokens) is **not** persisted via this
middleware. Profile passwords go through ``lib/secureStorage.ts``,
which wraps ``@aparajita/capacitor-secure-storage`` (Keychain on iOS,
Keystore on Android, encrypted ``localStorage`` on web). The persisted
profile keeps a sentinel like ``'stored-securely'`` instead.

Caveats:

- ``localStorage`` is synchronous and ~5 MB, keep persisted state small.
- Versioning is manual; detect format changes yourself.

Hydration
~~~~~~~~~

Hydration runs once at startup. The store starts with its initial
state and is replaced with persisted state a few milliseconds later.
Use ``onRehydrateStorage`` to flag readiness and to run any post-load
work (e.g. re-initializing the API client):

.. code:: tsx

   export const useProfileStore = create<ProfileState>()(
     persist(
       (set, get) => ({ /* ... */, isInitialized: false }),
       {
         name: 'zmng-profiles',
         onRehydrateStorage: () => (state, error) => {
           if (error) {
             console.error('Hydration failed', error);
           } else {
             state?.setInitialized(true);
           }
         },
       }
     )
   );

In ``App.tsx`` we gate routes on the flag:

.. code:: tsx

   function AppRoutes() {
     const isInitialized = useProfileStore((state) => state.isInitialized);
     if (!isInitialized) return <LoadingScreen />;
     return <Routes>...</Routes>;
   }

Calling Stores Outside React
----------------------------

.. code:: tsx

   import { useProfileStore } from '../stores/profile';

   export function getCurrentProfile(): Profile | null {
     const { profiles, currentProfileId } = useProfileStore.getState();
     return profiles.find(p => p.id === currentProfileId) ?? null;
   }

   export async function switchToProfile(id: string): Promise<void> {
     await useProfileStore.getState().switchProfile(id);
   }

Useful in utility modules, API clients, and event handlers outside
the React tree.

Reference Equality and Infinite Loops
-------------------------------------

Zustand selectors that build new objects/arrays on each call return
new references every render. Used as a hook dependency, that triggers
re-runs even when the underlying values are unchanged.

.. code:: tsx

   function DashboardLayout() {
     const { currentProfile } = useCurrentProfile();
     const updateSettings = useSettingsStore((state) => state.updateSettings);

     // currentProfile / updateSettings are unstable references
     const handleResize = useCallback((width: number) => {
       if (currentProfile) {
         updateSettings(currentProfile.id, { layoutWidth: width });
       }
     }, [currentProfile, updateSettings]);
     // handleResize changes -> ResizeObserver re-fires -> setState -> re-render
     // -> new references -> handleResize changes again -> loop
   }

Hold the unstable values in refs and keep the callback's deps to
primitives:

.. code:: tsx

   function DashboardLayout() {
     const { currentProfile } = useCurrentProfile();
     const updateSettings = useSettingsStore((state) => state.updateSettings);

     const currentProfileRef = useRef(currentProfile);
     const updateSettingsRef = useRef(updateSettings);

     useEffect(() => {
       currentProfileRef.current = currentProfile;
       updateSettingsRef.current = updateSettings;
     }, [currentProfile, updateSettings]);

     const handleResize = useCallback((width: number) => {
       if (currentProfileRef.current) {
         updateSettingsRef.current(currentProfileRef.current.id, {
           layoutWidth: width,
         });
       }
     }, []);  // stable
   }

See :doc:`04-pages-and-views` for the full ``DashboardLayout`` /
``Montage`` story.

Stores in zmNinjaNg
-------------------

::

   src/stores/
   ├── profile.ts                  # User profiles (useProfileStore)
   ├── profile-bootstrap.ts        # Bootstrap helpers used by profile.ts
   ├── profile-initialization.ts   # Rehydration helpers used by profile.ts
   ├── auth.ts                     # Auth tokens and state (useAuthStore)
   ├── settings.ts                 # App + profile settings (useSettingsStore)
   ├── dashboard.ts                # Dashboard config (useDashboardStore)
   ├── monitors.ts                 # Monitor data cache (useMonitorStore)
   ├── notifications.ts            # Push notifications (useNotificationStore)
   ├── logs.ts                     # App logs (useLogStore)
   ├── query-cache.ts              # React Query cache helpers
   ├── backgroundTasks.ts          # Background download/upload tasks
   ├── eventFavorites.ts           # Per-profile favorited events
   └── kioskStore.ts               # Kiosk lock state (ephemeral)

Stores are split by domain so components subscribe only to what they
need.

Kiosk Store (``stores/kioskStore.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages kiosk (lock) mode. Ephemeral, not persisted, so the app
always starts unlocked.

State:

- ``isLocked``: kiosk mode active flag.
- ``previousInsomniaState``: insomnia setting captured at lock time so
  it can be restored on unlock.
- ``pinAttempts``: consecutive failed PIN attempts in the current
  cooldown window.
- ``cooldownUntil``: Unix ms timestamp until which PIN entry is
  blocked; ``null`` when not in cooldown.
- ``unlockRequested``: flag set by external UI (e.g. sidebar) to ask
  KioskOverlay to start the unlock flow.

Actions:

- ``lock(currentInsomniaState)``: activate and capture insomnia state.
- ``unlock()``: deactivate and reset attempt counters.
- ``requestUnlock()``: set ``unlockRequested`` to ``true``.
- ``clearUnlockRequest()``: reset ``unlockRequested``.
- ``recordFailedAttempt()``: increment ``pinAttempts``; after 5
  failures, set a 30-second ``cooldownUntil``. If a previous cooldown
  has already expired, the counter resets to 0 first.
- ``isCoolingDown()``: ``true`` if ``Date.now() < cooldownUntil``.

PIN storage is in ``lib/kioskPin.ts``, not in this store.

Background Tasks Store (``stores/backgroundTasks.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Tracks long-running operations (downloads, uploads). Ephemeral, only
the current session.

State:

- ``tasks``: array of ``BackgroundTask`` (id, type, status,
  progress 0–100, metadata, optional error, timestamps, optional
  ``cancelFn``).
- ``drawerState``: ``'hidden' | 'badge' | 'collapsed' | 'expanded'``.

Task types: ``'download' | 'upload' | 'sync' | 'export'``. Statuses:
``'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'``.

Actions: ``addTask``, ``updateProgress``, ``completeTask``,
``failTask``, ``cancelTask``, ``removeTask``, ``clearCompleted``,
``setDrawerState``. Computed getters (call as functions):
``activeTasks()``, ``completedTasks()``, ``hasActiveTasks()``.

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
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Per-profile favorited events. Persisted.

State:

- ``profileFavorites: Record<profileId, string[]>``: event IDs by
  profile.

Actions: ``isFavorited(profileId, eventId)``,
``toggleFavorite(profileId, eventId)``,
``addFavorite(profileId, eventId)``,
``removeFavorite(profileId, eventId)``,
``getFavorites(profileId)``, ``clearFavorites(profileId)``,
``getFavoriteCount(profileId)``.

.. code:: typescript

   import { useEventFavoritesStore } from '../stores/eventFavorites';
   import { useShallow } from 'zustand/react/shallow';

   // Read array, wrap in useShallow
   const favorites = useEventFavoritesStore(
     useShallow((state) => state.getFavorites(profileId))
   );

   // Read action, no useShallow needed
   const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);
   toggleFavorite(profileId, eventId);

Store Pattern
-------------

.. code:: tsx

   interface MyState {
     items: Item[];
     selectedId: string | null;

     addItem: (item: Item) => void;
     selectItem: (id: string) => void;
     clearSelection: () => void;
   }

   export const useMyStore = create<MyState>()(
     persist(
       (set, get) => ({
         items: [],
         selectedId: null,

         addItem: (item) =>
           set((state) => ({ items: [...state.items, item] })),
         selectItem: (id) => set({ selectedId: id }),
         clearSelection: () => set({ selectedId: null }),
       }),
       { name: 'zmng-my-storage' }
     )
   );

Testing Stores
--------------

Stores can be tested directly via ``setState`` / ``getState``:

.. code:: tsx

   import { useProfileStore } from '../profile';

   describe('ProfileStore', () => {
     beforeEach(() => {
       useProfileStore.setState({ currentProfileId: null, profiles: [] });
     });

     it('sets current profile', () => {
       useProfileStore.setState({ profiles: [{ id: '1', name: 'Test' } as any] });
       useProfileStore.getState().setCurrentProfile('1');
       expect(useProfileStore.getState().currentProfileId).toBe('1');
     });
   });

Common Patterns
---------------

Derived state in a selector
~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const hasActiveMonitors = useMonitorStore((state) =>
     state.monitors.some(m => !m.deleted)
   );

Cross-store sequence
~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   const resetApp = () => {
     useProfileStore.getState().clearProfiles();
     useDashboardStore.getState().resetDashboard();
     useMonitorStore.getState().clearCache();
   };

Conditional update
~~~~~~~~~~~~~~~~~~

.. code:: tsx

   addMonitor: (monitor) =>
     set((state) => {
       if (state.monitors.some(m => m.id === monitor.id)) {
         return state;  // no-op
       }
       return { monitors: [...state.monitors, monitor] };
     }),
