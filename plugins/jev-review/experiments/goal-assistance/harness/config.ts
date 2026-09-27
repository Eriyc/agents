import { readFile } from "node:fs/promises";
import { experimentConfigSchema, jevQuestions, type ExperimentConfig } from "./contracts.js";
import { canonicalJson, sha256 } from "./hash.js";

export type LoadedConfig = {
  config: ExperimentConfig;
  configFileSha256: string;
  configSha256: string;
  promptSha256: Record<"normal_codex" | "workflow", string>;
  jevQuestionsSha256: string;
  sharedConfigSha256: string;
};

export async function loadConfig(path: string): Promise<LoadedConfig> {
  const raw = await readFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new Error("Experiment config is not valid JSON.");
  }
  const result = experimentConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Experiment config contract mismatch: ${result.error.issues.map((issue) => issue.path.join(".") || "<root>").join(", ")}`);
  }
  const config = result.data;
  const promptSha256 = {
    normal_codex: sha256(config.prompts.normal_codex),
    workflow: sha256(config.prompts.workflow)
  };
  const jevQuestionsSha256 = sha256(canonicalJson(jevQuestions));
  const configFileSha256 = sha256(raw);
  const configSha256 = sha256(canonicalJson({ configFileSha256, promptSha256, jevQuestionsSha256 }));
  const shared = {
    schemaVersion: config.schemaVersion,
    experimentId: config.experimentId,
    generator: config.generator,
    judge: config.judge,
    sharedContext: config.sharedContext,
    toolAccess: config.toolAccess,
    selection: config.selection,
    selectionRule: config.selectionRule,
    generationBudget: config.generationBudget,
    limits: config.limits,
    jevQuestionsSha256
  };
  return {
    config,
    configFileSha256,
    configSha256,
    promptSha256,
    jevQuestionsSha256,
    sharedConfigSha256: sha256(canonicalJson(shared))
  };
}
