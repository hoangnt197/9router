// Request-detail payloads can contain large prompts and tool traces. They are
// intentionally not persisted in the scaled PostgreSQL deployment: aggregate
// usage remains available, while removing this write-heavy observability path
// avoids retention and cross-instance coordination costs.

export async function saveRequestDetail() {
  return null;
}

export async function getRequestDetails() {
  return { records: [], total: 0, page: 1, pageSize: 0 };
}

export async function getRequestDetailById() {
  return null;
}

export async function getDistinctProviders() {
  return [];
}
