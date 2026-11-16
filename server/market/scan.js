"use strict";
// The live scanner's engine: the NIFTY 100 kept in a buffer and read, bar by bar and tick by tick, the
// way an intraday desk reads its screen.
//
//   BUFFER     each stock keeps its 5-minute bars — the last few sessions from Zerodha's history, then
//              today's built from the streamed ticks (open, high, low, close; volume from the day's running
//              total) — plus the newest tick: price, VWAP (Zerodha's average traded price), the day's
//              open, high, low and previous close, and the order book's total bids and offers.
//   READ       on 5-minute bars: VWAP and the distance from it in ATRs, EMA 9 against EMA 21 and its slope,
//              Supertrend (10, 3), MACD (12, 26, 9) histogram and its turn, RSI (14), ADX (14) with +DI/−DI,
//              ATR (14), Bollinger (20, 2) %B and the squeeze, the opening range (9:15–9:30) and its break,
//              yesterday's high, low and close, the floor pivots and the CPR, the volume so far against the
//              usual at this time of day, the move against the NIFTY (today and the last 30 minutes),
//              momentum over 15 minutes, the order book's bids against offers, the daily trend.
//   SCORE      each reading votes for up or down (−1…+1) with a weight; the weighted sum is the score
//              (−100…+100) and the share of the weight that agrees with it is the agreement. The reasons are
//              the readings with their numbers, strongest first.
//   NEXT MOVE  the lean for the next 15–30 minutes: up, down or flat, with its strength (weak, moderate,
//              strong) from the score and the agreement, and the range the stock usually covers in that time
//              (from its ATR). A lean, not a forecast: the desk scores every lean it gives (see below).
//   ELIGIBLE   a stock may be traded intraday now only when every rule holds — inside the entry window
//              (9:30 AM – 2:45 PM), a clear score with most of the evidence agreeing, the price on the right
//              side of VWAP, a trend (ADX 18+) or an opening-range break, volume not dead, enough money
//              traded, not stretched, room to the next level against it, and a counter-trend trade only on
//              stronger evidence. Each rule that fails is named.
//   PLAN       entry at the price; the stop behind the nearest structure (the last three bars, Supertrend,
//              VWAP) kept between 0.4 and 1.6 ATR; targets at 1.5 and 2.5 times the risk; the nearest level
//              against the trade is shown.
//   RECORD     every eligible call is followed to its first target, its stop or 30 minutes; every lean is
//              checked 15 minutes on. The counts are the scanner's record — measured, never assumed.
//
// Pure arithmetic: no AI, no network, no timer, no order. A reading of the evidence — not a promise, and
// not advice.

const I = require("./indicators");
const { dailyFeatures } = require("./picks");

const IST = 5.5 * 3600 * 1000;
const BAR_MS = 5 * 60000;
const OPEN_MIN = 555; // 9:15 IST
const CLOSE_MIN = 930; // 15:30 IST
const ENTRY_FROM = 570; // 9:30: the first fifteen minutes are the opening range, not an entry
const ENTRY_TO = 885; // 14:45: no new intraday entry after this
const MAX_BARS = 600;
const MIN_BARS = 30;
const RULES = { minScore: 35, minAgree: 0.65, minAdx: 18, minRelVol: 0.8, minTurnoverCr: 50, maxRsiLong: 78, minRsiShort: 22, maxStretchAtr: 2.5, counterScore: 55, minRoomR: 1 };

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 || 0 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 || 0 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const lastOf = (arr) => {
  for (let i = arr.length - 1; i >= 0; i -= 1) if (num(arr[i])) return arr[i];
  return null;
};
const prevOf = (arr) => {
  let seen = false;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (!num(arr[i])) continue;
    if (seen) return arr[i];
    seen = true;
  }
  return null;
};
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMin = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const bucket = (ms) => Math.floor((ms + IST) / BAR_MS) * BAR_MS - IST;
const rs = (x) => `₹${num(x) ? x.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}`;
const sg = (x, d = 2) => (num(x) ? `${x > 0 ? "+" : ""}${x.toFixed(d)}` : "—");

/** Zerodha writes "2026-11-12T09:15:00+0530": a colon in the offset makes every engine read it. */
function msOf(t) {
  if (num(t)) return t;
  const x = String(t || "").replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(/[+-]\d{2}:\d{2}$|Z$/.test(x) ? x : `${x}+05:30`);
}

/* ------------------------------------------------------------------------ the buffer */
function newState(symbol, token = null) {
  return { symbol, token, bars: [], forming: null, tick: null, prevVol: null, daily: null, seededAt: 0, ticks: 0, dirty: false };
}

/**
 * Seed a stock's buffer with Zerodha's 5-minute bars (the last few sessions, today's so far). A bar still
 * forming becomes the forming bar; ticks carry on from it.
 */
function seed(st, bars, now) {
  const rows = (bars || [])
    .map((b) => ({ t: msOf(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: num(b.v) ? b.v : 0 }))
    .filter((b) => num(b.t) && num(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t);
  const cur = bucket(now);
  const done = rows.filter((b) => b.t < cur);
  const forming = rows.find((b) => b.t === cur) || null;
  // keep what came from the stream for the current bar if it is already further along
  st.bars = done.slice(-MAX_BARS);
  if (forming && !(st.forming && st.forming.t === cur)) st.forming = { ...forming, v0: null };
  else if (st.forming && st.forming.t < cur) st.forming = null;
  st.seededAt = now;
  st.dirty = true;
  return st;
}

/** One streamed tick into the buffer. Returns true when it changed anything. */
function addTick(st, t, now) {
  if (!t || !num(t.last) || t.last <= 0) return false;
  const at = num(t.at) ? t.at : now;
  st.tick = {
    last: t.last,
    volume: num(t.volume) ? t.volume : null,
    vwap: num(t.avgPrice) && t.avgPrice > 0 ? t.avgPrice : null,
    open: num(t.open) && t.open > 0 ? t.open : null,
    high: num(t.high) && t.high > 0 ? t.high : null,
    low: num(t.low) && t.low > 0 ? t.low : null,
    prevClose: num(t.prevClose) && t.prevClose > 0 ? t.prevClose : null,
    buyQty: num(t.buyQty) ? t.buyQty : null,
    sellQty: num(t.sellQty) ? t.sellQty : null,
    bid: num(t.bid) ? t.bid : null,
    ask: num(t.ask) ? t.ask : null,
    at,
  };
  st.ticks += 1;
  st.dirty = true;
  const m = istMin(at);
  if (m < OPEN_MIN || m >= CLOSE_MIN) return true; // outside the session: the quote only, no bar
  const b = bucket(at);
  const vol = st.tick.volume;
  if (!st.forming || st.forming.t !== b) {
    if (st.forming && st.forming.t < b) {
      const { v0, ...done } = st.forming;
      void v0;
      st.bars.push(done);
      if (st.bars.length > MAX_BARS) st.bars.splice(0, st.bars.length - MAX_BARS);
    }
    st.forming = { t: b, o: t.last, h: t.last, l: t.last, c: t.last, v: 0, v0: num(vol) ? (num(st.prevVol) ? st.prevVol : vol) : null };
  } else {
    st.forming.h = Math.max(st.forming.h, t.last);
    st.forming.l = Math.min(st.forming.l, t.last);
    st.forming.c = t.last;
    // a forming bar seeded from history: its volume so far fixes where the running total started
    if (st.forming.v0 === null && num(vol)) st.forming.v0 = vol - (st.forming.v || 0);
  }
  if (num(vol) && num(st.forming.v0)) st.forming.v = Math.max(0, vol - st.forming.v0);
  if (num(vol)) st.prevVol = vol;
  return true;
}

/** Yesterday (the last completed session before `today`) and the daily trend, from daily candles. */
function dailyContext(candles, today) {
  const done = (candles || []).filter((c) => c && num(c.c) && String(c.t || c.d || "").slice(0, 10) < today);
  const f = dailyFeatures(done);
  const prev = done[done.length - 1];
  if (!prev) return null;
  const piv = I.pivots(prev);
  return { ...(f || {}), pdh: r2(prev.h), pdl: r2(prev.l), pdc: r2(prev.c), pivots: Object.fromEntries(Object.entries(piv).map(([k, v]) => [k, r2(v)])) };
}

/* ---------------------------------------------------------------------- the readings */
/**
 * Every reading for one stock (or the index) now.
 * @param ctx { now, nifty: features of the NIFTY 50 (for the stock's strength against it) }
 */
function features(st, ctx = {}) {
  const now = num(ctx.now) ? ctx.now : Date.now();
  const all = st.forming ? [...st.bars, { t: st.forming.t, o: st.forming.o, h: st.forming.h, l: st.forming.l, c: st.forming.c, v: st.forming.v || 0 }] : st.bars.slice();
  if (all.length < MIN_BARS) return { ready: false, reason: all.length ? `${all.length} of ${MIN_BARS} bars in the buffer` : "waiting for the buffer" };
  const today = istDate(now);
  const todays = all.filter((b) => istDate(b.t) === today);
  const tk = st.tick || {};
  const last = num(tk.last) ? tk.last : all[all.length - 1].c;
  const closes = all.map((b) => b.c);
  const e9 = I.ema(closes, 9);
  const e21 = I.ema(closes, 21);
  const rsiA = I.rsi(closes, 14);
  const mac = I.macd(closes, 12, 26, 9);
  const sup = I.supertrend(all, 10, 3);
  const dmi = I.adx(all, 14);
  const atrA = I.atr(all, 14);
  const bb = I.bollinger(closes, 20, 2);
  const atr5 = lastOf(atrA);
  const widths = bb.width.slice(-60).filter(num);
  const width = lastOf(bb.width);
  const d = st.daily || {};
  const prevClose = num(tk.prevClose) ? tk.prevClose : num(d.pdc) ? d.pdc : null;
  const dayOpen = num(tk.open) ? tk.open : todays.length ? todays[0].o : null;
  const dayHigh = num(tk.high) ? Math.max(tk.high, last) : todays.length ? Math.max(...todays.map((b) => b.h), last) : null;
  const dayLow = num(tk.low) ? Math.min(tk.low, last) : todays.length ? Math.min(...todays.map((b) => b.l), last) : null;
  const vw = num(tk.vwap) ? tk.vwap : todays.length && todays.some((b) => b.v > 0) ? lastOf(I.vwap(todays)) : null;
  const m = istMin(now);
  const minsIn = clamp(m - OPEN_MIN, 0, CLOSE_MIN - OPEN_MIN);
  // the opening range: 9:15–9:30, the first three 5-minute bars
  const orBars = todays.filter((b) => istMin(b.t) < ENTRY_FROM);
  const orDone = m >= ENTRY_FROM && orBars.length > 0;
  const orh = orDone ? Math.max(...orBars.map((b) => b.h)) : null;
  const orl = orDone ? Math.min(...orBars.map((b) => b.l)) : null;
  // volume so far against the usual by this time (the day's volume is heavier early: a gentle curve)
  const dayVol = num(tk.volume) ? tk.volume : todays.reduce((a, b) => a + (b.v || 0), 0);
  const frac = minsIn > 0 ? Math.pow(minsIn / (CLOSE_MIN - OPEN_MIN), 0.8) : 0;
  const relVol = num(d.avgVol) && d.avgVol > 0 && frac > 0 && dayVol > 0 ? dayVol / (d.avgVol * frac) : null;
  const chgPct = pct(last, prevClose);
  const back6 = all.length > 6 ? all[all.length - 7].c : null;
  const ret30 = pct(last, back6);
  const back3 = all.length > 3 ? all[all.length - 4].c : null;
  const roc3 = pct(last, back3);
  const nifty = ctx.nifty && ctx.nifty.ready !== false ? ctx.nifty : null;
  const book = num(tk.buyQty) && num(tk.sellQty) && tk.buyQty + tk.sellQty > 0 ? (tk.buyQty / (tk.buyQty + tk.sellQty)) * 100 : null;
  const recent = all.slice(-4, -1); // the last three closed bars
  return {
    ready: true,
    symbol: st.symbol,
    at: now,
    last: r2(last),
    prevClose: r2(prevClose),
    chgPct: r2(chgPct),
    gapPct: r2(pct(dayOpen, prevClose)),
    dayOpen: r2(dayOpen),
    dayHigh: r2(dayHigh),
    dayLow: r2(dayLow),
    rangePos: num(dayHigh) && num(dayLow) && dayHigh > dayLow ? r2((last - dayLow) / (dayHigh - dayLow)) : null,
    vwap: r2(vw),
    vsVwapPct: r2(pct(last, vw)),
    vsVwapAtr: num(vw) && num(atr5) && atr5 > 0 ? r2((last - vw) / atr5) : null,
    ema9: r2(lastOf(e9)),
    ema21: r2(lastOf(e21)),
    ema9Slope: num(lastOf(e9)) && num(prevOf(e9)) ? r2(lastOf(e9) - prevOf(e9)) : null,
    rsi: r1(lastOf(rsiA)),
    macdHist: r2(lastOf(mac.hist)),
    macdHistPrev: r2(prevOf(mac.hist)),
    supertrend: lastOf(sup.dir),
    supertrendLine: r2(lastOf(sup.line)),
    adx: r1(lastOf(dmi.adx)),
    plusDI: r1(lastOf(dmi.plusDI)),
    minusDI: r1(lastOf(dmi.minusDI)),
    atr5: r2(atr5),
    atrPct: num(atr5) && last > 0 ? r2((atr5 / last) * 100) : null,
    bbPctB: r2(lastOf(bb.pctB)),
    bbWidth: num(width) ? r2(width * 100) : null,
    squeeze: num(width) && widths.length >= 20 ? width <= Math.min(...widths) * 1.15 : false,
    orh: r2(orh),
    orl: r2(orl),
    orb: orDone ? (last > orh ? "above" : last < orl ? "below" : "inside") : "forming",
    pdh: r2(d.pdh),
    pdl: r2(d.pdl),
    pdc: r2(d.pdc),
    pivots: d.pivots || null,
    relVol: r2(relVol),
    dayVol: num(dayVol) ? Math.round(dayVol) : null,
    rsNifty: nifty && num(chgPct) && num(nifty.chgPct) ? r2(chgPct - nifty.chgPct) : null,
    rs30: nifty && num(ret30) && num(nifty.ret30) ? r2(ret30 - nifty.ret30) : null,
    ret30: r2(ret30),
    roc3: r2(roc3),
    bookBuyPct: r1(book),
    swingLow: recent.length ? r2(Math.min(...recent.map((b) => b.l))) : null,
    swingHigh: recent.length ? r2(Math.max(...recent.map((b) => b.h))) : null,
    turnoverCr: r2(d.turnoverCr),
    dailyTrend: num(d.vsEma20) && num(d.vsEma50) ? (d.vsEma20 > 0 && d.vsEma50 > 0 ? 1 : d.vsEma20 < 0 && d.vsEma50 < 0 ? -1 : 0) : null,
    dailyRsi: r1(d.rsi14),
    bars: all.length,
    todayBars: todays.length,
    minsIn,
    tickAge: num(tk.at) ? Math.round((now - tk.at) / 1000) : null,
  };
}

/* ---------------------------------------------------------------------------- the score */
/**
 * Each reading's vote (−1 down … +1 up) and weight, with its reason in words.
 * @param market { score } the market's lean (the NIFTY and the breadth), −100…+100, optional
 */
function votes(f, market = null) {
  const out = [];
  const add = (id, w, v, why) => {
    if (!num(v)) return;
    out.push({ id, w, v: clamp(v, -1, 1), why });
  };
  const atr = num(f.atr5) && f.atr5 > 0 ? f.atr5 : null;
  if (num(f.vwap) && atr) add("vwap", 14, (f.last - f.vwap) / (0.5 * atr), `${f.last >= f.vwap ? "above" : "below"} VWAP ${rs(f.vwap)} (${sg(f.vsVwapPct)}%, ${sg(f.vsVwapAtr, 1)} ATR)`);
  if (num(f.ema9) && num(f.ema21) && atr) add("ema", 12, (f.ema9 - f.ema21) / (0.3 * atr), `EMA 9 ${f.ema9 >= f.ema21 ? "above" : "below"} EMA 21 (${rs(f.ema9)} vs ${rs(f.ema21)})${num(f.ema9Slope) ? `, ${f.ema9Slope >= 0 ? "rising" : "falling"}` : ""}`);
  if (f.supertrend === 1 || f.supertrend === -1) add("supertrend", 10, f.supertrend, `Supertrend ${f.supertrend === 1 ? "up" : "down"} (line ${rs(f.supertrendLine)})`);
  if (num(f.macdHist)) {
    const turning = num(f.macdHistPrev) && Math.sign(f.macdHist) === Math.sign(f.macdHist - f.macdHistPrev);
    add("macd", 8, Math.sign(f.macdHist) * (turning ? 1 : 0.5), `MACD histogram ${sg(f.macdHist)}${turning ? (f.macdHist > 0 ? ", growing" : ", deepening") : ", fading"}`);
  }
  if (num(f.rsi)) {
    const v = f.rsi >= 75 ? 0.3 : f.rsi <= 25 ? -0.3 : (f.rsi - 50) / 15;
    add("rsi", 8, v, `RSI(14) ${f.rsi}${f.rsi >= 75 ? " — stretched up" : f.rsi <= 25 ? " — stretched down" : f.rsi >= 55 ? " — momentum up" : f.rsi <= 45 ? " — momentum down" : ""}`);
  }
  if (num(f.adx) && num(f.plusDI) && num(f.minusDI)) add("adx", 8, f.adx >= 20 ? Math.sign(f.plusDI - f.minusDI) * Math.min(1, (f.adx - 15) / 20) : 0, `ADX ${f.adx} (${f.adx >= 25 ? "trending" : f.adx >= 20 ? "a trend forming" : "no trend"}), +DI ${f.plusDI} / −DI ${f.minusDI}`);
  if (f.orb === "above" || f.orb === "below" || f.orb === "inside") add("orb", 10, f.orb === "above" ? 1 : f.orb === "below" ? -1 : 0, f.orb === "inside" ? `inside the opening range ${rs(f.orl)}–${rs(f.orh)}` : `${f.orb === "above" ? "above the opening-range high" : "below the opening-range low"} ${rs(f.orb === "above" ? f.orh : f.orl)}`);
  if (num(f.pdh) && num(f.pdl) && f.pdh > f.pdl) {
    const v = f.last > f.pdh ? 1 : f.last < f.pdl ? -1 : ((f.last - (f.pdh + f.pdl) / 2) / (f.pdh - f.pdl)) * 1.2;
    add("prevday", 6, v, f.last > f.pdh ? `above yesterday's high ${rs(f.pdh)}` : f.last < f.pdl ? `below yesterday's low ${rs(f.pdl)}` : `inside yesterday's range ${rs(f.pdl)}–${rs(f.pdh)}`);
  }
  if (f.pivots && num(f.pivots.r1) && num(f.pivots.s1)) {
    const p = f.pivots;
    const v = f.last > p.r1 ? 0.8 : f.last > p.cprTop ? 0.4 : f.last < p.s1 ? -0.8 : f.last < p.cprBottom ? -0.4 : 0;
    add("pivots", 5, v, f.last > p.r1 ? `above R1 ${rs(p.r1)}` : f.last > p.cprTop ? `above the CPR (${rs(p.cprBottom)}–${rs(p.cprTop)})` : f.last < p.s1 ? `below S1 ${rs(p.s1)}` : f.last < p.cprBottom ? `below the CPR (${rs(p.cprBottom)}–${rs(p.cprTop)})` : `inside the CPR ${rs(p.cprBottom)}–${rs(p.cprTop)}`);
  }
  if (num(f.rsNifty)) add("rs", 10, f.rsNifty / 1 + (num(f.rs30) ? f.rs30 / 0.6 : 0) * 0.5, `${sg(f.rsNifty)}% against the NIFTY today${num(f.rs30) ? `, ${sg(f.rs30)}% over 30 minutes` : ""}`);
  if (num(f.relVol) && f.relVol > 1 && num(f.vsVwapPct)) add("volume", 6, Math.sign(f.vsVwapPct || f.chgPct || 0) * Math.min(1, f.relVol - 1), `volume ${f.relVol}× its usual by now, ${f.vsVwapPct >= 0 ? "with buyers above VWAP" : "with sellers below VWAP"}`);
  if (num(f.bookBuyPct)) add("book", 5, (f.bookBuyPct - 50) / 20, `order book ${Math.round(f.bookBuyPct)}% bids`);
  if (num(f.roc3) && num(f.atrPct) && f.atrPct > 0) add("momentum", 6, f.roc3 / (f.atrPct * 0.8), `${sg(f.roc3)}% in 15 minutes`);
  if (num(f.bbPctB)) add("bollinger", 4, f.squeeze && (f.bbPctB > 1 || f.bbPctB < 0) ? (f.bbPctB > 1 ? 1 : -1) : (f.bbPctB - 0.5) * 1.2, `Bollinger %B ${f.bbPctB}${f.squeeze ? " out of a squeeze" : ""}`);
  if (f.dailyTrend === 1 || f.dailyTrend === -1) add("daily", 4, f.dailyTrend, `daily trend ${f.dailyTrend === 1 ? "up (above the 20- and 50-day averages)" : "down (below the 20- and 50-day averages)"}`);
  if (market && num(market.score)) add("market", 6, market.score / 60, `the market leans ${market.score > 10 ? "up" : market.score < -10 ? "down" : "nowhere"} (${sg(market.score, 0)})`);
  return out;
}

/** The weighted score (−100…+100), the agreement (0…1), and the reasons for and against. */
function score(f, market = null) {
  const vs = votes(f, market);
  const W = vs.reduce((a, x) => a + x.w, 0);
  if (!W) return { score: 0, agree: 0, reasons: [], against: [] };
  const s = (vs.reduce((a, x) => a + x.w * x.v, 0) / W) * 100;
  const sign = Math.sign(s) || 1;
  const strong = vs.reduce((a, x) => a + x.w * Math.abs(x.v), 0);
  const agree = strong ? vs.filter((x) => Math.sign(x.v) === sign).reduce((a, x) => a + x.w * Math.abs(x.v), 0) / strong : 0;
  const by = (x) => -x.w * Math.abs(x.v);
  return {
    score: Math.round(s),
    agree: r2(agree),
    reasons: vs.filter((x) => Math.sign(x.v) === sign && Math.abs(x.v) >= 0.15).sort((a, b) => by(a) - by(b)).map((x) => ({ id: x.id, text: x.why, weight: Math.round(x.w * Math.abs(x.v) * 10) / 10 })),
    against: vs.filter((x) => Math.sign(x.v) === -sign && Math.abs(x.v) >= 0.15).sort((a, b) => by(a) - by(b)).map((x) => ({ id: x.id, text: x.why, weight: Math.round(x.w * Math.abs(x.v) * 10) / 10 })),
    votes: Object.fromEntries(vs.map((x) => [x.id, r2(x.v)])),
  };
}

/** The lean for the next 15–30 minutes, and the range the stock usually covers in that time. */
function nextMove(f, s) {
  const dir = s.score >= 12 ? "up" : s.score <= -12 ? "down" : "flat";
  const a = Math.abs(s.score);
  const strength = dir === "flat" ? "none" : a >= 50 && s.agree >= 0.75 ? "strong" : a >= 30 && s.agree >= 0.6 ? "moderate" : "weak";
  const span = num(f.atr5) ? f.atr5 * Math.sqrt(6) * 0.6 : null; // about six 5-minute bars
  return {
    dir,
    strength,
    horizon: "15–30 min",
    rangeLow: num(span) ? r2(f.last - span) : null,
    rangeHigh: num(span) ? r2(f.last + span) : null,
    text: dir === "flat" ? "No clear lean: the evidence is split." : `Leans ${dir === "up" ? "UP" : "DOWN"} (${strength}) for the next 15–30 minutes: ${s.reasons.slice(0, 2).map((x) => x.text).join("; ")}.`,
  };
}

/** Entry, stop and two targets for a side, from the buffer's structure, and the nearest level against it. */
function plan(f, side) {
  const atr = num(f.atr5) && f.atr5 > 0 ? f.atr5 : null;
  if (!atr || !num(f.last)) return null;
  const long = side === "long";
  const entry = f.last;
  const cands = long ? [f.swingLow, f.supertrend === 1 ? f.supertrendLine : null, num(f.vwap) ? f.vwap - 0.15 * atr : null] : [f.swingHigh, f.supertrend === -1 ? f.supertrendLine : null, num(f.vwap) ? f.vwap + 0.15 * atr : null];
  // the nearest structure that leaves at least 0.4 ATR of room
  const ok = cands.filter(num).filter((x) => (long ? entry - x >= 0.4 * atr : x - entry >= 0.4 * atr));
  let stop = ok.length ? (long ? Math.max(...ok) : Math.min(...ok)) : long ? entry - atr : entry + atr;
  if (Math.abs(entry - stop) > 1.6 * atr) stop = long ? entry - 1.6 * atr : entry + 1.6 * atr;
  const risk = Math.abs(entry - stop);
  const t1 = long ? entry + 1.5 * risk : entry - 1.5 * risk;
  const t2 = long ? entry + 2.5 * risk : entry - 2.5 * risk;
  // the nearest level against the trade: day high/low, yesterday's, the opening range, R1/S1
  const levels = long
    ? [[f.dayHigh, "the day's high"], [f.pdh, "yesterday's high"], [f.orh, "the opening-range high"], [f.pivots && f.pivots.r1, "R1"], [f.pivots && f.pivots.r2, "R2"]]
    : [[f.dayLow, "the day's low"], [f.pdl, "yesterday's low"], [f.orl, "the opening-range low"], [f.pivots && f.pivots.s1, "S1"], [f.pivots && f.pivots.s2, "S2"]];
  // a level within a quarter of an ATR is the one being broken (a new high, a break of yesterday's high),
  // not one in the way: the nearest level beyond that is the one that counts
  const ahead = levels.filter(([x]) => num(x) && (long ? x > entry + 0.25 * atr : x < entry - 0.25 * atr)).sort((a, b) => Math.abs(a[0] - entry) - Math.abs(b[0] - entry))[0] || null;
  return {
    side,
    entry: r2(entry),
    stop: r2(stop),
    t1: r2(t1),
    t2: r2(t2),
    risk: r2(risk),
    riskPct: r2((risk / entry) * 100),
    rr: 1.5,
    level: ahead ? { price: r2(ahead[0]), name: ahead[1], roomR: r2(Math.abs(ahead[0] - entry) / risk) } : null,
  };
}

/**
 * Whether the stock may be traded intraday now, on which side, and every rule that fails.
 * @param market { score } the market's lean
 */
function eligibility(f, s, nm, market = null, rules = RULES) {
  const side = nm.dir === "up" ? "long" : nm.dir === "down" ? "short" : null;
  const blocks = [];
  const m = istMin(f.at);
  if (!side) blocks.push("no clear side: the evidence is split");
  if (m < ENTRY_FROM) blocks.push("before 9:30 AM: the opening range is still forming");
  if (m > ENTRY_TO) blocks.push("after 2:45 PM: too late for a new intraday entry");
  if (Math.abs(s.score) < rules.minScore) blocks.push(`score ${s.score} is under ±${rules.minScore}`);
  if (s.agree < rules.minAgree) blocks.push(`only ${Math.round(s.agree * 100)}% of the evidence agrees (needs ${Math.round(rules.minAgree * 100)}%)`);
  const p = side ? plan(f, side) : null;
  if (side) {
    const long = side === "long";
    if (num(f.vwap) && (long ? f.last < f.vwap : f.last > f.vwap)) blocks.push(`price is on the wrong side of VWAP ${rs(f.vwap)}`);
    const orbWith = long ? f.orb === "above" : f.orb === "below";
    if (!(num(f.adx) && f.adx >= rules.minAdx) && !orbWith) blocks.push(`no trend: ADX ${num(f.adx) ? f.adx : "—"} and no opening-range break`);
    if (num(f.relVol) && f.relVol < rules.minRelVol) blocks.push(`volume is thin (${f.relVol}× its usual by now)`);
    if (num(f.turnoverCr) && f.turnoverCr < rules.minTurnoverCr) blocks.push(`too little money traded (₹${Math.round(f.turnoverCr)} cr a day)`);
    if (num(f.rsi) && (long ? f.rsi > rules.maxRsiLong : f.rsi < rules.minRsiShort)) blocks.push(`stretched: RSI ${f.rsi}`);
    if (num(f.vsVwapAtr) && Math.abs(f.vsVwapAtr) > rules.maxStretchAtr) blocks.push(`stretched: ${Math.abs(f.vsVwapAtr)} ATR from VWAP`);
    if (market && num(market.score) && (long ? market.score <= -40 : market.score >= 40) && Math.abs(s.score) < rules.counterScore) blocks.push(`against a market leaning ${long ? "down" : "up"} (${market.score}) without stronger evidence (score ${rules.counterScore}+)`);
    if (p && p.level && p.level.roomR < rules.minRoomR) blocks.push(`${p.level.name} ${rs(p.level.price)} is only ${p.level.roomR}R away`);
    if (num(f.tickAge) && f.tickAge > 90) blocks.push(`no tick for ${f.tickAge} s`);
  }
  return { eligible: blocks.length === 0, side, blocks, plan: p };
}

/** The full reading of one stock: readings, score, next move, eligibility, plan. */
function read(st, ctx = {}) {
  const f = features(st, ctx);
  if (!f.ready) return { symbol: st.symbol, ready: false, reason: f.reason };
  const s = score(f, ctx.market || null);
  const nm = nextMove(f, s);
  const e = eligibility(f, s, nm, ctx.market || null, ctx.rules || RULES);
  return { symbol: st.symbol, ready: true, f, score: s.score, agree: s.agree, reasons: s.reasons, against: s.against, votes: s.votes, next: nm, eligible: e.eligible, side: e.side, blocks: e.blocks, plan: e.plan };
}

/**
 * The market's lean from the NIFTY's own reading and the breadth of the hundred.
 * @param rows the stocks' readings
 */
function marketLean(nifty, rows) {
  const ready = rows.filter((r) => r.ready);
  const n = ready.length;
  const up = ready.filter((r) => num(r.f.chgPct) && r.f.chgPct > 0).length;
  const aboveVwap = ready.filter((r) => num(r.f.vwap) && r.f.last > r.f.vwap).length;
  const emaUp = ready.filter((r) => num(r.f.ema9) && num(r.f.ema21) && r.f.ema9 > r.f.ema21).length;
  const breadth = n ? ((up / n - 0.5) * 2 * 0.4 + (aboveVwap / n - 0.5) * 2 * 0.35 + (emaUp / n - 0.5) * 2 * 0.25) * 100 : null;
  const ns = nifty && nifty.ready ? nifty.score : null;
  const sc = num(ns) && num(breadth) ? Math.round(ns * 0.6 + breadth * 0.4) : num(ns) ? ns : num(breadth) ? Math.round(breadth) : null;
  return {
    score: sc,
    dir: !num(sc) ? "flat" : sc >= 12 ? "up" : sc <= -12 ? "down" : "flat",
    nifty: nifty && nifty.ready ? { last: nifty.f.last, chgPct: nifty.f.chgPct, score: nifty.score, agree: nifty.agree, next: nifty.next, vwapSide: null, rsi: nifty.f.rsi, adx: nifty.f.adx, supertrend: nifty.f.supertrend, orb: nifty.f.orb, reasons: nifty.reasons.slice(0, 4) } : null,
    breadth: { n, advancing: up, declining: n - up, aboveVwap, emaUp, score: num(breadth) ? Math.round(breadth) : null },
  };
}

/* ---------------------------------------------------------------------------- the record */
/** A fresh record for a day. */
function newRecord(date) {
  return { date, calls: [], leans: [], leanStats: { strong: { n: 0, right: 0, wrong: 0 }, moderate: { n: 0, right: 0, wrong: 0 }, weak: { n: 0, right: 0, wrong: 0 } } };
}

/** A stock has just become eligible on a side: follow the call. */
function openCall(rec, r, now) {
  const p = r.plan;
  if (!p) return null;
  const c = { id: `${r.symbol}-${now}`, symbol: r.symbol, side: r.side, at: now, entry: p.entry, stop: p.stop, t1: p.t1, score: r.score, agree: r.agree, outcome: null, settledAt: null, moveR: null, reasons: r.reasons.slice(0, 3).map((x) => x.id) };
  rec.calls.push(c);
  if (rec.calls.length > 400) rec.calls.splice(0, rec.calls.length - 400);
  return c;
}

/** Move every open call along with the stock's price: first target, stop, or thirty minutes. */
function followCalls(rec, priceOf, now) {
  for (const c of rec.calls) {
    if (c.outcome) continue;
    const px = priceOf(c.symbol);
    if (!num(px)) continue;
    const long = c.side === "long";
    const risk = Math.abs(c.entry - c.stop) || 1;
    if (long ? px >= c.t1 : px <= c.t1) c.outcome = "target";
    else if (long ? px <= c.stop : px >= c.stop) c.outcome = "stop";
    else if (now - c.at >= 30 * 60000) c.outcome = "time";
    if (c.outcome) {
      c.settledAt = now;
      c.moveR = r2(((long ? px - c.entry : c.entry - px) / risk));
    }
  }
}

/** Every lean given at a bar's close is checked three bars later: right, wrong, or no move. */
function addLeans(rec, rows, now) {
  for (const r of rows) {
    if (!r.ready || r.next.dir === "flat" || !num(r.f.atr5)) continue;
    rec.leans.push({ s: r.symbol, at: now, dir: r.next.dir, str: r.next.strength, px: r.f.last, atr: r.f.atr5 });
  }
  if (rec.leans.length > 3000) rec.leans.splice(0, rec.leans.length - 3000);
}
function settleLeans(rec, priceOf, now) {
  const keep = [];
  for (const l of rec.leans) {
    if (now - l.at < 15 * 60000) {
      keep.push(l);
      continue;
    }
    const px = priceOf(l.s);
    if (!num(px)) continue; // no price: dropped, never counted
    const st = rec.leanStats[l.str] || (rec.leanStats[l.str] = { n: 0, right: 0, wrong: 0 });
    const move = (px - l.px) * (l.dir === "up" ? 1 : -1);
    st.n += 1;
    if (move >= 0.1 * l.atr) st.right += 1;
    else if (move <= -0.1 * l.atr) st.wrong += 1;
  }
  rec.leans = keep;
}

/** The record in short, for the page and the AI. */
function recordSummary(rec) {
  const done = rec.calls.filter((c) => c.outcome);
  const tg = done.filter((c) => c.outcome === "target").length;
  const sp = done.filter((c) => c.outcome === "stop").length;
  const tm = done.filter((c) => c.outcome === "time").length;
  const avgR = done.length ? r2(done.reduce((a, c) => a + (c.moveR || 0), 0) / done.length) : null;
  const lean = Object.fromEntries(Object.entries(rec.leanStats).map(([k, v]) => [k, { ...v, rightPct: v.right + v.wrong ? Math.round((v.right / (v.right + v.wrong)) * 100) : null }]));
  return { date: rec.date, calls: rec.calls.length, settled: done.length, open: rec.calls.length - done.length, targets: tg, stops: sp, timedOut: tm, hitPct: tg + sp ? Math.round((tg / (tg + sp)) * 100) : null, avgR, lean };
}

module.exports = { newState, seed, addTick, dailyContext, features, votes, score, nextMove, plan, eligibility, read, marketLean, newRecord, openCall, followCalls, addLeans, settleLeans, recordSummary, bucket, istDate, istMin, msOf, RULES, ENTRY_FROM, ENTRY_TO, OPEN_MIN, CLOSE_MIN, BAR_MS };
