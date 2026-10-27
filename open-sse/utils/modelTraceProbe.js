/**
 * Detect the deterministic number-selection challenges used by ModelTrace.
 *
 * This detector is intentionally conservative. It is only used to decide
 * whether the router should skip its own default Codex instructions; it must
 * never remove instructions, tools, or tool_choice supplied by the client.
 */

function collectText(value, parts, depth = 0, seen = new Set()) {
  if (value == null || depth > 6) return;
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts, depth + 1, seen);
    return;
  }

  // Request bodies have several wire shapes (Chat Completions, Responses,
  // and the simple prompt fallback). Restrict traversal to text-bearing keys
  // so tool schemas cannot accidentally make a request look like a probe.
  for (const key of ["messages", "input", "content", "text", "prompt", "instructions", "system", "user_prefix"]) {
    if (key in value) collectText(value[key], parts, depth + 1, seen);
  }
}

/** Extract user-visible prompt text from supported request body shapes. */
export function extractModelTraceText(body = {}) {
  const parts = [];
  collectText(body, parts);
  return parts.join("\n");
}

function hasChallengeRange(text) {
  return /(?:\b1\s*(?:to|through|thru|[-–—]|\.\.|到|至)\s*355\b|\[\s*1\s*,\s*355\s*\]|\b(?:between|bounded\s+by)\s+1\s+(?:and|through)\s+355\b)/i.test(text);
}

function hasChallengeCount(text) {
  return /(?:for\s+each\s+of\s+|exactly\s+|provide\s+exactly\s+|fill\s+exactly\s+|共给出\s*|给出\s*|为\s*)(?:[89]\d|[1-3]\d{2}|400)(?:\s+(?:[A-Za-z-]+\s+){0,4}(?:positions?|items?|choices?|integers?|whole[-\s]numbers?)|\s*个)/i.test(text);
}

function hasIndependentChoiceLanguage(text) {
  return /(first[-\s]instinct|first[-\s]response|non[-\s]semantic|each\s+(?:item|position)|separate(?:ly)?|immediate|逐项|逐个|每次只决定|分别|第一反应|无语义|不承载语义|取值)/i.test(text);
}

/**
 * Return true only for a high-confidence ModelTrace challenge request.
 * The challenge wording is generated dynamically, so matching one literal
 * prompt would be brittle and would miss future ModelTrace variants.
 */
export function isModelTraceProbe(body = {}) {
  const text = extractModelTraceText(body);
  // ModelTrace's longest current prefix is 2048 words. Keep enough room for
  // that legitimate case while rejecting unexpectedly large arbitrary bodies.
  if (!text || text.length > 20000) return false;
  return hasChallengeRange(text)
    && hasChallengeCount(text)
    && hasIndependentChoiceLanguage(text);
}
