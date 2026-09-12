#!/bin/bash
set -e

# Upload the Android release to Google Play.
#
# Unlike iOS, the bundle is not built here. Pushing a release tag starts the
# Build Android Release workflow, which signs the AAB with the keystore held as
# a repository secret and attaches it to the GitHub release. Rebuilding it
# locally would mean a second signing key on this machine and a bundle that
# never went through CI, so this waits for that one and publishes it.
#
# Waiting is the cost of that choice: the workflow takes a few minutes, and
# this polls the release until the AAB appears.
#
# Run it for any past release by naming the version:
#   ./scripts/upload-android.sh 2.4.0
# With no argument it uses the version in app/package.json.
#
# Credentials: a Play service account key at ~/.playconsole/service-account.json,
# outside the repository. See docs/building/ANDROID.rst.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

VERSION="${1:-$(grep '"version":' app/package.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')}"
TAG="zmNinjaNg-$VERSION"
ASSET="zmNinjaNg-${VERSION}-android.aab"

# gh cannot pick a repository on its own when a checkout has more than one
# remote, so name it rather than depending on a configured default.
REPO=$(git remote get-url origin | sed -E 's#.*github\.com[:/]##; s#\.git$##')

KEY_PATH="$HOME/.playconsole/service-account.json"
if [ ! -f "$KEY_PATH" ]; then
    echo "❌ No Play service account key at $KEY_PATH"
    echo ""
    echo "See docs/building/ANDROID.rst for how to create one."
    exit 1
fi

# The workflow takes a few minutes from a cold runner. Twenty is slack, not an
# estimate; a build that has genuinely failed shows up in the Actions tab long
# before this gives up.
DEADLINE=$(( $(date +%s) + 1200 ))
echo "⏳ Waiting for $ASSET on release $TAG..."
while ! gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' 2>/dev/null | grep -qx "$ASSET"; do
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
        echo ""
        echo "❌ $ASSET never appeared on $TAG."
        echo "   Check the Android build: gh run list --workflow=build-android.yml"
        exit 1
    fi
    sleep 30
done
echo "✅ Bundle is on the release."

WORK_DIR="$(mktemp -d -t zmninja-android)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "⬇️  Downloading $ASSET..."
gh release download "$TAG" --repo "$REPO" --pattern "$ASSET" --dir "$WORK_DIR" --clobber

node scripts/publish-play.mjs --aab "$WORK_DIR/$ASSET" --version "$VERSION"
