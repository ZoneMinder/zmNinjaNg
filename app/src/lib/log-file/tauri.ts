import type { LogEntry } from '../../stores/logs';
import type { LogFileStore, LogFileCapabilities } from './types';
import {
  LOG_FILE_FLUSH_INTERVAL_MS,
  LOG_FILE_MAX_ENTRIES,
  LOG_FILE_NAME,
  LOG_FILE_TRUNCATE_RETAIN,
} from './types';

export class TauriLogFileStore implements LogFileStore {
  capabilities: LogFileCapabilities = { share: false, reveal: true, available: true };

  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private entryCount = 0;
  private rotationInProgress = false;

  async initialize(): Promise<void> {
    try {
      // Tauri v2's plugin-fs rejects an empty path, and the FS scope only
      // permits paths inside $APPLOG. Resolve the absolute log dir and
      // recursively create it instead — this also creates Linux's missing
      // `<bundle-id>/logs/` subdir which the OS does not pre-create.
      const { appLogDir } = await import('@tauri-apps/api/path');
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const dir = await appLogDir();
      await mkdir(dir, { recursive: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[log-file] mkdir failed', err);
    }
    try {
      const existing = await this.readAll();
      this.entryCount = existing.length;
    } catch {
      this.entryCount = 0;
    }
  }

  append(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, LOG_FILE_FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const toWrite = this.buffer;
    this.buffer = [];
    const data = toWrite.map((e) => JSON.stringify(e)).join('\n') + '\n';
    try {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(LOG_FILE_NAME, data, {
        append: true,
        baseDir: BaseDirectory.AppLog,
      });
      this.entryCount += toWrite.length;
      if (this.entryCount > LOG_FILE_MAX_ENTRIES && !this.rotationInProgress) {
        void this.rotate();
      }
    } catch (err) {
      // Best-effort. Don't recurse through the logger.
      // eslint-disable-next-line no-console
      console.warn('[log-file] append failed', err);
    }
  }

  private async rotate(): Promise<void> {
    this.rotationInProgress = true;
    try {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const all = await this.readAll();
      const kept = all.slice(-LOG_FILE_TRUNCATE_RETAIN);
      const data = kept.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await writeTextFile(LOG_FILE_NAME, data, {
        append: false,
        baseDir: BaseDirectory.AppLog,
      });
      this.entryCount = kept.length;
    } finally {
      this.rotationInProgress = false;
    }
  }

  async readAll(): Promise<LogEntry[]> {
    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const text = await readTextFile(LOG_FILE_NAME, { baseDir: BaseDirectory.AppLog });
      const out: LogEntry[] = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed) as LogEntry);
        } catch {
          // skip malformed line
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async truncate(): Promise<void> {
    this.buffer = [];
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(LOG_FILE_NAME, '', {
      append: false,
      baseDir: BaseDirectory.AppLog,
    });
    this.entryCount = 0;
  }

  async getDisplayPath(): Promise<string | null> {
    try {
      const { appLogDir } = await import('@tauri-apps/api/path');
      const { join } = await import('@tauri-apps/api/path');
      const dir = await appLogDir();
      return join(dir, LOG_FILE_NAME);
    } catch {
      return null;
    }
  }

  async getFileUri(): Promise<string | null> {
    // Tauri does not expose the file via Capacitor Share; returning null is fine.
    return null;
  }

  async revealLocation(): Promise<void> {
    const path = await this.getDisplayPath();
    if (!path) return;
    const { revealItemInDir, openPath } = await import('@tauri-apps/plugin-opener');
    try {
      await revealItemInDir(path);
    } catch {
      // Linux fallback: revealItemInDir uses D-Bus to talk to a registered
      // file manager (org.freedesktop.FileManager1.ShowItems). Minimal
      // desktops and AppImage runtimes often don't have one. Open the
      // enclosing directory with xdg-open instead.
      const { appLogDir } = await import('@tauri-apps/api/path');
      const dir = await appLogDir();
      await openPath(dir);
    }
  }
}
