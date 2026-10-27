import { describe, expect, it } from "vitest";
import { isModelTraceProbe, extractModelTraceText } from "../../open-sse/utils/modelTraceProbe.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../../open-sse/config/codexInstructions.js";

const ENGLISH_PROBE = "For each of 218 positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive. Return the complete sequence without explanation.";
const CHINESE_PROBE = "这是一次无语义数值选择。请为 294 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。";

describe("ModelTrace probe detector", () => {
  it("detects English and Chinese generated challenge variants", () => {
    expect(isModelTraceProbe({ messages: [{ role: "user", content: ENGLISH_PROBE }] })).toBe(true);
    expect(isModelTraceProbe({ input: [{ role: "user", content: [{ type: "input_text", text: CHINESE_PROBE }] }] })).toBe(true);
  });

  it("extracts text without scanning tool schemas", () => {
    const body = {
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", description: ENGLISH_PROBE }],
    };
    expect(extractModelTraceText(body)).toBe("hello");
    expect(isModelTraceProbe(body)).toBe(false);
  });

  it("rejects ordinary prompts and incomplete challenge-like text", () => {
    expect(isModelTraceProbe({ prompt: "Implement a loop from 1 to 355." })).toBe(false);
    expect(isModelTraceProbe({ prompt: "Choose an integer from 1 to 355." })).toBe(false);
    expect(isModelTraceProbe({ prompt: "For each of 40 positions, make one separate first-instinct choice of an integer from 1 to 355." })).toBe(false);
    expect(isModelTraceProbe({ prompt: `${"background ".repeat(2001)}For each of 218 positions, make one separate first-instinct choice of an integer from 1 to 355.` })).toBe(false);
  });
});

describe("Codex ModelTrace instruction policy", () => {
  it("skips only the default instructions for a probe", () => {
    const executor = new CodexExecutor();
    const body = { model: "gpt-5.6-sol", input: [{ role: "user", content: ENGLISH_PROBE }] };
    const result = executor.transformRequest(body.model, body, true, { providerSpecificData: {} });
    expect(result.instructions).toBeUndefined();
  });

  it("keeps client instructions, tools, and tool_choice on a probe", () => {
    const executor = new CodexExecutor();
    const tools = [{ type: "function", name: "keep_me", parameters: { type: "object", properties: {} } }];
    const body = {
      model: "gpt-5.6-sol",
      instructions: "Client supplied context",
      input: [{ role: "user", content: ENGLISH_PROBE }],
      tools,
      tool_choice: { type: "function", name: "keep_me" },
    };
    const result = executor.transformRequest(body.model, body, true, { providerSpecificData: {} });
    expect(result.instructions).toBe("Client supplied context");
    expect(result.tools).toEqual(tools);
    expect(result.tool_choice).toEqual({ type: "function", name: "keep_me" });
  });

  it("still injects default instructions for ordinary Codex requests", () => {
    const executor = new CodexExecutor();
    const body = { model: "gpt-5.6-sol", input: [{ role: "user", content: "Explain closures." }] };
    const result = executor.transformRequest(body.model, body, true, { providerSpecificData: {} });
    expect(result.instructions).toBe(CODEX_DEFAULT_INSTRUCTIONS);
  });
});
