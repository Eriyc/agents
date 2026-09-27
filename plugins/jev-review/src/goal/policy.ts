import type {
  GoalAssessment,
  GoalJudge,
  GoalJudgeInput,
  GoalPolicyReason,
  GoalPolicyResult,
  GoalPolicyState,
  GoalRoute,
  UnresolvedChoice
} from "./types.js";

const initialState: GoalPolicyState = {
  draftsCreated: 0,
  discoveryPasses: 0,
  userAnsweredSinceLastRound: false
};

function startState(state: GoalPolicyState, relationship: string | null): GoalPolicyState {
  if (
    state.userAnsweredSinceLastRound ||
    relationship === "new" ||
    relationship === "replace"
  ) return initialState;
  return {
    draftsCreated: state.draftsCreated,
    discoveryPasses: state.discoveryPasses,
    userAnsweredSinceLastRound: false
  };
}

function materialChoices(choices: readonly UnresolvedChoice[] | null): readonly UnresolvedChoice[] | null {
  if (choices === null) return null;
  return choices.filter((choice) => choice.material);
}

/** Deterministic routing over judge signals. It never calls the judge or writes goal prose. */
export function selectGoalRoute(
  assessment: GoalAssessment,
  state: GoalPolicyState = initialState
): GoalPolicyResult {
  const relationship = assessment.relationship.value;
  const started = startState(state, relationship);
  const intent = assessment.intent.value;
  const continuation = relationship === "answer-to-clarification" || relationship === "refine"
    ? assessment.activeGoalIntent.value
    : null;
  const hasIntent = intent?.primary !== null && intent?.primary !== undefined;
  const intentParts = intent ? [intent.primary, ...intent.secondary, continuation] : [];
  const requestsImplementation = intentParts.includes("implement");
  const requestsInvestigation = intentParts.includes("investigate");
  const explicitInvestigation = intent?.primary === "investigate";
  const scope = assessment.scope.value;
  const scopeViolations = scope ? [...scope.violations] : [];
  const hasScopeViolation = scope?.status === "violated" || scopeViolations.length > 0;

  const result = (
    route: GoalRoute,
    reason: GoalPolicyReason,
    consumed?: "draft" | "discovery"
  ): GoalPolicyResult => ({
    route,
    reason,
    assessment,
    scopeViolations,
    nextState: {
      draftsCreated: consumed === "draft"
        ? (started.draftsCreated === 0 ? 1 : 2)
        : started.draftsCreated,
      discoveryPasses: consumed === "discovery" ? 1 : started.discoveryPasses,
      userAnsweredSinceLastRound: false
    }
  });

  const ask = (reason: GoalPolicyReason) => result("ask-missing-information", reason);

  if (assessment.goalControl.value === "cancel") {
    const source = assessment.goalControl.provenance.source;
    if (source === "user" || source === "conversation") {
      return {
        ...result("answer", "goal-cancelled"),
        nextState: initialState
      };
    }
    return ask("cancellation-needs-user");
  }

  const discover = (reason: GoalPolicyReason): GoalPolicyResult => {
    if (started.draftsCreated === 2) return ask("refinement-limit");
    if (started.discoveryPasses === 1) return ask("discovery-limit");
    return result("discover", reason, "discovery");
  };

  const confirmCandidate = (): GoalPolicyResult => {
    if (started.draftsCreated === 2) return ask("refinement-limit");
    return result("confirm-candidate", "candidate-needs-confirmation", "draft");
  };

  if (!hasIntent || intent === null || intent.classification === "unknown") {
    return ask("insufficient-assessment");
  }

  if (
    (relationship === "answer-to-clarification" || relationship === "refine") &&
    assessment.activeGoalIntent.value === null &&
    !intentParts.includes("implement") &&
    !intentParts.includes("investigate")
  ) return ask("insufficient-assessment");

  if (!requestsImplementation && !requestsInvestigation) {
    return result("answer", "answer-or-discussion");
  }

  if (assessment.conflicts.value === null || assessment.constraints.value === null) {
    return ask("insufficient-assessment");
  }
  if (assessment.conflicts.value.length > 0 || assessment.constraints.value === "conflicted") {
    return ask("conflicting-signals");
  }
  if (scope === null) return ask("insufficient-assessment");
  if (hasScopeViolation) return ask("unsupported-scope");

  const choices = assessment.unresolvedChoices.value;
  if (choices === null) return ask("insufficient-assessment");
  const material = materialChoices(choices);
  if (material === null) return ask("insufficient-assessment");
  const discoverableFact = material.some(
    (choice) => choice.kind === "fact" && choice.resolution === "discoverable"
  );
  if (assessment.evidenceSufficiency.value === "needs-discovery" || discoverableFact) {
    return discover(discoverableFact ? "discoverable-fact" : "evidence-discovery-needed");
  }
  if (assessment.evidenceSufficiency.value === null || assessment.evidenceSufficiency.value === "insufficient") {
    return ask("insufficient-evidence");
  }

  if (requestsInvestigation && !requestsImplementation && assessment.evidenceSufficiency.value === "sufficient") {
    return result("answer", "investigation-complete");
  }

  if (assessment.relationship.value === null || assessment.goalStatus.value === null) {
    return ask("insufficient-assessment");
  }
  if (assessment.preservation.value === null) return ask("insufficient-assessment");
  if (assessment.preservation.value === "at-risk") return ask("outcome-not-preserved");
  if (assessment.constraints.value === "missing") return ask("constraint-not-covered");
  if (assessment.completionEvidence.value === null) return ask("insufficient-assessment");
  if (assessment.completionEvidence.value === "missing") return ask("completion-evidence-missing");

  if (material.length > 0) {
    const needsUser = material.some((choice) => choice.resolution !== "discoverable");
    if (needsUser) {
      if (assessment.candidate.value === "defensible") return confirmCandidate();
      return ask("missing-goal");
    }
    return ask("insufficient-evidence");
  }

  if (assessment.goalStatus.value === "ambiguous" || assessment.goalStatus.value === "absent") {
    if (assessment.candidate.value === "defensible") return confirmCandidate();
    return ask("missing-goal");
  }
  if (assessment.goalStatus.value === "inferable") {
    if (assessment.candidate.value === "defensible") return confirmCandidate();
    return ask("missing-goal");
  }

  if (requestsImplementation) return result("proceed", "supported-implementation");
  if (explicitInvestigation) return result("answer", "investigation-complete");
  if (requestsInvestigation) return discover("investigation-request");
  return ask("insufficient-assessment");
}

/** Calls only the injected judgment boundary, then applies the deterministic policy. */
export async function judgeAndRoute(
  judge: GoalJudge,
  input: GoalJudgeInput,
  state: GoalPolicyState = initialState
): Promise<GoalPolicyResult> {
  const assessment = await judge.assess(input);
  return selectGoalRoute(assessment, state);
}

/** A fixed, clone-on-read judge for deterministic policy tests and local adapters. */
export function createDeterministicFakeGoalJudge(assessment: GoalAssessment): GoalJudge {
  const fixedAssessment = structuredClone(assessment);
  return {
    async assess(_input: GoalJudgeInput): Promise<GoalAssessment> {
      return structuredClone(fixedAssessment);
    }
  };
}
