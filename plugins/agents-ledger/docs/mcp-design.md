# Work Ledger MCP server design

## Purpose

Move the bounded Beads context adapter out of every consumer repository and into
`agents-ledger`. The server is a local Bun process over MCP stdio. It reads and
mutates goal-local Beads state through `bd`, and reads selected repository files.
Only the coordinator may call its mutation tools. It does not own another issue
database or copy mutable issue state into plugin files.

The first release replaces PotSpot's `scripts/agent-context/beads.ts` and
`packet.ts` behavior. Planning and execution policy remains in the two skills.

## Packaging

```text
plugins/agents-ledger/
  mcp.json                 # portable plugin registration
  .mcp.json                # Claude plugin registration, if supported
  package.json             # pinned Bun, MCP SDK, Zod dependencies
  src/server.ts            # stdio entrypoint
  src/mcp/server.ts        # tool registration and MCP error mapping
  src/ledger/paths.ts      # workspace and goal routing
  src/ledger/beads.ts      # bounded bd reads and projection
  src/ledger/mutations.ts  # bounded issue creation, dependencies, notes
  src/ledger/transitions.ts # coordinator status changes
  src/status/page.ts       # local HTML board generation and refresh
  assets/status.html       # bundled, self-contained board template
  src/ledger/documents.ts  # bounded file excerpts
  src/ledger/receipt.ts    # receipt validation
  dist/server.js           # committed Bun bundle for plugin installation
  test/                    # unit and MCP protocol tests
```

Use the same portable registration shape as Jev Review: `mcpServers.agents-ledger`
with `type: "stdio"`, `command: "bun"`, and
`args: ["${PLUGIN_ROOT}/dist/server.js"]`. Run `bun build` for the committed
bundle so installing the plugin does not require `bun install`. Keep stdout
exclusively for MCP messages; diagnostics go to stderr. The server requires a
working `bd` executable on the host and reports its absence as a tool error.
No HTTP listener or daemon is required. A local HTML board is generated from
Beads at initialization and rewritten after later MCP ledger calls.

## Routing and trust boundary

Every tool call requires:

- `workspaceRoot`: absolute path to the consumer repository or worktree root;
- `goalDir`: path relative to that root, for example
  `docs/agent/work/map-navigation`.

The server keeps no session-wide selected workspace or goal. Resolve both paths
on each call, canonicalize them, and reject a goal outside the workspace,
including traversal and symlink escapes. Require `goal.md` and `.beads/` in the
goal. Verify that `workspaceRoot` is the Git worktree root. Before reading
issues, run `bd --readonly --directory <goal> where --json` and verify
that its active Beads directory is that goal's `.beads/`; a metadata directory
alone is insufficient. This prevents an accidental fallback to a repository-root
database. Use `bd --readonly --directory <goal> ... --json` for all reads.

For document reads, accept only relative paths. `scope: "goal"` resolves from
the goal; `scope: "workspace"` resolves from the workspace. Resolve the target
with real paths, require a regular UTF-8 text file inside that scope, and deny
every `.beads` path component. Cap source files at 1 MiB before reading; a
larger file needs the agent's normal repository tools for inspection. Do not
execute document content.

## MCP tools

The original bounded read interface exposes four narrow tools. Each returns a small text packet; errors use MCP
`isError` with an actionable message. Do not return raw `bd` JSON alongside the
text, since that defeats the packet limit. All sizes are UTF-8 bytes of the
complete returned packet, measured before sending; never truncate silently.

| Tool | Input beyond routing | Output and limit |
| --- | --- | --- |
| `ledger_ready` | Optional Beads `parent` filter | Ready issue count, then `id | status | title`; 2 KiB. |
| `ledger_task` | `issueId` | One issue's title, status, assignee, dependency identities/statuses, `metadata.writable_paths`, description, and acceptance criteria; 8 KiB. |
| `ledger_document` | `scope`, `path`, `operation`, plus operation-specific range or heading filter | Numbered headings (2 KiB), numbered line range (4 KiB), or character slice of one line (4 KiB). |
| `ledger_validate_receipt` | `issueId`, `receiptPath` relative to workspace | Validation verdict and receipt byte count; 2 KiB input. |

`ledger_ready` runs `bd ready --brief --limit 0 --json`; the optional parent is
passed as an argument, never interpolated into a shell command. An oversized
ready list errors and asks the caller to narrow the parent or split the ledger.
`ledger_task` runs `bd show <id> --brief-deps --json`, requires exactly one exact
ID match, and projects only fields in the contract. Dependencies retain identity,
type, and status where available; they never include nested issue bodies.
Neither tool prints comments, history, notes, the database, or `bd prime`.

`ledger_document` has three operations:

- `headings`: Markdown heading text and line numbers, optionally filtered by a
  case-insensitive substring;
- `lines`: inclusive one-based `startLine` and `endLine`, each line numbered;
- `characters`: one-based `line`, zero-based Unicode code-point `startChar` and
  `endChar`, with an explicit range label.

Invalid, reversed, or out-of-file ranges error. Validate required fields for
the selected operation; the MCP input schema documents all operation fields.

`ledger_validate_receipt` reads YAML from a regular file inside the workspace.
It requires exactly `task_id`, `status`, `base_sha`, `changed_paths`, `checks`,
`open_findings`, and `next_action`. `task_id` must equal the requested issue;
`status` is `ready-for-coordinator` or `blocked`; `base_sha` is a full 40-digit
hex SHA; checks require nonempty command, environment, and evidence plus an
allowed status. Paths must be normalized repository-relative POSIX paths and
fit that issue's `metadata.writable_paths`. A writable path ending in `/` owns
descendants; a file path owns only that exact file. Reject `.beads` and ledger
state paths even if listed as writable. Return a verdict, not the receipt body.
Validation checks the receipt's shape and claimed ownership; the coordinator
still compares it with the actual diff and test evidence before updating Beads.

The coordinator also uses `ledger_init`, `ledger_create`, `ledger_depends`,
`ledger_note`, and `ledger_transition` for setup and mutation. Their arguments
are bounded and passed to `bd` as argv, with no shell. `ledger_init` performs
`bd init` only when the goal database is missing; it validates an existing
database without reinitializing it. The same call creates or refreshes the
local HTML board. `ledger_status_page` only returns the existing board path.
Successful MCP ledger calls refresh an existing board from read-only Beads
queries. The board is a disposable view, not authoritative state.

## Process behavior

Use `Bun.spawn` with an argv array, explicit cwd, captured stdout/stderr, a
10-second timeout, and a 1 MiB byte cap on `bd` output. Never invoke a shell.
Parse JSON only on successful exit and validate the expected fields before
projection. Make each request independent so concurrent calls for different
goals cannot share
mutable routing state. Read tools have read-only annotations; coordinator
mutation tools have write annotations. Staging and commits remain explicit
coordinator Git actions outside the MCP server.

## Migration and acceptance

1. Add the server, registration, committed bundle, and protocol tests to
   `agents-ledger`. Test multiple goal directories in one process, wrong-database
   routing, missing `bd`, symlink traversal, oversized packets, malformed Beads
   JSON, and receipt ownership.
2. On PotSpot, compare `ready`, `task`, excerpts, and receipt verdicts with the
   current adapter on representative goals. Keep its adapter temporarily as a
   fallback during this compatibility check.
3. Change the skills to call these tools and stop requiring each repository to
   create an adapter. Update PotSpot's work guide and `AGENTS.md`, then remove
   its redundant adapter when the plugin works in the installed host.
4. Verify installation in Codex and another supported MCP host. An MCP unit
   test alone does not prove the host loads `mcp.json` or can launch Bun and `bd`.

The first release left Beads initialization and mutations outside the MCP
server. Version 0.4 moves bounded setup and issue mutations into MCP while
preserving the single-coordinator write rule. Agents do not invoke `bd` directly.
