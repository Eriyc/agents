import { readFileSync, statSync } from "node:fs";
import { fileInside, type Route } from "./paths.js";
import { bounded } from "./beads.js";

const MAX_SOURCE_BYTES = 1024 * 1024;

export type DocumentRequest =
  | { scope: "goal" | "workspace"; path: string; operation: "headings"; filter?: string }
  | { scope: "goal" | "workspace"; path: string; operation: "lines"; startLine: number; endLine: number }
  | { scope: "goal" | "workspace"; path: string; operation: "characters"; line: number; startChar: number; endChar: number };

export function documentPacket(route: Route, input: DocumentRequest): string {
  const root = input.scope === "goal" ? route.goal : route.workspace;
  const file = fileInside(root, input.path, "path");
  if (statSync(file).size > MAX_SOURCE_BYTES) throw new Error("source file exceeds 1 MiB");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file)).split(/\r?\n/);
  if (input.operation === "headings") {
    const filter = input.filter?.toLowerCase() || "";
    return bounded("ready", [`File: ${input.path}`,
      ...lines.flatMap((line, index) => /^#{1,6} /.test(line) && line.toLowerCase().includes(filter) ? [`${index + 1}: ${line}`] : [])
    ].join("\n"));
  }
  if (input.operation === "lines") {
    const { startLine, endLine } = input;
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length)
      throw new Error(`line range must be within 1..${lines.length}`);
    return bounded("excerpt", [`File: ${input.path} (${startLine}-${endLine} of ${lines.length})`,
      ...lines.slice(startLine - 1, endLine).map((line, index) => `${startLine + index}: ${line}`)
    ].join("\n"));
  }
  const { line, startChar, endChar } = input;
  if (!Number.isSafeInteger(line) || line < 1 || line > lines.length) throw new Error(`line must be within 1..${lines.length}`);
  const chars = Array.from(lines[line - 1]!);
  if (!Number.isSafeInteger(startChar) || !Number.isSafeInteger(endChar) || startChar < 0 || endChar <= startChar || endChar > chars.length)
    throw new Error(`character range must be within 0..${chars.length}`);
  return bounded("excerpt", `File: ${input.path} (${line}:${startChar}-${endChar} of ${chars.length})\n${chars.slice(startChar, endChar).join("")}`);
}
