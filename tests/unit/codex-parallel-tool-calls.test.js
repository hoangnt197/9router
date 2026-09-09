import { describe, it, expect } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("Codex parallel_tool_calls enforcement", () => {
  it("CodexExecutor enforces parallel_tool_calls: false when tools are present", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Get weather",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      parallel_tool_calls: true,
    };

    const transformed = executor.transformRequest("gpt-5.5", body, true, { connectionId: "conn-1" });
    expect(transformed.parallel_tool_calls).toBe(false);
    expect(Array.isArray(transformed.tools)).toBe(true);
    expect(transformed.tools.length).toBe(1);
  });

  it("CodexExecutor enforces parallel_tool_calls: false even when tools are absent", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
    };

    const transformed = executor.transformRequest("gpt-5.5", body, true, { connectionId: "conn-1" });
    expect(transformed.parallel_tool_calls).toBe(false);
  });

  it("openaiToOpenAIResponsesRequest sets parallel_tool_calls: false when tools are present", () => {
    const chatBody = {
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "calculator",
            description: "Do math",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    };

    const responsesReq = openaiToOpenAIResponsesRequest("gpt-5.5", chatBody, true, {});
    expect(responsesReq.parallel_tool_calls).toBe(false);
    expect(Array.isArray(responsesReq.tools)).toBe(true);
    expect(responsesReq.tools.length).toBe(1);
  });
});
