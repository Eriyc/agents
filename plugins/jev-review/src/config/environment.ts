import { JevApiError } from "../jev/client.js";
import type { JevProviderConfig } from "../jev/provider.js";

export function getJevProviderConfig(environment: NodeJS.ProcessEnv = process.env): JevProviderConfig {
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new JevApiError("OPENROUTER_API_KEY is not set in the MCP process environment.");
  const model = environment.JEV_MODEL?.trim();
  return { apiKey, ...(model ? { model } : {}) };
}
