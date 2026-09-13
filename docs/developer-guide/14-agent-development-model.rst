Agent development model
=======================

Most code in this repository is written by AI agents, and no person reads
the diffs line by line. The maintainer decides what to build and approves a
short written design, called a spec, before any code exists. Agents write
the code and its tests. Checks that run on every pull request decide whether
a change can merge, and an agent that did not write the change reviews it.

When this chapter was first written, in July 2026 (commit ``25b78369``), one
maintainer working this way had landed 2,313 commits in eight months.
Fourteen of those commits have "revert" in the subject line. Twelve of the
fourteen are now written up in
`domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
or in a contract, where an agent reads them before working in that area.

zmNinjaNg is the app in a family of projects built on ZoneMinder, the server
that records from the cameras and serves the API and streams the app talks
to. Two other projects in the family are developed the same way.
`zmesNg <https://zmeventnotificationng.readthedocs.io/en/latest/>`__, the
successor to zmeventnotification, watches ZoneMinder for new events, runs
machine learning models on them, and pushes out the results.
`pyzmNg <https://pyzmng.readthedocs.io/en/latest/>`__ is the Python library
zmesNg is built on. It wraps the ZoneMinder API and the detection pipeline.
ZoneMinder itself is not developed this way.

Rules, contracts, gates, and practices
--------------------------------------

A **rule** is a statement agents must follow, written in
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
or
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__.
Each rule in AGENTS.md has an ID whose letter gives its tier. I is for
invariants, such as validating server responses, which are never traded for
speed. P is for process, C for code, and M for meta rules, which govern the
instruction files themselves. Each rule says what must hold, why, and which
gate enforces it. The developer guide cites rules by ID, for example rule P2,
and does not copy their text.

A **contract** is a rule for one subsystem, kept in AGENTS.project.md, which
has eighteen of them. A contract has four lines: what the subsystem owns, the
one sanctioned way to use it, the bypasses that count as bugs even when they
work, and the gate that checks it.

A **gate** is a command that fails a commit, a push, or a CI run when a rule
is broken. CI (continuous integration) is the set of checks GitHub Actions
runs on each push and pull request. Rule M1 says a rule a script could check
needs a gate, added in the same change as the rule. M1 gives the reason: an
audit of this repository found every rule without a gate broken somewhere,
while every rule with a gate still held.

A **practice** is advice in a playbook. A playbook is a Markdown file under
`agents/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents>`__ that
covers one area, such as testing or native code. Practices record what has
worked, for example how to split work across agents or which model fits which
task. They cite evidence such as commit hashes instead of carrying IDs, and a
rule wins when a rule and a practice disagree.

A contract and its gate
~~~~~~~~~~~~~~~~~~~~~~~

The Polling contract in AGENTS.project.md reads:

.. code-block:: markdown

   ### Polling
   Owns: every recurring refresh interval.
   Path: `useBandwidthSettings` / `getBandwidthSettings` (`app/src/hooks/useBandwidthSettings.ts`).
   Never: literal interval values; users tune bandwidth globally.
   Gate: review.

Say an agent is asked to add a feature that refreshes every 30 seconds. From
this block alone, without opening the source, it learns three facts.
Recurring intervals belong to the Polling subsystem. The only sanctioned way
to get an interval is through the two named functions. Writing ``30000`` into
a component is a bug, even though it would work.

The gate for the names in a contract is
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__,
which runs with the unit tests. It reads each contract, takes every backticked
name from the ``Path:`` and ``Gate:`` lines, and checks it against the code. A
name that contains a slash must be an existing file. Any other name must
appear as a word somewhere under ``app/src``. If someone renames the hook and
leaves the contract alone, the suite fails with
``Polling: symbol useBandwidthSettings not found in app/src``. Because a stale
name fails the suite, the names in contracts stay current, and an agent can
trust them instead of working the design out from the source.

Some ``Never:`` lines can be checked with a text search, such as no
``console`` calls or no raw ``fetch``, and the same test file checks those.
The Polling line joined them in September 2026: a literal of two seconds or
more handed to ``setInterval`` or a ``refetchInterval`` fails the suite. What
no script can tell is whether the value a component reads from the hook is
the right one for that screen, so a reviewing agent still has to judge that.
Contracts whose ``Gate:`` line says ``review`` have no text search that
settles their clauses at all.

Where the instruction files live
--------------------------------

.. mermaid::

   graph TD
     CL["CLAUDE.md<br/>(Claude Code shim)"] --> AG["AGENTS.md<br/>rules I / P / C / M"]
     CL --> AP["AGENTS.project.md<br/>18 contracts + project rules"]
     AG -. "read before any work" .-> AP
     AP -- "table: read for your area" --> PP["agents/project/<br/>testing, docs, native,<br/>data-integrity, llm-models,<br/>domain-context, glossary,<br/>out-of-scope"]
     CL -- "multi-agent work" --> GP["agents/generic/<br/>claude-workflows.md"]
     AG === GATE["agents-contracts.test.ts<br/>contract names exist, portable core,<br/>word limit, cited hashes, privacy,<br/>rule IDs, heading style"]
     AP === GATE
     PP === GATE
     GP === GATE
     CL === GATE
     PR["every PR"] === CI["ci.yml<br/>tests, lints, build,<br/>proven-red"]
     GATE --> CI
     FAIL["breakage or review finding"] -- "fix PR proposes rule + gate<br/>(self-improvement protocol)" --> AG
     FAIL -- "durable fact (M5)" --> PP
     FAIL -- "proven practice (M5)" --> GP

The arrows leaving CLAUDE.md and AGENTS.project.md show what an agent reads,
and the dotted arrow shows that AGENTS.md is read first. The double lines show
what gets checked: the instruction files by agents-contracts.test.ts, and every
pull request by ci.yml. The three arrows leaving "breakage or review finding"
show where the lesson from a breakage gets written.

- `CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__
  has two lines. The first makes Claude Code load AGENTS.md and
  AGENTS.project.md. The second points to the workflow playbook for
  multi-agent work. Other agent tools read AGENTS.md directly.
- AGENTS.md holds the rules that apply to any project. It contains no
  zmNinjaNg names, so it can be copied into another project unchanged, and a
  test fails if a project name gets into it.
- AGENTS.project.md holds the eighteen contracts, the project rules, the
  verification commands, and a table that tells an agent which playbook to
  read for which kind of work.
- `agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__
  holds the area playbooks (testing, documentation, native, data integrity,
  LLM models) and three reference files. ``domain-context.md`` holds verified
  project facts: API quirks, platform behavior, and approaches that were tried
  and reverted. ``glossary.md`` gives one name per concept and lists the words
  to stop using for it. ``out-of-scope.md`` lists requests the maintainer has
  declined, with the reason for each, and is read before anyone proposes work.
- `agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
  holds workflow advice that applies to any project.

Every session loads AGENTS.md and AGENTS.project.md. Playbooks load only when
the work touches their area, so they can hold detail the always-loaded files
cannot. Each fact has one home. A playbook points to a contract instead of
repeating it, so a rule changed in one place does not leave a stale copy in
another.

Besides the names in contracts, agents-contracts.test.ts checks the
instruction files and the developer guide:

- AGENTS.md contains no project names.
- AGENTS.md, AGENTS.project.md, and CLAUDE.md together stay under a word
  limit.
- Every commit hash cited in ``domain-context.md`` exists in the history.
- ``domain-context.md``, ``llm-models.md``, ``glossary.md``,
  ``out-of-scope.md``, and ``claude-workflows.md`` contain no email addresses
  or IP addresses.
- Every rule ID cited in the developer guide exists in AGENTS.md.
- No heading in the developer guide or in a playbook starts with "The".
- The developer guide cites no line numbers and no symbols that were removed
  from the code, and its Mermaid diagrams contain no semicolons, which break
  rendering.

Gates on every change
---------------------

``npm run gates``, run from ``app/``, runs the whole set: the unit tests, the
build (which includes the TypeScript check), and three lints that block a
merge, ``lint:a11y``, ``lint:correctness``, and ``lint:ratchet``. Rule P3
says to run the gates that cover a change before each commit, and the whole
set before a push or pull request.

``lint:ratchet`` compares lint results against a stored baseline in
``app/.lint-baseline.json`` and fails when the count grows. A check like this
is called a ratchet. Its number may fall or stay the same, and raising it by
hand needs a reason in the commit message (rule C7).

CI runs the gates again on every pull request. Branch protection on ``main``
blocks a merge until the required checks pass: unit tests, lint, build, the
accessibility and React correctness lints, the native version guard (described
under "Builds, releases, and CI workflows"), and proven red. The agent that
opens a pull request turns on GitHub auto-merge, and GitHub merges it when
those checks go green.

CI also runs a ``pr-acceptance`` job, which fails when the pull request body
has no ``## Acceptance`` section or the section is empty. Rule P1 says that
section quotes the issue's acceptance lines, the lines that say what the
finished change must do.

Rule M2 says to check what a gate reads, not only whether it passed. A gate
that reads the wrong input can pass while its rule is broken, so any number a
gate reports has to measure what it claims to.

Proven red
~~~~~~~~~~

A new test is **proven red** when it was run against the code from before the
change and failed there. A test that passes on the old code cannot catch the
bug it was written for. Rule P2 requires a failing test before every feature
and bug fix, and the proven-red job in CI enforces it. Before the job existed,
three tests in this repository passed on the code they were meant to catch.
Each was found only when someone stashed the fix and ran the test again.

The job
(`proven-red.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/proven-red.mjs>`__)
takes the unit test files a pull request changed and runs them in a second
checkout of the repository that holds the code from before the change. It
fails when they pass there. It does not run for a pull request that changes
no source file, such as a docs change. Lowering a ratchet baseline does not
count as a source change either.

When source did change, every changed unit test has to be proven red,
whatever the pull request title says. The title matters only when source
changed and no unit test did. A title type that marks no behavior change
(``docs``, ``chore``, ``ci``, ``refactor``, ``build``, ``style``, ``test``)
then lets the change through, which is what a real refactor looks like.

Tests under ``app/src/tests/``, such as agents-contracts.test.ts, check the
repository rather than app behavior. The job does not run them against the
old code, because the old code holds no violation for them to find. The
author proves such a test red by hand instead. They add a deliberate
violation, watch the test fail, and remove the violation before the change
lands.

Quality ratchet
~~~~~~~~~~~~~~~

The quality ratchet
(`quality-ratchet.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/scripts/quality-ratchet.mjs>`__,
checked by ``quality-ratchet.test.ts``) stores three counts in
``app/.quality-baseline.json`` and fails when any of them grows:

- test files that mock the app's own stores, hooks, services, or components
  instead of testing through them
- assertions that only prove an element exists (rule C6)
- uses of words that the
  `glossary <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/glossary.md>`__
  lists under ``_Avoid_``, counted in the agent files and the developer guide

The counts started at 121 files, 302 assertions, and 115 words.

What gates cannot check
-----------------------

A ``Gate: review`` line in a contract means an agent reviewer has to catch
violations. The section "Who reviews what" covers review. Two other areas need
checks beyond the gates.

One codebase ships to iOS and Android through Capacitor, to macOS, Windows,
and Linux through Electron, and to the browser. A change to a shared component
can break on five platforms at once, and no single machine can test all of
them. Platform differences are written down where agents look for them: the
Native contract, the
`native playbook <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/native.md>`__,
and the platform notes in ``domain-context.md``. Web end-to-end tests run in
CI when the repository has ZoneMinder server secrets set. Device end-to-end
tests (Android emulator, iOS simulator, and tablet) are run by the maintainer
from scripts, never by agents. Native OS flows, such as picture-in-picture,
biometrics, push notifications, downloads, sharing, and app lifecycle, need
verification on a real device.

The app's assistant answers questions about the user's cameras and events. It
calls tools against the user's server and runs on a backend the user chooses,
such as their own Ollama server, WebLLM on the device, or Apple Foundation
Models. A language model can make up an answer where ordinary code would fail
with an error, so the assistant has extra checks. The Assistant tool loop
contract stops a turn from answering a data question until a real tool has
returned a result. Prompt changes are scored with an evaluation harness before
and after the change, and
`llm-models <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/llm-models.md>`__
has the numbers. The schema rules are in
`data-integrity <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/data-integrity.md>`__.

How a feature lands
-------------------

This section follows one change from spec to merge: bulk event deletion,
tracked under `issue #213 <https://github.com/ZoneMinder/zmNinjaNg/issues/213>`__
and shipped in July 2026.

Spec
~~~~

A brainstorming session, in which an agent asks the maintainer questions until
the design is settled, produced a spec in
`docs/superpowers/specs/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers/specs>`__.
The spec says what the user sees, what is out of scope, and which existing
code gets reused. The maintainer reads and approves the half-page spec before
any code is written, while changing direction still means editing a document.
The directory holds seventeen specs.

Plan
~~~~

An approved spec becomes an implementation plan in
`docs/superpowers/plans/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers/plans>`__.
A plan is written for an agent that has not seen the conversation. The
`bulk-delete plan <https://github.com/ZoneMinder/zmNinjaNg/blob/main/docs/superpowers/plans/2026-07-02-bulk-delete-events.md>`__
opens with a one-sentence goal, a three-sentence summary of the design, and a
list of constraints that apply to every task. Two of those constraints are
that npm commands run from ``app/`` and that events are deleted only through
the existing ``deleteEvent`` helper in ``api/events.ts``. The work is then
split into checkbox tasks. Each task contains its failing test word for word
and asks for the code that makes that test pass. When a task holds everything
to write, a cheaper model can carry it out, and the test exists before the
code, as rule P2 requires.

The
`testing playbook <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/testing.md>`__
decides which kind of test a plan asks for:

- Pure logic in ``lib/``, stores, and hooks gets unit tests next to the source.
- Anything a user sees or navigates to gets an end-to-end scenario in a
  feature file, plus unit tests for the logic under it.
- Flows that exist only in native code (picture-in-picture, biometrics,
  downloads) are checked by hand on a device.

End-to-end tests check the user's path through the app, unit tests check the
edge cases, and no assertion appears in both. Scenarios find elements by
``data-testid``. The values follow a naming convention, so agents working
separately pick the same names. They are kebab-case, repeated elements end in
the entity id (``monitor-card-${monitor.Id}``), and variants end in their kind
or role (``assistant-message-${msg.role}``).

Implementation
~~~~~~~~~~~~~~

The main session, the agent session the maintainer talks to, starts one
subagent per task. A subagent is a separate agent with a fresh context,
meaning none of the main session's conversation is loaded into it. The main
session keeps its own context free for reading reports and deciding what
happens next. Each task ends by running the gates that cover what it changed.
The
`workflow playbook <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__
records what makes this reliable. For example, piping a gate command into
``grep`` hides a failing test run, because the pipeline returns the exit
status of ``grep``.

Pull request and merge
~~~~~~~~~~~~~~~~~~~~~~

By the time the pull request opens, the gates have run, and auto-merge waits
for CI. A change to a native OS flow also waits for the device check described
under "What gates cannot check". Then rule P10 applies. The user guide
describes the feature, the developer guide describes the new components, and
:doc:`call-flows`, which traces user actions step by step through the code,
gets a trace for the feature.

A smaller change skips most of this. A typo fix needs no issue. An edit fully
covered by a gate is made directly by the main session, without a subagent.
A cosmetic UI change relies on the existing tests.

Who reviews what
----------------

Agents review the code. The maintainer reviews specs before work starts and
the whole codebase at milestones.

Agent review
~~~~~~~~~~~~

Reviews of mechanical tasks, where an agent copied a fully written task from a
plan, found nothing the gates had not already caught, so those tasks rely on
their gates. A task that needed judgment gets reviewed by a second agent
against the task's requirements before the next task starts.

Before every pull request, one review covers the whole branch. It has two
parts, run in separate contexts. One agent checks the diff against the
contracts and playbooks. Another checks it against the acceptance lines the
pull request quotes from its issue. The two reports stay separate because a
change can follow every convention and still not do what the issue asked. Two
pairs of pull requests from August 2026, #375 followed by #377 and #379
followed by #380, passed every gate and still missed what their issues asked.

At milestones, different models check each other's claims and run the gates
again.
`Issue #217 <https://github.com/ZoneMinder/zmNinjaNg/issues/217#issuecomment-4882243836>`__
has an example. Fable re-reviewed a 15-commit change that Opus had already
reviewed (both are Claude models), using four verification agents and a fresh
gate run.

Contributors from outside the project are asked in the
`README <https://github.com/ZoneMinder/zmNinjaNg/blob/main/README.md>`__ to run
a code review, which can be an agent review, before they open a pull request.
The
`claude.yml <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/claude.yml>`__
workflow lets the maintainer bring an agent into any issue or pull request by
mentioning it.

Maintainer review
~~~~~~~~~~~~~~~~~

The maintainer reviews at two points. The first is the spec, before
implementation starts. The second is offline, at milestones. Roughly once a
month the scorecard review and the history review run against the whole
codebase (both are described under "Periodic reviews"), and their findings
become issues, gates, and playbook entries.

Because the maintainer does not read diffs, their understanding of the code
comes from two places: the specs they approve before the code exists, and the
documentation the code has to come with. Rule P10 requires every new API,
component, hook, or utility to update the developer docs and call flows. The
documentation playbook requires that writing to teach: React is explained
where a chapter first depends on it, and flows are traced through real user
actions. The developer guide exists for that reason (see
:doc:`01-introduction`).

Writing docs and other prose
----------------------------

Agents write the docs, commit messages, pull request and issue bodies, and
review comments, as well as the code. All of that prose is written and edited
with `slop-mop <https://github.com/pliablepixels/slop-mop>`__, a writing skill
for coding agents. It has an agent write plain, factual sentences with nothing
invented, no superlatives about the work, and terms defined at first use. It
also removes the phrasing patterns common in AI text, such as "not X but Y"
contrasts and one-line closing sentences.

Each agent installs the skill from its repository, following the README there.
This repository does not include a copy. AGENTS.project.md makes using it a
project rule, and the
`documentation playbook <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/documentation.md>`__
adds the project's own rules for placement, call flows, and headings.

Some writing rules have gates. ``no-em-dash.test.ts`` fails on an em dash in
the developer guide or the user guide. ``agents-contracts.test.ts`` fails on a
heading that starts with "The". The quality ratchet counts the words the
glossary says to avoid. Everything else needs judgment, so a review of prose
runs slop-mop's detect mode, which quotes each problem line and names the
pattern without rewriting it. That review runs on Opus or a more capable
model. In the testing recorded in the skill, smaller models followed the word
lists but skipped the checks that need judgment.

How rules are added and removed
-------------------------------

When something breaks that no rule covered, or a review finds a problem a rule
would have prevented, the pull request with the fix also proposes the rule
change. If a script could check the new rule, the change includes the gate
(rule M1). The maintainer merges or rejects the rule change like any other
diff. AGENTS.md calls this the self-improvement protocol, and rule M3 says the
instruction files change only this way.

Agent memory belongs to one agent on one machine. Other agents, other
contributors, and CI never see it, and it is gone when the machine is. Rule M5
therefore sends durable project facts, such as an API quirk or an approach
that failed, to ``domain-context.md``, and workflow practices that proved out
to ``agents/generic/``, both through the protocol. A revert, or a run of fixes
to one file, usually means there is a fact worth recording. The current
``domain-context.md`` came from one sweep of agent memory and the full commit
history.

Contracts are grouped by subsystem. A contract covers its subsystem whichever
layer the code sits in, platform differences live in the native playbook and
``domain-context.md``, and the developer guide teaches the frameworks. A
playbook for a single layer, such as the frontend, gets created only when one
kind of failure keeps coming back and no existing playbook fits it.

Rules also get removed. Every rule adds to the context of every future
session, whether or not it prevents anything, so the instructions are audited
for cost. A July 2026 friction audit (abb96c79) found a verification step that
repeated what the build already did, an end-to-end test requirement with no
minimum change size, and the same facts copied into three files. The fix
deleted more instruction text than it added. A rule that turns out wrong or too
expensive is removed through a diff the maintainer approves.

Periodic reviews
----------------

Scorecard review
~~~~~~~~~~~~~~~~

Gates catch only the problems someone has written a gate for. A scorecard
review looks for the rest, such as duplicate code spreading across files,
tests that pass without asserting much, or a convention the code no longer
follows. An agent that followed a gate at the start of a long session can
ignore it by the end, so about once a month the maintainer has an agent in a
new session score the whole codebase with a scorecard review skill.

The scorecard scores twelve weighted pillars: architecture, test quality, code
quality, DRY, type safety, error handling, security, convention
self-consistency, performance, documentation, tooling, and accessibility with
i18n. A pillar gets a number only if a command was run to produce the
evidence. Test quality is scored by what the suite would catch (assertion
density, failure paths, boundary cases, how much is mocked), never by the
number of tests. As a probe, the reviewer tries to name plausible bugs the
suite would miss. If the reviewer can name three in five minutes, the pillar
scores below 7. The output ends in a ranked list of fixes.

This repository has its own version, the
`fable-review <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/fable-review>`__
skill. It scores the same kind of pillars against this project's contracts,
runs only on the Fable model, and writes a report under
``docs/superpowers/analysis/``. Each finding has enough detail for another
agent to act on it: where it is, the fix, how to verify it, effort, risk, and
the contracts involved. The format comes from
`issue #217 <https://github.com/ZoneMinder/zmNinjaNg/issues/217>`__. A Fable
review scored the codebase 7.5, an Opus session carried out the fixes in
`PR #218 <https://github.com/ZoneMinder/zmNinjaNg/pull/218>`__, and the
scoring in the issue put the codebase at 8.1 after that pull request.

Each ranked fix becomes an issue for an agent to work.
`Issue #281 <https://github.com/ZoneMinder/zmNinjaNg/issues/281>`__ shows the
whole cycle. A scorecard run found React correctness gaps, test coverage
measured against the wrong input, and import cycles. The fixes landed under
that issue, and some of its checks, such as the import cycle test and the
scoped lint configs, became permanent gates, so later reviews do not have to
look for those problems.

History review
~~~~~~~~~~~~~~

The self-improvement protocol records a lesson only when someone notices it at
the time. The
`mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__
skill looks through the commit history for lessons nobody recorded. It looks
at reverts, which show something was tried and did not work, at repeated fixes
to the same subsystem, which show one misunderstanding coming back, and at
fixes an existing gate should have caught. It reports candidate
``domain-context.md`` entries and candidate contracts, each with the commit
hashes behind it. Its first run, over this repository's first 2,254 commits,
produced two contracts and twenty ``domain-context.md`` entries. The Auth
tokens contract came from 8 fixes. The Assistant tool loop contract came from
63 commits fixing the same kind of failure.

Scheduling the reviews
~~~~~~~~~~~~~~~~~~~~~~

Neither the scorecard review nor the history review is mandatory, and about
once a month is enough. Either can also run after a heavy period of fixes
instead of on a schedule. To schedule them, anything that can run the CLI works
(``claude -p "/mine-history"`` from cron or a calendar automation), and Claude
Code users can create a routine with the ``/schedule`` command.

Keeping agent context small
---------------------------

Everything an agent loads goes into its context, the text the model reads on
every turn. Two parts of the setup limit how much that is.

AGENTS.md, AGENTS.project.md, and CLAUDE.md load into every session, so
agents-contracts.test.ts caps their combined size at 4,000 words with the
``WORD_BUDGET`` constant. The three files hold about 2,150 words. Detail goes
in playbooks, which load only for work in their area. An edit that pushes the
total past the limit fails the suite. The author then either trims wording or
raises the constant, and a raise needs its reason in the commit message, like
a ratchet. The limit went from 2,100 to 4,000 on 2026-08-30 as headroom. The
comment beside the constant says each new rule still has to answer whether a
script could check it instead.

Implementation runs in subagents on the smallest model that can do the task.
A trivial edit that a gate covers skips the subagent. Independent review runs
only on work that needs judgment. Plans contain their tests word for word, so
the design work happens once, in the planning session, and the implementing
model copies tests and code from the plan.

The maintainer also runs
`tokless <https://github.com/HoangP8/tokless>`__, a local toolkit of tools
that reduce token use. It includes caveman (terse chat replies), ponytail (a
bias toward the smallest working change), rtk (a CLI wrapper that compresses
command output before the model reads it), codegraph (a code index queried
instead of searching and reading files), and context-mode (runs analysis in a
sandbox so raw output stays out of the context). None of it is required to
work on this repository.

Output compression is why rule P6 exists. In one session the rtk wrapper
capped a commit count at 50 on a 2,254-commit repository, hid a failing test
behind a log file path, and hid a failing gate's exit status inside a
pipeline. Each was caught only by running the bare command again. A later
session found ``git log`` capped at 50 again in a wrapped shell, noticed only
because ``git rev-list --count`` gave a different number. Compression tools
can be used for reading, but a gate always runs as the bare command. Token
savings a tool reports about itself get the same check as any other number a
tool reports (rule M2).

Builds, releases, and CI workflows
----------------------------------

The ``build-*`` workflows build the Android and desktop binaries. Each one runs
when a ``zmNinjaNg-*`` tag is pushed, and each can also be started by hand with
a version number. ``build-all.yml`` is started by hand and builds several
platforms in one run. ``create-release.yml`` runs on the same tag and creates
the GitHub release with a generated changelog. iOS is archived and signed
locally, because no macOS runner builds it in CI. After the tag,
``scripts/make_release.sh`` offers to upload the iOS build to App Store Connect
(``scripts/upload-ios.sh``). Once the tag's workflow has built the Android
bundle, it offers to upload that to Google Play (``scripts/upload-android.sh``).

``npm run build`` raises the native build numbers (the Android
``versionCode`` and the iOS ``CURRENT_PROJECT_VERSION``) as a side effect.
Those changes belong only in a deliberate ``chore:`` commit. The version guard
enforces this: a commit-msg hook, and the ``native-version-guard`` check in CI,
reject any other commit that changes those lines. Test builds reuse the
existing workflows instead of adding new ones.

.. list-table::
   :header-rows: 1
   :widths: 28 30 42

   * - Workflow
     - Runs on
     - What it does
   * - ``ci.yml``
     - every PR, push to main
     - version guard, lints, build, unit tests (with the full history checked
       out, so the gate can confirm cited commit hashes exist), the proven-red
       check, script tests, and web e2e when the ZoneMinder secrets are set
   * - ``claude.yml``
     - @claude mention on issues and PRs
     - brings an agent into the thread
   * - ``build-android/-macos/-windows/-linux-*.yml``
     - ``zmNinjaNg-*`` tag push, or manual start with a version
     - release binaries for each platform
   * - ``build-all.yml``
     - manual start with a version
     - builds the chosen platforms in one run
   * - ``create-release.yml``
     - ``zmNinjaNg-*`` tag push
     - creates the GitHub release with a generated changelog
   * - ``test.yml``
     - release published
     - runs the unit tests again with coverage against the released code
   * - ``deploy-pages.yml``
     - push to main touching ``site/**``
     - deploys the project site
   * - ``auto-close-low-quality-issues.yml``
     - issue events
     - closes issues whose title is under 10 characters or whose body is
       under 30
   * - ``moderate-issue-spam.yml``
     - issue events
     - flags issues that link to hosts outside an allowlist and notifies the
       maintainer

Using this in your own project
------------------------------

Copy AGENTS.md unchanged. It contains no zmNinjaNg names, and the portability
test keeps it that way. Project facts go in the other files.

Write an ``AGENTS.project.md`` for your codebase. Most of the work is the
contracts. Find the places where your code has one sanctioned path (settings,
HTTP, logging, state), and write an Owns, Path, Never, and Gate block for
each, using real symbol names.

Copy agents-contracts.test.ts and point it at your tree: your source
directory, your list of forbidden names, and a word limit measured from your
own files plus some room. Copy ``agents/generic/`` as it is, and start
``agents/project/`` with an empty ``domain-context.md``. If the project has
history, one ``mine-history`` run over all of it produces most of the first
entries.

Claude Code needs a CLAUDE.md that imports the two instruction files. Other
agent tools read AGENTS.md directly. To use the same writing rules, install
slop-mop from its repository and add a project rule that requires it. The
periodic reviews are optional. Start with the core and a handful of contracts,
and add rules through the protocol as incidents happen.

Evidence for this chapter
-------------------------

Two documents record how this model performed.

The
`all-profiles retrospective <https://github.com/ZoneMinder/zmNinjaNg/blob/main/docs/superpowers/analysis/2026-08-04-all-profiles-retrospective.md>`__
goes commit by commit through four days of work that used roughly ninety agent
contexts. It lists every defect the review loop caught before merge, with the
probes and mutations that proved each one. A mutation here is a deliberate bug
put into the code to confirm that a test fails. The retrospective also reports
what cost time and what a future run should drop.

The
`post-sweep codebase review <https://github.com/ZoneMinder/zmNinjaNg/issues/348>`__
came after that period. An agent in a new session scored eleven of the twelve
pillars, skipping Security at the maintainer's request, for a mean of 7.9 out
of 10. Every finding was checked against the source it cited. The review
reports where the gates held and where rules without gates were broken.

Where everything lives
----------------------

- `AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__, the rules for any project
- `AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__, contracts and project rules
- `CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__, the Claude Code shim
- `agents/generic/claude-workflows.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__, the workflow playbook for any project
- `agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__, area playbooks and `domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
- `docs/superpowers/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers>`__, approved specs and implementation plans
- `agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__, the gate on the instruction files
- `quality-ratchet.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/scripts/quality-ratchet.mjs>`__ and `proven-red.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/proven-red.mjs>`__, the gates on the tests themselves
- `glossary.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/glossary.md>`__ and `out-of-scope.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/out-of-scope.md>`__, vocabulary and declined requests
- `mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__, the history review skill
- `fable-review <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/fable-review>`__, the scored codebase review skill
- `slop-mop <https://github.com/pliablepixels/slop-mop>`__, the writing skill, installed separately

What this asks of a contributor
-------------------------------

Read ``AGENTS.md`` and ``AGENTS.project.md``, read the playbook for your area,
write prose with slop-mop, and let the gates run. This applies to people and
agents alike. If a rule seems wrong, propose a change through the protocol
instead of working around it. See :doc:`09-contributing` for branches,
commits, and verification commands.
