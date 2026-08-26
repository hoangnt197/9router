import { createClient } from "redis";

// Redis is optional while the application runs as a single node. Every helper
// fails open so an unavailable Redis never interrupts model routing.
const state = global.__nineRouterRedisState ??= {
  client: null,
  connectPromise: null,
  nextAttemptAt: 0,
  warned: false,
};
const REDIS_CONNECT_TIMEOUT_MS = 1_500;
const REDIS_RETRY_COOLDOWN_MS = 10_000;
const VERSION_POLL_INTERVAL_MS = 1_000;
const versionCache = new Map();

function warnOnce(message) {
  if (state.warned) return;
  state.warned = true;
  console.warn(`[cluster-state] ${message}`);
}

export async function getOptionalRedis() {
  const url = process.env.NINE_ROUTER_REDIS_URL;
  if (!url) return null;
  if (state.client?.isReady) return state.client;
  if (Date.now() < state.nextAttemptAt) return null;
  if (!state.connectPromise) {
    const client = createClient({
      url,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        // Routing must fail open. Reconnecting happens on a later request,
        // after a short cooldown, rather than holding this request forever.
        reconnectStrategy: false,
      },
    });
    client.on("error", (error) => warnOnce(`Redis unavailable; using local state (${error.message})`));
    state.client = client;
    state.connectPromise = client.connect()
      .catch((error) => {
        warnOnce(`Redis connection failed; using local state (${error.message})`);
        state.nextAttemptAt = Date.now() + REDIS_RETRY_COOLDOWN_MS;
        if (state.client === client) state.client = null;
        client.disconnect();
        return null;
      })
      .finally(() => { state.connectPromise = null; });
  }
  await state.connectPromise;
  return state.client?.isReady ? state.client : null;
}

export function clusterKey(name) {
  return `nine-router:${name}`;
}

// Configuration is persisted in PostgreSQL, while this tiny Redis version key
// invalidates each worker's in-process read cache without putting configuration
// reads on Redis. A missing Redis connection simply retains the existing TTL
// cache behaviour.
export async function getSharedVersion(name) {
  const cached = versionCache.get(name);
  if (cached && Date.now() - cached.checkedAt < VERSION_POLL_INTERVAL_MS) return cached.value;
  try {
    const client = await getOptionalRedis();
    const value = client ? await client.get(clusterKey(`version:${name}`)) : null;
    versionCache.set(name, { value, checkedAt: Date.now() });
    return value;
  } catch (error) {
    warnOnce(`Redis version check failed; using local cache (${error.message})`);
    return null;
  }
}

export async function bumpSharedVersion(name) {
  try {
    const client = await getOptionalRedis();
    if (!client) return null;
    const value = String(await client.incr(clusterKey(`version:${name}`)));
    versionCache.set(name, { value, checkedAt: Date.now() });
    return value;
  } catch (error) {
    warnOnce(`Redis version update failed; using local cache (${error.message})`);
    return null;
  }
}

export async function nextDistributedCounter(name) {
  try {
    const client = await getOptionalRedis();
    return client ? await client.incr(clusterKey(name)) : null;
  } catch (error) {
    warnOnce(`Redis command failed; using local state (${error.message})`);
    state.nextAttemptAt = Date.now() + REDIS_RETRY_COOLDOWN_MS;
    return null;
  }
}

export async function withDistributedLock(name, callback, { ttlMs = 30_000 } = {}) {
  const client = await getOptionalRedis();
  if (!client) return callback({ acquired: false, shared: false });

  const key = clusterKey(`lock:${name}`);
  const token = crypto.randomUUID();
  const acquired = await client.set(key, token, { NX: true, PX: ttlMs });
  if (acquired !== "OK") return callback({ acquired: false, shared: true });

  try {
    return await callback({ acquired: true, shared: true });
  } finally {
    // Delete only the lock owned by this caller; an expired/reacquired lock
    // must never be removed by a stale worker.
    await client.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      { keys: [key], arguments: [token] }
    ).catch(() => {});
  }
}

export async function closeRedisState() {
  if (!state.client) return;
  const client = state.client;
  state.client = null;
  state.connectPromise = null;
  state.nextAttemptAt = 0;
  versionCache.clear();
  if (client.isOpen) await client.quit().catch(() => client.disconnect());
}
