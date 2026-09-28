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

The on-disk file mirrors the in-memory Logs view, so anything filtered out by your level or component settings is not persisted either. Three settings decide what gets recorded. All three are under **Settings > General**:

- **Log level** (DEBUG, INFO, WARN, ERROR) sets the global level, the floor for every logger. Changing it also clears any per-component levels, so every component follows the new level until you set one again. The **Level** picker in this page's toolbar is the same setting and clears component levels the same way.
- **Component Logs** gives one component its own level (DEBUG, INFO, WARN, ERROR, or NONE). **Reset** puts every component back on the global level.
- **Disable Log Redaction** turns off the scrubbing described in [What gets redacted](#what-gets-redacted).

The component multi-select in the toolbar only narrows which entries are *displayed*. It does not change what is recorded.

Lowering the level (e.g. to DEBUG for a specific component) writes more to disk; raising it writes less.

The level belongs to what is selected in the app, like the other rows in General (see {doc}`settings`). With one profile selected it saves to that profile. With a Virtual Profile Group selected it saves to the group and leaves each server's own value alone. In a group this page also shows a **Profile** picker. That picker chooses which server's ZoneMinder logs the **ZM** tab shows. It has no effect on the level.

## What gets redacted

Unless you turn on **Disable Log Redaction** in Settings > General, entries are scrubbed before they are displayed, written to the file, or shared:

- Passwords, tokens, API keys, session cookies, and `Authorization` headers are replaced by placeholders. Tokens keep their first few characters so two log lines can still be matched up; passwords are removed outright.
- Credentials embedded in a URL (`rtsp://user:password@camera/stream`) lose the password, whatever the scheme. This is the form a camera password takes in a monitor's source path, and the form ZoneMinder itself writes into its logs when it starts a capture.
- Hostnames are shortened to their first six characters.

This applies to the **ZM** tab as well, which shows ZoneMinder's own logs rather than the app's. Those lines are redacted on the way in, so the file you share carries the same protection.

Redaction is a safety net for logs you share, not a security boundary. Anything the app can display, the ZoneMinder API already handed to your account.

## Live console output

The Logs page mirrors what the in-app console shows. If you want to watch raw console output as it streams (including stack traces and source-mapped errors that don't make it into the structured logger), open the developer console, see [How do I open the developer console on the desktop app?](faq.md#how-do-i-open-the-developer-console-on-the-desktop-app) in the FAQ.

## Sharing logs for support

Recommended flow:

1. Reproduce the issue.
2. Open the **Logs** page.
3. **iOS / Android:** tap **Share** → choose your share target → attach the resulting `zmninja-ng-*.log` file to your bug report.
4. **Desktop:** tap **Open** → in Finder/Explorer, copy the `.log` file out and attach it.
5. (Optional) **Clear** the logs after submitting if you'd like a clean slate before the next reproduction.
