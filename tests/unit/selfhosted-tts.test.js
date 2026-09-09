import { afterEach, describe, expect, it, vi } from "vitest";

import selfhostedTts from "../../open-sse/handlers/ttsProviders/selfhostedTts.js";

const credentials = {
  apiKey: "gateway-key",
  providerSpecificData: { baseUrl: "http://tts.internal" },
};

function mockAudioResponse() {
  global.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
}

function requestBody() {
  return JSON.parse(global.fetch.mock.calls[0][1].body);
}

describe("self-hosted TTS model defaults", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not send the English Kokoro voice for the bare Vietnamese model", async () => {
    mockAudioResponse();

    await selfhostedTts.synthesize("Xin chào", "shortlab-tts-vi", credentials);

    expect(requestBody()).toEqual({
      model: "shortlab-tts-vi",
      input: "Xin chào",
      response_format: "mp3",
    });
  });

  it("sends an explicitly selected voice", async () => {
    mockAudioResponse();

    await selfhostedTts.synthesize("Xin chào", "shortlab-tts-vi/vi_female_1", credentials);

    expect(requestBody()).toMatchObject({
      model: "shortlab-tts-vi",
      voice: "vi_female_1",
    });
  });

  it("uses the configured Kokoro default for the bare English model", async () => {
    mockAudioResponse();

    await selfhostedTts.synthesize("Hello", "shortlab-tts-en", credentials);

    expect(requestBody()).toMatchObject({
      model: "shortlab-tts-en",
      voice: "af_heart",
    });
  });
});
