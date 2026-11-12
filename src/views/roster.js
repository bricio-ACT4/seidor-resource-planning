// Resource roster: SAP skill, seniority, start date and (for editors) cost rates.
import { supabase } from '../supabase.js';
import { S, loadResources, isEditor } from '../lib/data.js';
import { TODAY, esc, num, brl, pd, mLbl, slug, deacc, arm, toast, download, toCsv, parseDate, parseNum, keepFocus, fmtDate } from '../lib/util.js';
import { readTable, col } from '../lib/sheet.js';
import { bandOf, abc } from '../lib/rates.js';

export const SKILLS = ['FI', 'CO', 'FI/CO', 'SD', 'MM', 'PP', 'QM', 'PM / EAM', 'WM / EWM', 'TM', 'Tax / Reforma Tributária', 'Agro (ACM / CM)', 'ABAP', 'CPI / BTP integration', 'Fiori / UI5', 'Basis', 'Analytics (BW / SAC)', 'SuccessFactors / HCM', 'Ariba', 'Solution architecture', 'Project management', 'Other'];
export const SENS = ['Intern', 'Trainee', 'Junior', 'Mid-level', 'Senior', 'Specialist', 'Manager'];
export const SEN_LABEL = { Intern: 'Estagiário', Trainee: 'Trainee', Junior: 'Júnior', 'Mid-level': 'Pleno', Senior: 'Sênior', Specialist: 'Especialista', Manager: 'Gerente' };
const SEN_ALIAS = { estagiario: 'Intern', estagio: 'Intern', intern: 'Intern', trainee: 'Trainee', junior: 'Junior', jr: 'Junior', pleno: 'Mid-level', pl: 'Mid-level', mid: 'Mid-level', 'mid-level': 'Mid-level', senior: 'Senior', sr: 'Senior', especialista: 'Specialist', specialist: 'Specialist', gerente: 'Manager', coordenador: 'Manager', manager: 'Manager' };
const normSkill = (v) => { const t = deacc(v); if (!t) return ''; return SKILLS.find((o) => deacc(o) === t) || SKILLS.find((o) => deacc(o).split(/[ /()]+/).filter(Boolean).includes(t)) || String(v).trim(); };
const normSen = (v) => { const t = deacc(v); if (!t) return ''; return SEN_ALIAS[t] || SENS.find((o) => deacc(o) === t) || String(v).trim(); };

let el, sort = 'name', dir = 1;
const tenureM = (d) => { if (!d) return null; const x = pd(d); return x > TODAY ? null : (TODAY - x) / 2629800000; };
const tenure = (d) => { const m = tenureM(d); if (m == null) return ''; const y = Math.floor(m / 12), r = Math.floor(m % 12); return y ? `${y}a ${r}m` : `${r}m`; };
const opts = (list, cur, label = (x) => x) => { const all = [...list]; if (cur && !all.includes(cur)) all.push(cur); return '<option value="">—</option>' + all.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(label(o))}</option>`).join(''); };
const senL = (s) => SEN_LABEL[s] || s;

export async function mount(root) {
  el = root;
  await loadResources();
  const ed = isEditor();
  el.innerHTML = `<div style="display:grid;gap:14px">
    <section class="panel"><div class="row between c">
      <div><h2>Quadro de recursos</h2><div class="sub">${ed ? 'Consultores com horas no TIMEFLOW, suas taxas de custo e classificação.' : 'Consultores e sua classificação. As taxas de custo individuais são visíveis apenas para editores.'}</div></div>
      ${ed ? '<div class="row"><button id="rsAdd">Adicionar recurso</button><button id="rsSync">Recalcular taxas a partir das horas</button><button id="rsIO">Importar / exportar</button></div>' : ''}</div>
      <form class="panel dashed" id="rsNew" hidden><strong>Novo recurso</strong><div class="row">
        <div class="ctl"><label class="label" for="nName">Nome</label><input id="nName" type="text" required style="width:240px"></div>
        <div class="ctl"><label class="label" for="nSkill">Skill SAP</label><select id="nSkill">${opts(SKILLS, '')}</select></div>
        <div class="ctl"><label class="label" for="nSen">Senioridade</label><select id="nSen">${opts(SENS, '', senL)}</select></div>
        <div class="ctl"><label class="label" for="nDate">Data de entrada</label><input id="nDate" type="date"></div>
        <div class="ctl"><label class="label" for="nRate">Taxa de custo (R$/h)</label><input id="nRate" type="number" min="0" step="0.01" style="width:110px"></div>
        <button class="primary" type="submit">Salvar</button><button type="button" id="nCancel">Cancelar</button></div></form>
      <div class="panel dashed" id="rsIOp" hidden><strong>Classificar vários recursos de uma vez</strong>
        <span class="note">Exporte o quadro, preencha no Excel e suba de volta (.xlsx ou .csv) com as colunas Nome, Skill SAP, Senioridade e Data de entrada. Os nomes são casados ignorando acentos e maiúsculas.</span>
        <div class="modes"><label><input type="radio" name="rsMode" id="mFill" checked> Preencher só campos vazios</label><label><input type="radio" name="rsMode" id="mRep"> Substituir valores existentes</label><label><input type="checkbox" id="mCreate"> Criar nomes que não estão no quadro</label></div>
        <div class="row"><input type="file" id="rsFile" accept=".xlsx,.csv"><span class="grow"></span><button id="rsCsv">Exportar quadro (CSV)</button></div></div>
    </section>
    <section class="kpis" id="rsKpis"></section>
    <section class="grid2"><div class="panel"><h2>Por skill SAP</h2><div class="tablewrap"><table id="bySkill" class="grid"></table></div></div>
      <div class="panel"><h2>Por senioridade</h2><div class="tablewrap"><table id="bySen" class="grid"></table></div></div></section>
    <section class="panel"><div class="row c">
      <input id="rsQ" type="search" placeholder="Buscar nome ou contrato" aria-label="Buscar nome ou contrato" style="width:240px">
      <select id="fSkill" aria-label="Filtrar por skill"></select><select id="fSen" aria-label="Filtrar por senioridade"></select>
      <select id="fSit" aria-label="Filtrar por situação"><option value="">Todos</option>${ed ? '<option value="act">Ativos no mês de referência</option><option value="ina">Sem horas no mês de referência</option>' : ''}<option value="todo">Falta skill, senioridade ou data</option></select>
      <span class="note" id="rsCount"></span></div>
      <div class="tablewrap tall"><table id="rsT" class="grid"></table></div></section></div>`;
  bind(); render();
}

const rows = () => S.resources.map((r) => ({ ...r, m: S.metrics.get(r.id) || null }));
function render() { keepFocus(draw); }
function draw() {
  const ed = isEditor(), all = rows();
  const mref = all.map((d) => d.m?.ref_month).filter(Boolean).sort().at(-1) || '', ml = mref ? mLbl(mref) : 'mês';
  const active = (d) => d.m && d.m.ref_month === mref && d.m.hours_month > 0;
  const fS = el.querySelector('#fSkill'), fE = el.querySelector('#fSen'), vs = fS.value, ve = fE.value;
  const usedS = [...new Set([...SKILLS, ...all.map((d) => d.sap_skill).filter(Boolean)])], usedE = [...new Set([...SENS, ...all.map((d) => d.seniority).filter(Boolean)])];
  fS.innerHTML = '<option value="">Todos os skills</option><option value="__none">Sem skill</option>' + usedS.map((o) => `<option ${o === vs ? 'selected' : ''}>${esc(o)}</option>`).join('');
  fE.innerHTML = '<option value="">Todas as senioridades</option><option value="__none">Sem senioridade</option>' + usedE.map((o) => `<option value="${esc(o)}" ${o === ve ? 'selected' : ''}>${esc(senL(o))}</option>`).join('');
  if (vs) fS.value = vs; if (ve) fE.value = ve;

  const full = all.filter((d) => d.sap_skill && d.seniority && d.start_date), tm = all.map((d) => tenureM(d.start_date)).filter((v) => v != null);
  const K = [['Recursos', num(all.length), ed && mref ? `${all.filter(active).length} ativos em ${ml}` : 'No quadro'],
    ['Classificados', `${full.length} de ${all.length}`, `${all.filter((d) => d.sap_skill).length} com skill · ${all.filter((d) => d.seniority).length} com senioridade · ${all.filter((d) => d.start_date).length} com data`],
    ['Tempo médio de casa', tm.length ? num(tm.reduce((a, b) => a + b, 0) / tm.length / 12, 1) + ' anos' : '—', tm.length ? `A partir de ${tm.length} datas de entrada` : 'Preencha as datas de entrada']];
  if (ed) {
    const hA = all.reduce((a, d) => a + (+d.m?.hours_year || 0), 0), vA = all.reduce((a, d) => a + (+d.m?.cost_year || 0), 0), ac = all.filter(active);
    const hM = ac.reduce((a, d) => a + +d.m.hours_month, 0), vM = ac.reduce((a, d) => a + +d.m.cost_month, 0);
    K.splice(2, 0, ['Taxa de custo, ano', hA ? brl(vA / hA) : '—', hA ? 'Custo ÷ horas, ponderada' : 'Suba o TIMEFLOW na aba Horas'], [`Taxa de custo, ${ml}`, hM ? brl(vM / hM) : '—', 'Só recursos ativos']);
  }
  el.querySelector('#rsKpis').innerHTML = K.map((k) => `<div class="kpi"><span class="label">${k[0]}</span><span class="v">${k[1]}</span><span class="d">${k[2]}</span></div>`).join('');

  const grp = (key, order, id, title, lab = (x) => x) => {
    const g = {}; all.forEach((d) => (g[d[key] || '~'] ??= []).push(d));
    const keys = Object.keys(g).sort((a, b) => (a === '~') - (b === '~') || ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    el.querySelector(id).innerHTML = `<thead><tr><th>${title}</th><th class="r">Pessoas</th>${ed ? '<th class="r">Ativos</th><th class="r">Taxa média</th><th class="r">Taxa ponderada</th><th class="r">Horas no ano</th>' : ''}</tr></thead><tbody>` + keys.map((k) => {
      const l = g[k], h = l.reduce((a, d) => a + (+d.m?.hours_year || 0), 0), v = l.reduce((a, d) => a + (+d.m?.cost_year || 0), 0), rs = l.filter((d) => d.m?.rate_year > 0);
      return `<tr><td class="${k === '~' ? 'c-mut' : ''}">${k === '~' ? 'Não classificado' : esc(lab(k))}</td><td class="r num">${l.length}</td>${ed ? `<td class="r num">${l.filter(active).length}</td><td class="r num">${rs.length ? brl(rs.reduce((a, d) => a + +d.m.rate_year, 0) / rs.length) : '—'}</td><td class="r num">${h ? brl(v / h) : '—'}</td><td class="r num">${num(h)}</td>` : ''}</tr>`; }).join('') + '</tbody>';
  };
  grp('sap_skill', SKILLS, '#bySkill', 'Skill SAP'); grp('seniority', SENS, '#bySen', 'Senioridade', senL);

  const q = deacc(el.querySelector('#rsQ').value), sit = el.querySelector('#fSit').value;
  const list = all.filter((d) => (!q || deacc(d.name + ' ' + (d.m?.main_contracts || []).join(' ')).includes(q)) && (!vs || (vs === '__none' ? !d.sap_skill : d.sap_skill === vs)) && (!ve || (ve === '__none' ? !d.seniority : d.seniority === ve)) &&
    (!sit || (sit === 'act' && active(d)) || (sit === 'ina' && !active(d)) || (sit === 'todo' && !(d.sap_skill && d.seniority && d.start_date))));
  const sv = (d) => ({ name: d.name, skill: d.sap_skill, sen: SENS.indexOf(d.seniority), date: d.start_date || '', tenure: tenureM(d.start_date) ?? -1, ry: +d.m?.rate_year || 0, rm: active(d) ? +d.m.rate_month : 0, hy: +d.m?.hours_year || 0, hm: active(d) ? +d.m.hours_month : 0, last: d.m?.last_month || '' }[sort]);
  list.sort((a, b) => { const x = sv(a), y = sv(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * dir; });
  el.querySelector('#rsCount').textContent = `${list.length} de ${all.length}`;
  const cls = ed ? abc(all.filter((d) => d.m).map((d) => ({ rate: +d.m.rate_year }))).cls : {};
  const H = [['name', 'Recurso'], ['skill', 'Skill SAP'], ['sen', 'Senioridade'], ['date', 'Data de entrada'], ['tenure', 'Tempo de casa']].concat(ed ? [['ry', 'Taxa ano', 'r'], ['rm', `Taxa ${ml}`, 'r'], ['ry', 'Faixa · ABC'], ['hy', 'Horas ano', 'r'], ['hm', `Horas ${ml}`, 'r'], ['last', 'Principais contratos'], ['last', 'Últimas horas']] : []);
  const dis = ed ? '' : 'disabled';
  el.querySelector('#rsT').innerHTML = `<thead><tr>${H.map(([k, l, c], i) => `<th class="${c || ''} ${i ? '' : 'stick'}" data-k="${k}">${l}${sort === k && (i < 7 || k !== 'ry') ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}<th></th></tr></thead><tbody>` +
    (list.length ? list.map((d) => { const b = bandOf(+d.m?.rate_year), c = cls[b], a = active(d);
      return `<tr><td class="stick"><span class="nm">${esc(d.name)}</span>${d.origin === 'manual' ? '<span class="code">cadastro manual</span>' : ''}</td>
      <td>${ed ? `<select id="sk-${d.id}" data-f="sap_skill" data-id="${d.id}" aria-label="Skill SAP de ${esc(d.name)}">${opts(SKILLS, d.sap_skill)}</select>` : esc(d.sap_skill || '—')}</td>
      <td>${ed ? `<select id="se-${d.id}" data-f="seniority" data-id="${d.id}" aria-label="Senioridade de ${esc(d.name)}">${opts(SENS, d.seniority, senL)}</select>` : esc(senL(d.seniority) || '—')}</td>
      <td>${ed ? `<input type="date" id="dt-${d.id}" data-f="start_date" data-id="${d.id}" value="${d.start_date || ''}" aria-label="Data de entrada de ${esc(d.name)}">` : d.start_date ? fmtDate(d.start_date) : '—'}</td>
      <td class="num">${tenure(d.start_date)}</td>
      ${ed ? `<td class="r num">${d.m?.rate_year > 0 ? brl(+d.m.rate_year) : '—'}</td><td class="r num">${a && d.m.rate_month > 0 ? brl(+d.m.rate_month) : '—'}</td>
      <td>${b ? `${b} <span class="cls c${c}">${c}</span>` : ''}</td><td class="r num">${num(+d.m?.hours_year || 0)}</td><td class="r num">${a ? num(+d.m.hours_month) : ''}</td>
      <td class="code wrapc">${esc((d.m?.main_contracts || []).join(', '))}</td><td class="num">${d.m?.last_month ? mLbl(d.m.last_month) : ''}</td>` : ''}
      <td>${ed && d.origin === 'manual' ? `<button class="x" data-del="${d.id}">Remover</button>` : ''}</td></tr>`; }).join('') : `<tr><td class="stick" colspan="6">Nenhum recurso para os filtros atuais.</td></tr>`) + '</tbody>';
  el.querySelectorAll('#rsT th[data-k]').forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (sort === k) dir *= -1; else { sort = k; dir = ['ry', 'rm', 'hy', 'hm', 'tenure'].includes(k) ? -1 : 1; } render(); }));
}

function bind() {
  const $ = (id) => el.querySelector('#' + id);
  ['rsQ', 'fSkill', 'fSen', 'fSit'].forEach((id) => $(id).addEventListener('input', render));
  if (!isEditor()) return;
  $('rsT').addEventListener('change', async (e) => {
    const t = e.target, f = t.dataset.f; if (!f) return;
    const r = S.resources.find((x) => x.id === t.dataset.id), v = f === 'start_date' ? t.value || null : t.value;
    const { error } = await supabase.from('resources').update({ [f]: v }).eq('id', r.id);
    if (error) { toast('Não foi possível salvar: ' + error.message, 'error'); t.value = r[f] || ''; return; }
    r[f] = v; toast(`${r.name}: ${f === 'sap_skill' ? 'skill' : f === 'seniority' ? 'senioridade' : 'data de entrada'} salva.`); render();
  });
  $('rsT').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (!b) return; const r = S.resources.find((x) => x.id === b.dataset.del);
    arm(b, 'Remover', async () => { const { error } = await supabase.from('resources').delete().eq('id', r.id); if (error) return toast(error.message, 'error'); await loadResources(); render(); toast(`${r.name} removido.`); }); });
  $('rsAdd').onclick = () => { $('rsNew').hidden = !$('rsNew').hidden; if (!$('rsNew').hidden) $('nName').focus(); };
  $('nCancel').onclick = () => ($('rsNew').hidden = true);
  $('rsNew').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('nName').value.trim(), id = slug(name);
    if (S.resources.some((r) => r.id === id)) return toast('Esse nome já está no quadro.', 'error');
    const { error } = await supabase.from('resources').insert({ id, name, sap_skill: $('nSkill').value, seniority: $('nSen').value, start_date: $('nDate').value || null, origin: 'manual' });
    if (error) return toast(error.message, 'error');
    const rate = parseNum($('nRate').value);
    if (rate > 0) await supabase.from('resource_metrics').insert({ resource_id: id, rate_year: rate });
    $('rsNew').reset(); $('rsNew').hidden = true; await loadResources(); render(); toast(`${name} adicionado.`);
  });
  $('rsSync').onclick = async (e) => {
    e.target.disabled = true;
    const { data, error } = await supabase.rpc('refresh_resource_metrics');
    e.target.disabled = false;
    if (error) return toast('Não foi possível recalcular: ' + error.message, 'error');
    await loadResources(); render(); toast(data ? `Taxas e horas recalculadas para ${data} recursos. A classificação foi mantida.` : 'Não há horas carregadas. Suba o TIMEFLOW na aba Horas.');
  };
  $('rsIO').onclick = () => ($('rsIOp').hidden = !$('rsIOp').hidden);
  $('rsCsv').onclick = () => download('quadro-de-recursos.csv', toCsv([['Nome', 'Skill SAP', 'Senioridade', 'Data de entrada', 'Taxa ano (R$/h)', 'Horas ano', 'Últimas horas', 'Principais contratos']].concat(rows().map((d) => [d.name, d.sap_skill, senL(d.seniority), d.start_date || '', d.m?.rate_year ?? '', d.m?.hours_year ?? '', d.m?.last_month ?? '', (d.m?.main_contracts || []).join(' ')]))), 'text/csv');
  $('rsFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = await readTable(f);
      const cN = col(data, 'nome', 'name', 'recurso', 'colaborador'), cS = col(data, 'skill sap', 'sap skill', 'skill', 'modulo'), cE = col(data, 'senioridade', 'seniority', 'nivel'), cD = col(data, 'data de entrada', 'start date', 'entrada', 'admissao', 'data de admissao');
      if (!cN) throw new Error('falta a coluna Nome'); if (!cS && !cE && !cD) throw new Error('precisa de ao menos uma coluna entre Skill SAP, Senioridade e Data de entrada');
      const fill = $('mFill').checked, create = $('mCreate').checked, byName = new Map(S.resources.map((r) => [deacc(r.name), r]));
      const ups = [], miss = [], bad = []; let added = 0;
      for (const x of data) {
        const name = String(x[cN]).trim(); if (!name) continue;
        const v = {}; if (cS) v.sap_skill = normSkill(x[cS]); if (cE) v.seniority = normSen(x[cE]);
        if (cD) { v.start_date = parseDate(x[cD]); if (String(x[cD]).trim() && !v.start_date) bad.push(name); }
        const r = byName.get(deacc(name));
        if (!r) { if (!create) { miss.push(name); continue; } ups.push({ id: slug(name), name, sap_skill: v.sap_skill || '', seniority: v.seniority || '', start_date: v.start_date || null, origin: 'manual' }); added++; continue; }
        const row = { id: r.id, name: r.name, sap_skill: r.sap_skill, seniority: r.seniority, start_date: r.start_date, origin: r.origin }; let ch = false;
        for (const [k, val] of Object.entries(v)) { if (!val || (fill && r[k]) || r[k] === val) continue; row[k] = val; ch = true; }
        if (ch) ups.push(row);
      }
      if (ups.length) { const { error } = await supabase.from('resources').upsert(ups, { onConflict: 'id' }); if (error) throw error; }
      await loadResources(); render();
      let t = `${f.name}: ${ups.length - added} recursos atualizados${added ? `, ${added} criados` : ''}.`;
      if (miss.length) t += ` Não encontrados (${miss.length}): ${miss.slice(0, 4).join(', ')}${miss.length > 4 ? '…' : ''}.`;
      if (bad.length) t += ` Datas não reconhecidas em ${bad.length} linhas (use dd/mm/aaaa).`;
      toast(t);
    } catch (err) { toast(`Não foi possível ler ${f.name}: ${err.message}.`, 'error'); }
  };
}
