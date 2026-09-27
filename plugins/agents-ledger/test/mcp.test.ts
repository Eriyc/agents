import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpServer } from "../src/mcp/server.js";
import { resolveBeadsExecutable } from "../src/ledger/command.js";
import type { RunCommand } from "../src/ledger/command.js";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function fixture(initialized = true) {
  const workspace = mkdtempSync(join(tmpdir(), "ledger-mcp-"));
  folders.push(workspace);
  const goalDir = "docs/agent/work/sample";
  const goal = join(workspace, "docs", "agent", "work", "sample");
  const beads = join(goal, ".beads");
  mkdirSync(goal, { recursive: true });
  if (initialized) mkdirSync(beads);
  writeFileSync(join(goal, "goal.md"), "# Goal\n\n## Acceptance\nPass.\n");
  const issue = { id: "demo-1", title: "Implement sample", status: "open", assignee: "", description: "Use goal.md", acceptance_criteria: "Pass checks", metadata: { writable_paths: ["src/", "README.md"] }, dependencies: [{ id: "demo-0", status: "closed", dependency_type: "blocks" }] };
  const location = { workspaceRoot: workspace, goalDir };
  const run: RunCommand = async (argv) => {
    if (argv[0] === "git") return `${workspace}\n`;
    if (argv.includes("where")) return JSON.stringify({ path: beads });
    if (argv.includes("ready")) return JSON.stringify([issue]);
    if (argv.includes("list")) return JSON.stringify([issue]);
    if (argv.includes("show")) return JSON.stringify([issue]);
    throw new Error(`unexpected command ${argv.join(" ")}`);
  };
  return { workspace, goal, beads, issue, location, run };
}

async function connected(run: RunCommand) {
  const server = createMcpServer(run);
  const client = new Client({ name: "ledger-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function message(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0];
  assert.equal(first?.type, "text");
  return first.text;
}

describe("agents-ledger MCP", () => {
  if (process.platform === "win32") it("finds an installed mise bd when MCP PATH omits mise", () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-mise-"));
    folders.push(root);
    const installed = join(root, "installs", "github-gastownhall-beads", "1.3.0", "bd.exe");
    mkdirSync(join(root, "installs", "github-gastownhall-beads", "1.3.0"), { recursive: true });
    writeFileSync(installed, "");
    const env = { PATH: "C:\\Windows\\System32", MISE_DATA_DIR: root };
    assert.equal(resolveBeadsExecutable(env), installed);
    assert.equal(resolveBeadsExecutable({ ...env, BEADS_PATH: "C:\\custom\\bd.exe" }), "C:\\custom\\bd.exe");
  });

  it("exposes bounded ledger tools over MCP", async () => {
    const f = fixture();
    const { client, close } = await connected(f.run);
    try {
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["ledger_init", "ledger_ready", "ledger_task", "ledger_document", "ledger_validate_receipt", "ledger_create", "ledger_depends", "ledger_note", "ledger_transition", "ledger_status_page"]);
      const ready = await client.callTool({ name: "ledger_ready", arguments: f.location });
      assert.equal(ready.isError, undefined);
      assert.match(message(ready), /demo-1 \| open \| Implement sample/);
      const task = await client.callTool({ name: "ledger_task", arguments: { ...f.location, issueId: "demo-1" } });
      assert.match(message(task), /demo-0 \(closed, blocks\)/);
      assert.match(message(task), /Writable paths: src\/, README.md/);
      const headings = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "goal", path: "goal.md", operation: "headings" } });
      assert.match(message(headings), /3: ## Acceptance/);
      const lines = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "goal", path: "goal.md", operation: "lines", startLine: 3, endLine: 4 } });
      assert.match(message(lines), /4: Pass\./);
      const chars = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "goal", path: "goal.md", operation: "characters", line: 4, startChar: 0, endChar: 4 } });
      assert.match(message(chars), /\nPass$/);
      writeFileSync(join(f.workspace, "receipt.yaml"), Bun.YAML.stringify({ task_id: "demo-1", status: "ready-for-coordinator", base_sha: "a".repeat(40), changed_paths: ["src/main.ts", "README.md"], checks: [{ command: "bun test", status: "passed", environment: "local", evidence: "tests passed" }], open_findings: [], next_action: "Review." }));
      const receipt = await client.callTool({ name: "ledger_validate_receipt", arguments: { ...f.location, issueId: "demo-1", receiptPath: "receipt.yaml" } });
      assert.match(message(receipt), /Worker receipt valid/);
      const page = await client.callTool({ name: "ledger_status_page", arguments: f.location });
      assert.equal(page.isError, true);
      assert.match(message(page), /created when ledger_init/);
      const ensured = await client.callTool({ name: "ledger_init", arguments: f.location });
      assert.match(message(ensured), /Ledger verified\. Local status page:/);
      const existing = message(ensured).match(/Local status page: (.+\.html)/)?.[1];
      assert.ok(existing);
      assert.equal(existsSync(existing), true);
      unlinkSync(existing);
    } finally { await close(); }
  });

  it("initializes the database and board together, then refreshes the board after MCP mutations", async () => {
    const f = fixture(false);
    let created = false;
    let status = "open";
    const commands: string[][] = [];
    const run: RunCommand = async (argv) => {
      commands.push(argv);
      if (argv[0] === "git") return f.workspace;
      if (argv.includes("init")) { assert.deepEqual(argv.slice(0, 2), ["bd", "init"]); mkdirSync(f.beads); return ""; }
      if (argv.includes("where")) return JSON.stringify({ path: f.beads });
      if (argv.includes("create")) { created = true; return "demo-1\n"; }
      if (argv.includes("close")) { status = "closed"; return ""; }
      if (argv.includes("update")) {
        if (argv.includes("--claim")) status = "in_progress";
        else if (argv.includes("blocked")) status = "blocked";
        else if (argv.includes("open")) status = "open";
        return "";
      }
      if (argv.includes("list")) return JSON.stringify(created ? [{ ...f.issue, status }] : []);
      if (argv.includes("ready")) return JSON.stringify(created && status === "open" ? [{ ...f.issue, status }] : []);
      if (argv.includes("dep")) return "";
      throw new Error("unexpected command " + argv.join(" "));
    };
    const { client, close } = await connected(run);
    let board = "";
    try {
      const absent = await client.callTool({ name: "ledger_status_page", arguments: f.location });
      assert.equal(absent.isError, true);
      assert.equal(existsSync(f.beads), false);
      const initialized = await client.callTool({ name: "ledger_init", arguments: f.location });
      assert.equal(initialized.isError, undefined);
      board = message(initialized).match(/Local status page: (.+\.html)/)?.[1] || "";
      assert.ok(board);
      assert.equal(existsSync(board), true);
      const invalid = await client.callTool({ name: "ledger_create", arguments: { ...f.location, title: "Bad path", description: "Test", acceptance: "Test", writablePaths: ["../secret"] } });
      assert.equal(invalid.isError, true);
      assert.equal(created, false);
      const createdIssue = await client.callTool({ name: "ledger_create", arguments: { ...f.location, title: "Implement sample", description: "Use goal.md", acceptance: "Pass checks", writablePaths: ["src/"], type: "task", priority: 2 } });
      assert.match(message(createdIssue), /Created demo-1/);
      assert.match(readFileSync(board, "utf8"), /Implement sample/);
      const dependency = await client.callTool({ name: "ledger_depends", arguments: { ...f.location, issueId: "demo-1", blockedById: "demo-0" } });
      assert.equal(dependency.isError, undefined);
      const note = await client.callTool({ name: "ledger_note", arguments: { ...f.location, issueId: "demo-1", note: "Evidence recorded" } });
      assert.equal(note.isError, undefined);
      const noReason = await client.callTool({ name: "ledger_transition", arguments: { ...f.location, issueId: "demo-1", action: "close" } });
      assert.equal(noReason.isError, true);
      assert.equal(status, "open");
      for (const [action, expected] of [["claim", "in_progress"], ["block", "blocked"], ["reopen", "open"], ["close", "closed"]] as const) {
        const result = await client.callTool({ name: "ledger_transition", arguments: { ...f.location, issueId: "demo-1", action, ...(["block", "close"].includes(action) ? { reason: "Reviewed evidence" } : {}) } });
        assert.equal(result.isError, undefined);
        assert.match(readFileSync(board, "utf8"), new RegExp('"status":"' + expected + '"'));
      }
      const located = await client.callTool({ name: "ledger_status_page", arguments: f.location });
      assert.equal(message(located), "Local status page: " + board);
      assert.ok(commands.some((argv) => argv.includes("--claim")));
      assert.ok(commands.some((argv) => argv.includes("--reason")));
    } finally {
      await close();
      if (board && existsSync(board)) unlinkSync(board);
    }
  });

  it("rejects a different Beads database, malformed JSON, and oversized packets", async () => {
    const f = fixture();
    mkdirSync(join(f.workspace, ".beads"));
    const wrong: RunCommand = async (argv, cwd) => argv.includes("where") ? JSON.stringify({ path: join(f.workspace, ".beads") }) : f.run(argv, cwd);
    const invalid: RunCommand = async (argv, cwd) => argv.includes("ready") ? "not JSON" : f.run(argv, cwd);
    const large: RunCommand = async (argv, cwd) => argv.includes("ready") ? JSON.stringify([{ ...f.issue, title: "x".repeat(3000) }]) : f.run(argv, cwd);
    for (const [run, expected] of [[wrong, /different Beads database/], [invalid, /malformed JSON/], [large, /ready packet is/]] as const) {
      const { client, close } = await connected(run);
      try {
        const result = await client.callTool({ name: "ledger_ready", arguments: f.location });
        assert.equal(result.isError, true);
        assert.match(message(result), expected);
      } finally { await close(); }
    }
  });

  it("routes concurrent requests to different goals without shared selected state", async () => {
    const f = fixture();
    const second = join(f.workspace, "docs", "agent", "work", "second");
    mkdirSync(join(second, ".beads"), { recursive: true });
    writeFileSync(join(second, "goal.md"), "# Second goal\n");
    const run: RunCommand = async (argv, cwd) => {
      if (argv[0] === "git") return `${f.workspace}\n`;
      if (argv.includes("where")) return JSON.stringify({ path: join(cwd, ".beads") });
      if (argv.includes("ready")) return JSON.stringify([{ ...f.issue, id: cwd === second ? "second-1" : "demo-1" }]);
      throw new Error("unexpected command");
    };
    const { client, close } = await connected(run);
    try {
      const [first, next] = await Promise.all([
        client.callTool({ name: "ledger_ready", arguments: f.location }),
        client.callTool({ name: "ledger_ready", arguments: { ...f.location, goalDir: "docs/agent/work/second" } })
      ]);
      assert.match(message(first), /demo-1/);
      assert.doesNotMatch(message(first), /second-1/);
      assert.match(message(next), /second-1/);
      assert.doesNotMatch(message(next), /demo-1/);
    } finally { await close(); }
  });

  it("enforces task, excerpt, and receipt byte limits without truncation", async () => {
    const f = fixture();
    const run: RunCommand = async (argv, cwd) => argv.includes("show") ? JSON.stringify([{ ...f.issue, description: "x".repeat(9000) }]) : f.run(argv, cwd);
    const { client, close } = await connected(run);
    try {
      const task = await client.callTool({ name: "ledger_task", arguments: { ...f.location, issueId: "demo-1" } });
      assert.equal(task.isError, true);
      assert.match(message(task), /task packet is/);
      writeFileSync(join(f.goal, "large.md"), `# ${"x".repeat(4200)}\n`);
      const excerpt = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "goal", path: "large.md", operation: "lines", startLine: 1, endLine: 1 } });
      assert.equal(excerpt.isError, true);
      assert.match(message(excerpt), /excerpt packet is/);
    } finally { await close(); }
    writeFileSync(join(f.workspace, "receipt.yaml"), "x".repeat(2049));
    const other = await connected(f.run);
    try {
      const receipt = await other.client.callTool({ name: "ledger_validate_receipt", arguments: { ...f.location, issueId: "demo-1", receiptPath: "receipt.yaml" } });
      assert.equal(receipt.isError, true);
      assert.match(message(receipt), /receipt is 2049 bytes/);
    } finally { await other.close(); }
  });

  it("rejects traversal, symlink escapes, raw Beads files, and unowned receipt paths", async () => {
    const f = fixture();
    const { client, close } = await connected(f.run);
    try {
      const traversal = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "workspace", path: "../secret", operation: "headings" } });
      assert.equal(traversal.isError, true);
      writeFileSync(join(f.beads, "secret.md"), "# Private\n");
      const raw = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "goal", path: ".beads/secret.md", operation: "headings" } });
      assert.equal(raw.isError, true);
      const outside = mkdtempSync(join(tmpdir(), "ledger-outside-"));
      folders.push(outside);
      writeFileSync(join(outside, "file.md"), "# Outside\n");
      symlinkSync(outside, join(f.workspace, "link"), process.platform === "win32" ? "junction" : "dir");
      const escaped = await client.callTool({ name: "ledger_document", arguments: { ...f.location, scope: "workspace", path: "link/file.md", operation: "headings" } });
      assert.equal(escaped.isError, true);
      assert.match(message(escaped), /escapes its root/);
      writeFileSync(join(f.workspace, "receipt.yaml"), Bun.YAML.stringify({ task_id: "demo-1", status: "blocked", base_sha: "a".repeat(40), changed_paths: ["README.md/child"], checks: [], open_findings: [], next_action: "Escalate." }));
      const receipt = await client.callTool({ name: "ledger_validate_receipt", arguments: { ...f.location, issueId: "demo-1", receiptPath: "receipt.yaml" } });
      assert.equal(receipt.isError, true);
      assert.match(message(receipt), /outside demo-1 ownership/);
    } finally { await close(); }
  });

  it("starts the committed Bun bundle as a stdio MCP server and reports missing bd", async () => {
    const f = fixture();
    const git = Bun.spawnSync(["git", "init", "--quiet", f.workspace], { stdout: "pipe", stderr: "pipe" });
    assert.equal(git.exitCode, 0, git.stderr.toString());
    const bundle = join(import.meta.dir, "..", "dist", "server.js");
    assert.equal(existsSync(bundle), true);
    const transport = new StdioClientTransport({ command: process.execPath, args: [bundle], cwd: f.workspace, env: { ...process.env, BEADS_PATH: join(f.workspace, "missing-bd") } });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      assert.equal((await client.listTools()).tools.length, 10);
      const result = await client.callTool({ name: "ledger_ready", arguments: f.location });
      assert.equal(result.isError, true);
      assert.match(message(result), /cannot start bd|missing-bd|ENOENT/);
    } finally { await client.close(); }
  });

  it("ships a portable registration pointing to the bundle", () => {
    const root = join(import.meta.dir, "..");
    const mcp = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers["agents-ledger"], { type: "stdio", command: "bun", args: ["${PLUGIN_ROOT}/dist/server.js"], cwd: "./" });
    assert.equal(existsSync(join(root, "dist", "server.js")), true);
  });
});
