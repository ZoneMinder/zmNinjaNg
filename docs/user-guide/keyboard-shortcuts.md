# Keyboard Shortcuts

On desktop and the web you can move around with the keyboard. Press `?` at any
time to see this list in the app, or, if the Assistant is enabled (see
{doc}`assistant`), to open it instead.

Shortcuts are ignored while you are typing in a text field, when a modifier key
(Ctrl, Cmd, Alt) is held, or when the kiosk lock is on. TV mode turns them off
only on an actual TV or set-top box, where the remote's d-pad drives navigation
instead. On a desktop or laptop the shortcuts keep working even with TV mode on.

## Navigation

```{figure} ../_static/img/screens/keyboard-shortcuts/help.jpg
:align: center
:width: 512px
:alt: The Keyboard shortcuts dialog listing each key and the page it opens

The shortcuts list shown by pressing ?
```

Press a single key to jump to a section:

| Key | Goes to |
|-----|---------|
| `d` | Dashboard |
| `a` | Live Activity |
| `m` | Montage |
| `e` | Events |
| `v` | Monitors |
| `t` | Timeline |
| `n` | Notifications |
| `l` | Logs |
| `g` | Settings |
| `p` | Profiles |
| `r` | Server |

## Command palette

```{figure} ../_static/img/screens/keyboard-shortcuts/palette.jpg
:align: center
:width: 512px
:alt: The Jump to palette with a search box and a list of pages, each with its shortcut key

The Jump to palette
```

Open the "Jump to" palette in any of three ways: press `/` (desktop/web), tap
the command icon in the top bar (phone), or use the "Jump to" button in the
sidebar. Type to filter, then press `Enter` or tap a result. Use the up and down
arrows to move the highlight. You can jump to any app page, to a monitor by name
or ID, or to a monitor group. On a phone this is the quick way to navigate,
since the letter keys need a hardware keyboard.

In a {doc}`profiles` group the palette lists monitors from every server in it,
and each monitor row names the server it belongs to - two servers can
easily have a camera with the same name or the same ID, so the label is how you
tell them apart. Opening one stays in the group. Monitor groups are not
listed while aggregating: they belong to a single server, and there is no
combined view of them.

## Open a monitor by ID

Type a monitor's ID to open its live view. The number is the ZoneMinder monitor
ID (the same ID ZoneMinder shows for the monitor), not its position in the list,
so it stays the same as you add or remove monitors. If no monitor has that ID
(or it is hidden), you get a "No monitor" message.

Every shortcut on this page works while aggregating too. Since monitor IDs
repeat across servers, a typed number opens the first monitor with that ID in
the order the Monitors page lists them; use the command palette above when you
want a specific server's copy.

For IDs above 9, keep typing: the digits collect in a small indicator at the
bottom of the screen (for example `12`). Press `Enter` to go there immediately,
or wait about a second and it goes on its own. Press `Esc` to cancel.

## Other keys

| Key | Action |
|-----|--------|
| `/` | Open the "Jump to" command palette |
| `Esc` | Go back. Closes an open dialog first. |
| `?` | Open the Assistant, if enabled (see {doc}`assistant`); otherwise show the keyboard shortcuts |
