Authoring Release Notices
=========================

The app fetches ``docs/notices.json`` from ``raw.githubusercontent.com`` and
shows the entries on its Developer Notice page. That is how a maintainer says
something to every user without shipping a build. This page covers writing an
entry; the fetch itself, its schedule, and the field-by-field schema are in
:doc:`../developer-guide/13-network-endpoints`.

Generating a release notice
---------------------------

``scripts/generate_notice.mjs`` drafts a notice and upserts it into
``docs/notices.json``. Run it from the repo root:

.. code-block:: bash

   npm run notice           # prompts for version, defaulting to app/package.json
   npm run notice 1.8.0     # pass version directly
   node scripts/generate_notice.mjs 1.8.0

If no version is passed, the script prompts for one and defaults to the version
in ``app/package.json``. The tag is always derived as ``zmNinjaNg-<version>``.

The script:

1. Runs ``bundle exec github_changelog_generator --future-release zmNinjaNg-<version>``
   into a temporary file to collect the closed issues since the last tag (the
   repo's ``.github_changelog_generator`` sets ``pulls=false``, matching
   ``CHANGELOG.md``). ``CHANGELOG.md`` is not modified.
2. Calls ``claude -p`` with the relevant changelog section and asks for
   ``{"title": "...", "body": "..."}``.
3. Prints the proposed notice and asks:

.. code-block:: text

   Add this notice? [y/N/e(dit)]

- ``y``: upserts the notice into ``docs/notices.json`` (overwrites an existing
  entry with the same ``id``, or prepends if new). No git commit or push.
- ``e``: opens the draft in ``$EDITOR``; the edited version is written after
  the editor closes.
- ``N`` (or anything else): exits 0 without writing.

There are no fallbacks. If ``gh``, ``bundle``/``github_changelog_generator``,
or ``claude`` is missing or fails, if the output is not parseable JSON, or if
``docs/notices.json`` is corrupt, the script prints a clear error and exits
non-zero.

To test without keeping the result: run the script, verify in the app, then
``git checkout -- docs/notices.json`` to discard.

Integration with make_release.sh
--------------------------------

On minor and major releases (patch = 0) that do not already have a notice in
``docs/notices.json``, ``scripts/make_release.sh`` asks:

.. code-block:: text

   Generate a developer notice for <version>? [y/N]

Answering ``y`` runs ``node scripts/generate_notice.mjs <version>`` with no
error guard. Any failure halts the release (``set -e``). After a successful
generation, ``make_release.sh`` commits and pushes ``docs/notices.json`` so
the notice ships with the release.

If the version already has a notice in ``docs/notices.json``, or if the
release is a patch release, the prompt is skipped.

The notice is also the store release notes
------------------------------------------

The same body becomes the "What's New" text in App Store Connect and the
release notes in the Play Console, so neither console needs it retyped. The
store scripts strip the Markdown, since neither field renders it, and drop the
trailing changelog link, which is not clickable there.

Apple allows 4000 characters and Google Play 500. A notice over Play's limit is
compressed with a ``claude -p`` call that shortens the wording while keeping
every bullet, and the result is shown and confirmed before anything uploads. If
that call is unavailable, whole bullets are dropped from the end and named, so
you can see what will not reach Play.

A patch release has no notice, so its store notes are left alone and the
scripts say so. Write them by hand in the console, or add a notice first.
