import test from "node:test";
import assert from "node:assert/strict";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

test("CodexExecutor enforces parallel_tool_calls: false when tools are present", () => {
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
  assert.equal(transformed.parallel_tool_calls, false);
  assert.equal(Array.isArray(transformed.tools), true);
  assert.equal(transformed.tools.length, 1);
});

test("CodexExecutor enforces parallel_tool_calls: false even when tools are absent", () => {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
  };

  const transformed = executor.transformRequest("gpt-5.5", body, true, { connectionId: "conn-1" });
  assert.equal(transformed.parallel_tool_calls, false);
});

test("openaiToOpenAIResponsesRequest sets parallel_tool_calls: false when tools are present", () => {
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
  assert.equal(responsesReq.parallel_tool_calls, false);
  assert.equal(Array.isArray(responsesReq.tools), true);
  assert.equal(responsesReq.tools.length, 1);
});
