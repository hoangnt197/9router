import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { bumpSharedVersion, getSharedVersion } from "../../cluster/redisState.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = await db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

const apiKeyValidationCache = new Map();
const API_KEY_CACHE_TTL_MS = 60000;
let apiKeyCacheVersion = null;

function invalidateApiKeyCache() {
  apiKeyValidationCache.clear();
}

async function refreshApiKeyCacheVersion() {
  const sharedVersion = await getSharedVersion("api-keys");
  if (sharedVersion && sharedVersion !== apiKeyCacheVersion) invalidateApiKeyCache();
  apiKeyCacheVersion = sharedVersion;
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  await db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
  );
  apiKeyCacheVersion = await bumpSharedVersion("api-keys");
  invalidateApiKeyCache();
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    await tx.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  apiKeyCacheVersion = await bumpSharedVersion("api-keys");
  invalidateApiKeyCache();
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = await db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  apiKeyCacheVersion = await bumpSharedVersion("api-keys");
  invalidateApiKeyCache();
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  if (!key) return false;
  await refreshApiKeyCacheVersion();
  const now = Date.now();
  const cached = apiKeyValidationCache.get(key);
  // Never cache a valid key locally: another worker may revoke it in the
  // shared database and has no way to invalidate this process synchronously.
  // Negative caching still protects the DB from repeated invalid-key probes.
  if (cached && !cached.isValid && (now - cached.ts) < API_KEY_CACHE_TTL_MS) {
    return cached.isValid;
  }
  const db = await getAdapter();
  const row = await db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  const isValid = !!row && (row.isActive === 1 || row.isActive === true);
  if (isValid) apiKeyValidationCache.delete(key);
  else apiKeyValidationCache.set(key, { isValid: false, ts: now });
  return isValid;
}
