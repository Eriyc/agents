export type RunCommand = (argv: string[], cwd: string) => Promise<string>;

const MAX_OUTPUT = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MUTATION_TIMEOUT_MS = 60_000;

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
  const executable = command === "bd" ? (process.env.BEADS_PATH || "bd") : command;
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
