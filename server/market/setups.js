"use strict";
// The classic intraday set-ups (market/knowledge.js describes them) turned into code — one detector, used
// both live (the scanner, on each closed 5-minute bar) and in the evening's backtest (server/setuplab.js),
// so what is measured is exactly what is shown.
//
//   orb             a close beyond the opening range (9:15–9:30) after 9:30, on volume, on VWAP's side
//   vwap-pullback   a dip to VWAP bought (or a rally to it sold) inside a trend
//   vwap-reclaim    VWAP taken back (or lost) after half an hour on the other side, on volume
//   pd-break        a close beyond yesterday's high (low), on volume, on VWAP's side
//   gap-go          a gap that holds through the opening range and breaks it before 10:30
//   gap-fade        a gap of 1%+ that fails — back through the open and VWAP before 11:00 — toward yesterday's close
//   squeeze-break   a close outside the Bollinger bands after they were at their narrowest, on volume
//   trend-pullback  the first shallow pullback after a 2-ATR move, turning back the trend's way
//   vwap-fade       counter-trend: 2.5 ATR from VWAP, RSI stretched, a reversal bar — back toward VWAP
//
// Added from published research (they are measured here like the rest, never assumed to work on NSE):
//   orb5            the FIRST 5-minute bar of a stock "in play" (unusual opening volume) broken in that candle's own
//                   direction before 10:30 — Zarattini, Barbon & Aziz, "A Profitable Day Trading Strategy for the U.S.
//                   Equity Market" (2024): the 5-minute range did best, and only in stocks with high relative volume
//   noise-break     at a half-hour mark, the price beyond its open (or yesterday's close) by more than this stock's own
//                   usual distance from the open at that time of day, on VWAP's side — Zarattini, Aziz & Barbon, "Beat
//                   the Market: An Effective Intraday Momentum Strategy" (2024): moves out of the "noise area" tend to go on
//   cpr-break       India's central pivot range: when yesterday's high, low and close nearly agree the range is narrow
//                   (a balanced day, often followed by a trending one); the first close beyond both it and the opening
//                   range, on volume. A trader's rule with no published test: the lab's numbers are its only evidence.
// The two researched ones let a winner run (target 3R, else the 3:15 PM exit), as their papers did.
//
// Each signal comes at a bar's close with a side, the entry (that close), a stop behind the structure
// (kept between a quarter and 1.6 ATR away), a target (1.5R, or the natural one for the fades) and its
// quality. The backtest enters at the NEXT bar's open, exits at the stop (first, if both fall in one bar),
// the target or 3:15 PM, one trade per set-up, side and stock a day, and counts the round trip's charges
// on ₹1 lakh — the exact Zerodha-style calculation is handed in by server/setuplab.js (this folder may
// not load the trading module); a rough 0.1% of turnover stands in when none is. Pure arithmetic: no AI,
// no network, no timer, no order.

const I = require("./indicators");

const IST = 5.5 * 3600 * 1000;
const FROM = 570; // 9:30
const TO = 885; // 14:45: no new entry after this
const EXIT = 915; // 15:15: anything still open is closed
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 || 0 : null);
const r3 = (x) => (num(x) ? Math.round(x * 1000) / 1000 || 0 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMin = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const rs = (x) => `₹${num(x) ? x.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}`;

const NAMES = {
  orb: "Opening-range breakout",
  "vwap-pullback": "VWAP pullback",
  "vwap-reclaim": "VWAP reclaim",
  "pd-break": "Yesterday's high/low break",
  "gap-go": "Gap and go",
  "gap-fade": "Gap fade",
  "squeeze-break": "Squeeze breakout",
  "trend-pullback": "First pullback",
  "vwap-fade": "Stretched fade to VWAP",
  orb5: "5-minute opening range (stock in play)",
  "noise-break": "Out of the noise (intraday momentum)",
  "cpr-break": "Narrow-CPR breakout",
};
const EARLY = 560; // 9:20: only the 5-minute opening range is read before 9:30

/**
 * Everything the detectors read, for every bar, using only that bar and the ones before it.
 * @param bars 5-minute bars { t: ms, o, h, l, c, v }, oldest first, several sessions
 */
function prep(bars) {
  const b = (bars || []).filter((x) => x && num(x.t) && num(x.c) && x.c > 0).sort((a, z) => a.t - z.t);
  const n = b.length;
  const closes = b.map((x) => x.c);
  const day = b.map((x) => istDate(x.t));
  const min = b.map((x) => istMin(x.t));
  const P = {
    b,
    n,
    day,
    min,
    ema9: I.ema(closes, 9),
    ema21: I.ema(closes, 21),
    rsi: I.rsi(closes, 14),
    atr: I.atr(b, 14),
    bb: I.bollinger(closes, 20, 2),
    sess: new Array(n).fill(0),
    vwap: new Array(n).fill(null),
    dOpen: new Array(n).fill(null),
    dHi: new Array(n).fill(null),
    dLo: new Array(n).fill(null),
    orh: new Array(n).fill(null),
    orl: new Array(n).fill(null),
    pdh: new Array(n).fill(null),
    pdl: new Array(n).fill(null),
    pdc: new Array(n).fill(null),
    gap: new Array(n).fill(null),
    dAtr: new Array(n).fill(null),
    relVol: new Array(n).fill(null),
    above: new Array(n).fill(0), // closes above VWAP among the 8 bars before this one
    below: new Array(n).fill(0),
    s0: new Array(n).fill(0), // the index of the session's first bar
    noise: new Array(n).fill(null), // the stock's usual distance from its open at this time of day (a fraction)
  };
  const noiseSlot = new Map(); // minute of the day → [[session index, |close ÷ open − 1|], …]
  let first = 0;
  const sessions = []; // { date, open, high, low, close }
  const slot = new Map(); // minute of the day → [[session index, volume], …]
  let s = -1;
  let pv = 0;
  let vol = 0;
  let cnt = 0;
  let orH = -Infinity;
  let orL = Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = b[i];
    if (i === 0 || day[i] !== day[i - 1]) {
      s += 1;
      first = i;
      sessions.push({ date: day[i], open: x.o, high: x.h, low: x.l, close: x.c });
      pv = 0;
      vol = 0;
      cnt = 0;
      orH = -Infinity;
      orL = Infinity;
    }
    const cur = sessions[s];
    cur.high = Math.max(cur.high, x.h);
    cur.low = Math.min(cur.low, x.l);
    cur.close = x.c;
    P.sess[i] = s;
    P.s0[i] = first;
    // how far the close usually stands from the open at this minute, over up to 14 sessions BEFORE this one
    const nl = noiseSlot.get(min[i]) || [];
    const np = nl.filter(([k]) => k < s).slice(-14);
    if (np.length >= 4) P.noise[i] = np.reduce((a, [, z]) => a + z, 0) / np.length;
    if (cur.open > 0) nl.push([s, Math.abs(x.c / cur.open - 1)]);
    noiseSlot.set(min[i], nl);
    const tp = (x.h + x.l + x.c) / 3;
    const v = num(x.v) && x.v > 0 ? x.v : 0;
    pv += tp * (v || 1);
    vol += v || 1;
    cnt += 1;
    P.vwap[i] = pv / vol;
    P.dOpen[i] = cur.open;
    P.dHi[i] = cur.high;
    P.dLo[i] = cur.low;
    if (min[i] < FROM) {
      orH = Math.max(orH, x.h);
      orL = Math.min(orL, x.l);
    } else if (orH > -Infinity) {
      P.orh[i] = orH;
      P.orl[i] = orL;
    }
    if (s >= 1) {
      const p = sessions[s - 1];
      P.pdh[i] = p.high;
      P.pdl[i] = p.low;
      P.pdc[i] = p.close;
      P.gap[i] = ((cur.open - p.close) / p.close) * 100;
      const back = sessions.slice(Math.max(0, s - 10), s);
      P.dAtr[i] = back.reduce((a, z) => a + (z.high - z.low), 0) / back.length;
    }
    // this bar's volume against the same five minutes of the previous sessions (up to ten)
    const list = slot.get(min[i]) || [];
    const prior = list.filter(([k]) => k < s).slice(-10);
    if (prior.length >= 3 && v > 0) {
      const avg = prior.reduce((a, [, z]) => a + z, 0) / prior.length;
      if (avg > 0) P.relVol[i] = v / avg;
    }
    list.push([s, v]);
    slot.set(min[i], list);
    // how the last eight closes sat against VWAP (this session only)
    let up = 0;
    let dn = 0;
    for (let k = Math.max(0, i - 8); k < i; k += 1) {
      if (day[k] !== day[i]) continue;
      if (b[k].c > P.vwap[k]) up += 1;
      else if (b[k].c < P.vwap[k]) dn += 1;
    }
    P.above[i] = up;
    P.below[i] = dn;
    void cnt;
  }
  P.sessions = sessions;
  return P;
}

/**
 * The set-ups that fire at the close of bar i (using bars 0…i only).
 * @returns [{ id, name, side, entry, stop, target, risk, rr, quality, why }]
 */
function detect(P, i) {
  const out = [];
  if (i < 1 || i >= P.n) return out;
  const x = P.b[i];
  const prev = P.b[i - 1];
  const m = P.min[i];
  const early = m >= EARLY && m < FROM; // 9:20–9:30: only the 5-minute opening range fires this early
  if ((m < FROM && !early) || m > TO || P.day[i - 1] !== P.day[i]) return out;
  const a = P.atr[i];
  if (!num(a) || a <= 0) return out;
  const vw = P.vwap[i];
  const e9 = P.ema9[i];
  const e21 = P.ema21[i];
  const rv = P.relVol[i];
  const vol = (k) => num(rv) && rv >= k;
  const trendUp = num(e9) && num(e21) && e9 > e21;
  const trendDn = num(e9) && num(e21) && e9 < e21;
  const add = (id, side, stop0, why, target0 = null, rrWanted = 1.5) => {
    const long = side === "long";
    const entry = x.c;
    let stop = stop0;
    let risk = long ? entry - stop : stop - entry;
    if (!num(risk) || risk < 0.25 * a) {
      stop = long ? entry - 0.4 * a : entry + 0.4 * a;
      risk = 0.4 * a;
    }
    if (risk > 1.6 * a) {
      stop = long ? entry - 1.6 * a : entry + 1.6 * a;
      risk = 1.6 * a;
    }
    let target = long ? entry + rrWanted * risk : entry - rrWanted * risk;
    // the fades have a natural target (yesterday's close, VWAP): used when it is 1R to 3R away
    if (num(target0)) {
      const rr = (long ? target0 - entry : entry - target0) / risk;
      if (rr >= 1 && rr <= 3) target = target0;
    }
    const morning = (m >= EARLY && m < 690) || (m >= 810 && m < 870);
    const withTrend = long ? trendUp : trendDn;
    const vwapSide = long ? entry >= vw : entry <= vw;
    const quality = clamp(0.35 + (num(rv) ? 0.15 * clamp(rv - 1, 0, 2) : 0) + (withTrend ? 0.15 : 0) + (morning ? 0.15 : 0) + (vwapSide ? 0.1 : 0), 0, 1);
    out.push({ id, name: NAMES[id], side, entry: r2(entry), stop: r2(stop), target: r2(target), risk: r2(risk), rr: r2(Math.abs(target - entry) / risk), quality: r2(quality), why });
  };

  // 10. the 5-minute opening range of a stock in play: the first bar on at least 1.5× its usual volume, broken in that
  //     candle's own direction before 10:30. Stop a tenth of the stock's daily range away (the paper's rule), run to 3R.
  const f0 = P.b[P.s0[i]];
  const frv = P.relVol[P.s0[i]];
  if (m <= 630 && i > P.s0[i] && num(frv) && frv >= 1.5 && f0.h > f0.l) {
    const gapStop = num(P.dAtr[i]) ? 0.1 * P.dAtr[i] : 0.4 * a;
    if (f0.c > f0.o && x.c > f0.h && prev.c <= f0.h) add("orb5", "long", x.c - gapStop, `in play (${r2(frv)}× its usual opening volume): closed above the first 5-minute bar's high ${rs(f0.h)}`, null, 3);
    if (f0.c < f0.o && x.c < f0.l && prev.c >= f0.l) add("orb5", "short", x.c + gapStop, `in play (${r2(frv)}× its usual opening volume): closed below the first 5-minute bar's low ${rs(f0.l)}`, null, 3);
  }
  if (early) return out;
  // 11. out of the noise: at a half-hour mark, beyond the open (or yesterday's close, whichever is further) by more than the
  //     stock's usual distance from its open at this time of day, on VWAP's side. Stop at VWAP or the boundary, run to 3R.
  const nz = P.noise[i];
  if (num(nz) && nz > 0 && (m + 5) % 30 === 0 && num(P.pdc[i])) {
    const up = Math.max(P.dOpen[i], P.pdc[i]) * (1 + nz);
    const dn = Math.min(P.dOpen[i], P.pdc[i]) * (1 - nz);
    if (x.c > up && x.c > vw) add("noise-break", "long", Math.max(up, vw) - 0.1 * a, `above its usual range for this time of day (${rs(up)}) and above VWAP`, null, 3);
    if (x.c < dn && x.c < vw) add("noise-break", "short", Math.min(dn, vw) + 0.1 * a, `below its usual range for this time of day (${rs(dn)}) and below VWAP`, null, 3);
  }
  // 1. the opening range broken, on volume, on VWAP's side (not when the range is already wider than a day's usual)
  const orh = P.orh[i];
  const orl = P.orl[i];
  if (num(orh) && num(orl) && (!num(P.dAtr[i]) || orh - orl <= 1.2 * P.dAtr[i])) {
    const mid = (orh + orl) / 2;
    if (x.c > orh && prev.c <= orh && x.c > vw && vol(1.2)) add("orb", "long", Math.max(mid, x.l - 0.1 * a), `closed above the opening-range high ${rs(orh)} on ${r2(rv)}× volume`);
    if (x.c < orl && prev.c >= orl && x.c < vw && vol(1.2)) add("orb", "short", Math.min(mid, x.h + 0.1 * a), `closed below the opening-range low ${rs(orl)} on ${r2(rv)}× volume`);
  }
  // 12. a narrow central pivot range (yesterday's high, low and close nearly agree): the first close beyond both the range
  //     and the opening range before noon, on volume, on VWAP's side
  if (num(P.pdh[i]) && num(P.pdl[i]) && num(P.pdc[i]) && num(orh) && num(orl) && m <= 720 && P.pdh[i] > P.pdl[i]) {
    const pp = (P.pdh[i] + P.pdl[i] + P.pdc[i]) / 3;
    const bc = (P.pdh[i] + P.pdl[i]) / 2;
    const tc = 2 * pp - bc;
    const top = Math.max(tc, bc);
    const bot = Math.min(tc, bc);
    const narrow = top - bot <= 0.1 * (P.pdh[i] - P.pdl[i]);
    const hiLine = Math.max(top, orh);
    const loLine = Math.min(bot, orl);
    if (narrow && x.c > hiLine && prev.c <= hiLine && x.c > vw && vol(1.2)) add("cpr-break", "long", Math.max(top, x.l) - 0.1 * a, `a narrow pivot range (${rs(bot)}–${rs(top)}) and the opening range both cleared, on ${r2(rv)}× volume`);
    if (narrow && x.c < loLine && prev.c >= loLine && x.c < vw && vol(1.2)) add("cpr-break", "short", Math.min(bot, x.h) + 0.1 * a, `a narrow pivot range (${rs(bot)}–${rs(top)}) and the opening range both lost, on ${r2(rv)}× volume`);
  }
  // 2. a dip to VWAP bought inside an uptrend (or a rally to it sold inside a downtrend)
  if (trendUp && P.above[i] >= 6 && x.l <= vw + 0.25 * a && x.c > vw && x.c > x.o) add("vwap-pullback", "long", Math.min(x.l, vw) - 0.1 * a, `bought at VWAP ${rs(vw)} inside an uptrend`);
  if (trendDn && P.below[i] >= 6 && x.h >= vw - 0.25 * a && x.c < vw && x.c < x.o) add("vwap-pullback", "short", Math.max(x.h, vw) + 0.1 * a, `sold at VWAP ${rs(vw)} inside a downtrend`);
  // 3. VWAP taken back after half an hour under it (or lost after half an hour over it), on volume
  if (P.below[i] >= 6 && P.above[i] === 0 && x.c > vw && x.c > x.o && vol(1.2)) add("vwap-reclaim", "long", x.l - 0.1 * a, `took back VWAP ${rs(vw)} after half an hour below it, on ${r2(rv)}× volume`);
  if (P.above[i] >= 6 && P.below[i] === 0 && x.c < vw && x.c < x.o && vol(1.2)) add("vwap-reclaim", "short", x.h + 0.1 * a, `lost VWAP ${rs(vw)} after half an hour above it, on ${r2(rv)}× volume`);
  // 4. yesterday's high (low) broken on a close, on volume, on VWAP's side
  if (num(P.pdh[i]) && x.c > P.pdh[i] && prev.c <= P.pdh[i] && x.c > vw && vol(1.2)) add("pd-break", "long", Math.max(P.pdh[i] - 0.5 * a, x.l - 0.1 * a), `closed above yesterday's high ${rs(P.pdh[i])}`);
  if (num(P.pdl[i]) && x.c < P.pdl[i] && prev.c >= P.pdl[i] && x.c < vw && vol(1.2)) add("pd-break", "short", Math.min(P.pdl[i] + 0.5 * a, x.h + 0.1 * a), `closed below yesterday's low ${rs(P.pdl[i])}`);
  // 5. a gap that held through the opening range, breaking it before 10:30
  const g = P.gap[i];
  const dAtrPct = num(P.dAtr[i]) && P.pdc[i] ? (P.dAtr[i] / P.pdc[i]) * 100 : null;
  if (num(g) && num(orh) && m <= 630) {
    const big = Math.max(0.75, num(dAtrPct) ? 0.5 * dAtrPct : 0);
    if (g >= big && P.dLo[i - 1] >= P.dOpen[i] - 0.5 * a && x.c > orh && prev.c <= orh) add("gap-go", "long", Math.max(orl, x.l - 0.1 * a), `a ${r2(g)}% gap up held and broke the opening range ${rs(orh)}`);
    if (g <= -big && P.dHi[i - 1] <= P.dOpen[i] + 0.5 * a && x.c < orl && prev.c >= orl) add("gap-go", "short", Math.min(orh, x.h + 0.1 * a), `a ${r2(Math.abs(g))}% gap down held and broke the opening range ${rs(orl)}`);
  }
  // 6. a gap of 1%+ that fails: back through the open and VWAP before 11:00, toward yesterday's close
  if (num(g) && m <= 660 && num(P.pdc[i])) {
    const big = Math.max(1, num(dAtrPct) ? 0.6 * dAtrPct : 0);
    const open = P.dOpen[i];
    if (g >= big && x.c < open && x.c < vw && (prev.c >= vw || prev.c >= open)) add("gap-fade", "short", P.dHi[i] + 0.1 * a, `a ${r2(g)}% gap up failed: back under the open ${rs(open)} and VWAP`, P.pdc[i]);
    if (g <= -big && x.c > open && x.c > vw && (prev.c <= vw || prev.c <= open)) add("gap-fade", "long", P.dLo[i] - 0.1 * a, `a ${r2(Math.abs(g))}% gap down recovered: back over the open ${rs(open)} and VWAP`, P.pdc[i]);
  }
  // 7. out of a squeeze: the bands at their narrowest of the last 40 bars, then a close outside them on volume
  const w = P.bb.width;
  if (i >= 42 && num(w[i - 1])) {
    let lo = Infinity;
    for (let k = i - 41; k <= i - 2; k += 1) if (num(w[k]) && w[k] < lo) lo = w[k];
    const squeezed = w[i - 1] <= lo * 1.1;
    const pb = P.bb.pctB[i];
    if (squeezed && num(pb) && pb > 1 && vol(1.3)) add("squeeze-break", "long", Math.max(P.bb.mid[i], x.l - 0.1 * a), `broke out of a Bollinger squeeze on ${r2(rv)}× volume`);
    if (squeezed && num(pb) && pb < 0 && vol(1.3)) add("squeeze-break", "short", Math.min(P.bb.mid[i], x.h + 0.1 * a), `broke down out of a Bollinger squeeze on ${r2(rv)}× volume`);
  }
  // 8. the first shallow pullback after a 2-ATR move, turning back the trend's way
  if (i >= 14 && num(e21)) {
    for (const long of [true, false]) {
      for (let k = 2; k <= 5; k += 1) {
        const p0 = i - k; // the pullback runs p0 … i-1
        if (P.day[p0 - 1] !== P.day[i]) break;
        let ext = long ? -Infinity : Infinity;
        let at = -1;
        for (let z = Math.max(0, p0 - 10); z < p0; z += 1) {
          if (P.day[z] !== P.day[i]) continue;
          if (long ? P.b[z].h > ext : P.b[z].l < ext) {
            ext = long ? P.b[z].h : P.b[z].l;
            at = z;
          }
        }
        if (at < 0) continue;
        let start = long ? Infinity : -Infinity;
        for (let z = Math.max(0, at - 10); z <= at; z += 1) if (P.day[z] === P.day[i]) start = long ? Math.min(start, P.b[z].l) : Math.max(start, P.b[z].h);
        const move = Math.abs(ext - start);
        if (!(move >= 2 * a) || at !== p0 - 1) continue;
        const pb = P.b.slice(p0, i);
        const deep = long ? Math.min(...pb.map((z) => z.l)) : Math.max(...pb.map((z) => z.h));
        const shallow = long ? deep >= ext - 0.5 * move && deep >= e21 : deep <= ext + 0.5 * move && deep <= e21;
        const turn = long ? x.c > prev.h && x.c > e9 : x.c < prev.l && x.c < e9;
        if (shallow && turn) {
          add("trend-pullback", long ? "long" : "short", long ? deep - 0.1 * a : deep + 0.1 * a, `the first pullback (${k} bars) after a ${r2(move / a)}-ATR move, turning back ${long ? "up" : "down"}`);
          break;
        }
      }
    }
  }
  // 9. counter-trend: 2.5 ATR from VWAP, RSI stretched, a reversal bar — back toward VWAP
  const rsi = P.rsi[i];
  if (num(rsi) && x.c >= vw + 2.5 * a && rsi >= 78 && x.c < x.o && x.c < prev.l) add("vwap-fade", "short", Math.max(x.h, prev.h) + 0.1 * a, `stretched ${r2((x.c - vw) / a)} ATR above VWAP with RSI ${r2(rsi)}, turning down`, vw);
  if (num(rsi) && x.c <= vw - 2.5 * a && rsi <= 22 && x.c > x.o && x.c > prev.h) add("vwap-fade", "long", Math.min(x.l, prev.l) - 0.1 * a, `stretched ${r2((vw - x.c) / a)} ATR below VWAP with RSI ${r2(rsi)}, turning up`, vw);
  return out;
}

/** A rough stand-in for the round trip's charges (about 0.1% of the turnover) when none is handed in. */
function roughCost(entry, exit, qty) {
  return 0.0005 * (entry + exit) * qty;
}

/**
 * Every set-up on these bars, traded by the rules: next bar's open, stop first, target, or 3:15 PM.
 * @returns trades [{ symbol, id, side, date, min, how, R (after costs), grossR, costR }]
 */
function backtest(bars, { symbol = "", notional = 100000, cost = roughCost } = {}) {
  const P = prep(bars);
  const trades = [];
  const taken = new Set();
  for (let i = 1; i < P.n - 1; i += 1) {
    if (P.sess[i] < 1) continue; // yesterday is needed for its levels
    for (const s of detect(P, i)) {
      const key = `${P.day[i]}|${s.id}|${s.side}`;
      if (taken.has(key)) continue;
      const j0 = i + 1;
      if (P.day[j0] !== P.day[i]) continue;
      const long = s.side === "long";
      const entry = P.b[j0].o;
      const risk = long ? entry - s.stop : s.stop - entry;
      if (!(risk > 0)) continue; // it opened through the stop: no trade
      const rr = s.rr || 1.5;
      const target = long ? entry + rr * risk : entry - rr * risk;
      taken.add(key);
      let exit = null;
      let how = "time";
      let last = j0;
      for (let j = j0; j < P.n && P.day[j] === P.day[i]; j += 1) {
        const z = P.b[j];
        last = j;
        if (long ? z.l <= s.stop : z.h >= s.stop) {
          exit = long ? Math.min(z.o, s.stop) : Math.max(z.o, s.stop);
          how = "stop";
          break;
        }
        if (long ? z.h >= target : z.l <= target) {
          exit = target;
          how = "target";
          break;
        }
        if (P.min[j] >= EXIT) {
          exit = z.c;
          break;
        }
      }
      if (exit === null) exit = P.b[last].c;
      const qty = Math.max(1, Math.floor(notional / entry));
      const gross = (long ? exit - entry : entry - exit) * qty;
      const paid = cost(entry, exit, qty, long);
      const per = risk * qty;
      trades.push({ symbol, id: s.id, side: s.side, date: P.day[i], min: P.min[i], how, R: r3((gross - paid) / per), grossR: r3(gross / per), costR: r3(paid / per) });
    }
  }
  return trades;
}

const HOURS = [
  ["9:30–11:00", 570, 660],
  ["11:00–1:30", 660, 810],
  ["1:30–2:45", 810, 886],
];

/** Trades added up by set-up and side: count, share won, average R after costs, by time of day. */
function summarize(trades) {
  const by = new Map();
  for (const t of trades) {
    const k = `${t.id}:${t.side}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }
  const stat = (list) => {
    const n = list.length;
    if (!n) return { n: 0 };
    const won = list.filter((t) => t.R > 0).length;
    const sum = (f) => list.reduce((a, t) => a + (t[f] || 0), 0);
    return { n, winPct: Math.round((won / n) * 100), avgR: r3(sum("R") / n), avgGrossR: r3(sum("grossR") / n), avgCostR: r3(sum("costR") / n), totalR: r2(sum("R")), targets: list.filter((t) => t.how === "target").length, stops: list.filter((t) => t.how === "stop").length, timed: list.filter((t) => t.how === "time").length };
  };
  const rows = [...by.entries()].map(([k, list]) => {
    const [id, side] = k.split(":");
    return { key: k, id, name: NAMES[id] || id, side, ...stat(list), hours: HOURS.map(([label, a, z]) => ({ label, ...stat(list.filter((t) => t.min >= a && t.min < z)) })) };
  });
  rows.sort((a, z) => (z.avgR || 0) - (a.avgR || 0));
  return { all: stat(trades), rows };
}

/**
 * How much a set-up's measured record should count in the live score (−1…+1): its average R after
 * costs, scaled (0.25R a trade = full), and shrunk toward nothing while it has few trades.
 */
function edgeFactor(e) {
  if (!e || !num(e.avgR) || !(e.n >= 30)) return null;
  return r2(clamp(e.avgR / 0.25, -1, 1) * (e.n / (e.n + 60)));
}

module.exports = { prep, detect, backtest, summarize, edgeFactor, roughCost, NAMES, HOURS, FROM, TO, EXIT, EARLY };
