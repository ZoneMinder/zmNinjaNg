# FAQ

## General

### What ZoneMinder version do I need?

ZoneMinder 1.36 or newer with API access enabled (`OPT_USE_API = 1`).

### Does zmNinjaNg work with self-signed certificates?

Yes. On mobile (iOS/Android), enable **Allow self-signed certificates** in Settings > Connection or when adding a new profile. On desktop, add your certificate authority to the system trust store. Using [Let's Encrypt](https://letsencrypt.org/) (free) or another trusted CA is still recommended. You can also use plain HTTP if your server is on a local network.

### Is zmNinjaNg free?

Yes. zmNinjaNg is open source and free to use. The source code is available on [GitHub](https://github.com/pliablepixels/zmNinjaNg).

### How is it free if you are charging for it in the playstore/appstore?

The source code is free, under Apache License 2.0. I also make the binaries (except iOS) free for use in the release artifacts. On top of that, ZoneMinder makes the apps available on the stores for a free. I personally don't make any money off of it (they kindly offered, I declined). ZoneMinder is incredible software, offered for free. I think it is fair for them to charge a fee for this app. If you prefer not to pay, you can always just grab the android binary from the Github release page for zmNinjaNg. Unfortunately, there is no easy way to offer iOS there.

### How is zmNinjaNg different from zmNinja?

zmNinjaNg is a ground-up rewrite of zmNinja using modern web technologies (React, TypeScript, Capacitor). It has the same core features but with a modern UI, better performance, and encrypted credential storage. See {doc}`Getting Started <getting-started>` for the full comparison.

## Connection Issues

### "Connection failed" when adding a profile

- Check that your ZoneMinder server is accessible from your device
- Verify the Portal URL format (typically `https://your-server/zm`)
- Ensure the ZoneMinder API is enabled
- If using HTTPS with a self-signed certificate, make sure the self-signed certificate toggle is enabled in Settings > Connection

### The app connects but shows no monitors

- Check that your ZoneMinder user has permission to view monitors
- Verify monitors exist and are enabled in ZoneMinder
- Try refreshing the page or pulling down to refresh on mobile

### Cameras show but snapshots don't load

- Check that ZoneMinder is running and monitors are online
- Verify the monitor capture is functioning in ZoneMinder's web console
- If using a reverse proxy, ensure it forwards image requests correctly

## Notifications

### Why don't push notifications work?

Push notifications on mobile (iOS/Android) require:
1. Building the app yourself with Firebase credentials
2. One of the following backends:
   - **ES mode**: The Event Notification Server with FCM support
   - **Direct mode**: ZoneMinder with the Notifications REST API (no Event Server needed)
3. Enabling notifications in zmNinjaNg settings and selecting the appropriate mode

See {doc}`notifications` for the full setup guide.

### Can I get notifications on desktop?

Yes. Desktop apps show in-app toast notifications while the app is open:
- **ES mode**: Events arrive in real time via WebSocket.
- **Direct mode**: zmNinjaNg polls the ZM events API at a configurable interval.

Background/push notifications (via FCM) are only available on mobile (iOS/Android). Desktop apps (Tauri) do not support FCM.

## Performance

### The app is slow on my phone

Try switching to **Low bandwidth mode** in Settings. This reduces refresh rates and image quality, which helps on slower connections or older devices.

### Montage view is laggy with many cameras

The montage view loads snapshot images for each camera. With many cameras, this can be data-intensive. Try:
- Using Low bandwidth mode
- Filtering to show fewer cameras
- Using monitor groups to view cameras in smaller batches

## Building

### Can I build for iOS without a Mac?

No. iOS builds require Xcode, which only runs on macOS.

### Do I need an Apple Developer account?

For personal use, you can use a free Apple Developer account to side-load the app to your own device. For distributing to others or using push notifications, a paid ($99/year) account is required.

### The pre-built Linux binary doesn't work

The pre-built binaries are built for specific distributions. Check the [GitHub Actions workflows](https://github.com/pliablepixels/zmNinjaNg/tree/main/.github/workflows) to see the build configuration and adjust for your system. You can also {doc}`build from source <installation>`.

## Debugging the Desktop App

### How do I open the developer console on the desktop app?

The Tauri desktop app includes a built-in WebView inspector for debugging, similar to Chrome or Firefox DevTools.

**To open it:**

- **Right-click** anywhere in the app and choose **Inspect Element**
- Or use keyboard shortcuts:
  - **Linux / Windows**: `Ctrl + Shift + I`
  - **macOS**: `Cmd + Option + I`

The inspector is platform-specific: it renders the **webkit2gtk WebInspector** on Linux, **Safari's inspector** on macOS, and the **Microsoft Edge DevTools** on Windows.

> **Note:** The inspector is only available in debug builds by default. If you installed a release build, you'll need to either:
> - Build with `tauri build --debug` to create a debug build with the inspector enabled
> - Or enable the `devtools` Cargo feature in `src-tauri/Cargo.toml` to include the inspector in production builds (note: this prevents App Store submission on macOS)

For full details, see the [Tauri debugging guide](https://v2.tauri.app/develop/debug/#webview-console).

For logs that survive across app restarts (and are easier to attach to a bug report), see {doc}`logs` — the in-app Logs page persists everything to a shareable file.

## Data & Privacy

### Does zmNinjaNg send data to third parties?

No. zmNinjaNg does not include any analytics, tracking, or third-party data collection. All communication is between the app and your ZoneMinder server.

### Where are my credentials stored?

Credentials are encrypted and stored locally on your device:
- **Web/Desktop**: AES-256-GCM encrypted in the browser's local storage
- **Android**: Hardware-backed encryption via Android Keystore
- **iOS**: iOS Keychain

### Can I export my profiles?

You can share profiles via QR code. Open a profile and select the share/QR option. The QR code contains the encrypted profile data.
