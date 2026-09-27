import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { z } from "zod";

import { createJevGoalJudge, createGoalPromptSubmitHook } from "../src/goal/hook.js";

const root = join(import.meta.dir, "..");
const hookManifestSchema = z.object({
  hooks: z.object({
    UserPromptSubmit: z.array(z.object({
      hooks: z.array(z.object({
        type: z.literal("command"),
        command: z.string().min(1),
        timeout: z.number().int().positive()
      }).strict()).min(1)
    }).strict()).min(1)
  }).strict()
}).strict();

describe("portable Agent Plugins package", () => {
  it("points the MCP server at the bundled executable through PLUGIN_ROOT", () => {
    const plugin = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
    const mcp = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));
    const marketplace = JSON.parse(readFileSync(join(root, "..", "..", ".agents", "plugins", "marketplace.json"), "utf8"));

    assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    assert.deepEqual(mcp.mcpServers["jev-review"], {
      type: "stdio",
      command: "bun",
      args: ["${PLUGIN_ROOT}/dist/server.js"],
      cwd: "./"
    });
    assert.equal(existsSync(join(root, "dist", "server.js")), true);
    const marketplaceEntry = marketplace.plugins.find((entry: { name: string }) => entry.name === plugin.name);
    assert.equal(marketplaceEntry?.source.path, "./plugins/jev-review");
    assert.equal(plugin.skills, "./skills/");
    assert.equal(existsSync(join(root, "skills", "jev-review", "SKILL.md")), true);
    const codexMcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    const codexPlugin = JSON.parse(readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf8"));
    assert.equal(codexPlugin.mcpServers, "./.mcp.json");
    assert.deepEqual(codexMcp.mcpServers["jev-review"].env_vars, ["OPENROUTER_API_KEY", "JEV_MODEL"]);
    const hookManifest = hookManifestSchema.parse(JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8")));
    assert.equal(codexPlugin.hooks, "./hooks/hooks.json");
    assert.deepEqual(hookManifest.hooks.UserPromptSubmit, [{ hooks: [{
      type: "command",
      command: "bun ${PLUGIN_ROOT}/dist/goal/hook-entry.js",
      timeout: 15
    }] }]);
    assert.equal(existsSync(join(root, "dist", "goal", "hook-entry.js")), true);
    assert.equal(existsSync(join(root, "skills", "goal-assistance", "SKILL.md")), true);
  });

  it("sends only the submitted prompt and scoped saved state to automatic triage", async () => {
    const states: unknown[] = [];
    const judge = createJevGoalJudge({
      clientFactory: () => ({
        async evaluate(state) {
          states.push(state);
          throw new Error("No remote provider is used in this test.");
        }
      })
    });
    const hook = createGoalPromptSubmitHook({
      mode: "assist",
      judge,
      stateStore: {
        async read() { return { status: "missing" }; },
        async update() { return { status: "corrupt" }; }
      }
    });
    await hook({
      hook_event_name: "UserPromptSubmit",
      session_id: "session-a",
      turn_id: "turn-a",
      cwd: "C:/project",
      prompt: "Please help with this feature",
      transcript_path: "SECRET_TRANSCRIPT_PATH",
      attachments: [{ content: "SECRET_ATTACHMENT" }],
      repository_files: [{ content: "SECRET_REPOSITORY_FILE" }]
    });
    assert.equal(states.length, 1);
    const sent = JSON.stringify(states[0]);
    assert.match(sent, /Please help with this feature/);
    assert.doesNotMatch(sent, /SECRET_TRANSCRIPT_PATH|SECRET_ATTACHMENT|SECRET_REPOSITORY_FILE/);
  });
});
