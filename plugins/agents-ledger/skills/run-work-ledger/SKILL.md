---
name: run-work-ledger
description: Execute a validated Beads work ledger with bounded context, owned writers, immutable reviews, and coordinator integration.
---

# Run work ledger

Drive the active Beads goal to its `goal.md` acceptance oracle. Keep the user's selected coordinator model and reasoning effort; any provider is supported, including Astra as coordinator.

Follow the user's session model/provider choices for subagents. When using OpenAI subagents, use only GPT-6 Luna (`gpt-6-luna`) with `xhigh` reasoning, including writers, reviewers, and nested delegates. For other providers, use their configured models and supported reasoning controls; do not translate OpenAI model IDs or effort names into assumed equivalents. Verify the dispatch tool supports the required profile and select it explicitly; avoid inheritance that would give a worker the coordinator's model or effort. Pass this policy to any worker allowed to delegate. If the required profile cannot be selected, report the constraint and do not dispatch a substitute. Later explicit user choices override these defaults.

Use the supplied goal directory. If omitted, select one only when exactly one non-terminal Beads goal is clear. Read repository instructions and `docs/agent/work/README.md`. Beads alone owns mutable state; reject `state.yaml` or another live tracker. Verify that this plugin's MCP tools and the goal-local Beads database are available before execution; never fall back to YAML or create a repository-specific adapter.

If a goal-local database is created or removed during execution, sync the VS Code workspace `beads.projects` setting as described in `plan-work-ledger`; the coordinator owns this shared configuration.

Call `ledger_ready`, then `ledger_task` for the selected issue. Supply the absolute Git worktree root as `workspaceRoot` and the relative goal directory as `goalDir` on every call. Use `ledger_document` for focused goal or workspace headings, lines, or character slices, and `ledger_validate_receipt` before accepting a worker receipt. The tools fail rather than truncate above 2 KiB ready/receipt, 8 KiB task, or 4 KiB excerpt. Never inject `bd prime`, raw issue JSON/history, full issue lists, documents, or directory dumps.

When the user wants a visual status snapshot, call `ledger_status_page` and return its local HTML path. The bundled Bun command in the plugin README can keep that file current with `--watch`; agents do not author page files or start a web server.

Inspect HEAD, dirty/staged state, dependencies, base SHAs, and path ownership. Do not overwrite unrelated changes or dispatch concurrent writers with overlapping paths. Use safe worktree isolation when the execution request permits it.

Read and follow [execution protocol](references/execution-protocol.md) for claims, worker dispatch, Jev, receipts, integration, immutable review, recovery, commits, and acceptance.

Coordinator alone owns Beads mutation, shared seams/configuration, Git index, commits, and final acceptance. Give workers one selected packet and exact references. Default to two writers only when ownership and dependencies are independent. Continue until criteria have direct evidence or authorized deferment, or user authority/missing product decision blocks progress.
