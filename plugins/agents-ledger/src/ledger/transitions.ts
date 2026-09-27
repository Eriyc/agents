import type { RunCommand } from "./command.js";
import type { Route } from "./paths.js";

export type Transition = "claim" | "block" | "reopen" | "close";

export async function transitionIssue(target: Route, run: RunCommand, issueId: string, action: Transition, reason?: string): Promise<string> {
  if (reason && !["block", "close"].includes(action)) throw new Error("reason is only supported for block or close");
  if (["block", "close"].includes(action) && !reason?.trim()) throw new Error(action + " requires a reason");
  const args = action === "claim" ? ["update", issueId, "--claim"]
    : action === "block" ? ["update", issueId, "--status", "blocked", "--append-notes", reason!.trim()]
    : action === "reopen" ? ["update", issueId, "--status", "open"]
    : ["close", issueId, "--reason", reason!.trim()];
  await run(["bd", "--directory", target.goal, ...args], target.goal);
  return issueId + " " + action + " succeeded";
}
