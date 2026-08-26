#!/usr/bin/env node
/**
 * One-way, offline SQLite -> PostgreSQL importer.
 *
 * It is intentionally not part of the application boot path. Run it only
 * against a stopped/copy-on-write SQLite source and a dedicated PostgreSQL
 * target after setting NINE_ROUTER_POSTGRES_IMPORT_CONFIRM=YES.
 */
import fs from "node:fs";
import path from "node:path";
import { createPostgresAdapter } from "../src/lib/db/adapters/postgresAdapter.js";

const TABLES = [
  ["_meta", ["key", "value"]],
  ["settings", ["id", "data"]],
  ["providerConnections", ["id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt"]],
  ["providerNodes", ["id", "type", "name", "data", "createdAt", "updatedAt"]],
  ["proxyPools", ["id", "isActive", "testStatus", "data", "createdAt", "updatedAt"]],
  ["apiKeys", ["id", "key", "name", "machineId", "isActive", "createdAt"]],
  ["combos", ["id", "name", "kind", "models", "createdAt", "updatedAt"]],
  ["kv", ["scope", "key", "value"]],
  ["usageHistory", ["id", "timestamp", "provider", "model", "connectionId", "apiKey", "endpoint", "promptTokens", "completionTokens", "cost", "status", "tokens", "meta"]],
  ["usageDaily", ["dateKey", "data"]],
  ["requestDetails", ["id", "timestamp", "provider", "model", "connectionId", "status", "data"]],
];

const POSTGRES_TABLE = Object.fromEntries(TABLES.map(([table]) => [table, table.toLowerCase()]));
const POSTGRES_COLUMN = {
  authType: "authtype", isActive: "isactive", createdAt: "createdat", updatedAt: "updatedat",
  testStatus: "teststatus", machineId: "machineid", connectionId: "connectionid",
  apiKey: "apikey", promptTokens: "prompttokens", completionTokens: "completiontokens",
  dateKey: "datekey",
};
const BATCH_SIZE = 500;

function usage() {
  console.error("Usage: NINE_ROUTER_DATABASE_URL=postgres://... NINE_ROUTER_POSTGRES_IMPORT_CONFIRM=YES node scripts/import-sqlite-to-postgres.mjs /absolute/path/data.sqlite [--replace]");
}

async function openSqlite(filePath) {
  try {
    const { createBetterSqliteAdapter } = await import("../src/lib/db/adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(filePath);
  } catch {}
  try {
    const { createNodeSqliteAdapter } = await import("../src/lib/db/adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(filePath);
  } catch {}
  const { createSqlJsAdapter } = await import("../src/lib/db/adapters/sqljsAdapter.js");
  return await createSqlJsAdapter(filePath);
}

function placeholders(rowCount, columnCount) {
  let value = 1;
  return Array.from({ length: rowCount }, () => `(${Array.from({ length: columnCount }, () => `$${value++}`).join(", ")})`).join(", ");
}

async function targetHasData(pool) {
  for (const [sourceTable] of TABLES) {
    const table = POSTGRES_TABLE[sourceTable];
    const { rows } = await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
    if (rows.length) return table;
  }
  return null;
}

async function importTable(client, source, sourceTable, columns) {
  const rows = source.all(`SELECT ${columns.join(", ")} FROM ${sourceTable}`);
  if (!rows.length) return 0;
  const targetTable = POSTGRES_TABLE[sourceTable];
  const targetColumns = columns.map((column) => POSTGRES_COLUMN[column] || column.toLowerCase());

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const sql = `INSERT INTO ${targetTable} (${targetColumns.join(", ")}) VALUES ${placeholders(batch.length, targetColumns.length)}`;
    const values = batch.flatMap((row) => columns.map((column) => row[column]));
    await client.query(sql, values);
  }
  return rows.length;
}

const [sqliteFile, flag] = process.argv.slice(2);
if (!sqliteFile || (flag && flag !== "--replace") || !process.env.NINE_ROUTER_DATABASE_URL || process.env.NINE_ROUTER_POSTGRES_IMPORT_CONFIRM !== "YES") {
  usage();
  process.exitCode = 2;
} else {
  const sourcePath = path.resolve(sqliteFile);
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite file not found: ${sourcePath}`);

  const source = await openSqlite(sourcePath);
  const target = await createPostgresAdapter(process.env.NINE_ROUTER_DATABASE_URL);
  const existing = await targetHasData(target.raw);
  if (existing && flag !== "--replace") {
    throw new Error(`PostgreSQL target already contains data (${existing}). Refusing to overwrite; use --replace only for a disposable target.`);
  }

  const client = await target.raw.connect();
  try {
    await client.query("BEGIN");
    if (flag === "--replace") {
      await client.query(`TRUNCATE TABLE ${TABLES.map(([table]) => POSTGRES_TABLE[table]).join(", ")} RESTART IDENTITY`);
    }

    const counts = {};
    for (const [table, columns] of TABLES) counts[table] = await importTable(client, source, table, columns);
    await client.query("SELECT setval(pg_get_serial_sequence('usagehistory', 'id'), COALESCE((SELECT MAX(id) FROM usagehistory), 1), (SELECT COUNT(*) > 0 FROM usagehistory))");
    await client.query("COMMIT");

    console.log("SQLite -> PostgreSQL import complete");
    for (const [table] of TABLES) console.log(`${table}: ${counts[table]}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await target.close();
    source.close?.();
  }
}
