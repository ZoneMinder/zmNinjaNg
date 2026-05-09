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

## Editing a Profile

Tap the edit icon on a profile card to modify the connection details. You can change the URL, credentials, or display name.

## Deleting a Profile

Tap the delete icon on a profile card. You'll be asked to confirm before the profile is removed.

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

**"Authentication failed"**
- Verify username and password
- Check that the user has API access permissions in ZoneMinder
