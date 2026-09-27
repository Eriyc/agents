import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fixtureCaseSchema, phases, type ExperimentPhase, type ExperimentConfig, type FixtureCase, modelCaseSchema, type ModelCase } from "./contracts.js";
import { sha256 } from "./hash.js";

const pinnedFixtureHashes: Record<ExperimentPhase, string> = {
  development: "a92ffe2b80d3595c3160d6e0292f2c7b8ec1af9681c025efaf64c3c0fba177fe",
  holdout: "0e5417456f2a8fc6a1db2851ddfa016cc2e8ec841124e0fb74db1a87aee87fc1"
};
const requiredFamilies = new Set([
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
]);

export type CaseFileReader = (path: string) => Promise<Uint8Array>;
export type LoadedCases = { phase: ExperimentPhase; fixtureSha256: string; cases: FixtureCase[] };
export type SelectedCases = {
  cases: FixtureCase[];
  excludedCaseIds: string[];
  excludedFamilies: string[];
};

/** Reads exactly one split. Development runs cannot probe or enumerate the holdout path. */
export async function loadCases(
  phase: ExperimentPhase,
  options: { fixtureDirectory?: string; read?: CaseFileReader } = {}
): Promise<LoadedCases> {
  if (!phases.includes(phase)) throw new Error("Unknown experiment phase.");
  const directory = options.fixtureDirectory ?? resolve(import.meta.dir, "../fixtures");
  const path = resolve(directory, `${phase}.jsonl`);
  const read = options.read ?? (async (file) => new Uint8Array(await readFile(file)));
  const raw = await read(path);
  const hash = sha256(raw);
  if (hash !== pinnedFixtureHashes[phase]) {
    throw new Error(`${phase} fixture bytes do not match the frozen protocol hash.`);
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const lines = text.trimEnd().split(/\r?\n/);
  const cases: FixtureCase[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let record: unknown;
    try {
      record = JSON.parse(lines[index]!) as unknown;
    } catch {
      throw new Error(`${phase}:${index + 1}: invalid JSON fixture row.`);
    }
    const parsed = fixtureCaseSchema.safeParse(record);
    if (!parsed.success) {
      throw new Error(`${phase}:${index + 1}: frozen case contract mismatch at ${parsed.error.issues.map((issue) => issue.path.join(".") || "<root>").join(", ")}.`);
    }
    const expectedPrefix = phase === "development" ? "dev-" : "hold-";
    if (!parsed.data.case_id.startsWith(expectedPrefix)) {
      throw new Error(`${phase}:${index + 1}: case ID prefix does not match the selected split.`);
    }
    cases.push(parsed.data);
  }

  const ids = new Set<string>();
  const families = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.case_id)) throw new Error(`${phase}: duplicate case ID in frozen fixtures.`);
    if (families.has(item.family)) throw new Error(`${phase}: duplicate family in frozen fixtures.`);
    ids.add(item.case_id);
    families.add(item.family);
  }
  if (cases.length < 30 || families.size !== requiredFamilies.size || [...requiredFamilies].some((family) => !families.has(family))) {
    throw new Error(`${phase}: frozen fixture set does not meet its case/family contract.`);
  }
  return { phase, fixtureSha256: hash, cases };
}

export function projectModelCase(item: FixtureCase): ModelCase {
  return modelCaseSchema.parse({
    prompt: item.prompt,
    prior_turns: item.prior_turns,
    current_goal: item.current_goal,
    relation_to_work: item.relation_to_work,
    repository_evidence: item.repository_evidence,
    permitted_scope: item.permitted_scope,
    unresolved_decisions: item.unresolved_decisions
  });
}

export function selectCases(phase: ExperimentPhase, cases: readonly FixtureCase[], config: ExperimentConfig): SelectedCases {
  const caseIds = config.selection[phase];
  const byId = new Map(cases.map((item) => [item.case_id, item]));
  if (byId.size !== cases.length) throw new Error(`${phase}: duplicate rows violate the selected case contract.`);
  const orderedIds = [...byId.keys()].sort((left, right) => Number(left.slice(-2)) - Number(right.slice(-2)));
  const firstNIds = orderedIds.slice(0, caseIds.length);
  if (firstNIds.length !== caseIds.length || caseIds.some((caseId, index) => caseId !== firstNIds[index])) {
    throw new Error(`${phase}: selected cases do not follow the frozen first-N-by-case-ID exclusion rule.`);
  }
  const selected = caseIds.map((caseId) => {
    const item = byId.get(caseId);
    if (!item) throw new Error(`${phase}: selected case ID is missing from the frozen fixture set.`);
    return item;
  });
  if (selected.length < 30) throw new Error(`${phase}: selected case plan has fewer than 30 cases.`);
  const selectedSet = new Set(caseIds);
  const excluded = cases.filter((item) => !selectedSet.has(item.case_id));
  return {
    cases: selected,
    excludedCaseIds: excluded.map((item) => item.case_id),
    excludedFamilies: excluded.map((item) => item.family)
  };
}
