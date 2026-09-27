import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCases, projectModelCase, selectCases, type LoadedCases } from "../harness/cases.js";
import { authorizePhase, budgetAccountSchema, freezeDevelopmentConfig, newBudgetAccount, validatePlannedBudget } from "../harness/budget.js";
import { loadConfig, type LoadedConfig } from "../harness/config.js";
import type { Condition, GeneratorRequest, JevRequest } from "../harness/contracts.js";
import { createFakeAdapters } from "../harness/fake-provider.js";
import { withBudgetLedger } from "../harness/ledger-store.js";
import { runPairedPhase } from "../harness/runner.js";
import type { ExperimentAdapters, GeneratorAdapter, OpenRouterJevAdapter, ProviderMode } from "../harness/providers.js";

const templatePath = resolve(import.meta.dir, "../templates/experiment-config.example.json");

async function loadExample(): Promise<LoadedConfig> {
  return loadConfig(templatePath);
}

async function developmentCases(): Promise<LoadedCases> {
  return loadCases("development");
}

function copyAdapters(config: LoadedConfig, options: {
  mode?: ProviderMode;
  onGenerate?: (request: GeneratorRequest, baseResult: unknown) => unknown | Promise<unknown>;
  onJev?: (request: JevRequest, baseResult: unknown) => unknown | Promise<unknown>;
  generatorCapabilities?: GeneratorAdapter["capabilities"];
  jevCapabilities?: OpenRouterJevAdapter["capabilities"];
  generatorSecrets?: readonly string[];
  jevSecrets?: readonly string[];
} = {}): ExperimentAdapters {
  const mode = options.mode ?? "offline";
  const base = createFakeAdapters(config.config, mode);
  const baseGenerate = base.generator.generate.bind(base.generator);
  const baseJev = base.jev.evaluate.bind(base.jev);
  return {
    generator: {
      ...base.generator,
      mode,
      capabilities: options.generatorCapabilities ?? base.generator.capabilities,
      ...(options.generatorSecrets ? { secretsToRedact: options.generatorSecrets } : {}),
      async generate(request, allowance, signal) {
        const result = await baseGenerate(request, allowance, signal);
        return options.onGenerate ? options.onGenerate(request, result) : result;
      }
    },
    jev: {
      ...base.jev,
      mode,
      capabilities: options.jevCapabilities ?? base.jev.capabilities,
      ...(options.jevSecrets ? { secretsToRedact: options.jevSecrets } : {}),
      async evaluate(request, allowance, signal) {
        const result = await baseJev(request, allowance, signal);
        return options.onJev ? options.onJev(request, result) : result;
      }
    }
  };
}

async function runDevelopment(options: {
  loadedConfig?: LoadedConfig;
  cases?: LoadedCases;
  adapters?: ExperimentAdapters;
  account?: ReturnType<typeof newBudgetAccount>;
  getCases?: () => Promise<LoadedCases>;
  now?: () => number;
}) {
  const loadedConfig = options.loadedConfig ?? await loadExample();
  const cases = options.cases ?? await developmentCases();
  const account = options.account ?? newBudgetAccount(loadedConfig);
  const saveAccount = async (value: typeof account) => { budgetAccountSchema.parse(value); };
  const adapters = options.adapters ?? copyAdapters(loadedConfig);
  const run = await runPairedPhase({
    phase: "development",
    loadedConfig,
    getCases: options.getCases ?? (async () => cases),
    adapters,
    account,
    saveAccount,
    ...(options.now ? { now: options.now } : {})
  });
  return { run, account, adapters, loadedConfig, cases };
}

describe("goal assistance paired experiment harness", () => {
  it("loads only the selected development fixture path and verifies its pinned bytes", async () => {
    const observed: string[] = [];
    const selected = await loadCases("development", {
      read: async (path) => {
        observed.push(path);
        return new Uint8Array(await readFile(path));
      }
    });
    expect(selected.cases.length).toBe(38);
    expect(selected.fixtureSha256).toBe("a92ffe2b80d3595c3160d6e0292f2c7b8ec1af9681c025efaf64c3c0fba177fe");
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatch(/development\.jsonl$/);
    expect(observed.some((path) => path.endsWith("holdout.jsonl"))).toBe(false);
  });

  it("builds a paired three-condition matrix with matched generator context and captures hashes and usage", async () => {
    const loadedConfig = await loadExample();
    const cases = await developmentCases();
    const generatorRequests: GeneratorRequest[] = [];
    const jevRequests: JevRequest[] = [];
    const adapters = copyAdapters(loadedConfig, {
      onGenerate(request, result) { generatorRequests.push(structuredClone(request)); return result; },
      onJev(request, result) { jevRequests.push(structuredClone(request)); return result; }
    });
    const { run } = await runDevelopment({ loadedConfig, cases, adapters });

    expect(run.summary.exitCode).toBe(0);
    expect(run.summary.requiredRows).toBe(90);
    expect(run.summary.completedRows).toBe(90);
    expect(generatorRequests).toHaveLength(90);
    expect(jevRequests).toHaveLength(30);
    expect(run.metadata.plannedRemoteRequests).toBe(240);
    expect(run.metadata.selectedCaseIds).toEqual(loadedConfig.config.selection.development);
    expect(run.metadata.excludedCaseIds).toEqual(Array.from({ length: 8 }, (_, index) => `dev-${String(index + 31).padStart(2, "0")}`));
    expect(run.metadata.excludedFamilies).toHaveLength(8);
    expect(run.metadata.configSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.metadata.configFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.metadata.promptSha256.normal_codex).toMatch(/^[a-f0-9]{64}$/);
    expect(run.metadata.promptSha256.workflow).toMatch(/^[a-f0-9]{64}$/);
    expect(run.metadata.jevQuestionsSha256).toMatch(/^[a-f0-9]{64}$/);

    for (const caseId of loadedConfig.config.selection.development) {
      const group = generatorRequests.filter((request) => request.caseId === caseId);
      expect(group.map((request) => request.condition)).toEqual(["normal_codex", "workflow_only", "workflow_jev"]);
      expect(new Set(group.map((request) => request.requestedModel)).size).toBe(1);
      expect(new Set(group.map((request) => request.sharedContext)).size).toBe(1);
      expect(new Set(group.map((request) => JSON.stringify(request.toolAccess))).size).toBe(1);
      expect(new Set(group.map((request) => request.maxInputTokens)).size).toBe(1);
      expect(new Set(group.map((request) => request.maxOutputTokens)).size).toBe(1);
      expect(new Set(group.map((request) => JSON.stringify(request.caseInput))).size).toBe(1);
      expect(group[1]?.prompt).toBe(group[2]?.prompt);
      expect(group[1]?.promptSha256).toBe(group[2]?.promptSha256);
      expect(group[0]?.promptSha256).not.toBe(group[1]?.promptSha256);
    }
    expect(jevRequests.every((request) => request.provider === "openrouter")).toBe(true);
    expect(jevRequests.every((request) => Object.keys(request.state).sort().join(",") === "current_goal,permitted_scope,prior_turns,prompt,relation_to_work,repository_evidence,unresolved_decisions")).toBe(true);
    expect(run.rows[0]?.generator).toMatchObject({ provider: "codex", requestedModel: "fake-codex-model-v1", returnedModel: "fake-codex-model-v1" });
    expect(run.rows[0]?.generator?.usage).toEqual({ inputTokens: 100, outputTokens: 20, costUsd: 0 });
    expect(run.rows.find((row) => row.condition === "workflow_jev")?.jev).toMatchObject({ provider: "openrouter", requestedModel: "fake-openrouter-jev-model-v1", returnedModel: "fake-openrouter-jev-model-v1" });
  });

  it("keeps evaluator labels out of the exact model-visible projection", async () => {
    const cases = await developmentCases();
    const input = projectModelCase(cases.cases[0]!);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("expected_route");
    expect(serialized).not.toContain("reference_assertions");
    expect(serialized).not.toContain("family");

    const markedCase = structuredClone(cases.cases[0]!);
    markedCase.reference_assertions.goal_fidelity = "SEALED_LABEL_SENTINEL";
    markedCase.expected_route.behavior = "SEALED_ROUTE_SENTINEL";
    expect(JSON.stringify(projectModelCase(markedCase))).not.toContain("SEALED_");
  });

  it("requires development freeze before holdout and prevents returning to tuning", async () => {
    const loaded = await loadExample();
    const account = newBudgetAccount(loaded);
    expect(() => authorizePhase("holdout", account, loaded)).toThrow(/sealed/i);
    authorizePhase("development", account, loaded);
    freezeDevelopmentConfig(account, loaded);
    expect(account.frozenConfigSha256).toBe(loaded.configSha256);
    expect(() => authorizePhase("development", account, loaded)).toThrow(/locked/i);
    authorizePhase("holdout", account, loaded);
    expect(account.holdoutStarted).toBe(true);
    expect(() => authorizePhase("holdout", account, loaded)).toThrow(/already started/i);

    const changedConfig = { ...loaded, configSha256: "f".repeat(64) };
    const secondAccount = structuredClone(account);
    secondAccount.holdoutStarted = false;
    expect(() => authorizePhase("holdout", secondAccount, changedConfig)).toThrow(/differs/i);
  });

  it("checks the full 240-request plan before provider calls", async () => {
    const loaded = await loadExample();
    expect(validatePlannedBudget(loaded)).toEqual({ plannedRemoteRequests: 240, plannedPerCallCapUsd: 5 / 240 });
    const overPlan = structuredClone(loaded);
    overPlan.config.selection.development = Array.from({ length: 38 }, (_, index) => `dev-${String(index + 1).padStart(2, "0")}`);
    overPlan.config.selection.holdout = Array.from({ length: 38 }, (_, index) => `hold-${String(index + 1).padStart(2, "0")}`);
    let caseRead = false;
    let providerCalls = 0;
    const adapters = copyAdapters(loaded, {
      onGenerate() { providerCalls += 1; return {}; },
      onJev() { providerCalls += 1; return {}; }
    });
    const account = newBudgetAccount(overPlan);
    const save = async (value: typeof account) => { budgetAccountSchema.parse(value); };
    await expect(runPairedPhase({
      phase: "development",
      loadedConfig: overPlan,
      getCases: async () => { caseRead = true; return await developmentCases(); },
      adapters,
      account,
      saveAccount: save
    })).rejects.toThrow(/requires 304 remote requests; cap is 300/i);
    expect(providerCalls).toBe(0);
    expect(caseRead).toBe(false);
  });

  it("stops before the next remote call when the cumulative request cap is exhausted", async () => {
    const loaded = await loadExample();
    const account = newBudgetAccount(loaded);
    account.remoteRequests = 300;
    let providerCalls = 0;
    const adapters = copyAdapters(loaded, {
      mode: "metered-fake",
      onGenerate(request, result) { providerCalls += 1; return result; },
      onJev(request, result) { providerCalls += 1; return result; }
    });
    const { run } = await runDevelopment({ loadedConfig: loaded, adapters, account });
    expect(providerCalls).toBe(0);
    expect(run.summary.stopReason).toBe("cap_remote_requests");
    expect(run.summary.exitCode).toBe(1);
    expect(run.summary.failedRows).toBe(1);
    expect(run.summary.missingRows).toBe(89);
  });

  it("enforces the per-call dollar ceiling and stops after a provider overrun", async () => {
    const loaded = await loadExample();
    let calls = 0;
    const adapters = copyAdapters(loaded, {
      mode: "metered-fake",
      onGenerate(_request, baseResult) {
        calls += 1;
        return { ...(baseResult as Record<string, unknown>), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.03 } };
      }
    });
    const { run, account } = await runDevelopment({ loadedConfig: loaded, adapters });
    expect(calls).toBe(1);
    expect(run.summary.stopReason).toBe("provider_cost_exceeded_per_call_cap");
    expect(run.rows[0]?.errorCode).toBe("provider_cost_exceeded_per_call_cap");
    expect(account.remoteRequests).toBe(1);
    expect(account.reservedCostMicros).toBeGreaterThan(0);
    expect(run.summary.exitCode).toBe(1);
  });

  it("blocks further calls when provider cost usage is unknown", async () => {
    const loaded = await loadExample();
    let calls = 0;
    const adapters = copyAdapters(loaded, {
      mode: "metered-fake",
      onGenerate(request, baseResult) {
        calls += 1;
        return { ...(baseResult as Record<string, unknown>), usage: { inputTokens: 4, outputTokens: 4, costUsd: null } };
      }
    });
    const { run, account } = await runDevelopment({ loadedConfig: loaded, adapters });
    expect(calls).toBe(1);
    expect(run.summary.stopReason).toBe("provider_cost_missing");
    expect(run.rows[0]?.generator?.usage.costUsd).toBeNull();
    expect(account.reservedCostMicros).toBeGreaterThan(0);
    expect(run.summary.exitCode).toBe(1);
  });

  it("stops at the recorded wall-clock deadline", async () => {
    const loaded = await loadExample();
    let calls = 0;
    let clockValue = 0;
    const now = () => { clockValue += 600_001; return clockValue; };
    const adapters = copyAdapters(loaded, {
      mode: "metered-fake",
      onGenerate(request, result) { calls += 1; return result; },
      onJev(request, result) { calls += 1; return result; }
    });
    const { run } = await runDevelopment({ loadedConfig: loaded, adapters, now });
    expect(calls).toBe(0);
    expect(run.summary.stopReason).toBe("cap_wall_clock");
    expect(run.summary.exitCode).toBe(1);
  });

  it("retains failed and empty required outputs, redacts secrets, and returns nonzero", async () => {
    const loaded = await loadExample();
    const adapters = copyAdapters(loaded, {
      generatorSecrets: ["fixture-private-secret"],
      async onGenerate(request, result) {
        if (request.caseId === "dev-01" && request.condition === "normal_codex") {
          return { ...(result as Record<string, unknown>), output: "Key sk-or-v1-abcdef123456 fixture-private-secret" };
        }
        if (request.caseId === "dev-01" && request.condition === "workflow_only") {
          return { ...(result as Record<string, unknown>), output: "   " };
        }
        if (request.caseId === "dev-02" && request.condition === "normal_codex") throw new Error("sensitive failure fixture-private-secret");
        return result;
      }
    });
    const { run } = await runDevelopment({ loadedConfig: loaded, adapters });
    const safeOutput = run.rows.find((row) => row.caseId === "dev-01" && row.condition === "normal_codex")!;
    const emptyOutput = run.rows.find((row) => row.caseId === "dev-01" && row.condition === "workflow_only")!;
    const failedOutput = run.rows.find((row) => row.caseId === "dev-02" && row.condition === "normal_codex")!;
    expect(safeOutput.status).toBe("completed");
    expect(safeOutput.output).toContain("[REDACTED]");
    expect(safeOutput.output).not.toContain("sk-or-v1-");
    expect(safeOutput.output).not.toContain("fixture-private-secret");
    expect(emptyOutput.status).toBe("missing");
    expect(emptyOutput.errorCode).toBe("empty_required_output");
    expect(failedOutput.status).toBe("failed");
    expect(failedOutput.errorCode).toBe("provider_error");
    expect(JSON.stringify(run)).not.toContain("sensitive failure fixture-private-secret");
    expect(run.summary.exitCode).toBe(1);
  });

  it("blocks a live adapter without hard caps before it reads cases or spends", async () => {
    const loaded = await loadExample();
    const base = createFakeAdapters(loaded.config, "live");
    let caseRead = false;
    let generatorCalls = 0;
    const adapters: ExperimentAdapters = {
      generator: { ...base.generator, capabilities: { hardPerCallCostLimit: false, exactCostReporting: false, noHiddenRetries: false }, async generate(...args) { generatorCalls += 1; return base.generator.generate(...args); } },
      jev: base.jev
    };
    const account = newBudgetAccount(loaded);
    const save = async (value: typeof account) => { budgetAccountSchema.parse(value); };
    await expect(runPairedPhase({
      phase: "development",
      loadedConfig: loaded,
      getCases: async () => { caseRead = true; return await developmentCases(); },
      adapters,
      account,
      saveAccount: save
    })).rejects.toThrow(/cannot honor the frozen request\/cost caps/i);
    expect(caseRead).toBe(false);
    expect(generatorCalls).toBe(0);
  });

  it("persists request reservations before a provider failure", async () => {
    const loaded = await loadExample();
    const directory = await mkdtemp(join(tmpdir(), "goal-assistance-ledger-"));
    const ledgerPath = join(directory, "budget-ledger.json");
    try {
      const adapters = copyAdapters(loaded, {
        mode: "metered-fake",
        onGenerate() { throw new Error("unreported simulated provider failure"); }
      });
      const result = await withBudgetLedger(ledgerPath, loaded, async (account, saveAccount) => {
        return runPairedPhase({ phase: "development", loadedConfig: loaded, getCases: developmentCases, adapters, account, saveAccount });
      });
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8")) as { remoteRequests: number; reservedCostMicros: number };
      expect(persisted.remoteRequests).toBeGreaterThan(0);
      expect(persisted.reservedCostMicros).toBeGreaterThan(0);
      expect(result.rows[0]?.status).toBe("failed");
      expect(result.rows[0]?.errorCode).toBe("provider_error");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("captures the exact selected/excluded IDs and family deviation without model exposure", async () => {
    const loaded = await loadExample();
    const cases = await developmentCases();
    const selection = selectCases("development", cases.cases, loaded.config);
    expect(selection.cases.map((item) => item.case_id)).toEqual(loaded.config.selection.development);
    expect(selection.excludedCaseIds).toEqual(Array.from({ length: 8 }, (_, index) => `dev-${String(index + 31).padStart(2, "0")}`));
    expect(selection.excludedFamilies).toHaveLength(8);
    const modelInput = projectModelCase(selection.cases[0]!);
    expect(Object.keys(modelInput).sort()).toEqual(["current_goal", "permitted_scope", "prior_turns", "prompt", "relation_to_work", "repository_evidence", "unresolved_decisions"]);
  });
});
