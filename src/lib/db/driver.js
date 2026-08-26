import { createPostgresAdapter } from "./adapters/postgresAdapter.js";

// PostgreSQL is the only persistent store. One pool per process keeps
// connection usage bounded while all instances share the same source of truth.
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function initAdapter() {
  const connectionString = process.env.NINE_ROUTER_DATABASE_URL;
  if (!connectionString) throw new Error("NINE_ROUTER_DATABASE_URL is required for PostgreSQL persistence");
  const adapter = await createPostgresAdapter(connectionString);

  if (!state.logged) {
    console.log("[DB] Driver: postgres");
    state.logged = true;
  }

  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter().then((a) => {
      state.instance = a;
      return a;
    }).catch((error) => {
      state.initPromise = null;
      throw error;
    });
  }
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("adapter not initialized — await getAdapter() first");
  return state.instance;
}
