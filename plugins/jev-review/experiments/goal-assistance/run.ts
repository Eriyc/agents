import { resolve } from "node:path";
import { loadCases } from "./harness/cases.js";
import { freezeDevelopmentConfig } from "./harness/budget.js";
import { loadConfig } from "./harness/config.js";
import { createFakeAdapters } from "./harness/fake-provider.js";
import { withBudgetLedger } from "./harness/ledger-store.js";
import { runPairedPhase } from "./harness/runner.js";
import type { ExperimentPhase } from "./harness/contracts.js";

type CliOptions = {
  phase?: ExperimentPhase;
  configPath: string;
  ledgerPath: string;
  freeze: boolean;
  provider: string;
};

function parseArgs(values: readonly string[]): CliOptions {
  const options = new Map<string, string>();
  for (const value of values) {
    if (!value.startsWith("--") || !value.includes("=")) throw new Error("Arguments must use --name=value form.");
    const separator = value.indexOf("=");
    const key = value.slice(2, separator);
    if (options.has(key)) throw new Error(`Duplicate option: --${key}.`);
    options.set(key, value.slice(separator + 1));
  }
  const allowed = new Set(["phase", "config", "ledger", "freeze", "provider"]);
  const unknown = [...options.keys()].filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown option: --${unknown[0]}.`);
  const phase = options.get("phase");
  if (phase !== undefined && phase !== "development" && phase !== "holdout") throw new Error("Phase must be development or holdout.");
  const freezeValue = options.get("freeze") ?? "false";
  if (freezeValue !== "true" && freezeValue !== "false") throw new Error("--freeze must be true or false.");
  return {
    ...(phase ? { phase } : {}),
    configPath: options.get("config") ?? "",
    ledgerPath: options.get("ledger") ?? "",
    freeze: freezeValue === "true",
    provider: options.get("provider") ?? "fake"
  };
}

export async function runCli(values: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(values);
    if (!options.configPath || !options.ledgerPath) {
      throw new Error("Supply --config=<path> and --ledger=<path>; store the ledger outside the repository.");
    }
    if (options.freeze && options.phase) throw new Error("Freezing is a separate step; omit --phase.");
    if (!options.freeze && !options.phase) throw new Error("Supply --phase=development|holdout, or use --freeze=true after development.");
    if (options.provider !== "fake") {
      throw new Error("This issue ships only the offline fake provider. Live provider adapters are not enabled.");
    }

    const loadedConfig = await loadConfig(resolve(options.configPath));
    const result = await withBudgetLedger(resolve(options.ledgerPath), loadedConfig, async (account, saveAccount) => {
      if (options.freeze) {
        freezeDevelopmentConfig(account, loadedConfig);
        await saveAccount(account);
        process.stdout.write(`${JSON.stringify({ status: "frozen", configSha256: loadedConfig.configSha256, configFileSha256: loadedConfig.configFileSha256 })}\n`);
        return null;
      }
      const phase = options.phase!;
      return runPairedPhase({
        phase,
        loadedConfig,
        getCases: () => loadCases(phase),
        adapters: createFakeAdapters(loadedConfig.config),
        account,
        saveAccount
      });
    });
    if (result === null) return 0;
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.summary.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Experiment runner failed.";
    process.stderr.write(`${JSON.stringify({ status: "blocked", error: message })}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
