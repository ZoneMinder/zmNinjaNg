# FAQ

## General

### What ZoneMinder version do I need?

ZoneMinder 1.36 or newer with API access enabled (`OPT_USE_API = 1`).

### Does zmNinjaNg work with self-signed certificates?

Yes. Enable **Allow self-signed certificates** in Settings > Network (the toggle is shown only when the Portal URL uses HTTPS), or toggle it when adding a new profile. On native platforms (iOS/Android/desktop) the certificate fingerprint is pinned on first connection. Using [Let's Encrypt](https://letsencrypt.org/) (free) or another trusted CA is still recommended. You can also use plain HTTP if your server is on a local network.

### Linux desktop: login works but live streams and images stay black

On Linux (AppImage and `.deb`), the **Allow self-signed certificates** toggle covers API calls, but the underlying Chromium engine still rejects the self-signed certificate when loading MJPEG streams and snapshot images. The symptom is a successful login with a black preview and a crossed-out camera icon. Right-click > Inspect > Console shows `Unacceptable TLS certificate` errors.

Fix this by adding the certificate to the system trust store:

```bash
sudo cp your-server.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

Then restart zmNinjaNg. This applies to both the AppImage and `.deb` builds.

### iOS/Android: login works but live view and thumbnails stay blank

On a self-signed HTTPS server, API calls succeed (they go through the native HTTP layer, which accepts the cert) but live MJPEG and event thumbnails load in the WebView, which only accepts the cert once its fingerprint is pinned. If the fingerprint was never pinned (for example the trust dialog was dismissed during setup), the API works while every image fails silently.

When this state is detected the app shows a **Certificate not trusted** banner at the top. Tap **Verify**, then accept the certificate in the dialog. That pins the fingerprint, and live view and thumbnails load. You can also re-pin from Settings > Network.

### Is zmNinjaNg free?

Yes. zmNinjaNg is open source and free to use. The source code is available on [GitHub](https://github.com/ZoneMinder/zmNinjaNg).

### How is it free if you are charging for it in the playstore/appstore?

The source code is free, under Apache License 2.0. I also make the binaries (except iOS) free for use in the release artifacts. On top of that, ZoneMinder makes the apps available on the stores for a fee. I personally don't make any money off of it (they kindly offered, I declined). I think it is fair for them to charge a fee for this app. If you prefer not to pay, you can always just grab the android binary from the Github release page for zmNinjaNg. Unfortunately, there is no easy way to offer iOS there.

### How is zmNinjaNg different from zmNinja?

zmNinjaNg is a rewrite of zmNinja using React, TypeScript, and Capacitor. Same core features, with a new UI, faster load times, and encrypted credential storage. See {doc}`Getting Started <getting-started>` for the full comparison.

## Connection Issues

### "Connection failed" when adding a profile

- Check that your ZoneMinder server is accessible from your device
- Verify the Portal URL format (typically `https://your-server/zm`)
- Ensure the ZoneMinder API is enabled
- If using HTTPS with a self-signed certificate, make sure the self-signed certificate toggle is enabled in Settings > Network

### Android: "Connection failed" on a local server, but a remote URL works

Some Android devices block an app from reaching your local network until you grant a per-app permission by hand. The giveaway is that the same server works over a public hostname or over cellular through a VPN, other apps on the phone reach it fine, and only the LAN address (`http://192.168.x.x/zm` and the like) fails.

Grant it in Android settings, not in zmNinjaNg: **Settings > Apps > zmNinjaNg > Permissions**, then enable the local network entry. The wording differs by vendor, so look for **Local network**, **LAN**, or **Allow access to local network**. On Xiaomi/HyperOS, OPPO/ColorOS, vivo, and Huawei the toggle may instead sit under a vendor privacy or permission manager screen. Reopen zmNinjaNg afterwards and retry the profile.

If your device has no such toggle anywhere in its settings, this is not your problem, work through the checklist above instead.

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

Push notifications on mobile (iOS/Android) work out of the box with the App Store and Google Play builds, no Firebase setup is required on your end. You still need to:

1. Pick a backend in **Notification Settings**:
   - **ES mode**: The Event Notification Server with FCM support
   - **Direct mode**: ZoneMinder with the Notifications REST API (no Event Server needed)
2. Enable notifications in zmNinjaNg settings and select the appropriate mode

If you build the app from source, you must provide your own Firebase credentials (`google-services.json` for Android, `GoogleService-Info.plist` for iOS), see {doc}`../building/ANDROID` and {doc}`../building/IOS`.

See {doc}`notifications` for the full setup guide.

### Can I get notifications on desktop?

Yes. Desktop apps show in-app toast notifications while the app is open:
- **ES mode**: Events arrive in real time via WebSocket.
- **Direct mode**: zmNinjaNg polls the ZM events API at a configurable interval.

Background/push notifications (via FCM) are only available on mobile (iOS/Android). Desktop apps (Electron) do not support FCM.

## Performance

### The app is slow on my phone

Try switching to **Low bandwidth mode** in Settings. This reduces refresh rates and image quality, which helps on slower connections or older devices.

### Montage view is laggy with many cameras

The montage view loads a snapshot for each camera, which adds up. Try:
- Low bandwidth mode
- Filtering to show fewer cameras
- Using monitor groups to view cameras in smaller batches

## Building

### Can I build for iOS without a Mac?

No. iOS builds require Xcode, which only runs on macOS.

### Do I need an Apple Developer account?

For personal use, you can use a free Apple Developer account to side-load the app to your own device. For distributing to others or using push notifications, a paid ($99/year) account is required.

### The pre-built Linux binary doesn't work

The pre-built binaries are built for specific distributions. Check the [GitHub Actions workflows](https://github.com/ZoneMinder/zmNinjaNg/tree/main/.github/workflows) to see the build configuration and adjust for your system. You can also {doc}`build from source <installation>`.

## Debugging the Desktop App

### How do I open the developer console on the desktop app?

The Electron desktop app uses Chromium DevTools.

**To open it:**

- **Right-click** anywhere in the app and choose **Inspect Element**
- Or use keyboard shortcuts:
  - **Linux / Windows**: `Ctrl + Shift + I`
  - **macOS**: `Cmd + Option + I`

For logs that survive across app restarts (and are easier to attach to a bug report), see {doc}`logs`: the in-app Logs page persists everything to a shareable file.

## Data & Privacy

### Does zmNinjaNg send data to third parties?

zmNinjaNg includes no analytics, tracking, or telemetry, and the Firebase Analytics SDK is not bundled. Almost all communication is between the app and your own ZoneMinder server.

The app does contact a few fixed external endpoints, none of which receive personal data or usage tracking: the maintainer notices feed on GitHub (checked once a day), Google Firebase Cloud Messaging for push notifications on mobile (only when notifications are enabled), and public WebRTC STUN servers during go2rtc WebRTC live view. Each endpoint, with the platforms it applies to and how to disable it, is listed in {doc}`../developer-guide/13-network-endpoints`.

### Where are my credentials stored?

Credentials are encrypted and stored locally on your device:
- **Web/Desktop**: AES-256-GCM encrypted in the browser's local storage
- **Android**: Hardware-backed encryption via Android Keystore
- **iOS**: iOS Keychain

