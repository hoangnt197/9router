// Public PostgreSQL persistence API.
import { getAdapter } from "./driver.js";

export { getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings } from "./repos/settingsRepo.js";
export { getProviderConnections, getProviderConnectionById, createProviderConnection, updateProviderConnection, deleteProviderConnection, deleteProviderConnectionsByProvider, reorderProviderConnections, cleanupProviderConnections } from "./repos/connectionsRepo.js";
export { getProviderNodes, getProviderNodeById, createProviderNode, updateProviderNode, deleteProviderNode } from "./repos/nodesRepo.js";
export { getProxyPools, getProxyPoolById, createProxyPool, updateProxyPool, deleteProxyPool } from "./repos/proxyPoolsRepo.js";
export { getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey } from "./repos/apiKeysRepo.js";
export { getCombos, getComboById, getComboByName, createCombo, updateCombo, deleteCombo } from "./repos/combosRepo.js";
export { getModelAliases, setModelAlias, deleteModelAlias, getCustomModels, addCustomModel, deleteCustomModel, getMitmAlias, setMitmAliasAll } from "./repos/aliasRepo.js";
export { getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing } from "./repos/pricingRepo.js";
export { getDisabledModels, getDisabledByProvider, disableModels, enableModels } from "./repos/disabledModelsRepo.js";
export { statsEmitter, trackPendingRequest, getActiveRequests, saveRequestUsage, getUsageHistory, getUsageStats, getChartData, appendRequestLog, getRecentLogs } from "./repos/usageRepo.js";
export { saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders } from "./repos/requestDetailsRepo.js";

export async function initDb() {
  await getAdapter();
}
