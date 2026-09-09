import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { machineIdSync } = require("node-machine-id");
import { v7 as uuidv7 } from "uuid";

import { CODEX_CLIENT_CONFIG } from "../config/codexClientConfig.js";

const contextWindowIds = new Map();
const MAX_CONTEXT_WINDOWS = 5000;
let installationId = null;

function deriveUuid(seed) {
  const hash = createHash("sha256").update(seed).digest("hex");
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function getInstallationId() {
  if (installationId) return installationId;
  const configured = process.env.CODEX_INSTALLATION_ID?.trim();
  if (configured) {
    installationId = configured;
    return installationId;
  }
  let machineId;
  try {
    machineId = machineIdSync();
  } catch {
    machineId = randomUUID();
  }
  installationId = deriveUuid(`9router-codex:${machineId}`);
  return installationId;
}

function getContextWindowId(sessionId) {
  const existing = contextWindowIds.get(sessionId);
  if (existing) {
    contextWindowIds.delete(sessionId);
    contextWindowIds.set(sessionId, existing);
    return existing;
  }
  const contextWindowId = uuidv7();
  if (contextWindowIds.size >= MAX_CONTEXT_WINDOWS) {
    contextWindowIds.delete(contextWindowIds.keys().next().value);
  }
  contextWindowIds.set(sessionId, contextWindowId);
  return contextWindowId;
}

function findHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const normalizedName = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === normalizedName);
  const value = key ? headers[key] : null;
  return typeof value === "string" && value && !/[\r\n]/.test(value) ? value : null;
}

export function createCodexTurnMetadata(sessionId, rawHeaders = null) {
  const forwarded = findHeader(rawHeaders, "x-codex-turn-metadata");
  if (forwarded) return forwarded;

  const turnId = uuidv7();
  const metadata = {
    installation_id: getInstallationId(),
    session_id: sessionId,
    thread_id: sessionId,
    agent_name: CODEX_CLIENT_CONFIG.turnMetadata.agentName,
    turn_id: turnId,
    window_id: `${sessionId}:0`,
    window_number: 0,
    context_window_id: getContextWindowId(sessionId),
    request_kind: "turn",
    root_turn_id: turnId,
    thread_source: CODEX_CLIENT_CONFIG.turnMetadata.threadSource,
    sandbox: CODEX_CLIENT_CONFIG.turnMetadata.sandbox,
    sandbox_mode: CODEX_CLIENT_CONFIG.turnMetadata.sandboxMode,
    auto_review_enabled: CODEX_CLIENT_CONFIG.turnMetadata.autoReviewEnabled,
    node_repl_auto_review_required: CODEX_CLIENT_CONFIG.turnMetadata.nodeReplAutoReviewRequired,
    node_repl_disabled: CODEX_CLIENT_CONFIG.turnMetadata.nodeReplDisabled,
    turn_started_at_unix_ms: Date.now(),
  };
  return JSON.stringify(metadata);
}

export function mergeCodexTurnClientMetadata(body, metadataJson) {
  let metadata;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    return body;
  }
  const existing = body.client_metadata && typeof body.client_metadata === "object" && !Array.isArray(body.client_metadata)
    ? body.client_metadata
    : {};
  body.client_metadata = {
    ...existing,
    "x-codex-installation-id": metadata.installation_id,
    session_id: metadata.session_id,
    thread_id: metadata.thread_id,
    "x-codex-window-id": metadata.window_id,
    turn_id: metadata.turn_id,
    root_turn_id: metadata.root_turn_id,
    "x-codex-turn-metadata": metadataJson,
  };
  return body;
}
