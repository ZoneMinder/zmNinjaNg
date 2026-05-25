#!/bin/bash
set -euo pipefail

# Build the .app via Tauri, then create the DMG manually. Tauri's built-in DMG
# step fails on macOS 26 (Tahoe) because com.apple.provenance blocks writes to
# /Volumes mounts. Workaround: mount the writable DMG to /tmp instead.
#
# Signing: by default the .app is signed with the Developer ID and notarized when
# APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID are present. Pass --nosign for an unsigned
# build. The Electron build (build-desktop-electron.sh) signs the same way using
# the same identity and env vars.

NOSIGN=0
[ "${1:-}" = "--nosign" ] && NOSIGN=1
[ "${NOSIGN_BUILD:-0}" = "1" ] && NOSIGN=1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../app" && pwd)"
cd "$APP_DIR"

# Shared default signing identity (overridable via APPLE_SIGNING_IDENTITY).
DEFAULT_IDENTITY="Developer ID Application: ZoneMinder Inc (P97TSUFFDX)"
if [ "$NOSIGN" = "1" ]; then
  echo "=== nosign: unsigned build (no codesign, no notarization) ==="
  unset APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
else
  export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-$DEFAULT_IDENTITY}"
  echo "=== signing identity: $APPLE_SIGNING_IDENTITY ==="
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "    notarization: enabled"
  else
    echo "    notarization: skipped (set APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID to enable)"
  fi
fi

# Read version from tauri.conf.json
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
PRODUCT="zmNinjaNg"
# Match Tauri's naming convention (aarch64 instead of arm64)
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] && ARCH="aarch64"
BUNDLE_DIR="src-tauri/target/release/bundle"
APP_BUNDLE="$BUNDLE_DIR/macos/$PRODUCT.app"
# Per-toolchain release output. The Tauri DMG uses the "_t_" marker; the Electron
# build writes plain-named DMGs into ../electron. Both live under desktop_release_builds/.
OUTPUT_DIR="$ROOT_DIR/desktop_release_builds/tauri"
DMG_OUTPUT="$OUTPUT_DIR/${PRODUCT}_t_${VERSION}_${ARCH}.dmg"
VOLICON="$BUNDLE_DIR/dmg/icon.icns"

echo "=== Building $PRODUCT v$VERSION for $ARCH ==="

# Clean the output dir before the build starts (keep the tracked .gitkeep).
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
touch "$OUTPUT_DIR/.gitkeep"

# Step 1: Build .app bundle only (Tauri signs + notarizes from the APPLE_* env)
echo ""
echo "--- Building .app bundle ---"
npx tauri build --bundles app

if [ ! -d "$APP_BUNDLE" ]; then
  echo "Error: $APP_BUNDLE not found"
  exit 1
fi
echo "--- .app bundle ready: $APP_BUNDLE ---"

# Step 2: Create DMG
echo ""
echo "--- Creating DMG ---"
mkdir -p "$OUTPUT_DIR"

DMG_TEMP="/tmp/dmg_temp_$$.dmg"
MOUNT_POINT=$(mktemp -d)
trap 'hdiutil detach "$MOUNT_POINT" 2>/dev/null; rm -f "$DMG_TEMP"; rmdir "$MOUNT_POINT" 2>/dev/null' EXIT

# Calculate needed size (app size + 20MB overhead)
APP_SIZE_KB=$(du -sk "$APP_BUNDLE" | awk '{print $1}')
DMG_SIZE_MB=$(( (APP_SIZE_KB / 1024) + 20 ))

# Create writable DMG
hdiutil create -size "${DMG_SIZE_MB}m" -volname "$PRODUCT" -fs HFS+ -type UDIF "$DMG_TEMP" -ov
hdiutil attach "$DMG_TEMP" -mountpoint "$MOUNT_POINT" -readwrite -noverify -noautoopen -nobrowse

# Copy .app and create Applications link
cp -R "$APP_BUNDLE" "$MOUNT_POINT/"
ln -s /Applications "$MOUNT_POINT/Applications"

# Copy volume icon if present
if [ -f "$VOLICON" ]; then
  cp "$VOLICON" "$MOUNT_POINT/.VolumeIcon.icns"
  SetFile -c icnC "$MOUNT_POINT/.VolumeIcon.icns" 2>/dev/null || true
  SetFile -a C "$MOUNT_POINT" 2>/dev/null || true
fi

# Set Finder window layout via AppleScript
# Use POSIX path since the volume is mounted to /tmp, not /Volumes
osascript <<APPLESCRIPT
  tell application "Finder"
    set mountFolder to POSIX file "$MOUNT_POINT" as alias
    tell folder mountFolder
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set the bounds of container window to {400, 100, 900, 470}
      set viewOptions to the icon view options of container window
      set arrangement of viewOptions to not arranged
      set icon size of viewOptions to 128
      set position of item "$PRODUCT.app" of container window to {180, 170}
      set position of item "Applications" of container window to {480, 170}
      close
    end tell
  end tell
APPLESCRIPT

sync

# Detach and convert to compressed read-only DMG
hdiutil detach "$MOUNT_POINT"
trap 'rm -f "$DMG_TEMP"; rmdir "$MOUNT_POINT" 2>/dev/null' EXIT

rm -f "$DMG_OUTPUT"
hdiutil convert "$DMG_TEMP" -format UDZO -o "$DMG_OUTPUT"

echo ""
echo "=== DMG ready: $DMG_OUTPUT ==="
