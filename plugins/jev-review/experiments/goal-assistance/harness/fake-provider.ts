import { jevResponseSchema } from "../../../src/jev/schema.js";
import { jevQuestions, type ExperimentConfig } from "./contracts.js";
import { fullyMeteredCapabilities, type ExperimentAdapters, type ProviderMode } from "./providers.js";

export function createFakeAdapters(config: ExperimentConfig, mode: ProviderMode = "offline"): ExperimentAdapters {
  return {
    generator: {
      provider: "codex",
      model: config.generator.model,
      mode,
      capabilities: fullyMeteredCapabilities,
      async generate(request) {
        return {
          provider: "codex",
          returnedModel: config.generator.model,
          output: `Fake provider output for ${request.caseId} (${request.condition}).`,
          remoteRequests: mode === "offline" ? 0 : 1,
          usage: { inputTokens: 100, outputTokens: 20, costUsd: mode === "offline" ? 0 : 0.0005 }
        };
      }
    },
    jev: {
      provider: "openrouter",
      model: config.judge.model,
      mode,
      capabilities: fullyMeteredCapabilities,
      async evaluate(_request) {
        const answers = Object.fromEntries(Object.entries(jevQuestions).map(([key, question]) => {
          if (question.type === "noul") return [key, { type: "noul", noul: 0.2 }];
          const choices = Object.keys(question.criteria);
          const chosen = choices[0]!;
          const remainingProbability = choices.length > 1 ? 0.2 / (choices.length - 1) : 0;
          const probabilities = Object.fromEntries(choices.map((choice) => [choice, choice === chosen ? 0.8 : remainingProbability]));
          return [key, { type: "choice", choice: chosen, probabilities, confidence: 0.8 }];
        }));
        const response = jevResponseSchema.parse({
          model: config.judge.model,
          answers,
          usage: { input_tokens: 100, output_tokens: 20 }
        });
        return {
          provider: "openrouter",
          returnedModel: response.model,
          answers: response.answers,
          remoteRequests: mode === "offline" ? 0 : 1,
          usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, costUsd: mode === "offline" ? 0 : 0.00025 }
        };
      }
    }
  };
}
