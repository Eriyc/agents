import type { RunCommand } from "./command.js";
import type { Route } from "./paths.js";

export type NewIssue = {
  title: string;
  description: string;
  acceptance: string;
  writablePaths: string[];
  type: "task" | "epic" | "chore" | "decision" | "bug" | "feature" | "spike" | "story" | "milestone";
  priority: 0 | 1 | 2 | 3 | 4;
  parent?: string | undefined;
};

function writablePath(value: string): boolean {
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  return !path.startsWith("/") && !path.includes("\\") && !/^[A-Za-z]:/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..") &&
    !path.split("/").includes(".beads") && !path.endsWith("state.yaml");
}

export async function createIssue(target: Route, run: RunCommand, issue: NewIssue): Promise<string> {
  if (!issue.writablePaths.every(writablePath)) throw new Error("writablePaths contains an invalid or reserved path");
  const args = ["bd", "--directory", target.goal, "create", "--title", issue.title,
    "--description", issue.description, "--acceptance", issue.acceptance,
    "--metadata", JSON.stringify({ writable_paths: issue.writablePaths }),
    "--type", issue.type, "--priority", String(issue.priority), "--silent"];
  if (issue.parent) args.push("--parent", issue.parent);
  const id = (await run(args, target.goal)).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("bd create returned an invalid issue ID");
  return id;
}

export async function addDependency(target: Route, run: RunCommand, issueId: string, blockedById: string): Promise<string> {
  if (issueId === blockedById) throw new Error("an issue cannot depend on itself");
  await run(["bd", "--directory", target.goal, "dep", "add", issueId, blockedById], target.goal);
  return issueId + " depends on " + blockedById;
}

export async function appendNote(target: Route, run: RunCommand, issueId: string, note: string): Promise<string> {
  await run(["bd", "--directory", target.goal, "update", issueId, "--append-notes", note], target.goal);
  return issueId + " note appended";
}
