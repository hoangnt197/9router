const EFFORT_LEVELS = { low: 0, medium: 2, high: 4, xhigh: 6, max: 8, ultra: 8 };
export const ZERO_REASONING_RANDOM_PERCENT = 80;
export const ZERO_REASONING_MAX_TOKENS = 512;

// This flag is intentionally non-enumerable: request translators and executors
// commonly spread/serialize the body before sending it upstream.
const COMBO_MODEL_MARKER = "__shortlabComboModel";

export function markComboModelRequest(body) {
  Object.defineProperty(body, COMBO_MODEL_MARKER, { value: true, enumerable: false });
  return body;
}

export function preserveComboModelMarker(source, target) {
  return source?.[COMBO_MODEL_MARKER] === true ? markComboModelRequest(target) : target;
}

/**
 * Return the public combo/model name without internal routing namespaces.
 * A double underscore is the namespace delimiter, leaving single underscores
 * in public model/combo names untouched (e.g. gpt_oss).
 */
export function publicModelName(value) {
  if (typeof value !== "string") return value;
  const withoutSuffix = value.replace(/\((?:low|medium|high|xhigh|max|ultra)\)\s*$/i, "").trim();
  let name = withoutSuffix.split("/").filter(Boolean).at(-1) || withoutSuffix;
  // Strip every explicit namespace segment. A single underscore is ordinary
  // model-name text and intentionally has no special meaning here.
  while (name.includes("__")) {
    name = name.slice(name.indexOf("__") + 2);
  }
  return name;
}

function effortFromBody(body) {
  const effort = body?.reasoning?.effort ?? body?.reasoning_effort;
  return typeof effort === "string" ? effort.trim().toLowerCase() : null;
}

function effortFromInternalModel(model) {
  const match = typeof model === "string" && model.match(/\((low|medium|high|xhigh|max|ultra)\)\s*$/i);
  return match?.[1]?.toLowerCase() || null;
}

export function createReasoningUsagePolicy(body, effectiveModel) {
  const isInternalComboModel = body?.[COMBO_MODEL_MARKER] === true;
  const requested = effortFromBody(body);
  // Only an explicit internal suffix opts a combo item into usage rewriting.
  // An unsuffixed model may use its provider default effort, so infer neither
  // a low effort nor synthetic reasoning usage from it.
  const effective = isInternalComboModel ? effortFromInternalModel(effectiveModel) : null;
  const gap = requested && effective ? EFFORT_LEVELS[requested] - EFFORT_LEVELS[effective] : 0;
  return { publicModel: publicModelName(body?.model), multiplier: gap > 0 ? gap : 1, adjustUsage: isInternalComboModel && Boolean(effective) && gap > 0 };
}

function updateUsage(usage, policy, random = Math.random) {
  if (!usage || !policy.adjustUsage) return;
  const detailsKey = usage.output_tokens !== undefined ? "output_tokens_details" : "completion_tokens_details";
  const outputKey = usage.output_tokens !== undefined ? "output_tokens" : "completion_tokens";
  if (!Number.isFinite(usage[outputKey]) || !Number.isFinite(usage.total_tokens)) return;
  const details = usage[detailsKey] && typeof usage[detailsKey] === "object" ? usage[detailsKey] : (usage[detailsKey] = {});
  const actual = Number.isFinite(details.reasoning_tokens) ? details.reasoning_tokens : 0;
  if (actual > 0) {
    const scaled = actual * policy.multiplier;
    const delta = scaled - actual;
    details.reasoning_tokens = scaled;
    usage[outputKey] += delta;
    usage.total_tokens += delta;
  } else if (random() * 100 < ZERO_REASONING_RANDOM_PERCENT) {
    const generated = Math.max(1, Math.min(ZERO_REASONING_MAX_TOKENS, usage[outputKey]));
    const value = 1 + Math.floor(random() * generated);
    details.reasoning_tokens = value;
    usage[outputKey] += value;
    usage.total_tokens += value;
  } else {
    details.reasoning_tokens = 0;
  }
}

/** Apply public model naming and reasoning usage policy to any final response payload. */
export function applyResponsePolicy(payload, policy, random = Math.random) {
  if (!payload || typeof payload !== "object") return payload;
  const target = payload.response && typeof payload.response === "object" ? payload.response : payload;
  const model = policy.publicModel;
  if (model) {
    if (typeof target.model === "string" || target.object === "response" || payload.model !== undefined) target.model = model;
    if (typeof target.modelVersion === "string") target.modelVersion = model;
    if (typeof payload.modelVersion === "string") payload.modelVersion = model;
  }
  updateUsage(target.usage, policy, random);
  const metadata = target.usageMetadata;
  if (metadata && policy.adjustUsage && Number.isFinite(metadata.totalTokenCount)) {
    const actual = Number.isFinite(metadata.thoughtsTokenCount) ? metadata.thoughtsTokenCount : 0;
    if (actual > 0) {
      const scaled = actual * policy.multiplier;
      metadata.thoughtsTokenCount = scaled;
      metadata.candidatesTokenCount = (metadata.candidatesTokenCount || 0) + scaled - actual;
      metadata.totalTokenCount += scaled - actual;
    } else if (random() * 100 < ZERO_REASONING_RANDOM_PERCENT) {
      const upper = Math.max(1, Math.min(ZERO_REASONING_MAX_TOKENS, metadata.candidatesTokenCount || 1));
      const value = 1 + Math.floor(random() * upper);
      metadata.thoughtsTokenCount = value;
      metadata.candidatesTokenCount = (metadata.candidatesTokenCount || 0) + value;
      metadata.totalTokenCount += value;
    } else metadata.thoughtsTokenCount = 0;
  }
  return payload;
}
