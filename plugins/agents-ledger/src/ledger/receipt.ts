import { readFileSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import { getIssue, LIMITS } from "./beads.js";
import type { RunCommand } from "./command.js";
import { fileInside, type Route } from "./paths.js";

const KEYS = ["task_id", "status", "base_sha", "changed_paths", "checks", "open_findings", "next_action"];
const CHECK_KEYS = ["command", "status", "environment", "evidence"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function validCheck(value: unknown): boolean {
  return record(value) && Object.keys(value).length === CHECK_KEYS.length &&
    Object.keys(value).every((key) => CHECK_KEYS.includes(key)) &&
    typeof value.command === "string" && value.command.trim() !== "" &&
    ["passed", "failed", "blocked", "not-required"].includes(String(value.status)) &&
    typeof value.environment === "string" && value.environment.trim() !== "" &&
    typeof value.evidence === "string" && value.evidence.trim() !== "";
}

function normalizedPath(value: string): boolean {
  return !value.startsWith("/") && !value.includes("\\") && !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isOwned(path: string, writable: string[]): boolean {
  return writable.some((allowed) => {
    if (!normalizedPath(allowed.endsWith("/") ? allowed.slice(0, -1) : allowed)) return false;
    return allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed;
  });
}

export async function validateReceipt(route: Route, run: RunCommand, id: string, receiptPath: string): Promise<string> {
  const issue = await getIssue(route, run, id);
  const writable = issue.metadata?.writable_paths;
  if (!strings(writable))
    throw new Error(`issue ${id} needs metadata.writable_paths`);
  const file = fileInside(route.workspace, receiptPath, "receiptPath");
  const bytes = statSync(file).size;
  if (bytes > LIMITS.receipt) throw new Error(`receipt is ${bytes} bytes (limit ${LIMITS.receipt})`);
  const body = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
  let value: unknown;
  try { value = Bun.YAML.parse(body); }
  catch { throw new Error("receipt is invalid YAML"); }
  if (!record(value) || Object.keys(value).length !== KEYS.length || Object.keys(value).some((key) => !KEYS.includes(key)))
    throw new Error("receipt fields are invalid");
  if (value.task_id !== id) throw new Error(`receipt task_id must equal ${id}`);
  if (value.status !== "ready-for-coordinator" && value.status !== "blocked") throw new Error("receipt status is invalid");
  if (typeof value.base_sha !== "string" || !/^[0-9a-f]{40}$/.test(value.base_sha)) throw new Error("receipt needs a full base SHA");
  if (!strings(value.changed_paths))
    throw new Error("receipt changed_paths is invalid");
  if (!strings(value.open_findings))
    throw new Error("receipt open_findings is invalid");
  if (!Array.isArray(value.checks) || !value.checks.every(validCheck)) throw new Error("receipt checks are invalid");
  if (typeof value.next_action !== "string" || !value.next_action.trim()) throw new Error("receipt next_action is required");
  for (const path of value.changed_paths as string[]) {
    if (!normalizedPath(path)) throw new Error(`receipt path is not normalized: ${path}`);
    if (path.split("/").includes(".beads") || path === "state.yaml" || path.endsWith("/state.yaml"))
      throw new Error(`receipt path is reserved: ${path}`);
    if (!isOwned(path, writable as string[])) throw new Error(`receipt path is outside ${id} ownership: ${path}`);
  }
  const rel = relative(route.workspace, file).split(sep).join("/");
  return `Worker receipt valid (${bytes}/${LIMITS.receipt} bytes): ${rel}`;
}
