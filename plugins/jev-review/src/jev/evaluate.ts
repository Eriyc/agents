import { getJevProviderConfig } from "../config/environment.js";
import { JevClient } from "./client.js";
import { parseJevState, type JevState } from "./schema.js";
import type { JevQuestions } from "./questions.js";
import type { JevProviderConfig } from "./provider.js";
import type { JevResponse } from "./schema.js";

export type JevEvaluationClient = Pick<JevClient, "evaluate">;

export type JevEvaluationDependencies = {
  providerConfig?: JevProviderConfig;
  client?: JevEvaluationClient;
};

/** Evaluate bounded JSON state with Jev-native Choice, Score, and Noul questions. */
export async function evaluateWithJev(
  state: JevState,
  questions: JevQuestions,
  dependencies: JevEvaluationDependencies = {}
): Promise<JevResponse> {
  const boundedState = parseJevState(state);
  const client = dependencies.client ?? new JevClient(dependencies.providerConfig ?? getJevProviderConfig());
  return client.evaluate(boundedState, questions);
}
