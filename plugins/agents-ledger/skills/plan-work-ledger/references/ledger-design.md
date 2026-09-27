# Beads ledger design

Repository `docs/agent/work/README.md` and the bounded adapter are authoritative.

## Graph and ownership

- Translate the brief into an observable completion oracle in `goal.md`. Keep settled decisions in the brief/decisions; Beads owns mutable task state.
- One issue = one behavior family and smallest owning capability. Freeze provider contracts before consumers. Specify acceptance, exact references, focused checks, forbidden paths, stop conditions, and receipt requirements; put long detail in bounded Markdown.
- Preflight each issue for observable behavior, a frozen design/source baseline, owned paths, failure cases, focused checks, and external prerequisites. For consequential shared contracts or migrations, ask the writer for a short approach and focused probe before dependent implementation. Resolve an evidenced gap once in the issue; plan review is not a separate approval loop.
- Give every mutable path one owner via `metadata.writable_paths`; parent/child paths overlap. Coordinator owns shared composition, lockfiles, generated registries, localization, and ledger mutation unless exclusively assigned.
- Review issues have empty writable paths and name an immutable candidate SHA. Each independent review has one question and scope; correction review covers defect, affected behavior, and impact on prior conclusions. Do not add plan-audit review.
- Define two correction rounds per slice before coordinator diagnosis and replanning/escalation. The limit never waives required acceptance or a demonstrated defect. Optional polish does not block acceptance, and valid evidence is reused when inputs are unchanged.
- Prefer two independent first-wave writers; more require independent ownership. Unknown SHA/evidence stays absent/null, never current HEAD by default.

If source inspection leaves a consequential, file-specific yes/no behavior question that changes ownership or acceptance, use Jev Review `jev_signal` with that file, exact question, distinct `yesMeans`/`noMeans`, and bounded context. Use the probability to guide further inspection; verify against code or executable checks when possible. Record question, evidence, and decision in rationale. Jev cannot settle product choices, replace missing evidence, or score the whole plan.

## Context and evidence

Ready list: ID/state/title only, ≤2 KiB. One task packet ≤8 KiB; excerpt ≤4 KiB; receipt ≤2 KiB. Never inject `bd prime`, raw issue JSON/history, whole files/goals, or documentation dumps. Split an issue or narrow heading/line references when over limit; never truncate acceptance.

For each shared/expensive verification gate, record purpose, owner, phase, environment, prerequisites, and coverage. Separate worker feedback, integrated-candidate checks, and platform acceptance. Reuse valid evidence by reference; similar command names or test counts do not prove equivalent coverage.

Require receipt fields: `task_id`, `status`, full `base_sha`, normalized `changed_paths`, checks (command/status/environment/evidence), `open_findings`, one `next_action`. Workers never mutate Beads/ledger docs, stage, or commit. Coordinator validates ownership and evidence before updating Beads.

For benchmarking only, keep durable `benchmark.md`: models, timestamps, attempts, contract changes, path collisions, coordinator repairs, SHAs, checks, findings, cold resume, exposed token/credit use. Optimize recoverability, ownership, and verifiability over speed alone.
