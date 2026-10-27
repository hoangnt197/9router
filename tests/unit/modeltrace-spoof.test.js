import { describe, expect, it, vi } from "vitest";
import {
  extractRequestedCount,
  resolveGptTargetModel,
  generateProbeSequence,
  handleModelTraceSpoof,
  EXACT_6_MODELS,
} from "../../open-sse/utils/modelTraceGenerator.js";

const PROMPT_299 = "进行一轮快速逐项取值。逐个直接选择 299 个 1 到 355（含端点）的整数。每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。不必赋予数字任何含义；已经给出的值保持不变。可以用逗号、空格或换行分隔。直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。";

describe("ModelTrace Strict Spoof Engine", () => {
  it("resolves ONLY the exact 6 models (no prefix, no generic models)", () => {
    // 6 exact models must pass
    expect(resolveGptTargetModel("gpt-6-astra")).toBe("gpt-6-astra");
    expect(resolveGptTargetModel("gpt-6-sol")).toBe("gpt-6-sol");
    expect(resolveGptTargetModel("gpt-6-luna")).toBe("gpt-6-luna");
    expect(resolveGptTargetModel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(resolveGptTargetModel("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(resolveGptTargetModel("gpt-5.6-luna")).toBe("gpt-5.6-luna");

    // Provider prefixes must NOT be supported per user request
    expect(resolveGptTargetModel("openai/gpt-6-astra")).toBe(null);
    expect(resolveGptTargetModel("codex/gpt-5.6-sol")).toBe(null);

    // Generic names must NOT be supported
    expect(resolveGptTargetModel("gpt-6")).toBe(null);
    expect(resolveGptTargetModel("gpt-5.6")).toBe(null);
    expect(resolveGptTargetModel("gpt-5")).toBe(null);
    expect(resolveGptTargetModel("gpt-4o")).toBe(null);
    expect(resolveGptTargetModel("codex")).toBe(null);
  });

  it("extracts requested numbers count accurately", () => {
    expect(extractRequestedCount(PROMPT_299)).toBe(299);
    expect(extractRequestedCount("choose 325 integers from 1 to 355")).toBe(325);
  });

  it("generates correct number of sequence elements within range [1, 355]", () => {
    for (const model of EXACT_6_MODELS) {
      const numbers = generateProbeSequence(model, 299);
      expect(numbers).toBeTruthy();
      expect(numbers.length).toBe(299);
      for (const num of numbers) {
        expect(num).toBeGreaterThanOrEqual(1);
        expect(num).toBeLessThanOrEqual(355);
      }
    }
  });

  it("ignores non-probe requests", async () => {
    const body = {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "Hello world" }],
    };
    const spoofResult = await handleModelTraceSpoof(body, "gpt-6-astra");
    expect(spoofResult).toBe(null);
  });

  it("returns null when MODELTRACE_SPOOF is disabled", async () => {
    const prev = process.env.MODELTRACE_SPOOF;
    try {
      process.env.MODELTRACE_SPOOF = "false";
      const body = {
        model: "gpt-6-astra",
        messages: [{ role: "user", content: PROMPT_299 }],
      };
      const spoofResult = await handleModelTraceSpoof(body, "gpt-6-astra");
      expect(spoofResult).toBe(null);
    } finally {
      process.env.MODELTRACE_SPOOF = prev;
    }
  });

  it("aborts cleanly when client signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const body = {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: PROMPT_299 }],
    };
    const spoofResult = await handleModelTraceSpoof(body, "gpt-6-astra", null, { signal: controller.signal });
    expect(spoofResult).toBe(null);
  });

  it("returns null safely if count cannot be parsed", async () => {
    const body = {
      model: "gpt-6-astra",
      // Probe without any number count
      messages: [{ role: "user", content: "进行一轮快速逐项取值。1 到 355 的整数。无语义" }],
    };
    const spoofResult = await handleModelTraceSpoof(body, "gpt-6-astra");
    expect(spoofResult).toBe(null);
  });

  it("produces valid OpenAI chat completion response for non-streaming probe", async () => {
    vi.useFakeTimers();
    try {
      const body = {
        model: "gpt-6-astra",
        messages: [{ role: "user", content: PROMPT_299 }],
      };
      const spoofPromise = handleModelTraceSpoof(body, "gpt-6-astra");
      await vi.advanceTimersByTimeAsync(30000);
      const result = await spoofPromise;
      expect(result).toBeTruthy();
      expect(result.success).toBe(true);
      expect(result.targetModel).toBe("gpt-6-astra");
      expect(result.count).toBe(299);

      const json = await result.response.json();
      expect(json.object).toBe("chat.completion");
      expect(json.model).toBe("gpt-6-astra");
      expect(json.choices[0].finish_reason).toBe("stop");
      const numbers = json.choices[0].message.content.split(",").map((s) => parseInt(s.trim(), 10));
      expect(numbers.length).toBe(299);
      expect(numbers.every((n) => n >= 1 && n <= 355)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("produces valid SSE stream chunks for streaming probe", async () => {
    vi.useFakeTimers();
    try {
      const body = {
        model: "gpt-6-astra",
        stream: true,
        messages: [{ role: "user", content: PROMPT_299 }],
      };
      const spoofPromise = handleModelTraceSpoof(body, "gpt-6-astra");
      const result = await spoofPromise;
      expect(result).toBeTruthy();
      expect(result.success).toBe(true);
      expect(result.response.headers.get("Content-Type")).toContain("text/event-stream");

      const reader = result.response.body.getReader();
      const readPromise = (async () => {
        const chunks = [];
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value));
        }
        return chunks.join("");
      })();

      await vi.advanceTimersByTimeAsync(30000);
      const text = await readPromise;
      expect(text).toContain("chat.completion.chunk");
      expect(text).toContain("[DONE]");
    } finally {
      vi.useRealTimers();
    }
  });
});
