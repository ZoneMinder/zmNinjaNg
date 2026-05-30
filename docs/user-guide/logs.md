# Logs

The Logs page (sidebar → **Logs**) shows entries emitted by the app for debugging and support. Entries are filtered by your global log level and any per-component overrides, and a copy is also written to a persistent file on disk so logs survive app restarts.

## Where the file lives

The file is named `zmninja-ng.log` and lives in the per-app log directory chosen by the OS:

| Platform | Path |
|----------|------|
| **macOS** (Electron) | `~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log` |
| **Windows** (Electron) | `%LOCALAPPDATA%\com.zoneminder.zmNinjaNG\logs\zmninja-ng.log` |
| **Linux** (Electron) | `~/.local/share/com.zoneminder.zmNinjaNG/logs/zmninja-ng.log` |
| **iOS** | App sandbox (`Application Support` directory). Not directly accessible via Files app, use **Share** to extract it. |
| **Android** | App-private data directory (`/data/data/com.zoneminder.zmNinjaNG/`). Not browsable without root, use **Share**. |
| **Web** (browser dev only) | No persistence. |

## Buttons on the Logs page

- **Share** (iOS / Android): sends the `.log` file via the system share sheet. Pick AirDrop, email, Slack, etc., the recipient gets a real file attachment.
- **Open** (Desktop): reveals `zmninja-ng.log` in Finder, Explorer, or your file manager.
- **Share** (Web, dev only): falls back to a one-shot text download.
- **Clear**: prompts for confirmation, then zeros the file and clears the in-memory buffer.

A status line below the action row shows the current entry count (e.g. *4,237 of 10,000 entries*). On desktop it also shows the absolute path. On mobile the path is a sandboxed URI you can't navigate to anyway, so it's omitted.

## Format and retention

- The file is NDJSON: one JSON object per line. Plain-text rendering happens on **Share**, so the file you send to support is human-readable.
- Capped at **10,000 entries**. When the cap is hit, the oldest half is dropped automatically.
- Lines that fail to parse (e.g. from a crash mid-write) are skipped silently when the file is read back.

## Filtering and log levels

The on-disk file mirrors the in-memory Logs view, so anything filtered out by your level / component settings is not persisted either. To configure:

- Global level and per-component overrides: **Settings → Advanced → Component Logs** (collapsible section). The global level sets the floor; per-component selectors override it for individual loggers.
- The Logs page itself only filters which entries are *displayed*. The component multi-select at the top of the page narrows the visible entries; it does not change the level being recorded.

Lowering the level (e.g. to DEBUG for a specific component) writes more to disk; raising it writes less.

## Live console output

The Logs page mirrors what the in-app console shows. If you want to watch raw console output as it streams (including stack traces and source-mapped errors that don't make it into the structured logger), open the developer console, see [How do I open the developer console on the desktop app?](faq.md#how-do-i-open-the-developer-console-on-the-desktop-app) in the FAQ.

## Sharing logs for support

Recommended flow:

1. Reproduce the issue.
2. Open the **Logs** page.
3. **iOS / Android:** tap **Share** → choose your share target → attach the resulting `zmninja-ng-*.log` file to your bug report.
4. **Desktop:** tap **Open** → in Finder/Explorer, copy the `.log` file out and attach it.
5. (Optional) **Clear** the logs after submitting if you'd like a clean slate before the next reproduction.
