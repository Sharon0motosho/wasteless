// F4.1 Historical Data Ingestion & Schema Validator (+ CSV export helpers)

import { HALLS, DISHES, INGREDIENTS, SHIFTS, WASTE_REASONS, dishById, ingredientById } from '../data/catalog.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20000;

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isInt = (v) => /^\d+$/.test(v);
const isNum = (v) => /^\d+(\.\d+)?$/.test(v);

const hallIds = HALLS.map((h) => h.id);

export const SCHEMAS = {
  sales: {
    label: 'Meal sales & consumption',
    key: (r) => `${r.date}|${r.dish_id}`,
    columns: [
      { name: 'date', required: true, check: (v, ctx) => (!isDate(v) ? 'must be YYYY-MM-DD' : v > ctx.today ? 'cannot be in the future' : null) },
      { name: 'hall', required: true, check: (v) => (hallIds.includes(v) ? null : `unknown hall (expected ${hallIds.join('/')})`) },
      { name: 'dish_id', required: true, check: (v, ctx, row) => (!dishById[v] ? 'unknown dish id' : dishById[v].hall !== row.hall ? `dish is served at ${dishById[v].hall}, not ${row.hall}` : null) },
      { name: 'prepared', required: true, check: (v) => (isInt(v) ? null : 'must be a whole number >= 0') },
      { name: 'consumed', required: true, check: (v, ctx, row) => (!isInt(v) ? 'must be a whole number >= 0' : Number(v) > Number(row.prepared) ? 'cannot exceed prepared' : null) },
      { name: 'predicted', required: false, check: (v) => (v === '' || isInt(v) ? null : 'must be a whole number >= 0') },
    ],
  },
  inventory: {
    label: 'Inventory counts',
    key: (r) => `${r.date}|${r.ingredient_id}`,
    columns: [
      { name: 'date', required: true, check: (v, ctx) => (!isDate(v) ? 'must be YYYY-MM-DD' : v > ctx.today ? 'cannot be in the future' : null) },
      { name: 'ingredient_id', required: true, check: (v) => (ingredientById[v] ? null : 'unknown ingredient id') },
      { name: 'on_hand', required: true, check: (v) => (isNum(v) ? null : 'must be a number >= 0') },
      { name: 'unit', required: true, check: (v, ctx, row) => (ingredientById[row.ingredient_id] && ingredientById[row.ingredient_id].unit !== v ? `unit must be ${ingredientById[row.ingredient_id].unit}` : null) },
    ],
  },
  waste: {
    label: 'Food waste records',
    key: (r) => `${r.date}|${r.shift}|${r.dish_id}|${r.reason}`,
    columns: [
      { name: 'date', required: true, check: (v, ctx) => (!isDate(v) ? 'must be YYYY-MM-DD' : v > ctx.today ? 'cannot be in the future' : null) },
      { name: 'shift', required: true, check: (v) => (SHIFTS.includes(v) ? null : `must be one of ${SHIFTS.join('/')}`) },
      { name: 'hall', required: true, check: (v) => (hallIds.includes(v) ? null : 'unknown hall') },
      { name: 'dish_id', required: true, check: (v, ctx, row) => (!dishById[v] ? 'unknown dish id' : dishById[v].hall !== row.hall ? 'dish not served at this hall' : null) },
      { name: 'leftover_portions', required: true, check: (v) => (isInt(v) ? null : 'must be a whole number >= 0') },
      { name: 'discarded_kg', required: true, check: (v) => (!isNum(v) ? 'must be a number >= 0' : Number(v) > 500 ? 'exceeds 500 kg sanity limit' : null) },
      { name: 'reason', required: true, check: (v) => (WASTE_REASONS.includes(v) ? null : `must be one of ${WASTE_REASONS.join('/')}`) },
    ],
  },
};

/**
 * Validate a CSV against a schema.
 * Returns { fileErrors, rows: [{ line, data, errors }], validRows, invalidCount, duplicates, unknownColumns }
 */
export function validateCSV(text, type, ctx) {
  const schema = SCHEMAS[type];
  const fileErrors = [];
  if (!schema) return { fileErrors: ['Unknown dataset type'], rows: [], validRows: [], invalidCount: 0 };
  if (text.length > MAX_FILE_BYTES) fileErrors.push(`File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit`);
  const grid = parseCSV(text);
  if (!grid.length) return { fileErrors: [...fileErrors, 'File is empty'], rows: [], validRows: [], invalidCount: 0 };
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const missing = schema.columns.filter((c) => c.required && !header.includes(c.name)).map((c) => c.name);
  if (missing.length) fileErrors.push(`Missing required column(s): ${missing.join(', ')}`);
  const known = schema.columns.map((c) => c.name);
  const unknownColumns = header.filter((h) => !known.includes(h));
  if (grid.length - 1 > MAX_ROWS) fileErrors.push(`Too many rows (max ${MAX_ROWS})`);
  if (fileErrors.length) return { fileErrors, rows: [], validRows: [], invalidCount: 0, unknownColumns };

  const seen = new Set();
  let duplicates = 0;
  const rows = grid.slice(1).map((cells, i) => {
    const data = {};
    header.forEach((h, j) => (data[h] = (cells[j] ?? '').trim()));
    const errors = [];
    for (const col of schema.columns) {
      const v = data[col.name] ?? '';
      if (col.required && v === '') { errors.push(`${col.name}: required`); continue; }
      const e = col.check(v, ctx, data);
      if (e) errors.push(`${col.name}: ${e}`);
    }
    if (cells.length !== header.length) errors.push(`expected ${header.length} cells, found ${cells.length}`);
    const k = schema.key(data);
    if (seen.has(k)) { errors.push('duplicate row in file'); duplicates++; }
    seen.add(k);
    return { line: i + 2, data, errors };
  });
  const validRows = rows.filter((r) => !r.errors.length).map((r) => r.data);
  return { fileErrors, rows, validRows, invalidCount: rows.length - validRows.length, duplicates, unknownColumns };
}

/** Convert validated rows into application objects. */
export function toDomain(type, rows, batchId) {
  if (type === 'sales') {
    return rows.map((r) => {
      const d = dishById[r.dish_id];
      const prepared = Number(r.prepared);
      const consumed = Number(r.consumed);
      const leftover = prepared - consumed;
      return {
        date: r.date, hall: r.hall, dish: r.dish_id, category: d.category,
        predicted: r.predicted ? Number(r.predicted) : consumed, prepared, consumed, leftover,
        stockout: consumed >= prepared,
        wasteKg: Math.round((leftover * d.kg * 0.9 + consumed * d.kg * 0.05) * 100) / 100,
        source: 'import', batchId, mode: 'wasteless',
      };
    });
  }
  if (type === 'waste') {
    return rows.map((r) => ({
      id: `${batchId}_${r.date}_${r.dish_id}_${r.shift}_${r.reason}`, batchId,
      date: r.date, shift: r.shift, hall: r.hall, dish: r.dish_id,
      leftoverPortions: Number(r.leftover_portions), discardedKg: Number(r.discarded_kg), reason: r.reason,
      staff: 'CSV import', createdAt: new Date().toISOString(),
    }));
  }
  return rows.map((r) => ({ date: r.date, ingredient: r.ingredient_id, onHand: Number(r.on_hand), batchId }));
}

export function templateCSV(type) {
  const s = SCHEMAS[type];
  const header = s.columns.map((c) => c.name).join(',');
  const examples = {
    sales: `2026-11-02,north,${DISHES[0].id},260,241,250`,
    inventory: `2026-11-02,${INGREDIENTS[0].id},68.5,${INGREDIENTS[0].unit}`,
    waste: `2026-11-02,Lunch,north,${DISHES[0].id},14,2.3,Overproduction`,
  };
  return `${header}\n${examples[type]}\n`;
}

// Prevent CSV formula injection when the file is opened in a spreadsheet.
function safeCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {});
  return [cols.join(','), ...rows.map((r) => cols.map((c) => safeCell(r[c])).join(','))].join('\n');
}

// Saves a generated file. Inside the hosted viewer, files go through the
// viewer's save prompt (the `downloads` capability); elsewhere a normal
// browser download is used.
export async function saveFile(filename, data, mime = 'text/csv') {
  try {
    const dl = await window.claude?.use?.('downloads');
    if (dl) {
      await dl.save({ filename, data });
      return true;
    }
  } catch (e) {
    if (e && e.code === 'declined') return false;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

export function downloadText(filename, text, mime = 'text/csv') {
  return saveFile(filename, text, mime);
}
