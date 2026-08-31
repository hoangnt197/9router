import { afterEach, describe, expect, it, vi } from "vitest";

import { markComboModelRequest } from "../../open-sse/utils/reasoningUsagePolicy.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runStream() {
  const body = markComboModelRequest({ model: "gpt-5.6-sol", reasoning_effort: "low" });
  const input = `data: ${JSON.stringify({
    model: "cx/gpt-5.6-sol(low)",
    choices: [{ finish_reason: "stop", delta: { content: "ok" } }],
    usage: { prompt_tokens: 1, completion_tokens: 12, total_tokens: 13, completion_tokens_details: { reasoning_tokens: 0 } },
  })}\n\n`;
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const output = source.pipeThrough(createPassthroughStreamWithLogger(
    "openai", null, "gpt-5.6-sol", null, body, null, null, "cx/gpt-5.6-sol(low)",
  ));
  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("stream reasoning usage policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the selected combo item suffix while retaining the public model name", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const output = await runStream();
    const event = output.split("\n").find((line) => line.startsWith("data: "));
    const payload = JSON.parse(event.slice(6));
    expect(payload.model).toBe("gpt-5.6-sol");
    expect(payload.usage.completion_tokens_details.reasoning_tokens).toBeGreaterThan(0);
  });
});
