/**
 * Which bucket each profile-scoped setting lives in.
 *
 * Selection scope: how the user likes to use the app. Written to and read
 * from the current selection's bucket (the aggregate's own bucket when a
 * virtual profile group is selected): `useCurrentProfile().settings`, or
 * `getProfileSettings(currentProfileId)` outside React.
 *
 * Server scope: how one server sends video and data. Written to and read from
 * the bucket of the profile that owns the monitor or event:
 * `useProfileById(ownerProfileId)`, or `getProfileSettings(ownerProfileId)`.
 *
 * With one profile selected both resolve to the same bucket. The contract
 * gate in tests/agents-contracts.test.ts reads SERVER_SCOPED_SETTINGS.
 */

import type { ProfileSettings } from './settings';

export const SELECTION_SCOPED_SETTINGS = [
  'startScreen',
  'dateFormat',
  'timeFormat',
  'customDateFormat',
  'customTimeFormat',
  'theme',
  'hoverPreview',
  'hoverPreviewPlaybackRate',
  'insomnia',
  'landscapeFullscreen',
  'tvMode',
  'monitorsPerPage',
  'skipOfflineMonitors',
  'monitorDetailFullscreen',
  'defaultEventLimit',
  'eventVideoAutoplay',
  'eventPlaybackFullscreen',
  'monitorDetailRecentEventsCount',
  'eventContext',
  'bandwidthMode',
  'logLevel',
  'componentLogLevels',
  'disableLogRedaction',
] as const satisfies readonly (keyof ProfileSettings)[];

export const SERVER_SCOPED_SETTINGS = [
  'excludedMonitorIds',
  'viewMode',
  'snapshotRefreshInterval',
  'streamMaxFps',
  'streamScale',
  'streamingMethod',
  'webrtcProtocols',
  'webrtcUseStun',
  'showProtocolLabel',
  'thumbnailFallbackChain',
  'allowSelfSignedCerts',
  'trustedCertFingerprint',
  'apiTimeoutSeconds',
  'forceDisableMultiPort',
  'assistantEnabled',
  'assistantInToolbar',
  'assistantBackend',
  'assistantModelId',
  'assistantOllamaBaseUrl',
  'assistantOllamaModel',
  'assistantTemperature',
  'assistantTimeoutSec',
  'assistantHistoryTurns',
] as const satisfies readonly (keyof ProfileSettings)[];
