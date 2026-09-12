#!/bin/bash
set -e

# Print the -exportArchive options for an App Store upload.
#
# Generated rather than committed so the signing team has one home. It lives in
# App.xcodeproj, where Xcode writes it, and a fork signing with its own Apple
# account changes it there and nowhere else.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PBXPROJ="$SCRIPT_DIR/../app/ios/App/App.xcodeproj/project.pbxproj"

TEAM=$(grep -o 'DEVELOPMENT_TEAM = [A-Z0-9]*;' "$PBXPROJ" | head -1 | sed 's/[^=]*= //; s/;//')
if [ -z "$TEAM" ]; then
    echo "No DEVELOPMENT_TEAM in $PBXPROJ. Set the team in Xcode under Signing & Capabilities." >&2
    exit 1
fi

cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<!-- Distribution build for the App Store. -->
	<key>method</key>
	<string>app-store-connect</string>
	<!-- Send the archive to App Store Connect instead of writing an .ipa to
	     disk. Without this, -exportArchive exits 0 having uploaded nothing. -->
	<key>destination</key>
	<string>upload</string>
	<key>teamID</key>
	<string>$TEAM</string>
	<!-- The project signs automatically, so xcodebuild -allowProvisioningUpdates
	     creates and renews the profiles for the app and the ImageNotify
	     extension rather than us storing them. -->
	<key>signingStyle</key>
	<string>automatic</string>
	<!-- dSYMs, so App Store Connect can symbolicate crash reports. -->
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
PLIST
