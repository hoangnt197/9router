const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ENV_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MANAGED_HEADER_NAMES = new Set(["authorization"]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const asRecord = (value) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : {}
);

const headerRows = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, headerValue]) => ({ name, value: headerValue }));
  }
  if (value == null) return [];
  throw new Error("Headers must be an object or a list of name/value rows");
};

const withoutManagedHeaders = (headers) => Object.fromEntries(
  Object.entries(asRecord(headers)).filter(([name]) => !MANAGED_HEADER_NAMES.has(name.toLowerCase())),
);

const withManagedAuthorization = (headers, apiKey) => ({
  ...withoutManagedHeaders(headers),
  Authorization: `Bearer ${apiKey}`,
});

export function sanitizeHeaderRecord(value, { environment = false } = {}) {
  const result = {};
  const seenNames = new Set();

  for (const row of headerRows(value)) {
    const name = String(row?.name ?? "").trim();
    const rawValue = row?.value;
    const rawHeaderValue = String(rawValue ?? "");
    const headerValue = rawHeaderValue.trim();

    if (!name && !headerValue) continue;
    if (!name || !headerValue) throw new Error("Each header row requires both a name and a value");
    if (!HEADER_NAME_PATTERN.test(name)) throw new Error(`Invalid HTTP header name: ${name}`);
    if (MANAGED_HEADER_NAMES.has(name.toLowerCase())) {
      throw new Error("The Authorization header is managed by the selected 9Router API key");
    }
    if (/\r|\n/.test(rawHeaderValue)) throw new Error(`Header ${name} contains an invalid line break`);
    if (environment && !ENV_VARIABLE_PATTERN.test(headerValue)) {
      throw new Error(`Invalid environment variable name for ${name}: ${headerValue}`);
    }

    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) throw new Error(`Duplicate HTTP header name: ${name}`);
    seenNames.add(normalizedName);
    result[name] = headerValue;
  }

  return result;
}

export function getCodexSettings(parsed) {
  const config = asRecord(parsed);
  const provider = asRecord(asRecord(config.model_providers)["9router"]);
  const agents = asRecord(config.agents);

  return {
    model: typeof config.model === "string" ? config.model : "",
    subagentModel: typeof agents.default_subagent_model === "string" ? agents.default_subagent_model : "",
    baseUrl: typeof provider.base_url === "string" ? provider.base_url : "",
    httpHeaders: withoutManagedHeaders(provider.http_headers),
    envHttpHeaders: asRecord(provider.env_http_headers),
  };
}

export function applyCodexSettings(parsed, payload) {
  const config = asRecord(parsed);
  const existingProviders = asRecord(config.model_providers);
  const existingProvider = asRecord(existingProviders["9router"]);
  const normalizedBaseUrl = String(payload.baseUrl).replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1";

  const nextHttpHeaders = hasOwn(payload, "httpHeaders")
    ? withManagedAuthorization(sanitizeHeaderRecord(payload.httpHeaders), payload.apiKey)
    : withManagedAuthorization(existingProvider.http_headers, payload.apiKey);

  const nextProvider = {
    ...existingProvider,
    name: "9Router",
    base_url: normalizedBaseUrl,
    wire_api: "responses",
    http_headers: nextHttpHeaders,
  };

  if (hasOwn(payload, "envHttpHeaders")) {
    const envHttpHeaders = sanitizeHeaderRecord(payload.envHttpHeaders, { environment: true });
    if (Object.keys(envHttpHeaders).length) nextProvider.env_http_headers = envHttpHeaders;
    else delete nextProvider.env_http_headers;
  }

  config.model = payload.model;
  config.model_provider = "9router";
  config.model_providers = { ...existingProviders, "9router": nextProvider };
  config.agents = {
    ...asRecord(config.agents),
    default_subagent_model: payload.subagentModel || payload.model,
  };
  delete config.agents.subagent;

  return config;
}

export function has9RouterConfig(parsed) {
  const config = asRecord(parsed);
  return config.model_provider === "9router" || Boolean(asRecord(config.model_providers)["9router"]);
}
