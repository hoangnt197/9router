import { describe, expect, it } from "vitest";

import {
  applyClientTokenUsagePolicy,
  createClientTokenUsagePolicy,
  markClientTokenUsagePolicy,
} from "../../open-sse/utils/reasoningUsagePolicy.js";

function policy({
  input = [{ upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1 }],
  output = [{ upTo: null, multiplierMin: 3, multiplierMax: 3, power: 1 }],
  cacheCreationRatio,
} = {}) {
  const policyObj = { input, output };
  if (cacheCreationRatio !== undefined) policyObj.cacheCreationRatio = cacheCreationRatio;
  const body = markClientTokenUsagePolicy({ model: "test" }, policyObj);
  return createClientTokenUsagePolicy(body);
}

describe("API-key client token multiplier", () => {
  it("defaults to 0% cache write when cacheCreationRatio is not configured", () => {
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

    // 100 -> 200, delta = 100.
    // Default ratio is 0%, so cache_creation_tokens stays untouched at 5.
    expect(payload.usage).toEqual({
      prompt_tokens: 200,
      completion_tokens: 30,
      total_tokens: 230,
      cached_tokens: 80,
      prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 5 },
    });
  });

  it("scales the full OpenAI input total and allocates 70% of delta when cacheCreationRatio is 0.7", () => {
    const payload = {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 999,
        cached_tokens: 80,
        prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 5 },
      },
    };

    applyClientTokenUsagePolicy(payload, policy({ cacheCreationRatio: 0.7 }), () => 0);

    // 100 -> 200, delta = 100.
    // extraCacheWrite = floor(100 * 0.7) = 70.
    // cache_creation_tokens = 5 + 70 = 75.
    expect(payload.usage).toEqual({
      prompt_tokens: 200,
      completion_tokens: 30,
      total_tokens: 230,
      cached_tokens: 80,
      prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 75 },
    });
  });

  it("scales the full Responses input total and allocates 70% of delta when cacheCreationRatio is 0.7", () => {
    const payload = {
      object: "response",
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        input_tokens_details: { cached_tokens: 80 },
      },
    };

    applyClientTokenUsagePolicy(payload, policy({ cacheCreationRatio: 0.7 }), () => 0);

    // 100 -> 200, delta = 100.
    // extraCacheWrite = floor(100 * 0.7) = 70.
    expect(payload.usage).toEqual({
      input_tokens: 200,
      output_tokens: 30,
      total_tokens: 230,
      input_tokens_details: { cached_tokens: 80, cache_creation_tokens: 70 },
    });
  });

  it("scales Claude's cache-inclusive total and allocates 70% of delta when cacheCreationRatio is 0.7", () => {
    const payload = {
      type: "message",
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5,
      },
    };

    applyClientTokenUsagePolicy(payload, policy({
      input: [{ upTo: 220, multiplierMin: 2, multiplierMax: 2, power: 1 }],
      cacheCreationRatio: 0.7,
    }), () => 0);

    // basis = 20 + 80 + 5 = 105.
    // 2x -> 210, delta = 105.
    // extraCacheWrite = floor(105 * 0.7) = 73.
    // nextCacheWrite = 5 + 73 = 78.
    // input_tokens = 210 - 80 - 78 = 52.
    expect(payload.usage).toEqual({
      input_tokens: 52,
      output_tokens: 30,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 78,
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

  it("allocates 70% of multiplier delta to cache_creation_tokens for OpenAI prompts >= 1024", () => {
    const payload = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 20,
        total_tokens: 1020,
      },
    };

    // input multiplier 2x: nextInputTotal = 2000, delta = 1000.
    // extraCacheWrite = floor(1000 * 0.7) = 700.
    applyClientTokenUsagePolicy(payload, policy({
      input: [{ upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1 }],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 1, power: 1 }],
      cacheCreationRatio: 0.7,
    }), () => 0);

    expect(payload.usage).toEqual({
      prompt_tokens: 2000,
      completion_tokens: 20,
      total_tokens: 2020,
      prompt_tokens_details: { cache_creation_tokens: 700 },
    });
  });

  it("allocates 70% of multiplier delta to cache_creation_input_tokens for Claude prompts >= 1024", () => {
    const payload = {
      type: "message",
      usage: {
        input_tokens: 1000,
        output_tokens: 20,
      },
    };

    // input multiplier 2x: nextInputTotal = 2000, delta = 1000.
    // extraCacheWrite = 700.
    // input_tokens = 2000 - 700 = 1300. (1300 + 700 = 2000)
    applyClientTokenUsagePolicy(payload, policy({
      input: [{ upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1 }],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 1, power: 1 }],
      cacheCreationRatio: 0.7,
    }), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 1300,
      output_tokens: 20,
      cache_creation_input_tokens: 700,
    });
  });

  it("adds 70% of delta to existing cache_creation on Claude prompts >= 1024", () => {
    const payload = {
      type: "message",
      usage: {
        input_tokens: 600,
        output_tokens: 20,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 100,
      },
    };

    // total basis = 600 + 300 + 100 = 1000.
    // 2x -> nextInputTotal = 2000, delta = 1000.
    // extraCacheWrite = 700.
    // nextCacheWrite = 100 + 700 = 800.
    // input_tokens = 2000 - 300 - 800 = 900. (600 + 30% of 1000 = 900)
    applyClientTokenUsagePolicy(payload, policy({
      input: [{ upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1 }],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 1, power: 1 }],
      cacheCreationRatio: 0.7,
    }), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 900,
      output_tokens: 20,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 800,
    });
  });

  it("allocates 70% of multiplier delta to cache_creation_tokens for Responses API >= 1024", () => {
    const payload = {
      object: "response",
      usage: {
        input_tokens: 1000,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 200 },
      },
    };

    // input multiplier 2x -> 2000, delta = 1000.
    // extraCacheWrite = 700.
    applyClientTokenUsagePolicy(payload, policy({
      input: [{ upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1 }],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 1, power: 1 }],
      cacheCreationRatio: 0.7,
    }), () => 0);

    expect(payload.usage).toEqual({
      input_tokens: 2000,
      output_tokens: 20,
      total_tokens: 2020,
      input_tokens_details: { cached_tokens: 200, cache_creation_tokens: 700 },
    });
  });

  it("applies per-tier cacheCreationRatio when configured on individual tiers", () => {
    const tieredPolicy = policy({
      input: [
        { upTo: 500, multiplierMin: 2, multiplierMax: 2, power: 1, cacheCreationRatio: 0.4 },
        { upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1, cacheCreationRatio: 0.9 },
      ],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 1, power: 1 }],
    });

    // Small prompt: 200 tokens matches tier 1 (<= 500) -> 40% cache write
    const payloadSmall = {
      usage: {
        prompt_tokens: 200,
        completion_tokens: 10,
        total_tokens: 210,
        prompt_tokens_details: {},
      },
    };
    applyClientTokenUsagePolicy(payloadSmall, tieredPolicy, () => 0);
    // 200 * 2 = 400. delta = 200. 40% of 200 = 80.
    expect(payloadSmall.usage.prompt_tokens).toBe(400);
    expect(payloadSmall.usage.prompt_tokens_details.cache_creation_tokens).toBe(80);

    // Large prompt: 1000 tokens matches tier 2 (unlimited) -> 90% cache write
    const payloadLarge = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_tokens_details: {},
      },
    };
    applyClientTokenUsagePolicy(payloadLarge, tieredPolicy, () => 0);
    // 1000 * 2 = 2000. delta = 1000. 90% of 1000 = 900.
    expect(payloadLarge.usage.prompt_tokens).toBe(2000);
    expect(payloadLarge.usage.prompt_tokens_details.cache_creation_tokens).toBe(900);
  });

  it("supports percentage input (e.g. 80 -> 0.8) and explicit 0% in tier configuration", () => {
    const percentagePolicy = policy({
      input: [
        { upTo: 500, multiplierMin: 2, multiplierMax: 2, power: 1, cacheCreationRatio: 0 },
        { upTo: null, multiplierMin: 2, multiplierMax: 2, power: 1, cacheCreationRatio: 80 },
      ],
      output: [{ upTo: null, multiplierMin: 1, multiplierMax: 1, power: 1 }],
    });

    // Tier 1: 0% cache write -> delta remains 100% in prompt_tokens, no cache write
    const payloadZero = {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 110,
        prompt_tokens_details: {},
      },
    };
    applyClientTokenUsagePolicy(payloadZero, percentagePolicy, () => 0);
    expect(payloadZero.usage.prompt_tokens).toBe(200);
    expect(payloadZero.usage.prompt_tokens_details.cache_creation_tokens).toBeUndefined();

    // Tier 2: 80% cache write
    const payloadEighty = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_tokens_details: {},
      },
    };
    applyClientTokenUsagePolicy(payloadEighty, percentagePolicy, () => 0);
    // delta = 1000. 80% = 800.
    expect(payloadEighty.usage.prompt_tokens).toBe(2000);
    expect(payloadEighty.usage.prompt_tokens_details.cache_creation_tokens).toBe(800);
  });
});
