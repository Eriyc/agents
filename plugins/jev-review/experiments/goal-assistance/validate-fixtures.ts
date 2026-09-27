import { createHash } from "node:crypto";
import { z } from "zod";

const families = [
  "answer_pending_choice", "attachment_instruction", "cancellation", "conflicting_constraints",
  "correction", "detailed_implementation", "duplicate_turn", "exploration_header_example",
  "incomplete_scan_unknown", "invalid_output", "investigation_deliverable",
  "judge_high_confidence_scope", "judge_user_override", "missing_core_concept", "missing_key",
  "missing_repository_fact", "missing_user_preference", "mixed_question_action", "mode_assist",
  "mode_observe", "mode_off", "native_goal_authorization", "parallel_sessions",
  "parallel_workspaces", "pure_question", "question_form_action", "replacement",
  "repository_instruction", "resume", "rough_direction", "settled_decision_no_reconfirm",
  "short_reply_no_referent", "short_yes_pending", "stale_revision", "status_request",
  "timeout", "unknown_mode", "unrelated_question_active_goal"
] as const;
const pinnedHashes = {
  development: "a92ffe2b80d3595c3160d6e0292f2c7b8ec1af9681c025efaf64c3c0fba177fe",
  holdout: "0e5417456f2a8fc6a1db2851ddfa016cc2e8ec841124e0fb74db1a87aee87fc1"
} as const;

const nonempty = z.string().trim().min(1);
const caseSchema = z.strictObject({
  case_id: z.string().regex(/^(dev|hold)-\d{2}$/),
  family: z.enum(families),
  prompt: nonempty,
  prior_turns: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: nonempty })),
  current_goal: z.strictObject({ status: z.enum(["active", "absent"]), summary: z.string().nullable() }),
  relation_to_work: z.enum(["absent", "answer-to-clarification", "cancel", "new", "not-needed", "refine", "replace", "resume", "unrelated"]),
  repository_evidence: z.array(z.strictObject({ source: nonempty, kind: nonempty, content: nonempty })),
  expected_route: z.strictObject({
    action: z.enum(["abstain", "answer", "ask-missing-information", "cancel", "confirm-candidate", "continue", "investigate", "observe", "proceed", "replace"]),
    behavior: nonempty
  }),
  permitted_scope: nonempty,
  unresolved_decisions: z.array(nonempty),
  reference_assertions: z.strictObject({
    goal_fidelity: nonempty,
    scope_expansion: nonempty,
    missed_clarification: nonempty,
    useful_clarification: nonempty,
    redundant_questions: nonempty,
    correction_turns: nonempty
  })
});

const splitSchema = z.array(caseSchema).min(30).superRefine((cases, context) => {
  const ids = new Set<string>();
  const seenFamilies = new Set<string>();
  for (const [index, item] of cases.entries()) {
    if (ids.has(item.case_id)) context.addIssue({ code: "custom", path: [index, "case_id"], message: "duplicate case ID" });
    if (seenFamilies.has(item.family)) context.addIssue({ code: "custom", path: [index, "family"], message: "duplicate family" });
    ids.add(item.case_id);
    seenFamilies.add(item.family);
  }
  for (const family of families) {
    if (!seenFamilies.has(family)) context.addIssue({ code: "custom", message: `missing family: ${family}` });
  }
});

async function loadSplit(split: "development" | "holdout") {
  const path = new URL(`./fixtures/${split}.jsonl`, import.meta.url);
  const raw = await Bun.file(path).text();
  const records = raw.trim().split(/\r?\n/).map((line, index) => {
    try { return JSON.parse(line) as unknown; }
    catch { throw new Error(`${split}:${index + 1}: invalid JSON`); }
  });
  const prefix = split === "development" ? "dev-" : "hold-";
  const parsed = splitSchema.superRefine((cases, context) => {
    for (const [index, item] of cases.entries()) {
      if (!item.case_id.startsWith(prefix)) context.addIssue({ code: "custom", path: [index, "case_id"], message: "wrong split prefix" });
    }
  }).safeParse(records);
  if (!parsed.success) throw new Error(`${split}: ${z.prettifyError(parsed.error)}`);
  const hash = createHash("sha256").update(raw).digest("hex");
  z.literal(pinnedHashes[split]).parse(hash);
  return { cases: parsed.data, hash };
}

const development = await loadSplit("development");
const holdout = await loadSplit("holdout");
const pairSchema = z.strictObject({ development: splitSchema, holdout: splitSchema }).superRefine((splits, context) => {
  const developmentIds = new Set(splits.development.map((item) => item.case_id));
  for (const [index, item] of splits.holdout.entries()) {
    if (developmentIds.has(item.case_id)) {
      context.addIssue({ code: "custom", path: ["holdout", index, "case_id"], message: "case ID overlaps development" });
    }
  }
});
const paired = pairSchema.safeParse({ development: development.cases, holdout: holdout.cases });
if (!paired.success) throw new Error(`paired split: ${z.prettifyError(paired.error)}`);

console.log(JSON.stringify({
  schema: "goal-assistance-fixtures-v1",
  development: { count: development.cases.length, sha256: development.hash },
  holdout: { count: holdout.cases.length, sha256: holdout.hash },
  families: families.length
}));
