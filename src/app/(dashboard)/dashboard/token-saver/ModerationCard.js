"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input, Toggle } from "@/shared/components";

/**
 * ModerationCard – manages the v1/moderations content filter settings.
 *
 * Rendered inside the Token Saver page so it lives alongside the other
 * pipeline-level request filters (RTK, Headroom, PXPIPE, Caveman…).
 */
export default function ModerationCard() {
  const [moderationEnabled, setModerationEnabled]       = useState(false);
  const [moderationBaseUrl, setModerationBaseUrl]       = useState("https://api.openai.com/v1");
  const [moderationApiKey, setModerationApiKey]         = useState("");
  const [moderationModel, setModerationModel]           = useState("omni-moderation-latest");
  const [moderationTimeoutMs, setModerationTimeoutMs]   = useState(3000);
  const [moderationTargetModels, setModerationTargetModels] = useState("gpt-*");
  const [moderationRefusalMessage, setModerationRefusalMessage] = useState("");

  const [showKey, setShowKey]         = useState(false);
  const [testing, setTesting]         = useState(false);
  const [testResult, setTestResult]   = useState(null); // { ok, flagged?, categories?, error? }
  const [saving, setSaving]           = useState(false);

  // -------------------------------------------------------------------------
  // Load settings on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setModerationEnabled(!!data.moderationEnabled);
        setModerationBaseUrl(data.moderationBaseUrl || "https://api.openai.com/v1");
        setModerationApiKey(data.moderationApiKey || "");
        setModerationModel(data.moderationModel || "omni-moderation-latest");
        if (typeof data.moderationTimeoutMs === "number") setModerationTimeoutMs(data.moderationTimeoutMs);
        setModerationTargetModels(data.moderationTargetModels || "gpt-*");
        setModerationRefusalMessage(data.moderationRefusalMessage || "");
      })
      .catch(() => {});
  }, []);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.warn("[ModerationCard] patchSetting error:", err?.message);
    }
  };

  const handleToggle = async (value) => {
    setModerationEnabled(value);
    await patchSetting({ moderationEnabled: value });
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await patchSetting({
        moderationBaseUrl: moderationBaseUrl.trim() || "https://api.openai.com/v1",
        moderationApiKey: moderationApiKey.trim(),
        moderationModel: moderationModel.trim() || "omni-moderation-latest",
        moderationTimeoutMs: Math.max(500, Number(moderationTimeoutMs) || 3000),
        moderationTargetModels: moderationTargetModels.trim() || "gpt-*",
        moderationRefusalMessage: moderationRefusalMessage.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/moderation-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: moderationBaseUrl.trim() || "https://api.openai.com/v1",
          apiKey: moderationApiKey.trim(),
          model: moderationModel.trim() || "omni-moderation-latest",
          timeoutMs: Math.max(500, Number(moderationTimeoutMs) || 5000),
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: err?.message || "Network error" });
    } finally {
      setTesting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Card id="content-moderation">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">shield</span>
          Content Moderation
        </h2>
      </div>

      {/* Master toggle row */}
      <div className="flex items-center justify-between py-4 border-b border-border gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Moderate prompts via v1/moderations</p>
          <p className="text-sm text-text-muted">
            Screens the latest user message against an OpenAI-compatible moderation
            API before forwarding to the LLM. Replaces the built-in regex content filter.
            Fails open — if the moderation API is unreachable, requests pass through.
          </p>
        </div>
        <Toggle checked={moderationEnabled} onChange={() => handleToggle(!moderationEnabled)} />
      </div>

      {/* Configuration (always visible so settings can be entered before enabling) */}
      <div className="mt-4 space-y-4">
        {/* Base URL */}
        <div>
          <label className="block text-xs font-medium mb-1">Moderation API Base URL</label>
          <Input
            value={moderationBaseUrl}
            onChange={(e) => setModerationBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">
            Must point to a server that implements <code>POST /moderations</code> (OpenAI-compatible).
          </p>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-medium mb-1">API Key</label>
          <div className="flex gap-2 items-center">
            <Input
              type={showKey ? "text" : "password"}
              value={moderationApiKey}
              onChange={(e) => setModerationApiKey(e.target.value)}
              placeholder="sk-…"
              className="font-mono text-sm flex-1"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="text-xs text-text-muted hover:text-text-main"
              title={showKey ? "Hide" : "Show"}
            >
              <span className="material-symbols-outlined text-base">{showKey ? "visibility_off" : "visibility"}</span>
            </button>
          </div>
        </div>

        {/* Model & Timeout row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Model</label>
            <Input
              value={moderationModel}
              onChange={(e) => setModerationModel(e.target.value)}
              placeholder="omni-moderation-latest"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Timeout (ms)</label>
            <Input
              type="number"
              min={500}
              step={500}
              value={moderationTimeoutMs}
              onChange={(e) => setModerationTimeoutMs(e.target.value)}
              placeholder="3000"
              className="font-mono text-sm"
            />
          </div>
        </div>

        {/* Target models pattern */}
        <div>
          <label className="block text-xs font-medium mb-1">Target Models (Mô hình áp dụng)</label>
          <Input
            value={moderationTargetModels}
            onChange={(e) => setModerationTargetModels(e.target.value)}
            placeholder="gpt-*"
            className="font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">
            Nhập pattern wildcard như <code>gpt-*</code> hoặc danh sách model phân cách bằng dấu phẩy như <code>gpt-4o, gpt-4o-mini, o1-*</code>. Nhập <code>*</code> nếu muốn áp dụng tất cả model.
          </p>
        </div>

        {/* Custom refusal message */}
        <div>
          <label className="block text-xs font-medium mb-1">
            Custom refusal message{" "}
            <span className="text-text-muted font-normal">(optional — leave blank for default)</span>
          </label>
          <textarea
            value={moderationRefusalMessage}
            onChange={(e) => setModerationRefusalMessage(e.target.value)}
            rows={2}
            placeholder="Xin lỗi, yêu cầu này không thể được hỗ trợ…"
            className="w-full rounded border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20 resize-none focus:outline-none"
          />
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`rounded p-3 text-sm ${
              testResult.ok ? "bg-success/10 text-success" : "bg-error/10 text-error"
            }`}
          >
            {testResult.ok ? (
              <>
                ✓ Connected. Test input was{" "}
                <strong>{testResult.flagged ? "flagged" : "not flagged"}</strong>
                {testResult.flagged && testResult.categories?.length > 0 && (
                  <> — categories: {testResult.categories.join(", ")}</>
                )}
                .
              </>
            ) : (
              <>✗ {testResult.error}</>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleTestConnection} variant="ghost" disabled={testing || !moderationApiKey.trim()}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={handleSaveConfig} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

