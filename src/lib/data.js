// Shared state, Supabase loaders and the forecast rules every view uses.
import { supabase } from '../supabase.js';
import { TODAY, pd, iso, lsGet, lsSet } from './util.js';

export const S = {
  session: null,
  profile: null, // { id, email, full_name, role }
  contracts: [],
  actual: {}, // code -> { 'YYYY-MM': hours }
  resources: [],
  metrics: new Map(), // resource id -> metrics (editors only)
  scenarios: [],
  loaded: {},
};

export const isEditor = () => ['editor', 'admin'].includes(S.profile?.role);
export const isAdmin = () => S.profile?.role === 'admin';
export const isReader = () => ['leitor', 'editor', 'admin'].includes(S.profile?.role);

export const ROLE_LABEL = { pendente: 'Aguardando aprovação', leitor: 'Leitor', editor: 'Editor', admin: 'Administrador' };
export const STATUS_LABEL = { Execution: 'Em execução', Paused: 'Paralisado', Closed: 'Encerrado' };

const toContract = (r) => ({
  code: r.code, parent: r.parent_code, client: r.client, name: r.name, pm: r.pm || '', status: r.status, phase: r.phase || '',
  prog: +r.progress || 0, base: r.baseline == null ? null : +r.baseline, hb: +r.hours_budget || 0, pwa: r.hours_pwa == null ? null : +r.hours_pwa,
  hl: r.hours_logged == null ? null : +r.hours_logged, cb: +r.cost_budget || 0, ca: +r.cost_actual || 0, eti: +r.cost_to_incur || 0,
  sale: +r.sale_net || 0, billed: +r.billed_net || 0, mSold: r.margin_sold == null ? 0 : +r.margin_sold, mEtc: r.margin_forecast == null ? 0 : +r.margin_forecast,
  start: r.start_date, end: r.end_date, golive: r.go_live, source: r.source, updated: r.updated_at,
  desc: r.description || '', dm: r.delivery_manager || '', ptype: r.project_type || '', report: r.report_status || '', lastReport: r.last_report || null,
});

function check(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// Reads every row of a query, 1000 at a time (the API caps each request).
export async function fetchAll(make, what) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const data = check(await make().range(from, from + 999), what);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { S.profile = null; return null; }
  const data = check(await supabase.from('profiles').select('id,email,full_name,role').eq('id', user.id).maybeSingle(), 'Perfil');
  S.profile = data;
  return data;
}

export async function loadContracts() {
  const data = check(await supabase.from('contracts').select('*').order('code'), 'Contratos');
  S.contracts = data.map(toContract);
  S.loaded.contracts = true;
}

export async function loadActual() {
  const data = await fetchAll(() => supabase.rpc('contract_month_hours'), 'Horas por contrato');
  const by = {};
  data.forEach((r) => { (by[r.contract] ??= {})[r.month] = +r.hours; });
  S.actual = by;
  S.loaded.actual = true;
}

export async function loadResources() {
  S.resources = await fetchAll(() => supabase.from('resources').select('*').order('name'), 'Recursos');
  if (isEditor()) {
    const m = await fetchAll(() => supabase.from('resource_metrics').select('*').order('resource_id'), 'Taxas');
    S.metrics = new Map(m.map((x) => [x.resource_id, x]));
  } else S.metrics = new Map();
  S.loaded.resources = true;
}

export async function loadScenarios() {
  S.scenarios = check(await supabase.from('scenarios').select('id,name,data,updated_at').order('name'), 'Cenários');
  S.loaded.scenarios = true;
}

// ---------- Portfolio forecast rules ----------
const QS_KEY = 'srp-quick-settings';
const defaultQS = () => {
  const t = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0);
  return { overdueClose: iso(t), useGoLive: true, pausedRestart: '', pausedEnd: '' };
};
export const QS = Object.assign(defaultQS(), lsGet(QS_KEY, {}));
export const saveQS = () => lsSet(QS_KEY, QS);

// Forecast for one contract: remaining hours and the window they fall in.
export function rowCalc(c) {
  const cph = c.hb ? c.cb / c.hb : 150;
  const remH = c.eti / cph;
  let fStart = TODAY, fEnd = pd(c.end) || TODAY, active = c.status === 'Execution';
  if (QS.useGoLive && c.golive && pd(c.golive) > fEnd) fEnd = pd(c.golive);
  if (c.status === 'Paused' && QS.pausedRestart && c.eti > 0) {
    active = true; fStart = pd(QS.pausedRestart);
    fEnd = QS.pausedEnd ? pd(QS.pausedEnd) : new Date(fStart.getFullYear(), fStart.getMonth() + 4, 0);
    if (fEnd < fStart) fEnd = new Date(fStart.getFullYear(), fStart.getMonth() + 4, 0);
  }
  if (fStart < TODAY) fStart = TODAY;
  if (active && fEnd < TODAY) {
    const oc = pd(QS.overdueClose);
    fEnd = oc && oc >= TODAY ? oc : new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0);
  }
  const eac = c.ca + c.eti, v = eac - c.cb;
  return {
    ...c, cph, remH, fStart, fEnd, active, eac, var: v, varPct: c.cb ? (v / c.cb) * 100 : 0,
    sched: c.base == null ? null : c.prog - c.base,
    overdue: c.end && pd(c.end) < TODAY && c.prog < 100 && c.eti > 0,
  };
}

// Portfolio filters shared by the dashboard and the simulator.
const F_KEY = 'srp-filters';
export const F = Object.assign({ client: '', pm: '', status: '', scope: 'open', unit: 'fte', cap: 50, q: '' }, lsGet(F_KEY, {}));
export const saveF = () => lsSet(F_KEY, { ...F, q: '' });

export function filtered() {
  const q = (F.q || '').toLowerCase();
  return S.contracts.map(rowCalc).filter((c) =>
    (!F.client || c.client === F.client) && (!F.pm || c.pm === F.pm) && (!F.status || c.status === F.status) &&
    (F.scope === 'all' || c.eti > 0 || (c.end && pd(c.end) >= TODAY)) &&
    (!q || (c.name + c.client + c.code + c.pm).toLowerCase().includes(q)));
}

export const QUICK_EVENT = 'srp:changed';
export const notify = (what) => document.dispatchEvent(new CustomEvent(QUICK_EVENT, { detail: what }));
