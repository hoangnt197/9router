import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import {
  sanitizeCodexUpstreamHeaders,
} from "../../open-sse/utils/codexClientHeaders.js";

describe("Codex CLI identity headers", () => {
  it("matches the locally installed Codex CLI header shape", () => {
    const executor = new CodexExecutor();
    executor._currentSessionId = "session-123";

    const headers = executor.buildHeaders({
      accessToken: "token",
      connectionId: "connection-1",
      providerSpecificData: { chatgptAccountId: "account-123" },
    });

    expect(headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer token",
      "ChatGPT-Account-ID": "account-123",
      "User-Agent": "codex_exec/0.153.4 (codex_exec; 0.153.4)",
      originator: "codex_exec",
      "session-id": "session-123",
      "thread-id": "session-123",
      "x-client-request-id": "session-123",
      "x-codex-beta-features": "remote_compaction_v2",
      "x-codex-window-id": "session-123:0",
    });
    expect(headers).not.toHaveProperty("session_id");
  });

  it("forwards Codex metadata and custom headers without leaking client auth", () => {
    const executor = new CodexExecutor();
    executor._currentSessionId = "fallback-session";

    const headers = executor.buildHeaders({
      accessToken: "upstream-token",
      providerSpecificData: { chatgptAccountId: "upstream-account" },
      rawHeaders: {
        authorization: "Bearer 9router-client-key",
        "chatgpt-account-id": "client-account",
        host: "router.example.com",
        "x-forwarded-for": "203.0.113.10",
        originator: "Codex Desktop",
        "user-agent": "Codex Desktop/0.153.4 custom-terminal",
        "session-id": "cli-session",
        "thread-id": "cli-thread",
        "x-client-request-id": "cli-request",
        "x-codex-window-id": "cli-window:2",
        "x-codex-turn-metadata": "{\"turn_id\":\"turn-1\"}",
        "x-custom-static": "static-value",
        "x-custom-env": "env-value",
      },
    });

    expect(headers).toMatchObject({
      Authorization: "Bearer upstream-token",
      "ChatGPT-Account-ID": "upstream-account",
      "User-Agent": "Codex Desktop/0.153.4 custom-terminal",
      "session-id": "cli-session",
      "thread-id": "cli-thread",
      "x-client-request-id": "cli-request",
      "x-codex-window-id": "cli-window:2",
      "x-codex-turn-metadata": "{\"turn_id\":\"turn-1\"}",
      "x-custom-static": "static-value",
      "x-custom-env": "env-value",
    });
    expect(headers).not.toHaveProperty("host");
    expect(headers).not.toHaveProperty("x-forwarded-for");
  });

  it("applies provider-level upstream headers for combo traffic from any client", () => {
    const executor = new CodexExecutor();
    executor._currentSessionId = "managed-session";

    const headers = executor.buildHeaders({
      accessToken: "upstream-token",
      upstreamHeaders: {
        "User-Agent": "captured-codex-cli/0.154.0",
        originator: "codex_cli_rs",
        "X-Codex-Captured": "captured-value",
      },
      providerSpecificData: {
        chatgptAccountId: "upstream-account",
      },
      rawHeaders: {
        "user-agent": "generic-node-client",
      },
    });

    expect(headers).toMatchObject({
      Authorization: "Bearer upstream-token",
      "ChatGPT-Account-ID": "upstream-account",
      "User-Agent": "captured-codex-cli/0.154.0",
      originator: "codex_cli_rs",
      "X-Codex-Captured": "captured-value",
      "session-id": "managed-session",
    });
  });

  it("generates Codex turn metadata for combo traffic and mirrors it into client_metadata", () => {
    const executor = new CodexExecutor();
    const body = { model: "gpt-5.6-sol", input: "Reply only OK" };
    const credentials = {
      accessToken: "upstream-token",
      connectionId: "connection-1",
      providerSpecificData: { chatgptAccountId: "upstream-account" },
    };

    const transformed = executor.transformRequest("gpt-5.6-sol", body, true, credentials);
    const headers = executor.buildHeaders(credentials);
    const metadata = JSON.parse(headers["x-codex-turn-metadata"]);

    expect(metadata).toMatchObject({
      session_id: executor._currentSessionId,
      thread_id: executor._currentSessionId,
      request_kind: "turn",
      thread_source: "user",
      sandbox: "seccomp",
      sandbox_mode: "read-only",
      window_number: 0,
    });
    expect(metadata.turn_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(metadata.root_turn_id).toBe(metadata.turn_id);
    expect(metadata.window_id).toBe(`${executor._currentSessionId}:0`);
    expect(metadata.turn_started_at_unix_ms).toEqual(expect.any(Number));
    expect(transformed.client_metadata).toMatchObject({
      "x-codex-installation-id": metadata.installation_id,
      session_id: metadata.session_id,
      thread_id: metadata.thread_id,
      turn_id: metadata.turn_id,
      root_turn_id: metadata.root_turn_id,
      "x-codex-turn-metadata": headers["x-codex-turn-metadata"],
    });
  });

  it("keeps native Codex turn metadata instead of replacing it", () => {
    const executor = new CodexExecutor();
    const nativeMetadata = JSON.stringify({
      installation_id: "native-installation",
      session_id: "native-session",
      thread_id: "native-thread",
      turn_id: "native-turn",
      window_id: "native-window:0",
      root_turn_id: "native-turn",
    });
    const credentials = {
      accessToken: "upstream-token",
      rawHeaders: { "x-codex-turn-metadata": nativeMetadata },
    };

    const body = executor.transformRequest("gpt-5.6-sol", { input: "OK" }, true, credentials);
    const headers = executor.buildHeaders(credentials);

    expect(headers["x-codex-turn-metadata"]).toBe(nativeMetadata);
    expect(body.client_metadata["x-codex-turn-metadata"]).toBe(nativeMetadata);
  });

  it("rejects upstream headers managed by 9Router", () => {
    expect(() => sanitizeCodexUpstreamHeaders({
      Authorization: "Bearer wrong-token",
    })).toThrow(/managed by 9Router/);

    expect(() => sanitizeCodexUpstreamHeaders({
      "Session-ID": "stale-session",
    })).toThrow(/managed by 9Router/);

    expect(() => sanitizeCodexUpstreamHeaders({
      "X-Codex-Turn-Metadata": "{}",
    })).toThrow(/managed by 9Router/);

    expect(() => sanitizeCodexUpstreamHeaders({
      "X-Captured": "safe\r\nInjected: bad",
    })).toThrow(/line break/);
  });
});
