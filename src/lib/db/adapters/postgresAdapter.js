import pg from "pg";
import { ensurePostgresSchema } from "./postgresSchema.js";

const { Pool } = pg;

const CAMEL_CASE_COLUMNS = {
  authtype: "authType",
  isactive: "isActive",
  createdat: "createdAt",
  updatedat: "updatedAt",
  teststatus: "testStatus",
  machineid: "machineId",
  connectionid: "connectionId",
  prompttokens: "promptTokens",
  completiontokens: "completionTokens",
  datekey: "dateKey",
  apikey: "apiKey",
};

function mapRow(row) {
  if (!row) return row;
  const mapped = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[CAMEL_CASE_COLUMNS[key] || key] = value;
  }
  return mapped;
}

// Existing repositories use SQLite's positional `?` parameters. Translate
// them without touching question marks inside string literals.
export function toPostgresSql(sql) {
  let index = 0;
  let quote = null;
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) out += sql[++i];
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function queryableAdapter(queryable) {
  return {
    async run(sql, params = []) {
      const result = await queryable.query(toPostgresSql(sql), params);
      return { changes: result.rowCount || 0, lastInsertRowid: null };
    },
    async get(sql, params = []) {
      const result = await queryable.query(toPostgresSql(sql), params);
      return mapRow(result.rows[0]);
    },
    async all(sql, params = []) {
      const result = await queryable.query(toPostgresSql(sql), params);
      return result.rows.map(mapRow);
    },
  };
}

export async function createPostgresAdapter(connectionString) {
  if (!connectionString) throw new Error("NINE_ROUTER_DATABASE_URL is required for PostgreSQL");
  const pool = new Pool({ connectionString, max: Number(process.env.NINE_ROUTER_DB_POOL_MAX || 12) });
  await pool.query("SELECT 1");
  await ensurePostgresSchema(pool);
  const adapter = queryableAdapter(pool);

  return {
    driver: "postgres",
    ...adapter,
    async exec(sql) { await pool.query(sql); },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(queryableAdapter(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
    async checkpoint() {},
    raw: pool,
  };
}
