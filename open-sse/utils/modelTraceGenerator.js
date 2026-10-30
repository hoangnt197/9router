import { createRequire } from "node:module";
import { isModelTraceProbe, extractModelTraceText } from "./modelTraceProbe.js";
import { detectFormatByEndpoint, FORMATS } from "../translator/formats.js";
import { detectFormat } from "../services/provider.js";
import { translateResponse, initState } from "../translator/index.js";
import { formatSSE } from "./stream.js";
import { mergeChunksToResponse } from "./bypassHandler.js";

const require = createRequire(import.meta.url);
const GPT_BANK = require("../config/modeltrace/gptReferenceBank.json");

/**
 * Đúng 6 model GPT từ 5.6 trở lên có trong dataset của ModelTrace (khớp tuyệt đối)
 */
export const EXACT_6_MODELS = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

/**
 * Sleep có thể hủy ngay lập tức khi client ngắt kết nối (chống cạn kiệt connection pool)
 */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Request aborted by client");
      err.name = "AbortError";
      return reject(err);
    }
    let settled = false;
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const onResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const err = new Error("Request aborted by client");
      err.name = "AbortError";
      reject(err);
    };
    const timer = setTimeout(onResolve, ms);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Trích xuất số lượng số yêu cầu từ prompt của ModelTrace (ví dụ: 299, 325, 322...).
 * Nếu không bóc tách được số lượng N hợp lệ [80, 400], trả về null để router pass-through.
 */
export function extractRequestedCount(text) {
  if (!text) return null;
  const match = text.match(
    /(?:for\s+each\s+of\s+|exactly\s+|provide\s+exactly\s+|fill\s+exactly\s+|共给出\s*|给出\s*|为\s*|选择\s*)?([89]\d|[1-3]\d{2}|400)(?:\s*(?:个|positions?|items?|choices?|integers?|whole[-\s]numbers?))/i
  );
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    if (!isNaN(val) && val >= 80 && val <= 400) return val;
  }
  return null;
}

/**
 * Chỉ nhận diện đúng 6 tên chính xác tuyệt đối.
 * Không hỗ trợ tiền tố (như openai/) và không hỗ trợ tên chung chung (như gpt-6, gpt-5.6, codex).
 */
export function resolveGptTargetModel(modelStr = "") {
  if (!modelStr || typeof modelStr !== "string") return null;
  const clean = modelStr.trim();
  return EXACT_6_MODELS.has(clean) ? clean : null;
}

/**
 * Sinh chuỗi số ngụy trang dựa trên reference samples thật của model từ dataset
 */
export function generateProbeSequence(targetModel, count) {
  if (!Number.isInteger(count) || count < 80 || count > 400) return null;
  const pool = GPT_BANK[targetModel];
  if (!pool || !pool.length) return null;

  const seedIndex = Math.floor(Math.random() * pool.length);
  const baseSample = pool[seedIndex];

  if (baseSample.length >= count) {
    return baseSample.slice(0, count);
  }

  const result = [...baseSample];
  let nextIndex = (seedIndex + 1) % pool.length;
  while (result.length < count) {
    const nextSample = pool[nextIndex];
    const needed = count - result.length;
    result.push(...nextSample.slice(0, needed));
    nextIndex = (nextIndex + 1) % pool.length;
  }

  return result;
}

/**
 * Tạo danh sách các chunk OpenAI từ mảng số
 */
function buildOpenAIChunks(numbersArray, chatcmplId, created, targetModel, count) {
  const chunks = [];
  const chunkSize = 4; // Cụm 4 số mỗi chunk

  chunks.push({
    id: chatcmplId,
    object: "chat.completion.chunk",
    created,
    model: targetModel,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  });

  for (let i = 0; i < numbersArray.length; i += chunkSize) {
    const slice = numbersArray.slice(i, i + chunkSize);
    const piece = (i === 0 ? "" : ", ") + slice.join(", ");
    chunks.push({
      id: chatcmplId,
      object: "chat.completion.chunk",
      created,
      model: targetModel,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    });
  }

  chunks.push({
    id: chatcmplId,
    object: "chat.completion.chunk",
    created,
    model: targetModel,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: count, total_tokens: 100 + count },
  });

  return chunks;
}

/**
 * Xử lý chặn và trả lời giả lập probe của ModelTrace cho các model GPT (5.6 trở lên)
 * - Tương thích mọi Wire Format (OpenAI Chat Completions, Claude Messages, Responses API)
 * - Có độ trễ mô phỏng 15 - 25 giây
 * - Hỗ trợ AbortSignal khi client ngắt kết nối
 */
export async function handleModelTraceSpoof(body = {}, modelStr = "", clientRawRequest = null, request = null, options = {}) {
  // Feature flag kiểm soát bật/tắt (mặc định bật)
  if (process.env.MODELTRACE_SPOOF === "false") {
    return null;
  }

  // 1. Kiểm tra có phải probe của ModelTrace không
  if (!isModelTraceProbe(body)) {
    return null;
  }

  // 2. Kiểm tra tên model có đúng 6 tên chính xác tuyệt đối không
  const targetModel = resolveGptTargetModel(modelStr || body.model);
  if (!targetModel) {
    return null;
  }

  // 3. Trích xuất số lượng số cần sinh (nếu không bóc tách được -> pass-through an toàn)
  const text = extractModelTraceText(body);
  const count = extractRequestedCount(text);
  if (!count) {
    return null;
  }

  // 4. Sinh dãy số chuẩn xác
  const numbersArray = generateProbeSequence(targetModel, count);
  if (!numbersArray) {
    return null;
  }

  const sequenceText = numbersArray.join(", ");
  const isStream = body.stream === true;
  const signal = request?.signal;
  let endpoint = clientRawRequest?.endpoint || "/v1/chat/completions";
  if (!clientRawRequest?.endpoint && request?.url) {
    try {
      endpoint = new URL(request.url, "http://localhost").pathname;
    } catch {
      endpoint = "/v1/chat/completions";
    }
  }
  const sourceFormat = detectFormatByEndpoint(endpoint, body) || detectFormat(body) || FORMATS.OPENAI;

  const created = Math.floor(Date.now() / 1000);
  const idSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const chatcmplId = `chatcmpl-${idSuffix}`;

  // Cấu hình độ trễ lớn chân thực (15 - 25 giây)
  const initialDelayMs = 8000 + Math.random() * 4000;   // 8 - 12s suy nghĩ
  const streamDurationMs = 8000 + Math.random() * 4000; // 8 - 12s sinh số
  const totalNonStreamDelayMs = initialDelayMs + streamDurationMs; // 16 - 24s

  // --- TRƯỜNG HỢP 1: NON-STREAMING (JSON) ---
  if (!isStream) {
    try {
      await abortableSleep(totalNonStreamDelayMs, signal);
    } catch (e) {
      if (e.name === "AbortError") {
        return {
          aborted: true,
          response: new Response(null, { status: 499, statusText: "Client Closed Request" }),
        };
      }
      throw e;
    }

    const baseOpenAIResponse = {
      id: chatcmplId,
      object: "chat.completion",
      created,
      model: targetModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: sequenceText,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: count,
        total_tokens: 100 + count,
      },
    };

    let finalJsonBody = baseOpenAIResponse;

    // Chuyển đổi định dạng nếu client không dùng OpenAI format (ví dụ /v1/messages hoặc /v1/responses)
    if (sourceFormat !== FORMATS.OPENAI) {
      const state = initState(sourceFormat);
      state.model = targetModel;
      const chunks = buildOpenAIChunks(numbersArray, chatcmplId, created, targetModel, count);
      const allTranslated = [];
      for (const chunk of chunks) {
        const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
        if (translated?.length > 0) allTranslated.push(...translated);
      }
      const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
      if (flushed?.length > 0) allTranslated.push(...flushed);
      finalJsonBody = mergeChunksToResponse(allTranslated, sourceFormat);
    }

    // Ghi nhận usage khi non-stream hoàn tất
    if (typeof options.onRecordUsage === "function") {
      options.onRecordUsage({
        targetModel,
        count,
        durationMs: totalNonStreamDelayMs,
      });
    }

    return {
      success: true,
      targetModel,
      count,
      durationMs: totalNonStreamDelayMs,
      response: new Response(JSON.stringify(finalJsonBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  // --- TRƯỜNG HỢP 2: STREAMING (SSE tương thích mọi wire format) ---
  const state = initState(sourceFormat);
  state.model = targetModel;
  const openaiChunks = buildOpenAIChunks(numbersArray, chatcmplId, created, targetModel, count);

  // Dịch từng chunk sang sourceFormat của client
  const sseEvents = [];
  for (const chunk of openaiChunks) {
    if (sourceFormat === FORMATS.OPENAI) {
      sseEvents.push(`data: ${JSON.stringify(chunk)}\n\n`);
    } else {
      const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
      if (translated?.length > 0) {
        for (const item of translated) {
          sseEvents.push(formatSSE(item, sourceFormat));
        }
      }
    }
  }

  if (sourceFormat !== FORMATS.OPENAI) {
    const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
    if (flushed?.length > 0) {
      for (const item of flushed) {
        sseEvents.push(formatSSE(item, sourceFormat));
      }
    }
  }

  // Chỉ Chat Completions API dùng [DONE]. Responses API dùng event: response.completed
  if (sourceFormat === FORMATS.OPENAI) {
    sseEvents.push("data: [DONE]\n\n");
  }

  // Tạo ReadableStream 2 giai đoạn kèm theo AbortSignal
  const encoder = new TextEncoder();
  const perChunkDelay = Math.max(30, Math.floor(streamDurationMs / sseEvents.length));
  const startTime = Date.now();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        // Giai đoạn 1: Chờ suy nghĩ
        await abortableSleep(initialDelayMs, signal);

        // Giai đoạn 2: Nhả token từ từ
        for (const eventStr of sseEvents) {
          if (signal?.aborted) return;
          controller.enqueue(encoder.encode(eventStr));
          await abortableSleep(perChunkDelay, signal);
        }

        // Chỉ ghi nhận usage khi stream đã hoàn thành trọn vẹn mà không bị abort
        if (!signal?.aborted && typeof options.onRecordUsage === "function") {
          options.onRecordUsage({
            targetModel,
            count,
            durationMs: Date.now() - startTime,
          });
        }
      } catch {
        // Client disconnect / abort: không ghi success usage
      } finally {
        try {
          controller.close();
        } catch {
          // Stream might be closed already
        }
      }
    },
  });

  return {
    success: true,
    targetModel,
    count,
    durationMs: initialDelayMs + streamDurationMs,
    response: new Response(readableStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

export default {
  EXACT_6_MODELS,
  abortableSleep,
  extractRequestedCount,
  resolveGptTargetModel,
  generateProbeSequence,
  handleModelTraceSpoof,
};
