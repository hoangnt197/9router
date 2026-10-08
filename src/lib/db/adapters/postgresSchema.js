// PostgreSQL schema for 9router's logical data model. Identifiers are kept
// lowercase in PostgreSQL because the existing SQL is intentionally unquoted.
// postgresAdapter maps result keys back to the camelCase API used by repos.
export const POSTGRES_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS providerconnections (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, authtype TEXT NOT NULL,
    name TEXT, email TEXT, priority INTEGER, isactive INTEGER DEFAULT 1,
    data TEXT NOT NULL, createdat TEXT NOT NULL, updatedat TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS providernodes (
    id TEXT PRIMARY KEY, type TEXT, name TEXT, data TEXT NOT NULL,
    createdat TEXT NOT NULL, updatedat TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS proxypools (
    id TEXT PRIMARY KEY, isactive INTEGER DEFAULT 1, teststatus TEXT,
    data TEXT NOT NULL, createdat TEXT NOT NULL, updatedat TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS apikeys (
    id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineid TEXT,
    isactive INTEGER DEFAULT 1, inputtokenrules TEXT NOT NULL DEFAULT '[]',
    outputtokenrules TEXT NOT NULL DEFAULT '[]', createdat TEXT NOT NULL
  )`,
  `ALTER TABLE apikeys ADD COLUMN IF NOT EXISTS inputtokenrules TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE apikeys ADD COLUMN IF NOT EXISTS outputtokenrules TEXT NOT NULL DEFAULT '[]'`,
  `CREATE TABLE IF NOT EXISTS combos (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT, models TEXT NOT NULL,
    createdat TEXT NOT NULL, updatedat TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (scope, key)
  )`,
  `CREATE TABLE IF NOT EXISTS usagehistory (
    id BIGSERIAL PRIMARY KEY, timestamp TEXT NOT NULL, provider TEXT, model TEXT,
    connectionid TEXT, apikey TEXT, endpoint TEXT, prompttokens INTEGER DEFAULT 0,
    completiontokens INTEGER DEFAULT 0, cost DOUBLE PRECISION DEFAULT 0,
    status TEXT, tokens TEXT, meta TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS usagedaily (datekey TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerconnections(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerconnections(provider, isactive)`,
  `CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerconnections(provider, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_pn_type ON providernodes(type)`,
  `CREATE INDEX IF NOT EXISTS idx_pp_active ON proxypools(isactive)`,
  `CREATE INDEX IF NOT EXISTS idx_pp_status ON proxypools(teststatus)`,
  `CREATE INDEX IF NOT EXISTS idx_ak_key ON apikeys(key)`,
  `CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)`,
  `CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_ts ON usagehistory(timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_provider ON usagehistory(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_model ON usagehistory(model)`,
  `CREATE INDEX IF NOT EXISTS idx_uh_conn ON usagehistory(connectionid)`,
];

export async function ensurePostgresSchema(pool) {
  for (const sql of POSTGRES_SCHEMA_SQL) await pool.query(sql);
}
