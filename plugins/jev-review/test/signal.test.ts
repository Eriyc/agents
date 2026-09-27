import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import { signalInputSchema, signalWithJev } from "../src/signal/signal.js";
import type { JevResponse } from "../src/jev/schema.js";

const input = {
  file: { path: "src/service.ts", content: "export function serve() { return true; }" },
  question: "Does this file mix unrelated responsibilities?",
  yesMeans: "The file mixes independently changing responsibilities.",
  noMeans: "The file is cohesive.",
  context: "The neighboring router owns HTTP handling."
};

function response(evidence: number, judgment: number): JevResponse {
  return {
    model: "typesafe/jev-1.13",
    usage: { input_tokens: 100, output_tokens: 2 },
    answers: {
      evidence: { type: "noul", noul: evidence },
      judgment: { type: "noul", noul: judgment }
    }
  };
}

describe("one-off Jev signal", () => {
  it("sends the complete file, context, and two typed questions", async () => {
    let state: unknown;
    let questions: unknown;
    const result = await signalWithJev(input, {
      evaluate: async (receivedState, receivedQuestions) => {
        state = receivedState;
        questions = receivedQuestions;
        return response(0.91, 0.73);
      }
    });
    assert.deepEqual(state, { file: input.file, context: input.context });
    assert.deepEqual(questions, {
      evidence: {
        type: "noul",
        instructions: `Does the supplied file and context contain enough evidence to judge this question about the file: ${input.question} Answer no when relevant relationships, requirements, or surrounding code are missing.`,
        criteria: {
          true: "The supplied state supports a defensible judgment about this specific file and question.",
          false: "Important context is missing; a judgment would be speculative."
        }
      },
      judgment: {
        type: "noul", instructions: input.question,
        criteria: { true: input.yesMeans, false: input.noMeans }
      }
    });
    assert.deepEqual(result, { path: input.file.path, model: "typesafe/jev-1.13", evidenceProbability: 0.91, probabilityYes: 0.73 });
  });

  it("withholds the judgment when evidence is insufficient", async () => {
    const result = await signalWithJev(input, { evaluate: async () => response(0.2, 0.99) });
    assert.equal(result.evidenceProbability, 0.2);
    assert.equal(result.probabilityYes, null);
  });

  it("rejects incomplete input and missing decisions", async () => {
    assert.equal(signalInputSchema.safeParse({ ...input, yesMeans: "" }).success, false);
    await assert.rejects(signalWithJev(input, {
      evaluate: async () => ({ ...response(0.9, 0.4), answers: { evidence: { type: "noul", noul: 0.9 } } })
    }), /omitted a required signal decision/);
  });
});
