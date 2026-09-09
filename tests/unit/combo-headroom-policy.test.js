import test from "node:test";
import assert from "node:assert/strict";
import {
  getComboHeadroomMinInputTokens,
  isComboModelRequest,
  markComboModelRequest,
} from "../../open-sse/utils/reasoningUsagePolicy.js";

test("combo Headroom threshold is read from the selected member", () => {
  const body = { model: "terra" };
  markComboModelRequest(body, { model: "cx/gpt-5.6-terra(low)", headroomMinInputTokens: "100000.9" }, "terra");

  assert.equal(isComboModelRequest(body), true);
  assert.equal(getComboHeadroomMinInputTokens(body), 100000);
});

test("direct requests and missing/invalid thresholds stay opted out", () => {
  assert.equal(isComboModelRequest({ model: "gpt-5.6-sol" }), false);
  assert.equal(getComboHeadroomMinInputTokens({ model: "gpt-5.6-sol" }), null);

  for (const value of [undefined, null, "", 0, -1, "not-a-number"]) {
    const body = { model: "terra" };
    markComboModelRequest(body, { model: "cx/gpt-5.6-terra(low)", headroomMinInputTokens: value }, "terra");
    assert.equal(getComboHeadroomMinInputTokens(body), null, String(value));
  }
});
