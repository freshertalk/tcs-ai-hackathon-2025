"use strict";
// The Level Book: what the NIFTY 100's own price levels have done, measured session by session.
//
//   STUDY    for one stock and one session, from that session's 5-minute bars and the levels the day before
//            gives it (yesterday's high, low and close, the floor pivots P, R1, S1, R2, S2) plus the two
//            that form in the session (the opening-range high and low, 9:15–9:30) and VWAP, every level's
//            first test after 9:30 is traded two ways on paper:
//              bounce  the level holds: entered at the level, stop 0.6 ATR beyond it, target 1.5 R
//              break   the level gives way: entered after a 5-minute close 0.2 ATR beyond it (within six
//                      bars of the test), stop 0.6 ATR back, target 1.5 R
//            out at the stop (first, when both fall in one bar), the target, or after two hours / 3:15 PM,
//            with charges taken off. The result is one row per test: R after costs.
//   BOOK     the rows of the last 60 sessions added up by kind of level, play and side, for all stocks
//            ("pooled") and for each stock on its own; a stock's own record is shrunk towards the pooled one
//            by its sample size, so a stock with three tests does not outrank a record of three thousand.
//   SUGGEST  for the next session, each stock's yesterday-derived levels, each as a bounce and as a break
//            from the side the price is on, ranked by the book's expected R; the rows say how many tests
//            they rest on and whether the stock's own record or the pooled one was used.
//   SKILL    each session, the book built from the sessions BEFORE it chooses its top levels for that
//            session; they are then marked against what those levels actually did that day, and against
//            the average level that day. A rising gap is what "getting more intelligent" means here:
//            counted out of sample, never assumed.
//
// Pure arithmetic: no AI, no network, no clock, no orders. A level's record is evidence with a sample
// size, never a promise about the next test.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (num(x) ? Math.round(x * 1000) / 1000 : null);
const IST = 5.5 * 3600 * 1000;
const minOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);

const KINDS = {
  pdh: "Yesterday's high",
  pdl: "Yesterday's low",
  pdc: "Yesterday's close",
  p: "Pivot point",
  r1: "R1",
  s1: "S1",
  r2: "R2",
  s2: "S2",
  orh: "Opening-range high",
  orl: "Opening-range low",
  vwap: "VWAP",
};
/** The levels a suggestion can name before the open (the opening range and VWAP do not exist yet). */
const PRE_OPEN = ["pdh", "pdl", "pdc", "p", "r1", "s1", "r2", "s2"];
const PLAYS = { bounce: "Holds", break: "Breaks" };

const STOP_ATR = 0.6;
const TARGET_R = 1.5;
const BREAK_ATR = 0.2;
const BREAK_WITHIN = 6;
const MAX_BARS = 24; // two hours of 5-minute bars
const FIRST = 3; // the opening range is the first three bars; tests start at 9:30
const LAST_MIN = 14 * 60 + 30; // no test starts after 2:30 PM
const { exitMinFor } = require("../market/session");
// a test still open is closed at the last 5-minute bar before the broker's square-off on that day: 3:15 PM under the old
// rules, 3:10 PM since 3 August 2026
const exitMemo = new Map();
const exitMinOf = (ms) => {
  const date = new Date(ms + IST).toISOString().slice(0, 10);
  if (!exitMemo.has(date)) exitMemo.set(date, exitMinFor(date));
  return exitMemo.get(date);
};
const K_SHRINK = 8; // a stock's own record counts for this many pooled tests when shrunk
const WINDOW = 120; // sessions in the book (the stored year gives more than that; the older ones count for less than the recent)
const MIN_POOLED = 40;
const MIN_SESSIONS = 8; // fewer sessions than this are not worth a suggestion: the book shows none and the robot does not consult it

const keyOf = (kind, play, side) => `${kind}|${play}|${side}`;

/** The levels one session starts with, from the session before it. */
function levelsFrom(prev) {
  if (!prev || ![prev.h, prev.l, prev.c].every(num)) return null;
  const p = (prev.h + prev.l + prev.c) / 3;
  return { pdh: prev.h, pdl: prev.l, pdc: prev.c, p, r1: 2 * p - prev.l, s1: 2 * p - prev.h, r2: p + (prev.h - prev.l), s2: p - (prev.h - prev.l) };
}

/** The 5-minute range a stock usually has: the mean high-low of the bars given. */
function meanRange(bars) {
  const xs = bars.filter((b) => num(b.h) && num(b.l)).map((b) => b.h - b.l);
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null;
}

/** Charges as a share of the entry price for a round trip (the caller passes its own estimate). */
function costR(costPct, entry, risk) {
  return risk > 0 ? ((costPct / 100) * entry) / risk : 0;
}

/**
 * Walk the bars after an entry: out at the stop (first when both fall in one bar), the target, or the time.
 * @returns { r, why } the result in R before costs
 */
function walk(bars, from, entry, stop, target, dir) {
  const last = Math.min(bars.length - 1, from + MAX_BARS);
  for (let i = from; i <= last; i += 1) {
    const b = bars[i];
    const hitStop = dir > 0 ? b.l <= stop : b.h >= stop;
    const hitTarget = dir > 0 ? b.h >= target : b.l <= target;
    if (hitStop) return { r: -1, why: "stop", bar: i };
    if (hitTarget) return { r: TARGET_R, why: "target", bar: i };
    if (minOf(b.t) >= exitMinOf(b.t)) return { r: (dir * (b.c - entry)) / Math.abs(entry - stop), why: "time", bar: i };
  }
  const b = bars[last];
  return { r: (dir * (b.c - entry)) / Math.abs(entry - stop), why: "time", bar: last };
}

/**
 * Every level's first test of one session, traded both ways.
 * @param bars   that session's 5-minute bars, in order
 * @param prev   the session before it: { h, l, c }
 * @param opts   { costPct, atr5 (the stock's usual 5-minute range, for the first bars) }
 * @returns { levels, atr5, trials: [{ k, p, s, m, r, why }] }
 */
function studySession(bars, prev, { costPct = 0.1, atr5 = null } = {}) {
  const lv = levelsFrom(prev);
  if (!lv || bars.length < 20) return { levels: lv, atr5, trials: [] };
  const open = bars.slice(0, FIRST);
  const orh = Math.max(...open.map((b) => b.h));
  const orl = Math.min(...open.map((b) => b.l));
  const base = { ...lv, orh, orl };
  const usual = num(atr5) && atr5 > 0 ? atr5 : meanRange(bars.slice(0, 12)) || 0;
  const trials = [];
  const seen = new Set();
  let pv = 0;
  let vol = 0;
  const vw = [];
  for (const b of bars) {
    const v = num(b.v) && b.v > 0 ? b.v : 1;
    pv += ((b.h + b.l + b.c) / 3) * v;
    vol += v;
    vw.push(pv / vol);
  }
  for (let i = FIRST; i < bars.length - 2; i += 1) {
    const b = bars[i];
    if (minOf(b.t) > LAST_MIN) break;
    const prior = bars.slice(Math.max(0, i - 12), i);
    const atr = Math.max(meanRange(prior) || 0, usual * 0.6, b.c * 0.0004);
    if (!(atr > 0)) continue;
    const prevClose = bars[i - 1].c;
    for (const kind of Object.keys(KINDS)) {
      const L = kind === "vwap" ? vw[i - 1] : base[kind];
      if (!num(L) || seen.has(kind) || !(b.l <= L && L <= b.h)) continue;
      seen.add(kind);
      const above = prevClose > L; // the price came down onto the level: a support test
      const risk = STOP_ATR * atr;
      const rc = costR(costPct, L, risk);
      // bounce: the level holds
      {
        const dir = above ? 1 : -1;
        const stop = L - dir * risk;
        const target = L + dir * TARGET_R * risk;
        const stoppedNow = dir > 0 ? b.c <= stop : b.c >= stop;
        const w = stoppedNow ? { r: -1, why: "stop" } : walk(bars, i + 1, L, stop, target, dir);
        trials.push({ k: kind, p: "bounce", s: dir > 0 ? "long" : "short", m: minOf(b.t), r: r2(w.r - rc), why: w.why });
      }
      // break: the level gives way, a 5-minute close 0.2 ATR beyond it within six bars
      for (let j = i; j < Math.min(bars.length - 1, i + BREAK_WITHIN); j += 1) {
        const c = bars[j].c;
        const through = above ? c <= L - BREAK_ATR * atr : c >= L + BREAK_ATR * atr;
        if (!through) continue;
        const dir = above ? -1 : 1;
        const entry = c;
        const stop = entry - dir * risk;
        const target = entry + dir * TARGET_R * risk;
        const w = walk(bars, j + 1, entry, stop, target, dir);
        trials.push({ k: kind, p: "break", s: dir > 0 ? "long" : "short", m: minOf(bars[j].t), r: r2(w.r - costR(costPct, entry, risk)), why: w.why });
        break;
      }
    }
  }
  return { levels: lv, atr5: usual, trials };
}

/** One session's trials added up, for the book: pooled and per stock, as [tests, wins, sum of R]. */
function aggregate(trialsBySymbol) {
  const pooled = {};
  const stock = {};
  const add = (o, key, r) => {
    const a = o[key] || (o[key] = [0, 0, 0]);
    a[0] += 1;
    if (r > 0) a[1] += 1;
    a[2] = r3(a[2] + r);
  };
  for (const [sym, trials] of Object.entries(trialsBySymbol)) {
    for (const t of trials) {
      const key = keyOf(t.k, t.p, t.s);
      add(pooled, key, t.r);
      add((stock[sym] = stock[sym] || {}), key, t.r);
    }
  }
  return { pooled, stock };
}

/** The book: the last WINDOW sessions' aggregates added up. @param sessions [{ date, pooled, stock }] */
function buildBook(sessions, { upTo = null } = {}) {
  const list = sessions
    .filter((s) => s && (!upTo || s.date < upTo))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-WINDOW);
  const pooled = {};
  const stock = {};
  const sum = (o, key, v) => {
    const a = o[key] || (o[key] = [0, 0, 0]);
    a[0] += v[0];
    a[1] += v[1];
    a[2] += v[2];
  };
  for (const s of list) {
    for (const [k, v] of Object.entries(s.pooled || {})) sum(pooled, k, v);
    for (const [sym, m] of Object.entries(s.stock || {})) for (const [k, v] of Object.entries(m)) sum((stock[sym] = stock[sym] || {}), k, v);
  }
  return { sessions: list.length, from: list.length ? list[0].date : null, to: list.length ? list[list.length - 1].date : null, pooled, stock };
}

/** The expected result of one play at one kind of level for one stock, own record shrunk towards the pooled one. */
function edge(book, symbol, kind, play, side) {
  const key = keyOf(kind, play, side);
  const p = book.pooled[key];
  if (!p || p[0] < MIN_POOLED) return null;
  const poolAvg = p[2] / p[0];
  const poolHit = p[1] / p[0];
  const s = (book.stock[symbol] || {})[key] || [0, 0, 0];
  const n = s[0];
  return {
    key,
    ev: r3((s[2] + K_SHRINK * poolAvg) / (n + K_SHRINK)),
    hit: Math.round(((s[1] + K_SHRINK * poolHit) / (n + K_SHRINK)) * 100),
    n,
    pooledN: p[0],
    pooledEv: r3(poolAvg),
    pooledHit: Math.round(poolHit * 100),
    own: n >= 3,
  };
}

/**
 * The best levels for one stock for the next session.
 * @param last  { h, l, c, atr5 } the session just finished
 */
function suggestFor(book, symbol, last, { top = 2 } = {}) {
  const lv = levelsFrom(last);
  if (!lv) return [];
  const atr = num(last.atr5) && last.atr5 > 0 ? last.atr5 : null;
  if (!atr) return [];
  const rows = [];
  for (const kind of PRE_OPEN) {
    const L = lv[kind];
    if (!num(L)) continue;
    const above = last.c > L; // the open will come down onto it: a support test
    for (const play of Object.keys(PLAYS)) {
      const dir = play === "bounce" ? (above ? 1 : -1) : above ? -1 : 1;
      const e = edge(book, symbol, kind, play, dir > 0 ? "long" : "short");
      if (!e) continue;
      const risk = STOP_ATR * atr;
      const entry = play === "bounce" ? L : L - (above ? 1 : -1) * BREAK_ATR * atr;
      rows.push({
        symbol,
        kind,
        kindName: KINDS[kind],
        level: r2(L),
        play,
        side: dir > 0 ? "long" : "short",
        entry: r2(entry),
        stop: r2(entry - dir * risk),
        target: r2(entry + dir * TARGET_R * risk),
        riskPct: r2((risk / entry) * 100),
        trigger: play === "bounce" ? `${dir > 0 ? "falls to" : "rises to"} ${r2(L)} and holds` : `closes a 5-minute bar ${dir > 0 ? "above" : "below"} ${r2(entry)}`,
        ...e,
      });
    }
  }
  return rows.filter((r) => r.ev > 0.02).sort((a, b) => b.ev - a.ev).slice(0, top);
}

/** The book's best levels for every stock, ranked across the NIFTY 100. @param lasts { SYMBOL: { h, l, c, atr5 } } */
function suggestAll(book, lasts, { top = 2, limit = 40 } = {}) {
  const rows = [];
  for (const [sym, last] of Object.entries(lasts)) rows.push(...suggestFor(book, sym, last, { top }));
  return rows.sort((a, b) => b.ev - a.ev).slice(0, limit);
}

/**
 * Out-of-sample skill, session by session. @param sessions [{ date, pooled, stock, lasts }], `lasts` being the
 * levels' source for that session ({ SYMBOL: { h, l, c, atr5 } }, the session before it).
 */
function skillSeries(sessions, { minBook = 5, top = 2 } = {}) {
  const list = sessions.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  list.forEach((s, i) => {
    const prior = list.slice(0, i);
    if (prior.length < minBook || !s.lasts) return out.push({ date: s.date, evaluated: false, sessionsBefore: prior.length });
    const book = buildBook(prior);
    const picked = suggestAll(book, s.lasts, { top, limit: 60 });
    let n = 0;
    let w = 0;
    let sr = 0;
    for (const r of picked) {
      const a = ((s.stock || {})[r.symbol] || {})[r.key];
      if (a) {
        n += a[0];
        w += a[1];
        sr += a[2];
      }
    }
    // the average level that session, over the kinds a suggestion can name
    let an = 0;
    let aw = 0;
    let asr = 0;
    for (const m of Object.values(s.stock || {})) {
      for (const [k, a] of Object.entries(m)) {
        if (!PRE_OPEN.includes(k.split("|")[0])) continue;
        an += a[0];
        aw += a[1];
        asr += a[2];
      }
    }
    out.push({
      date: s.date,
      evaluated: true,
      sessionsBefore: prior.length,
      suggested: picked.length,
      triggered: n,
      hitPct: n ? Math.round((w / n) * 100) : null,
      avgR: n ? r3(sr / n) : null,
      allTests: an,
      allHitPct: an ? Math.round((aw / an) * 100) : null,
      allAvgR: an ? r3(asr / an) : null,
      gap: n && an ? r3(sr / n - asr / an) : null,
      sumR: r3(sr),
      allSumR: r3(asr),
    });
  });
  return out;
}

/**
 * Whether the book has learned enough to be trusted: at least `sessions` studied, at least 60 of its
 * suggested tests marked out of sample, and the suggested levels beating the average level on the
 * recent sessions (the gap positive, and positive on more than half of the sessions marked).
 */
function graduation(series, studied, { sessions = 15 } = {}) {
  const ev = series.filter((x) => x.evaluated && num(x.gap));
  const recent = ev.slice(-10);
  const tests = recent.reduce((a, x) => a + x.triggered, 0);
  const sumR = recent.reduce((a, x) => a + (x.sumR || 0), 0);
  const allSum = recent.reduce((a, x) => a + (x.allSumR || 0), 0);
  const allN = recent.reduce((a, x) => a + x.allTests, 0);
  const meanGap = tests && allN ? sumR / tests - allSum / allN : null;
  const better = recent.filter((x) => x.gap > 0).length;
  const enough = studied >= sessions && tests >= 60 && recent.length >= 5;
  const passed = enough && num(meanGap) && meanGap > 0 && better > recent.length / 2;
  return {
    target: sessions,
    studied,
    marked: ev.length,
    tests,
    meanGap: r3(meanGap),
    better,
    of: recent.length,
    state: passed ? "graduated" : studied < sessions ? "learning" : enough ? "not-yet" : "learning",
    text: passed
      ? `Out of sample, over the last ${recent.length} sessions its suggested levels made ${r3(meanGap)}R a test more than the average level (${tests} tests, ahead on ${better} of ${recent.length} sessions).`
      : studied < sessions
        ? `${studied} of ${sessions} sessions studied. It is not asked to suggest with confidence until it has seen ${sessions} and its suggestions have beaten the average level out of sample.`
        : !enough
          ? `${studied} sessions studied, but only ${tests} of its suggested tests have been marked out of sample (it needs 60 over at least 5 sessions).`
          : `${studied} sessions studied. Out of sample its suggested levels have not yet beaten the average level (${num(meanGap) ? `${meanGap > 0 ? "+" : ""}${r3(meanGap)}R a test, ahead on ${better} of ${recent.length} sessions` : "no gap measured"}). It keeps studying.`,
  };
}

/** The nearest level to a price within a fraction of an ATR, among those a session has (for tagging a live entry). */
function nearestLevel(f, price, atr, within = 0.35) {
  if (!f || !num(price) || !num(atr) || atr <= 0) return null;
  const lv = { pdh: f.pdh, pdl: f.pdl, pdc: f.pdc, orh: f.orh, orl: f.orl, vwap: f.vwap, ...(f.pivots ? { p: f.pivots.p, r1: f.pivots.r1, s1: f.pivots.s1, r2: f.pivots.r2, s2: f.pivots.s2 } : {}) };
  let best = null;
  for (const [k, v] of Object.entries(lv)) {
    if (!num(v)) continue;
    const d = Math.abs(price - v) / atr;
    if (d <= within && (!best || d < best.d)) best = { kind: k, level: r2(v), d: r2(d), below: v <= price };
  }
  return best;
}

module.exports = { KINDS, PRE_OPEN, PLAYS, STOP_ATR, TARGET_R, WINDOW, MIN_POOLED, MIN_SESSIONS, levelsFrom, meanRange, studySession, aggregate, buildBook, edge, suggestFor, suggestAll, skillSeries, graduation, nearestLevel, keyOf, dateOf };
