import { z } from 'zod';
import { log, LogLevel } from '../lib/logger';
import { tolerantArray, withFieldCatch } from '../lib/zm/schema-tolerance';

/** Query shape for the events index. Consumed by api/events.ts. */
export interface EventFilters {
  monitorId?: string;
  startDateTime?: string;
  endDateTime?: string;
  archived?: boolean;
  minAlarmFrames?: number;
  notesRegexp?: string; // REGEXP filter on Notes field (e.g., "detected:" for object detection)
  cause?: string; // Filter by event cause (e.g., "Motion", "Continuous", "Signal", "Forced")
  /** Drop events whose Cause matches, via ZoneMinder's `Cause NOT REGEXP:`.
   *  Its own field rather than a sign on `cause`, so a query can keep one
   *  cause and drop another (refs #493). ZM 1.38.3 partitions a set exactly
   *  between REGEXP and NOT REGEXP; an unknown operator fails with a 500
   *  rather than returning everything. A row with a null Cause is dropped by
   *  an exclusion, since `NULL NOT REGEXP 'x'` is not true in MySQL. */
  causeExclude?: string;
  // Restrict results to these event IDs via ZM's "Id IN:" filter. Used for the
  // locally-stored favorites concept, which must compose with pagination:
  // passing the IDs to the server keeps totalCount and "Load More" accurate
  // (refs #205). An empty array matches no events (returns an empty list with
  // no request). undefined means "no Id filter".
  eventIds?: string[];
  // Restrict results to events carrying any of these ZM tag IDs, via the
  // server-side "Tags.Id:" filter (one request per tag, merged). Concrete tag
  // IDs only; the caller expands the "all tags" option to the full tag list.
  // ZM cannot combine "Tags.Id:" with "Id IN:" in one query, so callers must
  // not set both eventIds and tagIds (eventIds wins if they do).
  tagIds?: string[];
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

// Authentication types
export const LoginResponseSchema = z.object(
  withFieldCatch({
  access_token: z.string().optional(),
  access_token_expires: z.coerce.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires: z.coerce.number().optional(),
  credentials: z.string().optional(),
  append_password: z.coerce.number().optional(),
  version: z.string().optional(),
  apiversion: z.string().optional(),
  }, []),
);

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// Version types
export const VersionResponseSchema = z.object(
  withFieldCatch({
  version: z.string(),
  apiversion: z.string(),
  }, []),
);

export type VersionResponse = z.infer<typeof VersionResponseSchema>;

// Host types
export const HostTimeZoneResponseSchema = z.object({
  DateTime: z.object({
    TimeZone: z.string().optional(),
    Timezone: z.string().optional(),
    timezone: z.string().optional(),
  }).optional(),
  dateTime: z.object({
    TimeZone: z.string().optional(),
    Timezone: z.string().optional(),
    timezone: z.string().optional(),
  }).optional(),
  // Support root level keys
  TimeZone: z.string().optional(),
  Timezone: z.string().optional(),
  timezone: z.string().optional(),
  tz: z.string().optional(),
}).transform((data) => {
  // Check nested first
  const dt = data.DateTime || data.dateTime;
  let tz = dt ? (dt.TimeZone || dt.Timezone || dt.timezone) : undefined;

  // If not nested, check root
  if (!tz) {
    tz = data.TimeZone || data.Timezone || data.timezone || data.tz;
  }

  if (!tz) {
    // Log the actual data to help debugging if this fails
    log.api('HostTimeZoneResponseSchema validation failed', LogLevel.WARN, { receivedData: JSON.stringify(data) });
    throw new Error('Response missing TimeZone field (checked root and DateTime object)');
  }

  return {
    DateTime: {
      TimeZone: tz
    }
  };
});

export type HostTimeZoneResponse = z.infer<typeof HostTimeZoneResponseSchema>;

// Monitor types
export const MonitorStatusSchema = z.object(
  withFieldCatch({
  MonitorId: z.coerce.string().nullable(),
  Status: z.coerce.string().nullable(),
  CaptureFPS: z.coerce.string().nullable().optional(),
  AnalysisFPS: z.coerce.string().nullable().optional(),
  CaptureBandwidth: z.coerce.string().nullable().optional(),
  }, []),
);

/**
 * A ZoneMinder monitor row (refs #247, rule 43).
 *
 * `withFieldCatch` puts a type-matching fallback on every field except the
 * identity pair, so a field whose type drifts falls back instead of failing the
 * whole response. ZoneMinder changes what it sends between releases, and this
 * schema is the only thing between that and a blank screen. In 1.38.3
 * `V4LMultiBuffer` started arriving as boolean `false` (and `null`) where the
 * schema said string, and every camera vanished from the app over a field it
 * never reads.
 *
 * Two distinct hazards, only one of which is about NEW fields:
 *
 * 1. A field ZoneMinder adds that we do not declare is already harmless: Zod
 *    strips unknown keys. This is guaranteed by tests in `__tests__/types.test.ts`,
 *    not by luck, so a stray `.strict()` cannot quietly revoke it.
 * 2. A field we DO declare whose type drifts, or that stops being sent, used to
 *    throw. `withFieldCatch` is what fixes that: the field falls back, the rest
 *    of the monitor survives, and the user keeps their cameras.
 *
 * `Id` and `Name` are the identity pair and stay strict: a fallback there would
 * render a phantom camera, so a monitor missing them is dropped by
 * `MonitorsResponseSchema` instead.
 *
 * The mode fields are `z.string()`, not `z.enum()`. A ZoneMinder release that
 * adds a `Function` value must not blank the screen, and defaulting an unknown
 * mode would be worse than failing: it would report a recording camera as off.
 */
export const MonitorSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string(),
  Notes: z.string().nullable().optional(),
  Deleted: z.boolean().optional(),
  ServerId: z.coerce.string().nullable(),
  StorageId: z.coerce.string().nullable(),
  Type: z.string(),
  Function: z.string(),
  // ZM 1.38+ fields (replace Function with independent controls)
  Capturing: z.string().optional(),
  Analysing: z.string().optional(),
  Recording: z.string().optional(),
  /** 'None' | 'Ondemand' | 'KeyFrames' | 'KeyFrames+Ondemand' | 'Always'. Absent before ZM 1.37. */
  Decoding: z.string().optional(),
  Enabled: z.coerce.string(),
  LinkedMonitors: z.string().nullable(),
  Triggers: z.string().nullable(),
  Device: z.string().nullable(),
  Channel: z.coerce.string().nullable(),
  Format: z.coerce.string().nullable(),
  // ZM 1.38.3 sends boolean false or null here, never the DB's integer (#247).
  V4LMultiBuffer: z.coerce.string().nullable(),
  V4LCapturesPerFrame: z.coerce.string().nullable(),
  Protocol: z.string().nullable(),
  Method: z.string().nullable(),
  Host: z.string().nullable(),
  Port: z.coerce.string().nullable(),
  SubPath: z.string().nullable(),
  Path: z.string().nullable(),
  Options: z.string().nullable(),
  User: z.string().nullable(),
  Pass: z.string().nullable(),
  Width: z.coerce.string(),
  Height: z.coerce.string(),
  Colours: z.coerce.string(),
  Palette: z.coerce.string().nullable(),
  Orientation: z.string().nullable(),
  Deinterlacing: z.coerce.string().nullable(),
  DecoderHWAccelName: z.string().nullable(),
  DecoderHWAccelDevice: z.string().nullable(),
  SaveJPEGs: z.coerce.string().nullable(),
  VideoWriter: z.coerce.string().nullable(),
  EncoderParameters: z.string().nullable(),
  RecordAudio: z.coerce.string().nullable(),
  RTSPDescribe: z.coerce.string().nullable(),
  Brightness: z.coerce.number().nullable(),
  Contrast: z.coerce.number().nullable(),
  Hue: z.coerce.number().nullable(),
  Colour: z.coerce.number().nullable(),
  EventPrefix: z.string().nullable(),
  EventStartCommand: z.string().nullable().optional(),
  EventEndCommand: z.string().nullable().optional(),
  LabelFormat: z.string().nullable(),
  LabelX: z.coerce.string().nullable(),
  LabelY: z.coerce.string().nullable(),
  LabelSize: z.coerce.string().nullable(),
  ImageBufferCount: z.coerce.string(),
  WarmupCount: z.coerce.string(),
  PreEventCount: z.coerce.string(),
  PostEventCount: z.coerce.string(),
  StreamReplayBuffer: z.coerce.string(),
  AlarmFrameCount: z.coerce.string(),
  SectionLength: z.coerce.string(),
  MinSectionLength: z.coerce.string(),
  FrameSkip: z.coerce.string(),
  MotionFrameSkip: z.coerce.string(),
  AnalysisFPSLimit: z.coerce.string().nullable(),
  AnalysisUpdateDelay: z.coerce.string(),
  MaxFPS: z.coerce.string().nullable(),
  AlarmMaxFPS: z.coerce.string().nullable(),
  FPSReportInterval: z.coerce.string(),
  RefBlendPerc: z.coerce.string(),
  AlarmRefBlendPerc: z.coerce.string(),
  Controllable: z.coerce.string(),
  ControlId: z.coerce.string().nullable(),
  ControlDevice: z.string().nullable(),
  ControlAddress: z.string().nullable(),
  AutoStopTimeout: z.coerce.string().nullable(),
  TrackMotion: z.coerce.string().nullable(),
  TrackDelay: z.coerce.string().nullable(),
  ReturnLocation: z.coerce.string().nullable(),
  ReturnDelay: z.coerce.string().nullable(),
  ModectDuringPTZ: z.coerce.string().nullable(),
  DefaultRate: z.coerce.string(),
  DefaultScale: z.coerce.string(),
  SignalCheckPoints: z.coerce.string().nullable(),
  SignalCheckColour: z.string(),
  WebColour: z.string(),
  Exif: z.coerce.string().nullable(),
  Sequence: z.coerce.string().nullable(),
  ZoneCount: z.coerce.number(),
  Refresh: z.coerce.string().nullable(),
  DefaultCodec: z.string().nullable(),
  GroupIds: z.coerce.string().nullable().optional(),
  Latitude: z.coerce.number().nullable(),
  Longitude: z.coerce.number().nullable(),
  RTSPServer: z.coerce.string().nullable(),
  RTSPStreamName: z.string().nullable(),
  Importance: z.string().nullable(),
  // Stream channel for Go2RTC (e.g., 'CameraDirectPrimary', 'Restream')
  StreamChannel: z.string().nullable().optional(),
  // Go2RTC fields (ZoneMinder 1.37+)
  Go2RTCEnabled: z.coerce.boolean().optional().default(false),
  Go2RTCType: z.string().nullable().optional(),
  RTSP2WebEnabled: z.coerce.boolean().optional().default(false),
  RTSP2WebType: z.string().nullable().optional(),
  JanusEnabled: z.coerce.boolean().optional().default(false),
  DefaultPlayer: z.string().nullable().optional(),
  }, ['Id', 'Name']),
);

export const MonitorDataSchema = z.object({
  Monitor: MonitorSchema,
  Monitor_Status: MonitorStatusSchema.optional(),
});

/**
 * One unusable monitor must not cost the user every other camera (refs #247).
 * `withFieldCatch` on MonitorSchema absorbs type drift, so a row only fails on a
 * missing `Id`/`Name`, which no fallback can invent; `tolerantArray` drops that
 * row and renders the rest instead of failing the whole list.
 */
export const MonitorsResponseSchema = z.object({
  monitors: tolerantArray(MonitorDataSchema, 'monitor'),
});

export type Monitor = z.infer<typeof MonitorSchema>;
export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;
export type MonitorData = z.infer<typeof MonitorDataSchema>;
export type MonitorsResponse = z.infer<typeof MonitorsResponseSchema>;

// Monitor alarm status response (for getAlarmStatus and alarm control endpoints)
// ZM alarm() function returns different structures based on command and success/failure:
// - Success with 'status' command: { status: number, output: number }
// - Success with 'on'/'off' commands: { status: string, output: string }
// - Error: { status: 'false', code: number, error: string }
export const AlarmStatusResponseSchema = z.object(
  withFieldCatch({
  status: z.union([z.string(), z.coerce.number()]),
  output: z.union([z.string(), z.coerce.number()]).optional(),
  // Error response fields
  code: z.coerce.number().optional(),
  error: z.string().optional(),
  }, []),
);

export type AlarmStatusResponse = z.infer<typeof AlarmStatusResponseSchema>;

// Monitor daemon status response (for getDaemonStatus endpoint)
// ZM daemonControl() returns: { status: 'ok', statustext: string }
export const DaemonStatusResponseSchema = z.object(
  withFieldCatch({
  status: z.string(),
  statustext: z.string().optional(), // The actual status message
  }, []),
);

export type DaemonStatusResponse = z.infer<typeof DaemonStatusResponseSchema>;

export const ZMControlSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string(),
  Type: z.string(),
  Protocol: z.string().nullable(),
  CanWake: z.coerce.string().optional(),
  CanSleep: z.coerce.string().optional(),
  CanReset: z.coerce.string().optional(),
  CanReboot: z.coerce.string().optional(),
  CanZoom: z.coerce.string().optional(),
  CanAutoZoom: z.coerce.string().optional(),
  CanZoomAbs: z.coerce.string().optional(),
  CanZoomRel: z.coerce.string().optional(),
  CanZoomCon: z.coerce.string().optional(),
  HasZoomSpeed: z.coerce.string().optional(),
  CanFocus: z.coerce.string().optional(),
  CanAutoFocus: z.coerce.string().optional(),
  CanFocusAbs: z.coerce.string().optional(),
  CanFocusRel: z.coerce.string().optional(),
  CanFocusCon: z.coerce.string().optional(),
  HasFocusSpeed: z.coerce.string().optional(),
  CanIris: z.coerce.string().optional(),
  CanAutoIris: z.coerce.string().optional(),
  CanIrisAbs: z.coerce.string().optional(),
  CanIrisRel: z.coerce.string().optional(),
  CanIrisCon: z.coerce.string().optional(),
  HasIrisSpeed: z.coerce.string().optional(),
  CanGain: z.coerce.string().optional(),
  CanAutoGain: z.coerce.string().optional(),
  CanGainAbs: z.coerce.string().optional(),
  CanGainRel: z.coerce.string().optional(),
  CanGainCon: z.coerce.string().optional(),
  HasGainSpeed: z.coerce.string().optional(),
  CanWhite: z.coerce.string().optional(),
  CanAutoWhite: z.coerce.string().optional(),
  CanWhiteAbs: z.coerce.string().optional(),
  CanWhiteRel: z.coerce.string().optional(),
  CanWhiteCon: z.coerce.string().optional(),
  HasWhiteSpeed: z.coerce.string().optional(),
  HasPresets: z.coerce.string().optional(),
  NumPresets: z.coerce.string().optional(),
  HasHomePreset: z.coerce.string().optional(),
  CanSetPresets: z.coerce.string().optional(),
  CanMove: z.coerce.string().optional(),
  CanMoveDiag: z.coerce.string().optional(),
  CanMoveMap: z.coerce.string().optional(),
  CanMoveAbs: z.coerce.string().optional(),
  CanMoveRel: z.coerce.string().optional(),
  CanMoveCon: z.coerce.string().optional(),
  CanPan: z.coerce.string().optional(),
  HasPanSpeed: z.coerce.string().optional(),
  HasTurboPan: z.coerce.string().optional(),
  CanTilt: z.coerce.string().optional(),
  HasTiltSpeed: z.coerce.string().optional(),
  HasTurboTilt: z.coerce.string().optional(),
  CanAutoScan: z.coerce.string().optional(),
  NumScanPaths: z.coerce.string().optional(),
  }, ['Id', 'Name']),
);

export const ControlDataSchema = z.object({
  control: z.object({
    Control: ZMControlSchema
  })
});

export type ZMControl = z.infer<typeof ZMControlSchema>;
export type ControlData = z.infer<typeof ControlDataSchema>;

// Event types
// Force re-bundle
export const EventSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  MonitorId: z.coerce.string(),
  StorageId: z.coerce.string().nullable(),
  SecondaryStorageId: z.coerce.string().nullable(),
  Name: z.string(),
  Cause: z.string(),
  StartDateTime: z.string(),
  EndDateTime: z.string().nullable(),
  Width: z.coerce.string(),
  Height: z.coerce.string(),
  Length: z.coerce.string(),
  Frames: z.coerce.string(),
  AlarmFrames: z.coerce.string(),
  AlarmFrameId: z.coerce.string().optional(),  // First alarm frame ID
  MaxScoreFrameId: z.coerce.string().optional(),  // Frame with highest score
  DefaultVideo: z.string().nullable(),
  SaveJPEGs: z.coerce.string().nullable(),
  TotScore: z.coerce.string(),
  AvgScore: z.coerce.string(),
  MaxScore: z.coerce.string(),
  Archived: z.coerce.string(),
  Videoed: z.coerce.string(),
  Uploaded: z.coerce.string(),
  Emailed: z.coerce.string(),
  Messaged: z.coerce.string(),
  Executed: z.coerce.string(),
  Notes: z.string().nullable(),
  StateId: z.coerce.string().nullable(),
  Orientation: z.string().nullable(),
  DiskSpace: z.coerce.string().nullable(),
  Scheme: z.string().nullable(),
  }, ['Id', 'Name']),
);

export const EventDataSchema = z.object({
  Event: EventSchema,
});

export const EventsResponseSchema = z.object({
  events: tolerantArray(EventDataSchema, 'event'),
  pagination: z.object(
    withFieldCatch({
      pageCount: z.coerce.number(),
      page: z.coerce.number(),
      current: z.coerce.number(),
      count: z.coerce.number(),
      prevPage: z.boolean(),
      nextPage: z.boolean(),
      limit: z.coerce.number(),
      totalCount: z.coerce.number().optional(), // Total events matching filters (from server)
    }),
  ),
});

export type Event = z.infer<typeof EventSchema>;
export type EventData = z.infer<typeof EventDataSchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

// Single event response (for getEvent endpoint)
export const EventResponseSchema = z.object({
  event: EventDataSchema,
});

export type EventResponse = z.infer<typeof EventResponseSchema>;

// Config types
export const ConfigSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string(),
  Value: z.string(),
  Type: z.string(),
  DefaultValue: z.string().nullable().optional(),
  Hint: z.string().nullable().optional(),
  Pattern: z.string().nullable().optional(),
  Format: z.string().nullable().optional(),
  Prompt: z.string().nullable().optional(),
  Help: z.string().nullable().optional(),
  Category: z.string(),
  Readonly: z.coerce.string().nullable().optional(),
  Requires: z.string().nullable().optional(),
  }, ['Id', 'Name']),
);

export const ConfigDataSchema = z.object({
  Config: ConfigSchema,
});

export const ConfigsResponseSchema = z.object({
  configs: tolerantArray(ConfigDataSchema, 'config'),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigData = z.infer<typeof ConfigDataSchema>;
export type ConfigsResponse = z.infer<typeof ConfigsResponseSchema>;

// ZMS Path response schema for fetching ZM_PATH_ZMS config
export const ZmsPathResponseSchema = z.object({
  config: z.object({
    // Tolerant per rule 43: a drifted Value must not fail the config read.
    Value: z.coerce.string().catch(''),
  }),
});

export type ZmsPathResponse = z.infer<typeof ZmsPathResponseSchema>;

// Min Streaming Port response schema for fetching ZM_MIN_STREAMING_PORT config
export const MinStreamingPortResponseSchema = z.object({
  config: z.object({
    Value: z.coerce.string().catch(''),
  }),
});

export type MinStreamingPortResponse = z.infer<typeof MinStreamingPortResponseSchema>;

// Go2RTC Path response schema for fetching ZM_GO2RTC_PATH config
export const Go2RTCPathResponseSchema = z.object({
  config: z.object({
    Value: z.coerce.string().catch(''),
  }),
});

export type Go2RTCPathResponse = z.infer<typeof Go2RTCPathResponseSchema>;

// ZoneMinder server log types
export const ZMLogSchema = z.object(
  withFieldCatch({
  Id: z.coerce.number(),
  TimeKey: z.string(),
  Component: z.string(),
  ServerId: z.coerce.number().nullable(),
  Pid: z.coerce.number().nullable(),
  Level: z.coerce.number(),
  Code: z.string(),
  Message: z.string(),
  File: z.string().nullable(),
  Line: z.coerce.number().nullable(),
  }, ['Id']),
);

export const ZMLogDataSchema = z.object({
  Log: ZMLogSchema,
});

export const ZMLogsResponseSchema = z.object({
  logs: tolerantArray(ZMLogDataSchema, 'log'),
  pagination: z.object(
    withFieldCatch({
      page: z.coerce.number(),
      current: z.coerce.number(),
      count: z.coerce.number(),
      prevPage: z.boolean(),
      nextPage: z.boolean(),
      pageCount: z.coerce.number(),
      order: z.record(z.string(), z.string()).optional(),
      limit: z.coerce.number(),
      options: z.object({
        conditions: z.array(z.unknown()),
      }).optional(),
      paramType: z.string().optional(),
      queryScope: z.unknown().nullable().optional(),
    }),
  ),
});

export type ZMLog = z.infer<typeof ZMLogSchema>;
export type ZMLogData = z.infer<typeof ZMLogDataSchema>;
export type ZMLogsResponse = z.infer<typeof ZMLogsResponseSchema>;

// User types
//
// Only `Username` is required: the permission columns are what this app came
// for, but a ZoneMinder version that renames or drops one must degrade to
// "unknown permission" rather than fail the whole response (refs #344).
export const ZMUserSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string().optional(),
  Username: z.string(),
  System: z.string().optional(),
  Monitors: z.string().optional(),
  Stream: z.string().optional(),
  Events: z.string().optional(),
  Control: z.string().optional(),
  Groups: z.string().optional(),
  }, ['Username']),
);

export const ZMUserDataSchema = z.object({
  User: ZMUserSchema,
});

export const ZMUsersResponseSchema = z.object({
  users: tolerantArray(ZMUserDataSchema, 'user').optional(),
});

export type ZMUser = z.infer<typeof ZMUserSchema>;
export type ZMUsersResponse = z.infer<typeof ZMUsersResponseSchema>;

// State types
export const StateSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string(),
  Definition: z.string(),
  IsActive: z.coerce.string(),
  }, ['Id', 'Name']),
);

export const StateDataSchema = z.object({
  State: z.object(
    withFieldCatch({
      Id: z.coerce.number(),
      Name: z.string(),
      Definition: z.string(),
      IsActive: z.coerce.number(),
    }, ['Id', 'Name']),
  ),
});

export const StatesResponseSchema = z.object({
  states: tolerantArray(StateDataSchema, 'state').optional(),
});

export type State = z.infer<typeof StateSchema>;
export type StateData = z.infer<typeof StateDataSchema>;
export type StatesResponse = z.infer<typeof StatesResponseSchema>;

// Profile types (app-specific, not from ZM API)

/**
 * Nominal type for a real profile id. A plain `string` cannot be assigned
 * where `ProfileId` is required; it must go through `asProfileId` first.
 * This stops an arbitrary string (or the wrong kind of id) from building a
 * profile-scoped query-cache key (see lib/query/query-keys.ts). Because the brand
 * is structurally still a string, a `ProfileId` is assignable anywhere a
 * plain `string` is expected, so existing reads are unaffected.
 */
export type ProfileId = string & { readonly __brand: 'ProfileId' };

/**
 * Casts a raw string into a `ProfileId`. Use only at the point a profile id
 * is minted or parsed (profile creation, a synthesized fallback id, or a
 * test fixture) - never to silence a type error at an unrelated call site.
 */
export function asProfileId(id: string): ProfileId {
  return id as ProfileId;
}

/**
 * Sentinel profile id for the retired "All Profiles" aggregate view. Never a
 * real server: it names no server, and services/sessions.ts's getSession
 * rejects it rather than resolving it to a profile. Never sent to a server.
 *
 * LEGACY: no surface selects it any more - virtual profile groups replaced it,
 * and switchProfile rejects it. It survives so the guards that keep an
 * aggregate id out of session/token/notification paths still recognize a
 * stored one, and so services/profile-initialization.ts can migrate it away on
 * rehydrate. Nothing new should reference it. Refs #337.
 */
export const ALL_PROFILES_ID: ProfileId = asProfileId('__all_profiles__');

/**
 * Sentinel profile id for anonymous pre-profile discovery: services/discovery.ts's
 * default when a caller (a test, or any future caller that forgets to) doesn't
 * pass a real id. Real callers (ProfileForm, Profiles edit-and-retest) always
 * pass a minted or saved ProfileId instead - this id never names a saved
 * profile. Its auth slice is excluded from persistence (stores/auth.ts's
 * `partialize`) so nothing under this id survives a reload, and it must stay
 * distinct from ALL_PROFILES_ID so a probe under this id can never be
 * mistaken for the aggregate identity Phase 2 reads. Refs #337.
 */
export const PROBE_PROFILE_ID: ProfileId = asProfileId('__probe__');

/**
 * Prefix every virtual-profile id carries. A virtual profile is a named group
 * of real profiles that aggregates exactly like All Servers, scoped to its
 * members; its id names no server either.
 *
 * The shape is deliberate. Service modules (services/pushNotifications.ts,
 * stores/notifications.ts) have to answer "is this id an aggregate?" without
 * reading the profile store, so the answer has to be derivable from the string
 * alone - a plain UUID would force a store lookup, or a new gate, into four
 * service modules. Refs #337.
 */
export const VIRTUAL_PROFILE_ID_PREFIX = '__virtual_';

/**
 * Mint an id for a new virtual profile. The only place a virtual id is
 * created; every stored `VirtualProfile.id` traces back to this call.
 */
export function mintVirtualProfileId(): ProfileId {
  return asProfileId(`${VIRTUAL_PROFILE_ID_PREFIX}${crypto.randomUUID()}`);
}

/** Whether `id` names a virtual profile (a stored group of real profiles). */
export function isVirtualProfileId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(VIRTUAL_PROFILE_ID_PREFIX);
}

/**
 * Whether `id` names any aggregate: the built-in All Servers sentinel or a
 * virtual profile. Guards that must reject "no single server behind this id"
 * ask this, not `=== ALL_PROFILES_ID`.
 */
export function isAggregateProfileId(id: string | null | undefined): boolean {
  return id === ALL_PROFILES_ID || isVirtualProfileId(id);
}

/**
 * A named group of real profiles. Membership is flat: `memberProfileIds` holds
 * real profile ids only, never another virtual id.
 */
export interface VirtualProfile {
  id: ProfileId;
  name: string;
  memberProfileIds: ProfileId[];
}

export interface Profile {
  id: ProfileId;
  name: string;
  portalUrl: string;
  apiUrl: string;
  cgiUrl: string;
  username?: string;
  password?: string; // encrypted
  refreshToken?: string; // stored in profile for auto-login
  isDefault: boolean;
  createdAt: number;
  lastUsed?: number;
  timezone?: string;
  minStreamingPort?: number; // ZM_MIN_STREAMING_PORT from server config
  go2rtcUrl?: string; // ZM_GO2RTC_PATH from server config (full URL)
  /** Excluded from selection and every All-mode aggregate (refs #337). Absent/undefined means enabled - no migration needed for existing persisted profiles. */
  disabled?: boolean;
}

// Stream options types
export interface StreamOptions {
  mode?: 'jpeg' | 'single' | 'stream';
  /** Stop a jpeg stream after this many frames (ZM 1.38+). */
  frames?: number;
  scale?: number;
  width?: number;
  height?: number;
  maxfps?: number;
  buffer?: number;
  token?: string;
  connkey?: number;
  cacheBuster?: number;
}

// Component prop types
export interface MonitorCardProps {
  monitor: Monitor;
  status: MonitorStatus | undefined;
  /** Events recorded since the user last looked at this monitor (refs #239) */
  newEventCount?: number;
  /** StartDateTime of this monitor's newest event, stamped when the badge clears */
  newestEventAt?: string | null;
  objectFit?: React.CSSProperties['objectFit'] | 'flex';
  compact?: boolean;
  /**
   * Profile that owns this monitor. Set only in All mode (see
   * useScopedMonitors); undefined in single mode means "the current
   * profile". Threaded down to the streaming hooks so the tile streams from
   * its own server, and used to switchProfile before any detail/events
   * navigation off this card.
   */
  profileId?: ProfileId | null;
  /** Owning profile's display name, rendered as a small chip. All mode only. */
  profileChip?: string;
  /**
   * Ref for the card's outer element, so a list can observe where this card
   * sits and gate the feeds it cannot see (refs #507).
   */
  tileRef?: (element: HTMLElement | null) => void;
  /**
   * Hold no connection at all. A browser opens six connections to one host, so
   * a long list of cards starves its visible feeds with requests for the ones
   * below the fold; the cards out of view take this instead (refs #507).
   */
  paused?: boolean;
}

export interface EventCardProps {
  event: Event;
  monitorName: string;
  /** All mode only: the owning profile, so the card routes to its /all/
   *  deep route instead of switching profiles first (refs #337). */
  profileId?: ProfileId;
  /** All mode only: the owning profile's display name, for a chip. */
  profileChip?: string;
  /** The event's monitor's ServerId, for the download button's multi-server
   *  portal routing (refs #494). */
  monitorServerId?: string | null;
  thumbnailUrls: string[];
  largeThumbnailUrls?: string[];
  objectFit?: React.CSSProperties['objectFit'];
  thumbnailWidth: number;
  thumbnailHeight: number;
  tags?: Tag[];
  eventFilters?: EventFilters;
}

// Zone types. `Zone.Type` is z.string(), not an enum: a ZoneMinder release that
// adds a zone type must not fail the zones response (rule 43). The known values
// live in `lib/monitor/zone-utils.ts` (ZONE_TYPE_ORDER) for the legend and picker.

export const ZoneSchema = z.object(
  withFieldCatch({
  Id: z.coerce.number(),
  MonitorId: z.coerce.number(),
  Name: z.string(),
  Type: z.string(),
  Units: z.string().optional(),
  NumCoords: z.coerce.number(),
  Coords: z.string(),
  Area: z.coerce.number().optional(),
  AlarmRGB: z.coerce.number().optional(),
  CheckMethod: z.string().optional(),
  MinPixelThreshold: z.coerce.number().nullable().optional(),
  MaxPixelThreshold: z.coerce.number().nullable().optional(),
  MinAlarmPixels: z.coerce.number().nullable().optional(),
  MaxAlarmPixels: z.coerce.number().nullable().optional(),
  FilterX: z.coerce.number().nullable().optional(),
  FilterY: z.coerce.number().nullable().optional(),
  MinFilterPixels: z.coerce.number().nullable().optional(),
  MaxFilterPixels: z.coerce.number().nullable().optional(),
  MinBlobPixels: z.coerce.number().nullable().optional(),
  MaxBlobPixels: z.coerce.number().nullable().optional(),
  MinBlobs: z.coerce.number().nullable().optional(),
  MaxBlobs: z.coerce.number().nullable().optional(),
  OverloadFrames: z.coerce.number().nullable().optional(),
  ExtendAlarmFrames: z.coerce.number().nullable().optional(),
  }, ['Id', 'Name']),
);

export const ZoneDataSchema = z.object({
  Zone: ZoneSchema,
});

export const ZonesResponseSchema = z.object({
  zones: tolerantArray(ZoneDataSchema, 'zone'),
});

export type Zone = z.infer<typeof ZoneSchema>;
export type ZoneType = string;
export type ZoneData = z.infer<typeof ZoneDataSchema>;
export type ZonesResponse = z.infer<typeof ZonesResponseSchema>;

// Group types
export const GroupSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string(),
  ParentId: z.coerce.string().nullable(),
  }, ['Id', 'Name']),
);

// Monitor reference within a group (subset of full Monitor)
export const GroupMonitorRefSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string().optional(),
  }, ['Id']),
);

export const GroupDataSchema = z.object({
  Group: GroupSchema,
  Monitor: tolerantArray(GroupMonitorRefSchema, 'group monitor').optional().default([]),
});

export const GroupsResponseSchema = z.object({
  groups: tolerantArray(GroupDataSchema, 'group'),
});

export type Group = z.infer<typeof GroupSchema>;
export type GroupMonitorRef = z.infer<typeof GroupMonitorRefSchema>;
export type GroupData = z.infer<typeof GroupDataSchema>;
export type GroupsResponse = z.infer<typeof GroupsResponseSchema>;

// Montage layout types
export interface MontageLayout {
  lg?: ReactGridLayout.Layout[];
  md?: ReactGridLayout.Layout[];
  sm?: ReactGridLayout.Layout[];
  xs?: ReactGridLayout.Layout[];
}

// Import for ReactGridLayout namespace
import type * as ReactGridLayout from 'react-grid-layout';

// Tag types
export const TagSchema = z.object(
  withFieldCatch({
  Id: z.coerce.string(),
  Name: z.string(),
  CreateDate: z.string().nullable().optional(),
  CreatedBy: z.coerce.string().nullable().optional(),
  LastAssignedDate: z.string().nullable().optional(),
  }, ['Id', 'Name']),
);

// Schema for tag data without event association (used for available tags list)
export const TagDataSchema = z.object({
  Tag: TagSchema,
});

// Schema for tag-event mapping from the API
// The API returns: { tags: [{ Tag: {...}, Events_Tags: {EventId: 1} }] }
// Each tag-event association is a separate entry in the array
export const TagEventMappingSchema = z.object({
  Tag: TagSchema,
  Events_Tags: z.object({
    EventId: z.coerce.string(),
  }).optional(),
});

// Response schema for GET /api/tags.json
// This returns all tags with their event associations
export const TagsResponseSchema = z.object({
  tags: tolerantArray(TagEventMappingSchema, 'tag'),
});

// Response schema for GET /api/tags/index/Events.Id:1,2,3.json
// Same format as TagsResponseSchema
export const EventTagsResponseSchema = z.object({
  tags: tolerantArray(TagEventMappingSchema, 'tag'),
});

export type Tag = z.infer<typeof TagSchema>;
export type TagData = z.infer<typeof TagDataSchema>;
export type TagEventMapping = z.infer<typeof TagEventMappingSchema>;
export type TagsResponse = z.infer<typeof TagsResponseSchema>;
export type EventTagsResponse = z.infer<typeof EventTagsResponseSchema>;

// Notification registration (Direct ZM push mode; ZoneMinder PR #4685).
// The endpoint is new enough that a server without it, or a proxy answering
// 200 with HTML, is a realistic response here. Id stays strict: a fallback
// there would invent a registration the server does not have, and
// notificationId is what the settings store persists as proof of success.
export const ZMNotificationSchema = z.object(
  withFieldCatch({
    Id: z.coerce.number(),
    UserId: z.coerce.number().nullable(),
    Token: z.string(),
    Platform: z.enum(['android', 'ios', 'web']),
    MonitorList: z.string().nullable(),
    Interval: z.coerce.number(),
    PushState: z.enum(['enabled', 'disabled']),
    AppVersion: z.string().nullable(),
    BadgeCount: z.coerce.number(),
    LastNotifiedAt: z.string().nullable(),
    CreatedOn: z.string(),
    UpdatedOn: z.string(),
  }, ['Id']),
);

export const ZMNotificationResponseSchema = z.object({
  notification: z.object({ Notification: ZMNotificationSchema }),
});

export type ZMNotificationResponse = z.infer<typeof ZMNotificationResponseSchema>;
