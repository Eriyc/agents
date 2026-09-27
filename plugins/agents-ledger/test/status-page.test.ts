import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "bun:test";
import { renderStatusPage, statusPagePath, statusSnapshot, writeStatusPage } from "../src/status/page.js";
import type { RunCommand } from "../src/ledger/command.js";

it("renders a self-contained, escaped local snapshot without a server", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "ledger-page-test-"));
  const goal = join(workspace, "docs", "agent", "work", "sample");
  mkdirSync(join(goal, ".beads"), { recursive: true });
  await Bun.write(join(goal, "goal.md"), "# Example goal\n");
  const target = { workspace, goal, beads: join(goal, ".beads") };
  const issue = { id: "demo-1", title: "Review </script><script>alert(1)</script>", status: "in_progress", assignee: "Ada", updated_at: "2026-09-27T10:00:00Z", heartbeat_at: "2026-09-27T10:01:00Z" };
  const run: RunCommand = async (args) => {
    if (args[0] === "git") return workspace;
    if (args.includes("where")) return JSON.stringify({ path: target.beads });
    if (args.includes("list")) {
      assert.equal(args.includes("--all"), true);
      return JSON.stringify([issue]);
    }
    if (args.includes("ready")) return JSON.stringify([issue]);
    throw new Error("unexpected command");
  };
  const output = statusPagePath(target);
  try {
    const snapshot = await statusSnapshot(target, run);
    assert.equal(snapshot.issues[0]?.assignee, "Ada");
    const html = renderStatusPage(snapshot);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /\\u003c\/script\\u003e/);
    assert.doesNotMatch(html, /https?:\/\//);
    const result = await writeStatusPage(workspace, "docs/agent/work/sample", run);
    assert.equal(result, output);
    assert.equal(existsSync(result), true);
    assert.match(readFileSync(result, "utf8"), /Work Ledger board/);
    assert.equal(result.startsWith(workspace), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    if (existsSync(output)) rmSync(output);
  }
});
