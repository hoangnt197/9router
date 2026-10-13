import { describe, expect, it } from "vitest";

import {
  applyClientTokenUsagePolicy,
  createClientTokenUsagePolicy,
  markClientTokenUsagePolicy,
} from "../../open-sse/utils/reasoningUsagePolicy.js";

function policy({ input = [{ upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1 }], output = [{ upTo: null, multiplierMin: 3, multiplierMax: 3, power: 1 }] } = {}) {
  const body = markClientTokenUsagePolicy({ model: "test" }, { input, output });
  return createClientTokenUsagePolicy(body);
}

describe("API-key client token multiplier", () => {
  it("scales the full OpenAI input total and keeps cache details unchanged", () => {
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
      cached_tokens: 80,
      prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 5 },
    });
  });

  it("scales the full Responses input total and keeps cache details unchanged", () => {
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
      input_tokens_details: { cached_tokens: 80 },
    });
  });

  it("scales Claude's cache-inclusive total while preserving separate cache counts", () => {
    const payload = {
      type: "message",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5,
      },
    };

    applyClientTokenUsagePolicy(payload, policy({ input: [{ upTo: 220, multiplierMin: 2, multiplierMax: 2, power: 1 }] }), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 125,
      output_tokens: 30,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 5,
    });
    expect(payload.usage).not.toHaveProperty("total_tokens");
  });

  it("scales the full Gemini input total, preserves cache, and includes thoughts in total", () => {
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
      cachedContentTokenCount: 80,
      thoughtsTokenCount: 7,
    });
  });

  it("allows x1 and applies power to both input and output ranges", () => {
    const payload = {
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    };
    const rules = {
      input: [{ upTo: null, multiplierMin: 1, multiplierMax: 10, power: 2 }],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 10, power: 2 }],
    };

    applyClientTokenUsagePolicy(payload, policy(rules), () => 0);

    expect(payload.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
    });
  });

  it("defaults an invalid power to 1 during normalization", () => {
    const payload = {
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    applyClientTokenUsagePolicy(payload, policy({
      input: [{ upTo: null, multiplierMin: 1, multiplierMax: 2, power: 0 }],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 2, power: "bad" }],
    }), () => 1);

    expect(payload.usage.prompt_tokens).toBe(20);
    expect(payload.usage.completion_tokens).toBe(10);
  });
});
