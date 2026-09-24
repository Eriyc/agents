---
name: run-work-ledger
description: Execute a validated Beads work ledger with bounded context, owned writers, immutable reviews, and coordinator integration.
---

# Run work ledger

Drive the active Beads goal to its `goal.md` acceptance oracle. Use GPT-6 Sol light for persistent coordination or GPT-6 Luna Max for deeper bounded work; workers use only these profiles; report unavailability.

Use the supplied goal directory. If omitted, select one only when exactly one non-terminal Beads goal is clear. Read repository instructions and `docs/agent/work/README.md`. Beads alone owns mutable state; reject `state.yaml` or another live tracker. Repair missing adapter/infrastructure before execution; never fall back to YAML.

Use the bounded adapter: `devenv shell -- bun scripts/agent-context/beads.ts <goal-directory> ready`, then `devenv shell -- bun scripts/agent-context/beads.ts <goal-directory> task <issue-id>`. Retrieve only needed sections via `headings`, `read`, `slice`, or `repo-` variants. Fail rather than truncate above 2 KiB ready/receipt, 8 KiB task, or 4 KiB excerpt. Never inject `bd prime`, raw issue JSON/history, full issue lists, documents, or directory dumps.

Inspect HEAD, dirty/staged state, dependencies, base SHAs, and path ownership. Do not overwrite unrelated changes or dispatch concurrent writers with overlapping paths. Use safe worktree isolation when the execution request permits it.

Read and follow [execution protocol](references/execution-protocol.md) for claims, worker dispatch, Jev, receipts, integration, immutable review, recovery, commits, and acceptance.

Coordinator alone owns Beads mutation, shared seams/configuration, Git index, commits, and final acceptance. Give workers one selected packet and exact references. Default to two writers only when ownership and dependencies are independent. Continue until criteria have direct evidence or authorized deferment, or user authority/missing product decision blocks progress.
