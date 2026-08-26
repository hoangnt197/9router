import { stripThinkingSuffix } from "./thinkingUnified.js";

// Build OpenAI chat.completion.chunk. Caller supplies id/created/model so each
// translator keeps its exact id-generation + created semantics (no Date.now here).
export function buildChunk({ id, created, model }, delta, finishReason = null) {
  let cleanModel = model;
  if (typeof cleanModel === "string") {
    if (cleanModel.includes("/")) {
      cleanModel = cleanModel.slice(cleanModel.indexOf("/") + 1);
    }
    cleanModel = stripThinkingSuffix(cleanModel);
  }
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model: cleanModel,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
