/**
 * Profile Store
 * 
 * Manages the list of ZoneMinder server profiles and the current active profile.
 * Handles secure storage of passwords and profile switching logic.
 * 
 * Key features:
 * - Persists profiles to localStorage (excluding passwords)
 * - Stores passwords in secure storage (native Keychain/Keystore or encrypted in localStorage)
 * - Handles profile switching (session bootstrap); each profile's session,
 *   auth state, and query cache entries persist independently across a switch
 * - Manages app initialization state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile, ProfileId, VirtualProfile } from '../api/types';
import { asProfileId, isAggregateProfileId, isVirtualProfileId, mintVirtualProfileId } from '../api/types';
import { getServerTimeZone } from '../api/time';
import { ProfileService } from '../services/profile';
import { isProfileNameAvailable } from '../lib/profile/profile-validation';
import { log, LogLevel } from '../lib/logger';
import { setLogRedactionGate } from '../lib/log-sanitizer';
import { setProfileSettingsGate } from '../lib/profile/profile-settings';
import { getSession, dropSession, dropAllSessions, registerSessionsGate } from '../services/sessions';
import { stopEventPoller } from '../services/eventPoller';
import { registerServerResolverGate } from '../lib/zm/server-resolver';
import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';
import { useAuthStore, getAuthSlice, registerAuthClientResolver } from './auth';
import { useSettingsStore } from './settings';
import { useDashboardStore } from './dashboard';
import { useMonitorSeenStore } from './monitorSeen';
import { useDeleteSelectionStore } from './deleteSelection';
import { performBootstrap } from '../services/profile-bootstrap';
import { handleProfileRehydration } from '../services/profile-initialization';

/**
 * Thrown by profile-store guards that a UI action can trigger directly (as
 * opposed to plain `Error`s from invariant violations like "profile not
 * found"). The `code` lets a catch block pick the right localized toast
 * instead of displaying a raw message, mirroring DiscoveryError's shape
 * (services/discovery.ts). Refs #337.
 */
export class ProfileGuardError extends Error {
  public code: 'CANNOT_DISABLE_CURRENT';

  constructor(message: string, code: 'CANNOT_DISABLE_CURRENT') {
    super(message);
    this.name = 'ProfileGuardError';
    this.code = code;
  }
}

interface ProfileState {
  profiles: Profile[];
  /** Named groups of real profiles, each aggregating like All Servers over
   *  its own members. Purely additive to the persisted blob, so a store
   *  written before #337 rehydrates without it - every read defends with
   *  `?? []`. */
  virtualProfiles: VirtualProfile[];
  currentProfileId: ProfileId | null;
  isInitialized: boolean;
  isBootstrapping: boolean;
  bootstrapStep: 'start' | 'auth' | 'timezone' | 'zms' | 'finalize' | null;

  // Computed
  profileExists: (name: string, excludeId?: string) => boolean;


  // Actions
  addProfile: (profile: Omit<Profile, 'id' | 'createdAt'>, id?: ProfileId) => Promise<string>;
  updateProfile: (id: string, updates: Partial<Profile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  deleteAllProfiles: () => Promise<void>;
  addVirtualProfile: (name: string, memberProfileIds: ProfileId[]) => ProfileId;
  updateVirtualProfile: (
    id: string,
    patch: Partial<Pick<VirtualProfile, 'name' | 'memberProfileIds'>>
  ) => void;
  deleteVirtualProfile: (id: string) => void;
  switchProfile: (id: string) => Promise<void>;
  setDefaultProfile: (id: string) => void;
  setProfileDisabled: (id: string, disabled: boolean) => void;
  cancelBootstrap: () => void;

  // Helpers
  getDecryptedPassword: (profileId: string) => Promise<string | undefined>;
}

let storeSet: ((partial: Partial<ProfileState>) => void) | null = null;
let storeGet: (() => ProfileState) | null = null;

/**
 * Every name already spoken for, real and virtual, as one list for
 * isProfileNameAvailable. Uniqueness spans both namespaces because the
 * switcher and notification attribution (findProfileByName) present names
 * from both without saying which kind they are. Refs #337.
 */
function namedProfiles(state: ProfileState): { id: string; name: string }[] {
  return [...state.profiles, ...(state.virtualProfiles ?? [])];
}

/**
 * Validate a virtual profile write. Shared by creation and editing so the two
 * cannot drift; `excludeId` lets a group keep its own name.
 *
 * These are backstops, not the user-facing validation - the dialog checks the
 * same things and reports them in place - but they are what actually holds the
 * invariants, since a store action is reachable from anywhere. Refs #337.
 */
function validateVirtualProfileWrite(
  state: ProfileState,
  patch: { name?: string; memberProfileIds?: ProfileId[] },
  excludeId?: string
): void {
  if (patch.name !== undefined) {
    // A whitespace-only name is unique, so the availability check below would
    // pass it and leave an unlabelled entry in the switcher. Only the emptiness
    // test trims; the comparison stays untrimmed, matching how real profile
    // names have always been compared.
    if (patch.name.trim().length === 0) {
      throw new Error('A virtual profile name cannot be empty');
    }
    if (!isProfileNameAvailable(patch.name, namedProfiles(state), excludeId)) {
      throw new Error(`Profile "${patch.name}" already exists`);
    }
  }

  if (patch.memberProfileIds !== undefined) {
    if (patch.memberProfileIds.length === 0) {
      throw new Error('A virtual profile needs at least one member profile');
    }
    for (const memberId of patch.memberProfileIds) {
      // Membership is flat: a group of groups always flattens to a member
      // list, so nothing is lost by refusing it, and allowing it would put a
      // cycle one edit away. Rejected with its own message because "unknown
      // profile" would be a misleading thing to tell the user.
      if (isVirtualProfileId(memberId)) {
        throw new Error(`A virtual profile cannot contain another virtual profile (${memberId})`);
      }
      if (!state.profiles.some((p) => p.id === memberId)) {
        throw new Error(`Unknown member profile ${memberId}`);
      }
    }
  }
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => {
      storeSet = set;
      storeGet = get;
      return {
        profiles: [],
        virtualProfiles: [],
        currentProfileId: null,
        isInitialized: false,
        isBootstrapping: false,
        bootstrapStep: null,

        /**
         * Check if a profile with the given name already exists, in either
         * namespace. Case-insensitive.
         */
        profileExists: (name, excludeId) =>
          !isProfileNameAvailable(name, namedProfiles(get()), excludeId),

        /**
         * Add a new profile.
         * 
         * Generates a UUID, encrypts the password (if provided), and adds to the list.
         * If it's the first profile, it becomes the default and current profile.
         */
        addProfile: async (profileData, id) => {
          // Check for duplicate names, across both namespaces (refs #337)
          if (!isProfileNameAvailable(profileData.name, namedProfiles(get()))) {
            throw new Error(`Profile "${profileData.name}" already exists`);
          }

          // Boundary: this is where a profile id is minted, unless the caller
          // already minted one (e.g. ProfileForm testing the connection - and
          // therefore building the auth session - before this profile is
          // saved). Every ProfileId downstream (currentProfileId, query-key
          // cache scoping) traces back to this cast or the id passed in.
          // Refs #217, #337.
          const newProfileId = id ?? asProfileId(crypto.randomUUID());

          // Store password in secure storage (native keystore on mobile, encrypted on web)
          if (profileData.password) {
            await ProfileService.savePassword(newProfileId, profileData.password);
          }

          // Don't store password in Zustand state - it's in secure storage
          const newProfile: Profile = {
            ...profileData,
            password: profileData.password ? 'stored-securely' : undefined, // Flag indicating password exists
            id: newProfileId,
            createdAt: Date.now(),
          };

          set((state) => {
            // If this is the first profile, make it default
            const isFirst = state.profiles.length === 0;
            const profiles = [...state.profiles, newProfile];

            return {
              profiles,
              currentProfileId: isFirst ? newProfile.id : state.currentProfileId,
            };
          });

          // If this is now the current profile, ensure its session exists
          if (get().currentProfileId === newProfile.id) {
            // Fetch timezone for new profile
            try {
              // Get token from auth store state
              const { accessToken } = getAuthSlice(newProfile.id);
              const timezone = await getServerTimeZone(getSession(newProfile.id).client, accessToken || undefined);
              get().updateProfile(newProfile.id, { timezone });
            } catch (e) {
              log.profileService('Failed to fetch timezone for new profile', LogLevel.WARN, { error: e });
            }
          }

          return newProfileId;
        },

        /**
         * Update an existing profile.
         * 
         * Handles password updates by re-encrypting and storing in secure storage.
         * Drops the profile's cached session if its connection details changed.
         */
        updateProfile: async (id, updates) => {
          log.profileService(`updateProfile called for profile ID: ${id}`, LogLevel.INFO, updates);

          // Check for duplicate names if name is being updated
          if (updates.name && !isProfileNameAvailable(updates.name, namedProfiles(get()), id)) {
            throw new Error(`Profile "${updates.name}" already exists`);
          }

          // Store password in secure storage if provided
          const processedUpdates = { ...updates };
          if (updates.password) {
            await ProfileService.savePassword(id, updates.password);
            // Set flag instead of actual password
            processedUpdates.password = 'stored-securely';
          }

          set((state) => ({
            profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...processedUpdates } : p)),
          }));

          // Connection details changed: evict the cached session so the next
          // getSession rebuilds it against the new URL/credentials. Refs #337.
          if (
            updates.apiUrl !== undefined ||
            updates.portalUrl !== undefined ||
            updates.cgiUrl !== undefined ||
            updates.username !== undefined ||
            updates.password !== undefined
          ) {
            dropSession(asProfileId(id));
          }

          log.profileService('updateProfile complete', LogLevel.INFO);
        },

        /**
         * Delete a profile.
         * 
         * Removes the profile from the list and deletes its password from secure storage.
         * If the current profile is deleted, switches to another available profile or null.
         */
        deleteProfile: async (id) => {
          // Remove password from secure storage
          await ProfileService.deletePassword(id);

          // Drop this profile's per-monitor seen-watermarks (refs #239)
          useMonitorSeenStore.getState().clearProfile(id);

          // Drop any queued bulk-delete selection. DeleteBatchBar lives in
          // AppLayout and never unmounts, so a queue outlives the profile it
          // was built on: the bar keeps its count with nothing marked under it,
          // and confirming would delete events on a server the user is no
          // longer looking at. Clearing rather than filtering out this
          // profile's keys is deliberate - the profile list just changed under
          // a destructive queue, and dropping it is the safe direction (the
          // user re-ticks in seconds). switchProfile and setProfileDisabled
          // do the same for the same reason. Refs #337.
          useDeleteSelectionStore.getState().clear();

          // Drop its cached session and clear its auth slice/persisted
          // refresh token - otherwise all three survive the profile's own
          // deletion. Refs #337.
          dropSession(asProfileId(id));
          useAuthStore.getState().logout(asProfileId(id));

          // Tear down its live notification connection and poller too - a
          // deleted profile must not keep a websocket or poll loop running
          // in the background. Routed through the store's disconnect() (not
          // the service registry directly) so connections[id]/the anchor
          // stay consistent, not just the underlying socket; dynamic import
          // avoids a static cycle (stores/notifications.ts imports this
          // store), same pattern as the query-cache import below (refs #337
          // I5).
          const { useNotificationStore } = await import('./notifications');
          useNotificationStore.getState().disconnect(id);
          stopEventPoller(id);

          // Evict its query cache entries. Profile-scoped keys are the sole
          // cross-profile isolation now that switchProfile no longer clears
          // the whole cache (refs #337).
          const { removeProfileQueries } = await import('./query-cache');
          removeProfileQueries(asProfileId(id));

          set((state) => {
            const profiles = state.profiles.filter((p) => p.id !== id);
            const currentProfileId =
              state.currentProfileId === id
                ? profiles.length > 0
                  ? profiles[0].id
                  : null
                : state.currentProfileId;

            // Prune the deleted id out of every group that named it. A group
            // can be left with no members; useProfileScope collapses that to
            // null the same way All mode collapses with nothing enabled, so
            // there is nothing to delete here (refs #337).
            const virtualProfiles = (state.virtualProfiles ?? []).map((v) =>
              v.memberProfileIds.includes(asProfileId(id))
                ? { ...v, memberProfileIds: v.memberProfileIds.filter((m) => m !== id) }
                : v
            );

            return { profiles, currentProfileId, virtualProfiles };
          });
        },

        /**
         * Delete all profiles.
         *
         * Clears all profiles and removes all passwords from secure storage.
         * Drops every cached session.
         */
        deleteAllProfiles: async () => {
          const { profiles } = get();

          // Remove all passwords from secure storage, and each profile's
          // per-monitor seen-watermarks (refs #239)
          for (const profile of profiles) {
            await ProfileService.deletePassword(profile.id);
            useMonitorSeenStore.getState().clearProfile(profile.id);
          }
          // No profile left to own a queued delete (see deleteProfile).
          useDeleteSelectionStore.getState().clear();

          // Clear all profiles and reset state. Every group is a grouping OF
          // these profiles, so none of them can outlive the last one.
          set({ profiles: [], virtualProfiles: [], currentProfileId: null });

          // Drop every cached session and clear every profile's auth slice
          // and persisted refresh token. Refs #337.
          dropAllSessions();
          useAuthStore.getState().logoutAll();

          // Tear down every profile's live notification connection and
          // poller, through the store (refs #337 I5).
          const { useNotificationStore } = await import('./notifications');
          useNotificationStore.getState().disconnectAll();

          log.profileService('All profiles deleted', LogLevel.INFO);
        },

        /**
         * Create a named group of real profiles. Refs #337.
         *
         * See validateVirtualProfileWrite for what a valid group is; the
         * checks are shared with editing.
         */
        addVirtualProfile: (name, memberProfileIds) => {
          validateVirtualProfileWrite(get(), { name, memberProfileIds });

          const virtualProfile: VirtualProfile = {
            id: mintVirtualProfileId(),
            name,
            memberProfileIds,
          };

          set((state) => ({
            virtualProfiles: [...(state.virtualProfiles ?? []), virtualProfile],
          }));

          log.profileService('Virtual profile created', LogLevel.INFO, {
            profileId: virtualProfile.id,
            memberCount: memberProfileIds.length,
          });

          return virtualProfile.id;
        },

        /**
         * Rename a group or replace its member list. Same validations as
         * creation - the group being edited is excluded from the name check so
         * it can keep its own name. Refs #337.
         */
        updateVirtualProfile: (id, patch) => {
          if (!(get().virtualProfiles ?? []).some((v) => v.id === id)) {
            throw new Error(`Virtual profile ${id} not found`);
          }
          validateVirtualProfileWrite(get(), patch, id);

          set((state) => ({
            virtualProfiles: (state.virtualProfiles ?? []).map((v) =>
              v.id === id ? { ...v, ...patch } : v
            ),
          }));

          // Dropping a member shrinks the aggregate under a destructive queue
          // (see deleteProfile). Guarded like setProfileDisabled rather than
          // cleared outright as the other four siblings do: editing a group
          // that isn't current, or renaming one, moves nothing in view.
          if (patch.memberProfileIds && get().currentProfileId === id) {
            useDeleteSelectionStore.getState().clear();
          }
        },

        /**
         * Delete a group. Only the grouping goes: its members are untouched
         * real profiles that other groups (and single mode) still use.
         *
         * Its own per-id buckets go with it, or they accumulate as orphans no
         * UI can ever reach again - the settings bucket and the dashboard
         * widget bucket are both keyed by this id. There is no session, auth
         * slice, password or notification connection to tear down: an
         * aggregate id never had any (services/sessions.ts rejects it).
         *
         * Refs #337.
         */
        deleteVirtualProfile: (id) => {
          // Rejected rather than a silent no-op, matching
          // updateVirtualProfile: a no-op would make a double-delete look like
          // it worked, and would clear the delete queue for a group that never
          // existed.
          if (!(get().virtualProfiles ?? []).some((v) => v.id === id)) {
            throw new Error(`Virtual profile ${id} not found`);
          }

          set((state) => ({
            virtualProfiles: (state.virtualProfiles ?? []).filter((v) => v.id !== id),
            // Nothing else resets the current id for an aggregate today (the
            // ALL sentinel can't be deleted), so a deleted group would stay
            // selected with no entity behind it. null means "route to setup".
            currentProfileId: state.currentProfileId === id ? null : state.currentProfileId,
          }));

          useSettingsStore.getState().removeProfileSettings(id);
          useDashboardStore.getState().clearProfile(id);
          // Stale queue from the outgoing scope (see deleteProfile).
          useDeleteSelectionStore.getState().clear();

          log.profileService('Virtual profile deleted', LogLevel.INFO, { profileId: id });
        },

        /**
         * Switch to a different profile.
         *
         * Performs a context switch:
         * 1. Quits the outgoing profile's active streams
         * 2. Sets new profile as current
         * 3. Ensures the new profile's session exists
         * 4. Runs bootstrap (auth, timezone, zms path, multi-port)
         *
         * Sessions are per-profile and persist across a switch: the outgoing
         * profile's auth state is left untouched (refs #337). The query
         * cache also survives a switch - profile-scoped query keys are the
         * isolation primitive, which keeps other profiles' data warm for
         * All mode. Includes rollback logic if switching fails.
         *
         * An aggregate id - a virtual profile group - names no real server:
         * it skips the lookup below along with session/bootstrap/lastUsed.
         * Leaving an aggregate for a real profile has no single outgoing
         * profile to target, so it quits every stream via the same no-arg
         * call (refs #337).
         */
        switchProfile: async (id) => {
          if (isAggregateProfileId(id)) {
            // An aggregate id has an entity behind it, so it can be stale
            // (deleted in another tab, hand-edited storage). Reject it the
            // same way an unknown real profile id is rejected, rather than
            // selecting a group that resolves to nothing. The retired All
            // Servers sentinel has no entity at all, so it falls out here
            // too, which is how it stays unreachable (refs #337).
            const aggregateId = asProfileId(id);
            if (!(get().virtualProfiles ?? []).some((v) => v.id === aggregateId)) {
              throw new Error(`Profile ${id} not found`);
            }

            log.profileService('Switching to aggregate mode', LogLevel.INFO, { profileId: id });
            const { quitAllActiveStreams } = await import('../lib/monitor/active-streams');
            await quitAllActiveStreams();
            // Stale queue from the outgoing profile (see deleteProfile).
            useDeleteSelectionStore.getState().clear();
            set({ currentProfileId: aggregateId });
            log.profileService('Switched to aggregate mode', LogLevel.INFO, { profileId: id });
            return;
          }

          const profile = get().profiles.find((p) => p.id === id);
          if (!profile) {
            throw new Error(`Profile ${id} not found`);
          }
          if (profile.disabled) {
            // Defensive only: the UI never offers a disabled profile to
            // switch to (Profiles page, ProfileSwitcher both hide/disallow
            // it). Refs #337.
            log.profileService('Switch rejected: profile is disabled', LogLevel.WARN, { profileId: id });
            throw new Error(`Profile ${id} is disabled`);
          }

          // Save previous profile for rollback
          const previousProfileId = get().currentProfileId;
          const previousProfile = previousProfileId
            ? get().profiles.find((p) => p.id === previousProfileId)
            : null;

          log.profileService('Starting profile switch', LogLevel.INFO, {
            from: previousProfile?.name || 'None',
            to: profile.name,
            targetPortal: profile.portalUrl,
            targetAPI: profile.apiUrl,
          });

          try {
            // STEP 0: Quit the previous profile's active streams while its SSL
            // trust and access token are still in effect, before the new
            // profile's SSL-trust flip, so a self-signed old server's
            // CMD_QUIT is not rejected, which would orphan its nph-zms. refs #188
            log.profileService('Step 0: Quitting previous profile streams', LogLevel.INFO);
            const { quitAllActiveStreams } = await import('../lib/monitor/active-streams');
            await quitAllActiveStreams();
            // Stale queue from the outgoing profile (see deleteProfile).
            useDeleteSelectionStore.getState().clear();

            // STEP 1: Update current profile ID
            // Use profile.id (already a ProfileId) rather than the raw `id`
            // param so this assignment needs no cast.
            log.profileService('Step 1: Setting new profile as current', LogLevel.INFO);
            set({ currentProfileId: profile.id });

            // Update last used timestamp (don't await this)
            get().updateProfile(id, { lastUsed: Date.now() });

            // STEP 2: Ensure the new profile's session exists
            log.profileService('Step 2: Ensuring session', LogLevel.INFO, { apiUrl: profile.apiUrl });
            getSession(profile.id);
            log.profileService('Session ready', LogLevel.INFO);

            // STEP 3-5: Run bootstrap tasks (auth, timezone, zms path, multi-port)
            log.profileService('Step 3-5: Running bootstrap tasks', LogLevel.INFO);
            await performBootstrap(profile, {
              getDecryptedPassword: get().getDecryptedPassword,
              updateProfile: get().updateProfile,
            });

            log.profileService('Profile switch completed successfully', LogLevel.INFO, { currentProfile: profile.name });

          } catch (error) {
            log.profileService('Profile switch FAILED', LogLevel.ERROR, error);

            // ROLLBACK: Restore previous profile if it exists
            if (previousProfile) {
              log.profileService('Starting rollback to previous profile', LogLevel.INFO, {
                previousProfile: previousProfile.name,
              });

              try {
                // Clear the failed switch target's half-built auth state (not
                // the profile we're restoring to).
                const { useAuthStore } = await import('./auth');
                useAuthStore.getState().logout(profile.id);

                // Restore previous profile
                log.profileService('Restoring previous profile ID', LogLevel.INFO);
                set({ currentProfileId: previousProfileId });

                // Its session persisted through the failed switch; ensure it
                // still exists.
                log.profileService('Re-ensuring session for rollback profile', LogLevel.INFO, { apiUrl: previousProfile.apiUrl });
                getSession(previousProfile.id);

                // Run bootstrap for previous profile
                log.profileService('Running bootstrap for rollback profile', LogLevel.INFO);
                await performBootstrap(previousProfile, {
                  getDecryptedPassword: get().getDecryptedPassword,
                  updateProfile: get().updateProfile,
                });
                log.profileService('Rollback successful', LogLevel.INFO, { restoredTo: previousProfile.name });
              } catch (rollbackError) {
                log.profileService('Rollback FAILED - user may need to manually re-authenticate', LogLevel.ERROR, { rollbackError });
              }
            }

            // Re-throw the original error
            throw error;
          }
        }, setDefaultProfile: (id) => {
          set((state) => ({
            profiles: state.profiles.map((p) => ({
              ...p,
              isDefault: p.id === id,
            })),
          }));
        },

        /**
         * Disable or re-enable a profile. A disabled profile stays listed on
         * the Profiles page but is unselectable (switchProfile rejects it)
         * and excluded from every All-mode aggregate (useProfileScope
         * filters it out of `profiles`, which every aggregate reader fans
         * out over). Refs #337.
         *
         * The active profile can never be disabled - there would be nothing
         * left selected. Enabling is always unconditional.
         *
         * Mirrors deleteProfile's session teardown minus the deletion
         * itself: dropSession(id) so the next getSession rebuilds instead of
         * reusing a stale client, and its polling stops. No explicit
         * quitAllActiveStreams call is needed (unlike switchProfile's use of
         * it): deleteProfile doesn't call it either, because unmounting the
         * profile's monitor tiles (which useProfileScope's filter causes
         * immediately, in every All-mode surface that renders them) already
         * tears down their streams via each tile's own cleanup effect.
         */
        setProfileDisabled: (id, disabled) => {
          if (disabled && get().currentProfileId === id) {
            throw new ProfileGuardError(
              `Cannot disable the active profile ${id}`,
              'CANNOT_DISABLE_CURRENT'
            );
          }

          // set() is synchronous and there is no await between it and the
          // dropSession() below - both land in the same tick, so a reader
          // can never observe `disabled: true` with the old session still
          // cached. Keep it that way: an intervening await here would
          // reopen the same stale-session race class deleteProfile guards
          // against elsewhere in this file.
          set((state) => ({
            profiles: state.profiles.map((p) => (p.id === id ? { ...p, disabled } : p)),
          }));

          if (disabled) {
            dropSession(asProfileId(id));
            // A disabled profile leaves every All-mode aggregate, so its rows
            // (and any queued deletes) vanish from view (see deleteProfile).
            useDeleteSelectionStore.getState().clear();
          }

          log.profileService('Profile disabled state changed', LogLevel.INFO, { profileId: id, disabled });
        },

        /**
         * Cancel ongoing bootstrap and clear current profile.
         * Used when user wants to abort loading a profile that's taking too long.
         */
        cancelBootstrap: () => {
          log.profileService('Bootstrap cancelled by user', LogLevel.INFO);
          set({
            isBootstrapping: false,
            bootstrapStep: null,
            currentProfileId: null,
          });
        },

        /**
         * Retrieve decrypted password for a profile.
         * 
         * Fetches the encrypted password from secure storage and decrypts it.
         */
        getDecryptedPassword: async (profileId) => {
          const profile = get().profiles.find((p) => p.id === profileId);
          if (!profile?.password || profile.password !== 'stored-securely') {
            return undefined;
          }

          return ProfileService.getPassword(profileId);
        },
      };
    },
    {
      name: STORAGE_KEYS.profilesStore,
      // On load, ensure the current profile's session exists and authenticate
      // Complex initialization logic is extracted to services/profile-initialization.ts for maintainability
      onRehydrateStorage: () => {
        try {
          log.profileService('onRehydrateStorage: Zustand persist starting rehydration', LogLevel.INFO);
        } catch {
          // Logger might not be initialized in test environment
        }

        return async (state) => {
          try {
            // Ensure store references are available
            if (!storeSet || !storeGet) {
              throw new Error('Profile store not ready');
            }

            // Delegate to initialization module
            await handleProfileRehydration(state, storeSet, storeGet);
          } catch (error) {
            // CRITICAL: Catch any unexpected errors in onRehydrateStorage to prevent app from hanging
            try {
              log.profileService(
                'CRITICAL: Unexpected error in onRehydrateStorage - forcing initialization',
                LogLevel.ERROR,
                { error }
              );
            } catch {
              // Logger might not be initialized in test environment
            }
            // Force initialization to prevent hanging
            if (storeSet) {
              storeSet({ isInitialized: true, isBootstrapping: false, bootstrapStep: null });
            }
          }
        };
      },
    }
  )
);

// lib/log-sanitizer.ts has no store imports; this module assembles the real
// redaction check from the profile and settings stores and registers it here
// at load time, breaking the logger -> log-sanitizer -> profile store cycle.
// Refs #217.
setLogRedactionGate({
  isRedactionDisabled: () => {
    const { currentProfileId } = useProfileStore.getState();
    if (!currentProfileId) return false;
    return useSettingsStore.getState().getProfileSettings(currentProfileId).disableLogRedaction;
  },
});

// lib/profile/profile-settings.ts has no store imports for the same reason (it's
// imported by api/events.ts and other api modules downstream of this store).
// Refs #217.
setProfileSettingsGate({
  getExcludedMonitorIds: (profileId) => useSettingsStore.getState().getProfileSettings(profileId).excludedMonitorIds,
});

// services/sessions.ts has no store imports for the same reason (breaking a
// static import cycle back through this store). reLoginFor(id) looks up
// profile `id` fresh from state at call time (not the current profile) so a
// 401 on a non-current profile's session (aggregate readers) re-authenticates
// that profile against its own server with its own credentials. Refs #337.
//
// It also registers itself as that profile's setReLoginCallback the first
// time a session is built for it (getSession calls gate.reLoginFor(id)
// exactly once per profile, when the session isn't cached yet - refs #337).
// That is the ONLY registration path now: the old one in
// profile-initialization.ts registered just the rehydrated current profile,
// with a reLogin that only ever worked for the current profile, so
// getFreshAccessToken(B) in All mode had nothing to fall through to and
// couldn't self-heal an expired refresh token. Every profile that gets a
// session - current or not - now gets its own callback.
registerSessionsGate({
  getProfile: (id) => useProfileStore.getState().profiles.find((p) => p.id === id),
  getCurrentProfileId: () => useProfileStore.getState().currentProfileId,
  reLoginFor: (id) => {
    const doReLogin = async (): Promise<boolean> => {
      const profile = useProfileStore.getState().profiles.find((p) => p.id === id);
      if (!profile) {
        log.profileService('reLoginFor: profile not found', LogLevel.WARN, { profileId: id });
        return false;
      }

      // No credentials means no auth required (public server) - not a failure.
      if (!profile.username || !profile.password) return true;

      const password = await useProfileStore.getState().getDecryptedPassword(id);
      if (!password) {
        log.profileService('reLoginFor: no stored credentials', LogLevel.WARN, { profileId: id });
        return false;
      }

      try {
        await useAuthStore.getState().login(id, profile.username, password);
        return true;
      } catch (e) {
        log.profileService('reLoginFor failed', LogLevel.ERROR, { profileId: id, error: e });
        return false;
      }
    };

    useAuthStore.getState().setReLoginCallback(id, doReLogin);
    return doReLogin;
  },
});

// lib/zm/server-resolver.ts has no store imports for the same reason
// (getPortalUrlForMonitor/getPortalUrlForEvent are plain functions called
// from many components that already pass the profile they care about; an
// omitted profileId falls back to the current profile via this gate).
// Refs #337.
registerServerResolverGate({
  getCurrentProfileId: () => useProfileStore.getState().currentProfileId,
});

// stores/auth.ts's login/refreshAccessToken resolve their API client through
// this late-bound gate: getSession can't be imported there directly without
// cycling (services/sessions -> api/store-gates -> stores/auth). This module
// already imports both, so it wires them together. Refs #337.
registerAuthClientResolver((profileId) => getSession(profileId).client);

// Subscribe to auth store to update refresh token in profile
useAuthStore.subscribe((state) => {
  const { currentProfileId, updateProfile, profiles } = useProfileStore.getState();
  if (!currentProfileId) return;

  const refreshToken = state.slices[currentProfileId]?.refreshToken;
  if (currentProfileId && refreshToken) {
    const profile = profiles.find(p => p.id === currentProfileId);
    if (profile && profile.refreshToken !== refreshToken) {
      log.profileService('Updating profile with new refresh token', LogLevel.INFO, { profileId: currentProfileId });
      updateProfile(currentProfileId, { refreshToken });
    }
  }
});
