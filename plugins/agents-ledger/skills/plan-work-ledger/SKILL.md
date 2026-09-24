---
name: plan-work-ledger
description: Turn a resolved repository brief into a bounded Beads work ledger for multi-agent implementation; do not execute the work.
---

# Plan work ledger

Convert a resolved brief into an executable Beads issue graph. Use GPT-6 Luna Max or GPT-6 Sol light; Report if neither is available.

Use the supplied brief. Otherwise select one only if exactly one `docs/agent/work/*/brief.md` is clearly active; else ask for its path. Read repository instructions, `docs/agent/work/README.md`, routed project context, the brief, and enough code to establish starting behavior. Reopen a settled product decision only when repository evidence contradicts it; record why.

Read [ledger design](references/ledger-design.md) before creating the ledger. It defines ownership, issue content, context limits, verification, and Jev routing.

Beads alone owns status, dependencies, claims, blockers, and `metadata.writable_paths`. Keep the completion oracle in stable `goal.md`; optional `decisions.md` and task specs hold durable rationale. Never create `state.yaml`, YAML task status, or another live checklist.

If the repository lacks Beads support, first create its work guide, bounded adapter and helpers, context check, and `bd` toolchain availability. The check rejects live `state.yaml` and oversized routed instructions. Do not generate Beads agent instructions or Git hooks. The adapter must reject raw `.beads` context and fail rather than truncate over 2 KiB ready/receipt, 8 KiB task, or 4 KiB excerpt; expose on-demand headings/read/slice for goal and repository Markdown.

For a missing goal database, run `bd init --skip-agents --skip-hooks --non-interactive` from a clean or isolated checkout; inspect any automatic commit. Create independently ownable issues with explicit writable paths, dependencies, acceptance, and exact references. Keep long specs/evidence in referenced Markdown, not issue history.

Run the repository context check and bounded adapter. Report graph, critical path, parallel waves, model choices, path ownership, unresolved escalation, goal directory, and `$run-work-ledger <goal-directory>`.
