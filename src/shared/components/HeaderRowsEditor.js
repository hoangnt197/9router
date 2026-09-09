"use client";

import PropTypes from "prop-types";

const isSensitiveHeader = (name) => /authorization|cookie|secret|token|api[-_]?key/i.test(name);

export const headerRecordToRows = (record) => Object.entries(record || {})
  .map(([name, value]) => ({ name, value: String(value ?? "") }));

export const activeHeaderRows = (rows) => (rows || [])
  .filter(({ name, value }) => String(name || "").trim() || String(value || "").trim());

export const headerRowsToRecord = (rows) => Object.fromEntries(
  activeHeaderRows(rows).map(({ name, value }) => [String(name).trim(), String(value).trim()]),
);

export default function HeaderRowsEditor({
  title,
  description,
  rows,
  onChange,
  valuePlaceholder,
  environment = false,
}) {
  const updateRow = (index, field, value) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  return (
    <div className="rounded-lg border border-border bg-surface/30 p-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-text-main sm:text-sm">{title}</p>
          <p className="text-[11px] text-text-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...rows, { name: "", value: "" }])}
          className="flex items-center justify-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add Header
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-text-muted">
          No {environment ? "environment-backed" : "custom"} headers configured.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
              <input
                type="text"
                value={row.name}
                onChange={(event) => updateRow(index, "name", event.target.value)}
                placeholder="Header-Name"
                className="min-w-0 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <input
                type={!environment && isSensitiveHeader(row.name) ? "password" : "text"}
                value={row.value}
                onChange={(event) => updateRow(index, "value", event.target.value)}
                placeholder={valuePlaceholder}
                autoComplete="off"
                className="min-w-0 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                className="flex items-center justify-center rounded border border-border px-2 py-1.5 text-text-muted transition-colors hover:border-red-500/40 hover:text-red-500"
                title="Remove header"
              >
                <span className="material-symbols-outlined text-[15px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

HeaderRowsEditor.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string.isRequired,
    value: PropTypes.string.isRequired,
  })).isRequired,
  onChange: PropTypes.func.isRequired,
  valuePlaceholder: PropTypes.string.isRequired,
  environment: PropTypes.bool,
};
