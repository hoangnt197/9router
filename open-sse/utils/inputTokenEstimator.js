/**
 * Lightweight input-token estimation for routing, limits, and synthesized
 * usage. It deliberately avoids BPE tokenization: large agent contexts made
 * `js-tiktoken` allocate a large token array on the Node event loop.
 */

const MEDIA_TOKEN_ESTIMATES = {
  image: 800,
  audio: 500,
  video: 1000,
  file: 1000,
};

const MEDIA_FIELDS = new Map([
  ["image_url", "image"], ["input_image", "image"], ["inlineData", "image"], ["fileData", "image"],
  ["audio_url", "audio"], ["input_audio", "audio"], ["video_url", "video"], ["input_video", "video"],
  ["input_file", "file"],
]);

// Transport controls are sent alongside the prompt but are not part of the
// model's tokenized context. Counting them made routing estimates depend on
// headers/observability metadata rather than on what the model can read.
const OPENAI_TRANSPORT_FIELDS = new Set([
  "model", "stream", "stream_options", "max_tokens", "max_completion_tokens",
  "temperature", "top_p", "top_k", "n", "stop", "seed", "user", "store",
  "metadata", "client_metadata", "litellm_metadata", "extra_headers",
  "headers", "api_key", "api_base", "timeout", "service_tier",
  "parallel_tool_calls", "tool_choice", "reasoning",
]);

function pickOpenAIContext(body) {
  const context = {};
  if (!body || typeof body !== "object") return context;

  // Keep only fields that can contribute text/schema/function history to the
  // provider context. This works for both Chat Completions and Responses.
  for (const key of [
    "instructions", "system", "messages", "input", "prompt", "contents",
    "systemInstruction", "tools", "functions", "response_format",
  ]) {
    if (body[key] !== undefined) context[key] = body[key];
  }
  if (body.text?.format !== undefined) context.text = { format: body.text.format };

  // Preserve future context-bearing fields without accidentally bringing back
  // proxy/client metadata. Known transport controls above are intentionally
  // excluded; unknown top-level fields are ignored until their token semantics
  // are understood.
  return context;
}

function redactMedia(value, key, state) {
  if (MEDIA_FIELDS.has(key)) {
    const kind = MEDIA_FIELDS.get(key);
    state.mediaTokens += MEDIA_TOKEN_ESTIMATES[kind];
    return `[${kind}]`;
  }
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      state.mediaTokens += MEDIA_TOKEN_ESTIMATES.image;
      return "[media-data]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactMedia(item, "", state));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactMedia(childValue, childKey, state),
    ]));
  }
  return value;
}

/**
 * Estimate token count from tokenizable UTF-8 payload bytes. This is a routing
 * heuristic, not billable usage. Media payloads are replaced by a small fixed
 * estimate so embedded base64 does not distort model selection.
 */
export function estimateInputTokens(body) {
  if (!body || typeof body !== "object") return 0;
  const state = { mediaTokens: 0 };
  try {
    const tokenizableBody = redactMedia(pickOpenAIContext(body), "", state);
    return Math.ceil(Buffer.byteLength(JSON.stringify(tokenizableBody), "utf8") / 4) + state.mediaTokens;
  } catch {
    // Token estimation must never block an otherwise valid request.
    return state.mediaTokens;
  }
}

/**
 * Compatibility alias. Every routing path uses the same lightweight estimate.
 */
export function estimateInputTokensForPricing(body) {
  return estimateInputTokens(body);
}

/**
 * Return true when the lightweight estimate is below an input limit. This is
 * intentionally approximate and is used only to avoid needless work; callers
 * use `estimateInputTokens` for the same estimator otherwise.
 */
export function isDefinitelyWithinInputTokenLimit(body, maxInputTokens) {
  const limit = Number(maxInputTokens);
  if (!Number.isFinite(limit) || limit <= 0 || !body || typeof body !== "object") return false;

  const state = { mediaTokens: 0 };
  try {
    const tokenizableBody = redactMedia(pickOpenAIContext(body), "", state);
    if (state.mediaTokens > 0) return false;
    return Buffer.byteLength(JSON.stringify(tokenizableBody), "utf8") <= limit;
  } catch {
    return false;
  }
}
