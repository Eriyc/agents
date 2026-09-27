import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseJson, type RunCommand } from "../ledger/command.js";
import { route, type Route } from "../ledger/paths.js";

const MAX_ISSUES = 500;
const TEMPLATE_MARKER = "<!-- LEDGER_SNAPSHOT -->";

type Issue = {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  updatedAt: string | null;
  heartbeatAt: string | null;
  parent: string | null;
};

export type StatusSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  goal: string;
  workspace: string;
  issues: Issue[];
  readyIds: string[];
};

function rows(value: unknown, command: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > MAX_ISSUES ||
      value.some((item) => typeof item !== "object" || item === null ||
        typeof item.id !== "string" || typeof item.title !== "string" || typeof item.status !== "string"))
    throw new Error("bd " + command + " returned invalid or excessive issue data (limit " + MAX_ISSUES + ")");
  return value as Record<string, unknown>[];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function templatePath(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "assets", "status.html"),
    join(import.meta.dir, "..", "assets", "status.html")
  ];
  const file = candidates.find(existsSync);
  if (!file) throw new Error("bundled status.html is missing");
  return file;
}

export async function statusSnapshot(target: Route, run: RunCommand): Promise<StatusSnapshot> {
  const command = (args: string[]) => run(["bd", "--readonly", "--directory", target.goal, ...args, "--json"], target.goal);
  const [listText, readyText] = await Promise.all([
    command(["list", "--all", "--brief", "--limit", "0"]),
    command(["ready", "--brief", "--limit", "0"])
  ]);
  const list = rows(parseJson(listText, "bd list"), "list");
  const ready = rows(parseJson(readyText, "bd ready"), "ready");
  const heading = readFileSync(join(target.goal, "goal.md"), "utf8").split(/\r?\n/).find((line) => /^# /.test(line));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    goal: heading?.slice(2).trim() || basename(target.goal),
    workspace: basename(target.workspace),
    issues: list.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      status: row.status as string,
      assignee: optionalString(row.assignee),
      updatedAt: optionalString(row.updated_at),
      heartbeatAt: optionalString(row.heartbeat_at),
      parent: optionalString(row.parent)
    })),
    readyIds: ready.map((row) => row.id as string)
  };
}

export function statusPagePath(target: Route): string {
  const key = createHash("sha256").update(target.goal).digest("hex").slice(0, 16);
  return join(tmpdir(), "agents-ledger", "status", key + ".html");
}

export function renderStatusPage(snapshot: StatusSnapshot): string {
  const template = readFileSync(templatePath(), "utf8");
  if (!template.includes(TEMPLATE_MARKER)) throw new Error("status.html has no snapshot marker");
  const payload = JSON.stringify(snapshot).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return template.replace(TEMPLATE_MARKER, '<script id="snapshot" type="application/json">' + payload + "</script>");
}

export async function writeStatusPage(workspaceRoot: string, goalDir: string, run: RunCommand): Promise<string> {
  const target = await route(workspaceRoot, goalDir, run);
  const html = renderStatusPage(await statusSnapshot(target, run));
  const output = statusPagePath(target);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = output + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, html, "utf8");
    renameSync(temporary, output);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  if (statSync(output).size === 0) throw new Error("status page was empty");
  return output;
}
