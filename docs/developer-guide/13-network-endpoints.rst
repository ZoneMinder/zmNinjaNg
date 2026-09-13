External Network Endpoints
==========================

zmNinjaNg talks to your own ZoneMinder server using the URLs configured in each
profile (portal, API, CGI/ZMS, go2rtc). Beyond those, the app reaches out to a
small, fixed set of external endpoints. This chapter lists every external
endpoint, why it is contacted, what leaves the device when it is, on which
platforms, how often, what triggers it, and how to turn it off.

Profile and ZoneMinder server URLs are intentionally excluded here, since those
are servers you configure and control.

Endpoints
---------

.. list-table::
   :header-rows: 1
   :widths: 18 24 13 11 16 18

   * - Endpoint
     - Why, and what is sent
     - Platforms
     - How often
     - Trigger
     - How to disable
   * - ``raw.githubusercontent.com``
     - Maintainer notices shown in-app. A plain GET of a static JSON file.
       Nothing app-specific is sent: no version, no profile, no identifier.
     - Web, Desktop (Electron), iOS, Android
     - Every 24 hours
     - App launch, the 24-hour poll, and window focus when the cached copy is
       older than 24 hours.
     - No in-app toggle. Can only be blocked at the network level.
   * - Google FCM (``fcm.googleapis.com``, ``firebaseinstallations.googleapis.com``)
     - Acquire and refresh the push token so the ZoneMinder server can send push
       notifications. ``services/pushNotifications.ts`` calls
       ``FirebaseMessaging.getToken()``; the Firebase SDK registers the app
       installation with Google, so device and app identifiers leave the device.
       No ZoneMinder data goes with them.
     - iOS, Android only
     - Not polled
     - App init, Firebase token refresh, and profile change.
     - Turn off notifications in the profile's Notification settings
       (``enabled = false``). Never runs on Web or Desktop.
   * - Google FCM push channel (OS-maintained)
     - Inbound push message delivery over the socket the OS already holds open.
       The app sends nothing on it; the payload arrives from your ZoneMinder
       server by way of Google.
     - iOS, Android only
     - Not polled
     - An incoming push message.
     - Same as above, plus the OS-level notification permission.
   * - ``stun:stun.cloudflare.com:3478``, ``stun:stun.l.google.com:19302``
     - WebRTC ICE (Interactive Connectivity Establishment, how peers find a
       working network path) and NAT (network address translation) traversal
       for a go2rtc live stream. A STUN (Session Traversal Utilities for NAT) binding
       request exists to learn the device's public IP address and port, so the
       STUN provider sees both. No stream data crosses it.
     - Web, Desktop, iOS, Android, and only when the profile opts in
     - Not polled
     - Starting a go2rtc WebRTC live stream while **STUN Servers** is on.
     - Off by default. ``webrtcUseStun`` is ``false`` in profile settings, and
       ``useGo2RTCStream`` then applies an empty ICE list. Setting the streaming
       method to MJPEG, dropping ``webrtc`` from the protocol list, or viewing a
       monitor with no go2rtc source also prevents it.
   * - ``zmninjang.readthedocs.io``
     - This documentation. An ordinary browser request that sends nothing about
       the app.
     - All
     - On demand
     - Tapping "Help Docs".
     - The request happens only on that tap, and it opens in the system browser
       rather than in the app, so there is nothing to switch off.

Notes
-----

- The notices feed is ``https://raw.githubusercontent.com/ZoneMinder/zmNinjaNg/main/docs/notices.json``.
- Only that feed runs on a fixed timer (24 hours, set by
  ``DEVELOPER_NOTICES.pollIntervalMs`` in ``lib/zmninja-ng-constants.ts``). FCM
  and STUN are not polled at all: each is reached only when something triggers
  it.
- The app registers the push token only with your own ZoneMinder server. To
  issue that token, the Firebase SDK sends device and app identifiers to Google
  (see the Google FCM row above).
- There are no analytics or telemetry endpoints. The Firebase Analytics SDK is
  not bundled on any platform, and collection is explicitly disabled via the
  ``firebase_analytics_collection_enabled`` (Android) and
  ``FIREBASE_ANALYTICS_COLLECTION_ENABLED`` (iOS) flags.
- STUN is reached only through the WebRTC path. ``lib/vendor/go2rtc/video-rtc.js``
  creates the ``RTCPeerConnection`` (and uses the STUN ``iceServers``) only when
  the active protocol list includes ``webrtc``. The server list itself is
  ``GO2RTC_STUN_SERVERS`` in ``lib/zmninja-ng-constants.ts``.

Developer notice feed
---------------------

``docs/notices.json`` is a JSON array of notice objects, validated on load, and
each object carries these fields:

.. list-table::
   :header-rows: 1
   :widths: 22 10 68

   * - Field
     - Required
     - Description
   * - ``id``
     - Yes
     - Unique string. Release notices use ``release-<version>``.
   * - ``title``
     - Yes
     - Short display title; generation target is under 60 characters.
   * - ``body``
     - Yes
     - Notice text. May include one Markdown link.
   * - ``publishedAt``
     - Yes
     - ISO 8601 timestamp set at generation time.
   * - ``severity``
     - Yes
     - ``info``, ``warning``, or ``critical``. Release notices use ``info``.
       ``critical`` also triggers a global dismissible banner.
   * - ``link``
     - No
     - URL shown alongside the notice. For release notices, the GitHub release
       page.
   * - ``minAppVersion``
     - No
     - When set, notices are hidden on app versions older than this value.
       Release notices set it to the released version.

Deleting a notice on the client is a per-device exclusion, not a change to
``docs/notices.json``. ``useDeveloperNoticeStore`` (``app/src/stores/developerNotices.ts``)
persists a ``deletedIds`` array alongside the existing ``readIds`` and
``dismissedBannerIds``, and ``useDeveloperNotices`` (``app/src/hooks/useDeveloperNotices.ts``)
filters those ids out of the fetched feed on every refetch. The Developer
Notice page has a per-row delete button, a confirmed Clear all action, and
a Restore action that clears ``deletedIds`` and refetches.

Authoring a notice, including ``scripts/generate_notice.mjs`` and how
``make_release.sh`` calls it, is in :doc:`../building/release-notices`.
