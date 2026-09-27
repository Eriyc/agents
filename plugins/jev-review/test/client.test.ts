import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import { JevApiError, JevClient } from "../src/jev/client.js";
import { getJevProviderConfig } from "../src/config/environment.js";
import { OPENROUTER_API_ENDPOINT, OPENROUTER_MODEL } from "../src/jev/provider.js";

const validResponse = {
  model: OPENROUTER_MODEL,
  answers: {},
  usage: { input_tokens: 10, output_tokens: 2 }
};

describe("Jev client", () => {
  it("reads only the OpenRouter key and optional model from the process environment", () => {
    assert.deepEqual(getJevProviderConfig({ OPENROUTER_API_KEY: " router " }), { apiKey: "router" });
    assert.deepEqual(getJevProviderConfig({ OPENROUTER_API_KEY: "router", JEV_MODEL: "typesafe/jev-1.13" }), {
      apiKey: "router", model: "typesafe/jev-1.13"
    });
    assert.throws(() => getJevProviderConfig({ JEV_API_KEY: "direct" }), /OPENROUTER_API_KEY/);
  });

  it("selects OpenRouter's Decisions API, key, and default Jev alias", async () => {
    const config = getJevProviderConfig({ OPENROUTER_API_KEY: " router ", JEV_API_KEY: "direct" });
    let url = "";
    let authorization = "";
    let model = "";
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return Response.json({ ...validResponse, model: "typesafe/jev-1.13", id: "request-id", provider: "TypeSafe", usage: { ...validResponse.usage, cost: 0.01 } });
    };
    const response = await new JevClient({ ...config, fetchImplementation: fakeFetch }).evaluate("state", {});
    assert.equal(url, OPENROUTER_API_ENDPOINT);
    assert.equal(authorization, "Bearer router");
    assert.equal(model, OPENROUTER_MODEL);
    assert.equal(response.provider, "TypeSafe");
  });

  it("allows a pinned OpenRouter Jev model", async () => {
    let model = "";
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return Response.json(validResponse);
    };
    const config = getJevProviderConfig({ OPENROUTER_API_KEY: "router", JEV_MODEL: "typesafe/jev-1.13" });
    await new JevClient({ ...config, fetchImplementation: fakeFetch }).evaluate("state", {});
    assert.equal(model, "typesafe/jev-1.13");
  });

  it("reports provider-specific missing and rejected keys without echoing them", async () => {
    assert.throws(() => getJevProviderConfig({}), /OPENROUTER_API_KEY/);
    const client = new JevClient({ apiKey: "test-secret", fetchImplementation: async () => Response.json({ error: { code: "invalid_api_key", message: "bad key" } }, { status: 401 }) });
    await assert.rejects(client.evaluate("state", {}), (error: unknown) => error instanceof JevApiError && error.status === 401 && error.message.includes("OPENROUTER_API_KEY") && !error.message.includes("test-secret"));
  });

  it("explains OpenRouter limits and malformed successful responses", async () => {
    const limit = new JevClient({ apiKey: "test-secret", fetchImplementation: async () => Response.json({ error: { code: "context_length_exceeded" } }, { status: 422 }) });
    await assert.rejects(limit.evaluate("state", {}), /input limit/);
    const malformed = new JevClient({ apiKey: "test-secret", fetchImplementation: async () => Response.json({ answers: {} }) });
    await assert.rejects(malformed.evaluate("state", {}), /OpenRouter returned a response/);
    const invalidJson = new JevClient({ apiKey: "test-secret", fetchImplementation: async () => new Response("not-json", { status: 200 }) });
    await assert.rejects(invalidJson.evaluate("state", {}), /OpenRouter returned malformed JSON/);
  });

  it("aborts a stalled OpenRouter fetch", async () => {
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    const client = new JevClient({ apiKey: "test-secret", fetchImplementation: fakeFetch, timeoutMilliseconds: 5 });
    await assert.rejects(client.evaluate("state", {}), /OpenRouter did not respond within 5ms/);
  });
  it("sends the key only in the OpenRouter authorization header", async () => {
    let observedUrl = "";
    let observedAuthorization = "";
    let observedBody: Record<string, unknown> = {};
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      observedUrl = String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new JevClient({ apiKey: "test-secret", fetchImplementation: fakeFetch });
    await client.evaluate({ diff: "+ change" }, {});

    assert.equal(observedUrl, OPENROUTER_API_ENDPOINT);
    assert.equal(observedAuthorization, "Bearer test-secret");
    assert.equal(observedBody.model, OPENROUTER_MODEL);
    assert.deepEqual(observedBody.state, { diff: "+ change" });
  });

  it("retries documented transient failures with bounded backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fakeFetch = async (): Promise<Response> => {
      attempts += 1;
      if (attempts === 1) return new Response("overloaded", { status: 529 });
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };

    const client = new JevClient({
      apiKey: "test-secret",
      fetchImplementation: fakeFetch,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });
    await client.evaluate("state", {});

    assert.equal(attempts, 2);
    assert.deepEqual(delays, [250]);
  });

  it("never starts without an API key", () => {
    assert.throws(() => new JevClient({ apiKey: " " }), JevApiError);
  });

  it("explains Jev's upstream token-limit response", async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ detail: { error_type: "max_tokens_exceeded" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    const client = new JevClient({ apiKey: "test-secret", fetchImplementation: fakeFetch });

    await assert.rejects(
      client.evaluate({ diff: "+ oversized change" }, {}),
      (error: unknown) =>
        error instanceof JevApiError &&
        error.status === 400 &&
        error.message.includes("split the change across multiple review calls")
    );
  });
});
