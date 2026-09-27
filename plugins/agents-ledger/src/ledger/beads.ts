import { parseJson, type RunCommand } from "./command.js";
import type { Route } from "./paths.js";

export const LIMITS = { ready: 2048, task: 8192, excerpt: 4096, receipt: 2048 } as const;

export function bounded(kind: keyof typeof LIMITS, value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > LIMITS[kind])
    throw new Error(`${kind} packet is ${bytes} bytes (limit ${LIMITS[kind]}); narrow the request or split the issue`);
  return value;
}

type Issue = {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  description?: string;
  acceptance_criteria?: string;
  metadata?: { writable_paths?: string[] };
  dependencies?: Array<{ id: string; status?: string; dependency_type?: string }>;
};

function isIssue(value: unknown): value is Issue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.title === "string" && typeof row.status === "string";
}

async function issues(route: Route, run: RunCommand, args: string[]): Promise<Issue[]> {
  const value = parseJson(await run(["bd", "--readonly", "--directory", route.goal, ...args, "--json"], route.goal), `bd ${args[0]}`);
  if (!Array.isArray(value) || !value.every(isIssue)) throw new Error(`bd ${args[0]} returned invalid issue data`);
  return value;
}

export async function readyPacket(route: Route, run: RunCommand, parent?: string): Promise<string> {
  const args = ["ready", "--brief", "--limit", "0"];
  if (parent) args.push("--parent", parent);
  const rows = await issues(route, run, args);
  return bounded("ready", [`Ready issues: ${rows.length}`, ...rows.map((row) => `${row.id} | ${row.status} | ${row.title}`)].join("\n"));
}

export async function getIssue(route: Route, run: RunCommand, id: string): Promise<Issue> {
  if (!id || !/^[\w.-]+$/.test(id)) throw new Error("issueId is invalid");
  const rows = await issues(route, run, ["show", id, "--brief-deps"]);
  if (rows.length !== 1 || rows[0]?.id !== id) throw new Error(`expected exactly issue ${id}`);
  return rows[0];
}

export async function taskPacket(route: Route, run: RunCommand, id: string): Promise<string> {
  const issue = await getIssue(route, run, id);
  const paths = issue.metadata?.writable_paths;
  if (paths !== undefined && (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")))
    throw new Error(`issue ${id} has invalid metadata.writable_paths`);
  const dependencies = issue.dependencies;
  if (dependencies !== undefined && (!Array.isArray(dependencies) || dependencies.some((dep) => !dep || typeof dep.id !== "string")))
    throw new Error(`issue ${id} has invalid dependencies`);
  return bounded("task", [
    `Issue: ${issue.id} | ${issue.title}`,
    `State: ${issue.status} | assignee ${issue.assignee || "unclaimed"}`,
    `Dependencies: ${dependencies?.map((dep) => `${dep.id} (${dep.status || "unknown"}${dep.dependency_type ? `, ${dep.dependency_type}` : ""})`).join(", ") || "none"}`,
    `Writable paths: ${paths?.join(", ") || "none"}`,
    "Goal acceptance: goal.md",
    `Scope and references: ${issue.description || "none"}`,
    `Issue acceptance: ${issue.acceptance_criteria || "none"}`
  ].join("\n"));
}
