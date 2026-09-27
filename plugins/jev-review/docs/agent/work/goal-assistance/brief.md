# Brief: Goal assistance in the Jev plugin

## User outcome

Help a user who often knows a direction but has not formulated an executable
goal. Reduce the effort of specifying work: infer a useful outcome and boundaries,
find repository facts, and ask helpful questions where intent remains unresolved.
Clear detailed prompts stay authoritative. Clarification is a feature, not a
failure or a metric to minimize in isolation. The user accepts fallible judgments
and wants tunable assistance, including eventual replacement of Jev.

## Scope and authority

The user requested exploration and a brief for plan-work-ledger, with the feature
co-located in `plugins/jev-review`. This packet is the input to later ledger
planning; it does not create a ledger, install hooks, or implement the feature.
The repository root for that work is `plugins/jev-review`, a nested Git checkout.
Do not modify the parent repository's other plugins.

Settled user requirements: classify prompts; distinguish clear, unclear, and
missing goals; generate and assess inferred goals; gather repository information;
ask when a good goal cannot be established; confirm inferred goals with unresolved
core concepts; retain the feature in this plugin. Questions should help the user
think, not demand that they supply a polished goal.

## Proposed v1 defaults

These are design recommendations resolving implementation scope, not claims of
explicit user selection. Adopt them unless implementation evidence contradicts
them; document a consequential change rather than silently widening scope.

- Add a goal-assistance skill and UserPromptSubmit integration to this plugin.
- Codex drafts goals and asks questions; a replaceable judge supplies bounded
  classifications and independent assessments; deterministic policy routes them.
- Expose general Jev Choice, Noul, and Score evaluation through the existing MCP.
  Preserve `jev_review`, `jev_signal`, TypeSafe and OpenRouter compatibility.
- Ship off, observe, and assist settings; initial default is observe. Assist is
  available explicitly and performs the requested clarification workflow.
- Goal inference never itself authorizes formal goal mode or implementation.
- Start with a bounded candidate/revision loop and per-session state; no generic
  agent framework, external MCP migration, or automatic preference learning.

## Packet routing

Read only the relevant bounded document for each work item:

- [behavior.md](behavior.md): intent, goals, questions, continuation semantics.
- [architecture.md](architecture.md): contracts, hook, state, failures, providers.
- [evaluation.md](evaluation.md): acceptance cases, experiments and verification.
- [evidence.md](evidence.md): repository starting points and external constraints.

The planner should derive `goal.md` from these acceptance conditions and create
Beads ownership/dependencies under this directory. Beads alone owns work status.
Keep product session state distinct from implementation ledger state.

## Planning boundaries

Freeze goal/judgment contracts before consumers. Candidate ownership groups are
typed evaluation/provider boundary, goal policy/state, hook/skill integration,
and fixtures/evaluation. Shared MCP registration, manifests, bundles, lockfiles,
and final docs need one integration owner. These groups are suggestions, not
pre-created issues or a parallel status system.

Completion means a packaged, tested, explicitly activatable assistance workflow
and a candid evaluation report. A measured win for Jev is not required. Default
activation beyond observe depends on evidence and user choice. Real Codex hook
acceptance must be reported separately from mocked contract tests.
