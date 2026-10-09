import { describe, expect, it } from "vitest";

import {
  applyClientTokenUsagePolicy,
  createClientTokenUsagePolicy,
  markClientTokenUsagePolicy,
} from "../../open-sse/utils/reasoningUsagePolicy.js";

function policy({ input = [{ upTo: null, multiplierMin: 2, multiplierMax: 2, chance: 100 }], output = [{ upTo: null, multiplierMin: 3, multiplierMax: 3, chance: 100 }] } = {}) {
  const body = markClientTokenUsagePolicy({ model: "test" }, { input, output });
  return createClientTokenUsagePolicy(body);
}

describe("combo client token multiplier", () => {
  it("scales only non-cached OpenAI input and keeps cache details unchanged", () => {
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
      prompt_tokens: 115,
      completion_tokens: 30,
      total_tokens: 145,
      cached_tokens: 80,
      prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 5 },
    });
  });

  it("scales only non-cached Responses input and creates a consistent total", () => {
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
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
      input_tokens_details: { cached_tokens: 80 },
    });
  });

  it("keeps Claude cache read/write unchanged and uses them for the input tier cap", () => {
    const payload = {
      type: "message",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5,
      },
    };

    applyClientTokenUsagePolicy(payload, policy({ input: [{ upTo: 220, multiplierMin: 2, multiplierMax: 2, chance: 100 }] }), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 40,
      output_tokens: 30,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 5,
    });
    expect(payload.usage).not.toHaveProperty("total_tokens");
  });

  it("scales only non-cached Gemini input and includes thoughts in total", () => {
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
      promptTokenCount: 120,
      candidatesTokenCount: 30,
      totalTokenCount: 157,
      cachedContentTokenCount: 80,
      thoughtsTokenCount: 7,
    });
  });
});
