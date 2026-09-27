# Work ledger execution

Beads in each goal directory owns live issue state, dependencies, claims, and writable paths. Install the Agents marketplace's Work Ledger plugin and use its MCP tools for bounded context and issue mutations. The MCP server needs Bun and `bd` on the host; restart Codex after installing or updating the plugin so its tools load.

For this repository, pass `workspaceRoot` as the absolute Git worktree root (`D:\projects\agents` on this host) and `goalDir` as `plugins/jev-review/docs/agent/work/goal-assistance` on every call:

- `ledger_ready` lists ready IDs, status, and titles (at most 2 KiB).
- `ledger_task` reads one issue's scope, acceptance, dependencies, and `metadata.writable_paths` (at most 8 KiB); supply `issueId`.
- `ledger_document` reads selected `goal` or `workspace` file headings, numbered lines, or a character slice (2 KiB headings; 4 KiB excerpts). Supply `scope`, `path`, `operation`, and the selected operation's range fields.
- `ledger_validate_receipt` checks one workspace-relative YAML receipt (at most 2 KiB) against the issue's writable paths. Supply `issueId` and `receiptPath`.
- `ledger_init` validates the existing goal database and prepares a local status board. `ledger_transition` and `ledger_note` are coordinator-only issue mutations.

The tools reject raw `.beads` files and oversized packets rather than truncating them. Narrow a document range or split an oversized issue. Do not inject `bd prime`, raw issue JSON/history, or whole documentation trees into worker prompts. If the MCP tools are missing, check the plugin installation and host restart before resuming ledger work.

The coordinator alone claims or updates issues through Work Ledger MCP tools, and alone stages and commits. Workers edit only their issue's `metadata.writable_paths` and do not change Beads, ledger documents, the Git index, or commits. Worker receipts contain only `task_id`, `status`, full `base_sha`, `changed_paths`, `checks` (command, status, environment, evidence), `open_findings`, and `next_action`. Receipt validation checks the claim's shape and ownership; the coordinator compares it with the actual diff and test evidence before changing Beads.
