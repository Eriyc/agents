import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { win32 } from "node:path";

export type RunCommand = (argv: string[], cwd: string) => Promise<string>;

const MAX_OUTPUT = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MUTATION_TIMEOUT_MS = 60_000;

export function resolveBeadsExecutable(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BEADS_PATH) return env.BEADS_PATH;
  if (process.platform !== "win32") return "bd";

  // Bun only searches the MCP process's PATH. Codex may omit mise's paths even
  // when bd works in an interactive shell.
  for (const entry of (env.PATH || env.Path || "").split(";")) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (directory && existsSync(win32.join(directory, "bd.exe")))
      return win32.join(directory, "bd.exe");
  }
  const localAppData = env.LOCALAPPDATA || win32.join(homedir(), "AppData", "Local");
  const miseData = env.MISE_DATA_DIR || win32.join(localAppData, "mise");
  for (const tool of ["github-gastownhall-beads", "beads"]) {
    const installs = win32.join(miseData, "installs", tool);
    if (!existsSync(installs)) continue;
    const versions = readdirSync(installs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const executable = win32.join(installs, version, "bd.exe");
      if (existsSync(executable)) return executable;
    }
  }
  return "bd";
}

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw new Error(`command output exceeds ${cap} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export const runCommand: RunCommand = async (argv, cwd) => {
  const command = argv[0];
  if (!command) throw new Error("empty command");
  const executable = command === "bd" ? resolveBeadsExecutable() : command;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([executable, ...argv.slice(1)], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  } catch (error) {
    throw new Error(`cannot start ${command}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const timeout = command === "bd" && !argv.includes("--readonly") ? MUTATION_TIMEOUT_MS : TIMEOUT_MS;
  const timer = setTimeout(() => proc.kill(), timeout);
  try {
    const [stdout, stderr, code] = await Promise.all([
      readCapped(proc.stdout as ReadableStream<Uint8Array>, MAX_OUTPUT),
      readCapped(proc.stderr as ReadableStream<Uint8Array>, MAX_OUTPUT),
      proc.exited
    ]);
    if (code !== 0) throw new Error(`${command} failed (${code}): ${stderr.trim().slice(0, 1000)}`);
    return stdout;
  } catch (error) {
    proc.kill();
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error(`${label} returned malformed JSON`); }
}
