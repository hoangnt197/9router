import { NextResponse } from "next/server";
import { checkModeration } from "@/sse/services/moderationFilter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/settings/moderation-test
 *
 * Validates that the supplied moderation configuration can reach the upstream
 * v1/moderations endpoint and returns a valid response.
 *
 * Body: { baseUrl, apiKey, model, timeoutMs?, testInput? }
 * Response:
 *   ok: true  → { ok: true, flagged: boolean, categories: string[] }
 *   ok: false → { ok: false, error: string }
 */
export async function POST(request) {
  try {
    const body = await request.json();

    const baseUrl   = (body?.baseUrl   || "https://api.openai.com/v1").trim();
    const apiKey    = (body?.apiKey    || "").trim();
    const model     = (body?.model     || "omni-moderation-latest").trim();
    const timeoutMs = Number(body?.timeoutMs) || 5000;
    const testInput = typeof body?.testInput === "string" && body.testInput.trim()
      ? body.testInput.trim()
      : "Hello, this is a moderation connectivity test.";

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "API Key is required" }, { status: 400 });
    }

    const mockSettings = { moderationBaseUrl: baseUrl, moderationApiKey: apiKey, moderationModel: model, moderationTimeoutMs: timeoutMs };
    const result = await checkModeration(testInput, mockSettings);

    if (result.error && !result.blocked) {
      // checkModeration is fail-open, but here we surface the error to the caller
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      flagged: result.blocked,
      categories: result.categories || [],
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

