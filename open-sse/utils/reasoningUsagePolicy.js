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

function normalizeTokenRules(rules) {
  if (!Array.isArray(rules)) return [];
  const finite = [];
  let unlimited = null;
  for (const rule of rules) {
    const min = Number(rule?.multiplierMin);
    if (!Number.isFinite(min) || min < 1) continue;
    const rawMax = rule?.multiplierMax;
    const max = rawMax === null || rawMax === undefined || rawMax === "" ? null : Number(rawMax);
    if (max !== null && (!Number.isFinite(max) || max < min)) continue;
    const rawUpTo = rule?.upTo;
    const upTo = rawUpTo === null || rawUpTo === undefined || rawUpTo === "" ? null : Math.floor(Number(rawUpTo));
    if (upTo !== null && (!Number.isFinite(upTo) || upTo < 1)) continue;
    const chanceValue = Number(rule?.chance);
    const normalized = { upTo, multiplierMin: min, multiplierMax: max, chance: Number.isFinite(chanceValue) ? Math.max(0, Math.min(100, chanceValue)) : 100 };
    if (upTo === null) unlimited ||= normalized;
    else finite.push(normalized);
  }
  finite.sort((a, b) => a.upTo - b.upTo);
  return unlimited ? [...finite, unlimited] : finite;
}

export function isComboModelRequest(body) {
  return body?.[COMBO_MODEL_MARKER] === true;
}

// Headroom is configured per combo member so fallback models can use different
// thresholds. Keep the marker private and expose only the validated value.
export function getComboHeadroomMinInputTokens(body) {
  if (!isComboModelRequest(body)) return null;
  const value = Number(body?.[COMBO_MODEL_TOKEN_RULES]?.headroomMinInputTokens);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

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

/**
 * Token multipliers are intentionally a client-only presentation policy.
 * Accounting must continue to use the original provider usage.
 */
export function createClientTokenUsagePolicy(body) {
  const item = body?.[COMBO_MODEL_TOKEN_RULES];
  if (body?.[COMBO_MODEL_MARKER] !== true || !item || typeof item !== "object") return null;
  const input = normalizeTokenRules(item.inputTokenRules);
  const output = normalizeTokenRules(item.outputTokenRules);
  return input.length || output.length ? { input, output } : null;
}

function appliedTokenMultiplier(value, rules, random) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const rule = rules?.find((candidate) => candidate.upTo === null || value <= candidate.upTo);
  if (!rule || rule.chance <= 0 || random() * 100 >= rule.chance) return 1;
  const max = rule.multiplierMax ?? rule.multiplierMin;
  const multiplier = max === rule.multiplierMin
    ? rule.multiplierMin
    : rule.multiplierMin + random() * (max - rule.multiplierMin);
  return multiplier > 1 ? multiplier : 1;
}

function scaleTokenField(target, key, multiplier) {
  if (!target || multiplier <= 1 || !Number.isFinite(Number(target[key]))) return;
  target[key] = Math.round(Number(target[key]) * multiplier);
}

function scaleInputCacheBreakdown(usage, multiplier) {
  if (multiplier <= 1) return;
  scaleTokenField(usage, "cached_tokens", multiplier);
  scaleTokenField(usage, "cache_read_input_tokens", multiplier);
  scaleTokenField(usage, "cache_creation_input_tokens", multiplier);
  scaleTokenField(usage.prompt_tokens_details, "cached_tokens", multiplier);
  scaleTokenField(usage.prompt_tokens_details, "cache_creation_tokens", multiplier);
  scaleTokenField(usage.input_tokens_details, "cached_tokens", multiplier);
  scaleTokenField(usage, "cachedContentTokenCount", multiplier);
}

function inputMultiplierBasis(usage, inputKey, input) {
  // Claude reports cache read/write outside input_tokens, unlike OpenAI and
  // Responses where cached tokens are already a subset of the input count.
  if (inputKey === "input_tokens"
      && usage.input_tokens_details === undefined
      && (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
    return input
      + (Number(usage.cache_read_input_tokens) || 0)
      + (Number(usage.cache_creation_input_tokens) || 0);
  }
  return input;
}

function inputUsageExtraKeys(usage, inputKey) {
  // Claude-style usage reports cache reads/writes alongside input_tokens rather
  // than inside it. They are billable input context and must remain visible in
  // the reconciled total after their shared input tier is applied.
  if (inputKey === "input_tokens"
      && usage.input_tokens_details === undefined
      && (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
    return ["cache_read_input_tokens", "cache_creation_input_tokens"];
  }
  return [];
}

function applyUsageMultiplier(usage, inputKey, outputKey, totalKey, policy, random, options = {}) {
  if (!usage || typeof usage !== "object" || usage[CLIENT_USAGE_APPLIED]) return;
  Object.defineProperty(usage, CLIENT_USAGE_APPLIED, { value: true, enumerable: false });
  const input = Number(usage[inputKey]);
  const output = Number(usage[outputKey]);
  const inputMultiplier = appliedTokenMultiplier(inputMultiplierBasis(usage, inputKey, input), policy?.input, random);
  const outputMultiplier = appliedTokenMultiplier(output, policy?.output, random);
  const nextInput = Number.isFinite(input) ? Math.round(input * inputMultiplier) : input;
  const nextOutput = Number.isFinite(output) ? Math.round(output * outputMultiplier) : output;
  if (Number.isFinite(nextInput)) usage[inputKey] = nextInput;
  if (Number.isFinite(nextOutput)) usage[outputKey] = nextOutput;
  scaleInputCacheBreakdown(usage, inputMultiplier);

  if (options.recalculateTotal && Number.isFinite(nextInput) && Number.isFinite(nextOutput)) {
    const extraTokens = [...inputUsageExtraKeys(usage, inputKey), ...(options.totalExtraKeys || [])]
      .reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
    usage[totalKey] = nextInput + nextOutput + extraTokens;
  }
}

/** Apply combo token presentation rules only to the payload that goes to the client. */
export function applyClientTokenUsagePolicy(payload, policy, random = Math.random) {
  if (!policy || !payload || typeof payload !== "object") return payload;
  const target = payload.response && typeof payload.response === "object" ? payload.response : payload;
  const usage = target.usage;
  if (usage && typeof usage === "object") {
    if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
      applyUsageMultiplier(usage, "input_tokens", "output_tokens", "total_tokens", policy, random, {
        recalculateTotal: target.object === "response" || usage.total_tokens !== undefined,
      });
    } else {
      applyUsageMultiplier(usage, "prompt_tokens", "completion_tokens", "total_tokens", policy, random, {
        recalculateTotal: true,
      });
    }
  }
  const metadata = target.usageMetadata;
  if (metadata && typeof metadata === "object") {
    applyUsageMultiplier(metadata, "promptTokenCount", "candidatesTokenCount", "totalTokenCount", policy, random, {
      recalculateTotal: true,
      totalExtraKeys: ["thoughtsTokenCount"],
    });
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
