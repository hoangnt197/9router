export const SELFHOSTED_TTS_CONFIG = Object.freeze({
  baseUrl: "http://localhost:8880",
  defaultModel: "shortlab-tts-vi",
  models: Object.freeze([
    Object.freeze({
      id: "shortlab-tts-vi",
      name: "Shortlab Vietnamese (VieNeu)",
      params: Object.freeze(["voice", "response_format"]),
    }),
    Object.freeze({
      id: "shortlab-tts-en",
      name: "Shortlab English (Kokoro)",
      defaultVoice: "af_heart",
      params: Object.freeze(["voice", "response_format", "speed"]),
    }),
  ]),
});

export function getSelfhostedTtsModel(modelId) {
  return SELFHOSTED_TTS_CONFIG.models.find(({ id }) => id === modelId);
}
