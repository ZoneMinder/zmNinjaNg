import type { LogFileStore, LogFileCapabilities } from './types';

export class NoopLogFileStore implements LogFileStore {
  capabilities: LogFileCapabilities = { share: false, available: false };

  async initialize(): Promise<void> {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  append(_entry: import('../../stores/logs').LogEntry): void {}
  async flush(): Promise<void> {}
  async readAll() { return []; }
  async truncate(): Promise<void> {}
  async getDisplayPath() { return null; }
  async getFileUri() { return null; }
}
