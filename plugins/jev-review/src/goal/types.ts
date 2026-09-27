export const intentKinds = ["answer", "discuss", "investigate", "implement", "mixed"] as const;

export type IntentKind = (typeof intentKinds)[number];
export type IntentComponent = Exclude<IntentKind, "mixed">;

export type SignalProvenance = {
  source: "user" | "conversation" | "repository" | "judge";
  reference?: string;
};

/** A judge's raw response and its provenance remain available beside normalization. */
export type GoalSignal<T> = {
  raw: unknown;
  value: T | null;
  provenance: SignalProvenance;
  /** Informational only. Policy decisions never use confidence as authority. */
  confidence?: number;
};

export type IntentAssessment = {
  classification: IntentKind | "unknown";
  primary: IntentComponent | null;
  secondary: readonly IntentComponent[];
};

export type WorkRelationship =
  | "new"
  | "refine"
  | "replace"
  | "answer-to-clarification"
  | "unrelated";

export type GoalStatus = "clear" | "inferable" | "ambiguous" | "absent" | "not-needed";

export type ScopeAssessment = {
  status: "supported" | "violated";
  violations: readonly string[];
};

export type UnresolvedChoice = {
  kind: "concept" | "fact" | "preference";
  material: boolean;
  resolution: "discoverable" | "inferable" | "requires-user";
  description: string;
};

export type GoalAssessment = {
  intent: GoalSignal<IntentAssessment>;
  relationship: GoalSignal<WorkRelationship>;
  /** Intent of the retained goal, used only for refinement/clarification replies. */
  activeGoalIntent: GoalSignal<IntentComponent>;
  /** Explicit user control; inferred judge preference is not authority to cancel. */
  goalControl: GoalSignal<"continue" | "cancel">;
  goalStatus: GoalSignal<GoalStatus>;
  preservation: GoalSignal<"preserved" | "at-risk">;
  constraints: GoalSignal<"covered" | "missing" | "conflicted">;
  scope: GoalSignal<ScopeAssessment>;
  completionEvidence: GoalSignal<"defined" | "missing">;
  evidenceSufficiency: GoalSignal<"sufficient" | "needs-discovery" | "insufficient">;
  unresolvedChoices: GoalSignal<readonly UnresolvedChoice[]>;
  conflicts: GoalSignal<readonly string[]>;
  candidate: GoalSignal<"defensible" | "unavailable">;
};

/** Bounded input to a replaceable judge; repository discovery is a separate action. */
export type GoalJudgeInput = {
  userPrompt: string;
  currentGoal?: string;
  pendingQuestion?: string;
};

export interface GoalJudge {
  assess(input: GoalJudgeInput): Promise<GoalAssessment>;
}

export type GoalPolicyState = {
  draftsCreated: 0 | 1 | 2;
  discoveryPasses: 0 | 1;
  /** A user answer starts a new clarification round with fresh bounds. */
  userAnsweredSinceLastRound?: boolean;
};

export type GoalRoute =
  | "answer"
  | "discover"
  | "proceed"
  | "confirm-candidate"
  | "ask-missing-information";

export type GoalPolicyReason =
  | "answer-or-discussion"
  | "goal-cancelled"
  | "cancellation-needs-user"
  | "investigation-complete"
  | "investigation-request"
  | "evidence-discovery-needed"
  | "discoverable-fact"
  | "supported-implementation"
  | "candidate-needs-confirmation"
  | "missing-goal"
  | "unsupported-scope"
  | "conflicting-signals"
  | "outcome-not-preserved"
  | "constraint-not-covered"
  | "completion-evidence-missing"
  | "insufficient-evidence"
  | "insufficient-assessment"
  | "discovery-limit"
  | "refinement-limit";

export type GoalPolicyResult = {
  route: GoalRoute;
  reason: GoalPolicyReason;
  /** Carries raw answers, provenance, and confidence through to the coordinator. */
  assessment: GoalAssessment;
  scopeViolations: readonly string[];
  nextState: GoalPolicyState;
};
