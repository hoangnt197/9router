/**
 * Normalize the tiered token rules shared by combo persistence and request
 * handling. Empty/invalid rules are deliberately discarded: old one-off
 * multiplier fields are not a fallback for this feature.
 */
export function normalizeTokenRules(rules) {
  if (!Array.isArray(rules)) return [];
  const normalized = rules.map((rule) => {
    if (!rule || typeof rule !== "object") return null;
    const min = Number(rule.multiplierMin);
    if (!Number.isFinite(min) || min < 1) return null;
    const rawMax = rule.multiplierMax;
    const max = rawMax === null || rawMax === undefined || rawMax === ""
      ? null
      : Number(rawMax);
    if (max !== null && (!Number.isFinite(max) || max < min)) return null;
    const rawUpTo = rule.upTo;
    const upTo = rawUpTo === null || rawUpTo === undefined || rawUpTo === ""
      ? null
      : Math.floor(Number(rawUpTo));
    if (upTo !== null && (!Number.isFinite(upTo) || upTo < 1)) return null;
    const powerValue = Number(rule.power);

    const rawRatio = rule.cacheCreationRatio ?? rule.cacheWriteRatio;
    let cacheCreationRatio = undefined;
    if (rawRatio !== null && rawRatio !== undefined && rawRatio !== "") {
      const r = Number(rawRatio);
      const normalizedR = r > 1 && r <= 100 ? r / 100 : r;
      if (Number.isFinite(normalizedR) && normalizedR >= 0 && normalizedR <= 1) {
        cacheCreationRatio = Number(normalizedR.toFixed(4));
      }
    }

    return {
      upTo,
      multiplierMin: min,
      multiplierMax: max,
      power: Number.isFinite(powerValue) && powerValue > 0 ? powerValue : 1,
      ...(cacheCreationRatio !== undefined ? { cacheCreationRatio } : {}),
    };
  }).filter(Boolean);

  // Finite boundaries are matched in ascending order; an unlimited tier is
  // always last. One unlimited tier is meaningful, so retain the first.
  const finite = normalized.filter((rule) => rule.upTo !== null)
    .sort((a, b) => a.upTo - b.upTo);
  const unlimited = normalized.find((rule) => rule.upTo === null);
  return unlimited ? [...finite, unlimited] : finite;
}

export function normalizeTokenRulePreset(preset) {
  if (!preset || typeof preset !== "object") return null;
  const name = typeof preset.name === "string" ? preset.name.trim().slice(0, 80) : "";
  const id = typeof preset.id === "string" ? preset.id.trim() : "";
  if (!name || !id) return null;
  return {
    id,
    name,
    inputTokenRules: normalizeTokenRules(preset.inputTokenRules),
    outputTokenRules: normalizeTokenRules(preset.outputTokenRules),
  };
}

export function getTokenRulePresets(value) {
  return Array.isArray(value)
    ? value.map((preset) => normalizeTokenRulePreset(preset)).filter(Boolean)
    : [];
}
