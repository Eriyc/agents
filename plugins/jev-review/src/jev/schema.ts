import { z } from "zod";

const probabilityMapSchema = z.record(z.string(), z.number().min(0).max(1));

export const jevNoulAnswerSchema = z
  .object({
    type: z.literal("noul"),
    noul: z.number().min(0).max(1)
  })
  .passthrough();

export const jevChoiceAnswerSchema = z
  .object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: probabilityMapSchema,
    confidence: z.number().min(0).max(1)
  })
  .passthrough();

export const jevScoreAnswerSchema = z
  .object({
    type: z.literal("score"),
    score: z.number().min(0).max(9),
    legend: z.record(z.string(), z.string()),
    probabilities: probabilityMapSchema,
    confidence: z.number().min(0).max(1)
  })
  .passthrough();

export const jevAnswerSchema = z.discriminatedUnion("type", [
  jevNoulAnswerSchema,
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema
]);

export const jevResponseSchema = z
  .object({
    model: z.string(),
    answers: z.record(z.string(), jevAnswerSchema),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export type JevResponse = z.infer<typeof jevResponseSchema>;

export type JevJsonValue = string | number | boolean | null | JevJsonValue[] | { [key: string]: JevJsonValue };
export type JevState = JevJsonValue;

export const JEV_STATE_MAX_BYTES = 64 * 1024;
const JEV_STATE_MAX_DEPTH = 32;
const JEV_STATE_MAX_NODES = 10_000;

/** Validate without coercion or truncation so callers send exactly the state they supplied. */
export function parseJevState(value: unknown): JevState {
  const pending: Array<{ value: unknown; depth: number; exit?: true }> = [{ value, depth: 0 }];
  const active = new WeakSet<object>();
  let nodeCount = 0;

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (item.exit) {
      active.delete(item.value as object);
      continue;
    }

    nodeCount += 1;
    if (nodeCount > JEV_STATE_MAX_NODES) {
      throw new TypeError(`Jev evaluation state exceeds the ${JEV_STATE_MAX_NODES}-node limit.`);
    }
    if (item.depth > JEV_STATE_MAX_DEPTH) {
      throw new TypeError(`Jev evaluation state exceeds the ${JEV_STATE_MAX_DEPTH}-level nesting limit.`);
    }

    const current = item.value;
    if (current === null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("Jev evaluation state must contain only finite numbers.");
      continue;
    }
    if (typeof current !== "object") {
      throw new TypeError("Jev evaluation state must contain only JSON-compatible values.");
    }
    if (active.has(current)) throw new TypeError("Jev evaluation state cannot contain circular references.");
    active.add(current);
    pending.push({ value: current, depth: item.depth, exit: true });

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype || current.length > JEV_STATE_MAX_NODES) {
        throw new TypeError("Jev evaluation state must contain ordinary bounded arrays.");
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1 || keys.some((key) => key !== "length" && !isArrayIndex(key, current.length))) {
        throw new TypeError("Jev evaluation state arrays must be dense and have no extra properties.");
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("Jev evaluation state arrays must contain ordinary JSON values.");
        }
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Jev evaluation state objects must be plain JSON objects.");
    }
    const keys = Reflect.ownKeys(current);
    if (keys.length > JEV_STATE_MAX_NODES) {
      throw new TypeError(`Jev evaluation state exceeds the ${JEV_STATE_MAX_NODES}-node limit.`);
    }
    for (const key of keys) {
      if (typeof key !== "string") throw new TypeError("Jev evaluation state cannot contain symbol keys.");
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Jev evaluation state objects must contain ordinary enumerable properties.");
      }
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Jev evaluation state could not be serialized as JSON.");
  }
  if (serialized === undefined) throw new TypeError("Jev evaluation state must be JSON-compatible.");
  if (new TextEncoder().encode(serialized).byteLength > JEV_STATE_MAX_BYTES) {
    throw new TypeError(`Jev evaluation state exceeds the ${JEV_STATE_MAX_BYTES}-byte limit.`);
  }
  return value as JevState;
}

function isArrayIndex(key: PropertyKey, length: number): key is string {
  if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < length;
}
