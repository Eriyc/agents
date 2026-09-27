---
name: plan-work-ledger
description: Turn a resolved repository brief into a bounded Beads work ledger for multi-agent implementation; do not execute the work.
---

# Plan work ledger

Convert a resolved brief into an executable Beads issue graph. Keep the user's selected planner/coordinator model and reasoning effort; any provider is supported, including Astra as coordinator. Describe work by role and required capability, not a fixed model allowlist.

For planned subagents, follow the user's session model/provider choices. When using OpenAI subagents, use only GPT-6 Luna (`gpt-6-luna`) with `xhigh` reasoning, including writers, reviewers, and nested delegates. For other providers, use their configured models and supported reasoning controls; do not translate OpenAI model IDs or effort names into assumed equivalents. Record the intended profiles and any unverified availability in the handoff. If the required profile is unavailable, report the constraint rather than silently substituting a model or effort. Later explicit user choices override these defaults.

Use the supplied brief. Otherwise select one only if exactly one `docs/agent/work/*/brief.md` is clearly active; else ask for its path. Read repository instructions, `docs/agent/work/README.md`, routed project context, the brief, and enough code to establish starting behavior. Reopen a settled product decision only when repository evidence contradicts it; record why.

Read [ledger design](references/ledger-design.md) before creating the ledger. It defines ownership, issue content, context limits, verification, and Jev routing.

Beads alone owns status, dependencies, claims, blockers, and `metadata.writable_paths`. Keep the completion oracle in stable `goal.md`; optional `decisions.md` and task specs hold durable rationale. Never create `state.yaml`, YAML task status, or another live checklist.

If the repository lacks Beads support, first create its work guide and context check, and establish MCP server availability. The check rejects live `state.yaml` and oversized routed instructions. Do not generate Beads agent instructions, Git hooks, or a repository-specific context adapter. Use this plugin's MCP tools for all Beads operations and bounded context. Agents do not invoke `bd` directly.

For a missing goal database, call `ledger_init` from a clean or isolated checkout. That single MCP action initializes Beads and creates the local HTML status board. Inspect any automatic commit. Use `ledger_create` and `ledger_depends` to build independently ownable issues with explicit writable paths, dependencies, acceptance, and exact references. Keep long specs/evidence in referenced Markdown, not issue history.

The board path returned by `ledger_init` is local to this checkout. Report it once or open it in a browser when the user wants the visual view. The MCP server refreshes an existing board after ledger actions; no watcher, port, editor setting, or agent-authored HTML is required.

Run the repository context check and the bounded MCP tools against the goal. Report graph, critical path, parallel waves, model choices, path ownership, unresolved escalation, goal directory, and `$run-work-ledger <goal-directory>`.
