# GitHub Actions Build Workflows

This directory contains automated build workflows for zmNinjaNg across multiple platforms.

## Quick Fix: macOS "Damaged App" Error

If you downloaded a macOS build and get a "damaged" error, that is not because the app is damaged. It is because macOS blocks unsigned binaries. In more recent versions this has become painful. Simple answer: use [Sentinel](https://github.com/alienator88/Sentinel).

## Available Workflows

### Individual Platform Builds

Each platform has its own dedicated workflow that can be triggered manually or on git tags:

- **`build-android.yml`** — Builds Android APK and AAB
- **`build-macos.yml`** — Builds the macOS Electron DMG
- **`build-linux-amd64.yml`**, **`build-linux-arm64.yml`** — Builds Linux Electron AppImage, DEB, and RPM
- **`build-windows.yml`** — Builds the Windows Electron installer (.exe)

### Combined Build Workflow

- **`build-all.yml`** — Builds multiple platforms in parallel (configurable)

## How to Trigger Builds

### Recommended: Using the Release Script

The easiest way to create a release is using the automated release script:

```bash
# From the project root
./scripts/make_release.sh
```

This script will:
1. Verify all changes are committed and pushed
2. Read the version from `app/package.json`
3. Create a git tag in the format `zmNinjaNg-{version}`
4. Push the tag to trigger all build workflows
5. Create a GitHub Release with build artifacts

**Safety Checks**: The script performs validation before creating a release:
- Fails if there are uncommitted changes
- Fails if there are unpushed commits
- Asks for confirmation before proceeding

**Handling Existing Tags**: If a tag already exists, the script will ask if you want to move it to the current commit. This is useful when you need to rebuild a release with fixes.

### Manual Trigger (Workflow Dispatch)

1. Go to **Actions** tab in GitHub
2. Select the workflow you want to run
3. Click **Run workflow**
4. Enter the version number (e.g., `1.0.0`)
5. For `build-all.yml`, optionally specify platforms (default: all)

### Manual Tag Push (Alternative)

```bash
# Tag format must be: zmNinjaNg-{version}
git tag zmNinjaNg-1.0.0
git push origin zmNinjaNg-1.0.0
```

To move an existing tag to a new commit:

```bash
git tag -d zmNinjaNg-1.0.0
git push origin --delete zmNinjaNg-1.0.0

git tag zmNinjaNg-1.0.0
git push origin zmNinjaNg-1.0.0 --force
```

This will:
- Trigger all individual platform workflows
- Create a GitHub Release with build artifacts attached

## Build Artifacts

After a successful build, artifacts are available for download:

### Android
- `zmNinjaNg-android-debug-{version}.apk` — Debug-signed APK for sideloading
- `zmNinjaNg-android-debug-{version}.aab` — Debug-signed App Bundle for testing

### macOS
- `zmNinjaNg-{version}-macos-aarch64.dmg` — Electron DMG (signed + notarized when secrets are set)

### Linux
- `zmNinjaNg-{version}-linux-{arch}.AppImage` — Universal AppImage
- `zmNinjaNg-{version}-linux-{arch}.deb` — Debian package
- `zmNinjaNg-{version}-linux-{arch}.rpm` — RPM package

### Windows
- `zmNinjaNg-{version}-windows-x64-setup.exe` — Electron NSIS installer

## Customizing Release Notes

Release notes are automatically generated from commit messages, but you can add custom content:

1. Edit `_RELEASE_NOTE_INSERT.md` in the `.github/workflows/` directory
2. Add installation instructions, warnings, or any other information
3. Commit and push the changes
4. The next release will include your custom notes at the top

The file uses Markdown format and will appear above the auto-generated commit history.

## Build Requirements

### Required: GitHub Actions Permissions

For automated releases to work, you must enable write permissions:

1. Go to repository **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions**
3. Select **"Read and write permissions"**
4. Click **Save**

Without this, you'll get 403 errors when trying to create releases.

### Android
- No additional secrets required
- Builds debug-signed APK and AAB by default
- For release signing, configure signing in `app/android/app/build.gradle`

### Desktop Platforms (macOS, Linux, Windows)
- Uses Electron + electron-builder for desktop builds
- **All builds are unsigned by default** (no secrets required)
- macOS will require users to bypass security warnings unless signed (see below)
- **Optional macOS code signing + notarization** (to avoid the "damaged" error):
  - `APPLE_CERTIFICATE` — Base64-encoded .p12 certificate
  - `APPLE_CERTIFICATE_PASSWORD` — Certificate password
  - `APPLE_ID` — Apple ID email
  - `APPLE_PASSWORD` — App-specific password
  - `APPLE_TEAM_ID` — Team ID from Apple Developer account

## Firebase Configuration

**Important**: Ensure `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) are properly configured in your repository for push notifications to work.

See `ANDROID_BUILD.md` for Firebase setup instructions.

## Customization

### Changing Build Settings

- **Android**: Edit `app/android/app/build.gradle`
- **Desktop**: Edit `app/electron-builder.json` and the Electron main process at `app/electron/`

### Adding Code Signing

**Android**: Add signing configuration to gradle
**macOS**: Set up Apple Developer certificates (see the macOS section below)
**Windows**: Configure code signing certificate via electron-builder

## macOS "Damaged" App Error

If you get a **"zmNinjaNg.app is damaged and can't be opened"** error, this is because the app is not signed/notarized. You have two options:

### Option 1: Bypass Security
Use [Sentinel](https://github.com/alienator88/Sentinel)

### Option 2: Set Up Code Signing (Recommended for Distribution)

To produce properly signed and notarized builds:

1. **Get Apple Developer Account** ($99/year)

2. **Create Developer ID Certificate**:
   - Go to Apple Developer Portal → Certificates
   - Create "Developer ID Application" certificate
   - Download and install in Keychain

3. **Export Certificate**:
   ```bash
   # Export from Keychain as .p12, then convert to base64
   base64 -i certificate.p12 | pbcopy
   ```

4. **Create App-Specific Password**:
   - Go to appleid.apple.com
   - Sign In → Security → App-Specific Passwords
   - Generate password for "GitHub Actions"

5. **Add GitHub Secrets**:
   - Go to repository Settings → Secrets → Actions
   - Add the following secrets:
     - `APPLE_CERTIFICATE`: Paste base64 certificate
     - `APPLE_CERTIFICATE_PASSWORD`: Certificate password
     - `APPLE_ID`: Your Apple ID email
     - `APPLE_PASSWORD`: App-specific password
     - `APPLE_TEAM_ID`: Team ID from developer portal

6. **Re-run Workflow** — The app will now be signed and notarized

## Troubleshooting

### Build Fails

Check the Actions tab for detailed error logs. Common issues:

- **Missing dependencies**: Check the Node.js version
- **Build errors**: Ensure local builds work first
- **Artifact upload fails**: Check file paths match the build output

### Android Build Issues

- Ensure `google-services.json` exists at `app/android/app/google-services.json`
- Verify Java 17 is being used
- Check Gradle version compatibility

### Desktop Build Issues

- Confirm Electron and electron-builder versions in `app/package.json`
- Check `app/electron-builder.json` for the target platform
- Verify all platform-specific dependencies are installed (e.g., `rpm` on Linux runners for RPM packaging)

## Local Testing

Before pushing, test builds locally:

```bash
# Android
cd app
npm run android:release

# Desktop (macOS / Linux / Windows)
cd app
npm run electron:build
```

## More Information

- [Capacitor Android Documentation](https://capacitorjs.com/docs/android)
- [electron-builder Documentation](https://www.electron.build/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
