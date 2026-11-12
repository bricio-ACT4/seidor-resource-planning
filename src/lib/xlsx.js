// Minimal .xlsx reader: first worksheet as a grid of values.
// Handles both regular Excel files and the Power BI / Timeflow exports, which use
// namespace prefixes, inline strings and cells without references.
import { unzipSync, strFromU8 } from 'fflate';

const ent = (s) => s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const attr = (s, name) => { const m = s.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)); return m ? m[1] : null; };
const texts = (s) => { let out = ''; const re = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g; let m; while ((m = re.exec(s))) out += m[1] ?? ''; return ent(out); };
const colIndex = (ref) => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const pad = (n) => String(n).padStart(2, '0');

function dateStyles(xml) {
  if (!xml) return [];
  const fmts = {}; let m;
  const reF = /<(?:\w+:)?numFmt\b([^>]*)>/g;
  while ((m = reF.exec(xml))) fmts[attr(m[1], 'numFmtId')] = ent(attr(m[1], 'formatCode') || '');
  const xfs = xml.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/);
  if (!xfs) return [];
  const out = []; const reX = /<(?:\w+:)?xf\b([^>]*)>/g;
  while ((m = reX.exec(xfs[0]))) {
    const id = +(attr(m[1], 'numFmtId') || 0), code = fmts[id];
    out.push(code != null ? /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) : BUILTIN_DATE.has(id));
  }
  return out;
}

// Excel serial -> 'YYYY-MM-DD' (days), 'HH:MM' (time of day only)
function serial(v) {
  if (v < 1) { const mins = Math.round(v * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  const d = new Date(Math.round((Math.floor(v + 1e-9) - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function readXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer), { filter: (f) => /^xl\/(sharedStrings\.xml|styles\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name) });
  const sheetName = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))[0];
  if (!sheetName) throw new Error('a planilha não tem abas legíveis');
  const shared = [];
  if (files['xl/sharedStrings.xml']) { const s = strFromU8(files['xl/sharedStrings.xml']); const re = /<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g; let m; while ((m = re.exec(s))) shared.push(texts(m[1] ?? '')); }
  const isDate = dateStyles(files['xl/styles.xml'] && strFromU8(files['xl/styles.xml']));
  const xml = strFromU8(files[sheetName]);
  const grid = [];
  const reRow = /<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g, reCell = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let rm;
  while ((rm = reRow.exec(xml))) {
    const row = []; let i = 0, cm; reCell.lastIndex = 0; const body = rm[1] ?? '';
    while ((cm = reCell.exec(body))) {
      const a = cm[1], inner = cm[2] ?? '', ref = attr(a, 'r'), t = attr(a, 't');
      if (ref) i = colIndex(ref);
      let val = null;
      if (t === 'inlineStr') val = texts(inner);
      else {
        const vm = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
        if (vm) {
          const raw = ent(vm[1]);
          if (t === 's') val = shared[+raw] ?? '';
          else if (t === 'str' || t === 'e') val = raw;
          else if (t === 'b') val = raw === '1';
          else { const n = Number(raw); val = isNaN(n) ? raw : isDate[+(attr(a, 's') || 0)] ? serial(n) : n; }
        }
      }
      row[i++] = val;
    }
    for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = null;
    grid.push(row);
  }
  return grid;
}
