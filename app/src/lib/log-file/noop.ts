import type { LogFileStore, LogFileCapabilities } from './types';

export class NoopLogFileStore implements LogFileStore {
  capabilities: LogFileCapabilities = { share: false, reveal: false, available: false };

  async initialize(): Promise<void> {}
  append(): void {}
  async flush(): Promise<void> {}
  async readAll() { return []; }
  async truncate(): Promise<void> {}
  async getDisplayPath() { return null; }
  async getFileUri() { return null; }
  async revealLocation(): Promise<void> {}
}
