/**
 * ZoneMinder Protocol Constants
 *
 * These constants are defined by the ZoneMinder streaming protocol and control interface.
 * They represent the official ZoneMinder protocol values and should not be modified.
 *
 * References:
 * - ZoneMinder source: src/zm_stream.h (MsgCommand enum)
 * - ZoneMinder source: src/zms.cpp (streaming daemon)
 * - ZoneMinder source: web/includes/actions/control.php (control actions)
 * - ZoneMinder documentation: https://zoneminder.readthedocs.io/
 */

/**
 * ZMS Stream Command Codes
 *
 * Commands sent to the ZoneMinder Streaming Server (zms) to control playback,
 * navigation, and stream lifecycle.
 *
 * Used via: /index.php?view=request&request=stream&command=<code>&connkey=<key>
 */
export const ZMS_COMMANDS = {
  /** No command / idle */
  cmdNone: 0,

  /** Pause playback */
  cmdPause: 1,

  /** Start/resume playback */
  cmdPlay: 2,

  /** Stop playback */
  cmdStop: 3,

  /** Fast forward */
  cmdFastFwd: 4,

  /** Slow forward */
  cmdSlowFwd: 5,

  /** Slow reverse */
  cmdSlowRev: 6,

  /** Fast reverse */
  cmdFastRev: 7,

  /** Zoom in */
  cmdZoomIn: 8,

  /** Zoom out */
  cmdZoomOut: 9,

  /** Pan camera */
  cmdPan: 10,

  /** Scale stream */
  cmdScale: 11,

  /** Previous frame/event */
  cmdPrev: 12,

  /** Next frame/event */
  cmdNext: 13,

  /** Seek to position */
  cmdSeek: 14,

  /** Variable playback speed */
  cmdVarPlay: 15,

  /** Get single image */
  cmdGetImage: 16,

  /** Quit/close stream connection - IMPORTANT for cleanup */
  cmdQuit: 17,

  /** Set maximum FPS */
  cmdMaxFps: 18,

  /** Serve analysis frames (motion overlay) instead of the captured image */
  cmdAnalyzeOn: 19,

  /** Go back to the captured image */
  cmdAnalyzeOff: 20,

  /** Query stream status */
  cmdQuery: 99,
} as const;

/** Reverse lookup: ZMS command number to a readable name (e.g. 14 -> "Seek"). */
const ZMS_COMMAND_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(ZMS_COMMANDS).map(([key, value]) => [value, key.replace(/^cmd/, '')])
);

/**
 * Human-readable name for a ZMS command number, for logging.
 *
 * @param command - A ZMS command value (see ZMS_COMMANDS)
 * @returns The command name (e.g. "Seek", "Play"), or "Unknown(<n>)"
 */
export function zmsCommandName(command: number): string {
  return ZMS_COMMAND_NAMES[command] ?? `Unknown(${command})`;
}

/**
 * ZMS Stream Modes
 *
 * Defines the type of stream requested from zms.
 * Used as the 'mode' parameter in stream URLs.
 */
export const ZMS_MODES = {
  /** MJPEG stream - continuous multipart JPEG frames */
  jpeg: 'jpeg',

  /** Single frame snapshot - one JPEG image */
  single: 'single',

  /** Raw stream - direct camera stream (rarely used) */
  stream: 'stream',
} as const;

/**
 * First ZoneMinder release whose zms understands `frames=`, the parameter that
 * stops a jpeg stream after N frames. Older zms logs it as unknown and streams
 * forever, so snapshots stay on mode=single there (refs #383).
 */
export const ZMS_FRAMES_PARAM_MIN_VERSION = '1.37.61';

/**
 * `scale=` value that asks zms for the monitor's own frame size. Anything
 * lower is ZoneMinder resizing before it sends, which costs detail the client
 * cannot get back by magnifying (refs #478).
 */
export const ZMS_FULL_SCALE = 100;

/**
 * Monitor `Decoding` value that keeps zmc decoding whether or not anyone is
 * watching. The others ('None', 'Ondemand', 'KeyFrames', 'KeyFrames+Ondemand')
 * decode on demand or not at all. Absent before ZM 1.37.
 */
export const ZM_DECODING_ALWAYS = 'Always';

/**
 * Monitor Function States
 *
 * Valid states for a ZoneMinder monitor's function setting.
 * Determines how the monitor operates (disabled, recording, motion detection, etc.)
 */
export const ZM_MONITOR_FUNCTIONS = {
  /** Monitor is disabled */
  none: 'None',

  /** View only, no recording or analysis */
  monitor: 'Monitor',

  /** Motion detection only */
  modect: 'Modect',

  /** Continuous recording */
  record: 'Record',

  /** Continuous recording with motion detection */
  mocord: 'Mocord',

  /** External trigger only */
  nodect: 'Nodect',
} as const;

/**
 * Type-safe command values
 */
export type ZmsCommand = typeof ZMS_COMMANDS[keyof typeof ZMS_COMMANDS];
export type ZmsMode = typeof ZMS_MODES[keyof typeof ZMS_MODES];
export type ZmMonitorFunction = typeof ZM_MONITOR_FUNCTIONS[keyof typeof ZM_MONITOR_FUNCTIONS];

/**
 * Tags API Constants
 */

/** Maximum number of event IDs per batch when fetching event tags to avoid URL length limits */
export const TAGS_BATCH_SIZE = 100;

/**
 * Events API Datetime Format
 *
 * The `date-fns` `format()` pattern the ZM events-index API expects for
 * `StartDateTime`/`EndDateTime` filter segments: 'YYYY-MM-DD HH:mm:ss' (space,
 * not 'T'), in whatever timezone the caller resolved the instant to (ZM has
 * no timezone-aware filter syntax; see `format-date-time.ts`'s
 * `formatForServer` and `lib/assistant/event-range.ts`'s `resolveEventRange`).
 */
export const ZM_API_DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';

/**
 * Zone Coordinate Space
 *
 * A zone's `Coords` are stored either in capture pixels or in percent of the
 * frame, and no field says which: the zone's `Units` column describes the
 * analysis parameters (MinAlarmPixels and its friends), not the coordinates.
 * ZoneMinder's own renderer treats a point above this value as pixels and
 * anything at or below it as percent (`web/includes/Zone.php`, `svg_polygon`),
 * so anything drawing zone coordinates decides the same way.
 */
export const ZONE_PERCENT_MAX = 100;
