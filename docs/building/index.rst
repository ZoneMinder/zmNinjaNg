Building for Mobile & Desktop
=============================

zmNinjaNg can be built as a native mobile app (Android, iOS) or a desktop app
(macOS, Windows, Linux). The same source code is used across all platforms.

Prerequisites
-------------

- Node.js ^20.19.0 or >=22.12.0 and npm
- For Android: Android Studio, JDK 17+
- For iOS: Xcode, macOS, Apple Developer account

Web Build
---------

The simplest target. Produces static files you can host anywhere.

.. code-block:: bash

   cd app
   npm install
   npm run build    # Output: dist/
   npm run preview  # Preview locally

Deploy the ``dist/`` folder to Netlify, Vercel, GitHub Pages, AWS S3, or
any static host.

Desktop Build (Electron)
------------------------

Produces a native desktop app via Electron.

.. code-block:: bash

   cd app
   npm install
   npm run electron:dev     # Development with HMR
   npm run electron:build   # Production build -> desktop_release_builds/electron/

macOS Code Signing: Avoiding Keychain Prompts
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

When running ``npm run electron:build`` on macOS, you may be prompted for your
keychain password multiple times (once per binary that needs signing). To
avoid this:

1. Open **Keychain Access**
2. Under **My Certificates**, find your signing certificate and expand it to
   reveal the private key
3. Right-click the private key and select **Get Info**
4. Go to the **Access Control** tab
5. Select **Allow all applications to access this item**
6. Click **Save Changes** and enter your keychain password when prompted

This is a one-time change. You will not be prompted again for subsequent builds.

Mobile Builds
-------------

.. toctree::
   :maxdepth: 2

   ANDROID
   IOS

Release Notices
---------------

.. toctree::
   :maxdepth: 2

   release-notices

Versioning
----------

Two numbers identify a build, set by
`sync-version.js <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/sync-version.js>`_
(run by ``npm run android:sync`` / ``npm run ios:sync`` and by the release
script):

- **Marketing version**, from ``package.json`` ``version`` (e.g. ``1.1.14``).
  Written to Android ``versionName`` and iOS ``MARKETING_VERSION``
  (``CFBundleShortVersionString``). This is the version shown in the store
  listing and the app sidebar. Bump it on a prod release.
- **Build number**, the git commit count (``git rev-list --count HEAD``).
  The stores require this to strictly increase per upload. iOS
  ``CURRENT_PROJECT_VERSION`` (``CFBundleVersion``) uses the commit count
  directly, so ``v1.1.14 (1533)`` in the app sidebar matches ``CFBundleVersion
  1533`` in App Store Connect. Android ``versionCode`` adds a base offset of
  100000 (``100000 + commit count``): builds before mid-2026 used
  ``major*10000 + minor*100 + patch`` (``v1.1.14`` -> ``10114``), and the raw
  commit count is below those legacy codes, so Google Play would reject it as a
  downgrade. The offset clears any legacy code (at most 99999 for versions below
  10.0.0), so commit ``1533`` becomes ``versionCode 101533``. The app sidebar
  shows the un-offset commit count.

The git commit count increases on every commit and stays monotonic as long as
release builds come from ``main`` without rewriting published history. The
Android ``versionCode`` is a signed 32-bit integer capped at 2,100,000,000 by
Google Play, which ``100000 + commit count`` stays far below.

The generated ``versionCode`` / ``CURRENT_PROJECT_VERSION`` values in
``app/android/app/build.gradle`` and the Xcode project are regenerated and
committed at release time by ``make_release.sh``; they are not committed on
every change.

The build number also goes into the desktop artifact filenames, so a
downloaded binary identifies its exact build:

.. code:: text

   zmNinjaNg-1.1.14-b1512-macos-aarch64.dmg
   zmNinjaNg-1.1.14-b1512-windows-x64-setup.exe
   zmNinjaNg-1.1.14-b1512-linux-amd64.AppImage

The release workflows set this in their rename steps; local builds and
``build-all.yml`` use the electron-builder ``${env.BUILD_NUMBER}`` macro, which
``sync-version.js`` exports via ``$GITHUB_ENV`` in CI and
``build-desktop-electron.sh`` exports locally.

Because the build number is the git commit count, the build workflows check
out with ``fetch-depth: 0``. The default shallow clone makes
``git rev-list --count HEAD`` return ``1``.

Automated Releases
------------------

zmNinjaNg uses GitHub Actions to build release binaries automatically. See
`make_release.sh <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/make_release.sh>`_
for the release workflow.

Before it tags anything, ``make_release.sh`` runs the browser e2e suite
against the ZoneMinder named in ``app/.env``, and stops without tagging if a
scenario fails. This is the only automatic run those journeys get: CI's
``e2e-tests`` job ends green without running them, because it needs
``ZM_HOST_1`` / ``ZM_USER_1`` / ``ZM_PASSWORD_1`` secrets that are not set,
and the test server sits on a private LAN that a GitHub-hosted runner cannot
reach. A green tick on that job means "ran, or had nothing to run"; its step
summary says which.

It asks first. The suite is 168 scenarios run serially, about 18 minutes,
and roughly 45% of that is the app booting under the Vite dev server once per
scenario. A gate that always costs 18 minutes gets routed around, so it asks
instead: Enter runs it, ``n`` skips with a warning. ``--skip-e2e`` skips
without the question, for scripted runs.

Every e2e run writes ``app/.e2e-last-run.json`` (Playwright's JSON reporter,
gitignored). The prompt reads it and says when the suite last ran on this
machine and whether it passed, and recommends a run when that record is
missing, failed, or older than two weeks. It only recommends; the answer is
still yours.

With no terminal to ask on, it runs rather than skipping: silence should not
lose the only cover these journeys have. Missing ``app/.env`` is an error
rather than a silent skip, for the same reason.

When the version in ``app/package.json`` already has a tag, ``make_release.sh``
offers to pick a new version. It runs ``generate_notice.mjs --plan`` once, which
feeds the closed issues since the last release (from ``github_changelog_generator``)
to a single ``claude -p`` call and gets back a recommended bump (major, minor, or
patch) plus the developer-notice draft. The recommended version is pre-selected
in the menu; you confirm or override it. If ``claude``, ``gh``, or the changelog
tool is unavailable, the suggestion falls back to a patch bump and the release
still proceeds. For a minor or major release the same draft is reused to write
the in-app notice (``docs/notices.json``), so Claude runs at most once per
release. See :doc:`release-notices` for that half on its own.

To enable automated builds on your fork:

1. Go to **Settings > Actions > General** in your GitHub repository
2. Under **Workflow permissions**, select **Read and write permissions**
3. Click **Save**

Pushing a version tag triggers builds for Android, Linux (amd64 and arm64),
macOS, and Windows. iOS is not built in CI: it is archived on a Mac with
Xcode, which ``make_release.sh`` does for you.

Store uploads
-------------

After pushing the tag, ``make_release.sh`` offers to publish to both mobile
stores in one prompt. Each store appears only if its credentials are
installed, and both uploads land as drafts: nothing reaches users until you
release the build in App Store Connect or start the rollout in the Play
Console.

iOS archives locally and uploads straight to App Store Connect. Android does
not build locally, because that would mean a second copy of the signing key on
a developer machine and a bundle CI never saw; instead it waits for the tag's
Android workflow to attach the AAB to the GitHub release, then publishes that.

Release notes for both stores come from the same developer notice in
``docs/notices.json``, so neither console needs the text retyped. Google Play
allows 500 characters against Apple's 4000, so a longer notice is compressed
rather than cut and every bullet survives in shorter wording.

Both scripts also run on their own, which is how you publish a release that was
tagged earlier:

.. code:: bash

   ./scripts/upload-ios.sh
   ./scripts/upload-android.sh 2.4.0

Setup is per-developer and nothing identifying either account is committed. See
:doc:`IOS` for the App Store Connect key and :doc:`ANDROID` for the Play
service account.
