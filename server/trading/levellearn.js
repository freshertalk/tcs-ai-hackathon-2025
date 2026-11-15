"use strict";
// The level learner: what the desk's price levels actually did, counted day after day.
//
// A level is only worth quoting if it has a record. After every close each stock's 1-minute bars
// are walked once and every TEST of a level is written down with what followed:
//
//   the levels   the previous day's high, low and close, the floor pivots from them, the 5- and
//                20-day highs and lows, the round numbers around the open, the open and the opening
//                range (once they exist), VWAP as it stood, the day's high and low (once 15 minutes
//                old), the 5-minute Bollinger bands as they stood, and confirmed 5-minute swing highs
//                and lows. Each is known BEFORE the test — nothing looks ahead.
//   a test       the price comes to the level after having closed at least two tolerances away
//   the outcome  HELD: it fell back one "step" (2.5× the stock's average 1-minute range, between
//                0.25% and 0.8%) before closing half a step beyond the level; BROKE: it closed half a
//                step beyond first; neither within 30 minutes is not counted
//   the context  the time of day, the volume into the test (against the day's usual), whether RSI
//                was stretched into the level, whether the test was outside a Bollinger band, and —
//                on stocks the flight recorder was filming — who held the order book
//
// The counts are added up over the last 60 trading days, per stock and for all stocks. From them:
// how often each kind of level holds (`holdOf` — shown beside every level on the Live board, given
// to the AI when it chooses exit levels, read by TradeAI), and the plain-word findings written into
// the trading-skills file every AI feature reads (`lessons`). Counts, with their sample size —
// evidence, not a promise.
//
// Pure arithmetic: no AI, no network, no timer.

const { fold, bollinger, rsi } = require("../market/tape");
const { roundStep } = require("./exitlevels");

const IST = 5.5 * 3600 * 1000;
const TICK = 0.05;
const HORIZON = 30; // minutes a test is given to resolve
const num = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const BUCKETS = [
  ["open", 600, "the first 45 minutes"],
  ["morning", 690, "10:00–11:30"],
  ["midday", 810, "11:30–1:30"],
  ["afternoon", 885, "1:30–2:45"],
  ["close", 1440, "after 2:45"],
];
const bucketOf = (ms) => BUCKETS.find((b) => minuteOfDay(ms) < b[1])[0];
const BUCKET_NAME = Object.fromEntries(BUCKETS.map((b) => [b[0], b[2]]));
const NAME = {
  "prev-high": "The previous day's high",
  "prev-low": "The previous day's low",
  "prev-close": "The previous day's close",
  pivot: "A floor pivot (P, R1, S1, R2, S2)",
  "n-day": "A 5- or 20-day high or low",
  round: "A round number",
  open: "The day's open",
  "opening-range": "The opening range's high or low",
  vwap: "VWAP",
  "day-high": "A retest of the day's high",
  "day-low": "A retest of the day's low",
  bollinger: "A 5-minute Bollinger band",
  swing: "A 5-minute swing high or low",
};
const SOURCES = Object.keys(NAME);

/**
 * One stock, one day: every test of a level and what followed.
 * @param bars   that day's 1-minute bars [{ t, o, h, l, c, v }]
 * @param daily  earlier daily bars [{ t: "YYYY-MM-DD…", o, h, l, c }], oldest first
 * @param opts   { date: "YYYY-MM-DD", frames: [[t, last, bid, ask, buyersPct, …]] from the flight recorder }
 * @returns { date, bars, unit, touches: [...], counts: { key: n } } or null when there is too little to read
 */
function studyDay(bars, daily, opts = {}) {
  const day = (bars || []).filter((b) => b && num(b.c) && num(b.h) && num(b.l)).sort((a, b) => a.t - b.t);
  if (day.length < 60) return null;
  const date = opts.date || new Date(day[0].t + IST).toISOString().slice(0, 10);
  const open = day[0].o;
  const avgRange = day.reduce((a, b) => a + (b.h - b.l), 0) / day.length;
  const unit = clamp(avgRange * 2.5, open * 0.0025, open * 0.008);
  const tolOf = (p) => Math.max(TICK * 2, p * 0.0006);
  const t15 = day[0].t + 15 * 60000;

  /* ---- the levels that are fixed for the day */
  const fixed = [];
  const put = (source, price, from = day[0].t) => {
    if (num(price) && price > 0 && Math.abs(price - open) / open <= 0.04) fixed.push({ source, price, from });
  };
  const hist = (daily || []).filter((c) => c && num(c.h) && num(c.l) && num(c.c) && String(c.t).slice(0, 10) < date);
  const prev = hist[hist.length - 1];
  if (prev) {
    put("prev-high", prev.h);
    put("prev-low", prev.l);
    put("prev-close", prev.c);
    const p = (prev.h + prev.l + prev.c) / 3;
    [p, 2 * p - prev.l, 2 * p - prev.h, p + (prev.h - prev.l), p - (prev.h - prev.l)].forEach((x) => put("pivot", x));
    for (const n of [5, 20]) {
      const w = hist.slice(-n);
      if (w.length < n) continue;
      put("n-day", w.reduce((m, c) => Math.max(m, c.h), -Infinity));
      put("n-day", w.reduce((m, c) => Math.min(m, c.l), Infinity));
    }
  }
  const step = roundStep(open);
  const base = Math.floor(open / step) * step;
  [base - step, base, base + step, base + 2 * step].forEach((x) => Math.abs(x - open) > tolOf(open) && put("round", x));
  put("open", open, t15);
  const first = day.filter((b) => b.t < t15);
  if (first.length) {
    put("opening-range", first.reduce((m, b) => Math.max(m, b.h), -Infinity), t15 + 5 * 60000);
    put("opening-range", first.reduce((m, b) => Math.min(m, b.l), Infinity), t15 + 5 * 60000);
  }
  const trackers = fixed.map((f) => ({ ...f, armed: null, price: () => f.price }));

  /* ---- the levels that move: each is read as it stood at that minute */
  const moving = { vwap: null, hi: null, lo: null, bbU: null, bbL: null };
  trackers.push({ source: "vwap", from: day[0].t + 20 * 60000, armed: null, price: () => moving.vwap });
  trackers.push({ source: "day-high", from: day[0].t + 30 * 60000, armed: null, price: () => moving.hi, only: "below" });
  trackers.push({ source: "day-low", from: day[0].t + 30 * 60000, armed: null, price: () => moving.lo, only: "above" });
  trackers.push({ source: "bollinger", from: day[0].t, armed: null, price: () => moving.bbU, only: "below" });
  trackers.push({ source: "bollinger", from: day[0].t, armed: null, price: () => moving.bbL, only: "above" });

  const frames = Array.isArray(opts.frames) ? opts.frames.filter((f) => Array.isArray(f) && num(f[0])).sort((a, b) => a[0] - b[0]) : [];
  const bookAt = (ms) => {
    let best = null;
    for (const f of frames) {
      if (f[0] > ms + 45000) break;
      if (Math.abs(f[0] - ms) <= 45000 && num(f[4])) best = f;
    }
    return best ? best[4] : null;
  };

  const touches = [];
  let pv = 0;
  let vol = 0;
  const closes = [];
  const five = [];
  for (let i = 0; i < day.length; i += 1) {
    const b = day[i];
    // what was known before this minute
    moving.vwap = vol > 0 && i >= 20 ? pv / vol : null;
    if (i >= 15) {
      const old = day.slice(0, i - 14);
      moving.hi = old.reduce((m, x) => Math.max(m, x.h), -Infinity);
      moving.lo = old.reduce((m, x) => Math.min(m, x.l), Infinity);
    }
    const done5 = fold(day.slice(0, i), 5).filter((x) => x.t + 300000 <= b.t);
    if (done5.length !== five.length) {
      five.length = 0;
      five.push(...done5);
      const bb = bollinger(five.map((x) => x.c));
      moving.bbU = bb ? bb.upper : null;
      moving.bbL = bb ? bb.lower : null;
      // a swing is confirmed once two later 5-minute bars are complete
      const k = five.length - 3;
      if (k >= 2) {
        const s = five[k];
        const around = [five[k - 2], five[k - 1], five[k + 1], five[k + 2]];
        if (around.every((x) => s.h >= x.h) && around.some((x) => s.h > x.h)) trackers.push({ source: "swing", from: b.t, armed: null, price: () => s.h });
        if (around.every((x) => s.l <= x.l) && around.some((x) => s.l < x.l)) trackers.push({ source: "swing", from: b.t, armed: null, price: () => s.l });
      }
    }

    for (const t of trackers) {
      if (b.t < t.from) continue;
      const p = t.price();
      if (!num(p)) continue;
      const tol = tolOf(p);
      if (!t.armed) {
        if (b.c <= p - 2 * tol) t.armed = "below";
        else if (b.c >= p + 2 * tol) t.armed = "above";
        continue;
      }
      const touched = t.armed === "below" ? b.h >= p - tol * 0.5 : b.l <= p + tol * 0.5;
      if (!touched) continue;
      const from = t.armed;
      t.armed = null;
      if (t.only && t.only !== from) continue;
      // what followed
      const s = from === "below" ? 1 : -1; // +1: a resistance is being tested
      let outcome = "none";
      for (let j = i; j < Math.min(day.length, i + HORIZON + 1); j += 1) {
        const x = day[j];
        if (s * (x.c - p) >= unit * 0.5) {
          outcome = "broke";
          break;
        }
        if (j > i && s * ((s > 0 ? x.l : x.h) - p) <= -unit) {
          outcome = "held";
          break;
        }
      }
      // the context of the test
      const v5 = day.slice(Math.max(0, i - 4), i + 1).reduce((a, x) => a + (num(x.v) ? x.v : 0), 0) / Math.min(5, i + 1);
      const vAll = i >= 15 ? day.slice(0, i - 4).reduce((a, x) => a + (num(x.v) ? x.v : 0), 0) / (i - 4) : null;
      const rel = num(vAll) && vAll > 0 ? v5 / vAll : null;
      const r = rsi(closes.slice(-60));
      const book = bookAt(b.t);
      touches.push({
        source: t.source,
        price: Math.round(p * 100) / 100,
        clock: clock(b.t),
        from,
        outcome,
        bucket: bucketOf(b.t),
        vol: !num(rel) ? "normal" : rel >= 1.5 ? "high" : rel <= 0.6 ? "low" : "normal",
        stretch: num(r) && ((s > 0 && r >= 70) || (s < 0 && r <= 30)) ? "stretched" : "normal",
        band: (s > 0 && num(moving.bbU) && b.h >= moving.bbU) || (s < 0 && num(moving.bbL) && b.l <= moving.bbL) ? "outside" : "inside",
        // who held the five best levels: the side that would defend the level, or the side attacking it
        book: !num(book) ? null : (s > 0 ? book <= 40 : book >= 60) ? "defended" : (s > 0 ? book >= 60 : book <= 40) ? "attacked" : "even",
      });
    }

    closes.push(b.c);
    const w = num(b.v) && b.v > 0 ? b.v : 1;
    pv += ((b.h + b.l + b.c) / 3) * w;
    vol += w;
  }

  const counts = {};
  const add = (k) => (counts[k] = (counts[k] || 0) + 1);
  for (const t of touches) {
    add(`s|${t.source}|${t.outcome}`);
    if (t.outcome === "none") continue;
    add(`t|${t.source}|${t.bucket}|${t.outcome}`);
    add(`v|${t.vol}|${t.outcome}`);
    add(`x|${t.stretch}|${t.outcome}`);
    add(`b|${t.band}|${t.outcome}`);
    add(`d|${t.source}|${t.from}|${t.outcome}`);
    if (t.book) add(`k|${t.book}|${t.outcome}`);
  }
  return { date, bars: day.length, unit: Math.round(unit * 100) / 100, touches, counts };
}

const addInto = (into, counts, keep = null) => {
  for (const [k, n] of Object.entries(counts || {})) if (!keep || keep(k)) into[k] = (into[k] || 0) + n;
  return into;
};

/**
 * The days added up.
 * @param days [{ date, symbols: { SYM: { counts } } }]
 * @returns { days, from, to, symbols, tests, all: counts, bySymbol: { SYM: counts by kind and by hour } }
 */
function summarize(days) {
  const list = (days || []).filter((d) => d && d.date && d.symbols).sort((a, b) => (a.date < b.date ? -1 : 1));
  const all = {};
  const bySymbol = {};
  for (const d of list) {
    for (const [sym, x] of Object.entries(d.symbols)) {
      addInto(all, x.counts);
      bySymbol[sym] = addInto(bySymbol[sym] || {}, x.counts, (k) => k[0] === "s" || k[0] === "t");
    }
  }
  const tests = Object.entries(all).reduce((a, [k, n]) => a + (k[0] === "s" && !k.endsWith("|none") ? n : 0), 0);
  return { days: list.length, from: list.length ? list[0].date : null, to: list.length ? list[list.length - 1].date : null, symbols: Object.keys(bySymbol).length, tests, all, bySymbol };
}

/** Held and broke under one key prefix: { held, broke, n, pct } (pct = held ÷ resolved tests). */
function rate(counts, prefix) {
  const held = (counts && counts[`${prefix}|held`]) || 0;
  const broke = (counts && counts[`${prefix}|broke`]) || 0;
  const n = held + broke;
  return { held, broke, n, pct: n ? Math.round((held / n) * 100) : null };
}

/**
 * How often a level of these kinds has held.
 * @param summary  what `summarize` returned
 * @param symbol   the stock (its own record is used once it has eight resolved tests)
 * @param sources  the level's kinds, as the level map names them
 * @param ctx      { at (ms) } — also the record for that part of the day, when there is one
 * @returns { source, name, pct, n, scope: "this stock" | "all stocks", hour: { name, pct, n } | null } or null
 */
function holdOf(summary, symbol, sources, ctx = {}) {
  if (!summary || !summary.all) return null;
  let best = null;
  for (const src of sources || []) {
    if (!NAME[src]) continue;
    const own = rate(summary.bySymbol && summary.bySymbol[symbol], `s|${src}`);
    const all = rate(summary.all, `s|${src}`);
    const c = own.n >= 8 ? { ...own, scope: "this stock" } : all.n >= 20 ? { ...all, scope: "all stocks" } : null;
    if (!c) continue;
    if (!best || (c.scope === "this stock" && best.scope !== "this stock") || (c.scope === best.scope && c.n > best.n)) best = { source: src, name: NAME[src], pct: c.pct, n: c.n, scope: c.scope };
  }
  if (!best) return null;
  let hour = null;
  if (num(ctx.at)) {
    const b = bucketOf(ctx.at);
    const h = rate(summary.all, `t|${best.source}|${b}`);
    if (h.n >= 15) hour = { name: BUCKET_NAME[b], pct: h.pct, n: h.n };
  }
  return { ...best, hour };
}

/** Every kind of level with its record, the most tested first — for the page and for TradeAI. */
function table(summary, symbol = null) {
  if (!summary || !summary.all) return [];
  return SOURCES.map((src) => {
    const all = rate(summary.all, `s|${src}`);
    const own = symbol ? rate(summary.bySymbol && summary.bySymbol[symbol], `s|${src}`) : null;
    const hours = BUCKETS.map((b) => ({ id: b[0], name: b[2], ...rate(summary.all, `t|${src}|${b[0]}`) })).filter((h) => h.n >= 10);
    return { source: src, name: NAME[src], held: all.held, broke: all.broke, n: all.n, pct: all.pct, own: own && own.n >= 8 ? { n: own.n, pct: own.pct } : null, hours };
  })
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
}

/**
 * What the counts say, in plain words — written into the trading-skills file.
 * @param extra { aiLevels: "…" } one more line from the Live board's record of the AI's levels
 * @returns string[]
 */
function lessons(summary, extra = {}) {
  if (!summary || !summary.days || summary.tests < 20) return [];
  const out = [`Measured by the desk on ${summary.days} trading day${summary.days === 1 ? "" : "s"} (${summary.from} to ${summary.to}), ${summary.symbols} stock${summary.symbols === 1 ? "" : "s"}, ${summary.tests} tests of a level. "Held" = the price fell back one step before closing half a step beyond the level. Counts, not promises.`];
  const rows = table(summary).filter((r) => r.n >= 20);
  for (const r of rows.slice(0, 8)) out.push(`${r.name} held on ${r.pct}% of ${r.n} tests.`);
  // the same kind of level at different times of the day
  const gaps = [];
  for (const r of rows) {
    const hs = r.hours.filter((h) => h.n >= 12).sort((a, b) => b.pct - a.pct);
    if (hs.length >= 2 && hs[0].pct - hs[hs.length - 1].pct >= 15) gaps.push({ d: hs[0].pct - hs[hs.length - 1].pct, text: `${r.name} holds more often ${hs[0].name} (${hs[0].pct}% of ${hs[0].n}) than ${hs[hs.length - 1].name} (${hs[hs.length - 1].pct}% of ${hs[hs.length - 1].n}).` });
  }
  gaps.sort((a, b) => b.d - a.d).slice(0, 3).forEach((g) => out.push(g.text));
  const pair = (prefix, a, b, min, text) => {
    const x = rate(summary.all, `${prefix}|${a}`);
    const y = rate(summary.all, `${prefix}|${b}`);
    if (x.n >= min && y.n >= min && Math.abs(x.pct - y.pct) >= 6) out.push(text(x, y));
  };
  pair("v", "high", "low", 30, (x, y) => `A level tested on high volume (1.5× the usual five minutes) held ${x.pct}% of ${x.n} times; on low volume ${y.pct}% of ${y.n}.`);
  pair("x", "stretched", "normal", 25, (x, y) => `With RSI stretched into the level (70 or more into resistance, 30 or less into support) it held ${x.pct}% of ${x.n} times, against ${y.pct}% of ${y.n} otherwise.`);
  pair("b", "outside", "inside", 25, (x, y) => `A test made outside the 5-minute Bollinger band held ${x.pct}% of ${x.n} times, against ${y.pct}% of ${y.n} inside the bands.`);
  pair("k", "defended", "attacked", 12, (x, y) => `With the order book defending the level (60% of the five best levels on its side) it held ${x.pct}% of ${x.n} times; with the book attacking it, ${y.pct}% of ${y.n}.`);
  if (extra.aiLevels) out.push(String(extra.aiLevels));
  return out;
}

module.exports = { studyDay, summarize, rate, holdOf, table, lessons, NAME, SOURCES, BUCKETS, bucketOf };
