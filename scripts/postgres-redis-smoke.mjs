import { createClient } from "redis";
import { closeRedisState } from "../src/lib/cluster/redisState.js";
import { getAdapter } from "../src/lib/db/driver.js";
import { getSettings, updateSettings } from "../src/lib/db/repos/settingsRepo.js";
import { createProviderConnection, deleteProviderConnection, getProviderConnectionById } from "../src/lib/db/repos/connectionsRepo.js";
import { createCombo, deleteCombo, getComboById } from "../src/lib/db/repos/combosRepo.js";
import { createProviderNode, deleteProviderNode, getProviderNodeById } from "../src/lib/db/repos/nodesRepo.js";
import { createProxyPool, deleteProxyPool, getProxyPoolById } from "../src/lib/db/repos/proxyPoolsRepo.js";

if (!process.env.NINE_ROUTER_DATABASE_URL || !process.env.NINE_ROUTER_REDIS_URL) {
  throw new Error("NINE_ROUTER_DATABASE_URL and NINE_ROUTER_REDIS_URL are required");
}

const marker = process.env.SMOKE_MARKER || `smoke-${Date.now()}`;
const expectedMarker = process.env.SMOKE_EXPECT_MARKER;

if (expectedMarker) {
  const settings = await getSettings();
  if (settings.postgresRedisSmokeMarker !== expectedMarker) {
    throw new Error("second instance could not read PostgreSQL state written by the first instance");
  }
} else {
  await updateSettings({ postgresRedisSmokeMarker: marker });
}

const connection = await createProviderConnection({
  provider: "smoke-provider",
  authType: "apikey",
  name: `${marker}-connection`,
  apiKey: "not-a-real-secret",
});
const combo = await createCombo({ name: `${marker}-combo`, models: ["smoke/model"] });
const node = await createProviderNode({ type: "smoke", name: `${marker}-node`, prefix: "smoke" });
const pool = await createProxyPool({ name: `${marker}-pool`, proxyUrl: "http://127.0.0.1:1" });

try {
  const [savedConnection, savedCombo, savedNode, savedPool] = await Promise.all([
    getProviderConnectionById(connection.id),
    getComboById(combo.id),
    getProviderNodeById(node.id),
    getProxyPoolById(pool.id),
  ]);
  if (!savedConnection || !savedCombo || !savedNode || !savedPool) {
    throw new Error("PostgreSQL repository round-trip failed");
  }

  const redis = createClient({ url: process.env.NINE_ROUTER_REDIS_URL });
  await redis.connect();
  try {
    const redisKey = `9router:smoke:${marker}`;
    await redis.set(redisKey, "ok", { EX: 60 });
    if (await redis.get(redisKey) !== "ok") throw new Error("Redis round-trip failed");
    await redis.del(redisKey);
  } finally {
    await redis.quit();
  }
} finally {
  await Promise.all([
    deleteProviderConnection(connection.id),
    deleteCombo(combo.id),
    deleteProviderNode(node.id),
    deleteProxyPool(pool.id),
  ]);
  await closeRedisState();
  await (await getAdapter()).close();
}

console.log(`PostgreSQL + Redis smoke passed (${marker})`);
