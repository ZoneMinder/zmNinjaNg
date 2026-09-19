# Glossary

One name per concept, for code identifiers, briefs, docs, and commit
messages. Each entry says what the thing is, not what it does, and lists the
words to stop using for it. User-facing copy in `app/src/locales/` follows
the product wording instead and is exempt. The quality ratchet
(`app/scripts/quality-ratchet.mjs`) counts avoided terms in agent and
developer prose and fails when the count grows.

## Servers and scope

**Profile**:
A saved connection to one ZoneMinder server: URLs, credentials, and the
server-derived facts bootstrap fills in.
_Avoid_: server profile, connection profile

**Session**:
The lazily built, cached ApiClient plus auth state for one profile.
_Avoid_: api client instance, connection object

**Aggregate**:
A virtual profile that fans out over several profiles and has an id of its
own. "All Servers" is the built-in one.
_Avoid_: All mode, all-profiles mode, profile group, virtual group

**Bucket**:
One profile's or aggregate's settings object in the settings store.
_Avoid_: settings entry, settings record, profile settings object

**Bootstrap**:
The ordered steps that run when a profile becomes current, from TLS trust
through the Streaming Mode default.
_Avoid_: initialization sequence, profile init

## Monitors and media

**Monitor**:
A ZoneMinder camera definition, with its zones, function, and stream
settings.
_Avoid_: camera

**Feed**:
The live stream of one monitor as displayed.
_Avoid_: live view

**Event**:
A ZoneMinder recording with frames, alarm frames, and scores.
_Avoid_: recording, clip

**Nearby**:
The user-facing name for events from other monitors near an anchor event's
time, shown in `EventContextPanel`. Internal names (`EventContextPanel`,
`events.around.*` keys, `event-context-*` testids) stay as they are.
_Avoid_: around this event, context panel

**Zone**:
A motion-detection region on a monitor, in pixel or percent coordinates.

**Montage**:
The grid of feeds for the current scope.
_Avoid_: grid view, monitor wall

**Tile**:
One monitor's cell in the montage.
_Avoid_: montage cell

**Streaming Mode**:
The per-profile choice between Streaming and Snapshot for MJPEG feeds; the
settings key is `viewMode`.
_Avoid_: view mode, display mode, stream mode

**Snapshot**:
The Streaming Mode that refreshes a still image on an interval instead of
holding a stream.
_Avoid_: still mode, image mode, polling mode

**Multi-port streaming**:
ZoneMinder's per-monitor stream ports, published as `ZM_MIN_STREAMING_PORT`.
_Avoid_: multiport, port streaming, per-port

## Process

**Contract**:
An architecture entry in `AGENTS.project.md`: what it owns, the sanctioned
path, forbidden bypasses, and its gate.
_Avoid_: architecture rule, architecture convention

**Gate**:
A command that fails a commit, push, or CI run when a rule breaks.
_Avoid_: blocking check, guard script

**Brief**:
The requirements file handed to a subagent for one task.
_Avoid_: task prompt, instructions file

**Spec**:
A design document under `docs/superpowers/specs/`, written before a plan.
_Avoid_: design doc

**Seam**:
The interface a test exercises; the highest one that reaches the behavior.
_Avoid_: test boundary, layer under test

**Proven red**:
A new test that was run against the pre-change code and shown to fail there.
_Avoid_: verified failing, shown failing
