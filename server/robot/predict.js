"use strict";
// The day-trading predictor: which NIFTY 100 stocks are likely to give a clean directional intraday move
// tomorrow, learned from every session of the stored year and checked out of sample.
//
//   SAMPLE   one per stock per session (from the 21st on): what was known BEFORE the open — how the day
//            before went (its move, where it closed in its range, how wide the range was against the
//            stock's 20-session average), where the stock stands against its 20-day average, and the day
//            of the week — and what the session then did.
//   LABEL    a "clean directional day": from the price at 9:30, a move of 0.6 times the stock's own
//            average daily range in one direction before a move of 0.3 times that against it (so a stock's
//            clean day is measured against its own size, not a fixed 1%). The side it went is kept.
//   MODEL    counts, nothing hidden: for the whole universe, for each bucket of each feature, and for each
//            stock, how many sessions were clean (and went up or down). A session's chance is the
//            universe's base rate moved by each bucket's record and by the stock's own record, every
//            record shrunk towards the base by its sample size (a bucket seen 30 times counts for half).
//            The side's chance is built the same way from the clean days only.
//   SKILL    walk-forward: sessions are taken in date order; each is predicted from the counts of the
//            sessions before it, the ten stocks ranked highest are marked against what really happened,
//            and only then is the session added to the counts. The lift over the average stock that day is
//            the predictor's skill — counted out of sample, never assumed.
//   POINTS   what the counts say in plain words (the buckets and the stocks that stand out, when the day's
//            high and low usually come), regenerated each day from the latest counts.
//
// Pure arithmetic: no AI, no network, no clock, no orders. A chance here is a measured frequency from past
// sessions with its sample size, not a forecast or advice.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (num(x) ? Math.round(x * 1000) / 1000 : null);
const fmt = (n) => n.toLocaleString("en-IN");
const IST = 5.5 * 3600 * 1000;
const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const dowOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

const FEATURES = ["prev", "loc", "range", "trend", "dow"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LOOKBACK = 20;
const K_BUCKET = 30;
const K_STOCK = 20;
const MIN_TRAIN_DATES = 60;
const TOP = 10;
const THR = 0.6; // of the stock's average daily range
const ADV = 0.3;
const OR_BARS = 3; // the price at 9:30 is the close of the third 5-minute bar
const MIN_BASE_N = 300;

const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));
const clamp = (p) => Math.min(0.97, Math.max(0.03, p));

/** One session's summary from its 5-minute bars. */
function dayRow(date, bars) {
  let h = -Infinity;
  let l = Infinity;
  let hi = 0;
  let lo = 0;
  let v = 0;
  bars.forEach((b, i) => {
    if (b.h > h) {
      h = b.h;
      hi = i;
    }
    if (b.l < l) {
      l = b.l;
      lo = i;
    }
    v += b.v || 0;
  });
  const o = bars[0].o;
  const c = bars[bars.length - 1].c;
  return { date, o, h, l, c, v, n: bars.length, hiIdx: hi, loIdx: lo, rangePct: o > 0 ? ((h - l) / o) * 100 : 0, retPct: o > 0 ? ((c - o) / o) * 100 : 0 };
}

/** Whether the session gave a clean directional move from 9:30, and which way. */
function labelDay(bars, avgRangePct) {
  if (bars.length < OR_BARS + 4 || !(avgRangePct > 0)) return null;
  const p0 = bars[OR_BARS - 1].c;
  const up = p0 * (1 + (THR * avgRangePct) / 100);
  const upStop = p0 * (1 - (ADV * avgRangePct) / 100);
  const dn = p0 * (1 - (THR * avgRangePct) / 100);
  const dnStop = p0 * (1 + (ADV * avgRangePct) / 100);
  let upAt = null;
  let dnAt = null;
  let upDead = false;
  let dnDead = false;
  for (let i = OR_BARS; i < bars.length; i += 1) {
    const b = bars[i];
    if (!upDead && upAt === null) {
      if (b.l <= upStop) upDead = true;
      else if (b.h >= up) upAt = i;
    }
    if (!dnDead && dnAt === null) {
      if (b.h >= dnStop) dnDead = true;
      else if (b.l <= dn) dnAt = i;
    }
  }
  const clean = upAt !== null || dnAt !== null;
  const dir = !clean ? null : upAt !== null && (dnAt === null || upAt <= dnAt) ? "up" : "down";
  return { clean, dir };
}

const bucket = {
  prev: (x) => (x < -1.5 ? "drop" : x < -0.5 ? "down" : x < 0.5 ? "flat" : x < 1.5 ? "up" : "jump"),
  loc: (x) => (x < 0.25 ? "low" : x > 0.75 ? "high" : "mid"),
  range: (x) => (x < 0.7 ? "narrow" : x > 1.3 ? "wide" : "normal"),
  trend: (x) => (x < -2 ? "below" : x > 2 ? "above" : "near"),
};

/** The features known before a session opens, from the rows of the sessions before it (at least LOOKBACK of them). */
function featuresFrom(rows, dow) {
  if (rows.length < LOOKBACK) return null;
  const last = rows[rows.length - 1];
  const win = rows.slice(-LOOKBACK);
  const avgRange = win.reduce((a, r) => a + r.rangePct, 0) / win.length;
  const avgClose = win.reduce((a, r) => a + r.c, 0) / win.length;
  if (!(avgRange > 0) || !(avgClose > 0) || !(last.h > last.l)) return null;
  return {
    f: {
      prev: bucket.prev(last.retPct),
      loc: bucket.loc((last.c - last.l) / (last.h - last.l)),
      range: bucket.range(last.rangePct / avgRange),
      trend: bucket.trend(((last.c - avgClose) / avgClose) * 100),
      dow: String(dow),
    },
    avgRange,
  };
}

/**
 * Every sample of every stock, and what tomorrow's features are.
 * @param bySymbol Map symbol → Map date → bars (whole sessions)
 * @returns { samples, latest: { SYMBOL: { f, avgRange, last } }, lastDate }
 */
function buildSamples(bySymbol) {
  const samples = [];
  const latest = {};
  let lastDate = null;
  for (const [symbol, sess] of bySymbol) {
    const dates = [...sess.keys()].sort();
    const rows = dates.map((d) => dayRow(d, sess.get(d)));
    for (let i = LOOKBACK; i < rows.length; i += 1) {
      const fe = featuresFrom(rows.slice(0, i), dowOf(rows[i].date));
      if (!fe) continue;
      const lab = labelDay(sess.get(rows[i].date), fe.avgRange);
      if (!lab) continue;
      samples.push({ date: rows[i].date, symbol, f: fe.f, avgRange: fe.avgRange, clean: lab.clean ? 1 : 0, dir: lab.dir, hiIdx: rows[i].hiIdx, loIdx: rows[i].loIdx, n: rows[i].n });
    }
    if (rows.length >= LOOKBACK) {
      const last = rows[rows.length - 1];
      const next = nextWeekday(last.date);
      const fe = featuresFrom(rows, dowOf(next));
      if (fe) {
        latest[symbol] = { f: fe.f, avgRange: fe.avgRange, last: { date: last.date, o: last.o, h: last.h, l: last.l, c: last.c, retPct: r2(last.retPct) } };
        if (!lastDate || last.date > lastDate) lastDate = last.date;
      }
    }
  }
  return { samples, latest, lastDate };
}

function nextWeekday(date) {
  let d = new Date(`${date}T12:00:00Z`);
  do d = new Date(d.getTime() + 86400000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/* ----------------------------------------------------------------------------------- the counts */

const zero = () => ({ n: 0, k: 0, up: 0, dn: 0 });
const newCounts = () => ({ g: zero(), f: Object.fromEntries(FEATURES.map((x) => [x, {}])), s: {} });
function add(c, s) {
  const bump = (o) => {
    o.n += 1;
    o.k += s.clean;
    if (s.dir === "up") o.up += 1;
    if (s.dir === "down") o.dn += 1;
  };
  bump(c.g);
  for (const f of FEATURES) bump(c.f[f][s.f[f]] || (c.f[f][s.f[f]] = zero()));
  bump(c.s[s.symbol] || (c.s[s.symbol] = zero()));
}

/** One session's chance of being clean and of going up, with the records behind it. Null until the counts have enough sessions. */
function predict(c, f, symbol) {
  const g = c.g;
  if (g.n < MIN_BASE_N) return null;
  const p0 = clamp((g.k + 1) / (g.n + 2));
  const cl0 = g.up + g.dn;
  const pu0 = clamp((g.up + 1) / (cl0 + 2));
  let z = logit(p0);
  let zu = logit(pu0);
  const parts = [];
  for (const feat of FEATURES) {
    const b = c.f[feat][f[feat]] || zero();
    const pb = clamp((b.k + K_BUCKET * p0) / (b.n + K_BUCKET));
    const d = logit(pb) - logit(p0);
    z += d;
    const cb = b.up + b.dn;
    zu += logit(clamp((b.up + K_BUCKET * pu0) / (cb + K_BUCKET))) - logit(pu0);
    parts.push({ feat, bucket: f[feat], delta: r3(d), n: b.n, rate: b.n ? r3(b.k / b.n) : null });
  }
  const s = c.s[symbol] || zero();
  z += logit(clamp((s.k + K_STOCK * p0) / (s.n + K_STOCK))) - logit(p0);
  const cs = s.up + s.dn;
  zu += logit(clamp((s.up + K_STOCK * pu0) / (cs + K_STOCK))) - logit(pu0);
  const p = sig(z);
  const pUp = sig(zu);
  return { p: r3(p), base: r3(p0), pUp: r3(pUp), side: pUp >= 0.58 ? "long" : pUp <= 0.42 ? "short" : "either", parts, stockN: s.n, stockRate: s.n ? r3(s.k / s.n) : null };
}

/**
 * Walk-forward over the samples in date order, then the counts of all of them.
 * @returns { counts, series: [{ date, stocks, base, top, lift, dirCalls, dirHits }], summary }
 */
function train(samples, { minDates = MIN_TRAIN_DATES, top = TOP } = {}) {
  const byDate = new Map();
  for (const s of samples) (byDate.get(s.date) || byDate.set(s.date, []).get(s.date)).push(s);
  const dates = [...byDate.keys()].sort();
  const counts = newCounts();
  const series = [];
  dates.forEach((d, i) => {
    const day = byDate.get(d);
    if (i >= minDates) {
      const preds = day.map((s) => ({ s, pr: predict(counts, s.f, s.symbol) })).filter((x) => x.pr);
      if (preds.length >= top * 2) {
        preds.sort((a, b) => b.pr.p - a.pr.p);
        const picks = preds.slice(0, top);
        const base = preds.reduce((a, x) => a + x.s.clean, 0) / preds.length;
        const rate = picks.reduce((a, x) => a + x.s.clean, 0) / picks.length;
        const calls = picks.filter((x) => x.s.clean && x.s.dir && x.pr.side !== "either");
        series.push({ date: d, stocks: preds.length, base: r3(base), top: r3(rate), lift: r3(rate - base), dirCalls: calls.length, dirHits: calls.filter((x) => (x.pr.side === "long") === (x.s.dir === "up")).length });
      }
    }
    for (const s of day) add(counts, s);
  });
  return { counts, series, summary: skill(series, dates.length) };
}

/** The out-of-sample result in one place, and whether it has earned the word "intelligent". */
function skill(series, sessions) {
  const n = series.length;
  const lifts = series.map((x) => x.lift);
  const mean = n ? lifts.reduce((a, x) => a + x, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(lifts.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
  const t = n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
  const positive = n ? lifts.filter((x) => x > 0).length / n : null;
  const rate = n ? series.reduce((a, x) => a + x.top, 0) / n : null;
  const base = n ? series.reduce((a, x) => a + x.base, 0) / n : null;
  const dc = series.reduce((a, x) => a + x.dirCalls, 0);
  const dh = series.reduce((a, x) => a + x.dirHits, 0);
  const passed = n >= 60 && mean > 0 && t >= 1.65 && positive >= 0.55;
  return {
    sessions,
    evaluated: n,
    meanLift: r3(mean),
    topRate: r3(rate),
    baseRate: r3(base),
    t: r2(t),
    positive: r2(positive),
    dirCalls: dc,
    dirHitPct: dc ? Math.round((dh / dc) * 100) : null,
    state: passed ? "graduated" : n < 60 ? "learning" : "not-yet",
    text: passed
      ? `Out of sample, over ${n} sessions its ten highest-ranked stocks gave a clean directional day ${Math.round(rate * 100)}% of the time against ${Math.round(base * 100)}% for the average stock (ahead on ${Math.round(positive * 100)}% of the sessions, t = ${r2(t)}).`
      : n < 60
        ? `${n} sessions marked out of sample so far; it needs 60 before its ranking is trusted.`
        : `Over ${n} sessions its ten highest-ranked stocks gave a clean day ${Math.round(rate * 100)}% of the time against ${Math.round(base * 100)}% for the average stock — ${mean > 0 ? "ahead, but not yet by enough to rule out luck" : "not ahead"} (t = ${r2(t)}). It keeps learning.`,
  };
}

/* ---------------------------------------------------------------------------------- tomorrow */

const TEXT = {
  prev: { drop: "the day before fell more than 1.5%", down: "the day before fell between 0.5% and 1.5%", flat: "the day before was flat", up: "the day before rose between 0.5% and 1.5%", jump: "the day before rose more than 1.5%" },
  loc: { low: "the day before closed near its low", mid: "the day before closed mid-range", high: "the day before closed near its high" },
  range: { narrow: "the day before had a narrow range", normal: "the day before had a normal range", wide: "the day before had a wide range" },
  trend: { below: "the stock is more than 2% below its 20-day average", near: "the stock is near its 20-day average", above: "the stock is more than 2% above its 20-day average" },
};
const phrase = (feat, b) => (feat === "dow" ? `it is a ${DOW[Number(b)]}` : (TEXT[feat] || {})[b] || `${feat} is ${b}`);

/** The ranked stocks for the next session. @param latest from buildSamples @param opts { top, limit } */
function rank(counts, latest, { limit = 20 } = {}) {
  const rows = [];
  for (const [symbol, x] of Object.entries(latest)) {
    const pr = predict(counts, x.f, symbol);
    if (!pr) continue;
    const why = pr.parts.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).filter((p) => Math.abs(p.delta) >= 0.05).slice(0, 2).map((p) => `${phrase(p.feat, p.bucket)} (${p.rate === null ? "—" : Math.round(p.rate * 100)}% of ${fmt(p.n)} such sessions were clean)`);
    rows.push({ symbol, p: pr.p, base: pr.base, lift: r3(pr.p - pr.base), pUp: pr.pUp, side: pr.side, stockRate: pr.stockRate, stockN: pr.stockN, avgRangePct: r2(x.avgRange), targetPct: r2(THR * x.avgRange), why, last: x.last });
  }
  rows.sort((a, b) => b.p - a.p);
  return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
}

/* ------------------------------------------------------------------------------ learning points */

/** What the counts say in plain words: the buckets and the stocks that stand out, and when the day's high and low come. */
function points(counts, samples) {
  const g = counts.g;
  if (g.n < MIN_BASE_N) return [];
  const base = g.k / g.n;
  const gu = g.up + g.dn ? g.up / (g.up + g.dn) : 0.5;
  const out = [];
  const pc = (x) => `${Math.round(x * 100)}%`;
  for (const feat of FEATURES) {
    for (const [b, c] of Object.entries(counts.f[feat])) {
      if (c.n >= 400) {
        const rate = c.k / c.n;
        if (Math.abs(rate - base) >= 0.03) out.push({ id: `f:${feat}:${b}`, kind: "market", text: `When ${phrase(feat, b)}, ${pc(rate)} of ${fmt(c.n)} sessions gave a clean directional day, against ${pc(base)} overall.`, n: c.n, lift: r3(rate - base) });
      }
      const cl = c.up + c.dn;
      if (cl >= 200) {
        const pu = c.up / cl;
        if (Math.abs(pu - gu) >= 0.06) out.push({ id: `d:${feat}:${b}`, kind: "market", text: `When ${phrase(feat, b)}, the clean days went ${pu > gu ? "up" : "down"} ${pc(pu > gu ? pu : 1 - pu)} of the time (${fmt(cl)} clean days), against ${pc(pu > gu ? gu : 1 - gu)} overall.`, n: cl, lift: r3(Math.abs(pu - gu)) });
      }
    }
  }
  const stocks = Object.entries(counts.s)
    .filter(([, c]) => c.n >= 120)
    .map(([symbol, c]) => ({ symbol, c, rate: (c.k + K_STOCK * base) / (c.n + K_STOCK) }))
    .sort((a, b) => b.rate - a.rate);
  const show = [...stocks.slice(0, 6), ...stocks.slice(-4)];
  for (const s of show) {
    const cl = s.c.up + s.c.dn;
    const lean = cl >= 40 && Math.abs(s.c.up / cl - gu) >= 0.1 ? `, mostly ${s.c.up / cl > gu ? "up" : "down"} (${pc(s.c.up / cl > gu ? s.c.up / cl : s.c.dn / cl)})` : "";
    out.push({ id: `s:${s.symbol}`, kind: "stock", symbol: s.symbol, text: `${s.symbol}: ${pc(s.c.k / s.c.n)} of ${fmt(s.c.n)} sessions gave a clean directional day${lean}, against ${pc(base)} for the NIFTY 100 — ${s.rate > base ? "a stock that trends" : "a stock that chops"}.`, n: s.c.n, lift: r3(s.rate - base) });
  }
  // when the day's high and low come
  const t = samples.filter((s) => s.n >= 60);
  if (t.length >= 500) {
    const first = t.filter((s) => s.hiIdx < 12 || s.loIdx < 12).length / t.length;
    const last = t.filter((s) => s.hiIdx >= s.n - 12 || s.loIdx >= s.n - 12).length / t.length;
    out.push({ id: "t:first", kind: "timing", text: `In ${pc(first)} of ${fmt(t.length)} sessions the day's high or low was set in the first hour (9:15–10:15).`, n: t.length, lift: r3(first - 0.5) });
    out.push({ id: "t:last", kind: "timing", text: `In ${pc(last)} of ${fmt(t.length)} sessions the day's high or low was set in the last hour (2:15–3:30).`, n: t.length, lift: r3(last - 0.5) });
  }
  return out.sort((a, b) => Math.abs(b.lift) * Math.sqrt(b.n) - Math.abs(a.lift) * Math.sqrt(a.n));
}

/** Today's points against yesterday's: which are new, which have gone, which moved. */
function diffPoints(now, before) {
  const was = new Map((before || []).map((p) => [p.id, p]));
  const out = now.map((p) => {
    const w = was.get(p.id);
    return { ...p, firstSeen: w ? w.firstSeen : null, state: !w ? "new" : Math.abs(p.lift - w.lift) >= 0.02 ? (Math.abs(p.lift) > Math.abs(w.lift) ? "stronger" : "weaker") : "steady" };
  });
  const gone = (before || []).filter((p) => !now.some((x) => x.id === p.id)).map((p) => p.id);
  return { points: out, gone };
}

module.exports = { FEATURES, DOW, THR, ADV, MIN_TRAIN_DATES, TOP, dayRow, labelDay, featuresFrom, buildSamples, nextWeekday, newCounts, add, predict, train, skill, rank, points, diffPoints, phrase, dateOf };
