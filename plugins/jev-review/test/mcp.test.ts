import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createMcpServer } from "../src/mcp/server.js";
import { goalStateUpdateOutputSchema } from "../src/mcp/goal.js";
import { fakeEvaluation } from "./helpers.js";

describe("MCP server", () => {
  it("updates scoped goal state through the bundled server without a provider key", async () => {
    const pluginData = await mkdtemp(join(tmpdir(), "jev-mcp-goal-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/server.js"],
      cwd: process.cwd(),
      env: { ...process.env, OPENROUTER_API_KEY: "", PLUGIN_DATA: pluginData }
    });
    const client = new Client({ name: "goal-state-stdio-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const arguments_ = {
        identity: { sessionId: "session-a", workspaceId: "workspace-a" },
        expectedRevision: 0,
        eventId: "turn-a",
        sourceTurnId: "turn-a",
        goal: { text: "Implement the bounded feature", provenance: "accepted" }
      };
      const created = await client.callTool({ name: "jev_goal_state_update", arguments: arguments_ });
      const createdState = goalStateUpdateOutputSchema.parse(created.structuredContent);
      assert.equal(createdState.status, "updated");
      assert.equal(createdState.state?.revision, 1);
      const duplicate = await client.callTool({ name: "jev_goal_state_update", arguments: arguments_ });
      assert.equal(goalStateUpdateOutputSchema.parse(duplicate.structuredContent).status, "duplicate");
      const stale = await client.callTool({ name: "jev_goal_state_update", arguments: {
        ...arguments_, eventId: "turn-b"
      } });
      assert.equal(goalStateUpdateOutputSchema.parse(stale.structuredContent).status, "stale");
    } finally {
      await client.close();
      await rm(pluginData, { recursive: true, force: true });
    }
  });

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
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["jev_review", "jev_signal", "jev_evaluate", "jev_goal_state_update"]);
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
      const evaluation = await client.callTool({ name: "jev_evaluate", arguments: {
        state: { prompt: "A bounded question" },
        questions: { route: { type: "noul", instructions: "Is this a question?", criteria: { true: "yes", false: "no" } } }
      } });
      assert.equal(evaluation.isError, true);
      assert.match(JSON.stringify(evaluation.content), /OPENROUTER_API_KEY is not set/);
    } finally {
      await client.close();
    }
  });

  it("exposes machine-readable review and signal tools", async () => {
    const expected = fakeEvaluation();
    const expectedSignal = { path: "src/example.ts", model: "jev-latest", evidenceProbability: 0.95, probabilityYes: 0.2 };
    const expectedTyped = { model: "~typesafe/jev-latest", answers: {
      route: { type: "noul" as const, noul: 0.85 },
      intent: { type: "choice" as const, choice: "implement", probabilities: { implement: 0.9, answer: 0.1 }, confidence: 0.9 },
      fit: { type: "score" as const, score: 8, legend: { "8": "strong" }, probabilities: { "8": 0.8 }, confidence: 0.8 }
    } };
    const evaluationCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const server = createMcpServer(
      async () => expected,
      async () => expectedSignal,
      async (input) => {
        evaluationCalls.push(input);
        return expectedTyped;
      },
      async (input) => {
        updateCalls.push(input);
        return { status: "stale", state: null };
      }
    );
    const client = new Client({ name: "jev-review-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["jev_review", "jev_signal", "jev_evaluate", "jev_goal_state_update"]);

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
      const typed = await client.callTool({ name: "jev_evaluate", arguments: {
        state: { prompt: "Inspect intent", savedGoal: null },
        questions: {
          route: { type: "noul", instructions: "Is this a question?", criteria: { true: "yes", false: "no" } },
          intent: { type: "choice", instructions: "Choose intent", criteria: { implement: "write code", answer: "answer only" } },
          fit: { type: "score", instructions: "Score fit", criteria: ["weak", "strong"] }
        }
      } });
      assert.deepEqual(typed.structuredContent, expectedTyped);
      assert.deepEqual(evaluationCalls, [{
        state: { prompt: "Inspect intent", savedGoal: null },
        questions: {
          route: { type: "noul", instructions: "Is this a question?", criteria: { true: "yes", false: "no" } },
          intent: { type: "choice", instructions: "Choose intent", criteria: { implement: "write code", answer: "answer only" } },
          fit: { type: "score", instructions: "Score fit", criteria: ["weak", "strong"] }
        }
      }]);
      const goalUpdate = await client.callTool({ name: "jev_goal_state_update", arguments: {
        identity: { sessionId: "session-a", workspaceId: "workspace-a" },
        expectedRevision: 0,
        eventId: "turn-a",
        sourceTurnId: "turn-a",
        goal: { text: "Complete the requested feature", provenance: "accepted" }
      } });
      assert.deepEqual(goalUpdate.structuredContent, { status: "stale", state: null }, JSON.stringify(goalUpdate));
      assert.equal(updateCalls.length, 1);
      const invalidUpdate = await client.callTool({ name: "jev_goal_state_update", arguments: {
        identity: { sessionId: "session-a", workspaceId: "workspace-a" },
        expectedRevision: -1,
        eventId: "turn-b",
        sourceTurnId: "turn-b"
      } });
      assert.equal(invalidUpdate.isError, true);
      assert.equal(updateCalls.length, 1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
