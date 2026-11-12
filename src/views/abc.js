// Cost-rate ABC curve: year vs reference month.
import { supabase } from '../supabase.js';
import { S, fetchAll, loadResources } from '../lib/data.js';
import { esc, num, brl, brlShort, pct, signed, mLbl, lsGet, lsSet } from '../lib/util.js';
import { abc, BAND_ORDER } from '../lib/rates.js';

let el, per = lsGet('srp-abc-per', 'Y'), months = [];

export async function mount(root) {
  el = root;
  await loadResources();
  months = await fetchAll(() => supabase.rpc('cost_rate_by_month'), 'Taxa por mês');
  draw();
}
export function onChange(what) { if (el?.isConnected && what === 'hours') mount(el); }

function draw() {
  const all = S.resources.map((r) => ({ ...r, m: S.metrics.get(r.id) })).filter((r) => r.m && r.m.rate_year > 0);
  if (!all.length) { el.innerHTML = `<section class="panel"><h2>Custo-hora dos recursos</h2><p class="note">Ainda não há taxas de custo. Suba um relatório do TIMEFLOW com a coluna VALOR ou TAXA na aba Horas.</p></section>`; return; }
  const mref = all.map((r) => r.m.ref_month).filter(Boolean).sort().at(-1) || '', ml = mref ? mLbl(mref) : 'mês', yr = mref.slice(0, 4);
  const act = all.filter((r) => r.m.ref_month === mref && r.m.hours_month > 0 && r.m.rate_month > 0);
  const Y = abc(all.map((r) => ({ rate: +r.m.rate_year, hours: +r.m.hours_year, cost: +r.m.cost_year })));
  const O = abc(act.map((r) => ({ rate: +r.m.rate_month, hours: +r.m.hours_month, cost: +r.m.cost_month })));
  const SY = Y.summary, SO = O.summary, tr = months.filter((m) => m.month.slice(0, 4) === yr && m.weighted_rate != null && m.month <= mref);
  const peak = tr.reduce((a, b) => (+b.weighted_rate > +a.weighted_rate ? b : a), tr[0] || { weighted_rate: 0, month: mref });
  const fb = (X, n) => X.bands.find((b) => b.band === n) || { n: 0, pres: 0, pct: 0, pv: 0, avg: 0, cls: '–' };
  const dW = SY.wavg ? (SO.wavg / SY.wavg - 1) * 100 : 0;

  el.innerHTML = `<div style="display:grid;gap:14px">
    <section class="panel"><h2>Custo-hora de ${brl(SY.wavg)} em ${yr} e ${brl(SO.wavg)} em ${ml}</h2>
      <p class="note">Em ${yr}, ${SY.n} recursos apontaram ${num(SY.h)} horas a um custo de ${brlShort(SY.v)}. Em ${ml} eram ${SO.n} recursos, com taxa ponderada ${Math.abs(dW) < 0.05 ? 'igual à' : pct(Math.abs(dW)) + (dW < 0 ? ' abaixo da' : ' acima da')} média do ano.</p>
      <div class="tablewrap"><table id="cmp"></table></div></section>
    <section class="panel"><div class="row between c"><div><h2>Taxa por mês</h2><div class="sub">Ponderada = custo ÷ horas do mês. Simples = média das taxas de quem apontou. O número sob cada mês é a quantidade de pessoas.</div></div>
      <div class="legend"><span><span class="sw" style="background:var(--accent);height:3px;vertical-align:3px"></span>Ponderada</span><span><span class="sw" style="background:var(--muted);height:3px;vertical-align:3px"></span>Simples</span><span><span class="sw" style="background:var(--bad);height:2px;vertical-align:3px"></span>Média do ano</span></div></div>
      <div class="tablewrap"><svg id="trend" viewBox="0 0 900 300" role="img" aria-label="Taxa de custo-hora por mês" style="width:100%;min-width:620px;height:auto"></svg></div></section>
    <section class="panel"><div class="row between c"><div><h2 id="pTitle"></h2><div class="sub">Peso da faixa = nº de recursos × taxa média. Barras em ordem decrescente de peso; a linha é o acumulado. Classe A até 80%, B até 95%, C o restante.</div></div>
      <div class="seg" role="group" aria-label="Período"><button id="pY" aria-pressed="${per === 'Y'}">Ano ${yr}</button><button id="pO" aria-pressed="${per === 'O'}">${ml}</button></div></div>
      <div class="tablewrap"><svg id="pareto" viewBox="0 0 900 390" role="img" aria-label="Curva ABC por faixa de custo-hora" style="width:100%;min-width:620px;height:auto"></svg></div></section>
    <section class="panel"><h2>Faixas: ano × ${ml}</h2><div class="tablewrap"><table id="bands"></table></div></section></div>`;

  const R = [['Taxa média ponderada', SY.wavg, SO.wavg, 1], ['Taxa média simples', SY.simple, SO.simple, 1], ['Mediana', SY.median, SO.median, 1]];
  el.querySelector('#cmp').innerHTML = `<thead><tr><th>Indicador</th><th class="r">Ano ${yr}</th><th class="r">${ml}</th><th class="r">${ml} vs ano</th></tr></thead><tbody>` +
    R.map(([l, a, b]) => `<tr><td>${l}</td><td class="r num">${brl(a)}</td><td class="r num">${brl(b)}</td><td class="r num ${b > a ? 'c-bad' : 'c-good'}">${signed(b - a, (x) => brl(x))} (${signed(a ? (b / a - 1) * 100 : 0, pct)})</td></tr>`).join('') +
    `<tr><td>Recursos</td><td class="r num">${SY.n}</td><td class="r num">${SO.n}</td><td class="r num c-mut">${pct(SY.n ? (SO.n / SY.n) * 100 : 0)} do ano</td></tr>
     <tr><td>Horas</td><td class="r num">${num(SY.h)}</td><td class="r num">${num(SO.h)}</td><td></td></tr>
     <tr><td>Custo</td><td class="r num">${brlShort(SY.v)}</td><td class="r num">${brlShort(SO.v)}</td><td></td></tr>
     <tr><td>Faixa de taxas</td><td class="r num">${brl(SY.mn)} – ${brl(SY.mx)}</td><td class="r num">${brl(SO.mn)} – ${brl(SO.mx)}</td><td></td></tr></tbody>`;

  // trend
  if (tr.length) {
    const W = 900, H = 300, L = 64, Rr = 30, T = 30, B = 44, iw = W - L - Rr, ih = H - T - B;
    const vals = tr.flatMap((m) => [+m.weighted_rate, +m.simple_rate]).concat(SY.wavg), lo = Math.floor((Math.min(...vals) - 3) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 3) / 5) * 5;
    const y = (v) => T + ih - ((v - lo) / (hi - lo)) * ih, x = (i) => L + (iw * (i + 0.5)) / tr.length;
    let g = '';
    for (let v = lo; v <= hi; v += 5) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">R$ ${v}</text>`;
    g += `<line x1="${L}" x2="${W - Rr}" y1="${y(SY.wavg)}" y2="${y(SY.wavg)}" stroke="var(--bad)" stroke-dasharray="5 4"/>`;
    const line = (k, c, w) => `<polyline points="${tr.map((m, i) => `${x(i)},${y(+m[k])}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
    g += line('simple_rate', 'var(--muted)', 1.5) + line('weighted_rate', 'var(--accent)', 2.5);
    tr.forEach((m, i) => { const mark = i === 0 || i === tr.length - 1 || m === peak;
      g += `<circle cx="${x(i)}" cy="${y(+m.weighted_rate)}" r="${mark ? 5 : 3.5}" fill="var(--accent)"><title>${mLbl(m.month)}: ponderada ${brl(+m.weighted_rate)}, simples ${brl(+m.simple_rate)}, ${m.people} pessoas, ${num(+m.hours)} h</title></circle><circle cx="${x(i)}" cy="${y(+m.simple_rate)}" r="2.5" fill="var(--muted)"/>`;
      if (mark) g += `<text x="${x(i)}" y="${y(+m.weighted_rate) - 10}" text-anchor="middle" font-size="11.5" fill="var(--ink)" stroke="var(--panel)" stroke-width="4" paint-order="stroke">${brl(+m.weighted_rate)}</text>`;
      g += `<text x="${x(i)}" y="${H - 22}" text-anchor="middle" font-size="11.5" fill="var(--ink)">${mLbl(m.month)}</text><text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${m.people}</text>`; });
    el.querySelector('#trend').innerHTML = g;
  }

  // pareto
  const pareto = (which) => {
    per = which; lsSet('srp-abc-per', per);
    const X = per === 'Y' ? Y : O, Bd = X.bands, W = 900, H = 390, L = 56, Rr = 56, T = 24, Bt = 80, iw = W - L - Rr, ih = H - T - Bt;
    const bw = iw / Math.max(Bd.length, 1), maxP = Math.max(40, Math.ceil(Math.max(...Bd.map((b) => b.pct), 0) / 10) * 10), y1 = (v) => T + ih - (v / maxP) * ih, y2 = (v) => T + ih - (v / 100) * ih, cx = (i) => L + bw * i + bw / 2;
    const colr = { A: 'var(--a)', B: 'var(--b)', C: 'var(--c)' };
    let g = `<line x1="${L}" x2="${W - Rr}" y1="${T + ih}" y2="${T + ih}" stroke="var(--line)"/>`;
    for (let v = 0; v <= maxP; v += 10) g += `<line x1="${L}" x2="${W - Rr}" y1="${y1(v)}" y2="${y1(v)}" stroke="var(--line)" stroke-dasharray="2 3" opacity=".7"/><text x="${L - 8}" y="${y1(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}%</text>`;
    [0, 25, 50, 75, 100].forEach((v) => (g += `<text x="${W - Rr + 8}" y="${y2(v) + 4}" font-size="11" fill="var(--muted)">${v}%</text>`));
    [80, 95].forEach((v) => (g += `<line x1="${L}" x2="${W - Rr}" y1="${y2(v)}" y2="${y2(v)}" stroke="var(--bad)" stroke-dasharray="5 4" stroke-width="1.2"/><text x="${W - Rr - 6}" y="${y2(v) + 14}" text-anchor="end" font-size="11" fill="var(--bad)">limite ${v}%</text>`));
    Bd.forEach((b, i) => { const x = cx(i) - bw * 0.32, w = bw * 0.64;
      g += `<rect x="${x}" y="${y1(b.pct)}" width="${w}" height="${T + ih - y1(b.pct)}" fill="${colr[b.cls]}" rx="2"><title>${b.band}: ${b.n} recursos, peso ${pct(b.pct)}, acumulado ${pct(b.cum)}</title></rect>
        <text x="${cx(i)}" y="${y1(b.pct) - 6}" text-anchor="middle" font-size="12" fill="var(--ink)">${pct(b.pct)}</text>
        <text x="${cx(i)}" y="${T + ih + 18}" text-anchor="middle" font-size="11.5" fill="var(--ink)">${b.band}</text>
        <text x="${cx(i)}" y="${T + ih + 34}" text-anchor="middle" font-size="11" fill="var(--muted)">${b.n} recursos</text>
        <text x="${cx(i)}" y="${T + ih + 50}" text-anchor="middle" font-size="11" fill="var(--muted)">classe ${b.cls}</text>`; });
    g += `<polyline points="${Bd.map((b, i) => `${cx(i)},${y2(b.cum)}`).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
    Bd.forEach((b, i) => (g += `<circle cx="${cx(i)}" cy="${y2(b.cum)}" r="4" fill="var(--panel)" stroke="var(--ink)" stroke-width="2"/>` + (i === Bd.length - 1 ? '' : `<text x="${cx(i) + 9}" y="${y2(b.cum) + 17}" font-size="11" fill="var(--ink)" stroke="var(--panel)" stroke-width="4" paint-order="stroke">${pct(b.cum)}</text>`)));
    el.querySelector('#pareto').innerHTML = g;
    const A = Bd.filter((b) => b.cls === 'A'), aN = A.reduce((s, b) => s + b.n, 0);
    el.querySelector('#pTitle').textContent = `${per === 'Y' ? 'Ano ' + yr : ml}: classe A com ${A.length} faixas, ${aN} recursos (${pct(X.summary.n ? (aN / X.summary.n) * 100 : 0)}) e ${pct(A.reduce((s, b) => s + b.pct, 0))} do peso`;
    el.querySelector('#pY').setAttribute('aria-pressed', per === 'Y'); el.querySelector('#pO').setAttribute('aria-pressed', per === 'O');
  };
  el.querySelector('#pY').onclick = () => pareto('Y'); el.querySelector('#pO').onclick = () => pareto('O'); pareto(per);

  const pp = (v) => signed(v, (x) => num(x, 1));
  el.querySelector('#bands').innerHTML = `<thead><tr><th>Faixa (R$/h)</th><th>Classe ano</th><th class="r">Recursos</th><th class="r">% rec.</th><th class="r">Taxa média</th><th class="r">% peso</th><th class="r">% custo</th><th>Classe ${esc(ml)}</th><th class="r">Recursos</th><th class="r">% rec.</th><th class="r">Taxa média</th><th class="r">% peso</th><th class="r">% custo</th><th class="r">Δ % rec. (p.p.)</th><th class="r">Δ % custo (p.p.)</th></tr></thead><tbody>` +
    BAND_ORDER.map((n) => { const a = fb(Y, n), b = fb(O, n); const cell = (x) => `<td>${x.n ? `<span class="cls c${x.cls}">${x.cls}</span>` : '—'}</td><td class="r num">${x.n}</td><td class="r num">${pct(x.pres)}</td><td class="r num">${x.n ? brl(x.avg) : '—'}</td><td class="r num">${pct(x.pct)}</td><td class="r num">${pct(x.pv)}</td>`;
      return `<tr><td>${n}</td>${cell(a)}${cell(b)}<td class="r num">${pp(b.pres - a.pres)}</td><td class="r num">${pp(b.pv - a.pv)}</td></tr>`; }).join('') + '</tbody>';
}
