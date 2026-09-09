import { describe, expect, it } from "vitest";

import {
  applyClientTokenUsagePolicy,
  createClientTokenUsagePolicy,
  markComboModelRequest,
} from "../../open-sse/utils/reasoningUsagePolicy.js";

function policy(overrides = {}) {
  const body = markComboModelRequest({ model: "combo" }, {
    inputTokenMultiplier: 2,
    inputTokenMultiplierPercent: 100,
    outputTokenMultiplier: 3,
    outputTokenMultiplierPercent: 100,
    ...overrides,
  }, "combo");
  return createClientTokenUsagePolicy(body);
}

describe("combo client token multiplier", () => {
  it("scales OpenAI cache details with input and recalculates total", () => {
    const payload = {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 999,
        cached_tokens: 80,
        prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 5 },
      },
    };

    applyClientTokenUsagePolicy(payload, policy(), () => 0);

    expect(payload.usage).toEqual({
      prompt_tokens: 200,
      completion_tokens: 30,
      total_tokens: 230,
      cached_tokens: 160,
      prompt_tokens_details: { cached_tokens: 160, cache_creation_tokens: 10 },
    });
  });

  it("scales Responses cache details and creates a consistent total", () => {
    const payload = {
      object: "response",
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        input_tokens_details: { cached_tokens: 80 },
      },
    };

    applyClientTokenUsagePolicy(payload, policy(), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 200,
      output_tokens: 30,
      total_tokens: 230,
      input_tokens_details: { cached_tokens: 160 },
    });
  });

  it("uses the cache-inclusive Claude input for the cap and preserves its schema", () => {
    const payload = {
      type: "message",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5,
      },
    };

    applyClientTokenUsagePolicy(payload, policy({ inputTokenMultiplierMax: 220 }), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 40,
      output_tokens: 30,
      cache_read_input_tokens: 160,
      cache_creation_input_tokens: 10,
    });
    expect(payload.usage).not.toHaveProperty("total_tokens");
  });

  it("scales Gemini cached content and includes thoughts in total", () => {
    const payload = {
      response: {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 10,
          totalTokenCount: 999,
          cachedContentTokenCount: 80,
          thoughtsTokenCount: 7,
        },
      },
    };

    applyClientTokenUsagePolicy(payload, policy(), () => 0);

    expect(payload.response.usageMetadata).toEqual({
      promptTokenCount: 200,
      candidatesTokenCount: 30,
      totalTokenCount: 237,
      cachedContentTokenCount: 160,
      thoughtsTokenCount: 7,
    });
  });
});
