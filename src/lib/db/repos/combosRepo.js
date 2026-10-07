import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { normalizeTokenRules } from "@/shared/tokenRules.js";

export function normalizeComboModels(models) {
  if (!Array.isArray(models)) return [];
  return models.map((m) => {
    if (typeof m === "string") {
      return {
        model: m,
        pricingType: "request",
        price: null,
        minPrice: null,
        maxInputTokens: null,
        headroomMinInputTokens: null,
        inputTokenRules: [],
        outputTokenRules: [],
        timeSchedule: {
          enabled: false,
          startTime: "00:00",
          endTime: "23:59",
        },
      };
    }
    if (m && typeof m === "object") {
      const schedule = m.timeSchedule && typeof m.timeSchedule === "object" ? {
        enabled: !!m.timeSchedule.enabled,
        startTime: typeof m.timeSchedule.startTime === "string" ? m.timeSchedule.startTime.trim() : "00:00",
        endTime: typeof m.timeSchedule.endTime === "string" ? m.timeSchedule.endTime.trim() : "23:59",
      } : {
        enabled: false,
        startTime: "00:00",
        endTime: "23:59",
      };

      return {
        model: m.model || "",
        pricingType: m.pricingType === "token" || m.pricingType === "input_token" ? "token" : "request",
        price: m.price !== undefined && m.price !== null && m.price !== "" ? Number(m.price) : null,
        minPrice: m.minPrice !== undefined && m.minPrice !== null && m.minPrice !== "" ? Number(m.minPrice) : null,
        maxInputTokens: m.maxInputTokens !== undefined && m.maxInputTokens !== null && m.maxInputTokens !== "" && Number(m.maxInputTokens) > 0 ? Math.floor(Number(m.maxInputTokens)) : null,
        headroomMinInputTokens: m.headroomMinInputTokens !== undefined && m.headroomMinInputTokens !== null && m.headroomMinInputTokens !== "" && Number(m.headroomMinInputTokens) > 0 ? Math.floor(Number(m.headroomMinInputTokens)) : null,
        inputTokenRules: normalizeTokenRules(m.inputTokenRules),
        outputTokenRules: normalizeTokenRules(m.outputTokenRules),
        timeSchedule: schedule,
      };
    }
    return m;
  }).filter((m) => m && m.model);
}

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: normalizeComboModels(parseJson(row.models, [])),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = await db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    await tx.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = await db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
