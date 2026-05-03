import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { LogEntry } from '../../stores/logs';
import type { LogFileStore, LogFileCapabilities } from './types';
import {
  LOG_FILE_FLUSH_INTERVAL_MS,
  LOG_FILE_MAX_ENTRIES,
  LOG_FILE_NAME,
  LOG_FILE_TRUNCATE_RETAIN,
} from './types';

export class CapacitorLogFileStore implements LogFileStore {
  capabilities: LogFileCapabilities = { share: true, reveal: false, available: true };

  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private entryCount = 0;
  private rotationInProgress = false;

  async initialize(): Promise<void> {
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
      await Filesystem.appendFile({
        path: LOG_FILE_NAME,
        directory: Directory.Data,
        data,
        encoding: Encoding.UTF8,
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
      await Filesystem.writeFile({
        path: LOG_FILE_NAME,
        directory: Directory.Data,
        data,
        encoding: Encoding.UTF8,
      });
      this.entryCount = kept.length;
    } finally {
      this.rotationInProgress = false;
    }
  }

  async readAll(): Promise<LogEntry[]> {
    try {
      const res = await Filesystem.readFile({
        path: LOG_FILE_NAME,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      const text = typeof res.data === 'string' ? res.data : '';
      const out: LogEntry[] = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed) as LogEntry);
        } catch {
          // Skip malformed line
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
    await Filesystem.writeFile({
      path: LOG_FILE_NAME,
      directory: Directory.Data,
      data: '',
      encoding: Encoding.UTF8,
    });
    this.entryCount = 0;
  }

  async getDisplayPath(): Promise<string | null> {
    try {
      const { uri } = await Filesystem.getUri({ path: LOG_FILE_NAME, directory: Directory.Data });
      return uri;
    } catch {
      return null;
    }
  }

  async getFileUri(): Promise<string | null> {
    return this.getDisplayPath();
  }

  async revealLocation(): Promise<void> {
    // Not supported on Capacitor (no file manager exposure).
  }
}
