import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Keep diagnostic records bounded: request payloads may contain large or
// sensitive prompts. Error details are retained; successful details remain
// opt-in/disabled to avoid turning this table into a second usage history.
const MAX_FIELD_BYTES = 16 * 1024;
const MAX_ERROR_RECORDS = 5000;

function detailId(detail) {
  return detail?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    if (/authorization|api[-_]?key|cookie|token|secret/i.test(key)) delete out[key];
  }
  return out;
}

function bounded(value) {
  if (value === undefined || value === null) return null;
  let json;
  try { json = JSON.stringify(value); } catch { return { _truncated: true }; }
  if (json.length <= MAX_FIELD_BYTES) return value;
  return { _truncated: true, _originalSize: json.length, _preview: json.slice(0, 500) };
}

function normalize(detail) {
  return {
    id: detailId(detail),
    timestamp: detail.timestamp || new Date().toISOString(),
    provider: detail.provider || "unknown",
    model: detail.model || "unknown",
    connectionId: detail.connectionId || null,
    apiKeyMasked: typeof detail.apiKeyMasked === "string" ? detail.apiKeyMasked : null,
    errorDisposition: detail.errorDisposition === "fallback" ? "fallback" : "client",
    status: detail.status || "error",
    latency: detail.latency || { ttft: 0, total: 0 },
    tokens: detail.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    headers: sanitizeHeaders(detail.headers || detail.request?.headers),
    request: bounded(detail.request),
    providerRequest: bounded(detail.providerRequest),
    providerResponse: bounded(detail.providerResponse),
    response: bounded(detail.response),
    pxpipe: bounded(detail.pxpipe),
  };
}

async function purgeOldErrors(db) {
  const row = await db.get(`SELECT COUNT(*) AS c FROM requestdetails WHERE status = ?`, ["error"]);
  const count = Number(row?.c || 0);
  if (count > MAX_ERROR_RECORDS) {
    await db.run(
      `DELETE FROM requestdetails WHERE id IN (
        SELECT id FROM requestdetails WHERE status = ? ORDER BY timestamp ASC LIMIT ?
      )`,
      ["error", count - MAX_ERROR_RECORDS],
    );
  }
}

export async function saveRequestDetail(detail) {
  // Keep only errors that reached the client. Intermediate combo/account fallback
  // failures remain in runtime logs and must not pollute the Error log.
  if (detail?.errorDisposition === "fallback") return null;
  // All failure paths use status=error. Do not retain successful conversation
  // bodies unless a separate observability policy is added later.
  if (detail?.status !== "error") return null;
  const db = await getAdapter();
  const record = normalize(detail);
  await db.run(
    `INSERT INTO requestdetails(id, timestamp, provider, model, connectionid, status, data)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp,
       provider = excluded.provider, model = excluded.model,
       connectionid = excluded.connectionid, status = excluded.status,
       data = excluded.data`,
    [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)],
  );
  purgeOldErrors(db).catch(() => {});
  return record.id;
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionid = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const countRow = await db.get(`SELECT COUNT(*) AS c FROM requestdetails ${where}`, params);
  const totalItems = Number(countRow?.c || 0);
  const page = Math.max(1, Number(filter.page || 1));
  const pageSize = Math.max(1, Number(filter.pageSize || 50));
  const rows = await db.all(
    `SELECT data FROM requestdetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const totalPages = Math.ceil(totalItems / pageSize);
  return {
    details: rows.map((row) => parseJson(row.data, {})),
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = await db.get(`SELECT data FROM requestdetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

export async function clearRequestDetails() {
  const db = await getAdapter();
  const result = await db.run("DELETE FROM requestdetails");
  return Number(result?.changes || 0);
}

export async function getDistinctProviders() {
  const db = await getAdapter();
  const rows = await db.all(`SELECT DISTINCT provider FROM requestdetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((row) => row.provider);
}
