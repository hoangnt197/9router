import { describe, expect, it, vi } from "vitest";

const { saveRequestDetail } = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/usageDb.js", () => ({ saveRequestDetail }));

import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo client-visible error persistence", () => {
  it("records an error when strict input bands leave no compatible model", async () => {
    saveRequestDetail.mockClear();
    const handleSingleModel = vi.fn();
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "x".repeat(100_000) }] },
      models: [
        { model: "provider/small", maxInputTokens: 10 },
        { model: "provider/medium", maxInputTokens: 20 },
      ],
      inputRouting: "band-strict",
      comboName: "limited-combo",
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.status).toBe(400);
    expect(handleSingleModel).not.toHaveBeenCalled();
    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      provider: "combo",
      model: "limited-combo",
      status: "error",
      response: expect.objectContaining({ status: 400 }),
    }));
  });

  it("records an error when a combo has no members", async () => {
    saveRequestDetail.mockClear();
    const result = await handleComboChat({
      body: { model: "empty-combo", messages: [] },
      models: [],
      handleSingleModel: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.status).toBe(400);
    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(saveRequestDetail.mock.calls[0][0].response.status).toBe(400);
  });
});
