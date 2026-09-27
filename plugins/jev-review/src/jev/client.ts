import { jevResponseSchema, parseJevState, type JevResponse, type JevState } from "./schema.js";
import type { JevQuestions } from "./questions.js";
import { OPENROUTER_API_ENDPOINT, providerModel, type JevProviderConfig } from "./provider.js";

export { OPENROUTER_API_ENDPOINT, OPENROUTER_MODEL } from "./provider.js";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SleepImplementation = (milliseconds: number) => Promise<void>;

export type JevClientOptions = JevProviderConfig & {
  fetchImplementation?: FetchImplementation;
  sleep?: SleepImplementation;
  timeoutMilliseconds?: number;
  maxRetries?: number;
};

export class JevApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevApiError";
    if (status !== undefined) this.status = status;
  }
}

export class JevClient {
  readonly #apiKey: string;
  readonly #config: JevProviderConfig;
  readonly #fetch: FetchImplementation;
  readonly #sleep: SleepImplementation;
  readonly #timeoutMilliseconds: number;
  readonly #maxRetries: number;

  constructor(options: JevClientOptions) {
    const apiKey = options.apiKey.trim();
    this.#config = { apiKey, ...(options.model ? { model: options.model } : {}) };
    if (!apiKey) throw new JevApiError("OPENROUTER_API_KEY is not set in the MCP process environment.");

    this.#apiKey = apiKey;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
    this.#maxRetries = options.maxRetries ?? 2;
  }

  async evaluate(state: JevState, questions: JevQuestions): Promise<JevResponse> {
    let boundedState: JevState;
    try {
      boundedState = parseJevState(state);
    } catch (error) {
      throw new JevApiError(error instanceof Error ? error.message : "Jev evaluation state is invalid.");
    }

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);

      try {
        const response = await this.#fetch(OPENROUTER_API_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ state: boundedState, model: providerModel(this.#config), questions }),
          signal: controller.signal
        });

        if (response.ok) {
          let rawResponse: unknown;
          try {
            rawResponse = await response.json();
          } catch {
            throw new JevApiError("OpenRouter returned malformed JSON.");
          }
          const parsed = jevResponseSchema.safeParse(rawResponse);
          if (!parsed.success) {
            throw new JevApiError("OpenRouter returned a response that did not match Jev's documented schema.");
          }
          return parsed.data;
        }

        if (isRetryable(response.status) && attempt < this.#maxRetries) {
          await this.#sleep(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }

        throw await apiStatusError(response);
      } catch (error) {
        if (error instanceof JevApiError) throw error;
        if (isAbortError(error)) {
          throw new JevApiError(`OpenRouter did not respond within ${this.#timeoutMilliseconds}ms.`);
        }
        throw new JevApiError("Could not reach OpenRouter. Check network access and try again.");
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new JevApiError("Jev request failed after retries.");
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

async function apiStatusError(response: Response): Promise<JevApiError> {
  const status = response.status;
  const errorType = await readErrorType(response);
  const name = "OpenRouter";

  if ((status === 400 || status === 413 || status === 422) &&
      (errorType === "max_tokens_exceeded" || errorType === "context_length_exceeded" || status === 413)) {
    return new JevApiError(
      "Jev's input limit was exceeded. Send a smaller, focused code context or split the change across multiple review calls.",
      status
    );
  }
  if (status === 401) {
    return new JevApiError(`${name} rejected OPENROUTER_API_KEY. Check that the key is current and available to the MCP process.`, status);
  }
  if (status === 422) {
    return new JevApiError(`${name} rejected the supplied evaluation context or questions.`, status);
  }
  if (status === 429) {
    return new JevApiError(`${name} rate-limited the request after retries. Try again shortly.`, status);
  }
  if (status === 529) {
    return new JevApiError(`${name} remained overloaded after retries. Try again shortly.`, status);
  }
  if (status === 402) return new JevApiError(`${name} requires available API credits.`, status);
  if (status === 403) return new JevApiError(`${name} denied access to the requested Jev model.`, status);
  if (status === 408 || status === 524) return new JevApiError(`${name} request timed out (HTTP ${status}).`, status);
  return new JevApiError(`${name} API request failed with HTTP ${status}.`, status);
}

async function readErrorType(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) return undefined;
    if (isRecord(body.detail) && typeof body.detail.error_type === "string") return body.detail.error_type;
    if (isRecord(body.error) && typeof body.error.code === "string") return body.error.code;
    return undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);

    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) return Math.min(Math.max(retryDate - Date.now(), 0), 5_000);
  }
  return 250 * 2 ** attempt;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
