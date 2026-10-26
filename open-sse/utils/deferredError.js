const deferredErrors = new WeakMap();

export function attachDeferredError(response, detail) {
  if (response && typeof response === "object" && detail) deferredErrors.set(response, detail);
  return response;
}

export function takeDeferredError(response) {
  if (!response || typeof response !== "object") return null;
  const detail = deferredErrors.get(response) || null;
  deferredErrors.delete(response);
  return detail;
}
