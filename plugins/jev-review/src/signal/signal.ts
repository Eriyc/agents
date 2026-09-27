import { z } from "zod";

import { getJevProviderConfig } from "../config/environment.js";
import { JevClient } from "../jev/client.js";

export const signalInputSchema = z.object({
  file: z.object({
    path: z.string().min(1).describe("Repository-relative path of the file being judged."),
    content: z.string().describe("Complete file content when practical; never silently truncate it.")
  }).strict(),
  question: z.string().min(1).describe("A specific yes/no judgment about this file."),
  yesMeans: z.string().min(1).describe("What a yes answer means in this context."),
  noMeans: z.string().min(1).describe("What a no answer means in this context."),
  context: z.string().min(1).optional().describe("Relevant rules, architecture, or neighboring files needed to judge the question.")
}).strict();

export const signalOutputSchema = z.object({
  path: z.string(),
  model: z.string(),
  evidenceProbability: z.number().min(0).max(1),
  probabilityYes: z.number().min(0).max(1).nullable()
}).strict();

export type SignalInput = z.infer<typeof signalInputSchema>;
export type SignalOutput = z.infer<typeof signalOutputSchema>;

export async function signalWithJev(
  rawInput: SignalInput,
  client?: Pick<JevClient, "evaluate">
): Promise<SignalOutput> {
  const input = signalInputSchema.parse(rawInput);
  const response = await (client ?? new JevClient(getJevProviderConfig())).evaluate(
    { file: input.file, ...(input.context ? { context: input.context } : {}) },
    {
      evidence: {
        type: "noul",
        instructions: `Does the supplied file and context contain enough evidence to judge this question about the file: ${input.question} Answer no when relevant relationships, requirements, or surrounding code are missing.`,
        criteria: {
          true: "The supplied state supports a defensible judgment about this specific file and question.",
          false: "Important context is missing; a judgment would be speculative."
        }
      },
      judgment: {
        type: "noul",
        instructions: input.question,
        criteria: { true: input.yesMeans, false: input.noMeans }
      }
    }
  );

  const evidence = response.answers.evidence;
  const judgment = response.answers.judgment;
  if (evidence?.type !== "noul" || judgment?.type !== "noul") {
    throw new Error("Jev omitted a required signal decision.");
  }

  return signalOutputSchema.parse({
    path: input.file.path,
    model: response.model,
    evidenceProbability: evidence.noul,
    probabilityYes: evidence.noul >= 0.5 ? judgment.noul : null
  });
}
