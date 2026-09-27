import { z } from "zod";
import type { ExperimentPhase } from "./contracts.js";
import type { LoadedConfig } from "./config.js";

export const budgetAccountSchema = z.strictObject({
  schemaVersion: z.literal(1),
  experimentId: z.string().min(3),
  sharedConfigSha256: z.string().regex(/^[a-f0-9]{64}$/),
  remoteRequests: z.number().int().nonnegative(),
  reportedCostMicros: z.number().int().nonnegative(),
  reservedCostMicros: z.number().int().nonnegative(),
  developmentStarted: z.boolean(),
  frozenConfigSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  holdoutStarted: z.boolean()
});
export type BudgetAccount = z.infer<typeof budgetAccountSchema>;

export function newBudgetAccount(loaded: LoadedConfig): BudgetAccount {
  return {
    schemaVersion: 1,
    experimentId: loaded.config.experimentId,
    sharedConfigSha256: loaded.sharedConfigSha256,
    remoteRequests: 0,
    reportedCostMicros: 0,
    reservedCostMicros: 0,
    developmentStarted: false,
    frozenConfigSha256: null,
    holdoutStarted: false
  };
}

export function validateBudgetAccount(account: BudgetAccount, loaded: LoadedConfig): void {
  if (account.experimentId !== loaded.config.experimentId || account.sharedConfigSha256 !== loaded.sharedConfigSha256) {
    throw new Error("Budget ledger does not match this experiment's pinned model, context, tools, selection, and limits.");
  }
  if (account.remoteRequests > loaded.config.limits.maxRemoteRequests) {
    throw new Error("Budget ledger already exceeds the configured remote-request cap.");
  }
  const maximumMicros = Math.floor(loaded.config.limits.maxCostUsd * 1_000_000 + 1e-7);
  if (account.reportedCostMicros + account.reservedCostMicros > maximumMicros) {
    throw new Error("Budget ledger already exceeds the configured cost cap.");
  }
}

export function authorizePhase(
  phase: ExperimentPhase,
  account: BudgetAccount,
  loaded: LoadedConfig
): void {
  validateBudgetAccount(account, loaded);
  if (phase === "development") {
    if (account.frozenConfigSha256 !== null || account.holdoutStarted) {
      throw new Error("Development is locked after the prompt/config freeze.");
    }
    account.developmentStarted = true;
    return;
  }
  if (!account.developmentStarted || account.frozenConfigSha256 === null) {
    throw new Error("Holdout is sealed until development has run and its config hash is frozen.");
  }
  if (account.holdoutStarted) throw new Error("Holdout has already started; it may be scored only once.");
  if (account.frozenConfigSha256 !== loaded.configSha256) {
    throw new Error("Holdout config hash differs from the frozen development config.");
  }
  account.holdoutStarted = true;
}

export function freezeDevelopmentConfig(account: BudgetAccount, loaded: LoadedConfig): void {
  validateBudgetAccount(account, loaded);
  if (!account.developmentStarted) throw new Error("Run the development phase before freezing its config.");
  if (account.holdoutStarted) throw new Error("Cannot freeze after holdout has started.");
  if (account.frozenConfigSha256 !== null) throw new Error("A config is already frozen; freeze cannot be reset.");
  account.frozenConfigSha256 = loaded.configSha256;
}

export function totalPlannedRemoteRequests(loaded: LoadedConfig): number {
  const { development, holdout } = loaded.config.selection;
  // Each selected case uses one Codex generation request in all three conditions and one Jev call in condition 3.
  return (development.length + holdout.length) * 4;
}

export function validatePlannedBudget(loaded: LoadedConfig): { plannedRemoteRequests: number; plannedPerCallCapUsd: number } {
  const plannedRemoteRequests = totalPlannedRemoteRequests(loaded);
  if (plannedRemoteRequests > loaded.config.limits.maxRemoteRequests) {
    throw new Error(`Frozen case plan requires ${plannedRemoteRequests} remote requests; cap is ${loaded.config.limits.maxRemoteRequests}.`);
  }
  const plannedPerCallCapUsd = loaded.config.limits.maxCostUsd / plannedRemoteRequests;
  if (!Number.isFinite(plannedPerCallCapUsd) || plannedPerCallCapUsd <= 0) {
    throw new Error("Frozen case plan leaves no positive per-request cost allowance.");
  }
  return { plannedRemoteRequests, plannedPerCallCapUsd };
}

export function costToMicros(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("Provider reported invalid cost usage.");
  return Math.ceil(costUsd * 1_000_000 - 1e-7);
}
