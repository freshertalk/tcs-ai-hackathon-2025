"use strict";
// Is the research any good? A walk-forward grade of the desk's next-session outlook on real history.
//
// For each stock and each past session, the outlook is rebuilt from ONLY the bars up to that evening (the same function
// that builds tomorrow's outlook) and graded against what the next session actually did. From a year of sessions across
// the watchlist that answers, with numbers instead of opinions:
//
//   by score    when the lean was this strong, how often did the next session close higher — and by how much?
//   by voice    each component of the outlook (trend, momentum, stretch, candles…): when it voted strongly, was it right?
//               Its edge is the average next-day move in the direction it voted, with a t-statistic, so a voice that has
//               been noise shows as noise and one that has paid shows as paid.
//   overall     how often the outlook's call (lean ±22 or more) pointed the right way
//
// The learned part: each voice gets a suggested weight multiplier from its measured edge (0.5× for a voice that has been
// wrong or noise, up to 1.5× for one that has paid, held near 1× while its sample is thin). It is SHOWN and used to
// say how reliable today's lean has been — it does not silently rewrite the outlook's weights.
//
// Pure: the service supplies the daily bars.

const { buildOutlook, W } = require("./outlook");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const BUCKETS = [
  { id: "strong-down", label: "≤ −40", test: (s) => s <= -40 },
  { id: "down", label: "−40 to −22", test: (s) => s > -40 && s <= -22 },
  { id: "weak-down", label: "−22 to −8", test: (s) => s > -22 && s <= -8 },
  { id: "flat", label: "−8 to +8", test: (s) => s > -8 && s < 8 },
  { id: "weak-up", label: "+8 to +22", test: (s) => s >= 8 && s < 22 },
  { id: "up", label: "+22 to +40", test: (s) => s >= 22 && s < 40 },
  { id: "strong-up", label: "≥ +40", test: (s) => s >= 40 },
];
const bucketOf = (score) => (BUCKETS.find((b) => b.test(score)) || BUCKETS[3]).id;

/**
 * Grade the outlook across a set of stocks.
 * @param series  [{ symbol, daily: [{ t, o, h, l, c }] oldest first }]
 * @param opts    { lookback: sessions per stock to grade (default 220), minHistory: bars before the first graded session (default 80) }
 */
function calibrate(series, { lookback = 220, minHistory = 80 } = {}) {
  const rows = [];
  for (const { symbol, daily } of series || []) {
    if (!Array.isArray(daily) || daily.length < minHistory + 5) continue;
    const from = Math.max(minHistory, daily.length - 1 - lookback);
    for (let i = from; i < daily.length - 1; i += 1) {
      const o = buildOutlook({ candles: daily.slice(0, i + 1), forming: false });
      if (!o || !o.available) continue;
      const next = daily[i + 1];
      const cc = (next.c / daily[i].c - 1) * 100; // the next close against this close
      rows.push({ symbol, date: String(next.t).slice(0, 10), score: o.score, comps: o.components.map((c) => ({ id: c.id, vote: c.vote })), cc });
    }
  }
  const n = rows.length;
  if (n < 60) return { available: false, reason: `Only ${n} graded sessions: too few to say how reliable the outlook is.`, n };

  const buckets = BUCKETS.map((b) => {
    const r = rows.filter((x) => b.test(x.score));
    return { id: b.id, label: b.label, n: r.length, upPct: r.length ? Math.round((r.filter((x) => x.cc > 0).length / r.length) * 100) : null, avgPct: r.length ? r2(mean(r.map((x) => x.cc))) : null };
  });

  // the outlook's call: lean of ±22 or more, did the next close go that way?
  const called = rows.filter((x) => Math.abs(x.score) >= 22);
  const hit = called.filter((x) => Math.sign(x.score) === Math.sign(x.cc) && x.cc !== 0);
  const base = Math.round((rows.filter((x) => x.cc > 0).length / n) * 100); // how often ANY next session closes up
  const overall = {
    n,
    stocks: new Set(rows.map((r) => r.symbol)).size,
    sessions: new Set(rows.map((r) => r.date)).size,
    called: called.length,
    hitPct: called.length ? Math.round((hit.length / called.length) * 100) : null,
    baseUpPct: base,
    // the call's average gain per session counting the move in the direction called
    avgCalledPct: called.length ? r2(mean(called.map((x) => Math.sign(x.score) * x.cc))) : null,
    t: called.length > 5 && sd(called.map((x) => Math.sign(x.score) * x.cc)) > 0 ? r2(mean(called.map((x) => Math.sign(x.score) * x.cc)) / (sd(called.map((x) => Math.sign(x.score) * x.cc)) / Math.sqrt(called.length))) : null,
  };

  // each voice
  const ids = [...new Set(rows.flatMap((r) => r.comps.map((c) => c.id)))];
  const voices = ids.map((id) => {
    const act = rows.filter((r) => r.comps.some((c) => c.id === id && Math.abs(c.vote) >= 0.3));
    const signed = act.map((r) => Math.sign(r.comps.find((c) => c.id === id).vote) * r.cc);
    const hitN = act.filter((r) => Math.sign(r.comps.find((c) => c.id === id).vote) === Math.sign(r.cc) && r.cc !== 0).length;
    const m = mean(signed);
    const s = sd(signed);
    const t = act.length > 5 && s > 0 ? m / (s / Math.sqrt(act.length)) : null;
    // a weight multiplier from the measured edge, pulled toward 1 while the sample is thin
    const shrink = act.length / (act.length + 60);
    const raw = num(t) ? Math.min(1.5, Math.max(0.5, 1 + 0.25 * t)) : 1;
    return { id, weight: W[id] ?? null, n: act.length, hitPct: act.length ? Math.round((hitN / act.length) * 100) : null, avgPct: act.length ? r2(m) : null, t: r2(t), multiplier: r2(1 + (raw - 1) * shrink), verdict: act.length < 30 ? "too few to judge" : num(t) && t >= 2 ? "has paid" : num(t) && t <= -2 ? "has been wrong" : "noise so far" };
  }).sort((a, b) => (b.n === a.n ? 0 : b.n - a.n));

  const from = rows.map((r) => r.date).sort()[0];
  const to = rows.map((r) => r.date).sort().pop();
  return { available: true, from, to, buckets, overall, voices, rule: "The outlook is rebuilt for each past session from only the bars up to that evening and graded against the next session's close. A voice is 'active' when it votes 0.3 or more either way; its edge is the average next-day move in the direction it voted. Multipliers are suggestions pulled toward 1× while a sample is thin. A hit rate near the base rate is no edge." };
}

/** What the record says about one lean, in a sentence — "when the lean was this strong, ...". */
function sentenceFor(cal, score) {
  if (!cal || !cal.available || !num(score)) return "";
  const b = cal.buckets.find((x) => x.id === bucketOf(score));
  if (!b || b.n < 15 || !num(b.upPct)) return "";
  return `When the outlook's lean was ${b.label} (${b.n} past sessions across ${cal.overall.stocks} stocks), the next session closed higher ${b.upPct}% of the time, ${b.avgPct >= 0 ? "+" : ""}${b.avgPct}% on average; any next session closes higher ${cal.overall.baseUpPct}% of the time.`;
}

module.exports = { calibrate, sentenceFor, bucketOf, BUCKETS };
