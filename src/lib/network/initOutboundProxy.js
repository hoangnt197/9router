import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

let initialized = false;

export async function ensureOutboundProxyInitialized() {
  if (initialized) return true;

  try {
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

// Static builds have no runtime database configuration. Initialise only in a
// deployed process; request handlers still fail clearly if the required
// PostgreSQL URL is absent at runtime.
if (process.env.NINE_ROUTER_DATABASE_URL) {
  setImmediate(() => {
    ensureOutboundProxyInitialized().catch(console.log);
  });
}

export default ensureOutboundProxyInitialized;
