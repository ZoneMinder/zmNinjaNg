# Kiosk Mode

Kiosk mode locks the app so the current view stays live but all navigation and interaction are blocked. Useful for unattended displays — a wall-mounted tablet, a dedicated monitor showing a camera grid, etc.

## Activating Kiosk Mode

There are two places to activate kiosk mode:

- **Sidebar**: a lock icon in the bottom section of the sidebar, next to the insomnia toggle
- **Fullscreen montage toolbar**: a lock icon in the thin top bar that appears in fullscreen montage mode

### First Use — PIN Setup

The first time you tap the lock icon, the app prompts you to set a 4-digit PIN:

1. Enter a 4-digit PIN
2. Enter the same PIN again to confirm
3. The app locks immediately after the PIN is confirmed

On subsequent taps, the app locks immediately without prompting again.

### What Happens When Locked

- The current view continues to update live underneath the lock overlay
- All navigation, taps, and swipes are blocked
- The sidebar collapses on desktop
- The mobile header is hidden
- The Android hardware back button is disabled
- A small unlock button appears in the bottom-right corner
- Insomnia (keep-screen-awake) is automatically enabled while locked, then restored to its previous state when you unlock

## Unlocking

Tap the unlock button (bottom-right corner) to begin unlocking:

1. The app tries biometric authentication first (Touch ID, Face ID, or fingerprint, depending on your device)
2. If biometrics are unavailable or you cancel, a PIN pad appears
3. Enter your 4-digit PIN to unlock

### Rate Limiting

After 5 incorrect PIN attempts, the PIN pad locks for 30 seconds. The remaining cooldown time is shown on screen. Biometric authentication is not affected by the PIN cooldown.

### Keyboard Input

On desktop (macOS, web), you can use keyboard input on the PIN pad:

- **0–9**: enter digits
- **Backspace**: delete the last digit
- **Escape**: cancel (dismiss the PIN pad)

## Managing Your PIN

Go to **Settings > Advanced > Kiosk PIN** to manage the PIN outside of kiosk mode:

| Action | Description |
|--------|-------------|
| **Set PIN** | Appears when no PIN is stored. Prompts for a new 4-digit PIN. |
| **Change PIN** | Requires verifying your current PIN (or biometrics) before setting a new one. |
| **Clear PIN** | Removes the PIN. Requires verifying the current PIN (or biometrics) first. |

:::{note}
If you clear the PIN, the next time you tap the lock icon the app will prompt you to set a new one before locking.
:::

## Platform Support

Kiosk mode works on iOS, Android, macOS (Tauri desktop app), and the web browser.
