import { existsSync } from "node:fs";

const required = ["docs/agent/work/README.md", "docs/agent/work/goal-assistance/goal.md", "docs/agent/work/goal-assistance/.beads/metadata.json"];
for (const path of required) if (!existsSync(path)) throw new Error(`missing work context: ${path}`);
console.log("work context files present");
