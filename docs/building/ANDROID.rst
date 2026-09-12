Android Build Guide
===================

This guide walks you through setting up and building the zmNinjaNg Android
app from scratch.

Prerequisites
-------------

Before you begin, ensure you have the following installed:

- **Node.js ^20.19.0 \|\| >=22.12.0** and npm - `Download
  here <https://nodejs.org/en/download>`__
- **Android Studio** - `Download
  here <https://developer.android.com/studio>`__
- **Android SDK** (installed via Android Studio)
- **Java JDK 17+** (usually bundled with Android Studio)

Environment Setup
-----------------

1. Configure Android SDK
~~~~~~~~~~~~~~~~~~~~~~~~

After installing Android Studio, set up the ``ANDROID_HOME`` environment
variable:

**macOS/Linux:**

.. code:: bash

   # Add to ~/.zshrc or ~/.bashrc
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/emulator
   export PATH=$PATH:$ANDROID_HOME/tools
   export PATH=$PATH:$ANDROID_HOME/tools/bin
   export PATH=$PATH:$ANDROID_HOME/platform-tools

**Windows:**

::

   ANDROID_HOME=C:\Users\YourUsername\AppData\Local\Android\Sdk

Verify the installation:

.. code:: bash

   echo $ANDROID_HOME  # Should show the SDK path
   adb --version       # Should show ADB version

2. Create an Android Virtual Device (AVD)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

For push notifications to work, you need an emulator with **Google Play
Services**:

1. Open Android Studio
2. Go to **Tools > Device Manager**
3. Click **Create Device**
4. Select a device (e.g., Pixel 5)
5. Choose a system image with the **Play Store icon** (e.g., Android 13
   with Google APIs)
6. Click **Finish**

Project Setup
-------------

1. Clone the Repository
~~~~~~~~~~~~~~~~~~~~~~~

.. code:: bash

   git clone https://github.com/ZoneMinder/zmNinjaNg
   cd zmNinjaNg/app

2. Install Dependencies
~~~~~~~~~~~~~~~~~~~~~~~

.. code:: bash

   npm install

Push Notifications Setup
------------------------

To enable push notifications, you need to configure Firebase Cloud
Messaging (FCM):

1. Create Firebase Project
~~~~~~~~~~~~~~~~~~~~~~~~~~

1. Go to `Firebase Console <https://console.firebase.google.com/>`__
2. Click **Add project**
3. Follow the setup wizard to create your project (call it anything, I
   called mine zmNinjaNg)

2. Add Android App to Firebase
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

1. In Firebase Console, click **Add app** and select **Android**
2. Enter the package name: ``com.zoneminder.zmNinjaNG``
3. (Optional) Enter an app nickname: “zmNinjaNg Android”
4. Click **Register app**

3. Download Configuration File
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

1. Download the ``google-services.json`` file

2. Place it in the following location:

   ::

      zmNinjaNg/app/android/app/google-services.json

4. Verify Firebase Configuration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The project already includes the necessary Firebase dependencies. The
``google-services.json`` file is all you need to enable push
notifications.

   **Note:** Push notifications will only work on emulators/devices with
   **Google Play Services** installed.

5. Configure ZoneMinder Event Notification Server
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

zmNinjaNg works out of the box with zmES web socket notifications. If you
want push notification support, the ZoneMinder event notification server
(``zmeventnotification.pl``) needs to be configured to work with your
Firebase project. You will need to use a modified version that I
provided
`here <https://github.com/ZoneMinder/zmeventnotificationNg>`__.
Follow its README

Building and Running
--------------------

Debug Build
~~~~~~~~~~~

To build and run the app on an emulator or connected device:

.. code:: bash

   # Build web assets, sync to Android, and run
   npm run android

   # Open in Android Studio
   npm run android:open

This command will: 1. Build the React web app 2. Sync files to the
Android project 3. Launch the app on a connected device/emulator

**View logs:**

.. code:: bash

   npm run android:logs

**Check connected devices:**

.. code:: bash

   npm run android:devices

Automated Release Upload
~~~~~~~~~~~~~~~~~~~~~~~~

``scripts/make_release.sh`` can publish the release to Google Play for you, so
the manual download-and-upload steps below are only needed for a one-off
build.

The bundle is not built locally. Pushing a release tag starts the Build Android
Release workflow, which signs the AAB with the keystore held as a repository
secret and attaches it to the GitHub release. Rebuilding it here would mean a
second copy of the signing key on a developer machine and a bundle that never
went through CI, so ``scripts/upload-android.sh`` waits for that one, downloads
it, and publishes it.

One-time setup
^^^^^^^^^^^^^^

1. In the `Google Cloud console <https://console.cloud.google.com>`__, pick or
   create a project and enable the **Google Play Android Developer API**.
2. Create a service account in that project and download a **JSON** key for it.
3. In the `Play Console <https://play.google.com/console>`__, go to **Users and
   permissions**, invite the service account's email address, and grant it
   **Release apps to testing tracks** and **Release apps to production** for
   zmNinjaNg. Play takes up to a day to propagate a new grant.
4. Save the key outside the repository:

   .. code:: bash

      mkdir -p ~/.playconsole
      mv ~/Downloads/<project>-<hash>.json ~/.playconsole/service-account.json
      chmod 600 ~/.playconsole/service-account.json

Unlike the App Store key, this JSON file is a complete credential: it carries
its own private key and needs no second identifier, so it never belongs in the
repository or in a shared channel.

What a release does
^^^^^^^^^^^^^^^^^^^

After pushing the tag, ``make_release.sh`` offers the mobile uploads once, for
both stores together. Answering yes archives and uploads iOS first, since that
does not depend on CI, and then waits for the Android workflow to attach the
bundle before publishing it.

The build lands on the **production** track as a **draft**. Nothing reaches
users until you start the rollout in the Play Console.

Release notes come from the same developer notice the App Store gets, in
``docs/notices.json``. Play allows only 500 characters against Apple's 4000, so
a longer notice is compressed rather than cut: every bullet survives in shorter
wording. The final text is printed and has to be accepted before anything is
uploaded. If the compression step is unavailable, whole bullets are dropped
from the end and named, so you can see what will not reach Play.

Publishing a past release needs only its version:

.. code:: bash

   ./scripts/upload-android.sh 2.4.0

Production Build
~~~~~~~~~~~~~~~~

To build and upload by hand instead, for distribution or the Google Play Store:

1. Generate a Signing Key
^^^^^^^^^^^^^^^^^^^^^^^^^

If you don’t already have a keystore, create one:

.. code:: bash

   keytool -genkey -v -keystore zmninja-ng-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias zmninja-ng-upload

You’ll be prompted to enter a keystore password and identity fields.

**Keep your keystore file and passwords safe!** You’ll need them for all
future app updates. Store the keystore outside the repo (e.g.,
``~/.signing-keys/``).

2. Configure Signing
^^^^^^^^^^^^^^^^^^^^

The build reads signing configuration from environment variables. Add
these to your ``~/.zshrc`` or ``~/.bashrc``:

.. code:: bash

   export ZMNINJA_KEYSTORE_PATH="$HOME/.signing-keys/zmninja-ng-upload.jks"
   export ZMNINJA_KEYSTORE_PASSWORD="your_password"
   export ZMNINJA_KEY_ALIAS="zmninja-ng-upload"
   export ZMNINJA_KEY_PASSWORD="your_password"

Then reload your shell: ``source ~/.zshrc``

3. Build Release APK
^^^^^^^^^^^^^^^^^^^^

.. code:: bash

   cd app
   npx cap sync android
   cd android && ./gradlew assembleRelease

Output location:
``android/app/build/outputs/apk/release/app-release.apk``

4. Build App Bundle (AAB) for Play Store
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

For publishing to Google Play Store, use the App Bundle format:

.. code:: bash

   cd app/android && ./gradlew bundleRelease

Output location:
``android/app/build/outputs/bundle/release/app-release.aab``

5. Upload to Google Play Console
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

1. Go to `Google Play Console <https://play.google.com/console>`__
2. Select **zmNinjaNg**
3. Go to **Testing > Internal testing** (or **Production**) and click
   **Create new release**
4. Upload the ``.aab`` file
5. Add release notes and roll out

CI/CD
^^^^^

The GitHub Actions workflow (``build-android.yml``) handles signed
release builds automatically. It uses these repository secrets:

- ``ANDROID_KEYSTORE_BASE64``: base64-encoded keystore file
- ``ANDROID_KEYSTORE_PASSWORD``: keystore password
- ``ANDROID_KEY_ALIAS``: key alias
- ``ANDROID_KEY_PASSWORD``: key password

To generate the base64 keystore value:

.. code:: bash

   base64 -i ~/.signing-keys/zmninja-ng-upload.jks | pbcopy

Paste the clipboard contents as the ``ANDROID_KEYSTORE_BASE64`` secret
in **GitHub > Settings > Secrets and variables > Actions**.

Troubleshooting
---------------

Build Fails with “ANDROID_HOME not set”
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Make sure you’ve set the ``ANDROID_HOME`` environment variable and
restarted your terminal.

Push Notifications Don’t Work
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Ensure you’re using an emulator/device with **Google Play Services**
- Verify ``google-services.json`` is in the correct location
- Check that the package name in Firebase matches
  ``com.zoneminder.zmNinjaNG``
- If using your own Firebase project, ensure the ZoneMinder server is
  configured with your FCM credentials
- Check for “sender ID mismatch” errors in logcat - this means your
  app’s Firebase project doesn’t match the server’s

FCM Image Errors (“Failed to decode image”)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

If you see this error in the Android logs:

::

   Failed to download image: java.io.IOException: Failed to decode image

This means the ZoneMinder server is sending an incorrectly formatted
image URL. Fix it by: 1. Editing ``/etc/zm/zmeventnotification.ini`` on
your ZoneMinder server 2. Setting ``picture_url`` to use ``view=image``
instead of ``view=frame`` 3. Removing username/password from the URL
(use tokens instead) 4. Example:
``picture_url = http://your-server/index.php?view=image&eid=EVENTID&fid=snapshot&width=600``

App Won’t Connect to ZoneMinder Server (HTTP)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Android 9+ blocks cleartext HTTP by default
- The app includes ``network_security_config.xml`` to allow HTTP
- If you modified the config, ensure it allows cleartext traffic

Gradle Build Errors
~~~~~~~~~~~~~~~~~~~

Try cleaning the build:

.. code:: bash

   cd android
   ./gradlew clean
   cd ..
   npm run android

Next Steps
----------

- **Testing**: Run the app and connect to your ZoneMinder server
- **Customization**: Update app icons, splash screens, and branding
- **Distribution**: Upload AAB to Google Play Console for release

For more information, see: - `Capacitor Android
Documentation <https://capacitorjs.com/docs/android>`__ - `Android
Developer Guide <https://developer.android.com/guide>`__ - `Firebase
Cloud Messaging <https://firebase.google.com/docs/cloud-messaging>`__
