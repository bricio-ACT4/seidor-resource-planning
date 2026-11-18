import Chart from 'chart.js/auto';
import { supabase } from '../supabase.js';
import { S, F, saveF, QS, saveQS, filtered, loadContracts, loadActual, isEditor, STATUS_LABEL, notify } from '../lib/data.js';
import { HPM, TODAY, esc, num, brl, brlShort, pct, signed, pd, mKey, mLbl, monthRange, spread, fmtDate, css, toast, parseDate, parseNum, parseHours, keepFocus, iso, arm } from '../lib/util.js';
import { readTable, col } from '../lib/sheet.js';
import { simOverlay } from './simulator.js';

let el, chart, sortKey = 'var', sortDir = -1;

const MONTHS = () => monthRange(`${TODAY.getFullYear()}-01`, `${TODAY.getFullYear() + 1}-12`);

export async function mount(root) {
  el = root;
  if (!S.loaded.contracts) await loadContracts();
  if (!S.loaded.actual) await loadActual();
  el.innerHTML = `<div style="display:grid;gap:18px">
    <section class="panel"><div class="row" id="filters"></div></section>
    <section class="kpis" id="kpis" aria-label="Totais do portfólio"></section>
    <section class="panel">
      <div class="row between c"><div><h2>Carga mensal</h2><div class="sub" id="chartSub"></div></div>
        <div class="legend">
          <span><span class="sw" style="background:var(--plan);opacity:.55"></span>Planejado</span>
          <span><span class="sw" style="background:var(--actual)"></span>Realizado (TIMEFLOW)</span>
          <span><span class="sw" style="background:var(--accent)"></span>Forecast</span>
          <span><span class="sw" style="background:var(--bad);height:2px;vertical-align:3px"></span>Capacidade</span>
          <span id="lgSim" hidden><span class="sw" style="background:var(--sim);height:3px;vertical-align:3px"></span>Simulado: <span id="lgSimName"></span></span>
        </div></div>
      <div class="chartbox"><canvas id="chart" aria-label="Carga mensal planejada, realizada e prevista"></canvas></div>
      <details id="qs"><summary>Premissas do forecast</summary><div class="row" style="margin-top:10px" id="qsBody"></div>
        <p class="note" style="margin-top:8px">Planejado = horas orçadas distribuídas entre início e fim do contrato. Forecast = custo a incorrer ÷ custo-hora orçado, distribuído de hoje até o fim previsto. Contratos paralisados só entram no forecast se você informar uma data de retomada.</p></details>
    </section>
    <section class="panel">
      <div class="row between c">
        <div class="row c"><input id="q" type="search" placeholder="Buscar contrato, cliente ou código" style="width:280px">
          <span class="note">EAC = custo realizado + custo a incorrer. Clique no cabeçalho para ordenar.</span></div>
        <div class="row" id="edBtns"></div>
      </div>
      <div class="tablewrap"><table id="tbl"></table></div>
      <details id="imports" hidden><summary>Histórico de importações</summary><ul class="files" style="margin-top:8px"></ul></details>
    </section></div>
    <dialog id="dlg"></dialog>`;
  drawFilters(); drawQS();
  if (isEditor()) {
    el.querySelector('#edBtns').innerHTML = `<button id="newC">Novo contrato</button><label class="btn" title="Planilha 'Informações dos projetos' (uma linha por contrato). Você escolhe carga incremental ou atualização completa antes de gravar.">Importar projetos (.xlsx/.csv) <input id="impC" type="file" accept=".xlsx,.csv" hidden></label>`;
    el.querySelector('#newC').onclick = () => editContract(null);
    el.querySelector('#impC').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importPortfolio(f); };
  }
  drawImports();
  el.querySelector('#q').addEventListener('input', (e) => { F.q = e.target.value; render(); });
  render();
}
export function onChange() { if (el?.isConnected) render(); }

function drawFilters() {
  const uniq = (k) => [...new Set(S.contracts.map((c) => c[k]).filter(Boolean))].sort();
  const opt = (list, cur, all) => `<option value="">${all}</option>` + list.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  el.querySelector('#filters').innerHTML = `
    <div class="ctl"><label class="label" for="fClient">Cliente</label><select id="fClient">${opt(uniq('client'), F.client, 'Todos')}</select></div>
    <div class="ctl"><label class="label" for="fPM">Gerente de projeto</label><select id="fPM">${opt(uniq('pm'), F.pm, 'Todos')}</select></div>
    <div class="ctl"><label class="label" for="fStatus">Status</label><select id="fStatus"><option value="">Todos</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${F.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="ctl"><label class="label" for="fScope">Escopo</label><select id="fScope"><option value="open" ${F.scope === 'open' ? 'selected' : ''}>Contratos com trabalho restante</option><option value="all" ${F.scope === 'all' ? 'selected' : ''}>Todos os contratos</option></select></div>
    <div class="ctl"><label class="label" for="fUnit">Unidade</label><select id="fUnit"><option value="fte" ${F.unit === 'fte' ? 'selected' : ''}>FTE (160 h/mês)</option><option value="h" ${F.unit === 'h' ? 'selected' : ''}>Horas</option></select></div>
    <div class="ctl"><label class="label" for="fCap">Capacidade (FTE)</label><input id="fCap" type="number" min="0" step="1" value="${F.cap}" style="width:90px"></div>`;
  const map = { fClient: 'client', fPM: 'pm', fStatus: 'status', fScope: 'scope', fUnit: 'unit' };
  Object.entries(map).forEach(([id, k]) => (el.querySelector('#' + id).onchange = (e) => { F[k] = e.target.value; saveF(); render(); }));
  el.querySelector('#fCap').oninput = (e) => { F.cap = +e.target.value || 0; saveF(); render(); };
}

function drawQS() {
  el.querySelector('#qsBody').innerHTML = `
    <div class="ctl"><label class="label" for="qsOver">Contratos vencidos encerram em</label><input id="qsOver" type="date" value="${QS.overdueClose}"></div>
    <label class="row c" style="gap:6px;padding-bottom:6px"><input id="qsGo" type="checkbox" ${QS.useGoLive ? 'checked' : ''}> Usar a data de go-live quando for depois do fim do contrato</label>
    <div class="ctl"><label class="label" for="qsRes">Paralisados retomam em</label><input id="qsRes" type="date" value="${QS.pausedRestart}"></div>
    <div class="ctl"><label class="label" for="qsEnd">e terminam em</label><input id="qsEnd" type="date" value="${QS.pausedEnd}"></div>`;
  const set = (id, k, f = (e) => e.target.value) => (el.querySelector('#' + id).onchange = (e) => { QS[k] = f(e); saveQS(); render(); notify('qs'); });
  set('qsOver', 'overdueClose'); set('qsGo', 'useGoLive', (e) => e.target.checked); set('qsRes', 'pausedRestart'); set('qsEnd', 'pausedEnd');
}

function render() { const rows = filtered(); kpis(rows); drawChart(rows); keepFocus(() => table(rows)); }

function kpis(rows) {
  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const cb = sum((r) => r.cb), ca = sum((r) => r.ca), eti = sum((r) => r.eti), eac = ca + eti, sale = sum((r) => r.sale), billed = sum((r) => r.billed);
  const hb = sum((r) => r.hb), hl = sum((r) => r.hl), remH = sum((r) => (r.active ? r.remH : 0));
  const v = eac - cb, mS = sale ? (1 - cb / sale) * 100 : 0, mF = sale ? (1 - eac / sale) * 100 : 0;
  const cls = v > 0.03 * cb ? 'c-bad' : v > 0 ? 'c-warn' : 'c-good';
  const K = [
    ['Custo orçado', brlShort(cb), `${rows.length} contratos`],
    ['Custo realizado', brlShort(ca), `${cb ? Math.round((ca / cb) * 100) : 0}% do orçamento consumido`],
    ['Previsto ao término (EAC)', brlShort(eac), `<span class="${cls}">${signed(cb ? (v / cb) * 100 : 0, pct)} vs orçado (${brlShort(v)})</span>`],
    ['Horas: orçadas / apontadas', `${num(hb)} / ${num(hl)}`, 'Alguns aditivos não têm horas apontadas'],
    ['Horas a entregar', num(remH), `≈ ${num(remH / HPM)} FTE-meses no escopo ativo`],
    ['Margem: vendida → prevista', `${pct(mS)} → ${pct(mF)}`, `Venda líquida ${brlShort(sale)} · faturado ${brlShort(billed)}`],
  ];
  el.querySelector('#kpis').innerHTML = K.map((k) => `<div class="kpi"><span class="label">${k[0]}</span><span class="v">${k[1]}</span><span class="d">${k[2]}</span></div>`).join('');
}

function drawChart(rows) {
  const fte = F.unit === 'fte', div = fte ? HPM : 1, u = fte ? 'FTE' : 'h';
  const plan = {}, fc = {}, act = {};
  rows.forEach((r) => {
    spread(r.hb, pd(r.start), pd(r.end), plan);
    if (r.active) spread(r.remH, r.fStart, r.fEnd, fc);
    const a = S.actual[r.code]; if (a) for (const k in a) act[k] = (act[k] || 0) + a[k];
  });
  let keys = MONTHS();
  const hasAct = Object.keys(act).length > 0, cap = +F.cap || 0;
  const ds = [
    { type: 'bar', label: 'Planejado', data: keys.map((k) => (plan[k] || 0) / div), backgroundColor: css('--plan') + '88', borderRadius: 2, order: 3 },
    { type: 'bar', label: 'Realizado', data: keys.map((k) => (hasAct ? (act[k] || 0) / div || null : null)), backgroundColor: css('--actual'), borderRadius: 2, order: 2 },
    { type: 'bar', label: 'Forecast', data: keys.map((k) => (fc[k] || 0) / div || null), backgroundColor: css('--accent'), borderRadius: 2, order: 1 },
    { type: 'line', label: 'Capacidade', data: keys.map(() => (fte ? cap : cap * HPM)), borderColor: css('--bad'), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, order: 0 },
  ];
  const sim = simOverlay(rows);
  el.querySelector('#lgSim').hidden = !sim;
  if (sim) {
    el.querySelector('#lgSimName').textContent = sim.name;
    ds.push({ type: 'line', label: 'Simulado', data: keys.map((k) => (k in sim.m ? sim.m[k] / div : null)), borderColor: css('--sim'), backgroundColor: css('--sim'), borderWidth: 2.5, pointRadius: 3, order: -1 });
  }
  let last = keys.indexOf(mKey(TODAY.getFullYear(), TODAY.getMonth())) + 6;
  ds.forEach((d) => { if (d.label !== 'Capacidade') d.data.forEach((v, i) => { if (v > 0.05 && i > last) last = i; }); });
  keys = keys.slice(0, last + 1); ds.forEach((d) => (d.data = d.data.slice(0, last + 1)));
  const f = ds[2].data, pk = f.reduce((b, v, i) => ((v || 0) > (f[b] || 0) ? i : b), 0);
  el.querySelector('#chartSub').textContent = (f[pk] ? `O forecast atinge o pico de ${num(f[pk], fte ? 1 : 0)} ${u} em ${mLbl(keys[pk])}` + (cap ? `, contra uma capacidade de ${fte ? cap : num(cap * HPM)}.` : '.') : 'Sem trabalho restante nos contratos filtrados.') + (hasAct ? '' : ' Sem horas realizadas carregadas.');
  const grid = css('--line'), txt = css('--muted');
  const cfg = {
    data: { labels: keys.map(mLbl), datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.raw == null ? null : `${c.dataset.label}: ${num(c.raw, 1)} ${u}`) } } },
      scales: { x: { grid: { display: false }, ticks: { color: txt } }, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt }, title: { display: true, text: fte ? 'FTE' : 'Horas', color: txt } } },
    },
  };
  if (chart && chart.canvas?.isConnected) { chart.data = cfg.data; chart.options = cfg.options; chart.update(); } else { chart?.destroy(); chart = new Chart(el.querySelector('#chart'), cfg); }
}

const COLS = [['name', 'Contrato'], ['pm', 'GP'], ['status', 'Status'], ['prog', 'Progresso vs plano'], ['cb', 'Orçado', 'r'], ['ca', 'Realizado', 'r'], ['eti', 'A incorrer', 'r'], ['eac', 'EAC', 'r'], ['var', 'Variação', 'r'], ['hb', 'Horas orç.', 'r'], ['hl', 'Horas apont.', 'r'], ['fEnd', 'Fim previsto'], ['mSold', 'Margem vend. → prev.', 'r'], ['flags', 'Alertas']];
function flags(r) {
  const f = [];
  if (r.varPct > 5) f.push('<span class="chip c-bad">Acima do orçado</span>'); else if (r.varPct > 0.5) f.push('<span class="chip c-warn">Leve estouro</span>');
  if (r.sched != null && r.sched < -5) f.push('<span class="chip c-warn">Atrás do plano</span>');
  if (r.overdue) f.push('<span class="chip c-bad">Prazo vencido</span>');
  if (r.hl != null && r.hb && r.hl > r.hb * 1.05) f.push('<span class="chip c-warn">Horas acima do orçado</span>');
  if (r.mEtc < r.mSold - 10) f.push('<span class="chip c-bad">Erosão de margem</span>');
  if (r.status === 'Paused' && r.eti > 0) f.push('<span class="chip c-mut">Paralisado com saldo</span>');
  if (r.status === 'Execution' && /ATRAS/i.test(r.report)) f.push(`<span class="chip c-warn" title="${r.lastReport ? 'Último status report em ' + fmtDate(r.lastReport) : ''}">Status report atrasado</span>`);
  return f.join('') || '<span class="chip c-good">No plano</span>';
}
function table(rows) {
  const sv = (r) => (sortKey === 'fEnd' ? r.fEnd.getTime() : sortKey === 'prog' ? r.sched ?? 0 : sortKey === 'flags' ? r.varPct : r[sortKey]);
  rows.sort((a, b) => { const x = sv(a), y = sv(b); return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -1e12) - (y ?? -1e12)) * sortDir; });
  const ed = isEditor();
  const head = '<thead><tr>' + COLS.map(([k, l, c]) => `<th class="${c || ''}" data-k="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${sortKey === k ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('') + (ed ? '<th></th>' : '') + '</tr></thead>';
  const short = (n) => { const p = n.split(' '); return p.length > 1 ? p[0] + ' ' + p.at(-1) : n; };
  const body = rows.map((r) => `<tr>
    <td><span class="nm" ${r.desc ? `title="${esc(r.desc)}"` : ''}>${esc(r.name)}</span><span class="code">${esc(r.code)} · ${esc(r.client)}</span></td>
    <td>${esc(short(r.pm))}</td>
    <td>${STATUS_LABEL[r.status] || r.status}${r.phase ? `<br><span class="code">${esc(r.phase)}</span>` : ''}</td>
    <td><div class="prog"><div class="bar"><i style="width:${Math.min(r.prog, 100)}%"></i>${r.base != null ? `<b style="left:calc(${Math.min(r.base, 100)}% - 1px)"></b>` : ''}</div><span class="code">${num(r.prog, 0)}% real${r.base != null ? ` · ${num(r.base, 0)}% plano` : ''}</span></div></td>
    <td class="r num">${brlShort(r.cb)}</td><td class="r num">${brlShort(r.ca)}</td><td class="r num">${brlShort(r.eti)}</td><td class="r num">${brlShort(r.eac)}</td>
    <td class="r num ${r.varPct > 5 ? 'c-bad' : r.varPct > 0.5 ? 'c-warn' : 'c-good'}">${brlShort(r.var)}<br><span class="code">${signed(r.varPct, pct)}</span></td>
    <td class="r num">${num(r.hb)}</td><td class="r num">${num(r.hl)}</td>
    <td class="num">${r.status === 'Paused' && !r.active ? '<span class="c-mut">paralisado</span>' : fmtDate(iso(r.fEnd))}</td>
    <td class="r num">${pct(r.mSold)} → <span class="${r.mEtc < r.mSold - 10 ? 'c-bad' : ''}">${pct(r.mEtc)}</span></td>
    <td class="wrapc">${flags(r)}</td>${ed ? `<td><button class="x" data-edit="${esc(r.code)}">Editar</button></td>` : ''}</tr>`).join('');
  const s = (f) => rows.reduce((a, r) => a + (f(r) || 0), 0), cb = s((r) => r.cb), eac = s((r) => r.eac);
  const tot = `<tr class="tot"><td>Total (${rows.length})</td><td></td><td></td><td></td><td class="r num">${brlShort(cb)}</td><td class="r num">${brlShort(s((r) => r.ca))}</td><td class="r num">${brlShort(s((r) => r.eti))}</td><td class="r num">${brlShort(eac)}</td><td class="r num">${brlShort(eac - cb)}<br><span class="code">${signed(cb ? ((eac - cb) / cb) * 100 : 0, pct)}</span></td><td class="r num">${num(s((r) => r.hb))}</td><td class="r num">${num(s((r) => r.hl))}</td><td colspan="${ed ? 4 : 3}"></td></tr>`;
  const t = el.querySelector('#tbl');
  t.innerHTML = head + '<tbody>' + (rows.length ? body + tot : `<tr><td colspan="15">Nenhum contrato para os filtros atuais.</td></tr>`) + '</tbody>';
  t.querySelectorAll('th[data-k]').forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; } render(); }));
  t.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editContract(S.contracts.find((c) => c.code === b.dataset.edit))));
}

// ---------- editing ----------
const FIELDS = [
  ['code', 'Código', 'text'], ['client', 'Cliente', 'text'], ['name', 'Nome', 'text'], ['pm', 'Gerente de projeto', 'text'], ['status', 'Status', 'status'], ['phase', 'Fase', 'text'],
  ['progress', 'Progresso real (%)', 'number'], ['baseline', 'Progresso planejado (%)', 'number'], ['hours_budget', 'Horas orçadas', 'number'], ['hours_logged', 'Horas apontadas', 'number'],
  ['cost_budget', 'Custo orçado (R$)', 'number'], ['cost_actual', 'Custo realizado (R$)', 'number'], ['cost_to_incur', 'Custo a incorrer (R$)', 'number'],
  ['sale_net', 'Venda líquida (R$)', 'number'], ['billed_net', 'Faturado líquido (R$)', 'number'], ['margin_sold', 'Margem vendida (%)', 'number'], ['margin_forecast', 'Margem prevista (%)', 'number'],
  ['start_date', 'Início', 'date'], ['end_date', 'Fim', 'date'], ['go_live', 'Go-live', 'date'],
];
const FROM = { progress: 'prog', baseline: 'base', hours_budget: 'hb', hours_logged: 'hl', cost_budget: 'cb', cost_actual: 'ca', cost_to_incur: 'eti', sale_net: 'sale', billed_net: 'billed', margin_sold: 'mSold', margin_forecast: 'mEtc', start_date: 'start', end_date: 'end', go_live: 'golive' };
function editContract(c) {
  const d = el.querySelector('#dlg');
  const v = (k) => (c ? c[FROM[k] || k] ?? '' : k === 'status' ? 'Execution' : '');
  d.innerHTML = `<form id="cf" style="display:grid;gap:14px"><h2>${c ? 'Editar contrato' : 'Novo contrato'}</h2><div class="form">${FIELDS.map(([k, l, t]) => `<div class="ctl"><label class="label" for="c_${k}">${l}</label>${t === 'status' ? `<select id="c_${k}">${Object.entries(STATUS_LABEL).map(([a, b]) => `<option value="${a}" ${v(k) === a ? 'selected' : ''}>${b}</option>`).join('')}</select>` : `<input id="c_${k}" type="${t}" ${t === 'number' ? 'step="any"' : ''} value="${esc(v(k))}" ${k === 'code' && c ? 'readonly' : ''} ${['code', 'client', 'name'].includes(k) ? 'required' : ''}>`}</div>`).join('')}</div>
    <div id="cmsg" class="msg err" role="status"></div>
    <div class="row"><button class="primary" type="submit">Salvar</button><button type="button" id="ccancel">Cancelar</button><span class="grow"></span>${c ? '<button type="button" id="cdel">Excluir contrato</button>' : ''}</div></form>`;
  d.showModal();
  d.querySelector('#ccancel').onclick = () => d.close();
  const fail = (e) => (d.querySelector('#cmsg').textContent = e.message);
  if (c) d.querySelector('#cdel').onclick = (e) => arm(e.target, 'Excluir contrato', async () => {
    const { error } = await supabase.from('contracts').delete().eq('code', c.code);
    if (error) return fail(error);
    d.close(); await loadContracts(); drawFilters(); render(); toast(`Contrato ${c.code} excluído.`);
  });
  d.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = {};
    FIELDS.forEach(([k, , t]) => { const x = d.querySelector('#c_' + k).value.trim(); row[k] = t === 'number' ? (x === '' ? (['baseline', 'hours_logged', 'margin_sold', 'margin_forecast'].includes(k) ? null : 0) : +x) : t === 'date' ? x || null : x; });
    if (!c) row.parent_code = row.code;
    const { error } = c ? await supabase.from('contracts').update(row).eq('code', c.code) : await supabase.from('contracts').insert(row);
    if (error) return fail(/duplicate/.test(error.message) ? new Error('Já existe um contrato com esse código.') : error);
    d.close(); await loadContracts(); drawFilters(); render(); toast('Contrato salvo.');
  });
}

// ---------- portfolio upload ----------
// Reads the "Informações dos projetos" export (one row per contract), previews what changes and applies it
// as an incremental load (add + update, keep the rest) or a full update (file becomes the portfolio).
const REQUIRED = { cb: 'CUSTO ORÇADO TIMEFLOW', ca: 'VALOR APONTAMENTO E DESPESAS SAP', eti: 'VALOR A INCORRER PELO PROGRESSO', hb: 'HORAS ORÇADAS' };
const statusOf = (v) => (/PARALIS/i.test(v) ? 'Paused' : /ENCERR|CONCLU|FINALIZ/i.test(v) ? 'Closed' : v ? 'Execution' : null);
const pctOf = (v) => (v == null ? null : v > 100 && v <= 10000 ? v / 100 : v); // some rows carry 9600 for 96%
const txt = (v) => String(v ?? '').trim() || null;

async function parsePortfolio(file) {
  const rows = await readTable(file, ['CONTRATO', 'GP']);
  const C = (...n) => col(rows, ...n);
  const k = {
    code: C('CONTRATO'), parent: C('CONTRATO PAI'), proj: C('CÓDIGO PROJETO'), client: C('NOME CLIENTE'), pm: C('GP'), status: C('STATUS CONTRATO'), phase: C('FASE ATUAL PROJETO'),
    prog: C('% REALIZADO PELO PROGRESSO'), base: C('% ESPERADO LINHA BASE'), hb: C('HORAS ORÇADAS'), pwa: C('HORAS PLANEJADAS PWA'), hl: C('HORAS APONTADAS DECIMAIS'),
    cb: C('CUSTO ORÇADO TIMEFLOW'), ca: C('VALOR APONTAMENTO E DESPESAS SAP'), eti: C('VALOR A INCORRER PELO PROGRESSO'), sale: C('VALOR VENDA LÍQUIDO TIMEFLOW'), billed: C('FATURADO LÍQUIDO'),
    ms: C('MARGEM LÍQUIDA VENDA'), mf: C('MARGEM ETC LÍQUIDA PELO PROGRESSO'), start: C('DATA INÍCIO ESTIMADA'), end: C('DATA FIM ESTIMADA'), go: C('GO LIVE'),
    desc: C('DESCRIÇÃO CONTRATO'), dm: C('GERENTE DELIVERY'), ptype: C('TIPO PROJETO'), port: C('PORTFÓLIO SERVIÇO'),
    saleG: C('VALOR VENDA BRUTO TIMEFLOW'), billedG: C('FATURADO BRUTO SAP'), toBill: C('A FATURAR LÍQUIDO'), recv: C('RECEBIDO BRUTO'),
    rep: C('ATRASO STATUS REPORT'), lastRep: C('ÚLTIMO STATUS REPORT'),
  };
  const missing = Object.keys(REQUIRED).filter((x) => !k[x]).map((x) => REQUIRED[x]);
  if (missing.length) throw new Error('faltam as colunas ' + missing.join(', '));
  const out = new Map(), skipped = [];
  let dup = 0;
  rows.forEach((r) => {
    const code = String(r[k.code] ?? '').trim();
    if (!/^[A-Z0-9]{6,}$/.test(code)) return; // totals, filter notes, blank lines
    const st = String(r[k.status] ?? '');
    if (/CANCEL/i.test(st) || /CANCEL/i.test(String(r[k.proj] ?? ''))) { skipped.push(`${code} (cancelado)`); return; }
    const g = (key, f = parseNum) => (k[key] ? f(r[k[key]]) : null), t = (key) => (k[key] ? txt(r[k[key]]) : null);
    if (out.has(code)) dup++;
    out.set(code, {
      code, parent_code: t('parent') || code, client: t('client'), name: t('proj'), pm: t('pm'), status: statusOf(st), phase: t('phase'),
      progress: pctOf(g('prog')), baseline: pctOf(g('base')), hours_budget: g('hb', parseHours), hours_pwa: g('pwa'), hours_logged: g('hl'),
      cost_budget: g('cb'), cost_actual: g('ca'), cost_to_incur: g('eti'), sale_net: g('sale'), billed_net: g('billed'), margin_sold: g('ms'), margin_forecast: g('mf'),
      start_date: g('start', parseDate), end_date: g('end', parseDate), go_live: g('go', parseDate),
      description: t('desc'), delivery_manager: t('dm'), project_type: t('ptype'), service_portfolio: t('port'),
      sale_gross: g('saleG'), billed_gross: g('billedG'), to_bill_net: g('toBill'), received_gross: g('recv'), report_status: t('rep'), last_report: g('lastRep', parseDate),
    });
  });
  if (!out.size) throw new Error('nenhum contrato reconhecido no arquivo (a coluna CONTRATO deve ter códigos como ADUBR000000001)');
  return { rows: [...out.values()], skipped, dup };
}

// Fields compared in the preview: [db column, contract key, label]
const DIFF = [['status', 'status', 'status'], ['pm', 'pm', 'GP'], ['progress', 'prog', 'progresso'], ['baseline', 'base', 'linha de base'], ['hours_budget', 'hb', 'horas orçadas'],
  ['hours_logged', 'hl', 'horas apontadas'], ['cost_budget', 'cb', 'custo orçado'], ['cost_actual', 'ca', 'custo realizado'], ['cost_to_incur', 'eti', 'a incorrer'],
  ['sale_net', 'sale', 'venda líquida'], ['billed_net', 'billed', 'faturado'], ['start_date', 'start', 'início'], ['end_date', 'end', 'fim'], ['go_live', 'golive', 'go-live']];
function diff(row, old, full) {
  const ch = [];
  DIFF.forEach(([db, key, label]) => {
    const nv = row[db], ov = old[key];
    if (nv == null) { if (full && ov != null && ov !== '' && ov !== 0) ch.push(label); return; }
    const same = typeof nv === 'number' ? Math.abs(nv - (+ov || 0)) < 0.01 : String(nv) === String(ov ?? '');
    if (!same) ch.push(label);
  });
  return ch;
}

async function importPortfolio(file) {
  let parsed;
  try { parsed = await parsePortfolio(file); } catch (e) { toast(`Não foi possível ler ${file.name}: ${e.message}.`, 'error'); return; }
  const known = new Map(S.contracts.map((c) => [c.code, c]));
  const d = el.querySelector('#dlg');
  let mode = 'incremental';
  const draw = () => {
    const full = mode === 'full', inFile = new Set(parsed.rows.map((r) => r.code));
    const added = parsed.rows.filter((r) => !known.has(r.code));
    const changed = parsed.rows.filter((r) => known.has(r.code)).map((r) => ({ r, ch: diff(r, known.get(r.code), full) }));
    const upd = changed.filter((x) => x.ch.length), same = changed.length - upd.length;
    const removed = full ? S.contracts.filter((c) => !inFile.has(c.code)) : [];
    const risky = full && S.contracts.length && removed.length > S.contracts.length * 0.3;
    const list = (items, fmt) => `<ul class="files" style="max-height:160px;overflow:auto">${items.map(fmt).join('')}</ul>`;
    d.innerHTML = `<form method="dialog" style="display:grid;gap:14px">
      <h2>Importar projetos</h2>
      <p class="note" style="margin:0"><strong>${esc(file.name)}</strong> · ${parsed.rows.length} contratos reconhecidos${parsed.dup ? ` · ${parsed.dup} linhas repetidas (vale a última)` : ''}${parsed.skipped.length ? ` · ${parsed.skipped.length} ignorados: ${esc(parsed.skipped.join(', '))}` : ''}</p>
      <div class="modes" role="radiogroup" aria-label="Tipo de carga">
        <label><input type="radio" name="pm" value="incremental" ${!full ? 'checked' : ''}> <span><strong>Incremental</strong> — inclui novos e atualiza os do arquivo; células vazias e contratos fora do arquivo são mantidos; nome e cliente editados manualmente são preservados</span></label>
        <label><input type="radio" name="pm" value="full" ${full ? 'checked' : ''}> <span><strong>Atualização completa</strong> — o arquivo passa a ser o portfólio: todos os campos vêm do arquivo e contratos que não estão nele são excluídos</span></label>
      </div>
      <dl class="kv">
        <dt>Novos</dt><dd>${added.length}</dd>
        <dt>Com alterações</dt><dd>${upd.length}</dd>
        <dt>Sem alteração</dt><dd>${same}</dd>
        <dt>Excluídos</dt><dd class="${removed.length ? 'c-bad' : ''}">${full ? removed.length : '— (mantidos na carga incremental)'}</dd>
      </dl>
      ${added.length ? `<details><summary>Novos (${added.length})</summary>${list(added, (r) => `<li>${esc(r.code)} · ${esc(r.name || '')}</li>`)}</details>` : ''}
      ${upd.length ? `<details><summary>Alterados (${upd.length})</summary>${list(upd, (x) => `<li>${esc(x.r.code)} · ${esc(known.get(x.r.code).name)} — <span class="code">${esc(x.ch.join(', '))}</span></li>`)}</details>` : ''}
      ${removed.length ? `<details open><summary>Serão excluídos (${removed.length})</summary>${list(removed, (c) => `<li>${esc(c.code)} · ${esc(c.name)}</li>`)}</details>` : ''}
      ${risky ? `<p class="msg err" style="margin:0">Atenção: a carga completa exclui ${removed.length} de ${S.contracts.length} contratos. Confira se o arquivo não foi exportado com filtros.</p>` : ''}
      <div id="imsg" class="msg err" role="status"></div>
      <div class="row"><button class="primary" type="button" id="iok">${full ? 'Aplicar atualização completa' : 'Aplicar carga incremental'}</button><button type="button" id="icancel">Cancelar</button></div></form>`;
    d.querySelectorAll('input[name=pm]').forEach((i) => (i.onchange = () => { mode = i.value; draw(); }));
    d.querySelector('#icancel').onclick = () => d.close();
    const ok = d.querySelector('#iok'), label = ok.textContent;
    const run = () => apply(file, parsed.rows, mode, d);
    ok.onclick = (e) => (full && removed.length ? arm(e.target, label, run) : run());
  };
  draw();
  d.showModal();
}

async function apply(file, rows, mode, d) {
  const msg = d.querySelector('#imsg'), btn = d.querySelector('#iok');
  btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Gravando…';
  const { data, error } = await supabase.rpc('import_contracts', { p_rows: rows, p_mode: mode, p_file: file.name });
  if (error) {
    btn.disabled = false; msg.className = 'msg err';
    msg.textContent = /import_contracts|schema cache|does not exist/i.test(error.message) ? 'O banco ainda não tem a função de importação. Aplique a migração supabase/migrations/0002_contract_imports.sql.' : error.message;
    return;
  }
  d.close();
  await loadContracts(); drawFilters(); render(); drawImports(); notify('contracts');
  toast(`${file.name}: ${data.added} novos, ${data.updated} atualizados${mode === 'full' ? `, ${data.removed} excluídos` : ''}.`);
}

async function drawImports() {
  const box = el.querySelector('#imports');
  if (!box) return;
  const { data, error } = await supabase.from('contract_imports').select('file_name,mode,rows_in_file,added,updated,removed,created_at').order('created_at', { ascending: false }).limit(8);
  if (error || !data?.length) { box.hidden = true; return; }
  box.hidden = false;
  box.querySelector('ul').innerHTML = data.map((f) => `<li><strong>${esc(f.file_name)}</strong> · ${new Date(f.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${f.mode === 'full' ? 'atualização completa' : 'incremental'} · ${f.rows_in_file} no arquivo: ${f.added} novos, ${f.updated} atualizados${f.mode === 'full' ? `, ${f.removed} excluídos` : ''}</li>`).join('');
}
