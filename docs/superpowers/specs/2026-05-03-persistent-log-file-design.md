# Persistent Log File — Design

**Status:** Draft for review
**Date:** 2026-05-03
**Issue:** [#139](https://github.com/pliablepixels/zmNinjaNg/issues/139)

## Goal

Mirror the in-memory log buffer (`useLogStore`) to a persistent file on disk, so users can share or open it for support and debugging. The file must:

- Contain the same entries that pass current settings filters and reach the web console / Logs view (level + per-component overrides).
- Persist across app sessions on mobile (Capacitor: iOS, Android) and desktop (Tauri: macOS, Windows, Linux).
- Be the source of truth for Share, Clear, and Open-Location actions on the Logs page.

Web (browser-only `npm run dev`) is not a deployment target. The feature is a no-op there.

## Decisions

Captured during brainstorming, in order:

1. **View ↔ file relationship.** The Logs page hydrates from the file at app start so prior-session entries are visible in the view. New entries append to both the in-memory store and the file.
2. **File format.** NDJSON on disk (one `LogEntry` per line). Plain text rendered on share, using the existing `exportLogsAsText` formatter.
3. **Cap.** 10,000 entries (10× the in-memory cap). On overflow, drop the oldest 50% by rewriting the file with the last 5,000 entries.
4. **Web platform.** No-op. The Logs page hides the file-status UI on web and falls back to today's blob-download share.
5. **Share format on mobile.** Share as file attachment, not as text body. Capacitor `Share.share({ files: [fileUri] })`.
6. **Tauri dev/release isolation.** None — both write to the same `AppLog` path because the bundle identifier is shared. Acceptable trade-off.

## Architecture

A platform-agnostic `LogFileStore` interface, three concrete impls picked at startup:

```
src/lib/log-file/
  index.ts        ← picks impl, exports singleton + initialize/hydrate helpers
  types.ts        ← LogFileStore interface
  capacitor.ts    ← Capacitor Filesystem (iOS / Android)
  tauri.ts        ← @tauri-apps/plugin-fs + @tauri-apps/plugin-opener
  noop.ts         ← Web fallback
  __tests__/...
```

Interface:

```ts
interface LogFileStore {
  initialize(): Promise<void>;
  append(entry: LogEntry): void;           // fire-and-forget, internally buffered
  flush(): Promise<void>;
  readAll(): Promise<LogEntry[]>;          // hydration on app start
  truncate(): Promise<void>;               // delete = zero file
  getDisplayPath(): Promise<string | null>;
  getFileUri(): Promise<string | null>;    // for Capacitor Share files: [...]
  revealLocation(): Promise<void>;         // Tauri only, no-op elsewhere
  capabilities: { share: boolean; reveal: boolean; available: boolean };
}
```

Selection logic (`index.ts`):

```ts
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return new TauriLogFileStore();
if (Capacitor.isNativePlatform()) return new CapacitorLogFileStore();
return new NoopLogFileStore();
```

Wiring:

- `lib/logger.ts` — after the level filter passes, call `getLogFile().append(entry)` alongside `useLogStore.addLog()`. Same chokepoint that already runs sanitization, so nothing unsanitized reaches disk.
- App bootstrap (near `profile-bootstrap`) — call `await initializeLogFile(); await hydrateLogStoreFromFile();`.
- `pages/Logs.tsx` — Share / Clear / Open-Location route through the singleton.

## Data flow

### On disk

NDJSON, one entry per line:

```json
{"id":"<uuid>","tsMs":1714747200123,"level":"INFO","component":"monitor","message":"Stream connected","context":{"monitorId":"4"},"args":[]}
```

Field shape matches `LogEntry` in `stores/logs.ts:4-13` so hydration is `JSON.parse` per line.

### On append (live)

`Logger.log()` → if level passes → `useLogStore.addLog(entry)` AND `LogFile.append(entry)`.

`LogFile.append`:
1. Push entry into an in-memory write buffer.
2. Throttle flush to at most once per 1000 ms (a `setTimeout` is scheduled on the first append; subsequent appends within the window do not re-arm the timer, so the buffer drains every 1000 ms under continuous load rather than indefinitely deferring).
3. Also flush on `document.visibilitychange === 'hidden'`, `beforeunload`, and Capacitor's `App.pause` event.

Flush:
1. Drain buffer to a string of NDJSON lines.
2. Append to file via platform plugin.
3. Increment in-memory `entryCount`. If `entryCount > 10000`, schedule an asynchronous truncation pass.

### On overflow (rare)

Truncation:
1. `readAll()` parses the whole file.
2. `slice(-5000)` keeps the most recent 5,000 entries.
3. Rewrite the file with those entries.
4. Reset `entryCount`.

This is rare (only when crossing the 10K boundary). The cost (~1 file rewrite) is acceptable.

### On hydration (app start)

`LogFileStore.readAll()` → split on `\n` → `JSON.parse` per non-empty line. Lines that fail to parse (corrupted from a crash) are skipped silently. Resulting `LogEntry[]` is passed to `useLogStore.setState({ logs: entries })` as a one-shot replacement, bypassing `addLog` so we don't re-write the file.

### On share (Capacitor only)

1. `LogFile.readAll()` → `LogEntry[]`.
2. Pass through `exportLogsAsText(entries)` from `Logs.tsx:226` (existing format).
3. Write rendered text to a temp file (`zmninja-ng-<timestamp>.log`) in `Directory.Cache`.
4. `Share.share({ files: [tempFileUri] })`.

The OS cleans the cache directory naturally; we don't need to delete the temp file ourselves.

### On open-location (Tauri only)

`tauri-plugin-opener` `revealItemInDir(filePath)` opens Finder/Explorer/file-manager with the .log file selected.

### On truncate (delete)

1. Clear in-memory write buffer.
2. Write empty string to file.
3. The Logs page also calls `useLogStore.clearLogs()` simultaneously, so view + file go to zero together.

### Filtering

Already happens upstream in `Logger`. By the time `LogFile.append` is called, the entry has passed the global level filter and any per-component overrides. Nothing extra to do here.

## Cross-platform implementation

### Capacitor (iOS / Android)

- File: `Directory.Data` / `zmninja-ng.log`.
- Append: `Filesystem.appendFile({ path, data, directory: Directory.Data, encoding: Encoding.UTF8 })`.
- Read: `Filesystem.readFile(...)` → split on `\n`.
- Truncate: `Filesystem.writeFile({ ..., data: '' })`.
- Share URI: `Filesystem.getUri({ directory, path })` returns a `file://` (iOS) or `content://` (Android) URI usable by `@capacitor/share`.
- Reveal: not supported (no-op).
- All imports dynamic per AGENTS.md rule 14 (`Capacitor.isNativePlatform()` guard, `await import('@capacitor/filesystem')`).

### Tauri (macOS / Windows / Linux)

- File: `BaseDirectory::AppLog` / `zmninja-ng.log`. On macOS this populates `~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log`. Windows: `%LOCALAPPDATA%\com.zoneminder.zmNinjaNG\logs\`. Linux: `~/.local/share/com.zoneminder.zmNinjaNG/logs/`.
- Append / read / truncate: `@tauri-apps/plugin-fs` (`writeTextFile` with `append: true`, `readTextFile`).
- Reveal: new dependency `tauri-plugin-opener` (Rust + JS, both v2 — kept in sync per AGENTS.md rule 16). On click → `revealItemInDir(filePath)`.
- Share: not exposed on Tauri (no system share sheet). The Logs page swaps the button: on Tauri, "Share" becomes "Open Location".

### Web (browser, dev only)

- All methods resolve to no-ops or empty arrays.
- `capabilities = { share: false, reveal: false, available: false }`.
- `Logs.tsx` checks `capabilities.available` — if false, hides the file-status UI and falls back to today's blob-download share.

### Plugin / dependency changes

- `app/src-tauri/Cargo.toml`: add `tauri-plugin-opener = "2.x"`.
- `app/package.json`: add `@tauri-apps/plugin-opener` matching version.
- `app/src-tauri/src/lib.rs`: register `tauri_plugin_opener::init()`.
- `app/src-tauri/capabilities/default.json`: grant `opener:default` (or the narrower `opener:allow-reveal-item-in-dir`).
- `app/src/tests/setup.ts`: mock `@capacitor/filesystem`, `@capacitor/share`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-opener` per AGENTS.md rule 14.

## UI changes (Logs page)

### Buttons

| Button | Mobile (Capacitor) | Desktop (Tauri) | Web (no-op) |
|---|---|---|---|
| **Share** | Share `.log` file via system share sheet (text-rendered from NDJSON) | **Replaced** with "Open Location" (reveal in Finder/Explorer) | Today's blob download |
| **Clear** | Clears in-memory store + truncates file (with confirmation) | Same | Clears in-memory store only (with confirmation) |
| **Download** | Unchanged | Unchanged | Unchanged |

Selection logic uses `LogFile.capabilities.reveal` (true on Tauri only) to swap label/icon between Share and Open Location.

### Status line

Below the action row, hidden when `capabilities.available === false`:

```
Persisted to: ~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log
4,237 of 10,000 entries
```

- Path from `LogFile.getDisplayPath()`.
- Counter from `useLogStore.logs.length`.

### Confirmation on Clear

Existing AlertDialog component prompts: *"Clear all logs from memory and disk?"* with Cancel / Clear. Required because Clear now wipes the file, not just the buffer — a misclick destroys debugging history.

### i18n strings to add (en / de / es / fr / zh) per AGENTS.md rule 5

- `logs.open_location`
- `logs.persisted_to`
- `logs.entries_count` (with `{current}/{max}` interpolation)
- `logs.clear_confirm_title`
- `logs.clear_confirm_message`
- `logs.clear_confirm_action`

Per AGENTS.md rule 23, all are short labels; single words where possible (ES "Abrir", DE "Öffnen", etc.).

## Error handling

All file I/O is best-effort. On error:

- Append-side errors: log to `console.warn` (NOT through the `Logger`, to avoid recursion). Drop the entry from the file. The in-memory store is unaffected.
- Read-side errors during hydration: skip bad lines silently. If the whole file is unreadable, log a warning to console and start fresh.
- Truncation errors: surface a toast in the Logs page so the user knows Clear didn't fully succeed.

The Logs view never crashes on file errors — it falls back to in-memory-only behavior.

## Testing

### Unit tests (`app/src/lib/log-file/__tests__/`)

- `noop.test.ts` — capabilities flags are false; all methods resolve without throwing.
- `capacitor.test.ts` — mock `@capacitor/filesystem` and `@capacitor/share`. Verify:
  - `append` buffers and flushes on timer / explicit `flush()`
  - `readAll` parses NDJSON and skips malformed lines
  - `truncate` calls `writeFile` with empty data
  - `getFileUri` returns the URI from `Filesystem.getUri`
  - On 10,001st entry, file is rewritten with last 5,000 entries
- `tauri.test.ts` — mock `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-opener`. Same matrix as Capacitor plus:
  - `revealLocation` calls `revealItemInDir` with the resolved path
- `index.test.ts` — platform selector returns the right impl based on environment shims (`window.__TAURI_INTERNALS__`, `Capacitor.isNativePlatform()`).

### Logger integration

- After `Logger.log()` passes the level filter, both `useLogStore.addLog` and `LogFile.append` are called with the same entry.
- Below-level entries call neither.

### Hydration

- Given a `LogFile` mock that returns 50 entries, `hydrateLogStoreFromFile()` populates `useLogStore.logs` with those 50 entries (replace, not append).
- Subsequent `addLog` calls append normally without re-writing hydrated entries.

### E2E (web profile, auto-run)

`app/tests/features/logs-persistence.feature` tagged `@web`:

- Generate logs → reload page → buffer is empty (web no-op behavior — correct).
- Clear button confirmation appears and clears the in-memory buffer.

### Native (manual-invoke per AGENTS.md memory)

`app/tests/native/specs/logs-persistence.spec.ts` tagged `@android @ios @tauri`. Runs only on `npm run test:e2e:android|ios-phone|tauri`:

- Generate logs → restart app → verify hydration.
- Tap Clear → confirm → verify file is 0 bytes.
- Tap Share (Capacitor) → verify a `.log` file URI is delivered.
- Click Open Location (Tauri) → verify `revealItemInDir` was invoked.

### Verification checklist before commit

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test:e2e -- logs-persistence.feature` (web profile)
- Manual on `npm run tauri:dev`: generate logs, restart, verify hydration, click Open Location, click Clear → confirm → verify file is 0 bytes
- Manual on `npm run test:e2e:ios-phone` and `:android`: same flow, plus Share button delivers a file

## Out of scope

- Server-side log shipping (e.g., POSTing logs to a remote collector).
- Configurable log retention beyond the 10K cap.
- Encryption at rest. Existing `log-sanitizer` removes secrets at write time, so the file should not contain credentials. If encryption becomes a requirement, it lands in a follow-up.
- Log viewer search / filter improvements unrelated to the file source.

## Open questions

None at design time. Will surface in implementation if discovered.
