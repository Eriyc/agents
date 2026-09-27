import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const MAX_PROCESSED_GOAL_EVENTS = 128;
const MAX_ID_LENGTH = 4096;
const MAX_GOAL_TEXT_LENGTH = 16_384;
const MAX_CONSTRAINTS = 256;
const MAX_CONSTRAINT_LENGTH = 8192;
const MAX_STATE_BYTES = 1_048_576;

const nonBlankId = z.string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine((value) => value.trim().length > 0);
const identitySchema = z.object({
  sessionId: nonBlankId,
  workspaceId: nonBlankId
}).strict();
const storedGoalSchema = z.object({
  text: z.string().min(1).max(MAX_GOAL_TEXT_LENGTH).refine((value) => value.trim().length > 0),
  provenance: z.enum(["accepted", "inferred"])
}).strict();
const assessmentStatusSchema = z.enum(["pending", "complete", "unavailable"]);
const constraintsSchema = z.array(z.string().max(MAX_CONSTRAINT_LENGTH)).max(MAX_CONSTRAINTS);
const pendingQuestionSchema = z.string().max(MAX_GOAL_TEXT_LENGTH).nullable();
const processedEventIdsSchema = z.array(nonBlankId)
  .min(1)
  .max(MAX_PROCESSED_GOAL_EVENTS)
  .refine((ids) => new Set(ids).size === ids.length);
const stateSchema = z.object({
  schemaVersion: z.literal(1),
  identity: identitySchema,
  /** Revision used for optimistic concurrency on every state update. */
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sourceTurnId: nonBlankId,
  goal: storedGoalSchema.nullable(),
  constraints: constraintsSchema,
  pendingQuestion: pendingQuestionSchema,
  assessmentStatus: assessmentStatusSchema,
  /** Recent IDs make hook retries idempotent; aged-out retries rely on revision checks. */
  processedEventIds: processedEventIdsSchema
}).strict();
const updateSchema = z.object({
  identity: identitySchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  eventId: nonBlankId,
  sourceTurnId: nonBlankId,
  goal: storedGoalSchema.nullable().optional(),
  constraints: constraintsSchema.optional(),
  pendingQuestion: pendingQuestionSchema.optional(),
  assessmentStatus: assessmentStatusSchema.optional()
}).strict();

export type GoalStateIdentity = z.infer<typeof identitySchema>;
export type StoredGoal = z.infer<typeof storedGoalSchema>;
export type GoalAssessmentStatus = z.infer<typeof assessmentStatusSchema>;
/** Durable product state for one host session in one workspace. */
export type GoalState = z.infer<typeof stateSchema>;

export type GoalStateReadResult =
  | { status: "found"; state: GoalState }
  | { status: "missing" }
  | { status: "corrupt" };

/** Omit a field to retain it; use null to clear nullable fields. */
export type GoalStateUpdate = z.infer<typeof updateSchema>;

export type GoalStateUpdateResult =
  | { status: "updated" | "duplicate"; state: GoalState }
  | { status: "stale"; state: GoalState | null }
  | { status: "corrupt" };

export type GoalStateStore = {
  read(identity: GoalStateIdentity): Promise<GoalStateReadResult>;
  update(change: GoalStateUpdate): Promise<GoalStateUpdateResult>;
};

export type GoalStateStoreOptions = {
  /** Defaults to the PLUGIN_DATA environment variable. */
  pluginData?: string;
};

const LOCK_STALE_AFTER_MS = 120_000;
const LOCK_WAIT_LIMIT_MS = 15_000;
const LOCK_RETRY_MS = 10;

type LoadedState = GoalStateReadResult;

function assertIdentity(identity: GoalStateIdentity): void {
  const result = identitySchema.safeParse(identity);
  if (!result.success) throw new TypeError("identity has an invalid session or workspace identifier");
}

function statePath(root: string, identity: GoalStateIdentity): string {
  const key = createHash("sha256")
    .update(JSON.stringify([identity.sessionId, identity.workspaceId]))
    .digest("hex");
  return resolve(root, `${key}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseState(value: unknown, expectedIdentity: GoalStateIdentity): GoalState | null {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    parsed.data.identity.sessionId !== expectedIdentity.sessionId ||
    parsed.data.identity.workspaceId !== expectedIdentity.workspaceId
  ) return null;
  return parsed.data;
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

async function loadState(path: string, identity: GoalStateIdentity): Promise<LoadedState> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    throw error;
  }

  if (Buffer.byteLength(contents, "utf8") > MAX_STATE_BYTES) return { status: "corrupt" };
  try {
    const state = parseState(JSON.parse(contents) as unknown, identity);
    return state ? { status: "found", state } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

function validateChange(change: GoalStateUpdate): void {
  const result = updateSchema.safeParse(change);
  if (!result.success) throw new TypeError("goal state update has an invalid shape");
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const ownerPath = resolve(lockPath, "owner");
  const token = randomUUID();
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockPath);
      await open(ownerPath, "wx", 0o600).then(async (handle) => {
        try {
          await handle.writeFile(token, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
      });
      return async () => {
        try {
          if ((await readFile(ownerPath, "utf8")) === token) {
            await rm(lockPath, { recursive: true, force: true });
          }
        } catch (error) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }

      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS) {
          const stalePath = `${lockPath}.stale-${randomUUID()}`;
          try {
            await rename(lockPath, stalePath);
            await rm(stalePath, { recursive: true, force: true });
            continue;
          } catch (reclaimError) {
            if (errorCode(reclaimError) !== "ENOENT") throw reclaimError;
          }
        }
      } catch (inspectError) {
        if (errorCode(inspectError) !== "ENOENT") throw inspectError;
      }

      if (Date.now() - startedAt >= LOCK_WAIT_LIMIT_MS) {
        throw new Error("Timed out waiting for the goal state lock");
      }
      await new Promise((done) => setTimeout(done, LOCK_RETRY_MS));
    }
  }
}

async function writeAtomically(path: string, state: GoalState): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
    throw new RangeError("Goal state exceeds the supported size");
  }

  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${serialized}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Creates a product-state store under PLUGIN_DATA/goal-assistance. */
export function createGoalStateStore(options: GoalStateStoreOptions = {}): GoalStateStore {
  const pluginData = options.pluginData ?? process.env.PLUGIN_DATA;
  if (typeof pluginData !== "string" || pluginData.trim().length === 0) {
    throw new Error("PLUGIN_DATA must identify the plugin data directory");
  }
  const root = resolve(pluginData, "goal-assistance");

  return {
    async read(identity): Promise<GoalStateReadResult> {
      assertIdentity(identity);
      return loadState(statePath(root, identity), identity);
    },

    async update(change): Promise<GoalStateUpdateResult> {
      validateChange(change);
      const path = statePath(root, change.identity);
      await mkdir(dirname(path), { recursive: true });
      const release = await acquireLock(path);
      try {
        const loaded = await loadState(path, change.identity);
        if (loaded.status === "corrupt") return { status: "corrupt" };
        const current = loaded.status === "found" ? loaded.state : null;

        if (current?.processedEventIds.includes(change.eventId)) {
          return { status: "duplicate", state: current };
        }

        const currentRevision = current?.revision ?? 0;
        if (change.expectedRevision !== currentRevision) {
          return { status: "stale", state: current };
        }

        const processedEventIds = [...(current?.processedEventIds ?? []), change.eventId]
          .slice(-MAX_PROCESSED_GOAL_EVENTS);
        const next: GoalState = {
          schemaVersion: 1,
          identity: { ...change.identity },
          revision: currentRevision + 1,
          sourceTurnId: change.sourceTurnId,
          goal: change.goal !== undefined
            ? (change.goal === null ? null : { ...change.goal })
            : (current?.goal ? { ...current.goal } : null),
          constraints: change.constraints !== undefined
            ? [...change.constraints]
            : [...(current?.constraints ?? [])],
          pendingQuestion: change.pendingQuestion !== undefined
            ? change.pendingQuestion
            : (current?.pendingQuestion ?? null),
          assessmentStatus: change.assessmentStatus ?? current?.assessmentStatus ?? "pending",
          processedEventIds
        };

        await writeAtomically(path, next);
        return { status: "updated", state: next };
      } finally {
        await release();
      }
    }
  };
}
