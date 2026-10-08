/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";
import { stripThinkingSuffix } from "../translator/concerns/thinkingUnified.js";
import { markComboModelRequest, preserveComboModelMarker, publicModelName } from "../utils/reasoningUsagePolicy.js";
import { estimateInputTokens } from "../utils/inputTokenEstimator.js";
import { nextDistributedCounter } from "../../src/lib/cluster/redisState.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const rawStr = typeof m === "object" && m !== null ? m.model : m;
    const slash = typeof rawStr === "string" ? rawStr.indexOf("/") : -1;
    const provider = slash > 0 ? rawStr.slice(0, slash) : "";
    const model = slash > 0 ? rawStr.slice(slash + 1) : rawStr;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  const tiers = models.map((m, i) => ({ m, i, t: tierOf(m) }));
  if (tiers.every((x) => x.t === tiers[0].t)) return models;

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  return tiers
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

export { estimateInputTokens } from "../utils/inputTokenEstimator.js";

/**
 * Remove provider/deployment identifiers from an upstream error before it is
 * returned through a combo. Internal routes commonly prefix errors with
 * `[provider-id/internal-model]`; exposing that would make the failure path
 * inconsistent with successful responses, which always use the public combo
 * name.
 */
export function formatComboErrorForClient(message, comboName) {
  const publicModel = publicModelName(comboName || "model");
  const withoutInternalContext = String(message || "")
    .replace(/\[[^\]\r\n]*\/[^\]\r\n]*\]\s*/g, "")
    .trim();
  return `[${publicModel}]${withoutInternalContext ? ` ${withoutInternalContext}` : ""}`;
}

async function publicizeComboFailureResponse(response, message, comboName) {
  const publicMessage = formatComboErrorForClient(message, comboName);
  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }

  if (payload && typeof payload === "object") {
    if (payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)) {
      payload.error.message = publicMessage;
    } else {
      payload.error = { message: publicMessage };
    }
  } else {
    payload = { error: { message: publicMessage } };
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Calculate estimated cost for a model config given estimated input tokens
 * @param {string|Object} modelItem
 * @param {number} estimatedTokens
 * @returns {number} Cost in USD, or Infinity if price is not configured
 */
export function calculateModelCost(modelItem, estimatedTokens = 0) {
  if (!modelItem) return Infinity;
  // If string, price is unset -> Infinity
  if (typeof modelItem === "string") return Infinity;

  const rawPrice = modelItem.price;
  if (rawPrice === "" || rawPrice === null || rawPrice === undefined) return Infinity;
  const price = typeof rawPrice === "number" ? rawPrice : parseFloat(rawPrice);
  if (!Number.isFinite(price) || price < 0) return Infinity;

  const pricingType = modelItem.pricingType || "request";
  if (pricingType === "token" || pricingType === "input_token") {
    const rawMin = modelItem.minPrice;
    const minPrice = (rawMin !== "" && rawMin !== null && rawMin !== undefined) ? (parseFloat(rawMin) || 0) : 0;
    const tokenCost = (estimatedTokens / 1_000_000) * price;
    return Math.max(minPrice, tokenCost);
  }

  // Request pricing
  return price;
}

/**
 * Reorder combo models by calculated cost ascending (Lowest Cost first)
 * Models without prices are sorted last (cost = Infinity), tie-breaks preserve original index.
 * @param {Array} models
 * @param {Object} body
 * @returns {Array} Reordered models
 */
export function reorderByLowestCost(models, body, estimatedInputTokens = null) {
  if (!Array.isArray(models) || models.length <= 1) return models;

  const estimatedTokens = Number.isFinite(estimatedInputTokens)
    ? estimatedInputTokens
    : estimateInputTokens(body);
  return models
    .map((m, i) => ({
      m,
      i,
      // A model that cannot satisfy the requested input remains a
      // fallback, but must never win merely because it is cheaper.
      cost: supportsRequestedTokenLimits(m, estimatedTokens)
        ? calculateModelCost(m, estimatedTokens)
        : Infinity,
    }))
    .sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.i - b.i;
    })
    .map((x) => x.m);
}

function positiveNumber(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Whether a combo object item declares enough input capacity for this request. */
export function supportsRequestedTokenLimits(modelItem, inputTokens) {
  if (!modelItem || typeof modelItem !== "object") return true;
  const maxInput = positiveNumber(modelItem.maxInputTokens ?? modelItem.maxInput ?? modelItem.maxContextTokens ?? modelItem.maxContext);
  return !maxInput || inputTokens <= maxInput;
}

function hasDeclaredInputLimit(models) {
  return Array.isArray(models) && models.some((model) => {
    if (!model || typeof model !== "object") return false;
    return positiveNumber(model.maxInputTokens ?? model.maxInput ?? model.maxContextTokens ?? model.maxContext) !== null;
  });
}

/** Whether the lowest-cost ordering actually depends on input size. */
/**
 * Keep the selected strategy's order among compatible models, but defer models
 * whose declared input limit is too small until every compatible option fails.
 */
export function deferModelsExceedingInputLimit(models, body, estimatedInputTokens = null) {
  if (!Array.isArray(models) || models.length <= 1) return models;
  if (!hasDeclaredInputLimit(models)) return models;

  const estimatedTokens = Number.isFinite(estimatedInputTokens)
    ? estimatedInputTokens
    : estimateInputTokens(body);
  const compatible = [];
  const undersized = [];
  for (const model of models) {
    (supportsRequestedTokenLimits(model, estimatedTokens) ? compatible : undersized).push(model);
  }
  return undersized.length === 0 ? models : [...compatible, ...undersized];
}

/**
 * Get current time in minutes from midnight in Vietnam time (UTC+7).
 * @param {Date} [date=new Date()]
 * @returns {number} 0..1439
 */
export function getVietnamTimeMinutes(date = new Date()) {
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60 * 1000);
  const vnMs = utcMs + (7 * 60 * 60 * 1000);
  const vnDate = new Date(vnMs);
  return vnDate.getHours() * 60 + vnDate.getMinutes();
}

/**
 * Parse "HH:mm" time string into minutes from midnight (0..1439).
 * @param {string} timeStr
 * @returns {number|null}
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return (hours % 24) * 60 + (minutes % 60);
}

/**
 * Check if a model is currently active according to its Vietnam (UTC+7) time schedule.
 * @param {Object|string} modelItem
 * @param {Date} [date=new Date()]
 * @returns {boolean}
 */
export function isModelActiveAtTime(modelItem, date = new Date()) {
  if (!modelItem || typeof modelItem !== "object") return true;
  const schedule = modelItem.timeSchedule;
  if (!schedule || schedule.enabled !== true) return true;

  const startMin = parseTimeToMinutes(schedule.startTime);
  const endMin = parseTimeToMinutes(schedule.endTime);
  if (startMin === null || endMin === null) return true;

  // If start equals end, consider active all day
  if (startMin === endMin) return true;

  const curMin = getVietnamTimeMinutes(date);

  // Standard daytime range (e.g. 08:00 to 17:00)
  if (startMin < endMin) {
    return curMin >= startMin && curMin < endMin;
  }

  // Overnight range (e.g. 23:00 to 05:00)
  return curMin >= startMin || curMin < endMin;
}

/**
 * Filter combo models by their time schedule.
 * Safe fallback: If all models are filtered out, returns the original list.
 * @param {Array} models
 * @param {Date} [date=new Date()]
 * @returns {Array}
 */
export function filterModelsByTimeSchedule(models, date = new Date()) {
  if (!Array.isArray(models) || models.length <= 1) return models;
  const active = models.filter((m) => isModelActiveAtTime(m, date));
  return active.length > 0 ? active : models;
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime) => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      // Infer modality from embedded mime when available; fall back to pdf for generic files.
      let fmime = null;
      if (b.input_audio?.format) fmime = `audio/${b.input_audio.format}`;
      else if (b.file?.file_data) fmime = String(b.file.file_data).match(/^data:([^;,]+)/)?.[1];
      else if (b.source?.media_type) fmime = b.source.media_type;
      else if (b.source?.data) fmime = String(b.source.data).match(/^data:([^;,]+)/)?.[1];
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    // gemini parts: inlineData/fileData carry a mime
    addByMime(b.inlineData?.mimeType || b.fileData?.mimeType);
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  const scanMessage = (m) => {
    if (!m || typeof m !== "object") return;

    // Ollama / Hermes images array (strings or objects)
    if (Array.isArray(m.images) && m.images.length > 0) {
      required.add("vision");
    }

    // Vercel AI SDK / Hermes attachments / experimental_attachments
    const attachments = m.experimental_attachments || m.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att) continue;
        const mime = att.contentType || att.mediaType || (typeof att.url === "string" && att.url.match(/^data:([^;,]+)/)?.[1]);
        if (mime) addByMime(mime);
        else if (att.url || att.data) required.add("vision");
      }
    }

    // Direct message-level modality properties
    if (m.image_url || m.image) required.add("vision");
    if (m.audio_url || m.audio) required.add("audioInput");

    // Scan array content blocks
    scanContent(m.content);

    // Scan string content for embedded data URIs
    if (typeof m.content === "string") {
      if (m.content.includes("data:image/")) required.add("vision");
      else if (m.content.includes("data:audio/")) required.add("audioInput");
      else if (m.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanMessage(m);              // openai / claude / hermes / ollama
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  // tools: web_search / google_search
  if (Array.isArray(body?.tools)) {
    for (const t of body.tools) {
      const type = t?.type || t?.function?.name;
      if (type === "web_search" || type === "google_search") required.add("search");
    }
  }

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Distributed variant of round-robin routing. When Redis is configured, every
 * 9Router instance increments the same counter, so two workers cannot both
 * choose the first model simply because they have independent process memory.
 *
 * Redis deliberately remains optional: no URL, a connection failure, or a
 * transient Redis outage falls back to the existing in-process rotation.
 */
export async function getDistributedRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") return models;

  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const rotationKey = comboName || "__default__";
  const count = await nextDistributedCounter(`combo-rotation:${rotationKey}`);
  if (!Number.isFinite(count) || count < 1) {
    return getRotatedModels(models, comboName, strategy, normalizedStickyLimit);
  }

  const currentIndex = Math.floor((count - 1) / normalizedStickyLimit) % models.length;
  return rotateModelsFromIndex(models, currentIndex);
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({
  body,
  models,
  handleSingleModel,
  log,
  comboName,
  comboStrategy,
  comboStickyLimit = 1,
  autoSwitch = true,
}) {
  // Tokenizing a large context is CPU intensive. Routing can need the same
  // value for price ordering and max-input deferral, so calculate it once per
  // request and pass it through every ordering stage.
  const needsInputTokenEstimate = Array.isArray(models)
    && models.length > 1
    && (comboStrategy === "lowest-cost" || hasDeclaredInputLimit(models));
  // One cheap, shared estimator is used for cost ordering and max-input
  // deferral. This deliberately trades exact near-limit routing for keeping
  // large multi-turn requests off the event loop.
  const estimatedInputTokens = needsInputTokenEstimate ? estimateInputTokens(body) : null;

  const applyStrategy = async (tierModels) => {
    if (comboStrategy === "lowest-cost") {
      return reorderByLowestCost(tierModels, body, estimatedInputTokens);
    }
    return getDistributedRotatedModels(tierModels, comboName, comboStrategy, comboStickyLimit);
  };

  // Filter models active at current Vietnam time (UTC+7)
  const timeFilteredModels = filterModelsByTimeSchedule(models);
  if (timeFilteredModels.length !== models.length) {
    const activeNames = timeFilteredModels.map((m) => (typeof m === "object" && m !== null ? m.model : m)).join(", ");
    log?.info?.("COMBO", `Time schedule active (VN UTC+7) [${timeFilteredModels.length}/${models.length}]: ${activeNames}`);
  }

  let orderedModels = await applyStrategy(timeFilteredModels);

  if (comboStrategy === "lowest-cost" || timeFilteredModels.length !== models.length) {
    const names = orderedModels.map((m) => (typeof m === "object" && m !== null ? m.model : m)).join(" -> ");
    log?.info?.("COMBO", `Combo order (${comboStrategy || "fallback"}): ${names}`);
  }

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(orderedModels, required);
      const firstOld = typeof orderedModels[0] === "object" && orderedModels[0] !== null ? orderedModels[0].model : orderedModels[0];
      const firstNew = typeof reordered[0] === "object" && reordered[0] !== null ? reordered[0].model : reordered[0];
      if (firstNew !== firstOld) {
        log?.info?.("COMBO", `auto-switch for [${[...required].join(",")}] → ${firstNew}`);
      }
      orderedModels = reordered;
    }
  }

  // Capability auto-switch above may have moved an undersized item forward.
  // For every strategy, preserve its relative order but defer models whose
  // declared input capacity cannot fit this request until the final fallback.
  if (comboStrategy === "lowest-cost") {
    orderedModels = reorderByLowestCost(orderedModels, body, estimatedInputTokens);
  } else {
    orderedModels = deferModelsExceedingInputLimit(orderedModels, body, estimatedInputTokens);
  }
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < orderedModels.length; i++) {
    const rawModel = orderedModels[i];
    const modelStr = typeof rawModel === "object" && rawModel !== null ? rawModel.model : rawModel;
    log.info("COMBO", `Trying model ${i + 1}/${orderedModels.length}: ${modelStr}`);

    try {
      const comboBody = preserveComboModelMarker(body, { ...body, model: comboName || body?.model });
      // Internal-only marker for the final response policy. It is intentionally
      // non-enumerable so it cannot be translated or forwarded upstream.
      markComboModelRequest(comboBody, rawModel, comboName || body?.model);
      const result = await handleSingleModel(comboBody, modelStr);
      
      // Success (2xx) - return response
      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      // Extract error info from response
      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return publicizeComboFailureResponse(result, errorText, comboName || body?.model);
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = formatComboErrorForClient(errorText || String(result.status), comboName || body?.model);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = formatComboErrorForClient(error.message || String(error), comboName || body?.model);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body, text) {
  const next = preserveComboModelMarker(body, { ...body });
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  // Combo persistence stores per-model routing metadata as objects. Fusion
  // executes model identifiers only, unlike fallback routing which needs the
  // metadata for price/limit ordering.
  const panel = Array.isArray(models)
    ? models.map((item) => (typeof item === "object" && item !== null ? item.model : item)).filter(Boolean)
    : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped (we want prose).
  const { tools, tool_choice, stream_options, ...rest } = body;
  // Fusion runs panel models non-streaming; drop stream_options too, or providers
  // like DeepSeek reject it with "stream_options should be set along with stream = true".
  // See issue #3024.
  const panelBody = { ...rest, stream: false };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
