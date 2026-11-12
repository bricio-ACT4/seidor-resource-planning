// Formatting, dates and small UI helpers shared by every view.

export const HPM = 160; // hours per FTE-month

export const TODAY = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const deacc = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const slug = (x) => deacc(x).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'r';
export const r1 = (v) => Math.round(v * 10) / 10;
export const clone = (o) => JSON.parse(JSON.stringify(o));

const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const num = (v, d = 0) => (v == null || isNaN(v) ? '—' : nf(d).format(v));
export const brl = (v, d = 2) => (v == null || isNaN(v) ? '—' : 'R$ ' + nf(d).format(v));
export const brlShort = (v) => {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return 'R$ ' + nf(2).format(v / 1e6) + ' mi';
  if (a >= 1e3) return 'R$ ' + nf(0).format(v / 1e3) + ' mil';
  return 'R$ ' + nf(0).format(v);
};
export const pct = (v, d = 1) => (v == null || isNaN(v) ? '—' : nf(d).format(v) + '%');
export const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));

// Dates
export const pd = (s) => { if (!s) return null; const [a, b, c] = String(s).slice(0, 10).split('-').map(Number); return new Date(a, b - 1, c); };
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const mKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
export const mLbl = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/'); };
export const fmtDate = (s) => (s ? pd(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '').replace(/ de /g, ' ') : '—');
export function monthRange(fromKey, toKey) {
  const out = []; let [y, m] = fromKey.split('-').map(Number); m -= 1;
  const [ty, tm] = toKey.split('-').map(Number);
  while (y * 12 + m <= ty * 12 + tm - 1) { out.push(mKey(y, m)); m++; if (m === 12) { m = 0; y++; } }
  return out;
}
export const addMonths = (s, n) => { const d = pd(s), t = new Date(d.getFullYear(), d.getMonth() + n, 1); const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(d.getDate(), dim)); return iso(t); };
export const shiftKey = (k, n) => { const [y, m] = k.split('-').map(Number); const t = new Date(y, m - 1 + n, 1); return mKey(t.getFullYear(), t.getMonth()); };
export function workdays(a, b) { let n = 0; const d = new Date(a); while (d <= b) { const w = d.getDay(); if (w && w < 6) n++; d.setDate(d.getDate() + 1); } return n; }

// Spread `hours` evenly over working days between two dates, into acc[monthKey]. Months in `skip` get nothing.
export function spread(hours, from, to, acc, skip) {
  if (!(hours > 0) || !from || !to || to < from) return;
  let days = 0; const d = new Date(from); const per = {};
  while (d <= to) {
    const w = d.getDay();
    if (w && w < 6) { const k = mKey(d.getFullYear(), d.getMonth()); if (!skip || !(k in skip)) { per[k] = (per[k] || 0) + 1; days++; } }
    d.setDate(d.getDate() + 1);
  }
  if (!days) return;
  for (const k in per) acc[k] = (acc[k] || 0) + (hours * per[k]) / days;
}

// Parse dates in the formats the Seidor exports use.
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.getUTCHours() === 0 && v.getUTCMinutes() === 0 ? v.toISOString().slice(0, 10) : iso(v); // spreadsheet dates arrive as UTC midnight
  if (typeof v === 'number' && v > 20000) { const d = new Date(Math.round((v - 25569) * 86400000)); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/))) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
export const parseNum = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const s = String(v).trim().replace(/\s/g, ''); const n = parseFloat(/,\d{1,6}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')); return isNaN(n) ? null : n; };
export const parseHours = (v) => { if (typeof v === 'string' && /^\d+:\d{2}$/.test(v.trim())) { const [h, m] = v.trim().split(':').map(Number); return h + m / 60; } return parseNum(v); };

// Two-step confirmation on a button (no browser dialogs).
export function arm(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; fn(); return; }
  btn.dataset.armed = '1'; btn.textContent = 'Clique de novo para confirmar';
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; } }, 3500);
}

let toastT;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = msg; el.className = 'toast show ' + kind;
  clearTimeout(toastT); toastT = setTimeout(() => (el.className = 'toast ' + kind), kind === 'error' ? 8000 : 4500);
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n');

export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

// Keep the focused control focused across a re-render that replaces the DOM.
export function keepFocus(fn) {
  const id = document.activeElement && document.activeElement.id;
  fn();
  if (id) { const el = document.getElementById(id); if (el && el !== document.activeElement) el.focus(); }
}
