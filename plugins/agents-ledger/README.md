# Work Ledger

The `agents-ledger` plugin provides planning and execution skills plus a local
Bun MCP server for Beads work. Install Bun 1.4+ and `bd` on the host. Agents use
MCP tools; the server invokes `bd` internally. The committed `dist/server.js`
needs no dependency installation.

The plugin's `mcp.json` starts `bun ${PLUGIN_ROOT}/dist/server.js`. Each MCP
call supplies an absolute `workspaceRoot` and a `goalDir` relative to it. The
server verifies that the goal has its own `.beads` database before returning
any issue data. Set `BEADS_PATH` in the MCP server environment if `bd` is not
on its PATH.

| Tool | Purpose |
| --- | --- |
| `ledger_init` | Initialize a missing goal database and create its local status board; validate an existing database and prepare its board. |
| `ledger_ready` | Bounded ready issue list, optionally filtered by parent. |
| `ledger_task` | One issue's scope, dependencies, acceptance, and writable paths. |
| `ledger_document` | Numbered headings, lines, or a character slice from a routed file. |
| `ledger_validate_receipt` | Check a worker YAML receipt against the issue's writable paths. |
| `ledger_create` | Create one issue with bounded content and ownership metadata. |
| `ledger_depends` | Add one blocking dependency. |
| `ledger_note` | Append bounded evidence to an issue. |
| `ledger_transition` | Claim, block, reopen, or close one issue. |
| `ledger_status_page` | Return the existing local HTML board path. |

Only the coordinator calls mutation tools. Every successful MCP ledger action
refreshes an existing board. See [the design](docs/mcp-design.md) for the
complete contract and migration plan.

## Local status page

`ledger_init` creates the local HTML file as part of goal setup. On a checkout
that already contains the database, the same tool validates it and prepares a
local board without reinitializing Beads. `ledger_status_page` only returns the
path; the coordinator can open it in a browser when a run begins. The server
rewrites it after MCP ledger calls, and the browser reloads every five seconds.
No watcher, network request, or web server is involved. The full-height board
has Open, In progress, and Blocked lanes with a collapsible Done lane. Long
lists scroll inside their lane. Ready issues are marked within Open. An issue
marked in progress does not prove an agent process is still active.

For development, run `bun install` and `bun run validate` in this directory.
