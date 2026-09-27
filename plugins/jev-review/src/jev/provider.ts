export type JevProviderConfig = {
  apiKey: string;
  model?: string;
};

export const OPENROUTER_API_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const OPENROUTER_MODEL = "~typesafe/jev-latest";

export function providerModel(config: JevProviderConfig): string {
  return config.model?.trim() || OPENROUTER_MODEL;
}
