// Reads .xlsx and .csv files into rows of objects keyed by the header row.
import { readXlsx } from './xlsx.js';
import Papa from 'papaparse';
import { deacc } from './util.js';

// `mustHave` lists header names (accent/case-insensitive) used to find the header row.
export async function readTable(file, mustHave = []) {
  let grid;
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const text = await file.text();
    grid = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data;
  } else {
    grid = readXlsx(await file.arrayBuffer());
  }
  if (!grid.length) throw new Error('o arquivo está vazio');
  const want = mustHave.map(deacc);
  let h = 0;
  if (want.length) {
    h = grid.findIndex((r) => { const set = new Set(r.map((c) => deacc(c))); return want.every((w) => set.has(w)); });
    if (h < 0) throw new Error('não encontrei as colunas ' + mustHave.join(', '));
  }
  const header = grid[h].map((c) => String(c ?? '').trim());
  return grid.slice(h + 1)
    .filter((r) => r.some((c) => c !== null && c !== ''))
    .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])));
}

// Find a column whose header matches one of the names.
export function col(rows, ...names) {
  if (!rows.length) return null;
  const want = names.map(deacc);
  return Object.keys(rows[0]).find((k) => want.includes(deacc(k))) || null;
}
