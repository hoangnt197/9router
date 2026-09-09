import { describe, it, expect } from "vitest";
import {
  getComboHeadroomMinInputTokens,
  isComboModelRequest,
  markComboModelRequest,
} from "../../open-sse/utils/reasoningUsagePolicy.js";

describe("combo Headroom threshold policy", () => {
  it("combo Headroom threshold is read from the selected member", () => {
    const body = { model: "terra" };
    markComboModelRequest(body, { model: "cx/gpt-5.6-terra(low)", headroomMinInputTokens: "100000.9" }, "terra");

    expect(isComboModelRequest(body)).toBe(true);
    expect(getComboHeadroomMinInputTokens(body)).toBe(100000);
  });

  it("direct requests and missing/invalid thresholds stay opted out", () => {
    expect(isComboModelRequest({ model: "gpt-5.6-sol" })).toBe(false);
    expect(getComboHeadroomMinInputTokens({ model: "gpt-5.6-sol" })).toBe(null);

    for (const value of [undefined, null, "", 0, -1, "not-a-number"]) {
      const body = { model: "terra" };
      markComboModelRequest(body, { model: "cx/gpt-5.6-terra(low)", headroomMinInputTokens: value }, "terra");
      expect(getComboHeadroomMinInputTokens(body)).toBe(null);
    }
  });
});
