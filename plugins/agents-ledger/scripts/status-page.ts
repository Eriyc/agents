import { resolve } from "node:path";
import { runCommand } from "../src/ledger/command.js";
import { writeStatusPage } from "../src/status/page.js";

function options(args: string[]): { workspace: string; goal: string; watch: boolean } {
  let workspace = process.cwd();
  let goal = "";
  let watch = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--watch") watch = true;
    else if (arg === "--workspace" || arg === "--goal") {
      const value = args[++index];
      if (!value) throw new Error(arg + " requires a value");
      if (arg === "--workspace") workspace = resolve(value);
      else goal = value;
    } else throw new Error("Unknown argument: " + arg);
  }
  if (!goal) throw new Error("Usage: bun scripts/status-page.ts --workspace <repo-root> --goal <relative-goal-dir> [--watch]");
  return { workspace, goal, watch };
}

const { workspace, goal, watch } = options(Bun.argv.slice(2));
const output = await writeStatusPage(workspace, goal, runCommand);
console.log(output);
if (watch) {
  console.error("Watching Beads every 3 seconds. Open the HTML file in a browser; press Ctrl+C to stop.");
  let running = true;
  process.on("SIGINT", () => { running = false; });
  process.on("SIGTERM", () => { running = false; });
  while (running) {
    await Bun.sleep(3000);
    if (!running) break;
    try { await writeStatusPage(workspace, goal, runCommand); }
    catch (error) { console.error("Status refresh failed: " + (error instanceof Error ? error.message : String(error))); }
  }
}
