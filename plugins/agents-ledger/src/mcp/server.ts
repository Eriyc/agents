import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readyPacket, taskPacket } from "../ledger/beads.js";
import { runCommand, type RunCommand } from "../ledger/command.js";
import { documentPacket, type DocumentRequest } from "../ledger/documents.js";
import { route } from "../ledger/paths.js";
import { validateReceipt } from "../ledger/receipt.js";
import { writeStatusPage } from "../status/page.js";

const location = { workspaceRoot: z.string().min(1), goalDir: z.string().min(1) };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function response(work: () => Promise<string>): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true }> {
  return work().then((value) => ({ content: [{ type: "text" as const, text: value }] }), (error) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
  }));
}

export function createMcpServer(run: RunCommand = runCommand): McpServer {
  const server = new McpServer({ name: "agents-ledger", version: "0.3.0" }, {
    instructions: "Use explicit workspaceRoot and goalDir on every call. These tools read bounded Beads and document context; only the coordinator changes Beads with bd."
  });

  server.registerTool("ledger_ready", {
    title: "Ready Beads work",
    description: "List ready issue IDs, status, and titles for one goal (2 KiB maximum). Optionally narrow by parent issue.",
    annotations: readOnly,
    inputSchema: z.object({ ...location, parent: z.string().optional() })
  }, (input) => response(async () => readyPacket(await route(input.workspaceRoot, input.goalDir, run), run, input.parent)));

  server.registerTool("ledger_task", {
    title: "Bounded Beads task",
    description: "Read one issue's scope, acceptance, dependencies, and writable paths (8 KiB maximum).",
    annotations: readOnly,
    inputSchema: z.object({ ...location, issueId: z.string().min(1) })
  }, (input) => response(async () => taskPacket(await route(input.workspaceRoot, input.goalDir, run), run, input.issueId)));

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
    return documentPacket(target, request);
  }));

  server.registerTool("ledger_validate_receipt", {
    title: "Validate a Beads worker receipt",
    description: "Validate a workspace-relative YAML receipt against one issue's writable paths and the 2 KiB receipt contract. This validates claims, not the actual Git diff.",
    annotations: readOnly,
    inputSchema: z.object({ ...location, issueId: z.string().min(1), receiptPath: z.string().min(1) })
  }, (input) => response(async () => validateReceipt(await route(input.workspaceRoot, input.goalDir, run), run, input.issueId, input.receiptPath)));

  server.registerTool("ledger_status_page", {
    title: "Create a local Beads status page",
    description: "Generate a standalone HTML snapshot from one goal in the system temporary directory. No port or web server. Run the bundled status-page.ts CLI with --watch to keep the file updated.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object(location)
  }, (input) => response(async () => {
    const path = await writeStatusPage(input.workspaceRoot, input.goalDir, run);
    return "Local status page: " + path + "\nSnapshot only. For automatic updates, run the plugin's scripts/status-page.ts with --watch.";
  }));

  return server;
}

export async function runStdioServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}
