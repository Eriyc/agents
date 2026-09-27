import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { budgetAccountSchema, newBudgetAccount, validateBudgetAccount, type BudgetAccount } from "./budget.js";
import type { LoadedConfig } from "./config.js";

export type SaveBudgetAccount = (account: BudgetAccount) => Promise<void>;

/** Serializes access and persists a reservation before every metered provider call. */
export async function withBudgetLedger<T>(
  ledgerPath: string,
  loaded: LoadedConfig,
  work: (account: BudgetAccount, save: SaveBudgetAccount) => Promise<T>
): Promise<T> {
  const absolutePath = resolve(ledgerPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const lockPath = `${absolutePath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch {
    throw new Error("Budget ledger is locked by another experiment process.");
  }

  try {
    let account: BudgetAccount;
    try {
      const raw = await readFile(absolutePath, "utf8");
      let value: unknown;
      try { value = JSON.parse(raw) as unknown; }
      catch { throw new Error("Budget ledger is not valid JSON."); }
      const parsed = budgetAccountSchema.safeParse(value);
      if (!parsed.success) throw new Error("Budget ledger contract mismatch.");
      account = parsed.data;
    } catch (error) {
      if (isMissingFile(error)) account = newBudgetAccount(loaded);
      else throw error;
    }
    validateBudgetAccount(account, loaded);

    const save: SaveBudgetAccount = async (next) => {
      const validated = budgetAccountSchema.parse(next);
      validateBudgetAccount(validated, loaded);
      const temporary = `${absolutePath}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, absolutePath);
      account = validated;
    };
    await save(account);
    return await work(account, save);
  } finally {
    await lock?.close();
    await rm(lockPath, { force: true });
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
