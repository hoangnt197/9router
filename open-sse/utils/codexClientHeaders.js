import { CODEX_CLIENT_CONFIG } from "../config/codexClientConfig.js";

export const CODEX_CLI_VERSION = CODEX_CLIENT_CONFIG.version;
export const CODEX_CLI_ORIGINATOR = CODEX_CLIENT_CONFIG.originator;
export const CODEX_CLI_USER_AGENT = CODEX_CLIENT_CONFIG.userAgent;
export const CODEX_CLI_BETA_FEATURES = CODEX_CLIENT_CONFIG.betaFeatures;

const BLOCKED_CLIENT_HEADERS = new Set([
  "accept",
  "api-key",
  "authorization",
  "chatgpt-account-id",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "forwarded",
  "host",
  "proxy-authorization",
  "set-cookie",
  "transfer-encoding",
  "x-api-key",
  "x-connection-id",
  "x-real-ip",
]);

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MANAGED_UPSTREAM_HEADERS = new Set([
  "accept",
  "api-key",
  "authorization",
  "chatgpt-account-id",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "proxy-authorization",
  "session-id",
  "thread-id",
  "transfer-encoding",
  "x-api-key",
  "x-client-request-id",
  "x-codex-turn-metadata",
  "x-codex-window-id",
]);

export class CodexHeaderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodexHeaderValidationError";
  }
}

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === "function") return Array.from(headers.entries());
  return Object.entries(headers);
}

function findHeaderKey(headers, name) {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === normalizedName);
}

function setHeader(headers, name, value) {
  const existingKey = findHeaderKey(headers, name);
  headers[existingKey || name] = value;
}

function isBlockedClientHeader(name) {
  return BLOCKED_CLIENT_HEADERS.has(name)
    || name.startsWith("cf-")
    || name.startsWith("sec-")
    || name.startsWith("x-forwarded-")
    || name.startsWith("x-9router-");
}

function upstreamHeaderEntries(value) {
  if (Array.isArray(value)) return value.map((row) => [row?.name, row?.value]);
  if (value && typeof value === "object") return Object.entries(value);
  if (value == null) return [];
  throw new CodexHeaderValidationError("Upstream headers must be an object or a list of name/value rows");
}

function isManagedUpstreamHeader(name) {
  return MANAGED_UPSTREAM_HEADERS.has(name)
    || name.startsWith("cf-")
    || name.startsWith("sec-")
    || name.startsWith("x-forwarded-")
    || name.startsWith("x-9router-");
}

export function sanitizeCodexUpstreamHeaders(value) {
  const headers = {};
  const seenNames = new Set();

  for (const [rawName, rawValue] of upstreamHeaderEntries(value)) {
    const name = String(rawName ?? "").trim();
    const originalValue = String(rawValue ?? "");
    const headerValue = originalValue.trim();
    if (!name && !headerValue) continue;
    if (!name || !headerValue) {
      throw new CodexHeaderValidationError("Each upstream header requires both a name and a value");
    }
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new CodexHeaderValidationError(`Invalid upstream header name: ${name}`);
    }
    if (/\r|\n/.test(originalValue)) {
      throw new CodexHeaderValidationError(`Upstream header ${name} contains an invalid line break`);
    }

    const normalizedName = name.toLowerCase();
    if (isManagedUpstreamHeader(normalizedName)) {
      throw new CodexHeaderValidationError(`Upstream header ${name} is managed by 9Router`);
    }
    if (seenNames.has(normalizedName)) {
      throw new CodexHeaderValidationError(`Duplicate upstream header name: ${name}`);
    }
    seenNames.add(normalizedName);
    headers[name] = headerValue;
  }

  return headers;
}

export function mergeCodexUpstreamHeaders(headers, configuredHeaders) {
  const sanitized = sanitizeCodexUpstreamHeaders(configuredHeaders);
  for (const [name, value] of Object.entries(sanitized)) setHeader(headers, name, value);
  return headers;
}

function isCodexClientRequest(entries) {
  return entries.some(([rawName, rawValue]) => {
    const name = String(rawName).toLowerCase();
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue || "");
    return name.startsWith("x-codex-")
      || name === "session-id"
      || name === "thread-id"
      || (name === "originator" && /codex/i.test(value))
      || (name === "user-agent" && /codex/i.test(value));
  });
}

export function mergeCodexClientHeaders(headers, rawHeaders) {
  const entries = headerEntries(rawHeaders);
  if (!isCodexClientRequest(entries)) return headers;

  for (const [rawName, rawValue] of entries) {
    const name = String(rawName).trim();
    const normalizedName = name.toLowerCase();
    if (!name || isBlockedClientHeader(normalizedName)) continue;

    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue ?? "");
    if (!value || /[\r\n]/.test(value)) continue;
    setHeader(headers, name, value);
  }
  return headers;
}

export function applyCodexSessionHeaders(headers, sessionId) {
  setHeader(headers, "x-client-request-id", sessionId);
  setHeader(headers, "session-id", sessionId);
  setHeader(headers, "thread-id", sessionId);
  setHeader(headers, "x-codex-window-id", `${sessionId}:0`);
  return headers;
}
