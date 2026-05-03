# Persistent Log File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the in-memory `useLogStore` to a persistent file so users can share/open it for support, with platform-specific behavior on Capacitor (iOS/Android), Tauri (desktop), and a no-op fallback on web.

**Architecture:** A `LogFileStore` interface with three implementations selected at startup. The Logger calls `getLogFile().append(entry)` after sanitization+filtering, alongside the existing `useLogStore.addLog()`. Hydration on app start replaces the in-memory store with parsed NDJSON from the file.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Capacitor Filesystem/Share v7, Tauri plugin-fs/plugin-opener v2, NDJSON file format.

**Spec:** `docs/superpowers/specs/2026-05-03-persistent-log-file-design.md`

**Issue:** #139

**Working directory note:** All `npm` commands run from `app/`. Use `cd /Users/arjun/fiddle/zmNinjaNg/app && <cmd>` form. All file paths in this plan are relative to repo root unless noted.

**Branch:** `feature/persistent-log-file` (already checked out, has spec commit `a1b639e`).

---

## Task 1: Define `LogFileStore` interface and types

**Files:**
- Create: `app/src/lib/log-file/types.ts`

- [ ] **Step 1: Create the types file**

```ts
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
```

- [ ] **Step 2: Type-check**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npx tsc --noEmit
```

Expected: TypeScript compilation completed (no errors).

- [ ] **Step 3: Commit**

```
git add app/src/lib/log-file/types.ts
git commit -m "feat(logs): add LogFileStore interface and constants

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Implement `NoopLogFileStore` (web fallback)

**Files:**
- Create: `app/src/lib/log-file/noop.ts`
- Create: `app/src/lib/log-file/__tests__/noop.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// app/src/lib/log-file/__tests__/noop.test.ts
import { describe, it, expect } from 'vitest';
import { NoopLogFileStore } from '../noop';
import type { LogEntry } from '../../../stores/logs';

const sampleEntry: LogEntry = {
  id: 'a',
  timestamp: '2026-05-03 07:00:00',
  rawTimestamp: 1714747200000,
  level: 'INFO',
  message: 'hi',
};

describe('NoopLogFileStore', () => {
  it('reports no capabilities', () => {
    const store = new NoopLogFileStore();
    expect(store.capabilities).toEqual({ share: false, reveal: false, available: false });
  });

  it('append/flush/truncate/readAll/reveal all resolve without throwing', async () => {
    const store = new NoopLogFileStore();
    await store.initialize();
    store.append(sampleEntry);
    await store.flush();
    await store.truncate();
    await store.revealLocation();
    expect(await store.readAll()).toEqual([]);
    expect(await store.getDisplayPath()).toBeNull();
    expect(await store.getFileUri()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run noop
```

Expected: FAIL with "Cannot find module '../noop'".

- [ ] **Step 3: Implement NoopLogFileStore**

```ts
// app/src/lib/log-file/noop.ts
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
```

- [ ] **Step 4: Run, verify it passes**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run noop
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```
git add app/src/lib/log-file/noop.ts app/src/lib/log-file/__tests__/noop.test.ts
git commit -m "feat(logs): add no-op log file store for web

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Platform selector and singleton

**Files:**
- Create: `app/src/lib/log-file/index.ts`
- Create: `app/src/lib/log-file/__tests__/index.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// app/src/lib/log-file/__tests__/index.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  // Default test env: no __TAURI_INTERNALS__, Capacitor mock returns isNativePlatform=false
  // (Web → Noop)
});

describe('log-file selector', () => {
  it('returns NoopLogFileStore on web', async () => {
    const { getLogFile } = await import('../index');
    const { NoopLogFileStore } = await import('../noop');
    const store = getLogFile();
    expect(store).toBeInstanceOf(NoopLogFileStore);
  });

  it('returns the same singleton on repeat calls', async () => {
    const { getLogFile } = await import('../index');
    expect(getLogFile()).toBe(getLogFile());
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run log-file/__tests__/index
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement selector**

```ts
// app/src/lib/log-file/index.ts
import { Capacitor } from '@capacitor/core';
import { useLogStore } from '../../stores/logs';
import { NoopLogFileStore } from './noop';
import type { LogFileStore } from './types';

let instance: LogFileStore | null = null;

function detect(): LogFileStore {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    // Lazy import keeps Tauri APIs out of non-Tauri bundles
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TauriLogFileStore } = require('./tauri');
    return new TauriLogFileStore();
  }
  if (Capacitor.isNativePlatform()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CapacitorLogFileStore } = require('./capacitor');
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
  useLogStore.setState({ logs: entries });
}

export type { LogFileStore } from './types';
```

Note: `require()` is used inside `detect()` because Tauri/Capacitor impls touch platform-specific APIs that should not be evaluated on platforms where they're absent. Vite supports `require` at runtime for ESM with the appropriate config; if your codebase uses dynamic `import()` with await everywhere, mirror that. The existing codebase uses `await import(...)` for Capacitor plugin guards (see logger/HTTP modules), so prefer a small async helper:

Actually, since `getLogFile()` is sync, and we want the singleton sync, refactor to do the detection synchronously by *importing eagerly* but only reading from those imports inside the impl class methods. The constructor can remain a no-op until `initialize()`. Use **static imports** at the top of `index.ts` and rely on tree-shaking / dynamic-imports inside the impl methods. Update accordingly:

```ts
// app/src/lib/log-file/index.ts (final version)
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

export function __resetLogFileForTests(replacement?: LogFileStore): void {
  instance = replacement ?? null;
}

export async function initializeLogFile(): Promise<void> {
  await getLogFile().initialize();
}

export async function hydrateLogStoreFromFile(): Promise<void> {
  const entries = await getLogFile().readAll();
  if (entries.length === 0) return;
  useLogStore.setState({ logs: entries });
}

export type { LogFileStore } from './types';
```

This works because the platform-specific impls do all their plugin imports *inside their methods* (dynamic imports per AGENTS.md rule 14), so importing the class itself at the top of `index.ts` is cheap and side-effect-free.

- [ ] **Step 4: Run, verify it passes**

Note: this test depends on `CapacitorLogFileStore` and `TauriLogFileStore` modules existing. They are stub-created in Tasks 5 and 8. To unblock this task, create empty stub files now:

```ts
// app/src/lib/log-file/capacitor.ts (stub for now, real impl in Task 5)
import type { LogFileStore, LogFileCapabilities } from './types';
import { NoopLogFileStore } from './noop';
export class CapacitorLogFileStore extends NoopLogFileStore implements LogFileStore {}
```

```ts
// app/src/lib/log-file/tauri.ts (stub for now, real impl in Task 8)
import type { LogFileStore, LogFileCapabilities } from './types';
import { NoopLogFileStore } from './noop';
export class TauriLogFileStore extends NoopLogFileStore implements LogFileStore {}
```

(The unused `LogFileCapabilities` import will be removed when Task 5 / Task 8 land their real impls.)

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run log-file
```

Expected: noop tests + selector tests PASS.

- [ ] **Step 5: Commit**

```
git add app/src/lib/log-file
git commit -m "feat(logs): add platform selector and singleton

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add Capacitor Filesystem and Share mocks to test setup

**Files:**
- Modify: `app/src/tests/setup.ts`

- [ ] **Step 1: Add mocks**

Find the existing block of `vi.mock('@capacitor/...')` calls (around line 104). Append:

```ts
// Mock Capacitor Filesystem
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    appendFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue({ data: '' }),
    writeFile: vi.fn().mockResolvedValue({ uri: 'file:///mock/zmninja-ng.log' }),
    getUri: vi.fn().mockResolvedValue({ uri: 'file:///mock/zmninja-ng.log' }),
    stat: vi.fn().mockResolvedValue({ size: 0, type: 'file', mtime: 0, uri: 'file:///mock/zmninja-ng.log' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  Directory: {
    Data: 'DATA',
    Cache: 'CACHE',
    Documents: 'DOCUMENTS',
  },
  Encoding: {
    UTF8: 'utf8',
    ASCII: 'ascii',
    UTF16: 'utf16',
  },
}));

// Mock Capacitor Share
vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn().mockResolvedValue({ activityType: 'mock' }),
    canShare: vi.fn().mockResolvedValue({ value: true }),
  },
}));
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run
```

Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```
git add app/src/tests/setup.ts
git commit -m "test: add Capacitor Filesystem and Share mocks

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Implement `CapacitorLogFileStore`

**Files:**
- Modify: `app/src/lib/log-file/capacitor.ts` (replace stub from Task 3)
- Create: `app/src/lib/log-file/__tests__/capacitor.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/log-file/__tests__/capacitor.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { CapacitorLogFileStore } from '../capacitor';
import type { LogEntry } from '../../../stores/logs';
import { LOG_FILE_FLUSH_INTERVAL_MS, LOG_FILE_MAX_ENTRIES, LOG_FILE_TRUNCATE_RETAIN } from '../types';

const entry = (id: string, message = 'hi'): LogEntry => ({
  id,
  timestamp: '2026-05-03 07:00:00',
  rawTimestamp: 1714747200000,
  level: 'INFO',
  message,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CapacitorLogFileStore', () => {
  it('declares share capability and availability', () => {
    const store = new CapacitorLogFileStore();
    expect(store.capabilities).toEqual({ share: true, reveal: false, available: true });
  });

  it('append + flush writes NDJSON via appendFile', async () => {
    const store = new CapacitorLogFileStore();
    await store.initialize();
    store.append(entry('1', 'first'));
    store.append(entry('2', 'second'));
    await store.flush();

    expect(Filesystem.appendFile).toHaveBeenCalledTimes(1);
    const call = (Filesystem.appendFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lines = call.data.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(lines).toEqual([
      expect.objectContaining({ id: '1', message: 'first' }),
      expect.objectContaining({ id: '2', message: 'second' }),
    ]);
  });

  it('throttled flush fires after LOG_FILE_FLUSH_INTERVAL_MS', async () => {
    const store = new CapacitorLogFileStore();
    await store.initialize();
    store.append(entry('1'));
    expect(Filesystem.appendFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LOG_FILE_FLUSH_INTERVAL_MS);
    expect(Filesystem.appendFile).toHaveBeenCalledTimes(1);
  });

  it('readAll parses NDJSON and skips malformed lines', async () => {
    (Filesystem.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        JSON.stringify(entry('1', 'a')),
        '{ broken json',
        JSON.stringify(entry('2', 'b')),
        '',
      ].join('\n'),
    });
    const store = new CapacitorLogFileStore();
    const got = await store.readAll();
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ id: '1', message: 'a' });
    expect(got[1]).toMatchObject({ id: '2', message: 'b' });
  });

  it('truncate writes empty file', async () => {
    const store = new CapacitorLogFileStore();
    await store.truncate();
    expect(Filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: '' }),
    );
  });

  it('getFileUri returns the URI from Filesystem.getUri', async () => {
    const store = new CapacitorLogFileStore();
    const uri = await store.getFileUri();
    expect(uri).toBe('file:///mock/zmninja-ng.log');
  });

  it('rotates when entry count exceeds cap', async () => {
    // Seed file with MAX entries
    const seeded = Array.from({ length: LOG_FILE_MAX_ENTRIES }, (_, i) => JSON.stringify(entry(String(i)))).join('\n');
    (Filesystem.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: seeded });

    const store = new CapacitorLogFileStore();
    await store.initialize(); // counts existing entries

    // Trigger overflow
    store.append(entry('overflow'));
    await store.flush();

    // Expect a rewrite — writeFile called with last LOG_FILE_TRUNCATE_RETAIN entries
    const writeFileCall = (Filesystem.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      typeof c[0].data === 'string' && c[0].data.split('\n').filter(Boolean).length === LOG_FILE_TRUNCATE_RETAIN,
    );
    expect(writeFileCall).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify failures**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run capacitor.test
```

Expected: 7 tests FAIL (stub from Task 3 has wrong capabilities, no real impl).

- [ ] **Step 3: Implement CapacitorLogFileStore**

```ts
// app/src/lib/log-file/capacitor.ts
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
    // Count existing entries so we know when to rotate
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
```

- [ ] **Step 4: Run, verify pass**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run capacitor.test
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```
git add app/src/lib/log-file/capacitor.ts app/src/lib/log-file/__tests__/capacitor.test.ts
git commit -m "feat(logs): implement CapacitorLogFileStore with rotation

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Add `tauri-plugin-opener` and register

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/capabilities/default.json`
- Modify: `app/package.json`

- [ ] **Step 1: Add Rust dependency**

In `app/src-tauri/Cargo.toml`, in the `[dependencies]` block (just below `tauri-plugin-fs`):

```toml
tauri-plugin-opener = "2.5.0"
```

Per AGENTS.md rule 16, the JS counterpart must match.

- [ ] **Step 2: Add JS dependency**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm install @tauri-apps/plugin-opener@^2.5.0
```

Expected: package.json gains `"@tauri-apps/plugin-opener": "^2.5.0"`. The version needs to match the Rust crate major.minor; verify with `npm info @tauri-apps/plugin-opener version` if 2.5.0 is unavailable, pick the latest 2.x and use the same on the Rust side.

- [ ] **Step 3: Register the plugin in `lib.rs`**

In `app/src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_opener::init())` to the builder chain:

```rust
mod biometric;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .max_file_size(10 * 1024 * 1024)
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      biometric::check_biometric_available,
      biometric::authenticate_biometric,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- [ ] **Step 4: Grant capability**

In `app/src-tauri/capabilities/default.json`, add `"opener:default"` and a narrow `fs` permission for the AppLog directory. Insert into the `permissions` array (preserving existing entries):

```json
"opener:default",
{
  "identifier": "fs:allow-write-file",
  "allow": [
    { "path": "$DOWNLOADS/**" },
    { "path": "$DOCUMENTS/**" },
    { "path": "$DESKTOP/**" },
    { "path": "$PICTURES/**" },
    { "path": "$MOVIES/**" },
    { "path": "$APPLOG/**" }
  ]
},
{
  "identifier": "fs:allow-read-text-file",
  "allow": [{ "path": "$APPLOG/**" }]
},
{
  "identifier": "fs:allow-mkdir",
  "allow": [{ "path": "$APPLOG/**" }]
}
```

(Replace the existing `fs:allow-write-file` block with the version above — the only change is adding `$APPLOG/**`.)

- [ ] **Step 5: Verify Tauri build still works**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm run build
```

Expected: TypeScript compilation completed; Vite build succeeds (the build does not invoke `cargo`, but the TS imports of `@tauri-apps/plugin-opener` must resolve). Cargo will be exercised in a later manual `tauri:dev` step.

- [ ] **Step 6: Commit**

```
git add app/src-tauri/Cargo.toml app/src-tauri/src/lib.rs app/src-tauri/capabilities/default.json app/package.json app/package-lock.json
git commit -m "feat(tauri): add tauri-plugin-opener and AppLog fs permissions

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Add Tauri plugin mocks to test setup

**Files:**
- Modify: `app/src/tests/setup.ts`

- [ ] **Step 1: Add mocks**

Append these blocks to `app/src/tests/setup.ts` (alongside the existing Capacitor mocks):

```ts
// Mock Tauri plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  exists: vi.fn().mockResolvedValue(true),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: {
    AppLog: 'AppLog',
    AppData: 'AppData',
    AppCache: 'AppCache',
    AppConfig: 'AppConfig',
    Download: 'Download',
    Document: 'Document',
    Desktop: 'Desktop',
    Picture: 'Picture',
    Video: 'Video',
  },
}));

// Mock Tauri plugin-opener
vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

// Mock Tauri path APIs (used to resolve display path)
vi.mock('@tauri-apps/api/path', () => ({
  appLogDir: vi.fn().mockResolvedValue('/mock/applogdir'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run
```

Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```
git add app/src/tests/setup.ts
git commit -m "test: add Tauri plugin-fs, plugin-opener, and path mocks

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Implement `TauriLogFileStore`

**Files:**
- Modify: `app/src/lib/log-file/tauri.ts` (replace stub from Task 3)
- Create: `app/src/lib/log-file/__tests__/tauri.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/src/lib/log-file/__tests__/tauri.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from '@tauri-apps/plugin-fs';
import * as opener from '@tauri-apps/plugin-opener';
import { appLogDir } from '@tauri-apps/api/path';
import { TauriLogFileStore } from '../tauri';
import type { LogEntry } from '../../../stores/logs';
import { LOG_FILE_NAME } from '../types';

const entry = (id: string, message = 'hi'): LogEntry => ({
  id,
  timestamp: '2026-05-03 07:00:00',
  rawTimestamp: 1714747200000,
  level: 'INFO',
  message,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (appLogDir as ReturnType<typeof vi.fn>).mockResolvedValue('/mock/applogdir');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TauriLogFileStore', () => {
  it('declares reveal capability and availability', () => {
    const store = new TauriLogFileStore();
    expect(store.capabilities).toEqual({ share: false, reveal: true, available: true });
  });

  it('initialize creates AppLog directory', async () => {
    const store = new TauriLogFileStore();
    await store.initialize();
    expect(fs.mkdir).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ baseDir: 'AppLog', recursive: true }),
    );
  });

  it('append + flush writes NDJSON via writeTextFile with append flag', async () => {
    const store = new TauriLogFileStore();
    await store.initialize();
    store.append(entry('1', 'a'));
    store.append(entry('2', 'b'));
    await store.flush();

    expect(fs.writeTextFile).toHaveBeenCalledTimes(1);
    const [path, data, opts] = (fs.writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe(LOG_FILE_NAME);
    expect(opts).toMatchObject({ append: true, baseDir: 'AppLog' });
    const lines = (data as string).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2' }),
    ]);
  });

  it('readAll parses NDJSON and skips malformed lines', async () => {
    (fs.readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      [JSON.stringify(entry('1')), '{ broken', JSON.stringify(entry('2'))].join('\n'),
    );
    const store = new TauriLogFileStore();
    const got = await store.readAll();
    expect(got.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('truncate writes empty file (no append)', async () => {
    const store = new TauriLogFileStore();
    await store.truncate();
    const calls = (fs.writeTextFile as ReturnType<typeof vi.fn>).mock.calls;
    const truncating = calls.find((c) => c[1] === '' && (c[2] as { append?: boolean })?.append !== true);
    expect(truncating).toBeDefined();
  });

  it('getDisplayPath returns appLogDir + filename', async () => {
    const store = new TauriLogFileStore();
    const p = await store.getDisplayPath();
    expect(p).toBe(`/mock/applogdir/${LOG_FILE_NAME}`);
  });

  it('revealLocation calls revealItemInDir with the file path', async () => {
    const store = new TauriLogFileStore();
    await store.revealLocation();
    expect(opener.revealItemInDir).toHaveBeenCalledWith(`/mock/applogdir/${LOG_FILE_NAME}`);
  });
});
```

- [ ] **Step 2: Run, verify failures**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run tauri.test
```

Expected: 7 tests FAIL.

- [ ] **Step 3: Implement TauriLogFileStore**

```ts
// app/src/lib/log-file/tauri.ts
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
          // skip
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
```

- [ ] **Step 4: Run, verify pass**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run tauri.test
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```
git add app/src/lib/log-file/tauri.ts app/src/lib/log-file/__tests__/tauri.test.ts
git commit -m "feat(logs): implement TauriLogFileStore with reveal-in-dir

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Hook `LogFile.append()` into the Logger

**Files:**
- Modify: `app/src/lib/logger.ts:122-130` (just after `useLogStore.getState().addLog`)
- Modify: `app/src/lib/__tests__/` (add or extend a logger test)

- [ ] **Step 1: Write failing test**

Create `app/src/lib/__tests__/logger-persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger, log, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { __resetLogFileForTests } from '../log-file';
import type { LogFileStore } from '../log-file';

function makeFakeStore(): LogFileStore & { appended: unknown[] } {
  const appended: unknown[] = [];
  return {
    appended,
    capabilities: { share: false, reveal: false, available: true },
    initialize: vi.fn().mockResolvedValue(undefined),
    append: vi.fn((entry) => { appended.push(entry); }),
    flush: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    truncate: vi.fn().mockResolvedValue(undefined),
    getDisplayPath: vi.fn().mockResolvedValue('/mock/file.log'),
    getFileUri: vi.fn().mockResolvedValue(null),
    revealLocation: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  __resetLogFileForTests();
});

describe('logger -> log file persistence', () => {
  it('passes filtered entries to LogFileStore.append', () => {
    const fake = makeFakeStore();
    __resetLogFileForTests(fake);
    log.app('hello', LogLevel.INFO);
    expect(fake.appended.length).toBe(1);
    expect(fake.appended[0]).toMatchObject({
      level: 'INFO',
      message: 'hello',
      context: expect.objectContaining({ component: 'App' }),
    });
  });

  it('does NOT pass below-level entries to LogFileStore', () => {
    const fake = makeFakeStore();
    __resetLogFileForTests(fake);
    logger.setLevel(LogLevel.WARN);
    log.app('debug noise', LogLevel.DEBUG);
    expect(fake.appended.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify failures**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run logger-persistence
```

Expected: 2 tests FAIL (logger doesn't call file yet).

- [ ] **Step 3: Modify `lib/logger.ts:122-130`**

Add the file-store call right after `useLogStore.getState().addLog(...)` in `formatMessage`:

```ts
// app/src/lib/logger.ts (within formatMessage, replacing the existing addLog block)
import { getLogFile } from './log-file';
// ^ add this import at the top of the file (with other imports)

// ... within formatMessage, after console.log(...consoleArgs):

// Add to in-memory store (rawTimestamp for display-time formatting)
const entry = {
  id: crypto.randomUUID(),
  timestamp,
  rawTimestamp: Date.now(),
  level,
  message: sanitizedMessage,
  context: sanitizedContext,
  args: sanitizedArgs.length > 0 ? sanitizedArgs : undefined,
};
useLogStore.getState().addLog(entry);
getLogFile().append(entry);
```

Note: this changes how `addLog` is called — we now construct the full `LogEntry` (including `id`) here so the same object is passed to both store and file. Update `useLogStore.addLog` accordingly so it accepts a full `LogEntry` and trusts the caller's `id`. Modify `app/src/stores/logs.ts`:

```ts
// app/src/stores/logs.ts
addLog: (entry: LogEntry) =>
    set((state) => {
        const newLogs = [entry, ...state.logs].slice(0, LOGGING.maxLogEntries);
        return { logs: newLogs };
    }),
```

(Remove the `Omit<LogEntry, 'id'>` parameter and the internal `crypto.randomUUID` call. Update the interface above the implementation accordingly.)

- [ ] **Step 4: Run all tests; fix any callers that pass `Omit<...>` to addLog**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run
```

If any test fails because it constructs a partial entry without `id`, update those tests to include `id: crypto.randomUUID()`.

Expected: all tests pass, including `logger-persistence`.

- [ ] **Step 5: Type-check + build**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npx tsc --noEmit && npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```
git add app/src/lib/logger.ts app/src/stores/logs.ts app/src/lib/__tests__/logger-persistence.test.ts
git commit -m "feat(logs): persist log entries to file via LogFileStore

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Bootstrap initialization and hydration

**Files:**
- Modify: `app/src/App.tsx` (or wherever app-level init runs)
- Create: `app/src/lib/__tests__/log-file-bootstrap.test.ts`

- [ ] **Step 1: Find the bootstrap point**

```
grep -n "bootstrap\|profile-bootstrap\|initialize" /Users/arjun/fiddle/zmNinjaNg/app/src/App.tsx
```

Expected output should reveal where profile bootstrap is wired (e.g. a `useEffect` in `App.tsx`). If profile bootstrap runs `useEffect(() => { /* boot */ }, [])` at the top level, that's where to add `await initializeLogFile(); await hydrateLogStoreFromFile();` *before* anything that might log.

- [ ] **Step 2: Write hydration test**

```ts
// app/src/lib/__tests__/log-file-bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLogStore } from '../../stores/logs';
import { hydrateLogStoreFromFile, __resetLogFileForTests } from '../log-file';

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  __resetLogFileForTests();
});

describe('hydrateLogStoreFromFile', () => {
  it('replaces useLogStore.logs with file content', async () => {
    const fake = {
      capabilities: { share: false, reveal: false, available: true },
      initialize: vi.fn().mockResolvedValue(undefined),
      append: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      readAll: vi.fn().mockResolvedValue([
        { id: '1', timestamp: 't1', level: 'INFO', message: 'a' },
        { id: '2', timestamp: 't2', level: 'WARN', message: 'b' },
      ]),
      truncate: vi.fn().mockResolvedValue(undefined),
      getDisplayPath: vi.fn().mockResolvedValue(null),
      getFileUri: vi.fn().mockResolvedValue(null),
      revealLocation: vi.fn().mockResolvedValue(undefined),
    };
    __resetLogFileForTests(fake as never);

    await hydrateLogStoreFromFile();
    const logs = useLogStore.getState().logs;
    expect(logs.map((l) => l.id)).toEqual(['1', '2']);
  });

  it('leaves the store untouched when file is empty', async () => {
    const fake = {
      capabilities: { share: false, reveal: false, available: false },
      initialize: vi.fn().mockResolvedValue(undefined),
      append: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      readAll: vi.fn().mockResolvedValue([]),
      truncate: vi.fn().mockResolvedValue(undefined),
      getDisplayPath: vi.fn().mockResolvedValue(null),
      getFileUri: vi.fn().mockResolvedValue(null),
      revealLocation: vi.fn().mockResolvedValue(undefined),
    };
    __resetLogFileForTests(fake as never);

    useLogStore.setState({
      logs: [{ id: 'x', timestamp: 't', level: 'INFO', message: 'pre-existing' }],
    });
    await hydrateLogStoreFromFile();
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useLogStore.getState().logs[0].id).toBe('x');
  });
});
```

Run: `cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run log-file-bootstrap`

Expected: PASS (hydrate already implemented in Task 3).

- [ ] **Step 3: Wire init + hydration into App bootstrap**

In `app/src/App.tsx`, add an early `useEffect` before any other initialization that may emit logs. Based on existing structure, it likely looks like:

```tsx
import { initializeLogFile, hydrateLogStoreFromFile } from './lib/log-file';

// inside App() component, near the top of the body:
useEffect(() => {
  let cancelled = false;
  (async () => {
    await initializeLogFile();
    if (cancelled) return;
    await hydrateLogStoreFromFile();
  })();
  return () => { cancelled = true; };
}, []);
```

If `App.tsx` already has a single bootstrap effect, prepend these two lines inside that effect rather than adding a new one. Verify the placement so this runs *before* `profile-bootstrap` to maximize the chance that bootstrap-time logs land in the file.

- [ ] **Step 4: Add lifecycle flush hooks**

In `App.tsx` (or a small new module imported once at startup), register flushes on `visibilitychange`, `beforeunload`, and Capacitor's `App.pause`:

```tsx
import { Capacitor } from '@capacitor/core';
import { getLogFile } from './lib/log-file';

useEffect(() => {
  const flush = () => { void getLogFile().flush(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', onVisibility);

  let pauseListener: { remove: () => void } | null = null;
  if (Capacitor.isNativePlatform()) {
    void (async () => {
      const { App } = await import('@capacitor/app');
      pauseListener = await App.addListener('pause', flush);
    })();
  }

  return () => {
    window.removeEventListener('beforeunload', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    pauseListener?.remove();
  };
}, []);
```

`@capacitor/app` is already installed (see existing imports in `app/src/lib/platform.ts`); no new dependency is needed. If TypeScript complains about `App.addListener` types, mirror the existing pattern from `useNotificationAutoConnect.ts` or wherever Capacitor `App` is already used.

- [ ] **Step 5: Type-check and run all tests**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npx tsc --noEmit && npm test -- --run
```

Expected: both pass.

- [ ] **Step 6: Commit**

```
git add app/src/App.tsx app/src/lib/__tests__/log-file-bootstrap.test.ts
git commit -m "feat(logs): initialize and hydrate log file at app start

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: i18n strings (en, de, es, fr, zh)

**Files:**
- Modify: `app/src/locales/en/translation.json`
- Modify: `app/src/locales/de/translation.json`
- Modify: `app/src/locales/es/translation.json`
- Modify: `app/src/locales/fr/translation.json`
- Modify: `app/src/locales/zh/translation.json`

- [ ] **Step 1: Add the new keys under the `logs` namespace in each file**

Per AGENTS.md rule 23, all are short labels (single-word where possible) so they fit on a 320 px screen.

**en:**
```json
"open_location": "Open Location",
"persisted_to": "Persisted to:",
"entries_count": "{{current}} of {{max}} entries",
"clear_confirm_title": "Clear logs?",
"clear_confirm_message": "This clears the in-memory buffer and the persisted log file.",
"clear_confirm_action": "Clear"
```

**de:**
```json
"open_location": "Öffnen",
"persisted_to": "Gespeichert in:",
"entries_count": "{{current}} von {{max}} Einträgen",
"clear_confirm_title": "Logs löschen?",
"clear_confirm_message": "Speicher und persistierte Datei werden geleert.",
"clear_confirm_action": "Löschen"
```

**es:**
```json
"open_location": "Abrir",
"persisted_to": "Guardado en:",
"entries_count": "{{current}} de {{max}} entradas",
"clear_confirm_title": "¿Borrar logs?",
"clear_confirm_message": "Borra el buffer y el archivo persistente.",
"clear_confirm_action": "Borrar"
```

**fr:**
```json
"open_location": "Ouvrir",
"persisted_to": "Enregistré dans :",
"entries_count": "{{current}} sur {{max}} entrées",
"clear_confirm_title": "Effacer les logs ?",
"clear_confirm_message": "Vide le tampon et le fichier persistant.",
"clear_confirm_action": "Effacer"
```

**zh:**
```json
"open_location": "打开位置",
"persisted_to": "保存于：",
"entries_count": "{{current}} / {{max}} 条",
"clear_confirm_title": "清除日志？",
"clear_confirm_message": "将清空内存缓存和持久化文件。",
"clear_confirm_action": "清除"
```

Insert each block alongside the existing `logs.share`, `logs.share_title`, etc. keys (search for `"share":` in the en file to find the section).

- [ ] **Step 2: Verify translation keys load**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npx tsc --noEmit
```

(JSON files don't type-check, but importing them shouldn't break.)

- [ ] **Step 3: Commit**

```
git add app/src/locales/en/translation.json app/src/locales/de/translation.json app/src/locales/es/translation.json app/src/locales/fr/translation.json app/src/locales/zh/translation.json
git commit -m "i18n(logs): add strings for persistent log file UI

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Update Logs page — Share / Open swap

**Files:**
- Modify: `app/src/pages/Logs.tsx`

- [ ] **Step 1: Replace the Share button block (around lines 410-422)**

Find the existing block:
```tsx
onClick={handleShareLogs}
... data-testid="logs-share-button"
<Share2 className="h-4 w-4 mr-2" />
{t('logs.share')}
```

Replace `handleShareLogs` and the button rendering with platform-aware logic:

```tsx
import { getLogFile } from '../lib/log-file';
import { FolderOpen, Share2 } from 'lucide-react';

// inside Logs component:
const logFile = getLogFile();
const showOpenLocation = logFile.capabilities.reveal;
const showShareFile = logFile.capabilities.share;

const handleShareLogs = async () => {
  if (showOpenLocation) {
    try {
      await logFile.revealLocation();
    } catch (err) {
      toast({ description: t('logs.share_failed') });
    }
    return;
  }
  if (showShareFile) {
    try {
      // Render NDJSON to plain text via existing exporter, write to cache, share file URI
      const entries = await logFile.readAll();
      const text = exportLogsAsText(entries.length > 0 ? entries : filteredLogs);
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const tempName = `zmninja-ng-${Date.now()}.log`;
      const wrote = await Filesystem.writeFile({
        path: tempName, directory: Directory.Cache, data: text, encoding: Encoding.UTF8,
      });
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: t('logs.share_title'),
        dialogTitle: t('logs.share_dialog_title'),
        files: [wrote.uri],
      });
    } catch (err) {
      toast({ description: t('logs.share_failed') });
    }
    return;
  }
  // Web fallback: existing blob download path
  const text = exportLogsAsText(filteredLogs);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zmninja-ng-${Date.now()}.log`;
  a.click();
  URL.revokeObjectURL(url);
};
```

In the JSX, swap the icon and label by capability:

```tsx
<Button onClick={handleShareLogs} data-testid="logs-share-button" variant="outline" size="sm">
  {showOpenLocation ? (
    <>
      <FolderOpen className="h-4 w-4 mr-2" />
      {t('logs.open_location')}
    </>
  ) : (
    <>
      <Share2 className="h-4 w-4 mr-2" />
      {t('logs.share')}
    </>
  )}
</Button>
```

- [ ] **Step 2: Run build + tsc**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npx tsc --noEmit && npm run build
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```
git add app/src/pages/Logs.tsx
git commit -m "feat(logs): swap Share for Open Location on Tauri, share file on mobile

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Update Logs page — Clear confirmation + truncate file

**Files:**
- Modify: `app/src/pages/Logs.tsx`

- [ ] **Step 1: Add AlertDialog and wire Clear**

Import the AlertDialog primitives:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
```

Replace the existing Clear button (around line 438 — `onClick={clearLogs}`) with:

```tsx
const [confirmClearOpen, setConfirmClearOpen] = useState(false);

const handleConfirmedClear = async () => {
  clearLogs();
  try {
    await getLogFile().truncate();
  } catch (err) {
    toast({ description: t('logs.share_failed') }); // re-use existing toast string
  }
  setConfirmClearOpen(false);
};

// In the action row:
<AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
  <AlertDialogTrigger asChild>
    <Button variant="outline" size="sm" data-testid="logs-clear-button">
      <Trash2 className="h-4 w-4 mr-2" />
      {t('logs.clear')}
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t('logs.clear_confirm_title')}</AlertDialogTitle>
      <AlertDialogDescription>{t('logs.clear_confirm_message')}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel data-testid="logs-clear-cancel">{t('common.cancel')}</AlertDialogCancel>
      <AlertDialogAction onClick={handleConfirmedClear} data-testid="logs-clear-confirm">
        {t('logs.clear_confirm_action')}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

(If `common.cancel` isn't already an i18n key, use whatever the codebase already has — search `t('common.` in Profiles.tsx to find the existing pattern.)

- [ ] **Step 2: Run all tests**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run
```

Expected: all pass.

- [ ] **Step 3: Commit**

```
git add app/src/pages/Logs.tsx
git commit -m "feat(logs): confirm-then-truncate Clear, wipes file too

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Logs page — Status line (path + entry count)

**Files:**
- Modify: `app/src/pages/Logs.tsx`

- [ ] **Step 1: Add the status line below the action row**

```tsx
const [persistedPath, setPersistedPath] = useState<string | null>(null);

useEffect(() => {
  if (!getLogFile().capabilities.available) return;
  void getLogFile().getDisplayPath().then(setPersistedPath);
}, []);

// JSX, hidden when no native filesystem:
{getLogFile().capabilities.available && persistedPath && (
  <div className="text-xs text-muted-foreground px-1 py-1 flex flex-col gap-0.5" data-testid="logs-status-line">
    <span className="truncate min-w-0" title={persistedPath}>
      {t('logs.persisted_to')} <span className="font-mono">{persistedPath}</span>
    </span>
    <span>
      {t('logs.entries_count', {
        current: logs.length.toLocaleString(),
        max: (10000).toLocaleString(),
      })}
    </span>
  </div>
)}
```

(`logs` is already destructured from `useLogStore` at the top of the component. The `10000` literal can be replaced with `LOG_FILE_MAX_ENTRIES` imported from `lib/log-file/types`.)

- [ ] **Step 2: Run tests + build**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run && npx tsc --noEmit && npm run build
```

Expected: all green.

- [ ] **Step 3: Commit**

```
git add app/src/pages/Logs.tsx
git commit -m "feat(logs): show persisted path and entry count on Logs page

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: E2E feature for web (auto-run)

**Files:**
- Create: `app/tests/features/logs-persistence.feature`
- Modify: `app/tests/steps/logs.steps.ts` (or create if absent)

- [ ] **Step 1: Check existing logs steps**

```
ls /Users/arjun/fiddle/zmNinjaNg/app/tests/steps/ | grep -i log
```

If a `logs.steps.ts` exists, extend it; otherwise create one.

- [ ] **Step 2: Write the feature**

```gherkin
# app/tests/features/logs-persistence.feature
@web
Feature: Persistent log file (web)
  On web, persistence is a no-op. The Logs page must still let the user
  generate logs, see the in-memory buffer, and confirm Clear.

  Scenario: Clear confirmation appears and clears in-memory buffer
    Given I am logged into zmNinjaNg
    When I navigate to the "Logs" page
    And I trigger a sample log entry via the "App" component
    Then the Logs page should show at least one entry
    When I tap the Clear button
    Then a Clear confirmation dialog should appear
    When I confirm Clear
    Then the Logs page should show no entries
```

- [ ] **Step 3: Add step definitions**

Create `app/tests/steps/logs.steps.ts` (matching the pattern in `app/tests/steps/dashboard.steps.ts`):

```ts
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { testConfig } from '../helpers/config';

const { When, Then } = createBdd();

When('I trigger a sample log entry via the {string} component', async ({ page }, componentName: string) => {
  // Inject a log call into the running app via the exposed logger global.
  // The Logger is imported as a side effect on app load; we reach it via window.
  await page.evaluate((name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__zmng_test_log) w.__zmng_test_log(name);
    else console.log(`[test] ${name} sample entry`);
  }, componentName);
});

When('I tap the Clear button', async ({ page }) => {
  const btn = page.getByTestId('logs-clear-button');
  await expect(btn).toBeVisible({ timeout: testConfig.timeouts.element });
  await btn.click();
});

Then('a Clear confirmation dialog should appear', async ({ page }) => {
  const cancel = page.getByTestId('logs-clear-cancel');
  await expect(cancel).toBeVisible({ timeout: testConfig.timeouts.element });
});

When('I confirm Clear', async ({ page }) => {
  const confirm = page.getByTestId('logs-clear-confirm');
  await expect(confirm).toBeVisible({ timeout: testConfig.timeouts.element });
  await confirm.click();
});

Then('the Logs page should show no entries', async ({ page }) => {
  // Empty-state message has data-testid="logs-empty-state" or the entries list is empty.
  const empty = page.getByTestId('logs-empty-state');
  const list = page.getByTestId('logs-list');
  // One of them must be true
  const emptyVisible = await empty.isVisible().catch(() => false);
  if (emptyVisible) return;
  const count = await list.locator('[data-testid="log-entry"]').count();
  expect(count).toBe(0);
});

Then('the Logs page should show at least one entry', async ({ page }) => {
  const list = page.getByTestId('logs-list');
  await expect(list.locator('[data-testid="log-entry"]').first()).toBeVisible({ timeout: testConfig.timeouts.element });
});
```

If `data-testid="logs-empty-state"`, `data-testid="logs-list"`, or `data-testid="log-entry"` are absent in `Logs.tsx`, add them as part of this task (per AGENTS.md rule 13: every interactive element gets a `data-testid`). The "navigate to Logs page" and "I am logged in" steps are already shared in `app/tests/steps/common.steps.ts`.

The `__zmng_test_log` global is opt-in. To expose it, add to `app/src/lib/logger.ts` (gated behind `import.meta.env.DEV`):

```ts
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__zmng_test_log = (component: string) => {
    log.app(`test sample from ${component}`, LogLevel.INFO);
  };
}
```

If exposing a window-level test hook is undesirable, the alternative is to drive a real navigation that emits a log on mount (e.g., open the Monitors page and back) in the step definition.

- [ ] **Step 4: Run the e2e**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm run test:e2e -- logs-persistence.feature
```

Expected: scenario passes.

- [ ] **Step 5: Commit**

```
git add app/tests/features/logs-persistence.feature app/tests/steps/logs.steps.ts
git commit -m "test(logs): e2e feature for clear confirmation on web

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Native specs (manual-only)

**Files:**
- Create: `app/tests/native/specs/logs-persistence.spec.ts`

- [ ] **Step 1: Write the native spec**

Mirror an existing native spec file (e.g. `app/tests/native/specs/pip.spec.ts`) for shape. Outline:

- iOS / Android scenarios:
  - Generate logs by navigating
  - Restart app via Appium `driver.terminateApp` + `activateApp`
  - Verify the Logs page shows entries from the prior session (hydration)
  - Tap Share → verify a `.log` file URI is delivered (assert via Appium accessibility on the share sheet)
  - Tap Clear → confirm → reopen the page → verify zero entries

- Tauri scenario:
  - Generate logs, click Open Location → verify Finder/Explorer opens (assert via tauri-driver)
  - Tap Clear → confirm → verify file is 0 bytes by reading from disk via Node `fs`

This spec is manual-invoke only (`npm run test:e2e:android`, `:ios-phone`, `:tauri`) per the user's preference (memory: device e2e is manual-only).

- [ ] **Step 2: Commit**

```
git add app/tests/native/specs/logs-persistence.spec.ts
git commit -m "test(logs): native spec for hydration, share, reveal, clear

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Documentation

**Files:**
- Modify: `docs/developer-guide/12-shared-services-and-components.rst` (add `lib/log-file/` module)
- Modify: `docs/user-guide/settings.md` (note about logs file)
- Modify: `docs/developer-guide/05-component-architecture.rst` (note Logger now persists to disk)

- [ ] **Step 1: Developer-guide module entry**

Append a new section to `docs/developer-guide/12-shared-services-and-components.rst`:

```rst
log-file (``lib/log-file/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Mirrors entries from ``useLogStore`` to a persistent file on disk.

**Capabilities by platform:**

- Capacitor (iOS / Android): NDJSON file at ``Directory.Data/zmninja-ng.log``. Share via system share sheet (file URI).
- Tauri (desktop): NDJSON file at ``BaseDirectory::AppLog/zmninja-ng.log``. "Open Location" reveals it in Finder/Explorer.
- Web: no-op fallback; Share reverts to today's blob download.

**Format:** NDJSON, one ``LogEntry`` per line. ``Logger.formatMessage`` constructs the entry once and passes it to both ``useLogStore.addLog`` and ``LogFileStore.append``.

**Cap:** 10,000 entries. On overflow, the file is rewritten with the last 5,000 entries.

**Hydration:** On app start, ``hydrateLogStoreFromFile()`` reads the file and replaces ``useLogStore.logs`` so prior-session entries are visible in the Logs page.

**Used by:** ``lib/logger.ts``, ``pages/Logs.tsx``.
```

- [ ] **Step 2: User-guide note**

In `docs/user-guide/settings.md`, near the existing logs-related content (or as a new sub-section under a "Logs" heading), document:

```markdown
### Persistent Logs

Log entries that pass your filter settings are written to disk so they survive app restarts:

- **iOS / Android:** in the app's data directory. Use the **Share** button on the Logs page to send the `.log` file via system share sheet.
- **Desktop (Tauri):** at `~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log` (macOS) or the equivalent app-log directory on Windows/Linux. Use the **Open Location** button to reveal it in Finder/Explorer.
- **Web (browser, dev only):** no persistence; the Share button downloads a one-shot text file.

The file is capped at 10,000 entries; the oldest half is dropped automatically when the cap is hit. **Clear** zeros the file and the in-memory buffer.
```

- [ ] **Step 3: Component-architecture note**

In `docs/developer-guide/05-component-architecture.rst`, find the Logger section and append:

```rst
The Logger also passes each filtered entry to the platform ``LogFileStore`` (see :doc:`12-shared-services-and-components`) for on-disk persistence. The same sanitized ``LogEntry`` reaches the in-memory store, the file, and the browser console — there is no separate filter path.
```

- [ ] **Step 4: Commit**

```
git add docs/developer-guide/12-shared-services-and-components.rst docs/developer-guide/05-component-architecture.rst docs/user-guide/settings.md
git commit -m "docs(logs): document persistent log file module and UX

refs #139

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Final verification, manual checks, PR

**Files:** none (verification + branching only)

- [ ] **Step 1: Full test pass**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm test -- --run && npx tsc --noEmit && npm run build && npm run test:e2e -- logs-persistence.feature
```

Expected: all green. Note in your final commit which tests ran:
> Tests verified: npm test ✓, tsc --noEmit ✓, build ✓, test:e2e -- logs-persistence.feature ✓

- [ ] **Step 2: Manual Tauri check**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm run tauri:dev
```

In the launched app:
1. Use the app for a minute so logs accumulate.
2. Navigate to Logs — note entry count.
3. Quit and re-launch.
4. Verify Logs page shows the prior entries (hydration).
5. Click "Open Location" → Finder/Explorer should open with the .log file selected at `~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log` (macOS).
6. Click "Clear" → confirm → verify dialog dismisses, in-memory buffer empties, and the file is 0 bytes (`wc -c <path>`).

- [ ] **Step 3: Manual mobile checks (optional, recommended)**

```
cd /Users/arjun/fiddle/zmNinjaNg/app && npm run test:e2e:ios-phone
# and
npm run test:e2e:android
```

Verify the same hydration and Share-as-file flows pass.

- [ ] **Step 4: Push branch and open PR**

```
git push -u origin feature/persistent-log-file
gh pr create --title "feat(logs): persistent log file with share/open/clear" --body "$(cat <<'EOF'
## Summary
- Mirrors useLogStore to disk via a platform-agnostic LogFileStore
- Capacitor (mobile): NDJSON file in app data; Share sends file via system share sheet
- Tauri (desktop): NDJSON file at AppLog/zmninja-ng.log; Share replaced with Open Location (reveal in Finder/Explorer)
- Web: no-op fallback (today's blob download)
- Logs page hydrates from file on app start; Clear truncates file (with confirmation dialog)
- Cap: 10,000 entries; drop oldest 50% on overflow

fixes #139

## Test plan
- [x] npm test
- [x] npx tsc --noEmit
- [x] npm run build
- [x] npm run test:e2e -- logs-persistence.feature
- [ ] Manual: npm run tauri:dev — restart, verify hydration, click Open Location, Clear → confirm → file is 0 bytes
- [ ] Manual: npm run test:e2e:ios-phone — Share delivers .log file
- [ ] Manual: npm run test:e2e:android — Share delivers .log file

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: After user approval, merge**

Per AGENTS.md rule 19, wait for explicit user approval before merging. The user will say "merge" or similar.

```
git checkout main && git merge --ff-only feature/persistent-log-file && git branch -d feature/persistent-log-file
```

- [ ] **Step 6: Update final commit to use `fixes #139`**

(Already done in the PR body above; the merge commit / final PR closes the issue automatically.)

---

## Out of scope (do not implement)

- Server-side log shipping
- Configurable retention beyond 10K cap
- Encryption at rest (sanitizer already strips secrets)
- Log viewer search / filter changes unrelated to file source

## Spec coverage map

| Spec section | Implemented in |
|---|---|
| Goal / decisions 1–6 | Tasks 1–17 (collectively) |
| Architecture | Tasks 1, 2, 3 |
| NDJSON format on disk | Tasks 5, 8 |
| Plain text on share | Task 12 |
| 10K cap with rotate-50% | Tasks 5, 8 |
| Capacitor impl | Tasks 4, 5 |
| Tauri impl | Tasks 6, 7, 8 |
| Web no-op | Task 2 |
| Logger hook | Task 9 |
| Hydration | Task 10 |
| UI: Share/Open swap | Task 12 |
| UI: Clear confirmation + truncate | Task 13 |
| UI: Status line | Task 14 |
| i18n (5 langs) | Task 11 |
| Testing | Tasks 2, 5, 8, 9, 10, 15, 16 |
| Verification | Task 18 |
| Documentation | Task 17 |
