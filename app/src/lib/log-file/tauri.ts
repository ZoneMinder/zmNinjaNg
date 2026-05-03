import {
  writeTextFile,
  readTextFile,
  mkdir,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { appLogDir, join } from '@tauri-apps/api/path';
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
      // Ensure the log dir exists
      await mkdir('', { baseDir: BaseDirectory.AppLog, recursive: true });
    } catch {
      // mkdir on existing dir is OK; on real failure, subsequent writes will surface it
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
    await writeTextFile(LOG_FILE_NAME, '', {
      append: false,
      baseDir: BaseDirectory.AppLog,
    });
    this.entryCount = 0;
  }

  async getDisplayPath(): Promise<string | null> {
    const dir = await appLogDir();
    return join(dir, LOG_FILE_NAME);
  }

  async getFileUri(): Promise<string | null> {
    // Tauri does not expose the file via Capacitor Share; returning null is fine.
    return null;
  }

  async revealLocation(): Promise<void> {
    const path = await this.getDisplayPath();
    if (path) await revealItemInDir(path);
  }
}
