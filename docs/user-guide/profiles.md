# Profiles

Profiles store connection details for your ZoneMinder servers. You can create multiple profiles to switch between different servers or accounts.

## Adding a Profile

1. Open zmNinjaNg, if no profile exists, you'll land on the Profiles screen
2. Tap **Add Profile**
3. Fill in the connection details:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | A label for this profile | "Home Cameras" |
| **Portal URL** | Your ZoneMinder server URL | `https://zm.example.com/zm` |
| **Username** | ZoneMinder login username | `admin` |
| **Password** | ZoneMinder login password | |

4. Tap **Test Connection** to verify the credentials and API access
5. Tap **Save**

:::{tip}
The Portal URL should point to the base ZoneMinder web path, typically ending in `/zm`. zmNinjaNg will auto-discover the API endpoint from there.
:::

## QR Code Import

When adding a profile, tap the **Scan QR Code** button to populate the form by scanning a QR code that contains profile data. This avoids retyping the URL, username, and password on a new device.

The profile data (including password) is transferred via the QR code. No data is sent over the network during this process.

## Switching Profiles

If you have multiple profiles, tap on a profile card to switch to it. The app will reconnect to the selected server.

## Virtual Profile Groups

A virtual profile group is a named set of servers you view together. Switch into a group and the app pulls from every server in it at once instead of a single one.

Once you have two or more profiles that aren't disabled, a **New Virtual Profile Group** button appears at the end of the profile list. Give the group a name and tick the servers it holds; the dialog notes that aggregating several servers can be resource-heavy. A group needs at least one server, and its name has to be free: no other group and no profile can already be using it, since both appear side by side in the profile switcher. Groups can only hold profiles, never other groups. Dropping back below two enabled profiles removes the button, since there is nothing left to combine.

Each group gets its own card at the end of the profile list, showing how many servers it holds. **Details** on the card lists the address of each server the group pulls from. Switch into the group with its **Switch** button, the same as a profile row; edit and delete live in the card's ⋮ menu. A group whose servers are all disabled or deleted offers no Switch at all, since it would land on empty screens; the menu keeps working, which is the only way out of that state. The profile switcher lists groups after the profiles, behind the same two-enabled-profiles rule as the button.

A group aggregates Monitors, Montage, Events (including its montage/grid view), Timeline, Dashboard, and Live Activity. The Monitors and Montage screens show every camera from every server in the group, and each card or tile carries a chip naming the server it came from; Montage caps the total number of live streams it opens at once, so a large combined camera count doesn't try to open every stream from every server simultaneously. A group-by-server toggle at the top of Monitors groups the cards by server instead of one flat list, and Events has the same toggle for its list and its grid. Events and Timeline merge the group's history into one list, grid, or canvas, sorted by actual time across servers in different timezones, and each event carries the same server chip. If a server is unreachable while others respond, its data is skipped and an error strip with a retry button appears for it; data from every reachable server still shows. Tapping a monitor or event opens its detail directly, without switching the active profile first, and a push notification for any known server's event opens straight to that event the same way. The notification bell badge and its history sum the group's own unread counts and events. The app also remembers the last page you were on separately for each group and each profile, so switching into a group returns you to wherever you last left it there, not wherever the profile you switched from was showing.

Live Activity aggregates the same way: every member's watched monitors feed the same alarm grid, each tile carrying its server chip. The total number of monitors watched at once across the group is capped, drawn evenly round-robin from each member so one busy server can't crowd the rest out; hitting the cap shows an overflow line reporting how many monitors aren't being watched. The page's poll interval, dwell time, and tile count stay one group-wide setting, same as its other preferences, but which monitors to watch is still a per-server list - the settings dialog's ignore-list section gets its own profile picker while aggregating so you can edit one server's watch list at a time.

Screens that are inherently tied to one server - Logs, Server, Notification settings, and the server-scoped part of Settings - show a profile picker instead: pick which server's data that screen displays, defaulting to the first profile in scope. The AI assistant works the same way: in a group it pins itself to one profile (shown in a banner above the chat, with its own picker to change it), since an answer about "the front door" is meaningless without knowing which server it came from.

Notification Settings adds more than just the picker while aggregating: an overview lists every member's own notification mode and live connection status, since each server keeps its own configuration and there's no shared config to edit. A single notifications setting, named after the group, controls the aggregate connections themselves: **Live** connects every member and shows toasts and sound as they arrive; **Muted** keeps every member connected and keeps the badge and history updating, but suppresses toasts and sound; **Off** doesn't connect any member while aggregating, so nothing updates until you switch it back. In Live or Muted mode, events arriving close together from different servers coalesce into one summary toast instead of one per event, and toast and sound behavior still honors each server's own settings underneath that. On mobile, push notifications are unaffected - Firebase Cloud Messaging already delivers every profile's events regardless of which one is active, so a group doesn't open extra connections there.

Preferences are two-tier: a group has its own settings (grid layout, feed fit, and so on), kept separate from each individual profile's settings. A change made while in a group does not touch any single profile's settings, and vice versa. This covers what you are looking at rather than how a server is reached, so while aggregating, one analysis-frames setting governs every tile no matter which server it came from. Timeouts, ports and other connection settings still belong to each server.

Streaming Mode gets a third option while aggregating. A Streaming Mode row named after the group appears at the top of Settings, above the per-server picker: leave it on **Per server** and each server's tiles keep following that server's own Streaming Mode, or pick **Streaming** or **Snapshot** to impose one choice on every tile in the group. Per server is the default, so switching into a group never changes how anything streams until you ask it to.

Disabling a member profile drops it out of the group for as long as it stays disabled; re-enabling it brings it back. Deleting a profile removes it from every group that held it.

A group can end up with nothing left to combine, if every server in it is disabled. It cannot be switched to in that state, since it would only show you empty screens, and its card says so in place of the server count. The card's ⋮ menu keeps working, so you can add a server back to the group, or remove the group.

Every group keeps its own settings, and nothing is shared between them. Set one group's Streaming Mode to **Streaming** and every other group stays on whatever you left it on. Which servers you can pick from a screen's profile picker follows the group too, since those pickers list the servers in scope.

The notification bell follows the same scope. While a group is current, its badge counts and its history list only the group's own servers; a server outside the group keeps receiving and storing its notifications, but you will not see them until you switch to a profile or group that includes it.

Deleting a group deletes the group and the settings it accumulated. The servers in it are not touched, and the confirmation says so. If you delete the group you are currently using, no profile is selected afterwards, so pick one from the Profiles screen.

## Editing a Profile

Choose **Edit** from a profile card's ⋮ menu to modify the connection details. You can change the URL, credentials, or display name.

Each profile card keeps its portal, API, and streaming addresses behind
**Details**. They are set once and only matter when something is wrong,
so the card leads with the name, the badges, and the buttons instead.

## Disabling a Profile

Choose **Disable** from a profile card's ⋮ menu to switch it off without deleting it. A disabled profile stays listed, greyed out with a **Disabled** badge, but can't be switched to and drops out of every group that holds it, including the count that decides whether a new group can be made at all. Choose **Enable** from the same menu to bring it back.

## Deleting a Profile

Choose **Delete** from a profile card's ⋮ menu. You'll be asked to confirm before the profile is removed. The last remaining profile offers no Delete, since the app would have no server left to talk to.

**Delete all profiles** lives in the ⋮ menu beside **Add Profile**, away from the buttons you reach for daily.

## Security

Passwords are encrypted at rest:

- **Web/Desktop**: AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- **Android**: Hardware-backed encryption via Android Keystore
- **iOS**: Keychain storage

Passwords are never stored in plaintext.

## Troubleshooting

**"Connection failed"**
- Verify the Portal URL is correct and accessible from your device
- Check that ZoneMinder API is enabled (`OPT_USE_API = 1` in ZoneMinder options)
- If using a self-signed certificate, enable **Allow self-signed certificates** in Settings > Advanced (or toggle it when adding the profile)
- On Android, if only the LAN address fails while a remote URL works, the device may be withholding local network permission, see {doc}`faq`

**"Authentication failed"**
- Verify username and password
- Check that the user has API access permissions in ZoneMinder
