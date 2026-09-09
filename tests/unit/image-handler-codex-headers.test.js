import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleImageGenerationCore: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(async () => ({
    accessToken: "provider-token",
    connectionId: "codex-connection",
  })),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: () => "router-key",
  isValidApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "codex", model: "gpt-5.5-image" })),
  getComboModels: vi.fn(async () => null),
}));
vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({
  handleImageGenerationCore: mocks.handleImageGenerationCore,
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("../../open-sse/services/combo.js", () => ({ handleComboChat: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({}));

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { default: codexImageProvider } = await import("../../open-sse/handlers/imageProviders/codex.js");

describe("image request Codex headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: true,
      response: Response.json({ data: [] }),
    });
  });

  it("attaches incoming Codex and custom headers to refreshed credentials", async () => {
    await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: "Bearer router-key",
        "User-Agent": "captured-codex-user-agent",
        originator: "captured-originator",
        "X-Custom-Capture": "captured-value",
      },
      body: JSON.stringify({ model: "codex/gpt-5.5-image", prompt: "A green square" }),
    }));

    expect(mocks.handleImageGenerationCore).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({
        accessToken: "provider-token",
        rawHeaders: expect.objectContaining({
          authorization: "Bearer router-key",
          "user-agent": "captured-codex-user-agent",
          originator: "captured-originator",
          "x-custom-capture": "captured-value",
        }),
      }),
    }));
  });

  it("applies provider-level upstream headers to Codex image requests", () => {
    const headers = codexImageProvider.buildHeaders({
      accessToken: "provider-token",
      upstreamHeaders: {
        "User-Agent": "captured-image-cli",
        originator: "captured-originator",
        "X-Captured-Image": "captured-value",
      },
      providerSpecificData: {
        chatgptAccountId: "account-id",
      },
    });

    expect(headers).toMatchObject({
      authorization: "Bearer provider-token",
      "chatgpt-account-id": "account-id",
      "user-agent": "captured-image-cli",
      originator: "captured-originator",
      "X-Captured-Image": "captured-value",
    });
  });
});
