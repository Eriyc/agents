# Beads execution protocol

## Claim and dispatch

Before claiming, verify dependencies, base SHA, frozen contracts, check prerequisites, non-overlapping `metadata.writable_paths`, and no conflicting staged/unowned changes. Claim only the selected issue: `bd update <id> --claim`.

Preflight each issue against the goal oracle: observable behavior, exact design/source baseline, owned paths, failure cases, focused checks, and external prerequisites. For a consequential shared contract or migration, obtain a short writer approach and one focused probe before dependent work. Resolve a concrete gap in the issue once; do not create a separate plan-review stage or repeatedly reapprove an unchanged plan.

Dispatch one ≤8 KiB packet with purpose, base SHA, owned/forbidden paths, behavior, checks, exact line-addressed references, stop conditions, and ≤2 KiB receipt contract. Workers must not mutate Beads/ledger docs, stage, commit, reset, or edit other paths; stop on contract/ownership ambiguity and claim only produced evidence.

For nontrivial coding issues, include the installed Jev Review skill. After a coherent validated slice, the owning writer runs one `jev_review`, diagnoses concrete issues against acceptance, fixes justified ones, and rescores once with the prior structured response unchanged as `previousEvaluation`. Keep task/diff/context comparable. A score change alone does not trigger more editing; unresolved concrete defects remain open. Exclude secrets/unrelated files. If Jev is unavailable, report it and proceed with focused checks.

## Receipt and evidence

Receipt fields only: `task_id`, `status`, full `base_sha`, `changed_paths`, checks (command/status/environment/evidence), `open_findings`, `next_action`. Validate with `ledger_validate_receipt`; receipt is a claim, not proof. Keep logs in referenced files. Summarize Jev baseline, score movement, and remaining concerns within the 2 KiB receipt; never store full responses in Beads or packets.

Map each criterion/target to the smallest representative check. Verify actual command, exit status, selected tests/targets, candidate state, toolchain, services, fixtures, and environment. Command names, summaries, or matching counts do not prove coverage. Reuse valid evidence for unchanged inputs.

## Integration and review

Coordinator checks path ownership, diff, and focused evidence; stages exact paths, commits the candidate, and updates Beads. For substantive coordinator-owned corrections, use the writer Jev rule before a new candidate. When independently scored slices create consequential interface/shared-seam risk, run one `jev_review` on the focused integrated diff after checks, with goal and relevant contracts. Skip unchanged independent slices and ledger-only edits. Fix justified findings, rerun affected checks, and rescore once with unchanged `previousEvaluation`.

Jev is feedback, not an acceptance gate or independent review. Do not add routine reviewers for issues the owner can fix. Keep goal-required independent review on an immutable integrated candidate or separately justified high-risk question. Read-only review names base/candidate SHAs and one question; findings specify severity, file/line, violated criterion, consequence, smallest fix. Optional polish does not block acceptance. Reproduce valid findings, dispatch bounded correction, then review only correction and affected behavior unless new evidence expands impact. After two correction rounds on a slice, coordinator diagnoses the cause and splits or replans the work, or records a genuine blocker in Beads. The round limit never waives a required criterion, failed check, or demonstrated defect.

## History, recovery, acceptance

Beads owns mutable state; Markdown holds stable specs/durable evidence. Issue claims, receipts, transitions, reviews, and waves are not commit boundaries. Fold evidence into source/integration commits. At most one mid-run ledger-only checkpoint for real handoff/external blocker; one terminal checkpoint only if no source commit can carry it.

Infer progress from Beads plus filesystem/command evidence, never title or elapsed time. After sustained silence, inspect once and steer once; if still stalled, release/replace claim from last accepted SHA without discarding useful work.

Integrate in dependency order. Run focused checks per candidate and broader checks once on coherent integrated candidate; repeat only when inputs change, failure invalidates evidence, or another target requires execution. Acceptance means criterion-to-evidence coverage, not exhaustive state combinations. Exercise each distinct contract per relevant target once. Keep runtime, browser, native, database, deployment, and target-OS evidence distinct. Close only with direct evidence for every criterion or explicitly authorized deferment.
