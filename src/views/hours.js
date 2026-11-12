// TIMEFLOW hours: upload (replace or add), import history and hours per person.
import { supabase } from '../supabase.js';
import { S, fetchAll, loadActual, loadResources, notify } from '../lib/data.js';
import { HPM, esc, num, mLbl, arm, toast, parseDate, parseHours, parseNum } from '../lib/util.js';
import { readTable, col } from '../lib/sheet.js';

let el, people = [], imports = [];

export async function mount(root) {
  el = root;
  el.innerHTML = `<div style="display:grid;gap:14px">
    <section class="panel"><h2>Subir horas do TIMEFLOW</h2>
      <p class="note">Arquivo .xlsx ou .csv com as colunas COLABORADOR, CONTRATO, DATA e HORAS. Com VALOR ou TAXA, o custo-hora de cada recurso é calculado; INÍCIO ajuda a reconhecer lançamentos repetidos.</p>
      <div class="modes" role="radiogroup" aria-label="O que o novo arquivo faz">
        <label><input type="radio" name="tfMode" id="tfAdd" checked> Somar às horas já carregadas</label>
        <label><input type="radio" name="tfMode" id="tfRep"> Substituir todas as horas carregadas</label></div>
      <p class="note" id="tfNote"></p>
      <div class="row c"><input type="file" id="tfFile" accept=".xlsx,.csv" multiple><span id="tfProg" class="note" role="status" aria-live="polite"></span></div>
      <div id="tfImports"></div></section>
    <section class="kpis" id="hKpis"></section>
    <section class="panel"><div class="row between c"><h2>Horas por pessoa</h2><input id="hQ" type="search" placeholder="Buscar pessoa ou contrato" aria-label="Buscar pessoa ou contrato" style="width:240px"></div>
      <p class="note">Últimos seis meses com horas. Laranja = pessoa dividida entre contratos no mês (×n). Vermelho = mais de ${Math.round(HPM * 1.1)} horas no mês.</p>
      <div class="tablewrap tall"><table id="hT"></table></div></section></div>`;
  const note = () => (el.querySelector('#tfNote').textContent = el.querySelector('#tfRep').checked
    ? 'Tudo que está carregado é apagado e o arquivo passa a ser a única fonte de horas realizadas.'
    : 'Lançamentos que já estão carregados (mesma pessoa, contrato, data, hora de início e horas) são ignorados, então subir o mesmo arquivo duas vezes não duplica.');
  el.querySelectorAll('input[name=tfMode]').forEach((r) => (r.onchange = note)); note();
  el.querySelector('#tfFile').onchange = async (e) => { const fs = [...e.target.files]; e.target.value = ''; for (const [i, f] of fs.entries()) await importFile(f, i === 0 && el.querySelector('#tfRep').checked); };
  el.querySelector('#hQ').addEventListener('input', drawPeople);
  await reload();
}

async function reload() {
  [imports, people] = await Promise.all([
    fetchAll(() => supabase.from('timeflow_imports').select('*').order('id', { ascending: false }), 'Importações'),
    fetchAll(() => supabase.rpc('person_month_hours').order('person').order('month'), 'Horas por pessoa'),
  ]);
  drawImports(); drawPeople();
}

function drawImports() {
  const box = el.querySelector('#tfImports');
  if (!imports.length) { box.innerHTML = '<p class="note">Nenhum arquivo carregado ainda.</p>'; return; }
  box.innerHTML = `<ul class="files">${imports.map((f) => `<li><strong>${esc(f.file_name)}</strong> · ${new Date(f.created_at).toLocaleDateString('pt-BR')} · ${f.mode === 'add' ? 'somou' : 'substituiu com'} ${num(f.rows_added)} lançamentos${f.rows_skipped ? `, ${num(f.rows_skipped)} já carregados ignorados` : ''} · ${esc(f.month_from || '–')} a ${esc(f.month_to || '–')}</li>`).join('')}</ul>
    <div style="margin-top:8px"><button id="tfClear" class="x">Apagar todas as horas carregadas</button></div>`;
  box.querySelector('#tfClear').onclick = (e) => arm(e.target, 'Apagar todas as horas carregadas', async () => {
    try { await clearAll(); await after(); toast('Horas apagadas. A classificação dos recursos foi mantida.'); } catch (err) { toast(err.message, 'error'); }
  });
}
async function clearAll() {
  let r = await supabase.rpc('clear_timeflow_entries'); if (r.error) throw r.error;
  r = await supabase.from('timeflow_imports').delete().gt('id', 0); if (r.error) throw r.error;
}
async function after() {
  const r = await supabase.rpc('refresh_resource_metrics'); if (r.error) throw r.error;
  await Promise.all([loadActual(), loadResources(), reload()]); notify('hours');
}

const startOf = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v < 1) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  const s = String(v).trim(), m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return s.slice(0, 20);
  let h = +m[1]; if (m[3]) { if (/PM/i.test(m[3]) && h < 12) h += 12; if (/AM/i.test(m[3]) && h === 12) h = 0; }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

async function importFile(file, replace) {
  const prog = el.querySelector('#tfProg'), say = (t) => (prog.textContent = t);
  try {
    say(`Lendo ${file.name}…`);
    const rows = await readTable(file, ['COLABORADOR', 'CONTRATO', 'DATA', 'HORAS']);
    const cP = col(rows, 'COLABORADOR'), cC = col(rows, 'CONTRATO'), cD = col(rows, 'DATA'), cH = col(rows, 'HORAS'), cS = col(rows, 'INÍCIO'), cV = col(rows, 'VALOR'), cT = col(rows, 'TAXA');
    const out = []; let bad = 0;
    rows.forEach((r) => {
      const d = parseDate(r[cD]), h = parseHours(r[cH]), person = String(r[cP] ?? '').trim(), contract = String(r[cC] ?? '').trim();
      if (!d || !(h > 0) || !person || !contract) { bad++; return; }
      let v = cV ? parseNum(r[cV]) : null; if (!(v >= 0) && cT) { const t = parseNum(r[cT]); v = t >= 0 ? t * h : null; }
      out.push({ person, contract, work_date: d, start_time: cS ? startOf(r[cS]) : '', hours: Math.round(h * 100) / 100, cost: v >= 0 && v != null ? Math.round(v * 100) / 100 : null, month: d.slice(0, 7) });
    });
    if (!out.length) throw new Error('nenhum lançamento válido encontrado');
    // identical entries inside one file are numbered so none is lost; a re-upload gets the same numbers and is skipped
    const seen = new Map();
    out.forEach((x) => { const k = [x.person, x.contract, x.work_date, x.start_time, x.hours].join('|'), n = seen.get(k) || 0; x.seq = n; seen.set(k, n + 1); });
    if (replace) { say('Apagando as horas anteriores…'); await clearAll(); }
    const ms = [...new Set(out.map((x) => x.month))].sort();
    const imp = await supabase.from('timeflow_imports').insert({ file_name: file.name, mode: replace ? 'replace' : 'add', month_from: ms[0], month_to: ms.at(-1) }).select('id').single();
    if (imp.error) throw imp.error;
    let added = 0;
    for (let i = 0; i < out.length; i += 1000) {
      say(`Gravando ${file.name}: ${num(Math.min(i + 1000, out.length))} de ${num(out.length)} lançamentos…`);
      const chunk = out.slice(i, i + 1000).map((x) => ({ ...x, import_id: imp.data.id }));
      const r = await supabase.from('timeflow_entries').upsert(chunk, { onConflict: 'person,contract,work_date,start_time,hours,seq', ignoreDuplicates: true, count: 'exact' });
      if (r.error) throw r.error;
      added += r.count ?? 0;
    }
    const skipped = out.length - added;
    await supabase.from('timeflow_imports').update({ rows_added: added, rows_skipped: skipped }).eq('id', imp.data.id);
    say('Recalculando taxas e horas por recurso…');
    await after(); say('');
    toast(`${file.name}: ${num(added)} lançamentos gravados${skipped ? `, ${num(skipped)} já carregados ignorados` : ''}${bad ? `, ${num(bad)} linhas sem data, horas ou nome descartadas` : ''}.${cV || cT ? '' : ' O arquivo não traz VALOR nem TAXA, então o custo-hora não foi atualizado.'}`);
  } catch (e) { say(''); toast(`Não foi possível importar ${file.name}: ${e.message}.`, 'error'); }
}

function drawPeople() {
  const months = [...new Set(people.map((p) => p.month))].sort().slice(-6);
  const q = (el.querySelector('#hQ').value || '').toLowerCase();
  const P = {};
  people.forEach((x) => { if (!months.includes(x.month)) return; const p = (P[x.person] ??= { tot: 0, m: {}, cs: new Set() }); p.tot += +x.hours; p.m[x.month] = { h: +x.hours, n: +x.contracts }; x.contract_list.forEach((c) => p.cs.add(c)); });
  const all = Object.entries(P), list = all.filter(([n, p]) => !q || (n + ' ' + [...p.cs].join(' ')).toLowerCase().includes(q)).sort((a, b) => b[1].tot - a[1].tot);
  const totH = people.reduce((a, x) => a + +x.hours, 0), allM = [...new Set(people.map((p) => p.month))].sort();
  const split = all.filter(([, p]) => months.some((k) => (p.m[k]?.n || 0) > 1)).length, over = all.filter(([, p]) => months.some((k) => (p.m[k]?.h || 0) > HPM * 1.1)).length;
  el.querySelector('#hKpis').innerHTML = [['Horas carregadas', num(totH), allM.length ? `${mLbl(allM[0])} a ${mLbl(allM.at(-1))}` : 'Nenhum arquivo carregado'], ['Pessoas', num(new Set(people.map((p) => p.person)).size), `${all.length} nos últimos seis meses`], ['Divididas entre contratos', num(split), 'Em pelo menos um dos últimos seis meses'], [`Acima de ${Math.round(HPM * 1.1)} h no mês`, num(over), 'Em pelo menos um dos últimos seis meses']]
    .map((k) => `<div class="kpi"><span class="label">${k[0]}</span><span class="v">${k[1]}</span><span class="d">${k[2]}</span></div>`).join('');
  el.querySelector('#hT').innerHTML = list.length ? `<thead><tr><th>Pessoa</th>${months.map((k) => `<th class="r">${mLbl(k)}</th>`).join('')}<th class="r">Total</th><th>Contratos</th></tr></thead><tbody>` +
    list.map(([n, p]) => `<tr><td>${esc(n)}</td>${months.map((k) => { const c = p.m[k]; return `<td class="r num ${c?.h > HPM * 1.1 ? 'c-bad' : c?.n > 1 ? 'c-warn' : ''}">${c ? num(c.h) : ''}${c?.n > 1 ? `<span class="code"> ×${c.n}</span>` : ''}</td>`; }).join('')}<td class="r num">${num(p.tot)}</td><td class="code wrapc">${esc([...p.cs].join(', '))}</td></tr>`).join('') + '</tbody>'
    : `<tbody><tr><td>${people.length ? 'Ninguém encontrado para essa busca.' : 'Suba um arquivo do TIMEFLOW para ver as horas por pessoa.'}</td></tr></tbody>`;
}
