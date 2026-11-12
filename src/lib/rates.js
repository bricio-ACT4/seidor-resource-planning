// Cost-rate bands and ABC classes shared by the roster and the cost view.
export const BANDS = [[80, 'Até R$ 80'], [100, 'R$ 80–100'], [120, 'R$ 100–120'], [140, 'R$ 120–140'], [160, 'R$ 140–160'], [1e9, 'Acima de R$ 160']];
export const BAND_ORDER = BANDS.map((b) => b[1]);
export const bandOf = (r) => (r > 0 ? BANDS.find(([mx]) => r <= mx)[1] : '');

// people: [{ rate, hours, cost }] -> bands sorted by weight (headcount x average rate) with A/B/C classes.
export function abc(people) {
  const g = {};
  people.forEach((p) => { if (!(p.rate > 0)) return; const b = (g[bandOf(p.rate)] ??= { band: bandOf(p.rate), n: 0, w: 0, h: 0, v: 0, mn: Infinity, mx: 0 }); b.n++; b.w += p.rate; b.h += p.hours || 0; b.v += p.cost || 0; b.mn = Math.min(b.mn, p.rate); b.mx = Math.max(b.mx, p.rate); });
  const bands = Object.values(g).sort((a, b) => b.w - a.w);
  const W = bands.reduce((a, b) => a + b.w, 0), N = bands.reduce((a, b) => a + b.n, 0), V = bands.reduce((a, b) => a + b.v, 0);
  let prev = 0;
  bands.forEach((b) => { b.avg = b.w / b.n; b.pct = (b.w / W) * 100; b.pres = (b.n / N) * 100; b.pv = V ? (b.v / V) * 100 : 0; b.cls = prev < 80 ? 'A' : prev < 95 ? 'B' : 'C'; prev += b.pct; b.cum = prev; });
  const rates = people.map((p) => p.rate).filter((r) => r > 0).sort((a, b) => a - b);
  const H = people.reduce((a, p) => a + (p.rate > 0 ? p.hours || 0 : 0), 0);
  const summary = { n: N, simple: N ? W / N : 0, wavg: H ? V / H : 0, median: rates.length ? (rates[Math.floor((rates.length - 1) / 2)] + rates[Math.ceil((rates.length - 1) / 2)]) / 2 : 0, h: H, v: V, mn: rates[0] || 0, mx: rates.at(-1) || 0 };
  return { bands, summary, cls: Object.fromEntries(bands.map((b) => [b.band, b.cls])) };
}
