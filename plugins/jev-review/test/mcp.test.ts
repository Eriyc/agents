import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createMcpServer } from "../src/mcp/server.js";
import { fakeEvaluation } from "./helpers.js";

describe("MCP server", () => {
  it("starts the bundled stdio server under Bun and inherits provider environment", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/server.js"],
      cwd: process.cwd(),
      env: { ...process.env, OPENROUTER_API_KEY: "" }
    });
    const client = new Client({ name: "bun-stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["jev_review", "jev_signal"]);
      const result = await client.callTool({ name: "jev_review", arguments: { task: "Check environment" } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /OPENROUTER_API_KEY is not set/);
      const signal = await client.callTool({ name: "jev_signal", arguments: {
        file: { path: "src/example.ts", content: "export const answer = 42;" },
        question: "Does this file mix unrelated responsibilities?",
        yesMeans: "It mixes unrelated responsibilities.",
        noMeans: "Its responsibilities are cohesive."
      } });
      assert.equal(signal.isError, true);
      assert.match(JSON.stringify(signal.content), /OPENROUTER_API_KEY is not set/);
    } finally {
      await client.close();
    }
  });

  it("exposes machine-readable review and signal tools", async () => {
    const expected = fakeEvaluation();
    const expectedSignal = { path: "src/example.ts", model: "jev-latest", evidenceProbability: 0.95, probabilityYes: 0.2 };
    const server = createMcpServer(async () => expected, async () => expectedSignal);
    const client = new Client({ name: "jev-review-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["jev_review", "jev_signal"]);

      const result = await client.callTool({
        name: "jev_review",
        arguments: { task: "Test the MCP boundary", diff: "+ safe change" }
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent, expected);
      const signal = await client.callTool({ name: "jev_signal", arguments: {
        file: { path: "src/example.ts", content: "export const answer = 42;" },
        question: "Does this file mix unrelated responsibilities?",
        yesMeans: "It mixes unrelated responsibilities.",
        noMeans: "Its responsibilities are cohesive."
      } });
      assert.deepEqual(signal.structuredContent, expectedSignal);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
