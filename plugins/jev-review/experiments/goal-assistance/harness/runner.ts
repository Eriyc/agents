import { performance } from "node:perf_hooks";
import { jevQuestions, generatorResultSchema, jevAnswersSchema, jevResultSchema, type Condition, type ExperimentPhase, type GeneratorRequest, type JevRequest } from "./contracts.js";
import { projectModelCase, selectCases, type LoadedCases } from "./cases.js";
import type { LoadedConfig } from "./config.js";
import { authorizePhase, costToMicros, validatePlannedBudget, type BudgetAccount } from "./budget.js";
import type { SaveBudgetAccount } from "./ledger-store.js";
import { redactSecrets, safeFailureCode } from "./redact.js";
import { validateAdapterBoundary, type ExperimentAdapters, type ProviderMode, type RemoteAllowance } from "./providers.js";
import { canonicalJson, sha256 } from "./hash.js";

export type UsageRecord = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};
export type OperationRecord = {
  requestId: string;
  provider: string;
  requestedModel: string;
  returnedModel: string | null;
  remoteRequests: number;
  usage: UsageRecord;
  elapsedMs: number;
};
export type ConditionRow = {
  caseId: string;
  condition: Condition;
  status: "completed" | "failed" | "missing";
  generator: OperationRecord | null;
  jev: (OperationRecord & { answers: Record<string, unknown> }) | null;
  output: string | null;
  errorCode: string | null;
};

export type ExperimentRun = {
  metadata: {
    schemaVersion: 1;
    phase: ExperimentPhase;
    experimentId: string;
    configSha256: string;
    configFileSha256: string;
    sharedConfigSha256: string;
    promptSha256: LoadedConfig["promptSha256"];
    jevQuestionsSha256: string;
    fixtureSha256: string;
    generator: { provider: "codex"; requestedModel: string };
    judge: { provider: "openrouter"; requestedModel: string };
    generationBudget: LoadedConfig["config"]["generationBudget"];
    limits: LoadedConfig["config"]["limits"];
    selectionRule: string;
    selectedCaseIds: string[];
    excludedCaseIds: string[];
    excludedFamilies: string[];
    plannedRemoteRequests: number;
    plannedPerCallHardCostCapUsd: number;
    executionMode: ProviderMode;
  };
  rows: ConditionRow[];
  summary: {
    requiredRows: number;
    completedRows: number;
    failedRows: number;
    missingRows: number;
    remoteRequests: number;
    reportedCostUsd: number;
    conservativelyReservedCostUsd: number;
    elapsedMs: number;
    stopReason: string | null;
    exitCode: 0 | 1;
  };
};

type CallKind = "generator" | "jev";
type CallResult<T> = { ok: true; value: T; elapsedMs: number } | { ok: false; code: string; elapsedMs: number; fatal: boolean };

const conditionOrder: readonly Condition[] = ["normal_codex", "workflow_only", "workflow_jev"];

export async function runPairedPhase(args: {
  phase: ExperimentPhase;
  loadedConfig: LoadedConfig;
  getCases: () => Promise<LoadedCases>;
  adapters: ExperimentAdapters;
  account: BudgetAccount;
  saveAccount: SaveBudgetAccount;
  now?: () => number;
}): Promise<ExperimentRun> {
  const { phase, loadedConfig, adapters, account, saveAccount } = args;
  const now = args.now ?? Date.now;
  const startedAt = now();
  const startPerf = performance.now();

  const planned = validatePlannedBudget(loadedConfig);
  if (planned.plannedRemoteRequests !== totalExpectedCalls(loadedConfig)) throw new Error("Frozen request plan is inconsistent.");
  authorizePhase(phase, account, loadedConfig);
  await saveAccount(account);
  validateAdapterBoundary(adapters, loadedConfig.config.generator.model, loadedConfig.config.judge.model);
  const loadedCases = await args.getCases();
  if (loadedCases.phase !== phase) throw new Error("Case split does not match the requested experiment phase.");

  const selected = selectCases(phase, loadedCases.cases, loadedConfig.config);
  const rowIndex = new Map<string, ConditionRow>();
  const rows: ConditionRow[] = [];
  for (const item of selected.cases) {
    for (const condition of conditionOrder) {
      const row: ConditionRow = { caseId: item.case_id, condition, status: "missing", generator: null, jev: null, output: null, errorCode: "not_run" };
      rowIndex.set(rowKey(item.case_id, condition), row);
      rows.push(row);
    }
  }

  let stopReason: string | null = null;
  let fatalMismatch = false;
  const runMode = adapters.generator.mode;
  const secrets = [
    ...(adapters.generator.secretsToRedact ?? []),
    ...(adapters.jev.secretsToRedact ?? [])
  ];
  const phaseDeadline = startedAt + loadedConfig.config.limits.wallClockStopMs;
  const maxCostMicros = Math.floor(loadedConfig.config.limits.maxCostUsd * 1_000_000 + 1e-7);
  const requestCap = loadedConfig.config.limits.maxRemoteRequests;
  const perCallCapMicros = Math.floor(planned.plannedPerCallCapUsd * 1_000_000 + 1e-7);
  if (perCallCapMicros < 1 && runMode !== "offline") {
    stopReason = "hard_per_call_cost_cap_below_one_micro_usd";
    fatalMismatch = true;
  }

  for (const item of selected.cases) {
    if (stopReason) break;
    const caseInput = projectModelCase(item);
    for (const condition of conditionOrder) {
      const row = rowIndex.get(rowKey(item.case_id, condition))!;
      let judgeSignals: ReturnType<typeof jevResultSchema.parse> | undefined;
      if (condition === "workflow_jev") {
        const requestId = makeRequestId(loadedConfig.config.experimentId, phase, item.case_id, "jev", loadedConfig.configSha256);
        const jevRequest: JevRequest = {
          requestId,
          phase,
          caseId: item.case_id,
          provider: "openrouter",
          state: caseInput,
          questions: jevQuestions,
          timeoutMs: loadedConfig.config.generationBudget.timeoutMs,
          hardCostCapUsd: perCallCapMicros / 1_000_000,
          maxRemoteRequests: 1
        };
        const jevCall = await callAdapter({
          kind: "jev",
          call: (allowance, signal) => adapters.jev.evaluate(jevRequest, allowance, signal),
          mode: adapters.jev.mode,
          capabilities: adapters.jev.capabilities,
          provider: "openrouter",
          requestedModel: loadedConfig.config.judge.model,
          account,
          saveAccount,
          now,
          phaseDeadline,
          timeoutMs: loadedConfig.config.generationBudget.timeoutMs,
          requestCap,
          maxCostMicros,
          perCallCapMicros
        });
        if (!jevCall.ok) {
          row.status = "failed";
          row.errorCode = jevCall.code;
          if (jevCall.fatal) {
            stopReason = jevCall.code;
            fatalMismatch = true;
          }
          continue;
        }
        const parsed = jevResultSchema.safeParse(jevCall.value);
        if (!parsed.success) {
          row.status = "failed";
          row.errorCode = "jev_provider_contract_mismatch";
          stopReason = row.errorCode;
          fatalMismatch = true;
          continue;
        }
        const safeAnswers = jevAnswersSchema.parse(redactJson(parsed.data.answers, secrets));
        row.jev = {
          requestId,
          provider: parsed.data.provider,
          requestedModel: loadedConfig.config.judge.model,
          returnedModel: parsed.data.returnedModel,
          remoteRequests: parsed.data.remoteRequests,
          usage: parsed.data.usage,
          elapsedMs: jevCall.elapsedMs,
          answers: safeAnswers
        };
        const settled = await settleProviderUsage({
          mode: adapters.jev.mode,
          remoteRequests: parsed.data.remoteRequests,
          costUsd: parsed.data.usage.costUsd,
          account,
          saveAccount,
          perCallCapMicros,
          maxCostMicros
        });
        if (!settled.ok) {
          row.status = "failed";
          row.errorCode = settled.code;
          stopReason = settled.code;
          fatalMismatch = true;
          continue;
        }
        if (parsed.data.provider !== "openrouter" || parsed.data.returnedModel !== loadedConfig.config.judge.model || !sameKeys(Object.keys(parsed.data.answers), Object.keys(jevQuestions))) {
          row.status = "failed";
          row.errorCode = "jev_provider_contract_mismatch";
          stopReason = row.errorCode;
          fatalMismatch = true;
          continue;
        }
        judgeSignals = { ...parsed.data, answers: safeAnswers };
      }

      if (stopReason) break;
      const promptKey = condition === "normal_codex" ? "normal_codex" : "workflow";
      const prompt = loadedConfig.config.prompts[promptKey];
      const requestId = makeRequestId(loadedConfig.config.experimentId, phase, item.case_id, `generator:${condition}`, loadedConfig.configSha256);
      const generatorRequest: GeneratorRequest = {
        requestId,
        phase,
        caseId: item.case_id,
        condition,
        requestedModel: loadedConfig.config.generator.model,
        promptSha256: loadedConfig.promptSha256[promptKey],
        prompt,
        sharedContext: loadedConfig.config.sharedContext,
        toolAccess: loadedConfig.config.toolAccess,
        maxInputTokens: loadedConfig.config.generationBudget.maxInputTokens,
        maxOutputTokens: loadedConfig.config.generationBudget.maxOutputTokens,
        timeoutMs: loadedConfig.config.generationBudget.timeoutMs,
        hardCostCapUsd: perCallCapMicros / 1_000_000,
        maxRemoteRequests: 1,
        caseInput,
        ...(judgeSignals ? { jevSignals: judgeSignals } : {})
      };
      const generatorCall = await callAdapter({
        kind: "generator",
        call: (allowance, signal) => adapters.generator.generate(generatorRequest, allowance, signal),
        mode: adapters.generator.mode,
        capabilities: adapters.generator.capabilities,
        provider: "codex",
        requestedModel: loadedConfig.config.generator.model,
        account,
        saveAccount,
        now,
        phaseDeadline,
        timeoutMs: loadedConfig.config.generationBudget.timeoutMs,
        requestCap,
        maxCostMicros,
        perCallCapMicros
      });
      if (!generatorCall.ok) {
        row.status = "failed";
        row.errorCode = generatorCall.code;
        if (generatorCall.fatal) {
          stopReason = generatorCall.code;
          fatalMismatch = true;
        }
        continue;
      }
      const parsed = generatorResultSchema.safeParse(generatorCall.value);
      if (!parsed.success) {
        row.status = "failed";
        row.errorCode = "generator_provider_contract_mismatch";
        stopReason = row.errorCode;
        fatalMismatch = true;
        continue;
      }
      row.generator = operationRecord(requestId, parsed.data.provider, loadedConfig.config.generator.model, parsed.data.returnedModel, parsed.data.remoteRequests, parsed.data.usage, generatorCall.elapsedMs);
      const settled = await settleProviderUsage({
        mode: adapters.generator.mode,
        remoteRequests: parsed.data.remoteRequests,
        costUsd: parsed.data.usage.costUsd,
        account,
        saveAccount,
        perCallCapMicros,
        maxCostMicros
      });
      if (!settled.ok) {
        row.status = "failed";
        row.errorCode = settled.code;
        stopReason = settled.code;
        fatalMismatch = true;
        continue;
      }
      if (parsed.data.provider !== "codex" || parsed.data.returnedModel !== loadedConfig.config.generator.model) {
        row.status = "failed";
        row.errorCode = "generator_provider_contract_mismatch";
        stopReason = row.errorCode;
        fatalMismatch = true;
        continue;
      }
      if (parsed.data.output.trim().length === 0) {
        row.status = "missing";
        row.errorCode = "empty_required_output";
        continue;
      }
      row.status = "completed";
      row.output = redactSecrets(parsed.data.output, adapters.generator.secretsToRedact);
      row.errorCode = null;
    }
  }

  for (const row of rows) {
    if (row.status === "missing" && row.errorCode === "not_run") row.errorCode = stopReason ?? "not_run";
  }
  const completedRows = rows.filter((row) => row.status === "completed").length;
  const failedRows = rows.filter((row) => row.status === "failed").length;
  const missingRows = rows.filter((row) => row.status === "missing").length;
  const elapsedMs = Math.max(0, performance.now() - startPerf);
  const plannedCaseIds = loadedConfig.config.selection[phase];
  const allExpectedRows = plannedCaseIds.length * conditionOrder.length;
  const metadata = {
    schemaVersion: 1 as const,
    phase,
    experimentId: loadedConfig.config.experimentId,
    configSha256: loadedConfig.configSha256,
    configFileSha256: loadedConfig.configFileSha256,
    sharedConfigSha256: loadedConfig.sharedConfigSha256,
    promptSha256: loadedConfig.promptSha256,
    jevQuestionsSha256: loadedConfig.jevQuestionsSha256,
    fixtureSha256: loadedCases.fixtureSha256,
    generator: { provider: "codex" as const, requestedModel: loadedConfig.config.generator.model },
    judge: { provider: "openrouter" as const, requestedModel: loadedConfig.config.judge.model },
    generationBudget: loadedConfig.config.generationBudget,
    limits: loadedConfig.config.limits,
    selectionRule: loadedConfig.config.selectionRule,
    selectedCaseIds: selected.cases.map((item) => item.case_id),
    excludedCaseIds: selected.excludedCaseIds,
    excludedFamilies: selected.excludedFamilies,
    plannedRemoteRequests: planned.plannedRemoteRequests,
    plannedPerCallHardCostCapUsd: perCallCapMicros / 1_000_000,
    executionMode: runMode
  };
  const reportedCostUsd = account.reportedCostMicros / 1_000_000;
  const reservedCostUsd = account.reservedCostMicros / 1_000_000;
  return {
    metadata,
    rows,
    summary: {
      requiredRows: allExpectedRows,
      completedRows,
      failedRows,
      missingRows,
      remoteRequests: account.remoteRequests,
      reportedCostUsd,
      conservativelyReservedCostUsd: reportedCostUsd + reservedCostUsd,
      elapsedMs,
      stopReason,
      exitCode: completedRows === allExpectedRows ? 0 : 1
    }
  };
}

async function callAdapter<T>(args: {
  kind: CallKind;
  call: (allowance: RemoteAllowance, signal: AbortSignal) => Promise<unknown>;
  mode: ProviderMode;
  capabilities: { hardPerCallCostLimit: boolean; exactCostReporting: boolean; noHiddenRetries: boolean };
  provider: "codex" | "openrouter";
  requestedModel: string;
  account: BudgetAccount;
  saveAccount: SaveBudgetAccount;
  now: () => number;
  phaseDeadline: number;
  timeoutMs: number;
  requestCap: number;
  maxCostMicros: number;
  perCallCapMicros: number;
}): Promise<CallResult<T>> {
  const start = performance.now();
  const { mode, account } = args;
  const metered = mode !== "offline";
  if (metered) {
    if (!args.capabilities.hardPerCallCostLimit || !args.capabilities.exactCostReporting || !args.capabilities.noHiddenRetries) {
      return { ok: false, code: "provider_cannot_honor_hard_budget", elapsedMs: 0, fatal: true };
    }
    if (account.remoteRequests >= args.requestCap) return { ok: false, code: "cap_remote_requests", elapsedMs: 0, fatal: true };
    const committedMicros = account.reportedCostMicros + account.reservedCostMicros;
    if (committedMicros + args.perCallCapMicros > args.maxCostMicros) return { ok: false, code: "cap_cost_usd", elapsedMs: 0, fatal: true };
    if (args.now() >= args.phaseDeadline) return { ok: false, code: "cap_wall_clock", elapsedMs: 0, fatal: true };
    account.remoteRequests += 1;
    account.reservedCostMicros += args.perCallCapMicros;
    await args.saveAccount(account);
  }

  const remainingMs = Math.max(0, args.phaseDeadline - args.now());
  const timeoutMs = Math.min(args.timeoutMs, remainingMs);
  if (timeoutMs <= 0) return { ok: false, code: "cap_wall_clock", elapsedMs: performance.now() - start, fatal: true };
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error("Timed out");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  try {
    const allowance: RemoteAllowance = { hardCostCapUsd: args.perCallCapMicros / 1_000_000, maxRemoteRequests: 1 };
    const value = await Promise.race([args.call(allowance, controller.signal), timeout]) as T;
    return { ok: true, value, elapsedMs: Math.max(0, performance.now() - start) };
  } catch (error) {
    const code = safeFailureCode(error);
    return { ok: false, code, elapsedMs: Math.max(0, performance.now() - start), fatal: code === "provider_timeout" };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function settleProviderUsage(args: {
  mode: ProviderMode;
  remoteRequests: number;
  costUsd: number | null;
  account: BudgetAccount;
  saveAccount: SaveBudgetAccount;
  perCallCapMicros: number;
  maxCostMicros: number;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  if (args.mode === "offline") {
    if (args.remoteRequests !== 0 || args.costUsd !== 0) return { ok: false, code: "offline_provider_meter_mismatch" };
    return { ok: true };
  }
  if (args.remoteRequests !== 1) return { ok: false, code: "provider_request_count_mismatch" };
  if (args.costUsd === null) return { ok: false, code: "provider_cost_missing" };
  const billed = costToMicros(args.costUsd);
  if (billed > args.perCallCapMicros) return { ok: false, code: "provider_cost_exceeded_per_call_cap" };
  const committedWithoutThisReservation = args.account.reportedCostMicros + Math.max(0, args.account.reservedCostMicros - args.perCallCapMicros);
  if (committedWithoutThisReservation + billed > args.maxCostMicros) return { ok: false, code: "provider_cost_exceeded_experiment_cap" };
  args.account.reservedCostMicros = Math.max(0, args.account.reservedCostMicros - args.perCallCapMicros);
  args.account.reportedCostMicros += billed;
  await args.saveAccount(args.account);
  return { ok: true };
}

function operationRecord(
  requestId: string,
  provider: string,
  requestedModel: string,
  returnedModel: string | null,
  remoteRequests: number,
  usage: UsageRecord,
  elapsedMs: number
): OperationRecord {
  return { requestId, provider, requestedModel, returnedModel, remoteRequests, usage, elapsedMs };
}

function redactJson(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJson(entry, secrets)]));
  }
  return value;
}

function makeRequestId(experimentId: string, phase: ExperimentPhase, caseId: string, operation: string, configHash: string): string {
  return sha256(canonicalJson({ experimentId, phase, caseId, operation, configHash }));
}

function rowKey(caseId: string, condition: Condition): string {
  return `${caseId}\0${condition}`;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key) => right.includes(key));
}

function totalExpectedCalls(loadedConfig: LoadedConfig): number {
  return (loadedConfig.config.selection.development.length + loadedConfig.config.selection.holdout.length) * 4;
}

