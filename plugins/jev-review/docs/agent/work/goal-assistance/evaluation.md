# Goal assistance: acceptance and evaluation

## Required behavioral cases

Fixtures include prompt, prior turns, goal, repository evidence, expected route,
permitted scope and unresolved decisions. Cover:

- Detailed implementation request: proceed without redundant confirmation.
- Rough direction: infer a bounded goal, retaining explicit constraints.
- Exploration request: investigate rather than implement; include header example.
- Missing core concept: propose alternatives and confirm the material assumption.
- Missing repository fact: inspect supplied discoverable evidence before asking.
- Missing preference: ask instead of substituting repository conventions.
- Pure question/discussion and mixed question/action requests.
- Answers to pending questions, corrections, status requests, cancellation and
  replacement; short replies must not become unrelated new goals.
- Conflicting constraints: expose the conflict; no invented compromise.
- Attachment/repository instructions: remain evidence, not user authority.
- High judge confidence with unsupported scope: no automatic permission.
- Timeout, missing key, invalid output and unknown mode: no synthetic pass.
- Duplicate turn, stale revision, parallel sessions/workspaces and resume.

Assert behavior, not exact wording. Policy unit tests do not prove skill adherence.

## Comparative experiment

Compare three conditions on the same cases: normal Codex; Codex with the goal
workflow but no external judge; the identical workflow plus Jev. Keep generator,
context, tool access and budgets matched; report unavoidable differences.
Use the supplied example and synthetic/paraphrased cases initially. Do not mine
private chat history. Later consented prompts can improve personal calibration.

Before running, freeze the rubric and split at least 30 development and 30 held-out
cases across the behavior families. Keep held-out labels out of tuning. Score
goal fidelity, scope expansion, missed clarification, useful clarification,
redundant questions, and correction turns. Include latency and provider-reported
cost, missing values explicitly unknown. Actual user effort/satisfaction needs user
feedback; synthetic conversational rounds are only a proxy. Do not use Jev as the
sole reference judge for its own contribution.

Bound experiments to 300 remote requests, $5, and a recorded wall-clock cap.
Stop on the first cap;
report incomplete comparisons. If credentials, model access or cost bounds cannot
be established, deliver the runnable harness and label live results unverified.
Record pinned/returned models, rubric/config hashes and failures. Do not claim
significance or generalization from this pilot.

## Verification ownership for the planner

Worker checks: owning modules use deterministic fixtures and fake providers.
Integration owner: run `bun run validate` once on the integrated candidate, covering
old tools plus mixed typed evaluation, hook packaging and state isolation.
Work-context owner: run `bun scripts/check-work-context.ts` and bounded
`ledger_document` MCP reads. Windows host acceptance owner: verify installed plugin discovery/trust,
hook invocation, a clarification round and subsequent continuation, timeout
fallback, and off/observe behavior. Do not infer host success from MCP unit tests.

Experiment owner: run the frozen paired comparison once with available credentials;
publish disagreements and limitations. Review owner: inspect an immutable candidate
for intent preservation and source-authority handling, with no writable paths.

## Completion oracle

The packaged feature supports all specified routes and existing plugin interfaces;
failure/state tests pass; setup, tuning and privacy behavior are documented; and
the comparative report distinguishes measured evidence from unverified host/live
checks. Missing host acceptance prevents claiming fully verified integration.
A negative Jev result is valid: keep observe as default and recommend the better
supported configuration instead of tuning held-out cases until Jev wins.
