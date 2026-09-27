# Work Ledger

The `agents-ledger` plugin provides planning and execution skills plus a local
Bun MCP server for bounded, read-only Beads context. Install Bun 1.4+ and `bd`
on the host. The committed `dist/server.js` needs no dependency installation.

The plugin's `mcp.json` starts `bun ${PLUGIN_ROOT}/dist/server.js`. Each MCP
call supplies an absolute `workspaceRoot` and a `goalDir` relative to it. The
server verifies that the goal has its own `.beads` database before returning
any issue data. Set `BEADS_PATH` in the MCP server environment if `bd` is not
on its PATH.

| Tool | Purpose |
| --- | --- |
| `ledger_ready` | Bounded ready issue list, optionally filtered by parent. |
| `ledger_task` | One issue's scope, dependencies, acceptance, and writable paths. |
| `ledger_document` | Numbered headings, lines, or a character slice from a routed file. |
| `ledger_validate_receipt` | Check a worker YAML receipt against the issue's writable paths. |
| `ledger_status_page` | Write a standalone HTML snapshot to the system temporary directory and return its path. |

The server does not claim, create, update, or close issues. The coordinator uses
`bd` for those actions. See [the design](docs/mcp-design.md) for the complete
contract and migration plan.

## Local status page

Ask the agent for a status page, or run the bundled Bun script yourself:

```powershell
bun scripts/status-page.ts --workspace D:\projects\agents\plugins\jev-review --goal docs/agent/work/goal-assistance
```

The command prints the absolute `.html` path. Open it in a browser as a local
file. It contains only issue IDs, titles, states, assignees, timestamps, and the
goal heading. It does not make network requests or start a server.

For updates while you watch, add `--watch`. Bun rewrites the same file every
three seconds, and the browser reloads it every five seconds. Press Ctrl+C to
stop. The full-height board has Open, In progress, and Blocked lanes with a
collapsible Done lane. Long lists scroll inside their lane. Ready issues are
marked within Open. An issue marked in progress does not prove an agent process
is still active.

For development, run `bun install` and `bun run validate` in this directory.
