import { v4 as uuidv4 } from "uuid";

/**
 * moderationFilter.js
 * -------------------
 * Replaces the local regex-based cyberFilter with a call to an OpenAI-compatible
 * v1/moderations API endpoint.  The check is intentionally fail-open: if the
 * upstream call fails or times out we log a warning and let the request through
 * rather than blocking legitimate traffic.
 *
 * Integration point: src/sse/handlers/chat.js → handleChat()
 */

// ---------------------------------------------------------------------------
// Text extraction (mirrors cyberFilter's getLatestUserText)
// ---------------------------------------------------------------------------

function collectTextValues(val, out = []) {
  if (typeof val === "string") {
    out.push(val);
  } else if (Array.isArray(val)) {
    for (const item of val) collectTextValues(item, out);
  } else if (val && typeof val === "object") {
    for (const key of ["content", "input", "text", "arguments"]) {
      if (val[key]) collectTextValues(val[key], out);
    }
  }
  return out;
}

/**
 * Extract the latest user-role text from a chat/messages/responses body.
 * @param {Object} body - Parsed request body (OpenAI, Claude or Responses API).
 * @returns {string}
 */
export function extractLatestUserText(body) {
  if (!body || typeof body !== "object") return "";
  const parts = [];

  // OpenAI / Claude messages array
  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg && msg.role === "user") {
        for (const key of ["content", "input", "text"]) {
          if (msg[key]) parts.push(...collectTextValues(msg[key]));
        }
        break;
      }
    }
  }

  // Responses API: body.input (array of items or plain string)
  if (typeof body.input === "string") {
    parts.push(body.input);
  } else if (Array.isArray(body.input)) {
    for (let i = body.input.length - 1; i >= 0; i--) {
      const item = body.input[i];
      if (item && item.role === "user") {
        parts.push(...collectTextValues(item));
        break;
      } else if (typeof item === "string") {
        parts.push(item);
        break;
      }
    }
  }

  // Plain prompt (some legacy callers)
  if (typeof body.prompt === "string") {
    parts.push(body.prompt);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Model scope detection (cached, synchronous check on client-sent model)
// ---------------------------------------------------------------------------

const gptModelCache = new Map();

/**
 * Check if a model name belongs to the GPT/OpenAI model family.
 * Result is cached in-memory for instant lookups.
 * @param {string} modelStr
 * @returns {boolean}
 */
export function isGptModel(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return false;
  if (gptModelCache.has(modelStr)) return gptModelCache.get(modelStr);

  const clean = modelStr.toLowerCase().split("/").pop().replace(/^[a-z0-9_-]+__/, "");
  const matched = /^gpt|^chatgpt|^o[134](?:-|\b)|[-_]gpt/i.test(clean);

  if (gptModelCache.size > 500) gptModelCache.clear();
  gptModelCache.set(modelStr, matched);
  return matched;
}

/**
 * Determine if client-sent model should be moderated.
 * @param {string} modelStr - The model name sent by the client.
 * @param {Object} settings - App settings.
 * @returns {boolean}
 */
export function shouldModerateModel(modelStr, settings) {
  if (settings?.moderationTargetScope === "all") return true;
  return isGptModel(modelStr);
}

// ---------------------------------------------------------------------------
// Upstream moderation call
// ---------------------------------------------------------------------------

/**
 * Call the configured v1/moderations endpoint.
 *
 * @param {string} text - Text to moderate (latest user message).
 * @param {Object} settings - Merged app settings.
 * @param {Object} [log]   - Logger (must have .warn(), .debug()). Optional.
 *
 * @returns {Promise<{blocked: boolean, categories?: string[], error?: string}>}
 *   - blocked: true  → request should be refused.
 *   - blocked: false → request is safe (or check failed with fail-open).
 *   - categories: list of flagged categories (present only when blocked=true).
 *   - error: reason string when the check itself failed.
 */
export async function checkModeration(text, settings, log = null) {
  if (!text || !text.trim()) return { blocked: false };

  const baseUrl  = (settings.moderationBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey   = settings.moderationApiKey || "";
  const model    = settings.moderationModel || "omni-moderation-latest";
  const timeoutMs = Number(settings.moderationTimeoutMs) || 3000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/moderations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ input: text, model }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const msg = `Moderation API returned HTTP ${res.status}`;
      if (log) log.warn("MODERATION", `${msg} — fail-open`);
      return { blocked: false, error: msg };
    }

    const data = await res.json();
    const result = Array.isArray(data?.results) ? data.results[0] : null;

    if (!result) {
      if (log) log.warn("MODERATION", "Unexpected response shape — fail-open");
      return { blocked: false, error: "Unexpected moderation response shape" };
    }

    if (result.flagged === true) {
      const flaggedCategories = Object.entries(result.categories || {})
        .filter(([, v]) => v === true)
        .map(([k]) => k);
      return { blocked: true, categories: flaggedCategories };
    }

    return { blocked: false };
  } catch (err) {
    const isTimeout = err?.name === "AbortError";
    const msg = isTimeout ? `Moderation timeout after ${timeoutMs}ms` : (err?.message || String(err));
    if (log) log.warn("MODERATION", `${msg} — fail-open`);
    return { blocked: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Blocked response builder (same multi-format support as cyberFilter)
// ---------------------------------------------------------------------------

const buildPayload = (body, endpoint, ident, now, refusalMessage) => {
  const model = body?.model || "gpt-4o";
  const isClaude = endpoint.includes("/messages");
  const isResponses = endpoint.includes("/responses");

  if (isClaude) {
    return {
      type: "claude",
      payload: {
        id: "msg_" + ident,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: refusalMessage }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 24, output_tokens: 28 },
        shortlab_moderation: { blocked: true, upstream_called: true },
      },
    };
  }

  if (isResponses) {
    return {
      type: "responses",
      payload: {
        id: "resp_" + ident,
        object: "response",
        created_at: now,
        status: "completed",
        model,
        output: [
          {
            type: "message",
            id: "msg_" + ident,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", annotations: [], text: refusalMessage }],
          },
        ],
        usage: {
          input_tokens: 24,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 28,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 52,
        },
        metadata: { shortlab_moderation: { blocked: true, upstream_called: true } },
      },
    };
  }

  // Default: OpenAI chat.completion
  return {
    type: "openai",
    payload: {
      id: "chatcmpl-" + ident,
      object: "chat.completion",
      created: now,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: refusalMessage },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 24, completion_tokens: 28, total_tokens: 52 },
      shortlab_moderation: { blocked: true, upstream_called: true },
    },
  };
};

const BLOCKED_HEADERS_JSON = {
  "Content-Type": "application/json",
  "X-Content-Moderation": "blocked",
};

const BLOCKED_HEADERS_SSE = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  "X-Content-Moderation": "blocked",
};

/**
 * Build an OpenAI/Claude/Responses-compatible 200 OK refusal response.
 *
 * @param {Object} body           - Parsed request body.
 * @param {string[]} categories   - Flagged moderation categories.
 * @param {string} endpoint       - Request pathname (used to detect format).
 * @param {string} [sourceIp]     - Caller IP for audit logging.
 * @param {string} [customMessage]- Override the default refusal message.
 * @returns {Response}
 */
export function createModerationBlockedResponse(
  body,
  categories = [],
  endpoint = "/v1/chat/completions",
  sourceIp = "",
  customMessage = ""
) {
  const ident = uuidv4().replace(/-/g, "").slice(0, 24);
  const now = Math.floor(Date.now() / 1000);
  const refusalMessage = customMessage ||
    "Tôi rất tiếc nhưng không thể hỗ trợ thực hiện yêu cầu này vì lý do an toàn và bảo mật thông tin. Nếu bạn quan tâm, tôi có thể hỗ trợ cung cấp các kiến thức về an toàn thông tin hoặc các giải pháp bảo mật phòng thủ hợp pháp.";

  // Audit log (mask any secret-like tokens from the preview)
  let preview = extractLatestUserText(body).replace(/\s+/g, " ").trim();
  preview = preview.replace(/\b(?:sk|key|token|api[_ -]?key|bearer)[-_a-z0-9.]{8,}\b/gi, "[REDACTED]");
  preview = preview.replace(/\b(?:authorization\s*[:=]?\s*bearer\s+)[^\s,;]+/gi, "authorization: [REDACTED]");
  if (preview.length > 240) preview = preview.slice(0, 240) + "…";

  const logEvent = {
    event: "moderation_blocked",
    time: new Date().toISOString(),
    request_id: uuidv4().replace(/-/g, ""),
    categories,
    endpoint,
    model: body?.model || "unknown",
    source_ip: sourceIp,
    preview,
  };
  console.warn(`[moderation-blocked] ${JSON.stringify(logEvent)}`);

  const { type, payload } = buildPayload(body, endpoint, ident, now, refusalMessage);

  // Stream responses need SSE framing so clients don't time out waiting for stream events
  if (body?.stream === true) {
    let streamBody;

    if (type === "claude") {
      const messageStart = { ...payload, content: [] };
      streamBody = [
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: messageStart })}\n\n`,
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: refusalMessage } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: payload.usage })}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
      ].join("");
    } else if (type === "responses") {
      streamBody = `event: response.completed\ndata: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
    } else {
      const chunk = {
        id: payload.id,
        object: "chat.completion.chunk",
        created: payload.created,
        model: payload.model,
        choices: [{ index: 0, delta: { role: "assistant", content: refusalMessage }, finish_reason: null }],
      };
      const terminal = {
        id: payload.id,
        object: "chat.completion.chunk",
        created: payload.created,
        model: payload.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: payload.usage,
      };
      streamBody = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(terminal)}\n\ndata: [DONE]\n\n`;
    }

    return new Response(streamBody, { status: 200, headers: BLOCKED_HEADERS_SSE });
  }

  return new Response(JSON.stringify(payload), { status: 200, headers: BLOCKED_HEADERS_JSON });
}

