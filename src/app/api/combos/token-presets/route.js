import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { DEFAULT_TOKEN_RULE_PRESETS, getTokenRulePresets, normalizeTokenRulePreset } from "@/shared/tokenRules.js";

export const dynamic = "force-dynamic";

function response(presets) {
  return NextResponse.json({ presets: getTokenRulePresets(presets) });
}

export async function GET() {
  try {
    const settings = await getSettings();
    return response(settings.tokenRulePresets);
  } catch (error) {
    console.log("Error loading token rule presets:", error);
    return NextResponse.json({ error: "Failed to load token rule presets" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const preset = normalizeTokenRulePreset({ ...body, id: crypto.randomUUID() });
    if (!preset || (!preset.inputTokenRules.length && !preset.outputTokenRules.length)) {
      return NextResponse.json({ error: "A preset needs a name and at least one valid token rule" }, { status: 400 });
    }
    const settings = await getSettings();
    const custom = Array.isArray(settings.tokenRulePresets) ? settings.tokenRulePresets : [];
    const next = [...custom, preset];
    await updateSettings({ tokenRulePresets: next });
    return response(next);
  } catch (error) {
    console.log("Error saving token rule preset:", error);
    return NextResponse.json({ error: "Failed to save token rule preset" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || DEFAULT_TOKEN_RULE_PRESETS.some((preset) => preset.id === id)) {
      return NextResponse.json({ error: "This preset cannot be deleted" }, { status: 400 });
    }
    const settings = await getSettings();
    const custom = Array.isArray(settings.tokenRulePresets) ? settings.tokenRulePresets : [];
    const next = custom.filter((preset) => preset?.id !== id);
    await updateSettings({ tokenRulePresets: next });
    return response(next);
  } catch (error) {
    console.log("Error deleting token rule preset:", error);
    return NextResponse.json({ error: "Failed to delete token rule preset" }, { status: 500 });
  }
}
