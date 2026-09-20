# Out of scope

Requests the maintainer has declined, with the reason, so nobody re-opens or
re-proposes them without new evidence. Check this before opening an issue or
suggesting a feature (P1). One entry per decision: the gist, why, and the
issue that records it. An entry is reopened only by a new issue that cites
the old one and says what changed.

- Rewriting inert code comments that cite pre-restructure AGENTS.md rule
  numbers. The instruction files and developer guide are remapped and gated;
  comment churn across ~50 files buys nothing. Refs #285.
- Redacting the access token from the URLs the iOS notification extension
  logs (`ImageNotification/NotificationService.swift`). The maintainer needs
  the full token in Console.app to debug rich-push image fetches, and the
  extension's log is device-local. Declined 2026-08-29 against the Fable
  review's P7-1; refs #392.
- Feature suggestions made without first checking the existing surface.
  Several proposed "new" features already existed. Grep the code and the
  user guide before proposing; an inventory from a subagent alone misses
  things.
- Deciding which montage tiles or monitor cards stream from where they sit on
  screen (an IntersectionObserver over the grid). Built, fixed twice and
  removed the same day: the observer needs layout geometry that the montage's
  own container does not provide, four rounds of device logs never held a
  single tile, and every test of it passed in jsdom while the device failed.
  Paging (`monitorsPerPage`) is the sanctioned bound, because a slice needs no
  geometry. Declined 2026-09-20; refs #507, #512, #513, #514, #515.
