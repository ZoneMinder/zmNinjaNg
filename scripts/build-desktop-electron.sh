#!/bin/bash
set -euo pipefail

# Build the Electron desktop DMG. By default the app is signed with the
# Developer ID and notarized when APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID are
# present. Pass --nosign for an unsigned build.

NOSIGN=0
[ "${1:-}" = "--nosign" ] && NOSIGN=1
[ "${NOSIGN_BUILD:-0}" = "1" ] && NOSIGN=1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../app" && pwd)"
cd "$APP_DIR"

# Shared default signing identity (overridable via APPLE_SIGNING_IDENTITY).
DEFAULT_IDENTITY="Developer ID Application: ZoneMinder Inc (P97TSUFFDX)"

# electron-builder reads CSC_* for signing and APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD
# for notarization, so map the shared APPLE_* vars onto the names it expects.
NOTARIZE_ARG=""
if [ "$NOSIGN" = "1" ]; then
  echo "=== nosign: unsigned build (no codesign, no notarization) ==="
  export CSC_IDENTITY_AUTO_DISCOVERY=false
else
  IDENTITY="${APPLE_SIGNING_IDENTITY:-$DEFAULT_IDENTITY}"
  # electron-builder's CSC_NAME wants the bare certificate name, without the
  # "Developer ID Application:" prefix that APPLE_SIGNING_IDENTITY carries.
  export CSC_NAME="${IDENTITY#Developer ID Application: }"
  echo "=== signing identity: $IDENTITY ==="
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    export APPLE_APP_SPECIFIC_PASSWORD="$APPLE_PASSWORD"
    NOTARIZE_ARG="-c.mac.notarize=true"
    echo "    notarization: enabled"
  else
    echo "    notarization: skipped (set APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID to enable)"
  fi
fi

# Clean the output dir before the build starts (keep the tracked .gitkeep).
OUTPUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/desktop_release_builds/electron"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
touch "$OUTPUT_DIR/.gitkeep"

npm run build
if [ -n "$NOTARIZE_ARG" ]; then
  npx electron-builder --config electron-builder.json "$NOTARIZE_ARG"
else
  npx electron-builder --config electron-builder.json
fi
