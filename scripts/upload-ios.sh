#!/bin/bash
set -e

# Archive the iOS app and upload it to App Store Connect.
#
# This runs on the developer's Mac rather than in CI because signing already
# works here: the Xcode project signs automatically, so the only credential the
# upload needs is an App Store Connect API key. A macOS workflow would instead
# need a distribution certificate exported into a temporary keychain, two more
# repository secrets, and macOS runner minutes billed at ten times the Linux
# rate, all to reproduce a setup this machine already has.
#
# Two files, both outside the repository, both from App Store Connect > Users
# and Access > Integrations:
#   ~/.appstoreconnect/private_keys/AuthKey_<key id>.p8   the downloaded key
#   ~/.appstoreconnect/issuer_id                          the issuer id
# The key id is read from the .p8 filename, so there is nothing else to set.
#
# Uploading does not submit anything for review. The build appears in App Store
# Connect after processing and is then released by hand.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

# The issuer id authenticates nothing on its own: it travels in plaintext
# inside every API token and is inert without the private key. It is kept
# beside the key rather than in the repo anyway, so a public checkout carries
# no identifier for the account that signs the app.
ISSUER_FILE="$HOME/.appstoreconnect/issuer_id"
if [ -z "$ASC_ISSUER_ID" ] && [ -f "$ISSUER_FILE" ]; then
    ASC_ISSUER_ID="$(tr -d '[:space:]' < "$ISSUER_FILE")"
fi
if [ -z "$ASC_ISSUER_ID" ]; then
    echo "❌ No issuer id."
    echo ""
    echo "It is shown above the key list in App Store Connect > Users and"
    echo "Access > Integrations. Save it once:"
    echo "  echo <issuer-id> > $ISSUER_FILE"
    exit 1
fi

# Apple names the key file after the key id, so one installed key needs no
# configuring. Set ASC_KEY_ID to pick when several are installed.
KEY_DIR="$HOME/.appstoreconnect/private_keys"
if [ -z "$ASC_KEY_ID" ]; then
    KEYS=("$KEY_DIR"/AuthKey_*.p8)
    if [ ! -e "${KEYS[0]}" ]; then
        echo "❌ No App Store Connect key in $KEY_DIR"
        echo ""
        echo "Generate one under Users and Access > Integrations > Team Keys,"
        echo "with App Manager access, and save the .p8 there. Apple serves that"
        echo "file once; a lost key is revoked and replaced, never re-fetched."
        exit 1
    fi
    if [ "${#KEYS[@]}" -gt 1 ]; then
        echo "❌ ${#KEYS[@]} keys in $KEY_DIR; set ASC_KEY_ID to choose one:"
        for k in "${KEYS[@]}"; do
            k="${k##*/AuthKey_}"
            echo "  ${k%.p8}"
        done
        exit 1
    fi
    ASC_KEY_ID="$(basename "${KEYS[0]}" .p8)"
    ASC_KEY_ID="${ASC_KEY_ID#AuthKey_}"
fi

KEY_PATH="$KEY_DIR/AuthKey_${ASC_KEY_ID}.p8"
if [ ! -f "$KEY_PATH" ]; then
    echo "❌ No private key at $KEY_PATH"
    exit 1
fi

echo "🔑 Using App Store Connect key $ASC_KEY_ID"

ARCHIVE_DIR="$(mktemp -d -t zmninja-ios)"
cleanup() { rm -rf "$ARCHIVE_DIR"; }
trap cleanup EXIT
ARCHIVE="$ARCHIVE_DIR/App.xcarchive"

AUTH=(
    -authenticationKeyPath "$KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)

# Writes MARKETING_VERSION and CURRENT_PROJECT_VERSION into the Xcode project,
# builds the web bundle and copies it into the native project. The build number
# is the git commit count, so this must run at the commit being released.
# project.pbxproj is left dirty; that bump is incidental and is not committed.
echo "📦 Syncing version and web assets..."
(cd app && npm run ios:sync)

# An archive resolves the same SPM caches a device build does, so it hits the
# same eviction failure, and there it surfaces only at the end of a long build.
echo "🔧 Checking SPM caches..."
node scripts/fix-ios-caches.mjs

echo "🏗  Archiving (Release)..."
xcodebuild archive \
    -project app/ios/App/App.xcodeproj \
    -scheme App \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -allowProvisioningUpdates \
    "${AUTH[@]}"

echo "🚀 Uploading to App Store Connect..."
scripts/ios-export-options.sh > "$ARCHIVE_DIR/ExportOptions.plist"
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$ARCHIVE_DIR/ExportOptions.plist" \
    -exportPath "$ARCHIVE_DIR/export" \
    -allowProvisioningUpdates \
    "${AUTH[@]}"

VERSION=$(grep '"version":' app/package.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')

# Release notes, from the developer notice this release already wrote. The
# upload carries no notes of its own, so without this the listing keeps the
# previous version's text. Never fatal: the build is already uploaded.
echo ""
echo "📝 Setting What's New from the developer notice..."
ASC_KEY_ID="$ASC_KEY_ID" ASC_ISSUER_ID="$ASC_ISSUER_ID" \
    node scripts/set-whats-new.mjs "$VERSION" \
    || echo "⚠️  What's New not set; fill it in in App Store Connect."

echo ""
echo "✅ Uploaded $VERSION to App Store Connect."
echo "   Processing takes 10-30 minutes. Nothing is submitted for review;"
echo "   release the build from App Store Connect when you are ready."
