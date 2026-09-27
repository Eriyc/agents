import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { reviewInputSchema } from "../evaluation/input.js";
import { reviewWithJev } from "../evaluation/review.js";
import { evaluationSchema, type Evaluation } from "../evaluation/types.js";
import { evaluateWithJev } from "../jev/evaluate.js";
import { jevResponseSchema, type JevResponse } from "../jev/schema.js";
import { createGoalStateStore, type GoalStateUpdateResult } from "../goal/state.js";
import { signalInputSchema, signalOutputSchema, signalWithJev, type SignalInput, type SignalOutput } from "../signal/signal.js";
import { goalStateUpdateInputSchema, goalStateUpdateOutputSchema, jevEvaluateInputSchema } from "./goal.js";

const SERVER_INSTRUCTIONS = [
  "Use jev_review after a coherent implementation: send the task and focused current diff, then inspect weak metrics and code yourself. Jev gives scores and rubric hints, not root causes.",
  "Fix only concrete issues, validate, and rescore meaningful changes with the prior structured response unchanged as previousEvaluation. Stop when no justified fix remains; requirements and checks outrank scores.",
  "Use jev_signal for a one-off yes/no file judgment. Supply the file and relevant context; treat its probability as a signal, not an automatic verdict. Never send secrets or unrelated files.",
  "Use jev_evaluate for bounded JSON state and typed Choice, Score, or Noul questions through OpenRouter. Model answers are evidence, never user authorization.",
  "Use jev_goal_state_update only after handling a user goal, correction, or clarification. Supply the current session and workspace identity, event ID, and expected revision."
].join(" ");

export type ReviewHandler = (input: z.infer<typeof reviewInputSchema>) => Promise<Evaluation>;
export type SignalHandler = (input: SignalInput) => Promise<SignalOutput>;
export type EvaluateHandler = (input: z.infer<typeof jevEvaluateInputSchema>) => Promise<JevResponse>;
export type GoalStateUpdateHandler = (input: z.infer<typeof goalStateUpdateInputSchema>) => Promise<GoalStateUpdateResult>;

export function createMcpServer(
  review: ReviewHandler = reviewWithJev,
  signal: SignalHandler = signalWithJev,
  evaluate: EvaluateHandler = (input) => evaluateWithJev(input.state, input.questions),
  updateGoalState: GoalStateUpdateHandler = (input) => createGoalStateStore().update(input)
): McpServer {
  const server = new McpServer(
    { name: "jev-review", version: "0.2.1" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    "jev_review",
    {
      title: "Jev software-quality review",
      description:
        "Score a focused code change. Send the task, current diff, and only files or context needed to judge it. Inspect weak metrics yourself; after a justified fix and validation, rescore with the prior structured result as previousEvaluation. Jev returns scores and rubric hints, not a prose diagnosis.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true
      },
      inputSchema: reviewInputSchema,
      outputSchema: evaluationSchema
    },
    async (input) => {
      try {
        const evaluation = await review(input);
        return {
          content: [{ type: "text", text: JSON.stringify(evaluation) }],
          structuredContent: evaluation
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Jev Review failed unexpectedly.";
        return {
          isError: true,
          content: [{ type: "text", text: message }]
        };
      }
    }
  );

  server.registerTool(
    "jev_signal",
    {
      title: "Jev file judgment signal",
      description: "Judge a specific yes/no question about a supplied file. Send the full file when useful, plus relevant rules or neighboring context. Returns a yes probability, or null when the evidence probability says context is insufficient. The server does not read files itself.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: signalInputSchema,
      outputSchema: signalOutputSchema
    },
    async (input) => {
      try {
        const result = await signal(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Jev Signal failed unexpectedly.";
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    }
  );

  server.registerTool(
    "jev_evaluate",
    {
      title: "Jev typed evaluation",
      description: "Evaluate bounded JSON state with Choice, Score, or Noul questions through OpenRouter. The server receives only the state and questions you supply; it does not read repository files, attachments, or transcripts.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: jevEvaluateInputSchema,
      outputSchema: jevResponseSchema
    },
    async (input) => {
      try {
        const result = jevResponseSchema.parse(await evaluate(input));
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Jev evaluation failed unexpectedly.";
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    }
  );

  server.registerTool(
    "jev_goal_state_update",
    {
      title: "Record handled goal state",
      description: "Record a handled goal update in this session and workspace with an expected revision. Omitted fields retain their previous values; null clears a nullable field. Duplicate event IDs are idempotent and stale revisions do not overwrite state.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: goalStateUpdateInputSchema,
      outputSchema: goalStateUpdateOutputSchema
    },
    async (input) => {
      try {
        const result = goalStateUpdateOutputSchema.parse(await updateGoalState(input));
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Goal state update failed unexpectedly.";
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    }
  );

  return server;
}

export async function runStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
}
