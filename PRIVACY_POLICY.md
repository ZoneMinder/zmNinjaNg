# zmNinjaNg Privacy Policy

**Last updated:** March 8, 2026

## Overview

zmNinjaNg is a client application for ZoneMinder, an open-source video surveillance system. The app connects to self-hosted ZoneMinder servers configured by the user. zmNinjaNg does not collect, store, or transmit any personal data to the developer or any third party.

## Data Storage

All data is stored locally on your device:

- **Server credentials** (username, password) are stored in the device's secure keychain/keystore.
- **Server addresses** and application preferences are stored in local app storage.
- **No data is sent to the developer** or any third-party analytics service.

## Network Connections

zmNinjaNg connects only to:

- **Your ZoneMinder server** — the address you configure in the app. All communication is between your device and your server.
- **Firebase Cloud Messaging (FCM)** — if you enable push notifications, the app registers a device token with Google's FCM service to receive event alerts from your ZoneMinder server. No personal data is shared with Google beyond the device token required for push delivery.

zmNinjaNg does not connect to any other external services.

## Camera and Photo Library Access

- **Camera** — used only for scanning QR codes to import server profiles. No photos or videos are captured or stored by the app.
- **Photo Library** — used only to save snapshots or video clips that you explicitly choose to export from your ZoneMinder server.

## Local Network Access

zmNinjaNg requests local network access to connect to ZoneMinder servers on your home network. Many users access their servers over LAN or VPN (e.g., WireGuard).

## Third-Party SDKs

- **Firebase Cloud Messaging** — used for push notification delivery. See [Google's Privacy Policy](https://policies.google.com/privacy).

No analytics, advertising, or tracking SDKs are included in the app.

## Children's Privacy

zmNinjaNg does not knowingly collect any information from children under 13.

## Changes to This Policy

Updates to this policy will be posted in this repository. Continued use of the app after changes constitutes acceptance of the updated policy.

## Contact

For questions about this privacy policy, please open an issue at [github.com/ZoneMinder/zmNinjaNg](https://github.com/ZoneMinder/zmNinjaNg/issues).
