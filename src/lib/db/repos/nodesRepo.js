import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { bumpSharedVersion, getSharedVersion } from "../../cluster/redisState.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

async function upsert(db, n) {
  const r = nodeToRow(n);
  await db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

let cachedNodes = null;
let cachedNodesTs = 0;
let cachedNodesVersion = null;
const NODES_CACHE_TTL_MS = 30000;

function invalidateNodesCache() {
  cachedNodes = null;
  cachedNodesTs = 0;
  cachedNodesVersion = null;
}

export async function getProviderNodes(filter = {}) {
  const now = Date.now();
  const sharedVersion = await getSharedVersion("provider-nodes");
  let allNodes = cachedNodes;
  if (!allNodes || (now - cachedNodesTs) >= NODES_CACHE_TTL_MS || (sharedVersion && sharedVersion !== cachedNodesVersion)) {
    const db = await getAdapter();
    allNodes = (await db.all(`SELECT * FROM providerNodes`)).map(rowToNode);
    cachedNodes = allNodes;
    cachedNodesTs = now;
    cachedNodesVersion = sharedVersion;
  }

  if (filter.type) {
    return allNodes.filter((n) => n.type === filter.type);
  }
  return allNodes;
}

export async function getProviderNodeById(id) {
  const all = await getProviderNodes();
  return all.find((n) => n.id === id) || null;
}

export async function createProviderNode(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, node);
  await bumpSharedVersion("provider-nodes");
  invalidateNodesCache();
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    await upsert(tx, merged);
    result = merged;
  });
  await bumpSharedVersion("provider-nodes");
  invalidateNodesCache();
  return result;
}

export async function deleteProviderNode(id) {
  const db = await getAdapter();
  let removed = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    await tx.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  await bumpSharedVersion("provider-nodes");
  invalidateNodesCache();
  return removed;
}
