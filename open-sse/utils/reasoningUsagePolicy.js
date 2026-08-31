const EFFORT_LEVELS = { low: 0, medium: 2, high: 4, xhigh: 6, max: 8, ultra: 8 };
export const ZERO_REASONING_RANDOM_PERCENT = 80;
export const ZERO_REASONING_MAX_TOKENS = 512;

// This flag is intentionally non-enumerable: request translators and executors
// commonly spread/serialize the body before sending it upstream.
const COMBO_MODEL_MARKER = "__shortlabComboModel";
const COMBO_MODEL_TOKEN_RULES = "__shortlabComboTokenRules";
// Capture the combo key at routing time. Provider executors may mutate
// `body.model` in place, so it is not a reliable source during usage writes.
const COMBO_ORIGINAL_NAME = "__shortlabOriginalComboName";
const CLIENT_USAGE_APPLIED = "__shortlabClientUsageApplied";

function reportComboName(value) {
  return typeof value === "string"
    ? value.replace(/\((?:low|medium|high|xhigh|max|ultra)\)\s*$/i, "").trim()
    : null;
}

export function markComboModelRequest(body, modelItem = null, comboName = null) {
  Object.defineProperty(body, COMBO_MODEL_MARKER, { value: true, enumerable: false });
  const originalComboName = reportComboName(comboName || body?.model);
  if (originalComboName) {
    Object.defineProperty(body, COMBO_ORIGINAL_NAME, { value: originalComboName, enumerable: false });
  }
  if (modelItem && typeof modelItem === "object") {
    Object.defineProperty(body, COMBO_MODEL_TOKEN_RULES, { value: modelItem, enumerable: false });
  }
  return body;
}

export function preserveComboModelMarker(source, target) {
  return source?.[COMBO_MODEL_MARKER] === true
    ? markComboModelRequest(target, source?.[COMBO_MODEL_TOKEN_RULES], source?.[COMBO_ORIGINAL_NAME])
    : target;
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

/**
 * Return the public combo name only for a request routed through a combo.
 * The marker is deliberately non-enumerable, so it never reaches a provider.
 */
export function getComboName(body) {
  if (body?.[COMBO_MODEL_MARKER] !== true) return null;
  return body?.[COMBO_ORIGINAL_NAME] || null;
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
  const hasComparableComboEffort = isInternalComboModel && Boolean(requested) && Boolean(effective);
  return {
    publicModel: publicModelName(body?.model),
    multiplier: gap > 0 ? gap : 1,
    // Only a lower internal effort justifies changing a provider-reported value.
    adjustUsage: hasComparableComboEffort && gap > 0,
    // Providers often omit the field entirely at low effort. Still synthesize a
    // plausible value when the client explicitly requested an effort, even when
    // it matches the internal suffix (e.g. low → low).
    randomizeMissingReasoning: hasComparableComboEffort,
  };
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : null;
}

function percentage(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(100, parsed) : 0;
}

function readTokenRule(item, prefix) {
  const multiplier = positiveInteger(item?.[`${prefix}TokenMultiplier`]);
  const chance = percentage(item?.[`${prefix}TokenMultiplierPercent`]);
  const maxTokens = positiveInteger(item?.[`${prefix}TokenMultiplierMax`]);
  return multiplier && multiplier > 1 && chance > 0 ? { multiplier, chance, maxTokens } : null;
}

/**
 * Token multipliers are intentionally a client-only presentation policy.
 * Accounting must continue to use the original provider usage.
 */
export function createClientTokenUsagePolicy(body) {
  const item = body?.[COMBO_MODEL_TOKEN_RULES];
  if (body?.[COMBO_MODEL_MARKER] !== true || !item || typeof item !== "object") return null;
  const input = readTokenRule(item, "input");
  const output = readTokenRule(item, "output");
  return input || output ? { input, output } : null;
}

function multiplyTokenCount(value, rule, random) {
  if (!rule || !Number.isFinite(value) || value <= 0 || random() * 100 >= rule.chance) return value;
  let multiplier = rule.multiplier;
  // The cap limits multiplication only: never reduce a real upstream value.
  if (rule.maxTokens && value <= rule.maxTokens) {
    multiplier = Math.min(multiplier, Math.floor(rule.maxTokens / value));
  }
  return multiplier > 1 ? value * multiplier : value;
}

function applyUsageMultiplier(usage, inputKey, outputKey, totalKey, policy, random) {
  if (!usage || typeof usage !== "object" || usage[CLIENT_USAGE_APPLIED]) return;
  Object.defineProperty(usage, CLIENT_USAGE_APPLIED, { value: true, enumerable: false });
  const input = Number(usage[inputKey]);
  const output = Number(usage[outputKey]);
  const nextInput = multiplyTokenCount(input, policy?.input, random);
  const nextOutput = multiplyTokenCount(output, policy?.output, random);
  const delta = (Number.isFinite(nextInput) ? nextInput - input : 0) + (Number.isFinite(nextOutput) ? nextOutput - output : 0);
  if (Number.isFinite(nextInput)) usage[inputKey] = nextInput;
  if (Number.isFinite(nextOutput)) usage[outputKey] = nextOutput;
  if (delta && Number.isFinite(usage[totalKey])) usage[totalKey] += delta;
}

/** Apply combo token presentation rules only to the payload that goes to the client. */
export function applyClientTokenUsagePolicy(payload, policy, random = Math.random) {
  if (!policy || !payload || typeof payload !== "object") return payload;
  const target = payload.response && typeof payload.response === "object" ? payload.response : payload;
  const usage = target.usage;
  if (usage && typeof usage === "object") {
    if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
      applyUsageMultiplier(usage, "input_tokens", "output_tokens", "total_tokens", policy, random);
    } else {
      applyUsageMultiplier(usage, "prompt_tokens", "completion_tokens", "total_tokens", policy, random);
    }
  }
  const metadata = target.usageMetadata;
  if (metadata && typeof metadata === "object") {
    applyUsageMultiplier(metadata, "promptTokenCount", "candidatesTokenCount", "totalTokenCount", policy, random);
  }
  return payload;
}

function updateUsage(usage, policy, random = Math.random) {
  if (!usage || (!policy.adjustUsage && !policy.randomizeMissingReasoning)) return;
  const detailsKey = usage.output_tokens !== undefined ? "output_tokens_details" : "completion_tokens_details";
  const outputKey = usage.output_tokens !== undefined ? "output_tokens" : "completion_tokens";
  if (!Number.isFinite(usage[outputKey]) || !Number.isFinite(usage.total_tokens)) return;
  const details = usage[detailsKey] && typeof usage[detailsKey] === "object" ? usage[detailsKey] : (usage[detailsKey] = {});
  const actual = Number.isFinite(details.reasoning_tokens) ? details.reasoning_tokens : 0;
  if (actual > 0) {
    if (!policy.adjustUsage) return;
    const scaled = actual * policy.multiplier;
    const delta = scaled - actual;
    details.reasoning_tokens = scaled;
    usage[outputKey] += delta;
    usage.total_tokens += delta;
  } else if (policy.randomizeMissingReasoning && random() * 100 < ZERO_REASONING_RANDOM_PERCENT) {
    const generated = Math.max(1, Math.min(ZERO_REASONING_MAX_TOKENS, usage[outputKey]));
    const value = 1 + Math.floor(random() * generated);
    details.reasoning_tokens = value;
    usage[outputKey] += value;
    usage.total_tokens += value;
  } else if (policy.randomizeMissingReasoning) {
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
  if (metadata && (policy.adjustUsage || policy.randomizeMissingReasoning) && Number.isFinite(metadata.totalTokenCount)) {
    const actual = Number.isFinite(metadata.thoughtsTokenCount) ? metadata.thoughtsTokenCount : 0;
    if (actual > 0) {
      if (!policy.adjustUsage) return payload;
      const scaled = actual * policy.multiplier;
      metadata.thoughtsTokenCount = scaled;
      metadata.candidatesTokenCount = (metadata.candidatesTokenCount || 0) + scaled - actual;
      metadata.totalTokenCount += scaled - actual;
    } else if (policy.randomizeMissingReasoning && random() * 100 < ZERO_REASONING_RANDOM_PERCENT) {
      const upper = Math.max(1, Math.min(ZERO_REASONING_MAX_TOKENS, metadata.candidatesTokenCount || 1));
      const value = 1 + Math.floor(random() * upper);
      metadata.thoughtsTokenCount = value;
      metadata.candidatesTokenCount = (metadata.candidatesTokenCount || 0) + value;
      metadata.totalTokenCount += value;
    } else if (policy.randomizeMissingReasoning) metadata.thoughtsTokenCount = 0;
  }
  return payload;
}
