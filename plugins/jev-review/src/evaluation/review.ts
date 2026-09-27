import { reviewInputSchema, toJevState, type ReviewInput } from "./input.js";
import { buildJevQuestions } from "./questions.js";
import { toEvaluation } from "./transform.js";
import type { Evaluation } from "./types.js";
import { getJevProviderConfig } from "../config/environment.js";
import { JevClient } from "../jev/client.js";
import type { JevProviderConfig } from "../jev/provider.js";

export type ReviewDependencies = {
  apiKey?: string;
  providerConfig?: JevProviderConfig;
  client?: Pick<JevClient, "evaluate">;
};

export async function reviewWithJev(
  rawInput: ReviewInput,
  dependencies: ReviewDependencies = {}
): Promise<Evaluation> {
  const input = reviewInputSchema.parse(rawInput);
  const client = dependencies.client ?? new JevClient(
    dependencies.providerConfig ?? (dependencies.apiKey
      ? { apiKey: dependencies.apiKey }
      : getJevProviderConfig())
  );
  const response = await client.evaluate(toJevState(input), buildJevQuestions());
  return toEvaluation(response, input.previousEvaluation);
}
