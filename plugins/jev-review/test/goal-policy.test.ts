import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  createDeterministicFakeGoalJudge,
  judgeAndRoute,
  selectGoalRoute
} from "../src/goal/policy.js";
import type { GoalAssessment, GoalSignal, IntentAssessment, GoalPolicyState } from "../src/goal/types.js";

const provenance = { source: "judge" as const, reference: "prompt" };
const signal = <T>(
  value: T | null,
  confidence = 0.5,
  source: "user" | "conversation" | "repository" | "judge" = "judge"
): GoalSignal<T> => ({
  raw: { value },
  value,
  provenance: source === "judge" ? provenance : { source },
  confidence
});

function intent(primary: IntentAssessment["primary"], secondary: IntentAssessment["secondary"] = []): GoalSignal<IntentAssessment> {
  const classification = secondary.length > 0 ? "mixed" : primary ?? "unknown";
  return signal({ classification, primary, secondary });
}

function assessment(overrides: Partial<GoalAssessment> = {}): GoalAssessment {
  return {
    intent: intent("implement"),
    relationship: signal("new"),
    activeGoalIntent: signal<"answer" | "discuss" | "investigate" | "implement">(null),
    goalControl: signal("continue"),
    goalStatus: signal("clear"),
    preservation: signal("preserved"),
    constraints: signal("covered"),
    scope: signal({ status: "supported", violations: [] }),
    completionEvidence: signal("defined"),
    evidenceSufficiency: signal("sufficient"),
    unresolvedChoices: signal([]),
    conflicts: signal([]),
    candidate: signal("defensible"),
    ...overrides
  };
}

describe("deterministic goal policy", () => {
  it("proceeds on a detailed, supported implementation request without redundant questions", () => {
    const result = selectGoalRoute(assessment());
    assert.equal(result.route, "proceed");
    assert.equal(result.reason, "supported-implementation");
  });

  it("asks to confirm an inferable rough direction", () => {
    const result = selectGoalRoute(assessment({ goalStatus: signal("inferable") }));
    assert.equal(result.route, "confirm-candidate");
    assert.equal(result.nextState.draftsCreated, 1);
  });

  it("routes investigation to a targeted discovery pass, then returns findings", () => {
    const needsDiscovery = assessment({
      intent: intent("investigate"),
      relationship: signal("refine"),
      goalStatus: signal("not-needed"),
      evidenceSufficiency: signal("needs-discovery")
    });
    const discovery = selectGoalRoute(needsDiscovery);
    assert.equal(discovery.route, "discover");
    assert.equal(discovery.nextState.discoveryPasses, 1);

    const complete = assessment({
      intent: intent("investigate"),
      goalStatus: signal("not-needed")
    });
    assert.equal(selectGoalRoute(complete, discovery.nextState).route, "answer");
  });

  it("discovers repository facts before asking the user", () => {
    const result = selectGoalRoute(assessment({
      unresolvedChoices: signal([{ kind: "fact", material: true, resolution: "discoverable", description: "existing API" }])
    }));
    assert.equal(result.route, "discover");
    assert.equal(result.reason, "discoverable-fact");
  });

  it("asks for a missing core concept when no defensible candidate exists", () => {
    const result = selectGoalRoute(assessment({
      goalStatus: signal("ambiguous"),
      unresolvedChoices: signal([{ kind: "concept", material: true, resolution: "requires-user", description: "target outcome" }]),
      candidate: signal("unavailable")
    }));
    assert.equal(result.route, "ask-missing-information");
  });

  it("confirms a candidate that depends on a material preference", () => {
    const result = selectGoalRoute(assessment({
      unresolvedChoices: signal([{ kind: "preference", material: true, resolution: "inferable", description: "navigation style" }])
    }));
    assert.equal(result.route, "confirm-candidate");
  });

  it("answers pure questions and preserves all three separate classifications", () => {
    const judgment = assessment({
      intent: intent("answer"),
      relationship: signal("unrelated"),
      goalStatus: signal("not-needed")
    });
    const result = selectGoalRoute(judgment);
    assert.equal(result.route, "answer");
    assert.equal(result.assessment.intent.value?.primary, "answer");
    assert.equal(result.assessment.relationship.value, "unrelated");
    assert.equal(result.assessment.goalStatus.value, "not-needed");
  });

  it("continues implementation when a short answer resolves a pending clarification", () => {
    const result = selectGoalRoute(assessment({
      intent: intent("answer"),
      relationship: signal("answer-to-clarification"),
      activeGoalIntent: signal("implement")
    }), { draftsCreated: 2, discoveryPasses: 1, userAnsweredSinceLastRound: true });
    assert.equal(result.route, "proceed");
    assert.equal(result.nextState.draftsCreated, 0);
    assert.equal(result.nextState.discoveryPasses, 0);
  });

  it("asks for context when a short answer has no active goal intent to continue", () => {
    const result = selectGoalRoute(assessment({
      intent: intent("answer"),
      relationship: signal("answer-to-clarification"),
      activeGoalIntent: signal<"answer" | "discuss" | "investigate" | "implement">(null)
    }));
    assert.equal(result.route, "ask-missing-information");
    assert.equal(result.reason, "insufficient-assessment");
  });

  it("applies a correction to the retained goal instead of treating it as a new answer", () => {
    const result = selectGoalRoute(assessment({
      intent: intent("answer"),
      relationship: signal("refine"),
      activeGoalIntent: signal("implement"),
      constraints: signal("covered")
    }));
    assert.equal(result.route, "proceed");
  });

  it("answers a status question while retaining the current goal and its round bounds", () => {
    const result = selectGoalRoute(assessment({
      intent: intent("answer"),
      relationship: signal("unrelated"),
      activeGoalIntent: signal("implement"),
      goalStatus: signal("clear")
    }), { draftsCreated: 1, discoveryPasses: 1 });
    assert.equal(result.route, "answer");
    assert.equal(result.assessment.goalStatus.value, "clear");
    assert.equal(result.nextState.draftsCreated, 1);
    assert.equal(result.nextState.discoveryPasses, 1);
  });

  it("starts replacement work in a fresh round and honors explicit cancellation", () => {
    const replacement = selectGoalRoute(assessment({
      intent: intent("implement"),
      relationship: signal("replace"),
      goalStatus: signal("inferable")
    }), { draftsCreated: 2, discoveryPasses: 1 });
    assert.equal(replacement.route, "confirm-candidate");
    assert.equal(replacement.nextState.draftsCreated, 1);
    assert.equal(replacement.nextState.discoveryPasses, 0);

    const cancelled = selectGoalRoute(assessment({
      intent: intent("answer"),
      goalControl: signal("cancel", 1, "user")
    }), { draftsCreated: 1, discoveryPasses: 1 });
    assert.equal(cancelled.route, "answer");
    assert.equal(cancelled.reason, "goal-cancelled");
    assert.equal(cancelled.nextState.draftsCreated, 0);
    assert.equal(cancelled.nextState.discoveryPasses, 0);
  });

  it("does not treat a judge-inferred cancellation as user authorization", () => {
    const result = selectGoalRoute(assessment({ goalControl: signal("cancel", 1) }));
    assert.equal(result.route, "ask-missing-information");
    assert.equal(result.reason, "cancellation-needs-user");
  });

  it("routes mixed answer and implementation requests according to the actionable intent", () => {
    const result = selectGoalRoute(assessment({ intent: intent("answer", ["implement"]) }));
    assert.equal(result.assessment.intent.value?.classification, "mixed");
    assert.equal(result.route, "proceed");
  });

  it("keeps unsupported scope visible and never proceeds despite high confidence", () => {
    const judgment = assessment({
      scope: { ...signal({ status: "supported", violations: ["native goal mode is not authorized"] }), confidence: 1 }
    });
    const result = selectGoalRoute(judgment);
    assert.equal(result.route, "ask-missing-information");
    assert.equal(result.reason, "unsupported-scope");
    assert.deepEqual(result.scopeViolations, ["native goal mode is not authorized"]);
  });

  it("asks when constraints conflict instead of averaging away the conflict", () => {
    const result = selectGoalRoute(assessment({
      constraints: signal("conflicted"),
      conflicts: signal(["preserve the old API", "remove the old API"])
    }));
    assert.equal(result.route, "ask-missing-information");
    assert.equal(result.reason, "conflicting-signals");
  });

  it("allows one discovery pass and then asks instead of repeating discovery", () => {
    const judgment = assessment({
      relationship: signal("refine"),
      evidenceSufficiency: signal("needs-discovery")
    });
    const state: GoalPolicyState = { draftsCreated: 0, discoveryPasses: 1 };
    const result = selectGoalRoute(judgment, state);
    assert.equal(result.route, "ask-missing-information");
    assert.equal(result.reason, "discovery-limit");
  });

  it("allows two candidate drafts at most and starts a fresh round after a user answer", () => {
    const judgment = assessment({ relationship: signal("refine"), goalStatus: signal("inferable") });
    const exhausted: GoalPolicyState = { draftsCreated: 2, discoveryPasses: 1 };
    const blocked = selectGoalRoute(judgment, exhausted);
    assert.equal(blocked.route, "ask-missing-information");
    assert.equal(blocked.reason, "refinement-limit");

    const answered = selectGoalRoute(judgment, { ...exhausted, userAnsweredSinceLastRound: true });
    assert.equal(answered.route, "confirm-candidate");
    assert.equal(answered.nextState.draftsCreated, 1);
    assert.equal(answered.nextState.discoveryPasses, 0);
  });

  it("uses a narrow deterministic fake judge and preserves raw answers and provenance", async () => {
    const judgment = assessment();
    const judge = createDeterministicFakeGoalJudge(judgment);
    const input = { userPrompt: "Please implement the requested behavior." };
    const first = await judgeAndRoute(judge, input);
    const second = await judgeAndRoute(judge, input);
    assert.deepEqual(first, second);
    assert.deepEqual(first.assessment.intent, judgment.intent);
    assert.deepEqual(first.assessment.intent.provenance, provenance);
    assert.deepEqual(first.assessment.intent.raw, { value: judgment.intent.value });
  });
});
