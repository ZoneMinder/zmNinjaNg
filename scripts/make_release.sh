#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

PKG_JSON="app/package.json"
SYNC_SCRIPT="scripts/sync-version.js"

SKIP_E2E=false
for arg in "$@"; do
    case "$arg" in
        --skip-e2e) SKIP_E2E=true ;;
        *) echo "Unknown option: $arg"; echo "Usage: $0 [--skip-e2e]"; exit 1 ;;
    esac
done

# --- Read version ---
get_version() {
  if [ -f "$PKG_JSON" ]; then
    grep '"version":' "$PKG_JSON" | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g'
  else
    echo "NONE"
  fi
}

# --- Update version in package.json, then sync to platform configs ---
set_version() {
    local new_ver="$1"
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${new_ver}\"/" "$PKG_JSON"
    node "$SYNC_SCRIPT"
}

VERSION=$(get_version)
if [[ "$VERSION" == "NONE" ]]; then
    echo "$PKG_JSON not found. Run ./scripts/make_release.sh from the project root."
    exit 1
fi

TAG="zmNinjaNg-$VERSION"

echo "==================================================="
echo "   zmNinjaNg Release Script"
echo "==================================================="
echo "Detected Version: $VERSION"
echo "Target Tag:       $TAG"
echo "==================================================="
echo ""

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# --- Step 1: Check if tag already exists ---
TAG_EXISTS=false
if git rev-parse "$TAG" >/dev/null 2>&1; then
    TAG_EXISTS=true
fi
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    TAG_EXISTS=true
fi

# Draft cache shared between the bump suggestion below and the developer-notice
# step later, so Claude is called at most once per release. Cleaned up on exit.
RELEASE_DRAFT_CACHE="$(mktemp -t zmninja-release-draft.XXXXXX)"
DRAFT_CACHE_VALID=false
OVERWRITE_TAG=false
cleanup() { rm -f "$RELEASE_DRAFT_CACHE"; }
trap cleanup EXIT

# Commit and push a version bump, then update VERSION/TAG for the rest of the run.
apply_bump() {
    local new_ver="$1"
    echo ""
    echo "Bumping version: $VERSION -> $new_ver"
    set_version "$new_ver"
    VERSION="$new_ver"
    TAG="zmNinjaNg-$VERSION"
    git add "$PKG_JSON" app/ios/App/App.xcodeproj/project.pbxproj app/android/app/build.gradle
    git commit -m "chore: bump version to $VERSION"
    git push origin "$CURRENT_BRANCH"
    echo "✅ Version bumped to $VERSION, committed and pushed"
    echo ""
}

# Every release chooses its version here, whether or not $TAG already exists.
# Deterministic bump targets for the menu (also the fallback when Claude is unavailable).
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f2)
PATCH=$(echo "$VERSION" | cut -d. -f3)
V_PATCH="${MAJOR}.${MINOR}.$((PATCH + 1))"
V_MINOR="${MAJOR}.$((MINOR + 1)).0"
V_MAJOR="$((MAJOR + 1)).0.0"

if [ "$TAG_EXISTS" = true ]; then
    echo "⚠️  Tag '$TAG' already exists. You likely want a new version."
else
    echo "Current version is $VERSION; tag '$TAG' does not exist yet."
fi
echo ""
echo "Analyzing closed issues to recommend a bump (one Claude call, closed-issue based)..."

# --plan is best-effort: it always exits 0. Human progress prints to stderr
# (visible); the KEY=VALUE result lines print to stdout (captured here).
PLAN_OUT="$(node scripts/generate_notice.mjs --plan --version "$VERSION" --cache "$RELEASE_DRAFT_CACHE")" || true
REC_BUMP="$(printf '%s\n' "$PLAN_OUT" | sed -n 's/^RECOMMENDED_BUMP=//p' | tail -1)"
SUGGESTED_VERSION="$(printf '%s\n' "$PLAN_OUT" | sed -n 's/^SUGGESTED_VERSION=//p' | tail -1)"

if [ -n "$REC_BUMP" ] && [ -n "$SUGGESTED_VERSION" ]; then
    DRAFT_CACHE_VALID=true
    echo ""
    echo "🤖 Claude recommends a ${REC_BUMP} release: $VERSION -> ${SUGGESTED_VERSION}"
else
    REC_BUMP="patch"
    SUGGESTED_VERSION="$V_PATCH"
    echo ""
    echo "ℹ️  No Claude suggestion available. Defaulting to a patch bump; you can still choose below."
fi

echo ""
echo "How should this release be versioned?"
echo "  1) Suggested: ${REC_BUMP} -> ${SUGGESTED_VERSION}"
echo "  2) patch      -> ${V_PATCH}"
echo "  3) minor      -> ${V_MINOR}"
echo "  4) major      -> ${V_MAJOR}"
echo "  5) Enter a version manually"
if [ "$TAG_EXISTS" = true ]; then
    echo "  6) Move existing tag to current commit (no bump, overwrite)"
else
    echo "  6) Release $VERSION as-is (no bump)"
fi
read -p "Choose [1-6] or anything else to abort: " choice
case "$choice" in
    1) apply_bump "$SUGGESTED_VERSION" ;;
    2) apply_bump "$V_PATCH" ;;
    3) apply_bump "$V_MINOR" ;;
    4) apply_bump "$V_MAJOR" ;;
    5)
        read -p "New version (X.Y.Z): " manual_ver
        if ! printf '%s' "$manual_ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
            echo "❌ '$manual_ver' is not a valid X.Y.Z version. Aborting."
            exit 1
        fi
        apply_bump "$manual_ver"
        ;;
    6)
        if [ "$TAG_EXISTS" = true ]; then
            echo ""
            echo "Will move tag '$TAG' to current commit."
            OVERWRITE_TAG=true
            echo ""
        fi
        ;;
    *)
        echo "Aborted."
        exit 0
        ;;
esac

# --- Step 2: Check for uncommitted changes ---
DIRTY_FILES=$(git status --porcelain)
if [ -n "$DIRTY_FILES" ]; then
    echo "❌ Error: You have uncommitted changes in your working directory."
    echo ""
    git status --short
    echo ""
    echo "Please commit or stash your changes before creating a release."
    exit 1
fi

# Check if branch has an upstream
if ! git rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
    echo "❌ Error: Current branch '$CURRENT_BRANCH' has no upstream branch."
    echo ""
    echo "Please push your branch first:"
    echo "  git push -u origin $CURRENT_BRANCH"
    echo ""
    exit 1
fi

# Check for unpushed commits
UNPUSHED=$(git rev-list @{u}..HEAD --count)
if [[ "$UNPUSHED" -gt 0 ]]; then
    echo "❌ Error: You have $UNPUSHED unpushed commit(s) on branch '$CURRENT_BRANCH'."
    echo ""
    echo "Please push your commits before creating a release:"
    echo "  git push origin $CURRENT_BRANCH"
    echo ""
    exit 1
fi

echo "✅ Working directory is clean"
echo "✅ All commits are pushed to origin"
echo ""

# --- Gate: browser e2e ---
# Nothing runs this suite automatically. CI's e2e job ends green without
# running: it needs ZM_HOST_1/ZM_USER_1/ZM_PASSWORD_1, no such secret is set,
# and the test server is on a private LAN a hosted runner cannot reach. So a
# release is the last point where a broken user journey is still catchable.
# One scenario stayed red for two weeks before this existed.
#
# It is a prompt rather than an unconditional run because it is slow: 168
# scenarios, serial, about 18 minutes, and roughly 45% of that is the app
# booting under the Vite dev server once per scenario. A gate that always
# costs 18 minutes gets routed around; one that asks gets answered.
run_e2e() {
    if [ ! -f "app/.env" ]; then
        echo "❌ Error: app/.env not found, so the e2e suite has no server to drive."
        echo ""
        echo "Create it from app/.env.example with ZM_HOST_1, ZM_USER_1 and"
        echo "ZM_PASSWORD_1, or answer 'n' to release without the gate."
        echo ""
        return 1
    fi

    echo "🧪 Running browser e2e against the server in app/.env..."
    echo "   168 scenarios, serial. Roughly 18 minutes."
    echo ""
    if npm run test:e2e; then
        echo ""
        echo "✅ Browser e2e passed"
        echo ""
        return 0
    fi

    echo ""
    echo "❌ Browser e2e failed. Not tagging $TAG."
    echo ""
    echo "Fix the failures, or re-run and answer 'n' if the test server itself"
    echo "is down rather than the app being broken."
    echo ""
    return 1
}

warn_no_e2e() {
    echo "⚠️  Skipping browser e2e."
    echo "   Nothing else runs these journeys: CI's e2e job reports green"
    echo "   without executing them. A regression in them ships."
    echo ""
}

if [ "$SKIP_E2E" = "true" ]; then
    warn_no_e2e
elif [ ! -t 0 ]; then
    # No terminal to ask on. Run it rather than silently skipping the only
    # thing that covers these journeys.
    run_e2e || exit 1
else
    echo "The browser e2e suite takes about 18 minutes and is the only"
    echo "automated cover these user journeys get."
    # Every run writes app/.e2e-last-run.json (Playwright's json reporter).
    # Recommend a run when that is missing, red, or older than two weeks.
    E2E_MAX_AGE_DAYS=14
    if [ -f app/.e2e-last-run.json ]; then
        E2E_LAST=$(node -e '
            const s = require("./app/.e2e-last-run.json").stats || {};
            const days = Math.floor((Date.now() - new Date(s.startTime)) / 864e5);
            const red = (s.unexpected || 0) > 0;
            console.log(`${days} ${red ? "red" : "green"} ${s.expected || 0} ${s.unexpected || 0}`);
        ' 2>/dev/null)
        read -r E2E_AGE E2E_RESULT E2E_PASSED E2E_FAILED <<< "$E2E_LAST"
        if [ -z "$E2E_AGE" ]; then
            echo "⚠️  app/.e2e-last-run.json is unreadable; treating e2e as never run."
        elif [ "$E2E_RESULT" = "red" ]; then
            echo "⚠️  Last e2e run was $E2E_AGE day(s) ago and FAILED ($E2E_FAILED failed, $E2E_PASSED passed)."
            echo "   Recommended: run it now."
        elif [ "$E2E_AGE" -gt "$E2E_MAX_AGE_DAYS" ]; then
            echo "⚠️  Last e2e run was $E2E_AGE days ago (passed, $E2E_PASSED scenarios)."
            echo "   That is older than $E2E_MAX_AGE_DAYS days. Recommended: run it now."
        else
            echo "ℹ️  Last e2e run was $E2E_AGE day(s) ago and passed ($E2E_PASSED scenarios)."
        fi
    else
        echo "⚠️  No record of an e2e run on this machine. Recommended: run it now."
    fi
    read -p "Run it before tagging $TAG? [Y/n] " -r
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        warn_no_e2e
    else
        run_e2e || exit 1
    fi
fi

# --- Confirm before proceeding ---
REMOTE_URL=$(git remote get-url origin)
echo "--- Release summary ---"
echo "  Version:  $VERSION"
echo "  Tag:      $TAG"
echo "  Branch:   $CURRENT_BRANCH"
echo "  Remote:   $REMOTE_URL"
echo ""
echo "This will:"
echo "  1. Generate CHANGELOG.md"
echo "  2. Create and push git tag '$TAG'"
echo "  3. Trigger GitHub Actions to build and create release"
echo ""
read -p "Proceed? [y/N] " -r
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# --- Step 3: Generate changelog ---
if [ -f "Gemfile" ] && command -v bundle &> /dev/null; then
    echo ""
    echo "📋 Generating CHANGELOG.md..."
    if CHANGELOG_GITHUB_TOKEN=$(gh auth token 2>/dev/null) bundle exec github_changelog_generator --future-release "$TAG"; then
        if [[ -n $(git diff --name-only CHANGELOG.md 2>/dev/null) ]] || [[ -n $(git ls-files --others --exclude-standard CHANGELOG.md 2>/dev/null) ]]; then
            echo "📝 CHANGELOG.md updated, committing..."
            git add CHANGELOG.md
            git commit -m "chore: update CHANGELOG.md for $TAG"
            git push origin "$CURRENT_BRANCH"
            echo "✅ CHANGELOG.md committed and pushed"
        else
            echo "ℹ️  CHANGELOG.md unchanged"
        fi
    else
        echo "❌ Changelog generation failed"
        exit 1
    fi
else
    echo ""
    echo "❌ Gemfile or bundler not found"
    echo "   Run: bundle install"
    exit 1
fi

# --- Step 3.5: Developer notice (minor/major releases only) ---
# Offer a notice only for minor/major releases (patch = 0) that don't already
# have one. When the bump step above already ran --plan, reuse that cached draft
# so Claude is not called a second time; otherwise generate_notice makes its own
# call. It halts the release on any failure (no error guard): a missing tool or
# unparseable draft must stop the release, not ship silently.
NOTICE_PATCH=$(echo "$VERSION" | cut -d. -f3)
if [ "$NOTICE_PATCH" = "0" ] && ! grep -qF "\"release-$VERSION\"" docs/notices.json 2>/dev/null; then
    echo ""
    read -p "Generate a developer notice for $VERSION? [y/N] " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ "$DRAFT_CACHE_VALID" = true ] && [ -s "$RELEASE_DRAFT_CACHE" ]; then
            echo "Reusing the draft Claude already produced for the bump (no second Claude call)."
            node scripts/generate_notice.mjs --write --version "$VERSION" --cache "$RELEASE_DRAFT_CACHE"
        else
            node scripts/generate_notice.mjs "$VERSION"
        fi
        # generate_notice only writes docs/notices.json; commit and push it so
        # the release ships the notice (the feed is served from this branch).
        if [[ -n $(git status --porcelain docs/notices.json) ]]; then
            git add docs/notices.json
            git commit -m "chore: add release notice for $VERSION"
            git push origin "$CURRENT_BRANCH"
        fi
    fi
fi

# --- Step 4: Tag ---
if [ "$OVERWRITE_TAG" = true ]; then
    echo ""
    echo "Removing existing tag $TAG..."
    git tag -d "$TAG" 2>/dev/null || true
    git push origin --delete "$TAG" 2>/dev/null || true
fi

echo ""
echo "Creating tag $TAG..."
git tag "$TAG"

echo "Pushing tag to origin..."
git push origin "$TAG" --force

# --- Step 5: store uploads ---
# After the tag for two reasons. The iOS build number is the git commit count,
# so the archive has to happen at the commit that shipped; and the Android
# bundle is built by the workflow this tag just started, so there is nothing to
# publish until that finishes. Both scripts run standalone, so a release can be
# tagged now and published later.
HAVE_IOS=false
HAVE_ANDROID=false
compgen -G "$HOME/.appstoreconnect/private_keys/AuthKey_*.p8" >/dev/null && HAVE_IOS=true
[ -f "$HOME/.playconsole/service-account.json" ] && HAVE_ANDROID=true

if [ "$HAVE_IOS" = true ] || [ "$HAVE_ANDROID" = true ]; then
    echo ""
    echo "Mobile store uploads:"
    [ "$HAVE_IOS" = true ] \
        && echo "  iOS      archive here and upload to App Store Connect (about 15 minutes)" \
        || echo "  iOS      skipped, no App Store Connect key installed"
    [ "$HAVE_ANDROID" = true ] \
        && echo "  Android  wait for the CI build, then upload the bundle to Google Play" \
        || echo "  Android  skipped, no Play service account key installed"
    echo ""
    echo "Both land as drafts. Nothing reaches users without a further click."
    read -p "Automatically upload mobile builds? [y/N] " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # iOS first: it works offline of CI, so the Android wait overlaps the
        # workflow that is already running.
        [ "$HAVE_IOS" = true ] && ./scripts/upload-ios.sh
        [ "$HAVE_ANDROID" = true ] && ./scripts/upload-android.sh "$VERSION"
    fi
else
    echo ""
    echo "ℹ️  Skipping the mobile uploads: no store credentials are installed."
    echo "   See docs/building/IOS.rst and docs/building/ANDROID.rst."
fi

echo ""
echo "✅ Release triggered! Check GitHub Actions for progress."
echo "   https://github.com/ZoneMinder/zmNinjaNg/actions"
echo ""
echo "The create-release workflow will:"
echo "  - Generate release notes with changelog"
echo "  - Create the GitHub Release"
echo "  - Build workflows will attach platform binaries"
