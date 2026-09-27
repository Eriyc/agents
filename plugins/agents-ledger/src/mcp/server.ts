import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readyPacket, taskPacket } from "../ledger/beads.js";
import { runCommand, type RunCommand } from "../ledger/command.js";
import { documentPacket, type DocumentRequest } from "../ledger/documents.js";
import { addDependency, appendNote, createIssue } from "../ledger/mutations.js";
import { route, routeGoal, type Route } from "../ledger/paths.js";
import { validateReceipt } from "../ledger/receipt.js";
import { transitionIssue } from "../ledger/transitions.js";
import { refreshExistingStatusPage, statusPagePath, writeStatusPageForTarget } from "../status/page.js";

const location = { workspaceRoot: z.string().min(1), goalDir: z.string().min(1) };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const writeAction = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function response(work: () => Promise<string>): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true }> {
  return work().then((value) => ({ content: [{ type: "text" as const, text: value }] }), (error) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
  }));
}

export function createMcpServer(run: RunCommand = runCommand): McpServer {
  const server = new McpServer({ name: "agents-ledger", version: "0.4.1" }, {
    instructions: "Use explicit workspaceRoot and goalDir on every call. Route all Beads initialization, issue creation, dependencies, notes, and status transitions through these MCP tools. Only the coordinator calls mutation tools. Initialization creates the local HTML board; later MCP calls refresh it."
  });

  async function afterRead(target: Route, value: string): Promise<string> {
    try { await refreshExistingStatusPage(target, run); }
    catch (error) { console.error("Status board refresh failed: " + (error instanceof Error ? error.message : String(error))); }
    return value;
  }

  async function afterWrite(target: Route, value: string): Promise<string> {
    try { await refreshExistingStatusPage(target, run); return value; }
    catch (error) { return value + "\nBeads changed, but status board refresh failed: " + (error instanceof Error ? error.message : String(error)); }
  }

  server.registerTool("ledger_init", {
    title: "Initialize a goal ledger",
    description: "Ensure a goal-local Beads database and local HTML status board exist in one MCP action. Existing databases are validated, never reinitialized.",
    annotations: writeAction,
    inputSchema: z.object(location)
  }, (input) => response(async () => {
    const goal = await routeGoal(input.workspaceRoot, input.goalDir, run);
    const alreadyInitialized = existsSync(join(goal.goal, ".beads"));
    if (!alreadyInitialized)
      await run(["bd", "init", "--skip-agents", "--skip-hooks", "--non-interactive"], goal.goal);
    const target = await route(input.workspaceRoot, input.goalDir, run);
    try { return (alreadyInitialized ? "Ledger verified. " : "Ledger initialized. ") + "Local status page: " + await writeStatusPageForTarget(target, run); }
    catch (error) { throw new Error((alreadyInitialized ? "Beads verified" : "Beads initialized") + ", but status board creation failed: " + (error instanceof Error ? error.message : String(error))); }
  }));

  server.registerTool("ledger_ready", {
    title: "Ready Beads work",
    description: "List ready issue IDs, status, and titles for one goal (2 KiB maximum). Optionally narrow by parent issue.",
    annotations: readOnly,
    inputSchema: z.object({ ...location, parent: z.string().optional() })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterRead(target, await readyPacket(target, run, input.parent));
  }));

  server.registerTool("ledger_task", {
    title: "Bounded Beads task",
    description: "Read one issue's scope, acceptance, dependencies, and writable paths (8 KiB maximum).",
    annotations: readOnly,
    inputSchema: z.object({ ...location, issueId: z.string().min(1) })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterRead(target, await taskPacket(target, run, input.issueId));
  }));

  server.registerTool("ledger_document", {
    title: "Focused ledger document excerpt",
    description: "Read Markdown headings, numbered lines, or a character slice from a goal or workspace file. Specify fields for the selected operation; output is at most 2 KiB for headings or 4 KiB for excerpts.",
    annotations: readOnly,
    inputSchema: z.object({
      ...location,
      scope: z.enum(["goal", "workspace"]),
      path: z.string().min(1),
      operation: z.enum(["headings", "lines", "characters"]),
      filter: z.string().optional(),
      startLine: z.number().int().optional(),
      endLine: z.number().int().optional(),
      line: z.number().int().optional(),
      startChar: z.number().int().optional(),
      endChar: z.number().int().optional()
    })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    const common = { scope: input.scope, path: input.path };
    let request: DocumentRequest;
    if (input.operation === "headings") request = { ...common, operation: "headings", ...(input.filter === undefined ? {} : { filter: input.filter }) };
    else if (input.operation === "lines") {
      if (input.startLine === undefined || input.endLine === undefined) throw new Error("lines requires startLine and endLine");
      request = { ...common, operation: "lines", startLine: input.startLine, endLine: input.endLine };
    } else {
      if (input.line === undefined || input.startChar === undefined || input.endChar === undefined)
        throw new Error("characters requires line, startChar, and endChar");
      request = { ...common, operation: "characters", line: input.line, startChar: input.startChar, endChar: input.endChar };
    }
    return afterRead(target, documentPacket(target, request));
  }));

  server.registerTool("ledger_validate_receipt", {
    title: "Validate a Beads worker receipt",
    description: "Validate a workspace-relative YAML receipt against one issue's writable paths and the 2 KiB receipt contract. This validates claims, not the actual Git diff.",
    annotations: readOnly,
    inputSchema: z.object({ ...location, issueId: z.string().min(1), receiptPath: z.string().min(1) })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterRead(target, await validateReceipt(target, run, input.issueId, input.receiptPath));
  }));

  server.registerTool("ledger_create", {
    title: "Create one ledger issue",
    description: "Coordinator only. Create a bounded issue with ownership metadata; refresh the status board.",
    annotations: writeAction,
    inputSchema: z.object({ ...location, title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(8000), acceptance: z.string().trim().min(1).max(4000), writablePaths: z.array(z.string().min(1).max(300)).max(30), type: z.enum(["task", "epic", "chore", "decision", "bug", "feature", "spike", "story", "milestone"]).default("task"), priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2), parent: z.string().min(1).optional() })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterWrite(target, "Created " + await createIssue(target, run, input));
  }));

  server.registerTool("ledger_depends", {
    title: "Add a blocking dependency",
    description: "Coordinator only. Make one issue depend on another, then refresh the status board.",
    annotations: writeAction,
    inputSchema: z.object({ ...location, issueId: z.string().min(1), blockedById: z.string().min(1) })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterWrite(target, await addDependency(target, run, input.issueId, input.blockedById));
  }));

  server.registerTool("ledger_note", {
    title: "Append issue evidence",
    description: "Coordinator only. Append a bounded note to an issue, then refresh the status board.",
    annotations: writeAction,
    inputSchema: z.object({ ...location, issueId: z.string().min(1), note: z.string().trim().min(1).max(2000) })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterWrite(target, await appendNote(target, run, input.issueId, input.note));
  }));

  server.registerTool("ledger_transition", {
    title: "Change one issue's work state",
    description: "Coordinator only. Claim, block, reopen, or close one issue; refresh the status board after Beads succeeds.",
    annotations: writeAction,
    inputSchema: z.object({ ...location, issueId: z.string().min(1), action: z.enum(["claim", "block", "reopen", "close"]), reason: z.string().trim().min(1).max(500).optional() })
  }, (input) => response(async () => {
    const target = await route(input.workspaceRoot, input.goalDir, run);
    return afterWrite(target, await transitionIssue(target, run, input.issueId, input.action, input.reason));
  }));

  server.registerTool("ledger_status_page", {
    title: "Locate the local Beads status page",
    description: "Return the existing local HTML status board path. The board is created by ledger_init and refreshed by MCP ledger actions.",
    annotations: readOnly,
    inputSchema: z.object(location)
  }, (input) => response(async () => {
    const path = statusPagePath(await route(input.workspaceRoot, input.goalDir, run));
    if (!existsSync(path)) throw new Error("status board is missing; it is created when ledger_init initializes the goal database");
    return "Local status page: " + path;
  }));

  return server;
}

export async function runStdioServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}
