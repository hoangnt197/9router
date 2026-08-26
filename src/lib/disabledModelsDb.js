// Compatibility shim → PostgreSQL persistence layer (src/lib/db/).
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "@/lib/db/index.js";
