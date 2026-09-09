import { SELFHOSTED_TTS_CONFIG } from "../../config/selfhostedTtsConfig.js";

// Self-hosted, OpenAI-compatible text-to-speech — the TTS counterpart of
// selfhosted-stt.
//
// Unlike the fixed-localhost providers, this provider gets both its base URL and
// gateway credential from the connection. That keeps the TTS host private and
// lets the gateway move without changing client-facing model IDs.
export default {
  id: "selfhosted-tts",
  priority: 50,
  hasFree: true,
  alias: "selfhosted-tts",
  display: {
    name: "Self-hosted TTS",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "TT",
    website: "https://github.com/remsky/Kokoro-FastAPI",
  },
  category: "apikey",
  auth: {
    apiKey: {
      text: "Set providerSpecificData.baseUrl to the private gateway root, e.g. http://127.0.0.1:23336. The API key authenticates that gateway.",
    },
  },
  models: SELFHOSTED_TTS_CONFIG.models.map(({ id, name, params }) => ({ id, name, params, kind: "tts" })),
  serviceKinds: ["tts"],
  ttsConfig: {
    // Overridden per connection by providerSpecificData.baseUrl; the fallback is
    // retained only for a same-host development install.
    baseUrl: SELFHOSTED_TTS_CONFIG.baseUrl,
    defaultModel: SELFHOSTED_TTS_CONFIG.defaultModel,
    authType: "apikey",
    format: "openai-speech",
    models: SELFHOSTED_TTS_CONFIG.models.map(({ id, name }) => ({ id, name })),
  },
};
