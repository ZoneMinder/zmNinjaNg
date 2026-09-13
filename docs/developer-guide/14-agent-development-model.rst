Agent development model
=======================

Most code in this repository is written by AI agents, and the diffs are
not line-reviewed by a person. In eight months one maintainer directing
agents landed 2,313 commits and fourteen reverts, and each of those
reverts is now written down where an agent reads it first.

This chapter covers why that works here, what enforces correctness
without line review of diffs, and where a human still reviews.

.. admonition:: Evidence for this chapter

   Two documents test this chapter's claims; read them after the guide. The
   `all-profiles retrospective
   <https://github.com/ZoneMinder/zmNinjaNg/blob/main/docs/superpowers/analysis/2026-08-04-all-profiles-retrospective.md>`_
   is a commit-by-commit retrospective of this model over four days of
   work: three programs, roughly ninety agent contexts, and every
   defect the review loop caught before merge, with the probes and
   mutations that proved each one. It also reports what cost time and
   what a future run should drop.

   The `post-sweep codebase review
   <https://github.com/ZoneMinder/zmNinjaNg/issues/348>`_ is the
   second check: after that fix period, a fresh-context twelve-pillar
   review scored the whole repository (overall 7.9/10), with every
   finding re-verified against the cited source before scoring. It
   reports where the model's gates held and where ungated rules
   drifted, and includes a phased plan for fixing the drift.

Scope, platforms, and release guardrails
----------------------------------------

One codebase ships everywhere zmNinjaNg runs: iOS and Android through
Capacitor, macOS, Windows, and Linux through Electron, and the browser
directly.

zmNinjaNg is the front end of a set of projects built on ZoneMinder. zmNinjaNg,
zmesNg, and pyzmNg are developed under the model this chapter describes;
ZoneMinder is not.

- **ZoneMinder** records from the cameras and exposes the API and
  streaming daemon everything else talks to.
- **zmesNg** (`docs <https://zmeventnotificationng.readthedocs.io/en/latest/>`__),
  successor to zmeventnotification, watches ZoneMinder for new events,
  runs AI/ML inferencing on them, and pushes the results out.
- **pyzmNg** (`docs <https://pyzmng.readthedocs.io/en/latest/>`__) is the
  Python ZoneMinder library zmesNg builds on, wrapping the API and the
  detection pipeline.

The app ships an assistant that answers questions about the user's
cameras and events by calling tools against their server, on the user's
choice of backend: their own Ollama server, on-device WebLLM, or Apple
Foundation Models. A language model can return a fabricated answer where
ordinary code would fail visibly, so this subsystem has extra guardrails:
the Assistant tool loop contract gates whether a turn may answer at all, prompt changes
are measured with a scored eval harness before and after
(`llm-models <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/llm-models.md>`__
has the numbers), and the schema rules live in
`data-integrity <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/data-integrity.md>`__.

A change to a shared component can misbehave on five platforms at once,
and no single machine can verify all of them, so platform divergence is
written down where agents will find it (the Native contract, the native playbook,
the platform quirks in domain-context), web e2e runs in CI wherever a
ZoneMinder is configured to point it at, and device e2e (Android emulator,
iOS simulator and tablet) is run manually from scripts, never by agents.

Android and desktop binaries are built by the GitHub workflows, not on a
laptop: the ``build-*`` workflows are dispatched manually with a version
number, and pushing a ``zmNinjaNg-*`` tag drives the release workflow that
publishes from those artifacts. iOS archives and signs locally; no macOS
runner builds it in CI. After the tag, ``scripts/make_release.sh`` offers
to upload the iOS build to App Store Connect (``scripts/upload-ios.sh``)
and, once the tag's workflow has built the Android bundle, to upload that
to Google Play (``scripts/upload-android.sh``). Native build numbers change
only in a deliberate ``chore:`` commit, enforced by the version guard in
CI, and test builds reuse the existing workflows rather than growing new
ones. Outside contributions go through the same rules and gates as the
maintainer's own work, plus a code review before the PR.

Every workflow, and what fires it:

.. list-table::
   :header-rows: 1
   :widths: 28 30 42

   * - Workflow
     - Fires on
     - Purpose
   * - ``ci.yml``
     - every PR, push to main
     - version guard, lints, build, unit tests (full-history checkout so
       the gate can confirm commit hashes cited as evidence exist), the proven-red check and script tests, and web
       e2e when the ZM secrets are set
   * - ``claude.yml``
     - @claude mention on issues and PRs
     - summons an agent into the thread
   * - ``build-android/-macos/-windows/-linux-*.yml``, ``build-all.yml``
     - manual dispatch with a version
     - per-platform release binaries
   * - ``create-release.yml``
     - ``zmNinjaNg-*`` tag push
     - publishes the GitHub release from built artifacts
   * - ``test.yml``
     - release published
     - re-runs unit tests with coverage against the released code
   * - ``deploy-pages.yml``
     - push to main touching ``site/**``
     - deploys the project site
   * - ``auto-close-low-quality-issues.yml``, ``moderate-issue-spam.yml``
     - issue events
     - agent-based issue triage

Moving from code review to constraint enforcement and design review
-------------------------------------------------------------------

Reading every generated diff stopped scaling early. What replaced it:

- Every rule an agent has to
  follow is written down; every rule a script can check has a script
  checking it; when something breaks that no rule covered, the fix has to
  include the rule that would have covered it. The maintainer states what
  should happen (a bug, a feature, an issue number), an agent does the
  work, and the gates decide whether it lands.
- Reviews are dispatched to an agent that
  did not write the code, and at milestones different frontier models
  re-verify each other's claims, gates re-run included.
  `Issue #217 <https://github.com/ZoneMinder/zmNinjaNg/issues/217#issuecomment-4882243836>`__
  has a worked example: Fable re-reviewing a 15-commit delta that Opus
  had reviewed, four verification agents plus a fresh gate run.
- Session memory cannot be seen by
  other agents, other contributors, or CI, and dies with the machine.
  A revert or a string of fixes to one file marks a lesson worth writing down.
  The facts in
  `domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
  came from sweeping agent memory and the full commit history once; rule
  M5 requires the same of every future session.
- There is no frontend or backend
  rulebook: a contract owns its subsystem's invariant whichever layer it
  sits in, platform divergence lives in the native playbook and
  domain-context, and the dev guide teaches the frameworks. A layer
  playbook gets created only when a recurring failure class arrives with
  no home in the current playbook split.
- Every dispatch
  re-reads context, and reviews of mechanical work here found nothing the
  gates had not already proven. Review ceremony scales with a change's
  risk, and delegation has a floor: a trivial gate-covered edit is made
  directly instead of dispatched, independent review is reserved for
  judgment work plus one whole-branch review before every PR, and a small
  bounded change relies on its gates.

The maintainer still reviews, at two points. Feature work starts as a
short design doc saying what is being built and why, and the maintainer
approves that before implementation, because reviewing a half-page of
intent catches wrong-direction work earlier and cheaper than reviewing
the thousand lines it would have become. Code review then happens
offline, at milestones: the scorecard and history-mining reviews run
against the whole codebase roughly monthly (both described below), and
their findings become issues, gates, and playbook entries.

Rule P10 makes every new
API, component, hook, or utility update the developer docs and call
flows, and the documentation playbook requires that writing to teach,
with React explained where a chapter first relies on it and flows traced
through real user actions. In a codebase agents write, the maintainer's
understanding comes from approving designs before the code exists and
reading the docs the code is forced to produce after, which is why this
guide exists (see :doc:`01-introduction`).

How a feature lands
-------------------

This section follows one change through that process: bulk event deletion
(`issue #213 <https://github.com/ZoneMinder/zmNinjaNg/issues/213>`__,
shipped 2026-07).

A brainstorming pass turns "I want
to delete events in bulk" into a design doc in
`docs/superpowers/specs/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers/specs>`__:
what the user sees, what is out of scope, which existing pieces get
reused. The maintainer reads and approves that half page; changing
direction costs little at this point. The specs directory holds seventeen
specs.

An approved spec becomes an implementation plan in
`docs/superpowers/plans/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers/plans>`__.
Plans are written for a different reader than specs: an agent with no
conversation history. The
`bulk-delete plan <https://github.com/ZoneMinder/zmNinjaNg/blob/main/docs/superpowers/plans/2026-07-02-bulk-delete-events.md>`__
opens with the goal, the architecture in five sentences, and a global
constraints block (which directory npm runs from, which existing API
helper is the only sanctioned delete path), then breaks the work into
checkbox tasks where the failing tests are embedded verbatim in the
plan. A task is "make this exact test pass", not "add a selection
store". When the task text contains the complete content to write, a
cheap model can execute it, and rule P2 holds because the plan puts each
test before its implementation.

Which tier a plan's embedded tests target follows a routing rule from the
`testing playbook <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/testing.md>`__:
pure logic in ``lib/``, stores, and hooks gets unit tests beside the
source; anything a user sees or navigates gets a scenario in a feature
file plus units for the logic underneath; native-only flows (picture-in-picture,
biometrics, downloads) are verified on a device by hand. E2e asserts the
journey, units assert the edge cases, and the same assertion never lives
in both tiers. Scenario selectors come from ``data-testid``, generated by
convention so agents produce identical names without coordination:
kebab-case, entity-id suffix for repeated elements
(``monitor-card-${monitor.Id}``), kind or role suffix for variants
(``assistant-message-${msg.role}``).

One agent runs each task with fresh context, and the orchestrating
session stays clean to judge reports. Each task ends with
the covering gates (``npm run gates`` scoped to what changed), each
judgment-heavy task gets an independent review against its brief, and one
whole-branch review runs before the PR. The
`workflow playbook <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__
records the practices that make this reliable, down to the trap that a
piped gate command hides a red exit status.

By the PR, the gates have already run: branch protection holds
the merge until every required check passes, and the merge is queued with
GitHub auto-merge rather than polled for. What the gates cannot prove,
the maintainer checks by hand where it matters: UI work gets a real
device pass (picture-in-picture, biometrics, and rotation are not trusted from a
simulator), and anything native waits for that verification before merge.
Then rule P10 applies: the user guide gains the feature, this guide
gains the components, and the call flow gets traced.

A typo-level fix needs no issue, a gate-covered edit needs no dispatched
agent, and cosmetic UI tweaks rely on existing tests; the full pipeline is
for changes where a mistake is expensive.

Rules, gates, and practices
---------------------------

This guide uses four terms with specific meanings.

A **rule** is a binding statement in
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
or
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__.
Rules in the core file carry stable tier IDs (I for invariants, P for
process, C for code, M for meta rules about the instruction files
themselves), and each states what must hold, why, and where it is
enforced. Rules change through one path: the PR that hit a problem
proposes the rule change, and the maintainer merges or rejects it. A
**contract** is a rule scoped to one subsystem. Each contract names what
the subsystem owns, the sanctioned path through it, the bypasses that are
always bugs, and the gate that checks it.

A **gate** is a script that enforces a rule. Rule M1 requires one for any
rule a script could check, added in the same change as the rule. M1 cites
the audit behind it, which found every ungated rule violated while every
gated rule held. Current gates: the unit suite, three
blocking lints, the ratcheted lint baseline, the quality ratchet and
proven-red check described under "How the pieces fit", and
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__,
which checks the instruction files themselves: symbols named in contracts
exist in the code, the core file contains no project names, the
instruction files stay under a word budget, commit hashes cited as
evidence exist in history, the knowledge files contain no emails or IP
addresses, and rule IDs cited in this guide resolve. Branch protection on
``main`` requires these checks, so a PR cannot merge before they pass;
merges queue with GitHub auto-merge and land when the checks go green.
Rule M2 requires checking a gate's input as well as its exit code. A
number a gate reports has to describe the thing it claims to measure, and
a gate that reads the wrong input can pass while its rule is broken.

A **practice** is advisory guidance in the playbooks under
`agents/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents>`__:
how to structure multi-agent work, when review ceremony is worth it, which
model tier fits which kind of task, and the accumulated domain facts.
Practices cite evidence (commit hashes, a validation date) instead of
carrying IDs, load only when the work touches their area, and lose to
rules on any conflict. A practice becomes a rule through the
self-improvement protocol, when a breakage or review finding shows the
practice would have prevented it.

Rules also get removed. Instructions are audited for cost, because every
rule adds to the context of every future session whether or not it
prevents anything. A July 2026 friction audit (abb96c79) is
the worked example: it found a verification step that duplicated what the
build already did, an e2e requirement with no size floor, and the same
facts copied into three files, and the fix deleted more instruction text
than it added. A rule that turns out to be wrong or merely expensive
is removed through a maintainer-approved diff, like any other rule change.

How the pieces fit
------------------

.. mermaid::

   graph TD
     CL["CLAUDE.md<br/>(Claude Code shim)"] --> AG["AGENTS.md<br/>rules I / P / C / M"]
     CL --> AP["AGENTS.project.md<br/>18 contracts + project rules"]
     AG -. "read before any work" .-> AP
     AP -- "table: read for your area" --> PP["agents/project/<br/>testing, docs, native,<br/>data-integrity, llm-models,<br/>domain-context, glossary,<br/>out-of-scope"]
     CL -- "multi-agent work" --> GP["agents/generic/<br/>claude-workflows.md"]
     AG === GATE["agents-contracts.test.ts<br/>symbols exist, purity, word budget,<br/>evidence hashes, privacy, doc refs, headings"]
     AP === GATE
     PP === GATE
     GP === GATE
     CL === GATE
     PR["every PR"] === CI["ci.yml<br/>tests, lints, build,<br/>proven-red"]
     GATE --> CI
     FAIL["breakage or review finding"] -- "fix PR proposes rule + gate<br/>(self-improvement protocol)" --> AG
     FAIL -- "durable fact (M5)" --> PP
     FAIL -- "proven practice (M5)" --> GP

Solid arrows are load order in a session; the double lines are
enforcement; the bottom edges are the feedback loop that grows the files.

`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
at the repo root is the portable core; it contains nothing specific to
zmNinjaNg.
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__
holds the eighteen architecture contracts and the project rules. With the
contracts, an agent changing, say, settings behavior
reads the Settings contract instead of rediscovering the design from
source.

`agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__
holds the area playbooks (testing, documentation, native, data integrity,
LLM models), ``domain-context.md`` with the verified project facts (API
quirks, platform behavior, approaches that were tried and reverted),
``glossary.md`` with one name per concept and the words to stop using for
it, and ``out-of-scope.md``, the requests the maintainer has declined and
why, read before anyone proposes work.
`agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
holds workflow guidance that is not project-specific. Playbooks are read
when the work touches their area, so they can afford detail that the
always-loaded files cannot, and each fact has exactly one home: the
playbooks point at contracts rather than restating them, so a rule
changed in one place is less likely to drift in another.

Enforcement lives in ``app/src/tests/`` and the CI workflows. Covering
gates run before every commit; the full battery runs before a push or PR
(rule P3), as one command: ``npm run gates``.

Two gates check the tests rather than the code. The proven-red job
(`proven-red.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/proven-red.mjs>`__)
takes the test files a PR changed, runs them in a throwaway worktree that
holds the pre-change code, and fails when they pass there. A test that is
green on the code it claims to guard cannot catch the bug; the job enforces rule
P2. Three such tests had passed review here before the job
existed, each found only by stashing the fix and re-running by hand. The
job proves every changed unit test, whatever the PR title says; a title type
that carries no behavior change (``docs``, ``chore``, ``refactor``) only
excuses a source change that brings no test, as in a pure refactor. The job does
not ask for a red run from a lowered ratchet baseline or a new repo-hygiene
test under ``app/src/tests/``, because the previous commit holds no
violation for such a test to find. Instead, the author proves a new
assertion there red by adding a deliberate violation, watching the test
fail, and removing the violation before the change lands. The quality
ratchet
(`quality-ratchet.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/scripts/quality-ratchet.mjs>`__,
gated by ``quality-ratchet.test.ts``) records three counts in
``app/.quality-baseline.json`` and fails when any grows: test files that
mock the app's own stores, hooks, services, or components instead of
testing through them; assertions that only prove an element exists (rule
C6); and occurrences in agent and developer prose of terms the
`glossary <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/glossary.md>`__
lists under ``_Avoid_``. Each number may fall or hold; raising one needs a
reason in the commit message, the same rule as the lint ratchet. The
baseline started at 121 files, 302 assertions, and 115 terms.

Review still happens on every PR, done by agents rather than the
maintainer. The workflow in
`claude-workflows.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__
pairs an implementing agent with an independent reviewing agent for work
that involves judgment, and one whole-branch review runs before every PR.
That review has two parts in separate contexts: one agent checks the diff
against the contracts and playbooks, another checks it against the
acceptance lines the PR body quotes from its issue. The two reports stay
separate, because a change can follow every convention and still not do
what the issue asked; two same-day fix pairs in August 2026 (#375 and
#377, #379 and #380) passed every gate that way.
CI runs the full gate suite on every push. The
`claude.yml <https://github.com/ZoneMinder/zmNinjaNg/blob/main/.github/workflows/claude.yml>`__
workflow lets the maintainer bring an agent into any issue or PR by
mentioning it.

When something breaks despite all of this, the PR with the fix also
proposes the instruction change that would have prevented the break (with
its gate, per M1), and any durable fact learned along the way goes into
``domain-context.md`` (per M5).

A contract, end to end
----------------------

The Polling contract in
`AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__
reads:

.. code-block:: markdown

   ### Polling
   Owns: every recurring refresh interval.
   Path: `useBandwidthSettings` / `getBandwidthSettings` (`app/src/hooks/useBandwidthSettings.ts`).
   Never: literal interval values; users tune bandwidth globally.
   Gate: review.

That block is the *instruction*. An agent asked to add, say, a
refresh-every-30-seconds feature reads it and knows three things without
opening any source: recurring intervals belong to this subsystem, the only
sanctioned way to get one is the two named functions, and hardcoding
``30000`` is a bug even if it works.

The *gate* is one TypeScript test file,
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__,
which runs with the normal unit suite. For this contract it parses the
block, pulls every backticked token out of the ``Path:`` and ``Gate:``
lines, and checks each one against reality: tokens containing a slash must
exist as files (``app/src/hooks/useBandwidthSettings.ts``), bare tokens
must appear as words somewhere in ``app/src``
(``useBandwidthSettings``, ``getBandwidthSettings``). Rename or delete the
hook without updating the contract and the suite fails with
``Polling: symbol useBandwidthSettings not found in app/src`` until the
contract matches the code again. Because a stale name fails the suite,
the symbols and paths in ``Path:`` and ``Gate:`` lines stay current, and an
agent can trust them instead of re-deriving the design. The ``Owns:`` and
``Never:`` text gets no such check.

What the gate cannot check, review covers: nothing mechanical proves a new
``setInterval(30000)`` violates the ``Never:`` line, which is why the
``Gate:`` field says ``review``, and why review ceremony concentrates
on judgment. The same file also checks the instruction system itself
(core purity, word budget, evidence hashes, privacy, doc references,
headings).

Monthly scorecard review
------------------------

Gates miss drift that no one has written a gate for yet: duplication
spreading across files, tests that pass without asserting much, a
convention the code stopped following. The first of two periodic reviews
covers this. Roughly once a month, the maintainer has an agent run a
scorecard review of the whole codebase from a skill. Long sessions degrade
too, with a gate that was clear at the start of a session ignored by the
end of it; the scorecard re-runs those checks from a clean context.

The scorecard scores twelve weighted pillars (architecture, test quality,
code quality, DRY, type safety, error handling, security, convention
self-consistency, performance, documentation, tooling, accessibility and
i18n). Two constraints apply. A pillar only gets a number if a
command was actually run to produce the evidence, and test quality is
scored by what the suite would catch (assertion density, failure paths,
boundary cases, mock saturation), never by test count. As a probe, the
reviewer tries to name a plausible bug the suite would miss. If that takes
under a minute, the testing score is inflated. Output ends in a ranked fix list.

The repo has its own variant of this review as the
`fable-review <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/fable-review>`__
skill. It scores the same kind of pillars against this project's
contracts, refuses to run on any model other than Fable, and writes a
report under ``docs/superpowers/analysis/`` with enough detail per finding
(site, fix, verification, effort, risk, contracts implicated) for another
agent to execute it. The shape comes from
`issue #217 <https://github.com/ZoneMinder/zmNinjaNg/issues/217>`__: a
Fable review scored the codebase 7.5, an Opus session executed it in
`PR #218 <https://github.com/ZoneMinder/zmNinjaNg/pull/218>`__, and the
re-review scored 8.1.

Each ranked fix becomes an issue for an agent to work.
`Issue #281 <https://github.com/ZoneMinder/zmNinjaNg/issues/281>`__ shows
the full cycle: a scorecard run found React correctness gaps, coverage
measured against the wrong input, and import cycles; the hardening work
landed under that issue; and several of its checks (the cycle gate, the
scoped lint configs) stayed behind as permanent gates, so the next review
does not need to look for those problems again.

Mining history for lessons
--------------------------

The second periodic review audits the instruction files against the
commit history. The per-PR protocol only fires when someone notices in the
moment that a lesson was learned; the
`mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__
skill looks for lessons nobody recorded at the time. It walks the history looking at
reverts (something was tried and did not work), repeated fixes to the same subsystem (one misunderstanding
surfacing over and over), and fixes that an existing gate should have
caught. It reports candidate ``domain-context.md`` entries and candidate
contracts, each with the commit hashes that justify it. Its first run over
this repo's first 2,254 commits produced two contracts (auth tokens, and
an assistant tool-loop contract distilled from 63 fix commits on the same
failure class) and twenty domain-context entries.

Neither review is mandatory, and about once a month is plenty. Running
them after a heavy fix period works as well as a schedule. If a schedule
suits you, anything that can invoke the CLI works
(``claude -p "/mine-history"`` from cron or a calendar automation), and
Claude Code users can create a routine with the ``/schedule`` command.

Token economics
---------------

Two parts of the setup keep token spend down:

- Always-loaded context is capped: the instruction files sit under a
  word budget enforced by the gate (about 2k words, under 3k tokens per
  session), while detailed knowledge lives in playbooks that
  load only when the work touches their area.

  The budget works like the lint ratchet. The number is a constant in
  ``agents-contracts.test.ts``; every instruction-file edit that pushes
  the combined count over it fails the suite, and the choice is to trim
  wording or raise the constant, where a raise is a deliberate edit to
  the gate with the reason in the commit message.
- Implementation goes to subagents on the smallest model that fits the
  task, trivial gate-covered edits skip the dispatch entirely, and
  independent review runs only where judgment is involved. Plans embed
  their tests verbatim, so the design work happens once, in the planning
  session, and the implementing model copies tests and code from the plan.

The maintainer additionally runs
`tokless <https://github.com/HoangP8/tokless>`__, a local toolkit that
bundles several token-reduction tools: caveman (terse response style for
chat output), ponytail (a bias toward the smallest working change),
rtk (a CLI wrapper that compresses command output before it reaches the
model), codegraph (pre-indexed code structure queried instead of grepping
and reading files), and context-mode (runs analysis in a sandbox so raw
bytes stay out of the context window). None of it is required to work on
this repo.

Output compression is the reason rule P6 exists. In one
working session the rtk wrapper capped a commit count at 50 on a
2254-commit repo, hid a failing test behind a log-file path, and masked a
red gate's exit status through a pipeline, each caught only by rerunning
the bare command. A later session found bare
``git log`` silently capped at 50 again in a wrapped shell, detected only
because ``git rev-list --count`` disagreed. Compression tools save tokens
on reads but never wrap a gate, and their published savings claims get the
same M2 check as any other number a tool reports about itself.

Using this in your own project
------------------------------

Copy
`AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__
unchanged. It contains no zmNinjaNg names on purpose, and the purity gate
keeps it that way; project facts go in the other files.

Write an ``AGENTS.project.md`` for your codebase. Most of the work is the
contracts. Find the places where your code has one sanctioned path
(settings, HTTP, logging, state) and write an Owns / Path / Never / Gate
block for each, using real symbol names.

Copy
`agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__
and point it at your tree: your source directory, your forbidden-token
list, a word budget measured from your own files plus headroom. Copy
`agents/generic/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/generic>`__
as is, and start ``agents/project/`` with an empty ``domain-context.md``.
If the project has history, one ``mine-history`` run over all of it
produces most of the seed content.

Claude Code needs a two-line
`CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__
importing the two instruction files; other harnesses read ``AGENTS.md``
directly. The two periodic reviews are optional.

Do not start with thirty rules. A handful of contracts plus the core is
enough, and the protocol grows the rest one incident at a time.

Where everything lives
----------------------

- `AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`__, the portable rule core
- `AGENTS.project.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.project.md>`__, contracts and project rules
- `CLAUDE.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/CLAUDE.md>`__, the Claude Code shim
- `agents/generic/claude-workflows.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/generic/claude-workflows.md>`__, the portable workflow playbook
- `agents/project/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/agents/project>`__, area playbooks and `domain-context.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/domain-context.md>`__
- `docs/superpowers/ <https://github.com/ZoneMinder/zmNinjaNg/tree/main/docs/superpowers>`__, approved specs and implementation plans
- `agents-contracts.test.ts <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/tests/agents-contracts.test.ts>`__, the instruction-system gate
- `quality-ratchet.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/scripts/quality-ratchet.mjs>`__ and `proven-red.mjs <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/proven-red.mjs>`__, the gates on the tests themselves
- `glossary.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/glossary.md>`__ and `out-of-scope.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/agents/project/out-of-scope.md>`__, vocabulary and declined requests
- `mine-history <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/mine-history>`__, the history mining skill
- `fable-review <https://github.com/ZoneMinder/zmNinjaNg/tree/main/.claude/skills/fable-review>`__, the scored codebase review skill

What this asks of a contributor
-------------------------------

Human or agent, the entry points are the same: read ``AGENTS.md`` and
``AGENTS.project.md``, read the playbook for your area, and let the gates
run. If a rule seems wrong, propose a change through the protocol instead
of working around it. See
:doc:`09-contributing` for branches, commits, and verification commands.
