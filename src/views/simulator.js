// Scenario simulator: editable forecast per contract and per resource.
import { supabase } from '../supabase.js';
import { S, F, rowCalc, filtered, loadContracts, loadScenarios, isEditor } from '../lib/data.js';
import { HPM, TODAY, esc, num, brlShort, pct, signed, pd, iso, mKey, mLbl, spread, workdays, addMonths, shiftKey, r1, clone, arm, toast, lsGet, lsSet, download, toCsv, parseNum, keepFocus, deacc } from '../lib/util.js';
import { readTable, col } from '../lib/sheet.js';

const NOW = TODAY.getFullYear() * 12 + TODAY.getMonth();
export const SK = Array.from({ length: 15 }, (_, i) => mKey(Math.floor((NOW + i) / 12), (NOW + i) % 12));
const FRAC = {};
SK.forEach((k, i) => { const [y, m] = k.split('-').map(Number), a = new Date(y, m - 1, 1), b = new Date(y, m, 0); FRAC[k] = i === 0 ? Math.max(workdays(TODAY, b) / workdays(a, b), 0.05) : 1; });

const LS = 'srp-sim-draft';
let SIM = lsGet(LS, null), SHOW = lsGet('srp-sim-show', true), CMP = '';
let el;
const save = () => lsSet(LS, SIM);
const byCode = () => Object.fromEntries(S.contracts.map((c) => [c.code, c]));

function seedContracts() {
  const c = {};
  S.contracts.forEach((d) => {
    const r = rowCalc(d); if (!(r.eti > 0)) return;
    c[d.code] = { inc: r.active, start: iso(r.fStart), end: iso(r.fEnd < r.fStart ? r.fStart : r.fEnd), remH: Math.round(r.remH), rate: Math.round(r.cph), ov: {} };
  });
  return c;
}
const seedSim = (name) => ({ name: name || 'Rascunho', c: seedContracts(), r: [] });
function normalize(sim) {
  const base = seedContracts(), known = byCode();
  sim.c = sim.c || {}; sim.r = Array.isArray(sim.r) ? sim.r : [];
  for (const k in base) if (!sim.c[k]) sim.c[k] = base[k];
  for (const k in sim.c) { if (!known[k]) { delete sim.c[k]; continue; } sim.c[k].ov = sim.c[k].ov || {}; }
  sim.r.forEach((r, i) => { r.id = r.id || 'r' + i + Date.now(); r.al = r.al || {}; r.hc = +r.hc || 1; r.role = r.role || ''; });
  sim.name = sim.name || 'Cenário';
  return sim;
}
function cMonths(sc) {
  const out = {}; SK.forEach((k) => (out[k] = 0)); if (!sc || !sc.inc) return out;
  const ov = sc.ov || {}, ovs = Object.values(ov).reduce((a, b) => a + b, 0);
  const s = pd(sc.start), st = s < TODAY ? TODAY : s, auto = {};
  spread(Math.max(0, sc.remH - ovs), st, pd(sc.end), auto, ov);
  SK.forEach((k) => (out[k] = k in ov ? ov[k] : auto[k] || 0));
  return out;
}
const assignedH = (sim, code, k) => sim.r.reduce((a, r) => a + ((r.al[code] || {})[k] || 0), 0) * HPM * FRAC[k];
function assignGap(sim, code, rid) {
  const res = sim.r.find((r) => r.id === rid); if (!res || !sim.c[code]) return 0;
  const dm = cMonths(sim.c[code]); let n = 0;
  SK.forEach((k) => { const gap = dm[k] - assignedH(sim, code, k); if (gap > 0.5) { const a = (res.al[code] ??= {}); a[k] = r1((a[k] || 0) + gap / (HPM * FRAC[k])); n++; } });
  return n;
}
function simTotals(sim, rows) {
  const m = {}; SK.forEach((k) => (m[k] = 0)); let hrs = 0, eac = 0, cb = 0, un = 0;
  rows.forEach((r) => {
    const sc = sim.c[r.code]; cb += r.cb;
    if (!sc) { eac += r.ca + r.eti; return; }
    const mm = cMonths(sc), h = SK.reduce((a, k) => a + mm[k], 0);
    SK.forEach((k) => { m[k] += mm[k]; const g = mm[k] - assignedH(sim, r.code, k); if (g > 32) un += g; });
    if (sc.inc) { hrs += h; eac += r.ca + h * sc.rate; } else eac += r.ca + r.eti;
  });
  return { m, hrs, eac, cb, un };
}

// Line shown on the portfolio chart.
export function simOverlay(rows) {
  if (!SIM || !SHOW || !S.contracts.length) return null;
  return { name: SIM.name, m: simTotals(normalize(SIM), rows).m };
}

export async function mount(root) {
  el = root;
  if (!S.loaded.contracts) await loadContracts();
  if (!S.loaded.scenarios) await loadScenarios();
  SIM = SIM && SIM.c ? normalize(SIM) : seedSim();
  const ed = isEditor();
  el.innerHTML = `<div style="display:grid;gap:14px">
    <section class="panel sim"><div class="row">
      <div class="ctl"><label class="label" for="simName">Nome do cenário</label><input id="simName" type="text" style="width:210px"></div>
      ${ed ? '<button id="simSave" class="simb">Salvar cenário</button>' : ''}
      <div class="ctl"><label class="label" for="simList">Cenários salvos</label><select id="simList"></select></div>
      <button id="simLoad">Abrir</button>${ed ? '<button id="simDel">Excluir</button>' : ''}
      <div class="ctl"><label class="label" for="simCmp">Comparar com</label><select id="simCmp"></select></div>
      <label class="row c" style="gap:6px;padding-bottom:6px;font-size:.88rem"><input type="checkbox" id="simShow"> Mostrar no gráfico do portfólio</label>
      <span class="grow"></span><button id="simReset">Voltar ao forecast atual</button><button id="simCsv">Exportar CSV</button></div>
      <div class="note">O rascunho fica neste navegador. ${ed ? 'Cenários salvos ficam no banco e aparecem para toda a equipe.' : 'Seu perfil é de leitura: você pode simular, mas não salvar cenários para a equipe.'}</div></section>
    <section class="kpis" id="simKpis"></section>
    <section class="panel"><h2>Forecast por contrato</h2>
      <p class="note">Edite qualquer mês para fixar a carga daquele mês. As horas restantes do contrato não mudam: o saldo é redistribuído nos meses que você não editou (meses editados ficam destacados; apague o valor para voltar ao automático). Altere <em>Horas restantes</em> para mudar o escopo ou use <em>Ajustar</em>. <span id="simScope"></span></p>
      <div class="tablewrap"><table id="simC" class="grid"></table></div></section>
    <section class="panel"><div class="row between c"><h2>Recursos e alocações</h2>
      <div class="row"><button id="resAdd">Adicionar recurso</button><button id="resRoster">Adicionar do quadro de recursos</button><label class="btn">Subir horas por recurso (.xlsx/.csv) <input id="ruFile" type="file" accept=".xlsx,.csv" hidden></label></div></div>
      <p class="note">Um recurso é uma pessoa (quantidade 1) ou um pool (quantidade = pessoas). Alocações em FTE por mês; carga acima da quantidade aparece em vermelho. Arquivo de horas: colunas Recurso, Contrato, Mês (aaaa-mm), Horas.</p>
      <div class="modes" role="radiogroup" aria-label="Modo do upload de horas por recurso"><label><input type="radio" name="ruMode" id="ruRep" checked> Upload substitui as alocações dos recursos do arquivo</label><label><input type="radio" name="ruMode" id="ruAdd"> Upload soma às alocações existentes</label></div>
      <div class="tablewrap"><table id="simR" class="grid"></table></div></section>
    <section class="panel"><h2>Cobertura: demanda ainda sem recurso</h2>
      <p class="note">Números positivos são demanda sem ninguém alocado. Escolha um recurso e clique em Alocar para cobrir todos os meses de uma vez.</p>
      <div class="tablewrap"><table id="simV" class="grid"></table></div></section></div>`;
  bind(); render();
}
export function onChange(what) { if (el?.isConnected && what !== 'sim') render(); }

let rT;
function changed() { save(); clearTimeout(rT); rT = setTimeout(render, 0); } // after the browser moves focus, so Tab keeps working

function render() { keepFocus(draw); }
function draw() {
  const rows = filtered(), known = byCode();
  const fte = F.unit === 'fte', u = fte ? 'FTE' : 'h', cap = +F.cap || 0;
  const dv = (h) => (fte ? r1(h / HPM) : Math.round(h));
  const codes = rows.map((r) => r.code).filter((c) => SIM.c[c]);
  const mh = SK.map((k) => `<th class="r">${mLbl(k)}</th>`).join('');
  el.querySelector('#simScope').textContent = `Mostrando ${codes.length} de ${Object.keys(SIM.c).length} contratos com trabalho restante (os filtros da aba Portfólio valem aqui).`;
  const nm = el.querySelector('#simName'); if (document.activeElement !== nm) nm.value = SIM.name;

  const tot = {}; SK.forEach((k) => (tot[k] = 0));
  let h = `<thead><tr><th class="stick">Contrato</th><th>No plano</th><th>Início</th><th>Fim</th><th class="r">Horas restantes</th><th class="r">R$/h</th><th>Ajustar</th><th class="r">Total ${fte ? 'FTE-mês' : 'h'}</th>${mh}<th class="r">EAC vs orçado</th></tr></thead><tbody>`;
  codes.forEach((code) => {
    const sc = SIM.c[code], d = known[code], mm = cMonths(sc), sum = SK.reduce((a, k) => a + mm[k], 0);
    SK.forEach((k) => (tot[k] += mm[k]));
    const eac = d.ca + (sc.inc ? sum * sc.rate : d.eti), v = eac - d.cb, vp = d.cb ? (v / d.cb) * 100 : 0;
    const mis = sc.inc && Math.abs(sum - sc.remH) > 1 ? `<br><span class="chip c-warn" title="Os meses somam ${Math.round(sum)} h; o escopo restante é ${sc.remH} h">≠ escopo</span>` : '';
    h += `<tr class="${sc.inc ? '' : 'off'}"><td class="stick"><span class="nm">${esc(d.name)}</span><span class="code">${esc(code)} · ${esc(d.client)}</span></td>
      <td><input type="checkbox" id="ci-${code}" data-a="inc" data-c="${code}" ${sc.inc ? 'checked' : ''} aria-label="Incluir ${esc(d.name)} no plano"></td>
      <td><input type="date" id="cs-${code}" data-a="start" data-c="${code}" value="${sc.start}" aria-label="Início"></td>
      <td><input type="date" id="ce-${code}" data-a="end" data-c="${code}" value="${sc.end}" aria-label="Fim"></td>
      <td class="r"><input class="n" type="number" min="0" step="10" id="ch-${code}" data-a="remH" data-c="${code}" value="${sc.remH}" aria-label="Horas restantes"></td>
      <td class="r"><input class="n s" type="number" min="0" step="1" id="cr-${code}" data-a="rate" data-c="${code}" value="${sc.rate}" aria-label="Custo por hora"></td>
      <td><select id="cx-${code}" data-a="adj" data-c="${code}" aria-label="Ajustar"><option value="">Ajustar…</option><option value="up10">Escopo +10%</option><option value="dn10">Escopo −10%</option><option value="slip">Adiar 1 mês</option><option value="pull">Antecipar 1 mês</option><option value="clear">Limpar meses editados</option><option value="base">Voltar ao forecast atual</option></select></td>
      <td class="r num">${num(dv(sum), fte ? 1 : 0)}${mis}</td>
      ${SK.map((k) => { const edd = k in sc.ov, x = mm[k]; return `<td class="r"><input class="n${edd ? ' ed' : ''}" inputmode="decimal" id="cm-${code}-${k}" data-a="m" data-c="${code}" data-k="${k}" value="${x > 0.04 || edd ? dv(x) : ''}" ${sc.inc ? '' : 'disabled'} aria-label="${esc(d.name)} ${k}"></td>`; }).join('')}
      <td class="r num ${vp > 5 ? 'c-bad' : vp > 0.5 ? 'c-warn' : 'c-good'}">${brlShort(v)}<br><span class="code">${signed(vp, pct)}</span></td></tr>`;
  });
  const capM = (k) => (fte ? cap * FRAC[k] : cap * HPM * FRAC[k]);
  const line = (label, f, cls) => `<tr class="sum"><td class="stick">${label}</td><td colspan="7"></td>${SK.map((k) => { const x = f(k); return `<td class="r num ${cls ? cls(k, x) : ''}">${num(x, fte ? 1 : 0)}</td>`; }).join('')}<td></td></tr>`;
  h += line('Carga total', (k) => dv(tot[k]), (k, x) => (x > capM(k) + 0.05 ? 'cell-over' : '')) + line(`Capacidade (${cap} FTE)`, (k) => capM(k)) + line('Folga', (k) => capM(k) - dv(tot[k]), (k, x) => (x < -0.05 ? 'cell-over' : 'c-good')) + '</tbody>';
  el.querySelector('#simC').innerHTML = codes.length ? h : '<tbody><tr><td>Nenhum contrato com trabalho restante para os filtros atuais.</td></tr></tbody>';

  // resources
  const cOpts = Object.keys(SIM.c).filter((c) => SIM.c[c].inc).map((c) => [c, known[c].name + ' · ' + known[c].client]);
  let over = 0; const overNames = new Set();
  let rh = `<thead><tr><th class="stick">Recurso / contrato</th><th>Papel</th><th class="r">Qtd.</th>${mh}<th></th></tr></thead><tbody>`;
  SIM.r.forEach((res) => {
    const load = {}; SK.forEach((k) => (load[k] = Object.values(res.al).reduce((a, al) => a + (al[k] || 0), 0)));
    SK.forEach((k) => { if (load[k] > res.hc + 0.05) { over++; overNames.add(res.name); } });
    rh += `<tr class="res"><td class="stick"><input class="t" type="text" id="rn-${res.id}" data-a="rn" data-r="${res.id}" value="${esc(res.name)}" aria-label="Nome do recurso"></td>
      <td><input class="t" type="text" id="rr-${res.id}" data-a="rr" data-r="${res.id}" value="${esc(res.role)}" aria-label="Papel" style="min-width:120px"></td>
      <td class="r"><input class="n s" type="number" min="0" step="1" id="rh-${res.id}" data-a="rh" data-r="${res.id}" value="${res.hc}" aria-label="Quantidade"></td>
      ${SK.map((k) => `<td class="r num ${load[k] > res.hc + 0.05 ? 'cell-over' : ''}" title="Alocado ${num(load[k], 1)} de ${res.hc} FTE">${load[k] ? num(load[k], 1) : ''}</td>`).join('')}
      <td><div class="row" style="flex-wrap:nowrap"><select id="ra-add-${res.id}" data-a="addal" data-r="${res.id}" aria-label="Alocar em contrato"><option value="">+ Alocar em…</option>${cOpts.filter(([c]) => !res.al[c]).map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}</select><button class="x" data-act="delres" data-r="${res.id}">Remover</button></div></td></tr>`;
    Object.keys(res.al).forEach((code) => { const al = res.al[code], d = known[code]; if (!d) return;
      rh += `<tr><td class="stick"><span class="code">↳ ${esc(code)}</span> ${esc(d.name)}</td><td class="code">${esc(d.client)}</td><td></td>
        ${SK.map((k) => `<td class="r"><input class="n${al[k] ? ' ed' : ''}" inputmode="decimal" id="ra-${res.id}-${code}-${k}" data-a="ra" data-r="${res.id}" data-c="${code}" data-k="${k}" value="${al[k] ? al[k] : ''}" aria-label="${esc(res.name)} em ${esc(code)} ${k} FTE"></td>`).join('')}
        <td><button class="x" data-act="delal" data-r="${res.id}" data-c="${code}" aria-label="Remover alocação">×</button></td></tr>`; });
  });
  if (!SIM.r.length) rh += `<tr><td class="stick" colspan="3">Nenhum recurso ainda. Adicione uma pessoa, um pool ou traga do quadro de recursos.</td></tr>`;
  el.querySelector('#simR').innerHTML = rh + '</tbody>';

  // coverage
  const rOpts = SIM.r.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  const unOf = (code) => { const mm = cMonths(SIM.c[code]); return SK.reduce((a, k) => { const g = mm[k] - assignedH(SIM, code, k); return a + (g > 0 ? g : 0); }, 0); };
  const vc = codes.filter((c) => SIM.c[c].inc).map((c) => [c, unOf(c)]).sort((a, b) => b[1] - a[1]);
  let vh = `<thead><tr><th class="stick">Contrato</th><th>Alocar a lacuna em</th><th class="r">Sem recurso (${u})</th>${mh}</tr></thead><tbody>`, covered = 0, any = false;
  vc.forEach(([code, un]) => {
    if (un <= 40) { covered++; return; } any = true;
    const mm = cMonths(SIM.c[code]);
    vh += `<tr><td class="stick"><span class="nm">${esc(known[code].name)}</span><span class="code">${esc(code)}</span></td>
      <td><div class="row" style="flex-wrap:nowrap"><select id="gs-${code}" aria-label="Recurso para ${esc(known[code].name)}">${rOpts}</select><button class="x" data-act="assign" data-c="${code}" ${SIM.r.length ? '' : 'disabled'}>Alocar</button></div></td>
      <td class="r num c-warn">${num(dv(un), fte ? 1 : 0)}</td>${SK.map((k) => { const g = mm[k] - assignedH(SIM, code, k), show = Math.abs(g) > 32; return `<td class="r num ${g > 0 && show ? 'c-warn' : 'c-mut'}">${show ? num(dv(g), fte ? 1 : 0) : ''}</td>`; }).join('')}</tr>`;
  });
  if (!any) vh += `<tr><td class="stick" colspan="3">${vc.length ? 'Todos os contratos do plano estão cobertos.' : 'Nenhum contrato no plano para os filtros atuais.'}</td></tr>`;
  else if (covered) vh += `<tr><td class="stick note" colspan="3">Outros ${covered} contratos estão cobertos.</td></tr>`;
  el.querySelector('#simV').innerHTML = vh + '</tbody>';

  // KPIs
  const t = simTotals(SIM, rows), b = simTotals({ c: seedContracts(), r: [] }, rows);
  const pk = SK.reduce((bb, k) => (t.m[k] > t.m[bb] ? k : bb), SK[0]);
  const overM = SK.filter((k) => dv(t.m[k]) > capM(k) + 0.05).length, dE = t.eac - b.eac, vb = t.eac - t.cb;
  const K = [
    ['Trabalho restante', `${num(t.hrs)} h`, Math.abs(t.hrs - b.hrs) < 1 ? 'Igual ao forecast atual' : `${signed(t.hrs - b.hrs, (x) => num(x))} h vs forecast atual`],
    ['Mês de pico', `${num(dv(t.m[pk]), fte ? 1 : 0)} ${u}`, `${mLbl(pk)} · ${overM} ${overM === 1 ? 'mês' : 'meses'} acima da capacidade`],
    ['EAC simulado', brlShort(t.eac), `<span class="${vb > 0 ? 'c-bad' : 'c-good'}">${signed(t.cb ? (vb / t.cb) * 100 : 0, pct)} vs orçado</span> · ${signed(dE, brlShort)} vs forecast atual`],
    ['Demanda sem recurso', fte ? `${num(t.un / HPM, 1)} FTE-meses` : `${num(t.un)} h`, t.un > HPM ? 'Aloque na seção Cobertura' : 'Demanda coberta'],
    ['Sobrealocação', `${over} ${over === 1 ? 'recurso-mês' : 'recursos-mês'}`, overNames.size ? esc([...overNames].slice(0, 4).join(', ')) : 'Ninguém acima da quantidade'],
  ];
  el.querySelector('#simKpis').innerHTML = K.map((k) => `<div class="kpi"><span class="label">${k[0]}</span><span class="v">${k[1]}</span><span class="d">${k[2]}</span></div>`).join('');

  const sl = el.querySelector('#simList'), cl = el.querySelector('#simCmp'), sv = sl.value;
  sl.innerHTML = S.scenarios.length ? S.scenarios.map((s) => `<option value="${s.id}" ${s.id === sv ? 'selected' : ''}>${esc(s.name)}</option>`).join('') : '<option value="">Nenhum salvo</option>';
  cl.innerHTML = '<option value="">Nada</option>' + S.scenarios.map((s) => `<option value="${s.id}" ${s.id === CMP ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  el.querySelector('#simShow').checked = SHOW;
  const cmp = S.scenarios.find((s) => s.id === CMP);
  if (cmp) {
    const c = simTotals(normalize(clone(cmp.data)), rows);
    el.querySelector('#simKpis').insertAdjacentHTML('beforeend', `<div class="kpi"><span class="label">Comparado: ${esc(cmp.name)}</span><span class="v">${brlShort(c.eac)}</span><span class="d">${num(c.hrs)} h · EAC ${signed(t.eac - c.eac, brlShort)} neste rascunho</span></div>`);
  }
}

function adjust(code, a) {
  const sc = SIM.c[code];
  if (a === 'up10' || a === 'dn10') { const f = a === 'up10' ? 1.1 : 0.9; sc.remH = Math.round(sc.remH * f); for (const k in sc.ov) sc.ov[k] *= f; }
  if (a === 'slip' || a === 'pull') { const n = a === 'slip' ? 1 : -1; sc.start = addMonths(sc.start, n); sc.end = addMonths(sc.end, n); const o = {}; for (const k in sc.ov) o[shiftKey(k, n)] = sc.ov[k]; sc.ov = o; }
  if (a === 'clear') sc.ov = {};
  if (a === 'base') { const b = seedContracts()[code]; if (b) SIM.c[code] = b; }
}

function bind() {
  const n0 = (v) => Math.max(0, parseNum(v) || 0);
  el.addEventListener('change', (e) => {
    const t = e.target, a = t.dataset.a; if (!a) return;
    const fte = F.unit === 'fte', code = t.dataset.c, sc = code && SIM.c[code], res = t.dataset.r && SIM.r.find((r) => r.id === t.dataset.r);
    if (a === 'inc') sc.inc = t.checked;
    else if (a === 'start' && t.value) { sc.start = t.value; if (sc.end < sc.start) sc.end = sc.start; }
    else if (a === 'end' && t.value) { sc.end = t.value; if (sc.end < sc.start) sc.start = sc.end; }
    else if (a === 'remH') sc.remH = Math.round(n0(t.value));
    else if (a === 'rate') sc.rate = n0(t.value);
    else if (a === 'm') { const k = t.dataset.k; if (t.value.trim() === '') delete sc.ov[k]; else sc.ov[k] = fte ? n0(t.value) * HPM : n0(t.value); }
    else if (a === 'adj') { if (t.value) adjust(code, t.value); }
    else if (a === 'rn' && res) res.name = t.value.trim() || 'Sem nome';
    else if (a === 'rr' && res) res.role = t.value.trim();
    else if (a === 'rh' && res) res.hc = n0(t.value);
    else if (a === 'addal' && res && t.value) res.al[t.value] = {};
    else if (a === 'ra' && res) { const al = (res.al[code] ??= {}), k = t.dataset.k; if (t.value.trim() === '' || n0(t.value) === 0) delete al[k]; else al[k] = Math.round(n0(t.value) * 100) / 100; }
    else return;
    changed();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const res = SIM.r.find((r) => r.id === b.dataset.r), code = b.dataset.c;
    if (b.dataset.act === 'delres') arm(b, 'Remover', () => { SIM.r = SIM.r.filter((r) => r !== res); changed(); });
    if (b.dataset.act === 'delal' && res) { delete res.al[code]; changed(); }
    if (b.dataset.act === 'assign') { const rid = el.querySelector('#gs-' + code).value, n = assignGap(SIM, code, rid); toast(n ? `Lacuna alocada em ${n} ${n === 1 ? 'mês' : 'meses'}.` : 'Este contrato não tem lacuna.'); changed(); }
  });
  const $ = (id) => el.querySelector('#' + id);
  $('simName').addEventListener('change', (e) => { SIM.name = e.target.value.trim() || 'Rascunho'; changed(); });
  $('simShow').onchange = (e) => { SHOW = e.target.checked; lsSet('srp-sim-show', SHOW); };
  $('simCmp').onchange = (e) => { CMP = e.target.value; render(); };
  $('simReset').onclick = (e) => arm(e.target, 'Voltar ao forecast atual', () => { SIM = { ...seedSim(SIM.name), r: SIM.r.map((r) => ({ ...r, al: {} })) }; toast('Rascunho refeito a partir do forecast atual. As alocações foram zeradas.'); changed(); });
  $('simLoad').onclick = () => { const s = S.scenarios.find((x) => x.id === $('simList').value); if (!s) return toast('Não há cenário salvo para abrir.'); SIM = normalize(clone(s.data)); SIM.name = s.name; toast(`Cenário “${s.name}” aberto.`); changed(); };
  if (isEditor()) {
    $('simSave').onclick = async () => {
      const name = ($('simName').value || '').trim() || 'Cenário sem nome'; SIM.name = name;
      const { error } = await supabase.from('scenarios').upsert({ name, data: SIM }, { onConflict: 'name' });
      if (error) return toast('Não foi possível salvar: ' + error.message, 'error');
      await loadScenarios(); changed(); toast(`Cenário “${name}” salvo para a equipe.`);
    };
    $('simDel').onclick = (e) => { const s = S.scenarios.find((x) => x.id === $('simList').value); if (!s) return toast('Não há cenário salvo para excluir.');
      arm(e.target, 'Excluir', async () => { const { error } = await supabase.from('scenarios').delete().eq('id', s.id); if (error) return toast(error.message, 'error'); if (CMP === s.id) CMP = ''; await loadScenarios(); render(); toast(`Cenário “${s.name}” excluído.`); }); };
  }
  $('simCsv').onclick = () => {
    const known = byCode();
    const a = [['Contrato', 'Nome', 'Cliente', 'GP', 'No plano', 'Início', 'Fim', 'Horas restantes', 'R$/h', ...SK.map((k) => k + ' h')]];
    Object.keys(SIM.c).forEach((c) => { const sc = SIM.c[c], d = known[c], mm = cMonths(sc); a.push([c, d.name, d.client, d.pm, sc.inc ? 'sim' : 'não', sc.start, sc.end, sc.remH, sc.rate, ...SK.map((k) => Math.round(mm[k]))]); });
    a.push([]); a.push(['Recurso', 'Papel', 'Quantidade', 'Contrato', ...SK.map((k) => k + ' FTE')]);
    SIM.r.forEach((r) => Object.keys(r.al).forEach((c) => a.push([r.name, r.role, r.hc, c, ...SK.map((k) => r.al[c][k] || 0)])));
    download(`${SIM.name.replace(/[^\w-]+/g, '_')}.csv`, toCsv(a), 'text/csv');
  };
  $('resAdd').onclick = () => { const id = 'r' + Date.now(); SIM.r.push({ id, name: 'Novo recurso', role: '', hc: 1, al: {} }); changed(); setTimeout(() => { const x = $('rn-' + id); if (x) { x.focus(); x.select(); } }, 30); };
  $('resRoster').onclick = async () => {
    const { loadResources } = await import('../lib/data.js'); if (!S.loaded.resources) await loadResources();
    const have = new Set(SIM.r.map((r) => deacc(r.name))); let n = 0;
    S.resources.forEach((r) => { const m = S.metrics.get(r.id); const act = m ? m.hours_month > 0 : true; if (!act || have.has(deacc(r.name))) return; SIM.r.push({ id: 'q' + r.id, name: r.name, role: [r.sap_skill, r.seniority].filter(Boolean).join(' · '), hc: 1, al: {} }); n++; });
    toast(n ? `${n} pessoas adicionadas${S.metrics.size ? ' (ativas no mês de referência)' : ''}, sem alocação. Use a Cobertura ou digite os FTE.` : 'Todas as pessoas do quadro já estão no cenário.'); changed();
  };
  $('ruFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const rows = await readTable(f);
      const cR = col(rows, 'recurso', 'resource', 'colaborador', 'pessoa'), cC = col(rows, 'contrato', 'contract'), cM = col(rows, 'mes', 'month', 'data'), cH = col(rows, 'horas', 'hours'), cP = col(rows, 'papel', 'role'), cQ = col(rows, 'quantidade', 'headcount', 'qtd');
      if (!cR || !cC || !cM || !cH) throw new Error('o arquivo precisa das colunas Recurso, Contrato, Mês e Horas');
      const mode = $('ruAdd').checked ? 'add' : 'replace', byName = new Map(SIM.r.map((r) => [deacc(r.name), r]));
      const unknown = new Set(), outside = new Set(), cleared = new Set(); let ok = 0, nw = 0;
      rows.forEach((x) => {
        const name = String(x[cR]).trim(), c = String(x[cC]).trim(), hh = parseNum(x[cH]);
        const mm = String(x[cM] instanceof Date ? iso(x[cM]) : x[cM]).trim().match(/^(\d{4})-(\d{1,2})|^(\d{1,2})[/-](\d{4})$|^\d{1,2}[/-](\d{1,2})[/-](\d{4})/);
        if (!name || !c || !(hh > 0) || !mm) return;
        const k = mm[1] ? `${mm[1]}-${mm[2].padStart(2, '0')}` : mm[3] ? `${mm[4]}-${mm[3].padStart(2, '0')}` : `${mm[6]}-${mm[5].padStart(2, '0')}`;
        if (!SIM.c[c]) return unknown.add(c); if (!SK.includes(k)) return outside.add(k);
        let r = byName.get(deacc(name));
        if (!r) { r = { id: 'u' + Date.now() + nw, name, role: cP ? String(x[cP]).trim() : '', hc: (cQ && parseNum(x[cQ])) || 1, al: {} }; SIM.r.push(r); byName.set(deacc(name), r); nw++; }
        if (mode === 'replace' && !cleared.has(r.id)) { r.al = {}; cleared.add(r.id); }
        const al = (r.al[c] ??= {}); al[k] = Math.round(((al[k] || 0) + hh / (HPM * FRAC[k])) * 100) / 100; ok++;
      });
      let t = `${f.name}: ${ok} linhas ${mode === 'add' ? 'somadas' : 'carregadas'}${nw ? `, ${nw} recursos novos` : ''}.`;
      if (unknown.size) t += ` Contratos fora do plano ignorados: ${[...unknown].slice(0, 5).join(', ')}.`;
      if (outside.size) t += ` Meses fora de ${SK[0]} a ${SK.at(-1)} ignorados.`;
      toast(t); changed();
    } catch (err) { toast(`Não foi possível ler ${f.name}: ${err.message}.`, 'error'); }
  };
}
