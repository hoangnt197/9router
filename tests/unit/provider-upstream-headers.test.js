import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({
  getAntigravityQuotaCache: () => new Map(),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { getProviderCredentials } = await import("@/sse/services/auth.js");

describe("provider-level upstream headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([{
      id: "codex-account-1",
      provider: "codex",
      accessToken: "provider-token",
      providerSpecificData: { chatgptAccountId: "account-id" },
    }]);
    mocks.getSettings.mockResolvedValue({
      providerUpstreamHeaders: {
        codex: {
          "User-Agent": "captured-codex-cli",
          originator: "codex_cli_rs",
        },
      },
    });
  });

  it("attaches the Codex provider headers to every selected connection", async () => {
    await expect(getProviderCredentials("codex", null, "gpt-5.6-sol")).resolves.toMatchObject({
      connectionId: "codex-account-1",
      upstreamHeaders: {
        "User-Agent": "captured-codex-cli",
        originator: "codex_cli_rs",
      },
      providerSpecificData: {
        chatgptAccountId: "account-id",
      },
    });
  });
});
