import { describe, expect, it, vi } from "vitest";

import {
  handleComboChat,
  selectModelsForInputBand,
} from "../../open-sse/services/combo.js";

const small = { model: "cx/small", maxInputTokens: 250 };
const medium = { model: "cx/medium", maxInputTokens: 50_000 };
const large = { model: "cx/large" };

describe("strict combo input bands", () => {
  it.each([
    [100, [small]],
    [251, [medium]],
    [50_000, [medium]],
    [50_001, [large]],
  ])("selects the configured band for %i estimated tokens", (estimate, expected) => {
    expect(selectModelsForInputBand([small, medium, large], estimate)).toEqual(expected);
  });

  it("keeps multiple models with the same band available for fallback", () => {
    const secondMedium = { model: "cx/medium-2", maxInputTokens: 50_000 };
    expect(selectModelsForInputBand([small, medium, secondMedium, large], 300)).toEqual([medium, secondMedium]);
  });

  it("does not fall through to a larger band when the selected model fails", async () => {
    const calls = [];
    const log = { info: vi.fn(), warn: vi.fn() };
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "x".repeat(1_200) }] },
      models: [small, medium, large],
      inputRouting: "band-strict",
      comboStrategy: "fallback",
      comboName: "test-combo",
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return new Response(JSON.stringify({ error: { message: "upstream failed" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
      log,
    });

    expect(response.status).toBe(500);
    expect(calls).toEqual(["cx/medium"]);
    expect(log.info).toHaveBeenCalledWith("COMBO", expect.stringContaining("Strict input band"));
  });
});
