// Compatibility shim → PostgreSQL persistence layer (src/lib/db/).
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "@/lib/db/index.js";
