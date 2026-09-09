"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Input from "./Input";
import Button from "./Button";
import ModelSelectModal from "./ModelSelectModal";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

function lookupSystemPrice(modelStr, systemPricing) {
  if (!modelStr || !systemPricing) return null;
  const slash = modelStr.indexOf("/");
  if (slash > 0) {
    const provider = modelStr.slice(0, slash);
    const model = modelStr.slice(slash + 1);
    if (systemPricing[provider]?.[model]?.input !== undefined) {
      return systemPricing[provider][model].input;
    }
  }
  for (const models of Object.values(systemPricing)) {
    if (models?.[modelStr]?.input !== undefined) {
      return models[modelStr].input;
    }
  }
  return null;
}

// Inline editable model item with pricing and scheduling configuration
function ModelItem({
  index,
  item,
  isFirst,
  isLast,
  systemPricing,
  onEditModel,
  onEditConfig,
  onMoveUp,
  onMoveDown,
  onRemove,
}) {
  const [editingName, setEditingName] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("pricing"); // "pricing" | "tokens" | "compress" | "schedule"

  const modelName = typeof item === "object" ? item.model : item;
  const pricingType = (typeof item === "object" && (item.pricingType === "token" || item.pricingType === "input_token")) ? "token" : "request";
  const price = (typeof item === "object" && item.price !== null && item.price !== undefined) ? item.price : "";
  const minPrice = (typeof item === "object" && item.minPrice !== null && item.minPrice !== undefined) ? item.minPrice : "";
  const maxInputTokens = (typeof item === "object" && item.maxInputTokens !== null && item.maxInputTokens !== undefined) ? item.maxInputTokens : "";
  const headroomMinInputTokens = (typeof item === "object" && item.headroomMinInputTokens !== null && item.headroomMinInputTokens !== undefined) ? item.headroomMinInputTokens : "";
  const inputTokenMultiplier = (typeof item === "object" && item.inputTokenMultiplier !== null && item.inputTokenMultiplier !== undefined) ? item.inputTokenMultiplier : "";
  const inputTokenMultiplierPercent = (typeof item === "object" && item.inputTokenMultiplierPercent !== null && item.inputTokenMultiplierPercent !== undefined) ? item.inputTokenMultiplierPercent : "";
  const inputTokenMultiplierMax = (typeof item === "object" && item.inputTokenMultiplierMax !== null && item.inputTokenMultiplierMax !== undefined) ? item.inputTokenMultiplierMax : "";
  const outputTokenMultiplier = (typeof item === "object" && item.outputTokenMultiplier !== null && item.outputTokenMultiplier !== undefined) ? item.outputTokenMultiplier : "";
  const outputTokenMultiplierPercent = (typeof item === "object" && item.outputTokenMultiplierPercent !== null && item.outputTokenMultiplierPercent !== undefined) ? item.outputTokenMultiplierPercent : "";
  const outputTokenMultiplierMax = (typeof item === "object" && item.outputTokenMultiplierMax !== null && item.outputTokenMultiplierMax !== undefined) ? item.outputTokenMultiplierMax : "";

  const timeSchedule = (typeof item === "object" && item.timeSchedule) || {
    enabled: false,
    startTime: "00:00",
    endTime: "23:59",
  };
  const isScheduleEnabled = !!timeSchedule.enabled;
  const scheduleStartTime = timeSchedule.startTime || "00:00";
  const scheduleEndTime = timeSchedule.endTime || "23:59";

  const [draftName, setDraftName] = useState(modelName);

  const commitName = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== modelName) onEditModel(trimmed);
    else setDraftName(modelName);
    setEditingName(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commitName();
    if (e.key === "Escape") {
      setDraftName(modelName);
      setEditingName(false);
    }
  };

  const hasPrice = price !== "" && price !== null && price !== undefined && Number(price) >= 0;
  const hasMaxInputTokens = maxInputTokens !== "" && Number(maxInputTokens) > 0;
  const hasHeadroomThreshold = headroomMinInputTokens !== "" && Number(headroomMinInputTokens) > 0;
  const hasTokenRules = (Number(inputTokenMultiplier) > 1 && Number(inputTokenMultiplierPercent) > 0)
    || (Number(outputTokenMultiplier) > 1 && Number(outputTokenMultiplierPercent) > 0);
  const priceLabel = hasPrice
    ? pricingType === "token"
      ? `$${price}/1M tok${minPrice !== "" && Number(minPrice) > 0 ? ` (min $${minPrice})` : ""}`
      : `$${price}/req`
    : "No price";

  const handleAutoFill = () => {
    const sysInputPrice = lookupSystemPrice(modelName, systemPricing);
    if (sysInputPrice !== null && sysInputPrice !== undefined) {
      onEditConfig({
        pricingType: "token",
        price: sysInputPrice,
        minPrice: minPrice || 0,
      });
      setExpanded(true);
      setActiveTab("pricing");
    }
  };

  const systemPriceAvailable = lookupSystemPrice(modelName, systemPricing) !== null;

  return (
    <div className="flex flex-col rounded-lg border border-black/5 bg-black/[0.02] p-2.5 transition-all hover:border-black/10 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-white/10">
      {/* Top Row: Index, Model Name (Full breathing room), and Actions */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-muted w-4 text-center shrink-0">{index + 1}</span>
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={handleKeyDown}
              className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-2 py-0.5 font-mono text-xs text-text-main outline-none dark:bg-black/20"
            />
          ) : (
            <div
              className="min-w-0 flex-1 cursor-text font-mono text-xs font-semibold text-text-main hover:text-primary transition-colors break-all line-clamp-2"
              onClick={() => setEditingName(true)}
              title="Click to edit name"
            >
              {modelName}
            </div>
          )}
        </div>

        {/* Right controls: Config toggle button + Reorder + Delete */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              expanded
                ? "bg-primary text-white shadow-xs"
                : (hasPrice || hasMaxInputTokens || hasHeadroomThreshold || hasTokenRules || isScheduleEnabled)
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "bg-black/5 text-text-muted hover:text-text-main hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
            }`}
            title="Configure pricing and schedule"
          >
            <span className="material-symbols-outlined text-[14px]">tune</span>
            <span>Config</span>
            <span className="material-symbols-outlined text-[12px] opacity-70">
              {expanded ? "expand_less" : "expand_more"}
            </span>
          </button>

          <div className="flex items-center gap-0.5 border-l border-black/10 dark:border-white/10 pl-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={isFirst}
              className={`p-1 rounded ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
              title="Move up"
            >
              <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={isLast}
              className={`p-1 rounded ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
              title="Move down"
            >
              <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="p-1 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-all"
              title="Remove model"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>
        </div>
      </div>

      {/* Badges row: Price and Schedule */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
        <button
          type="button"
          onClick={() => { setExpanded(true); setActiveTab("pricing"); }}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
            hasPrice
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium hover:bg-emerald-500/20"
              : "bg-black/5 text-text-muted hover:text-text-main dark:bg-white/5"
          }`}
          title="Click to edit pricing"
        >
          <span className="material-symbols-outlined text-[11px]">payments</span>
          <span>{priceLabel}</span>
        </button>

        {hasMaxInputTokens && (
          <button
            type="button"
            onClick={() => { setExpanded(true); setActiveTab("pricing"); }}
            className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-mono font-medium text-sky-600 hover:bg-sky-500/20 dark:text-sky-400"
            title="Maximum estimated input tokens for this model"
          >
            <span className="material-symbols-outlined text-[11px]">data_usage</span>
            <span>≤ {Number(maxInputTokens).toLocaleString()} input</span>
          </button>
        )}

        {hasTokenRules && (
          <button
            type="button"
            onClick={() => { setExpanded(true); setActiveTab("tokens"); }}
            className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
            title="Client response token multiplier"
          >
            <span className="material-symbols-outlined text-[11px]">functions</span>
            <span>Tokens</span>
          </button>
        )}

        {hasHeadroomThreshold && (
          <button
            type="button"
            onClick={() => { setExpanded(true); setActiveTab("compress"); }}
            className="inline-flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-mono font-medium text-cyan-600 hover:bg-cyan-500/20 dark:text-cyan-400"
            title="Compress when estimated input exceeds this threshold"
          >
            <span className="material-symbols-outlined text-[11px]">compress</span>
            <span>&gt; {Number(headroomMinInputTokens).toLocaleString()} in</span>
          </button>
        )}

        {isScheduleEnabled && (
          <button
            type="button"
            onClick={() => { setExpanded(true); setActiveTab("schedule"); }}
            className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-mono text-purple-600 dark:text-purple-400 font-medium hover:bg-purple-500/20"
            title={`Active hours (VN UTC+7): ${scheduleStartTime} - ${scheduleEndTime}`}
          >
            <span className="material-symbols-outlined text-[11px]">schedule</span>
            <span>⏰ {scheduleStartTime} - {scheduleEndTime}</span>
          </button>
        )}
      </div>

      {/* Expanded Configuration Tabs (Pricing & Schedule) */}
      {expanded && (
        <div className="mt-2.5 rounded-md border border-black/5 bg-white/70 p-2.5 dark:border-white/5 dark:bg-black/40">
          {/* Tabs header */}
          <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-2 mb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("pricing")}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === "pricing"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">payments</span>
                Pricing
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("tokens")}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === "tokens"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">functions</span>
                Tokens
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("compress")}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === "compress"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">compress</span>
                Compress
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("schedule")}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === "schedule"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                Schedule (VN)
                {isScheduleEnabled && (
                  <span className="size-1.5 rounded-full bg-purple-500" />
                )}
              </button>
            </div>

            {activeTab === "pricing" && systemPriceAvailable && (
              <button
                type="button"
                onClick={handleAutoFill}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                title="Fill pricing from system pricing table"
              >
                <span className="material-symbols-outlined text-[12px]">auto_fix_high</span>
                Suggest from System
              </button>
            )}
          </div>

          {/* Pricing Tab */}
          {activeTab === "pricing" && (
            <div>
              <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-0.5 rounded w-fit mb-2">
                <button
                  type="button"
                  onClick={() => onEditConfig({ pricingType: "request" })}
                  className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                    pricingType === "request"
                      ? "bg-white text-primary shadow-xs dark:bg-zinc-800 dark:text-white"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Per Request
                </button>
                <button
                  type="button"
                  onClick={() => onEditConfig({ pricingType: "token" })}
                  className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                    pricingType === "token"
                      ? "bg-white text-primary shadow-xs dark:bg-zinc-800 dark:text-white"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Per Input Token
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-medium text-text-muted block mb-0.5">
                    {pricingType === "token" ? "Price ($ / 1M Input Tokens)" : "Price ($ / Request)"}
                  </label>
                  <div className="flex items-stretch">
                    <span className="inline-flex items-center px-1.5 rounded-l border border-r-0 border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.04] text-text-muted font-mono text-xs">$</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={price}
                      onChange={(e) => onEditConfig({ price: e.target.value })}
                      className="w-full rounded-r border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {pricingType === "token" && (
                  <div>
                    <label className="text-[10px] font-medium text-text-muted block mb-0.5">
                      Min Price ($ / Request)
                    </label>
                    <div className="flex items-stretch">
                      <span className="inline-flex items-center px-1.5 rounded-l border border-r-0 border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.04] text-text-muted font-mono text-xs">$</span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0.00"
                        value={minPrice}
                        onChange={(e) => onEditConfig({ minPrice: e.target.value })}
                        className="w-full rounded-r border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-medium text-text-muted block mb-0.5">
                    Max Input Tokens
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    placeholder="No limit"
                    value={maxInputTokens}
                    onChange={(e) => onEditConfig({ maxInputTokens: e.target.value })}
                    className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>
              <p className="text-[9px] text-text-muted mt-1.5 italic">
                {pricingType === "token"
                  ? "Cost = max(Min Price, (Input Tokens / 1,000,000) * Price)"
                  : "Fixed cost per request. Leave empty if unpriced (ranked last in Lowest Cost)."}
                {" Max Input Tokens is optional; models below this capacity are deferred until compatible models fail."}
              </p>
            </div>
          )}

          {activeTab === "tokens" && (
            <div className="space-y-3">
              <p className="text-[10px] text-text-muted">Only changes token usage returned to the client. Reports and cost keep upstream usage.</p>
              {[
                ["Input", "inputTokenMultiplier", inputTokenMultiplier, "inputTokenMultiplierPercent", inputTokenMultiplierPercent, "inputTokenMultiplierMax", inputTokenMultiplierMax],
                ["Output", "outputTokenMultiplier", outputTokenMultiplier, "outputTokenMultiplierPercent", outputTokenMultiplierPercent, "outputTokenMultiplierMax", outputTokenMultiplierMax],
              ].map(([label, multiplierKey, multiplier, percentKey, percent, maxKey, max]) => (
                <div key={label} className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-text-muted block mb-0.5">{label} ×</label>
                    <input type="number" step="1" min="2" placeholder="Off" value={multiplier}
                      onChange={(e) => onEditConfig({ [multiplierKey]: e.target.value })}
                      className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-text-muted block mb-0.5">Chance %</label>
                    <input type="number" step="1" min="0" max="100" placeholder="100" value={percent}
                      onChange={(e) => onEditConfig({ [percentKey]: e.target.value })}
                      className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-text-muted block mb-0.5">Cap</label>
                    <input type="number" step="1" min="1" placeholder="No cap" value={max}
                      onChange={(e) => onEditConfig({ [maxKey]: e.target.value })}
                      className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary" />
                  </div>
                </div>
              ))}
              <p className="text-[9px] text-text-muted italic">Input cache fields use the same applied input factor. Totals are recalculated per response format. Cap limits multiplication only: 4 tokens, ×5, cap 10 → ×2 = 8.</p>
            </div>
          )}

          {activeTab === "compress" && (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-medium text-text-muted block mb-0.5">
                  Compress &gt; input
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  placeholder="Off"
                  value={headroomMinInputTokens}
                  onChange={(e) => onEditConfig({ headroomMinInputTokens: e.target.value })}
                  className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                />
              </div>
              <p className="text-[9px] text-text-muted italic">
                Headroom runs only when estimated input is above this value. Each fallback model uses its own threshold.
              </p>
            </div>
          )}

          {/* Time Schedule Tab */}
          {activeTab === "schedule" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-text-main">
                    Active Time Schedule (Vietnam UTC+7)
                  </div>
                  <div className="text-[10px] text-text-muted">
                    Model will only be used within these hours. Outside these hours, it is skipped.
                  </div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={isScheduleEnabled}
                    onChange={(e) =>
                      onEditConfig({
                        timeSchedule: {
                          ...timeSchedule,
                          enabled: e.target.checked,
                          startTime: scheduleStartTime,
                          endTime: scheduleEndTime,
                        },
                      })
                    }
                    className="peer sr-only"
                  />
                  <div className="peer h-5 w-9 rounded-full bg-black/10 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full dark:bg-white/10" />
                </label>
              </div>

              {isScheduleEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-text-muted block mb-0.5">
                        Start Time (HH:mm)
                      </label>
                      <input
                        type="time"
                        value={scheduleStartTime}
                        onChange={(e) =>
                          onEditConfig({
                            timeSchedule: {
                              ...timeSchedule,
                              enabled: true,
                              startTime: e.target.value,
                            },
                          })
                        }
                        className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-text-muted block mb-0.5">
                        End Time (HH:mm)
                      </label>
                      <input
                        type="time"
                        value={scheduleEndTime}
                        onChange={(e) =>
                          onEditConfig({
                            timeSchedule: {
                              ...timeSchedule,
                              enabled: true,
                              endTime: e.target.value,
                            },
                          })
                        }
                        className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[9px] text-text-muted">Quick presets:</span>
                    {[
                      { label: "Night (01:00 - 05:00)", start: "01:00", end: "05:00" },
                      { label: "Late Night (00:00 - 06:00)", start: "00:00", end: "06:00" },
                      { label: "Working Hours (08:00 - 17:00)", start: "08:00", end: "17:00" },
                      { label: "Evening (18:00 - 23:00)", start: "18:00", end: "23:00" },
                      { label: "Overnight (22:00 - 06:00)", start: "22:00", end: "06:00" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          onEditConfig({
                            timeSchedule: {
                              enabled: true,
                              startTime: preset.start,
                              endTime: preset.end,
                            },
                          })
                        }
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                          scheduleStartTime === preset.start && scheduleEndTime === preset.end
                            ? "bg-purple-500/20 text-purple-600 dark:text-purple-300 font-medium"
                            : "bg-black/5 text-text-muted hover:text-text-main dark:bg-white/5"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Reusable Combo create/edit modal. forcePrefix auto-prepends to name.
export default function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null, forcePrefix = "", title }) {
  const initialName = combo?.name
    ? (forcePrefix && combo.name.startsWith(forcePrefix) ? combo.name.slice(forcePrefix.length) : combo.name)
    : "";
  const [name, setName] = useState(initialName);

  // Normalize initial models to array of objects
  const initialModels = (combo?.models || []).map((m) => {
    if (typeof m === "string") {
      return {
        model: m,
        pricingType: "request",
        price: "",
        minPrice: "",
        maxInputTokens: "",
        headroomMinInputTokens: "",
        inputTokenMultiplier: "",
        inputTokenMultiplierPercent: "",
        inputTokenMultiplierMax: "",
        outputTokenMultiplier: "",
        outputTokenMultiplierPercent: "",
        outputTokenMultiplierMax: "",
        timeSchedule: {
          enabled: false,
          startTime: "00:00",
          endTime: "23:59",
        },
      };
    }
    return {
      model: m.model || "",
      pricingType: m.pricingType === "token" || m.pricingType === "input_token" ? "token" : "request",
      price: m.price !== undefined && m.price !== null ? m.price : "",
      minPrice: m.minPrice !== undefined && m.minPrice !== null ? m.minPrice : "",
      maxInputTokens: m.maxInputTokens !== undefined && m.maxInputTokens !== null ? m.maxInputTokens : "",
      headroomMinInputTokens: m.headroomMinInputTokens !== undefined && m.headroomMinInputTokens !== null ? m.headroomMinInputTokens : "",
      inputTokenMultiplier: m.inputTokenMultiplier !== undefined && m.inputTokenMultiplier !== null ? m.inputTokenMultiplier : "",
      inputTokenMultiplierPercent: m.inputTokenMultiplierPercent !== undefined && m.inputTokenMultiplierPercent !== null ? m.inputTokenMultiplierPercent : "",
      inputTokenMultiplierMax: m.inputTokenMultiplierMax !== undefined && m.inputTokenMultiplierMax !== null ? m.inputTokenMultiplierMax : "",
      outputTokenMultiplier: m.outputTokenMultiplier !== undefined && m.outputTokenMultiplier !== null ? m.outputTokenMultiplier : "",
      outputTokenMultiplierPercent: m.outputTokenMultiplierPercent !== undefined && m.outputTokenMultiplierPercent !== null ? m.outputTokenMultiplierPercent : "",
      outputTokenMultiplierMax: m.outputTokenMultiplierMax !== undefined && m.outputTokenMultiplierMax !== null ? m.outputTokenMultiplierMax : "",
      timeSchedule: m.timeSchedule && typeof m.timeSchedule === "object" ? {
        enabled: !!m.timeSchedule.enabled,
        startTime: m.timeSchedule.startTime || "00:00",
        endTime: m.timeSchedule.endTime || "23:59",
      } : {
        enabled: false,
        startTime: "00:00",
        endTime: "23:59",
      },
    };
  });

  const [models, setModels] = useState(initialModels);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [systemPricing, setSystemPricing] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/models/alias").then((r) => r.ok ? r.json() : null).then((d) => d && setModelAliases(d.aliases || {})).catch(() => {});
    fetch("/api/pricing").then((r) => r.ok ? r.json() : null).then((d) => d && setSystemPricing(d || {})).catch(() => {});
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) { setNameError("Name is required"); return false; }
    const full = forcePrefix + value;
    if (!VALID_NAME_REGEX.test(full)) { setNameError("Only letters, numbers, -, _ and . allowed"); return false; }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    let value = e.target.value;
    if (forcePrefix && value.startsWith(forcePrefix)) value = value.slice(forcePrefix.length);
    setName(value);
    if (value) validateName(value); else setNameError("");
  };

  const handleAddModel = (model) => {
    const val = model.value;
    if (!models.some((m) => m.model === val)) {
      const sysPrice = lookupSystemPrice(val, systemPricing);
      const newItem = {
        model: val,
        pricingType: sysPrice !== null ? "token" : "request",
        price: sysPrice !== null ? sysPrice : "",
        minPrice: "",
        maxInputTokens: "",
        headroomMinInputTokens: "",
        inputTokenMultiplier: "",
        inputTokenMultiplierPercent: "",
        inputTokenMultiplierMax: "",
        outputTokenMultiplier: "",
        outputTokenMultiplierPercent: "",
        outputTokenMultiplierMax: "",
        timeSchedule: {
          enabled: false,
          startTime: "00:00",
          endTime: "23:59",
        },
      };
      setModels([...models, newItem]);
    }
  };

  const handleDeselectModel = (model) => {
    setModels(models.filter((m) => m.model !== model.value));
  };

  const handleRemoveModel = (i) => setModels(models.filter((_, idx) => idx !== i));

  const handleMoveUp = (i) => {
    if (i === 0) return;
    const a = [...models]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setModels(a);
  };

  const handleMoveDown = (i) => {
    if (i === models.length - 1) return;
    const a = [...models]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; setModels(a);
  };

  const handleEditModelName = (i, newName) => {
    const a = [...models];
    a[i] = { ...a[i], model: newName };
    setModels(a);
  };

  const handleEditModelConfig = (i, patch) => {
    const a = [...models];
    a[i] = { ...a[i], ...patch };
    setModels(a);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);

    // Format models for saving
    const cleanedModels = models.map((m) => ({
      model: m.model.trim(),
      pricingType: m.pricingType || "request",
      price: m.price !== "" && m.price !== null && m.price !== undefined ? parseFloat(m.price) : null,
      minPrice: m.minPrice !== "" && m.minPrice !== null && m.minPrice !== undefined ? parseFloat(m.minPrice) : null,
      maxInputTokens: m.maxInputTokens !== "" && m.maxInputTokens !== null && m.maxInputTokens !== undefined ? Math.floor(Number(m.maxInputTokens)) : null,
      headroomMinInputTokens: m.headroomMinInputTokens !== "" && m.headroomMinInputTokens !== null && m.headroomMinInputTokens !== undefined && Number(m.headroomMinInputTokens) > 0 ? Math.floor(Number(m.headroomMinInputTokens)) : null,
      inputTokenMultiplier: Number(m.inputTokenMultiplier) > 1 ? Math.floor(Number(m.inputTokenMultiplier)) : null,
      inputTokenMultiplierPercent: Number(m.inputTokenMultiplierPercent) > 0 ? Math.min(100, Number(m.inputTokenMultiplierPercent)) : null,
      inputTokenMultiplierMax: Number(m.inputTokenMultiplierMax) > 0 ? Math.floor(Number(m.inputTokenMultiplierMax)) : null,
      outputTokenMultiplier: Number(m.outputTokenMultiplier) > 1 ? Math.floor(Number(m.outputTokenMultiplier)) : null,
      outputTokenMultiplierPercent: Number(m.outputTokenMultiplierPercent) > 0 ? Math.min(100, Number(m.outputTokenMultiplierPercent)) : null,
      outputTokenMultiplierMax: Number(m.outputTokenMultiplierMax) > 0 ? Math.floor(Number(m.outputTokenMultiplierMax)) : null,
      timeSchedule: m.timeSchedule ? {
        enabled: !!m.timeSchedule.enabled,
        startTime: m.timeSchedule.startTime || "00:00",
        endTime: m.timeSchedule.endTime || "23:59",
      } : {
        enabled: false,
        startTime: "00:00",
        endTime: "23:59",
      },
    }));

    await onSave({ name: forcePrefix + name.trim(), models: cleanedModels });
    setSaving(false);
  };

  const isEdit = !!combo;
  const addedModelNames = models.map((m) => m.model);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg" title={title || (isEdit ? "Edit Combo" : "Create Combo")}>
        <div className="flex flex-col gap-3">
          <div>
            {forcePrefix ? (
              <>
                <label className="text-sm font-medium mb-1 block">Combo Name</label>
                <div className="flex items-stretch">
                  <span className="inline-flex items-center px-2 rounded-l border border-r-0 border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.04] text-text-muted font-mono text-sm">{forcePrefix}</span>
                  <input value={name} onChange={handleNameChange} placeholder="my-combo"
                    className="flex-1 min-w-0 rounded-r border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1.5 font-mono text-sm outline-none focus:border-primary" />
                </div>
                {nameError && <p className="text-[11px] text-red-500 mt-0.5">{nameError}</p>}
              </>
            ) : (
              <Input label="Combo Name" value={name} onChange={handleNameChange} placeholder="my-combo" error={nameError} />
            )}
            <p className="text-[10px] text-text-muted mt-0.5">
              {forcePrefix ? `Auto-prefixed with "${forcePrefix}". ` : ""}Only letters, numbers, -, _ and . allowed
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium">Models, Pricing & Rules</label>
              <span className="text-[11px] text-text-muted">{models.length} model{models.length !== 1 ? "s" : ""}</span>
            </div>
            {models.length === 0 ? (
              <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                <span className="material-symbols-outlined text-text-muted text-xl mb-1">layers</span>
                <p className="text-xs text-text-muted">No models added yet</p>
              </div>
            ) : (
              <div className="flex max-h-[55vh] min-w-0 flex-col gap-2 overflow-y-auto sm:max-h-[380px] pr-0.5">
                {models.map((item, index) => (
                  <ModelItem
                    key={index}
                    index={index}
                    item={item}
                    systemPricing={systemPricing}
                    isFirst={index === 0}
                    isLast={index === models.length - 1}
                    onEditModel={(newName) => handleEditModelName(index, newName)}
                    onEditConfig={(patch) => handleEditModelConfig(index, patch)}
                    onMoveUp={() => handleMoveUp(index)}
                    onMoveDown={() => handleMoveDown(index)}
                    onRemove={() => handleRemoveModel(index)}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowModelSelect(true)}
              className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add Model
            </button>
          </div>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
            <Button onClick={handleSave} fullWidth size="sm" disabled={!name.trim() || !!nameError || saving}>
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Add Model to Combo"
          kindFilter={kindFilter}
          addedModelValues={addedModelNames}
          closeOnSelect={false}
        />
      )}
    </>
  );
}
