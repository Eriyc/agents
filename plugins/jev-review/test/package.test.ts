import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "bun:test";

const root = join(import.meta.dir, "..");

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
  });
});
