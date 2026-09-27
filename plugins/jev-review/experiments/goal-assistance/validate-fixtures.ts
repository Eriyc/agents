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

const nonempty = z.string().trim().min(1);
const caseSchema = z.strictObject({
  case_id: nonempty,
  family: z.enum(families),
  prompt: nonempty,
  prior_turns: z.array(z.strictObject({ role: nonempty, content: nonempty })),
  current_goal: z.strictObject({ status: nonempty, summary: z.string().nullable() }),
  relation_to_work: nonempty,
  repository_evidence: z.array(z.strictObject({ source: nonempty, kind: nonempty, content: nonempty })),
  expected_route: z.strictObject({ action: nonempty, behavior: nonempty }),
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
  const parsed = splitSchema.safeParse(records);
  if (!parsed.success) throw new Error(`${split}: ${z.prettifyError(parsed.error)}`);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { cases: parsed.data, hash };
}

const development = await loadSplit("development");
const holdout = await loadSplit("holdout");
const developmentIds = new Set(development.cases.map((item) => item.case_id));
const overlap = holdout.cases.filter((item) => developmentIds.has(item.case_id));
if (overlap.length) throw new Error(`case IDs overlap across splits: ${overlap.map((item) => item.case_id).join(", ")}`);

console.log(JSON.stringify({
  schema: "goal-assistance-fixtures-v1",
  development: { count: development.cases.length, sha256: development.hash },
  holdout: { count: holdout.cases.length, sha256: holdout.hash },
  families: families.length
}));
