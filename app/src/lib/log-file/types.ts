// app/src/lib/log-file/types.ts
import type { LogEntry } from '../../stores/logs';

export interface LogFileCapabilities {
  /** True on Capacitor (mobile) — system share sheet available. */
  share: boolean;
  /** True on Tauri (desktop) — can reveal file in Finder/Explorer. */
  reveal: boolean;
  /** True when persistence is available at all. False on web. */
  available: boolean;
}

export interface LogFileStore {
  initialize(): Promise<void>;

  /** Fire-and-forget. Buffered internally; flushes on a timer or lifecycle event. */
  append(entry: LogEntry): void;

  /** Force-flush the in-memory write buffer to disk. */
  flush(): Promise<void>;

  /** Read all persisted entries (parsed from NDJSON). For hydration. */
  readAll(): Promise<LogEntry[]>;

  /** Wipe the file (zero bytes). */
  truncate(): Promise<void>;

  /** Human-readable path for the status line. Null if unavailable. */
  getDisplayPath(): Promise<string | null>;

  /** Platform-native URI suitable for Capacitor Share. Null if unavailable. */
  getFileUri(): Promise<string | null>;

  /** Reveal the file in Finder/Explorer (Tauri only). No-op elsewhere. */
  revealLocation(): Promise<void>;

  capabilities: LogFileCapabilities;
}

/** Cap. When exceeded, file is rewritten with the most recent half. */
export const LOG_FILE_MAX_ENTRIES = 10_000;
export const LOG_FILE_TRUNCATE_RETAIN = 5_000;

/** Filename used in app-data/log directories. */
export const LOG_FILE_NAME = 'zmninja-ng.log';

/** How often (ms) the in-memory buffer is flushed under continuous load. */
export const LOG_FILE_FLUSH_INTERVAL_MS = 1000;
