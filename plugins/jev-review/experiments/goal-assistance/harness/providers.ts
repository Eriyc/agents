import type { GeneratorRequest, JevRequest } from "./contracts.js";

export type ProviderMode = "offline" | "metered-fake" | "live";
export type ProviderCapabilities = {
  hardPerCallCostLimit: boolean;
  exactCostReporting: boolean;
  noHiddenRetries: boolean;
};
export type RemoteAllowance = { hardCostCapUsd: number; maxRemoteRequests: 1 };

export type GeneratorAdapter = {
  readonly provider: "codex";
  readonly model: string;
  readonly mode: ProviderMode;
  readonly capabilities: ProviderCapabilities;
  readonly secretsToRedact?: readonly string[];
  generate(request: GeneratorRequest, allowance: RemoteAllowance, signal: AbortSignal): Promise<unknown>;
};

export type OpenRouterJevAdapter = {
  readonly provider: "openrouter";
  readonly model: string;
  readonly mode: ProviderMode;
  readonly capabilities: ProviderCapabilities;
  readonly secretsToRedact?: readonly string[];
  evaluate(request: JevRequest, allowance: RemoteAllowance, signal: AbortSignal): Promise<unknown>;
};

export type ExperimentAdapters = {
  generator: GeneratorAdapter;
  jev: OpenRouterJevAdapter;
};

export const fullyMeteredCapabilities: ProviderCapabilities = {
  hardPerCallCostLimit: true,
  exactCostReporting: true,
  noHiddenRetries: true
};

export function validateAdapterBoundary(adapters: ExperimentAdapters, requestedGeneratorModel: string, requestedJevModel: string): void {
  if (adapters.generator.provider !== "codex" || adapters.generator.model !== requestedGeneratorModel) {
    throw new Error("Generator provider/model does not match the frozen case contract.");
  }
  if (adapters.jev.provider !== "openrouter" || adapters.jev.model !== requestedJevModel) {
    throw new Error("Jev provider/model does not match the frozen OpenRouter contract.");
  }
  if (adapters.generator.mode !== adapters.jev.mode) {
    throw new Error("Generator and Jev adapters must use the same live/offline execution mode.");
  }
  if (adapters.generator.mode === "live") {
    for (const [name, adapter] of [["Codex generator", adapters.generator], ["OpenRouter Jev", adapters.jev]] as const) {
      const capability = adapter.capabilities;
      if (!capability.hardPerCallCostLimit || !capability.exactCostReporting || !capability.noHiddenRetries) {
        throw new Error(`${name} cannot honor the frozen request/cost caps; live execution is blocked.`);
      }
    }
  }
}
