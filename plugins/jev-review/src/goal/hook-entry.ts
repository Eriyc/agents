import { createGoalStateStore } from "./state.js";
import {
  createGoalDiagnosticSink,
  createGoalPromptSubmitHook,
  goalHookFailureOutput,
  readGoalMode,
  GOAL_HOOK_MAX_STDIN_BYTES,
  type GoalHookOutput
} from "./hook.js";

export type GoalHookCliOptions = {
  environment?: NodeJS.ProcessEnv;
  stdin?: AsyncIterable<Uint8Array | string>;
  stdout?: Pick<NodeJS.WriteStream, "write">;
};

type BoundedInput =
  | { status: "ok"; input: unknown }
  | { status: "oversize" }
  | { status: "invalid" };

async function readBoundedJson(stream: AsyncIterable<Uint8Array | string>): Promise<BoundedInput> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > GOAL_HOOK_MAX_STDIN_BYTES) return { status: "oversize" };
      chunks.push(bytes);
    }
    const input = JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
    return { status: "ok", input };
  } catch {
    return { status: "invalid" };
  }
}

function emit(output: GoalHookOutput, stdout: Pick<NodeJS.WriteStream, "write">): void {
  if (Object.keys(output).length > 0) stdout.write(`${JSON.stringify(output)}\n`);
}

/** Runs the bounded Bun command-hook protocol; exported so the stdin contract is testable. */
export async function runGoalPromptSubmitCli(options: GoalHookCliOptions = {}): Promise<void> {
  const environment = options.environment ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const modeSetting = readGoalMode(environment.JEV_GOAL_MODE);
  if (modeSetting.invalid) {
    emit(goalHookFailureOutput("off", "Goal assistance was disabled because JEV_GOAL_MODE is invalid."), stdout);
    return;
  }

  const mode = modeSetting.mode;
  const diagnosticsEnabled = environment.JEV_GOAL_DIAGNOSTICS === "1";
  const includeContent = diagnosticsEnabled && environment.JEV_GOAL_DIAGNOSTICS_CONTENT === "1";
  if (mode === "off" || (mode === "observe" && !diagnosticsEnabled)) return;

  const stdin = options.stdin ?? process.stdin;
  const parsed = await readBoundedJson(stdin);
  if (parsed.status !== "ok") {
    const message = parsed.status === "oversize"
      ? "Goal assistance skipped this prompt because its bounded input limit was exceeded."
      : "Goal assistance skipped this prompt because the hook event could not be read.";
    emit(goalHookFailureOutput(mode, message), stdout);
    return;
  }

  const pluginData = environment.PLUGIN_DATA;
  let stateStore: ReturnType<typeof createGoalStateStore> | undefined;
  let diagnosticSink: ReturnType<typeof createGoalDiagnosticSink> | undefined;
  try {
    if (pluginData?.trim()) {
      stateStore = createGoalStateStore({ pluginData });
      if (diagnosticsEnabled) diagnosticSink = createGoalDiagnosticSink(pluginData);
    }
  } catch {
    // The hook handler returns a single nonblocking notice if state is unavailable.
  }

  if (mode === "observe" && (!diagnosticsEnabled || !diagnosticSink)) {
    emit(goalHookFailureOutput("observe", "Goal assistance observation could not write local diagnostics; prompt behavior is unchanged."), stdout);
    return;
  }

  const hook = createGoalPromptSubmitHook({
    mode,
    ...(stateStore ? { stateStore } : {}),
    ...(diagnosticsEnabled ? {
      diagnostics: {
        enabled: true,
        includeContent,
        ...(diagnosticSink ? { sink: diagnosticSink } : {})
      }
    } : {})
  });

  try {
    emit(await hook(parsed.input), stdout);
  } catch {
    emit(goalHookFailureOutput(mode, "Goal assistance triage is unavailable; ask for clarification when needed."), stdout);
  }
}

if (import.meta.main) {
  void runGoalPromptSubmitCli().catch(() => {
    const mode = readGoalMode(process.env.JEV_GOAL_MODE).mode;
    emit(goalHookFailureOutput(mode, "Goal assistance triage is unavailable; ask for clarification when needed."), process.stdout);
  });
}
