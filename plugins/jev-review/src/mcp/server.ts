import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { reviewInputSchema } from "../evaluation/input.js";
import { reviewWithJev } from "../evaluation/review.js";
import { evaluationSchema, type Evaluation } from "../evaluation/types.js";
import { signalInputSchema, signalOutputSchema, signalWithJev, type SignalInput, type SignalOutput } from "../signal/signal.js";

const SERVER_INSTRUCTIONS = [
  "Use jev_review after a coherent implementation: send the task and focused current diff, then inspect weak metrics and code yourself. Jev gives scores and rubric hints, not root causes.",
  "Fix only concrete issues, validate, and rescore meaningful changes with the prior structured response unchanged as previousEvaluation. Stop when no justified fix remains; requirements and checks outrank scores.",
  "Use jev_signal for a one-off yes/no file judgment. Supply the file and relevant context; treat its probability as a signal, not an automatic verdict. Never send secrets or unrelated files."
].join(" ");

export type ReviewHandler = (input: z.infer<typeof reviewInputSchema>) => Promise<Evaluation>;
export type SignalHandler = (input: SignalInput) => Promise<SignalOutput>;

export function createMcpServer(review: ReviewHandler = reviewWithJev, signal: SignalHandler = signalWithJev): McpServer {
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

  return server;
}

export async function runStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
}
