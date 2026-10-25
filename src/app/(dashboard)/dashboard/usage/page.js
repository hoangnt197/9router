"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [appliedRange, setAppliedRange] = useState(null);
  const [rangeError, setRangeError] = useState("");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  const applyDateRange = () => {
    if (!dateRange.startDate || !dateRange.endDate) {
      setRangeError("Chọn đủ thời gian bắt đầu và kết thúc.");
      return;
    }
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      setRangeError("Thời gian bắt đầu phải trước thời gian kết thúc.");
      return;
    }
    setRangeError("");
    setAppliedRange({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
  };

  const clearDateRange = () => {
    setDateRange({ startDate: "", endDate: "" });
    setAppliedRange(null);
    setRangeError("");
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-text-muted sm:w-44 sm:flex-none">
              Bắt đầu
              <input
                type="datetime-local"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-text-muted sm:w-44 sm:flex-none">
              Kết thúc
              <input
                type="datetime-local"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </label>
            <button
              type="button"
              onClick={applyDateRange}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90"
            >
              Áp dụng
            </button>
            {appliedRange && (
              <button
                type="button"
                onClick={clearDateRange}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text"
              >
                Xóa
              </button>
            )}
          </div>
        )}
      </div>

      {activeTab === "overview" && rangeError && (
        <p className="-mt-3 text-right text-xs text-error">{rangeError}</p>
      )}

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats range={appliedRange} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
