"use strict";
// The Intraday Plan: what the next session may look like for one stock, and whether — and how — it
// is worth trading intraday. Meant for when the market is shut (evenings, nights, weekends, before
// 9:15), and built by arithmetic from the stock's own history — no AI, no network, no clock, no order.
//
// It sits ON TOP of the Next-Session Outlook (outlook.js), whose lean, agreement and pivots enter
// whole; nothing there changes. What it adds is the inside of a day, measured on this stock:
//   habits     how it trades within a session — its normal range, how often the 9:15–9:30 opening
//              range breaks and holds, how often the day's high or low is set in the first hour,
//              trend days against range days, whether the 10:15 side of VWAP holds to the close,
//              how often gaps fill
//   the record the plan's own rules replayed on every past session it has 5-minute bars for, each
//              day planned only with the bars before it (no look-ahead), after costs, in R
//   the odds   after past days whose chart read the same way, how often the next session closed up
//   the open   where it may open: GIFT Nifty's overnight move times this stock's measured
//              sensitivity to the Nifty's gaps (when the cue is there), with a normal spread
//   the day    an expected high and low from that open, a wide day's range, and a level ladder
//   options    when the stock has options: the option chain's bias (PCR, fresh writing, futures
//              build-up, the OI walls, max pain) as one more factor, and its walls on the ladder
//   the call   LONG / SHORT on a trigger, trade the OPENING-RANGE break, WAIT, or AVOID — with the
//              reasons for and against, and a checklist to tick before the order
//
// Every number is a measurement of the past, labelled with how many sessions it rests on. It is
// not a promise, not a probability of profit, and not advice; it never places an order.

const I = require("./indicators");
const { buildOutlook } = require("./outlook");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TICK = 0.05;
const onTick = (x) => (num(x) ? r2(Math.round(x / TICK) * TICK) : null);
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quant = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[clamp(Math.round((s.length - 1) * q), 0, s.length - 1)];
};
const hmOf = (t) => String(t).slice(11, 16);
const dayOf = (t) => String(t).slice(0, 10);

const LEAN_AT = 22; // the outlook's own threshold for a lean
const OR_END = "09:30"; // the opening range is 9:15–9:30: the first fifteen minutes
const LAST_ENTRY = "15:00";
const SQUARE_OFF = "15:15";
const DAILY_WINDOW = 260; // daily bars handed to each past outlook: enough for the 200-day average
const MIN_SESSION_BARS = 60; // of 75: shorter sessions (special or broken days) are left out

/** Normal intraday range of the 20 completed sessions up to index k, in ₹ and as % of the close. */
function dayRange(daily, k) {
  const rows = [];
  for (let i = Math.max(1, k - 19); i <= k; i += 1) {
    const pc = daily[i - 1].c;
    if (pc > 0 && daily[i].h >= daily[i].l) rows.push(((daily[i].h - daily[i].l) / pc) * 100);
  }
  const p = median(rows);
  return num(p) ? { pct: p, rs: (p / 100) * daily[k].c } : null;
}

/**
 * The plan's rules — the same function draws tomorrow's plan and replays every past one, so the
 * record is the record of exactly what is shown.
 *   long   above the previous session's high (or the pivot, whichever is higher) after 9:30;
 *          stop at the pivot or the previous low, held between 0.3 and 0.5 of a normal day's range;
 *          targets at the first resistance paying 1.2× the risk (else 1.5×), the next (else 2.5×)
 *   short  the mirror image below the previous low — intraday only
 *   exit   at the stop, at target 1, or at 3:15 PM; no new entry after 3:00 PM
 */
function plansFor(prev, dayR) {
  const pv = I.pivots({ h: prev.h, l: prev.l, c: prev.c });
  const buf = Math.max(TICK, 0.03 * dayR);
  const lo = 0.3 * dayR;
  const hi = 0.5 * dayR;
  const res = [pv.r1, pv.r2, pv.r3].filter(num);
  const sup = [pv.s1, pv.s2, pv.s3].filter(num);
  const longE = onTick(Math.max(prev.h, pv.p) + buf);
  const longS = onTick(longE - clamp(longE - Math.max(pv.p, prev.l), lo, hi));
  const lr = longE - longS;
  const lt1 = res.find((p) => p >= longE + 1.2 * lr && p <= longE + 3 * lr);
  const t1L = num(lt1) ? lt1 : longE + 1.5 * lr;
  const lt2 = res.find((p) => p >= t1L + 0.5 * lr);
  const shortE = onTick(Math.min(prev.l, pv.p) - buf);
  const shortS = onTick(shortE + clamp(Math.min(pv.p, prev.h) - shortE, lo, hi));
  const sr = shortS - shortE;
  const st1 = sup.find((p) => p <= shortE - 1.2 * sr && p >= shortE - 3 * sr);
  const t1S = num(st1) ? st1 : shortE - 1.5 * sr;
  const st2 = sup.find((p) => p <= t1S - 0.5 * sr);
  return {
    pivots: pv,
    long: { side: "long", entry: longE, stop: longS, targets: [onTick(t1L), onTick(num(lt2) ? lt2 : longE + 2.5 * lr)], riskPerShare: r2(lr), riskPct: r2((lr / longE) * 100), rewardToRisk: r2((t1L - longE) / lr) },
    short: { side: "short", entry: shortE, stop: shortS, targets: [onTick(t1S), onTick(num(st2) ? st2 : shortE - 2.5 * sr)], riskPerShare: r2(sr), riskPct: r2((sr / shortE) * 100), rewardToRisk: r2((shortE - t1S) / sr) },
  };
}

/**
 * One side of a plan played on one session's 5-minute bars. Conservative where a bar cannot say
 * which came first: a bar that triggers the entry and touches the stop is a loss, and a target is
 * only counted from the bar after the entry.
 * @returns { idx, fill, exit, how: "target"|"stop"|"time", r } or null when it never triggered
 */
function play(bars, plan, side, costPct, from = startOf(bars)) {
  const risk = Math.abs(plan.entry - plan.stop);
  if (!(risk > 0)) return null;
  const t1 = plan.targets[0];
  let i = from;
  let fill = null;
  let idx = -1;
  for (; i < bars.length; i += 1) {
    const b = bars[i];
    if (hmOf(b.t) >= LAST_ENTRY) return null;
    if (side === "long" ? b.h >= plan.entry : b.l <= plan.entry) {
      fill = side === "long" ? Math.max(plan.entry, b.o) : Math.min(plan.entry, b.o);
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const done = (exit, how) => {
    const move = side === "long" ? exit - fill : fill - exit;
    const cost = (costPct / 100) * fill;
    return { idx, fill: r2(fill), exit: r2(exit), how, r: r2((move - cost) / risk), at: hmOf(bars[idx].t) };
  };
  const first = bars[idx];
  if (side === "long" ? first.l <= plan.stop : first.h >= plan.stop) return done(plan.stop, "stop");
  for (let j = idx + 1; j < bars.length; j += 1) {
    const b = bars[j];
    if (hmOf(b.t) >= SQUARE_OFF) return done(b.o, "time");
    if (side === "long") {
      if (b.l <= plan.stop) return done(Math.min(plan.stop, b.o), "stop");
      if (b.h >= t1) return done(Math.max(t1, b.o), "target");
    } else {
      if (b.h >= plan.stop) return done(Math.max(plan.stop, b.o), "stop");
      if (b.l <= t1) return done(Math.min(t1, b.o), "target");
    }
  }
  return done(bars[bars.length - 1].c, "time");
}

/** Index of the first bar at or after 9:30 (the bars before it are the opening range), or -1. */
function startOf(bars) {
  return bars.findIndex((b) => hmOf(b.t) >= OR_END);
}

/** The opening-range plan, known only at 9:30: break of the first fifteen minutes' high or low. */
function orbPlan(bars, dayR, start = startOf(bars)) {
  const or = bars.slice(0, start);
  const h = Math.max(...or.map((b) => b.h));
  const l = Math.min(...or.map((b) => b.l));
  const span = h - l;
  const stopD = clamp(span, 0.15 * dayR, 0.5 * dayR);
  const buf = Math.max(TICK, 0.02 * dayR);
  const le = h + buf;
  const se = l - buf;
  return {
    h,
    l,
    long: { entry: le, stop: le - stopD, targets: [le + 1.5 * stopD, le + 2.5 * stopD] },
    short: { entry: se, stop: se + stopD, targets: [se - 1.5 * stopD, se - 2.5 * stopD] },
  };
}

/** Whichever side triggers first; a bar that triggers both is a whipsaw and is left alone. */
function firstOf(a, b) {
  if (a && b) {
    if (a.idx === b.idx) return null;
    return a.idx < b.idx ? a : b;
  }
  return a || b || null;
}

function stats(list) {
  const n = list.length;
  if (!n) return { trades: 0, verdict: "no trades" };
  const rs = list.map((t) => t.r);
  const wins = rs.filter((r) => r > 0).length;
  const avg = mean(rs);
  const sd = n > 1 ? Math.sqrt(rs.reduce((s, r) => s + (r - avg) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 && sd > 0 ? avg / (sd / Math.sqrt(n)) : null;
  const gain = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const loss = -rs.filter((r) => r < 0).reduce((s, r) => s + r, 0);
  const how = (h) => Math.round((list.filter((x) => x.how === h).length / n) * 100);
  const verdict = n < 8 ? "too few to judge" : avg > 0 && num(t) && t >= 2 ? "held up" : avg > 0 ? "positive, not proven" : "did not pay";
  return { trades: n, wins, losses: n - wins, winRate: Math.round((wins / n) * 100), avgR: r2(avg), totalR: r2(rs.reduce((s, r) => s + r, 0)), profitFactor: loss > 0 ? r2(gain / loss) : null, t: r2(t), targetPct: how("target"), stopPct: how("stop"), timePct: how("time"), verdict };
}
const reliable = (s) => s && s.trades >= 8 && s.avgR >= 0.05;
const poor = (s) => s && s.trades >= 8 && s.avgR < 0;

/** The next weekday after a date. Exchange holidays are not known here; the page corrects for them. */
function nextWeekday(date) {
  const t = new Date(`${date}T00:00:00Z`);
  do t.setUTCDate(t.getUTCDate() + 1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return t.toISOString().slice(0, 10);
}

/** The chart-only lean of the session after daily[k]: the outlook with no research direction or odds. */
function chartLean(daily, k) {
  if (k < 40) return null;
  const o = buildOutlook({ candles: daily.slice(Math.max(0, k + 1 - DAILY_WINDOW), k + 1) });
  return o.available ? o.score : null;
}
const bucketOf = (s) => (!num(s) ? null : s >= LEAN_AT ? "up" : s <= -LEAN_AT ? "down" : "flat");

/**
 * @param daily     daily bars, oldest first: { t: "YYYY-MM-DD", o, h, l, c, v }
 * @param forming   true when the newest daily bar is today's and still being written
 * @param bars5     past 5-minute bars (many sessions): { t: "YYYY-MM-DDTHH:MM:SS+0530", o, h, l, c, v }
 * @param outlook   buildOutlook(...) for the next session (with direction and odds), or null
 * @param nifty     the Nifty's daily bars, for this stock's sensitivity to the Nifty's gaps, or null
 * @param gift      the GIFT Nifty context item { available, last, changePct }, or null
 * @param marketOpen true while the session is trading (the overnight cue is then not used)
 * @param costPct   assumed round-trip cost, % of the entry price
 * @param options   buildOptionChain(...) for the stock, or null (no options, or not read)
 * @param marketCue the NSE forecast from the world ({ gapPct, label, basis, score, word, firm, headline }), or null
 * @param news      what the Social Media page's news and posts said about this stock in the last day
 *                  ({ mentions, sentiment −1…+1, tone, high, items: [{ title, source, at }] }), or null
 */
function buildIntradayPlan({ daily, forming = false, bars5 = [], outlook = null, nifty = null, gift = null, marketOpen = false, costPct = 0.1, options = null, marketCue = null, news = null }) {
  if (!Array.isArray(daily) || daily.length < 60) return { available: false, reason: "Fewer than 60 daily bars: not enough history for an intraday plan." };
  const done = forming ? daily.slice(0, -1) : daily;
  const k = done.length - 1;
  const prev = done[k];
  const atr = I.atr(done.slice(-120), 14).slice(-1)[0];
  const dr = dayRange(done, k);
  if (!num(atr) || !dr || !(dr.rs > 0)) return { available: false, reason: "The daily bars have no range to measure." };
  const out = outlook && outlook.available ? outlook : buildOutlook({ candles: done.slice(-DAILY_WINDOW) });
  const plans = plansFor(prev, dr.rs);
  const idxOf = new Map(done.map((c, i) => [c.t, i]));

  /* ------------------------------------------------- the odds: what followed days that read the same */
  const leans = new Map(); // date of the session -> the chart lean drawn the evening before
  const cal = { up: [], down: [], flat: [] };
  for (let i = Math.max(41, k - 249); i <= k; i += 1) {
    const s = chartLean(done, i - 1);
    const b = bucketOf(s);
    if (!b) continue;
    leans.set(done[i].t, s);
    cal[b].push({ ch: pct(done[i].c, done[i - 1].c), fromOpen: pct(done[i].c, done[i].o) });
  }
  const odds = {};
  for (const [b, rows] of Object.entries(cal)) {
    odds[b] = rows.length ? { sessions: rows.length, closedUpPct: Math.round((rows.filter((x) => x.ch > 0).length / rows.length) * 100), aboveOpenPct: Math.round((rows.filter((x) => x.fromOpen > 0).length / rows.length) * 100), avgPct: r2(mean(rows.map((x) => x.ch))) } : { sessions: 0 };
  }
  const nowLean = chartLean(done, k);
  const nowBucket = bucketOf(nowLean) || "flat";

  /* --------------------------------------------------------- sessions from the 5-minute history */
  const byDay = new Map();
  for (const b of Array.isArray(bars5) ? bars5 : []) {
    if (!b || !num(b.o) || !num(b.h) || !num(b.l) || !num(b.c)) continue;
    const hm = hmOf(b.t);
    if (hm < "09:15" || hm > "15:29") continue;
    const d = dayOf(b.t);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(b);
  }
  const sessions = [...byDay.entries()]
    .filter(([d, bars]) => idxOf.has(d) && idxOf.get(d) > 41 && bars.length >= MIN_SESSION_BARS)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-150)
    .map(([d, bars]) => ({ d, bars: bars.sort((x, y) => (x.t < y.t ? -1 : 1)), i: idxOf.get(d) }));

  let habits = null;
  let record = null;
  if (sessions.length >= 15) {
    const H = { ranges: [], orPct: [], up: 0, down: 0, none: 0, held: 0, broke: 0, runs: [], firstHour: 0, trend: 0, vwapSame: 0, vwapN: 0, gaps: 0, filled: 0, drive: 0, highT: { open: 0, mid: 0, late: 0 }, lowT: { open: 0, mid: 0, late: 0 } };
    const lean = { long: [], short: [], all: [] };
    const both = [];
    const orb = [];
    const recent = [];
    for (const s of sessions) {
      const p = done[s.i - 1];
      const bars = s.bars;
      const start = startOf(bars);
      if (start < 1) continue;
      const o = bars[0].o;
      const c = bars[bars.length - 1].c;
      let h = -Infinity;
      let l = Infinity;
      let hi = 0;
      let li = 0;
      bars.forEach((b, j) => {
        if (b.h > h) {
          h = b.h;
          hi = j;
        }
        if (b.l < l) {
          l = b.l;
          li = j;
        }
      });
      const span = h - l;
      H.ranges.push((span / p.c) * 100);
      const zone = (j) => (hmOf(bars[j].t) < "10:15" ? "open" : hmOf(bars[j].t) < "14:00" ? "mid" : "late");
      H.highT[zone(hi)] += 1;
      H.lowT[zone(li)] += 1;
      if (zone(hi) === "open" || zone(li) === "open") H.firstHour += 1;
      if (span > 0 && ((c - l) / span >= 0.8 || (c - l) / span <= 0.2)) H.trend += 1;
      // the opening range and its first break
      const orH = Math.max(...bars.slice(0, start).map((b) => b.h));
      const orL = Math.min(...bars.slice(0, start).map((b) => b.l));
      H.orPct.push(((orH - orL) / p.c) * 100);
      let brk = null;
      let after = -Infinity;
      let below = Infinity;
      for (let j = start; j < bars.length; j += 1) {
        const b = bars[j];
        if (!brk && b.h > orH && b.l < orL) break; // a whipsaw bar: no clean first break
        if (!brk && b.h > orH) brk = "up";
        else if (!brk && b.l < orL) brk = "down";
        if (brk) {
          after = Math.max(after, b.h);
          below = Math.min(below, b.l);
        }
      }
      if (brk === "up") {
        H.up += 1;
        H.broke += 1;
        if (c > orH) H.held += 1;
        if (orH > orL) H.runs.push((after - orH) / (orH - orL));
      } else if (brk === "down") {
        H.down += 1;
        H.broke += 1;
        if (c < orL) H.held += 1;
        if (orH > orL) H.runs.push((orL - below) / (orH - orL));
      } else H.none += 1;
      // the side of VWAP at 10:15 against the side at the close
      let pv = 0;
      let vv = 0;
      let at1015 = null;
      for (const b of bars) {
        const v = b.v > 0 ? b.v : 1;
        pv += ((b.h + b.l + b.c) / 3) * v;
        vv += v;
        if (at1015 === null && hmOf(b.t) >= "10:10") at1015 = Math.sign(b.c - pv / vv);
      }
      const atClose = Math.sign(c - pv / vv);
      if (at1015 && atClose) {
        H.vwapN += 1;
        if (at1015 === atClose) H.vwapSame += 1;
      }
      // the gap, and whether the day came back to the previous close
      const g = pct(o, p.c);
      if (num(g) && Math.abs(g) >= 0.3) {
        H.gaps += 1;
        if (g > 0 ? l <= p.c : h >= p.c) H.filled += 1;
      }
      const first15 = bars[start - 1].c - o;
      if (Math.sign(first15) !== 0 && Math.sign(first15) === Math.sign(c - o)) H.drive += 1;

      // the record: this day planned with the bars before it only
      const drs = dayRange(done, s.i - 1);
      if (!drs) continue;
      const pl = plansFor(p, drs.rs);
      const L = play(bars, pl.long, "long", costPct, start);
      const S = play(bars, pl.short, "short", costPct, start);
      const first = firstOf(L, S);
      if (first) both.push({ ...first, side: first === L ? "long" : "short", d: s.d });
      const bk = bucketOf(leans.get(s.d));
      if (bk === "up" && L) {
        lean.long.push({ ...L, side: "long", d: s.d });
        lean.all.push({ ...L, side: "long", d: s.d });
      } else if (bk === "down" && S) {
        lean.short.push({ ...S, side: "short", d: s.d });
        lean.all.push({ ...S, side: "short", d: s.d });
      }
      const ob = orbPlan(bars, drs.rs, start);
      const oL = play(bars, ob.long, "long", costPct, start);
      const oS = play(bars, ob.short, "short", costPct, start);
      const of = firstOf(oL, oS);
      if (of) orb.push({ ...of, side: of === oL ? "long" : "short", d: s.d });
    }
    const n = sessions.length;
    const share = (x, of = n) => (of ? Math.round((x / of) * 100) : null);
    habits = {
      sessions: n,
      from: sessions[0].d,
      to: sessions[n - 1].d,
      rangePct: { median: r2(median(H.ranges)), low: r2(quant(H.ranges, 0.2)), high: r2(quant(H.ranges, 0.8)) },
      openingRange: {
        medianPct: r2(median(H.orPct)),
        upPct: share(H.up),
        downPct: share(H.down),
        nonePct: share(H.none),
        heldPct: share(H.held, H.broke),
        avgRun: r2(mean(H.runs)),
        note: H.broke ? `The 9:15–9:30 range broke on ${share(H.broke)}% of days; the first break held to the close ${share(H.held, H.broke)}% of the time and ran on average ${r1(mean(H.runs))}× the range's height.` : "The opening range rarely broke cleanly.",
      },
      firstHourExtremePct: share(H.firstHour),
      highTime: { openPct: share(H.highT.open), midPct: share(H.highT.mid), latePct: share(H.highT.late) },
      lowTime: { openPct: share(H.lowT.open), midPct: share(H.lowT.mid), latePct: share(H.lowT.late) },
      trendDayPct: share(H.trend),
      vwapHoldPct: share(H.vwapSame, H.vwapN),
      gapFillPct: H.gaps >= 5 ? share(H.filled, H.gaps) : null,
      gaps: H.gaps,
      openDrivePct: share(H.drive),
    };
    const tail = (list) => list.slice(-12).reverse().map((t) => ({ date: t.d, side: t.side, at: t.at, entry: t.fill, exit: t.exit, r: t.r, how: t.how }));
    record = {
      sessions: n,
      costPct,
      lean: { ...stats(lean.all), long: stats(lean.long), short: stats(lean.short) },
      both: { ...stats(both), long: stats(both.filter((t) => t.side === "long")), short: stats(both.filter((t) => t.side === "short")) },
      orb: stats(orb),
      recent: tail(lean.all.length >= 6 ? lean.all : both),
      recentPolicy: lean.all.length >= 6 ? "lean" : "both",
      rule: `Every past session with 5-minute bars was planned with the daily bars up to the evening before only, by the same rules as tomorrow's plan, then played on that day's bars: an entry only after 9:30 and before 3:00 PM, out at the stop, at target 1 or at 3:15 PM; a bar that touches both the entry and the stop counts as a loss. "Followed the lean" takes the long only after an up-leaning chart and the short only after a down-leaning one. Results are in R (1R = the planned risk) after a ${costPct}% round-trip cost.`,
    };
  }

  /* ------------------------------------------------------------------- where it may open */
  let beta = null;
  let gapSd = null;
  {
    const nIdx = new Map((Array.isArray(nifty) ? nifty : []).map((c, i) => [c.t, i]));
    const xs = [];
    const ys = [];
    const own = [];
    for (let i = Math.max(1, k - 249); i <= k; i += 1) {
      const g = pct(done[i].o, done[i - 1].c);
      if (!num(g)) continue;
      own.push(g);
      const j = nIdx.get(done[i].t);
      if (j > 0) {
        const ng = pct(nifty[j].o, nifty[j - 1].c);
        if (num(ng)) {
          xs.push(ng);
          ys.push(g);
        }
      }
    }
    if (xs.length >= 40) {
      const mx = mean(xs);
      const my = mean(ys);
      const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
      if (vx > 0) {
        beta = clamp(xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / vx, 0, 3);
        const res = ys.map((y, i) => y - (my + beta * (xs[i] - mx)));
        gapSd = Math.sqrt(res.reduce((s, x) => s + x * x, 0) / Math.max(1, res.length - 2));
      }
    }
    if (!num(gapSd) && own.length >= 20) {
      const m = mean(own);
      gapSd = Math.sqrt(own.reduce((s, x) => s + (x - m) ** 2, 0) / (own.length - 1));
    }
  }
  const fromForecast = !marketOpen && marketCue && num(marketCue.gapPct);
  const cue = fromForecast ? marketCue.gapPct : !marketOpen && gift && gift.available && num(gift.changePct) ? gift.changePct : null;
  const gapPct = num(cue) ? (num(beta) ? beta : 1) * cue : 0;
  const sd = num(gapSd) ? Math.max(gapSd, 0.15) : 0.5; // never a band narrower than ±0.15%
  const openX = prev.c * (1 + gapPct / 100);
  const open = {
    expected: onTick(openX),
    low: onTick(prev.c * (1 + (gapPct - sd) / 100)),
    high: onTick(prev.c * (1 + (gapPct + sd) / 100)),
    gapPct: r2(gapPct),
    beta: r2(beta),
    cue: num(cue) ? r2(cue) : null,
    basis: fromForecast
      ? `The NSE forecast from the world expects ${marketCue.label || `a Nifty gap of ${r2(cue)}%`} (${marketCue.basis || "from the overseas cues"}); ${num(beta) ? `this stock's opens have moved about ${r2(beta)}× the Nifty's gap` : "taken one-for-one"}. The band is one normal spread of its opens (±${r2(sd)}%).`
      : num(cue)
      ? `GIFT Nifty is ${cue >= 0 ? "+" : ""}${r2(cue)}% from its last settlement; ${num(beta) ? `this stock's opens have moved about ${r2(beta)}× the Nifty's gap` : "taken one-for-one (too few Nifty sessions to measure this stock's sensitivity)"}. The band is one normal spread of its opens (±${r2(sd)}%). GIFT Nifty is a future: a hint for the open, not the Nifty itself.`
      : marketOpen
        ? "The session is trading: today's open is already known — this is the plan as it stood before the open."
        : `No overnight cue (GIFT Nifty not available): centred on the last close, with one normal spread of this stock's opens (±${r2(sd)}%).`,
  };

  /* ------------------------------------------------------------------ the day's expected range */
  const score = num(out.score) ? out.score : 0;
  const upShare = 0.5 + (clamp(score, -100, 100) / 100) * 0.25; // a lean tilts the range, a little
  const typ = habits ? (habits.rangePct.median / 100) * prev.c : dr.rs;
  const wide = habits ? (habits.rangePct.high / 100) * prev.c : 1.5 * dr.rs;
  const range = {
    low: onTick(openX - typ * (1 - upShare)),
    high: onTick(openX + typ * upShare),
    wideLow: onTick(openX - wide * (1 - upShare)),
    wideHigh: onTick(openX + wide * upShare),
    typicalPct: r2(habits ? habits.rangePct.median : dr.pct),
    basis: habits ? `a normal day for this stock spans ${r2(habits.rangePct.median)}% from high to low (median of ${habits.sessions} sessions; one day in five spans ${r2(habits.rangePct.high)}% or more), placed around the expected open and tilted slightly toward the lean` : `about ${r2(dr.pct)}% from high to low (median of the last 20 daily ranges), around the expected open`,
  };

  /* ---------------------------------------------------------------------------- the ladder */
  const pv = plans.pivots;
  const ladder = [
    ["R2", pv.r2, "res"],
    ["R1", pv.r1, "res"],
    ["Long trigger", plans.long.entry, "long"],
    ["Previous high", prev.h, "ref"],
    ["Pivot", pv.p, "ref"],
    ["Previous close", prev.c, "ref"],
    ["Expected open", open.expected, "open"],
    ["Previous low", prev.l, "ref"],
    ["Short trigger", plans.short.entry, "short"],
    ["S1", pv.s1, "sup"],
    ["S2", pv.s2, "sup"],
    ...(options && options.available
      ? [
          ["Call wall (most call OI)", options.resistance && options.resistance.strike, "res"],
          ["Put wall (most put OI)", options.support && options.support.strike, "sup"],
          ["Max pain", options.maxPain, "ref"],
        ].filter((x) => num(x[1]) && Math.abs(pct(x[1], openX)) <= 6)
      : []),
  ]
    .filter((x) => num(x[1]))
    .map(([label, price, kind]) => ({ label, price: onTick(price), kind, away: r2(pct(price, openX)) }))
    .sort((a, b) => b.price - a.price);

  /* ------------------------------------------------------------------------------ the call */
  const call = out.call || "neutral";
  const side = call === "long-bias" ? "long" : call === "short-bias" ? "short" : null;
  const chartSide = bucketOf(nowLean);
  const split = side && chartSide && chartSide !== "flat" && chartSide !== (side === "long" ? "up" : "down");
  const sideRec = record && side ? record.lean[side] : null;
  const orbRec = record ? record.orb : null;
  const plan = side ? plans[side] : null;
  const costShare = plan ? costPct / plan.riskPct : costPct / ((0.4 * dr.pct) || 1);
  const reasonsFor = [];
  const reasonsAgainst = [];
  const comps = (out.components || []).filter((c) => Math.abs(c.vote) >= 0.1).sort((a, b) => Math.abs(b.vote * b.weight) - Math.abs(a.vote * a.weight));
  const sideSign = side === "long" ? 1 : side === "short" ? -1 : Math.sign(score);
  for (const c of comps) {
    const line = `${c.label}: ${c.why}`;
    if (sideSign && Math.sign(c.vote) === sideSign) reasonsFor.length < 4 && reasonsFor.push(line);
    else if (sideSign) reasonsAgainst.length < 3 && reasonsAgainst.push(line);
  }
  const oddsNow = odds[nowBucket];
  if (oddsNow && oddsNow.sessions >= 20 && nowBucket !== "flat") {
    const line = `After past days whose chart leaned ${nowBucket} like this one, the next session closed higher ${oddsNow.closedUpPct}% of the time (${oddsNow.sessions} sessions, average ${oddsNow.avgPct >= 0 ? "+" : ""}${oddsNow.avgPct}%).`;
    const agrees = (nowBucket === "up" && oddsNow.closedUpPct >= 53) || (nowBucket === "down" && oddsNow.closedUpPct <= 47);
    (agrees ? reasonsFor : reasonsAgainst).push(line);
  }
  if (sideRec && sideRec.trades) {
    const line = `These exact ${side} rules, taken after a ${side === "long" ? "up" : "down"}-leaning chart, won ${sideRec.winRate}% of ${sideRec.trades} trades here, averaging ${sideRec.avgR >= 0 ? "+" : ""}${sideRec.avgR}R after costs — ${sideRec.verdict}.`;
    (sideRec.avgR > 0 ? reasonsFor : reasonsAgainst).push(line);
  }
  if (split) reasonsAgainst.push(`The chart alone leans ${chartSide}, against the full outlook: the evidence is split.`);
  if (costShare > 0.3) reasonsAgainst.push(`Costs of ${costPct}% would take ${Math.round(costShare * 100)}% of the planned risk: this stock moves too little in a day for intraday to pay well.`);
  if (num(open.gapPct) && Math.abs(open.gapPct) >= Math.max(0.8, 1.5 * sd)) reasonsAgainst.push(`A gap of about ${open.gapPct >= 0 ? "+" : ""}${open.gapPct}% is hinted: the levels re-anchor after a big gap — wait for the first 15 minutes.`);
  // the option chain: one more factor, with its reasons
  const opt = options && options.available && options.bias ? options : null;
  let optTilt = 0;
  if (opt) {
    const os = opt.bias.score;
    const top2 = opt.bias.votes.filter((v) => Math.abs(v.vote) >= 0.2).sort((a, b) => Math.abs(b.vote * b.weight) - Math.abs(a.vote * a.weight)).slice(0, 2).map((v) => v.why).join("; ");
    const line = `Options: ${opt.bias.label.toLowerCase()} (${os > 0 ? "+" : ""}${os})${top2 ? ` — ${top2}` : ""}.`;
    if (sideSign && Math.abs(os) >= 10) {
      (Math.sign(os) === sideSign ? reasonsFor : reasonsAgainst).push(line);
      optTilt = clamp(Math.round((os * sideSign) / 6), -8, 8);
    } else if (Math.abs(os) >= 10) reasonsFor.push(line);
    for (const c of opt.bias.cautions.slice(0, 2)) if (!/No earlier reading/.test(c)) reasonsAgainst.push(`Options: ${c}`);
  }
  // the world's read of the session: one more reason, for or against
  if (marketCue && marketCue.firm && sideSign) {
    const line = `World markets: ${marketCue.headline}.`;
    (Math.sign(marketCue.score) === sideSign ? reasonsFor : reasonsAgainst).push(line);
  } else if (marketCue && marketCue.headline && !marketOpen) reasonsFor.length < 6 && (marketCue.firm ? reasonsFor : reasonsAgainst).push(`World markets: ${marketCue.headline}.`);
  // the news and posts about this stock (Social Media): one more reason, for or against — never a trigger
  if (news && news.mentions > 0 && news.items && news.items[0]) {
    const tone = news.sentiment >= 0.2 ? 1 : news.sentiment <= -0.2 ? -1 : 0;
    const line = `News & social: ${news.mentions} item${news.mentions === 1 ? "" : "s"} in the last day, ${news.tone}${news.high ? ` (${news.high} high-impact)` : ""} — latest: “${String(news.items[0].title).slice(0, 140)}” (${news.items[0].source}).`;
    if (sideSign && tone) (tone === sideSign ? reasonsFor : reasonsAgainst).push(line);
    else reasonsAgainst.push(`${line} Read it before trading.`);
  }
  if (habits && habits.firstHourExtremePct >= 65) reasonsFor.push(`The day's high or low came in the first hour on ${habits.firstHourExtremePct}% of days: the opening hour usually decides the day here.`);

  const sym = (x) => (num(x) ? `₹${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
  let kind;
  let why;
  let gapRisk = false;
  if (costShare > 0.45) {
    kind = "avoid";
    why = "moves too little in a day to pay for intraday costs";
  } else if (side && !split && !poor(sideRec)) {
    kind = side;
    why = reliable(sideRec) ? "the lean and the measured record agree" : sideRec && sideRec.trades ? "the lean is clear; the record is not yet proof" : "the lean is clear; no intraday record to check it against";
  } else if (side && poor(sideRec)) {
    kind = reliable(orbRec) && habits && habits.openingRange.heldPct >= 55 ? "orb" : "wait";
    why = `the lean says ${side}, but these rules lost money on this stock (${sideRec.avgR}R a trade over ${sideRec.trades})`;
  } else if (reliable(orbRec) && habits && habits.openingRange.heldPct >= 55) {
    kind = "orb";
    why = split ? "the evidence is split, but the opening-range break has held up here" : "no clear lean, but the opening-range break has held up here";
  } else {
    kind = "wait";
    why = split ? "the evidence is split" : "no clear lean and no measured edge";
  }
  // the expected open may already be beyond the trigger: then the trigger is stale before 9:15
  if (kind === "long" || kind === "short") {
    const pl = plans[kind];
    const past = (x) => (kind === "long" ? x > pl.entry + 0.5 * pl.riskPerShare : x < pl.entry - 0.5 * pl.riskPerShare);
    if (past(open.expected)) {
      reasonsAgainst.push(`The expected open (${sym(open.expected)}) is already ${kind === "long" ? "above" : "below"} the trigger by more than half the risk: if it opens there, the ${kind} trigger has been jumped.`);
      if (past(kind === "long" ? open.low : open.high)) {
        const orbOk = reliable(orbRec) && habits && habits.openingRange.heldPct >= 55;
        kind = orbOk ? "orb" : "wait";
        why = orbOk ? "the expected gap opens beyond the trigger, so the day's own first fifteen minutes set the levels — and that break has held up here" : "the expected gap opens beyond the trigger, and nothing else here has a measured edge — let the open settle";
      } else gapRisk = true;
    }
  }
  if (kind === "orb" && orbRec) reasonsFor.push(`The 9:15–9:30 break, traded with a stop at the other side, won ${orbRec.winRate}% of ${orbRec.trades} trades here, averaging ${orbRec.avgR >= 0 ? "+" : ""}${orbRec.avgR}R after costs — ${orbRec.verdict}.`);

  const recEff = (s) => {
    if (!s || !s.trades) return 40;
    const w = Math.min(1, s.trades / 20);
    return 50 * (1 - w) + clamp(50 + s.avgR * 120, 0, 100) * w;
  };
  const strength =
    kind === "long" || kind === "short"
      ? clamp(Math.round(0.5 * (out.agreement || 0) + 0.5 * recEff(sideRec)) - (gapRisk ? 10 : 0) + optTilt, 0, 100)
      : kind === "orb"
        ? Math.round(0.5 * (habits.openingRange.heldPct || 0) + 0.5 * recEff(orbRec))
        : null;
  const headline =
    kind === "long"
      ? `LONG above ${sym(plans.long.entry)} after 9:30 — stop ${sym(plans.long.stop)}, target ${sym(plans.long.targets[0])}`
      : kind === "short"
        ? `SHORT below ${sym(plans.short.entry)} after 9:30 — stop ${sym(plans.short.stop)}, target ${sym(plans.short.targets[0])} (intraday only)`
        : kind === "orb"
          ? "Trade the break of the 9:15–9:30 range, whichever side breaks first"
          : kind === "avoid"
            ? "Avoid intraday in this stock next session"
            : "No intraday trade planned — let the first 30 minutes decide";

  const checklist = [];
  if (kind === "long" || kind === "short") {
    const p = plans[kind];
    const word = kind === "long" ? "above" : "below";
    if (gapRisk) checklist.push(`GIFT Nifty points to an open near ${sym(open.expected)}. If it opens beyond ${sym(kind === "long" ? p.entry + 0.5 * p.riskPerShare : p.entry - 0.5 * p.riskPerShare)}, drop this trigger and use the 9:15–9:30 range break instead.`);
    checklist.push(`Price trades ${word} ${sym(p.entry)} after 9:30 — a spike in the first 15 minutes does not count.`);
    checklist.push(`Skip it if the stock opens ${word} ${sym(kind === "long" ? p.entry + 0.5 * p.riskPerShare : p.entry - 0.5 * p.riskPerShare)}: it has run away — no chasing.`);
    checklist.push(`The Nifty is not moving hard ${kind === "long" ? "down" : "up"} at that moment (more than 0.5% against you argues for waiting).`);
    checklist.push(`The stop at ${sym(p.stop)} goes in with the order; size so that ${sym(p.riskPerShare)} a share is at most 1% of your capital.`);
    const wall = opt ? (kind === "long" ? opt.resistance : opt.support) : null;
    if (wall && (kind === "long" ? wall.strike > p.entry && wall.strike < p.targets[0] : wall.strike < p.entry && wall.strike > p.targets[0])) checklist.push(`The ${kind === "long" ? "call" : "put"} wall at ${sym(wall.strike)} (the most ${kind === "long" ? "call" : "put"} open interest) stands before target 1: expect selling${kind === "long" ? "" : " to dry up"} there — book part at the wall.`);
    checklist.push(`Book at least part at ${sym(p.targets[0])}; everything out by 3:15 PM${kind === "short" ? " (a cash-market short must be bought back the same day)" : ""}.`);
  } else if (kind === "orb") {
    checklist.push("Mark the high and low of 9:15–9:30. Enter only on a break after 9:30, on the side that breaks first.");
    checklist.push(`Stop at the other side of that range, but never more than ${sym(0.5 * dr.rs)} away (half a normal day's range).`);
    checklist.push("Target 1.5× the risk; everything out by 3:15 PM. If the first break fails back inside the range, do not flip sides on the same day.");
  } else if (kind === "wait") {
    const jumped = open.expected > plans.long.entry || open.expected < plans.short.entry;
    checklist.push(
      jumped
        ? `Let 9:15–9:45 trade. With the open expected near ${sym(open.expected)}, yesterday's levels are behind it: the first fifteen minutes' high and low are the levels to watch — on the live desk.`
        : `Let 9:15–9:45 trade. A clean move above ${sym(plans.long.entry)} or below ${sym(plans.short.entry)} with the Nifty behind it is the earliest place to look again — on the live desk.`,
    );
    checklist.push("No trade is a position: nothing here argues for one yet.");
  } else {
    checklist.push("Pick a stock that moves more in a day — the Screener's movers or the Advisor's list.");
  }

  const nextSession = forming ? dayOf(daily[daily.length - 1].t) : nextWeekday(prev.t);
  return {
    available: true,
    asOf: prev.t,
    nextSession,
    last: r2(prev.c),
    decision: { kind, why, headline, strength, for: reasonsFor, against: reasonsAgainst, checklist },
    lean: { call, score, agreement: out.agreement ?? null, headline: out.headline || null, chartScore: nowLean, chartBucket: nowBucket, split: Boolean(split) },
    odds: { now: nowBucket, ...odds },
    open,
    range,
    plans: { long: plans.long, short: plans.short, orb: { rule: "Break of the 9:15–9:30 high or low after 9:30; stop at the other side (held between 0.15 and 0.5 of a normal day's range); target 1.5× the risk; out by 3:15 PM.", typicalRangePct: habits ? habits.openingRange.medianPct : null } },
    pivots: { p: onTick(pv.p), r1: onTick(pv.r1), r2: onTick(pv.r2), s1: onTick(pv.s1), s2: onTick(pv.s2) },
    ladder,
    habits,
    record,
    news: news && news.mentions ? { mentions: news.mentions, sentiment: news.sentiment, tone: news.tone, high: news.high, items: (news.items || []).slice(0, 3) } : null,
    market: marketCue && !marketOpen ? { headline: marketCue.headline, gapPct: marketCue.gapPct, word: marketCue.word, firm: marketCue.firm, score: marketCue.score } : null,
    options: opt
      ? { expiry: opt.expiry, daysToExpiry: opt.daysToExpiry, label: opt.bias.label, score: opt.bias.score, pcr: opt.pcr, maxPain: opt.maxPain, resistance: opt.resistance && opt.resistance.strike, support: opt.support && opt.support.strike, atmIv: opt.atmIv, dayMove: opt.expectedMove && opt.expectedMove.day, toExpiry: opt.expectedMove && opt.expectedMove.toExpiry }
      : null,
    dayRangePct: r2(dr.pct),
    costPct,
    reason: record ? null : "Too few past sessions of 5-minute bars to measure this stock's intraday habits and the plan's record (it needs the Zerodha connection); the plan below rests on the daily chart only.",
    rule: "Built from completed daily bars and past 5-minute bars only. The lean is the Next-Session Outlook's; the plan's levels come from the previous session's high, low and pivots and a normal day's range; the odds, habits and record are counts over this stock's own past sessions. Strength blends the outlook's agreement with the record (it is not a probability). Nothing here is advice or a promise of profit.",
  };
}

module.exports = { buildIntradayPlan, plansFor, play, orbPlan, nextWeekday };
