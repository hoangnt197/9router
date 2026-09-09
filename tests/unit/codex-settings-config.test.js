import { describe, expect, it } from "vitest";

import {
  applyCodexSettings,
  getCodexSettings,
  sanitizeHeaderRecord,
} from "../../src/app/api/cli-tools/codex-settings/configUtils.js";

describe("Codex settings custom headers", () => {
  it("returns saved custom headers without exposing managed Authorization", () => {
    const settings = getCodexSettings({
      model: "codex/gpt-5.5",
      agents: { default_subagent_model: "codex/gpt-5.4" },
      model_providers: {
        "9router": {
          base_url: "https://router.example/v1",
          http_headers: {
            Authorization: "Bearer secret",
            "User-Agent": "captured-agent",
            originator: "captured-originator",
          },
          env_http_headers: { "X-Custom-Env": "CODEX_CUSTOM_VALUE" },
        },
      },
    });

    expect(settings).toEqual({
      model: "codex/gpt-5.5",
      subagentModel: "codex/gpt-5.4",
      baseUrl: "https://router.example/v1",
      httpHeaders: {
        "User-Agent": "captured-agent",
        originator: "captured-originator",
      },
      envHttpHeaders: { "X-Custom-Env": "CODEX_CUSTOM_VALUE" },
    });
  });

  it("updates editable headers while preserving unrelated provider fields", () => {
    const result = applyCodexSettings({
      model_providers: {
        "9router": {
          request_max_retries: 4,
          env_http_headers: { "X-Keep": "KEEP_VALUE" },
          http_headers: { Authorization: "Bearer old", "X-Old": "old" },
        },
      },
      agents: { max_threads: 3, subagent: { model: "legacy" } },
    }, {
      baseUrl: "https://router.example/",
      apiKey: "new-key",
      model: "codex/gpt-5.5",
      subagentModel: "codex/gpt-5.4",
      httpHeaders: [
        { name: "User-Agent", value: "captured-agent" },
        { name: "originator", value: "captured-originator" },
      ],
    });

    expect(result.model_providers["9router"]).toMatchObject({
      base_url: "https://router.example/v1",
      request_max_retries: 4,
      env_http_headers: { "X-Keep": "KEEP_VALUE" },
      http_headers: {
        Authorization: "Bearer new-key",
        "User-Agent": "captured-agent",
        originator: "captured-originator",
      },
    });
    expect(result.agents).toEqual({ max_threads: 3, default_subagent_model: "codex/gpt-5.4" });
  });

  it("removes submitted empty environment headers", () => {
    const result = applyCodexSettings({
      model_providers: {
        "9router": { env_http_headers: { "X-Old": "OLD_VALUE" } },
      },
    }, {
      baseUrl: "http://localhost:20127/v1",
      apiKey: "key",
      model: "codex/gpt-5.5",
      envHttpHeaders: [],
    });

    expect(result.model_providers["9router"]).not.toHaveProperty("env_http_headers");
  });

  it("rejects unsafe values and invalid environment variable names", () => {
    expect(() => sanitizeHeaderRecord([
      { name: "X-Test", value: "safe\r\n" },
    ])).toThrow(/line break/);

    expect(() => sanitizeHeaderRecord([
      { name: "X-Test", value: "NOT-AN-ENV" },
    ], { environment: true })).toThrow(/environment variable/);
  });
});
