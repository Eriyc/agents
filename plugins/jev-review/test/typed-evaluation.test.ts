import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import { evaluateWithJev, type JevEvaluationClient } from "../src/jev/evaluate.js";
import type { JevQuestions } from "../src/jev/questions.js";
import { JevApiError, JevClient } from "../src/jev/client.js";
import { JEV_STATE_MAX_BYTES, type JevResponse, type JevState } from "../src/jev/schema.js";

const state: JevState = {
  prompt: "Should this candidate goal proceed?",
  facts: ["User requested a scoped implementation", { source: "current turn" }],
  accepted: false
};

const questions: JevQuestions = {
  intent: {
    type: "choice",
    instructions: "Classify the user's intent.",
    criteria: { answer: "Answer only", implement: "Implement work" }
  },
  scope: {
    type: "score",
    instructions: "Rate whether the scope is clear.",
    criteria: ["Unclear", "Clear"]
  },
  enough_evidence: {
    type: "noul",
    instructions: "Is there enough evidence?",
    criteria: { true: "Enough evidence", false: "Insufficient evidence" }
  }
};

const nativeResponse: JevResponse = {
  model: "typesafe/jev-latest",
  answers: {
    intent: {
      type: "choice",
      choice: "implement",
      probabilities: { answer: 0.1, implement: 0.9 },
      confidence: 0.9,
      explanation: "native answer field"
    },
    scope: {
      type: "score",
      score: 8,
      legend: { "1": "Unclear", "9": "Clear" },
      probabilities: { "8": 0.8 },
      confidence: 0.8
    },
    enough_evidence: { type: "noul", noul: 0.75 }
  },
  usage: { input_tokens: 23, output_tokens: 7, cost: 0.004 },
  provider: "TypeSafe",
  id: "request-id"
};

describe("typed Jev evaluation", () => {
  it("passes bounded arbitrary JSON state and mixed native questions through without a file wrapper", async () => {
    let receivedState: JevState | undefined;
    let receivedQuestions: JevQuestions | undefined;
    const client: JevEvaluationClient = {
      evaluate: async (candidate, candidateQuestions) => {
        receivedState = candidate;
        receivedQuestions = candidateQuestions;
        return nativeResponse;
      }
    };

    const result = await evaluateWithJev(state, questions, { client });

    assert.equal(receivedState, state);
    assert.deepEqual(receivedState, state);
    assert.deepEqual(receivedQuestions, questions);
    assert.deepEqual(result, nativeResponse);
  });

  it("uses the OpenRouter client for typed evaluation", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new JevClient({
      apiKey: "test-key",
      model: "typesafe/jev-latest",
      fetchImplementation: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json(nativeResponse);
      }
    });

    const result = await client.evaluate(state, questions);

    assert.deepEqual(requestBody?.state, state);
    assert.deepEqual(requestBody?.questions, questions);
    assert.deepEqual(result, nativeResponse);
  });

  it("rejects oversized or non-JSON state before calling an injected client", async () => {
    let calls = 0;
    const client: JevEvaluationClient = {
      evaluate: async () => {
        calls += 1;
        return nativeResponse;
      }
    };

    await assert.rejects(
      evaluateWithJev({ prompt: "x".repeat(JEV_STATE_MAX_BYTES) }, questions, { client }),
      /exceeds the 65536-byte limit/
    );
    await assert.rejects(
      evaluateWithJev({ invalid: Number.NaN } as unknown as JevState, questions, { client }),
      /finite numbers/
    );
    assert.equal(calls, 0);
  });

  it("validates native answers while preserving available metadata and allowing absent usage", async () => {
    const client = new JevClient({
      apiKey: "test-key",
      fetchImplementation: async () => Response.json({
        model: "jev-latest",
        answers: { evidence: { type: "noul", noul: 0.4, note: "kept" } },
        provider: "TypeSafe"
      })
    });

    const result = await client.evaluate(state, {
      evidence: { type: "noul", instructions: "Enough evidence?", criteria: { true: "yes", false: "no" } }
    });

    assert.equal(result.model, "jev-latest");
    assert.equal(result.answers.evidence?.type, "noul");
    assert.equal(result.answers.evidence?.type === "noul" && result.answers.evidence.noul, 0.4);
    assert.equal(result.provider, "TypeSafe");
    assert.equal("usage" in result, false);

    const invalid = new JevClient({
      apiKey: "test-key",
      fetchImplementation: async () => Response.json({
        model: "jev-latest",
        answers: { evidence: { type: "noul", noul: 1.4 } }
      })
    });
    await assert.rejects(invalid.evaluate(state, questions), JevApiError);
  });
});
