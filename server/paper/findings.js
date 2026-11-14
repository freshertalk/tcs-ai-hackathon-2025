"use strict";
// What the paper trades say about the current setup — by arithmetic, with a bar for evidence.
//
// The trades are split a few fixed ways (long or short, with or against the daily trend, the
// time of the entry). A slice becomes a finding only when it has at least MIN_TRADES trades and
// its average result after costs is far enough from zero for chance to be an unlikely
// explanation (|t| ≥ MIN_T). The bar is high on purpose: the same desk looks at many slices,
// and a few will always look good by luck. Fewer, sturdier findings are worth more than many.

const MIN_TRADES = 30;
const MIN_T = 2;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);

/** n, average, spread and t of a list of results in R. */
function stats(rs) {
  const n = rs.length;
  if (!n) return { n: 0, avg: null, sd: null, t: null, winPct: null, sum: 0 };
  const sum = rs.reduce((s, x) => s + x, 0);
  const avg = sum / n;
  const sd = n > 1 ? Math.sqrt(rs.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 && sd > 0 ? avg / (sd / Math.sqrt(n)) : null;
  return { n, avg: r2(avg), sd: r2(sd), t: num(t) ? r2(t) : null, winPct: Math.round((rs.filter((x) => x > 0).length / n) * 100), sum: r2(sum) };
}

/** The entry window a trade belongs to (IST clock "HH:MM"). */
function windowOf(at) {
  const t = String(at || "");
  if (t < "11:00") return "09:30–11:00";
  if (t < "13:00") return "11:00–13:00";
  return "13:00–14:45";
}

const SLICES = [
  { id: "all", label: "every call", test: () => true },
  { id: "long", label: "long calls", test: (t) => t.side === "long" },
  { id: "short", label: "short calls", test: (t) => t.side === "short" },
  { id: "with", label: "calls with the daily trend", test: (t) => t.withDaily === true },
  { id: "against", label: "calls against the daily trend", test: (t) => t.withDaily === false },
  { id: "w1", label: "calls entered 09:30–11:00", test: (t) => windowOf(t.at) === "09:30–11:00" },
  { id: "w2", label: "calls entered 11:00–13:00", test: (t) => windowOf(t.at) === "11:00–13:00" },
  { id: "w3", label: "calls entered 13:00–14:45", test: (t) => windowOf(t.at) === "13:00–14:45" },
  { id: "long-with", label: "long calls with the daily trend", test: (t) => t.side === "long" && t.withDaily === true },
  { id: "short-with", label: "short calls with the daily trend", test: (t) => t.side === "short" && t.withDaily === true },
];

/**
 * @param trades  finished paper trades [{ side, at, withDaily, netR }]
 * @returns { total, slices: [{ id, label, ...stats, verdict }], findings: [{ id, kind, text }] }
 */
function findingsOf(trades) {
  const done = trades.filter((t) => num(t.netR) && t.why !== "open");
  const slices = SLICES.map((s) => {
    const st = stats(done.filter(s.test).map((t) => t.netR));
    const strong = st.n >= MIN_TRADES && num(st.t) && Math.abs(st.t) >= MIN_T;
    return { id: s.id, label: s.label, ...st, verdict: st.n < MIN_TRADES ? "too few" : strong ? (st.avg > 0 ? "works" : "loses") : "unclear" };
  });
  const findings = slices
    .filter((s) => s.verdict === "works" || s.verdict === "loses")
    .map((s) => ({
      id: s.id,
      kind: s.verdict,
      text:
        s.verdict === "works"
          ? `${s.label} averaged ${s.avg > 0 ? "+" : ""}${s.avg}R after costs over ${s.n} paper trades (t ${s.t}, ${s.winPct}% won) — this is where the setup has earned; keep taking them at full planned size.`
          : `${s.label} averaged ${s.avg}R after costs over ${s.n} paper trades (t ${s.t}, ${s.winPct}% won) — they have lost money; skip them or take them at half size until a new paper test says otherwise.`,
    }));
  return { total: done.length, minTrades: MIN_TRADES, minT: MIN_T, slices, findings };
}

module.exports = { findingsOf, stats, windowOf, MIN_TRADES, MIN_T };
