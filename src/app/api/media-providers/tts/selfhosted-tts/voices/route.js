import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

function languageName(code) {
  try { return LANGUAGE_NAMES.of(code); } catch { return code; }
}

function gatewayBaseUrl(connection) {
  const raw = connection?.providerSpecificData?.baseUrl || connection?.baseUrl;
  return raw ? String(raw).replace(/\/+$/, "") : null;
}

/**
 * GET /api/media-providers/tts/selfhosted-tts/voices?model=shortlab-tts-vi
 *
 * Retrieves the approved voice catalogue from Shortlab's private TTS gateway.
 * The dashboard never receives the gateway credential or its network address.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");
    const langFilter = searchParams.get("lang");
    const [connection] = await getProviderConnections({ provider: "selfhosted-tts", isActive: true });
    const baseUrl = gatewayBaseUrl(connection);

    if (!connection?.apiKey || !baseUrl) {
      return NextResponse.json({ error: "No active self-hosted TTS connection found" }, { status: 400 });
    }

    const query = new URLSearchParams();
    if (model) query.set("model", model);
    if (langFilter) query.set("language", langFilter);
    const response = await fetch(`${baseUrl}/v1/audio/voices${query.size ? `?${query}` : ""}`, {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error?.message || `Private TTS gateway returned ${response.status}` },
        { status: 502 },
      );
    }

    const byLang = {};
    for (const voice of Array.isArray(payload?.data) ? payload.data : []) {
      if (!voice?.id || !voice?.language) continue;
      const code = voice.language;
      if (!byLang[code]) byLang[code] = { code, name: languageName(code), voices: [] };
      byLang[code].voices.push({
        id: voice.id,
        name: voice.name || voice.id,
        lang: code,
        model: voice.model,
      });
    }

    const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));
    if (langFilter) return NextResponse.json({ voices: byLang[langFilter]?.voices || [] });
    return NextResponse.json({ languages, byLang });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to fetch self-hosted TTS voices" }, { status: 502 });
  }
}
