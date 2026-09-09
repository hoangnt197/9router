// Self-hosted OpenAI-compatible TTS — POST {baseUrl}/v1/audio/speech.
//
// A SPECIAL_ADAPTER rather than a genericFormats handler on purpose: the generic
// dispatcher resolves baseUrl from the static registry entry
// (`synthesizeViaConfig` reads `cfg.baseUrl`) and never looks at the connection,
// which is exactly the limitation this provider exists to lift.
import { Buffer } from "node:buffer";
import {
  getSelfhostedTtsModel,
  SELFHOSTED_TTS_CONFIG,
} from "../../config/selfhostedTtsConfig.js";

export default {
  async synthesize(text, model, credentials, responseFormat = "mp3") {
    // Accept either providerSpecificData.baseUrl (how the custom embedding and
    // STT providers carry it) or a bare credentials.baseUrl (how the OpenAI TTS
    // adapter does), so a connection configured either way works.
    const raw = credentials?.providerSpecificData?.baseUrl
      || credentials?.baseUrl
      || SELFHOSTED_TTS_CONFIG.baseUrl;
    // Tolerate a baseUrl given as the full endpoint or with a trailing /v1 —
    // both are natural things to paste, and silently double-appending the path
    // would 404 with nothing pointing at the cause.
    const base = String(raw)
      .replace(/\/+$/, "")
      .replace(/\/v1\/audio\/speech$/, "")
      .replace(/\/v1$/, "");

    // The provider prefix is already stripped by getModelInfo. A bare value is
    // the model; an optional second path segment explicitly selects its voice.
    let ttsModel = SELFHOSTED_TTS_CONFIG.defaultModel;
    let explicitVoice;
    if (model) {
      const parts = String(model).split("/").filter(Boolean);
      if (parts.length >= 2) {
        ttsModel = parts[0];
        explicitVoice = parts.slice(1).join("/");
      } else if (parts.length === 1) {
        ttsModel = parts[0];
      }
    }
    const voice = explicitVoice || getSelfhostedTtsModel(ttsModel)?.defaultVoice;

    const requestBody = {
      model: ttsModel,
      input: text,
      response_format: responseFormat,
    };
    if (voice) requestBody.voice = voice;

    const res = await fetch(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credentials?.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Self-hosted TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: responseFormat };
  },
};
