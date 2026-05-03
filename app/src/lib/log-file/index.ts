import { Capacitor } from '@capacitor/core';
import { useLogStore } from '../../stores/logs';
import { NoopLogFileStore } from './noop';
import { CapacitorLogFileStore } from './capacitor';
import { TauriLogFileStore } from './tauri';
import type { LogFileStore } from './types';

let instance: LogFileStore | null = null;

function detect(): LogFileStore {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return new TauriLogFileStore();
  }
  if (Capacitor.isNativePlatform()) {
    return new CapacitorLogFileStore();
  }
  return new NoopLogFileStore();
}

export function getLogFile(): LogFileStore {
  if (!instance) instance = detect();
  return instance;
}

/** Test helper — resets the singleton. Do not call from production code. */
export function __resetLogFileForTests(replacement?: LogFileStore): void {
  instance = replacement ?? null;
}

export async function initializeLogFile(): Promise<void> {
  await getLogFile().initialize();
}

export async function hydrateLogStoreFromFile(): Promise<void> {
  const entries = await getLogFile().readAll();
  if (entries.length === 0) return;
  // File is appended chronologically (oldest-first); useLogStore expects
  // newest-first ([0] is newest, set by addLog prepending). Reverse on hydrate.
  useLogStore.setState({ logs: entries.slice().reverse() });
}

export type { LogFileStore } from './types';
