# Getting Started

## What is zmNinjaNg?

zmNinjaNg is a client application for [ZoneMinder](https://zoneminder.com/), an open-source video surveillance system. It lets you:

- View live camera feeds from your ZoneMinder server
- Browse and play back recorded events
- See multiple cameras at once in a montage view
- Receive push notifications when events are detected
- Manage multiple ZoneMinder servers via profiles
- Customize your dashboard with widgets

zmNinjaNg runs on Android, iOS, Windows, macOS, Linux, and the web from a single codebase. It is a rewrite of [zmNinja](https://zmninja.zoneminder.com/) using React, TypeScript, Capacitor, and Tauri.

## Requirements

### ZoneMinder Server

- ZoneMinder 1.36 or newer
- API access enabled (`OPT_USE_API = 1`)
- A valid SSL certificate (or plain HTTP). For self-signed certificates, enable **Allow self-signed certificates** in Settings > Advanced. On desktop, you may also need to add your CA to the system trust store. [Let's Encrypt](https://letsencrypt.org/) is one option.

### Client

- **Web**: Any current browser (Chrome, Firefox, Safari, Edge)
- **Desktop**: Windows 10+, macOS 11+, or Linux (x86_64)
- **Android**: Android 8.0+
- **iOS**: iOS 15+ (you must build from source - see {doc}`../building/IOS`)

## Quick Start

1. **Download** the latest release for your platform from [GitHub Releases](https://github.com/pliablepixels/zmNinjaNg/releases)
2. **Open** the app - you'll land on the Profiles screen
3. **Add a profile** by entering your ZoneMinder server URL, username, and password
4. **Test the connection** - zmNinjaNg will validate your credentials and discover the API
5. **Save** the profile and you're in

See {doc}`installation` for detailed instructions per platform, and {doc}`profiles` for profile configuration options.

## Supported Features

| Feature | Status |
|---------|--------|
| Live monitor viewing | Supported |
| Event browsing and playback | Supported |
| Montage (multi-camera) view | Supported |
| Customizable dashboard | Supported |
| Event timeline and heatmap | Supported |
| Push notifications (mobile) | Supported on iOS and Android. Works out of the box with App Store / Google Play builds; custom builds need their own Firebase credentials |
| In-app notifications | Supported (foreground toast notifications on all platforms) |
| Multiple server profiles | Supported |
| Monitor groups and filters | Supported |
| PTZ controls | Supported |
| Themes | Light, Cream, Dark, Slate, Amber (+ System auto-detect) |
| Internationalization | 5 languages (EN, DE, ES, FR, ZH) |

## What's Different from zmNinja?

zmNinjaNg is not a port of zmNinja, it's a new application built from scratch. Differences:

- UI built with Tailwind CSS and shadcn/ui
- 3–4x faster load times, virtualized lists for long scrolls
- 60–75% smaller download size
- Passwords encrypted at rest with AES-256-GCM (hardware-backed on Android via Android Keystore)
- No analytics or third-party tracking
- Desktop apps via Tauri instead of Electron
- Drag-and-drop dashboard widgets
- Notification history

See the full [comparison](https://github.com/pliablepixels/zmNinjaNg/blob/main/notes/COMPARISON.md) for details.
