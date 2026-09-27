import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseJson, type RunCommand } from "./command.js";

export type Route = { workspace: string; goal: string; beads: string };
export type GoalRoute = Pick<Route, "workspace" | "goal">;

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function relativePath(value: string, label: string): string {
  if (!value || isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("\\"))
    throw new Error(`${label} must be a relative path`);
  const parts = value.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw new Error(`${label} must be normalized and cannot traverse directories`);
  return parts.join(sep);
}

export function fileInside(root: string, input: string, label: string): string {
  const path = relativePath(input, label);
  if (path.split(sep).some((part) => part === ".beads"))
    throw new Error(`${label} cannot read .beads files`);
  const absolute = realpathSync(resolve(root, path));
  if (!contained(root, absolute)) throw new Error(`${label} escapes its root`);
  if (relative(root, absolute).split(sep).includes(".beads"))
    throw new Error(`${label} cannot read .beads files`);
  if (!statSync(absolute).isFile()) throw new Error(`${label} must name a regular file`);
  return absolute;
}

export async function routeGoal(workspaceRoot: string, goalDir: string, run: RunCommand): Promise<GoalRoute> {
  if (!isAbsolute(workspaceRoot)) throw new Error("workspaceRoot must be absolute");
  const workspace = realpathSync(workspaceRoot);
  if (!statSync(workspace).isDirectory()) throw new Error("workspaceRoot must be a directory");
  const gitRoot = (await run(["git", "rev-parse", "--show-toplevel"], workspace)).trim();
  if (!samePath(realpathSync(gitRoot), workspace)) throw new Error("workspaceRoot must be the Git worktree root");
  const goal = realpathSync(resolve(workspace, relativePath(goalDir, "goalDir")));
  if (!contained(workspace, goal) || samePath(workspace, goal)) throw new Error("goalDir escapes workspaceRoot");
  if (!statSync(goal).isDirectory() || !existsSync(join(goal, "goal.md")))
    throw new Error("goalDir requires a goal.md file");
  return { workspace, goal };
}

export async function route(workspaceRoot: string, goalDir: string, run: RunCommand): Promise<Route> {
  const { workspace, goal } = await routeGoal(workspaceRoot, goalDir, run);
  const beads = realpathSync(join(goal, ".beads"));
  if (!contained(goal, beads) || !statSync(beads).isDirectory())
    throw new Error("goalDir requires a goal-local .beads directory");
  const where = parseJson(await run(["bd", "--readonly", "--directory", goal, "where", "--json"], goal), "bd where");
  if (typeof where !== "object" || where === null || !("path" in where) || typeof where.path !== "string")
    throw new Error("bd where returned no Beads path");
  if (!samePath(realpathSync(where.path), beads)) throw new Error("bd selected a different Beads database");
  return { workspace, goal, beads };
}
