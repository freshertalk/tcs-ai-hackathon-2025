"use strict";
// The live intraday call: what the tape says RIGHT NOW, for same-day trades.
//
// Inputs are today's 5-minute bars, the live quote, and the clock. The output is
// one of six states — long in play, short in play, wait for a long trigger, wait
// for a short trigger, wait (no edge), or no trade (wrong time, circuit, stale
// feed) — with the score that produced it, every factor in that score, and the
// entry / stop / targets when there is something to act on.
//
// The same rules run every few seconds. They follow price; they do not predict
// it. A call can flip within minutes, and that is the point of a stop-loss.

const I = require("./indicators");

const num = I.isNum;
const TICK = 0.05;
const IST = 5.5 * 3600 * 1000;
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const tick = (x) => (num(x) ? Math.round(x / TICK) * TICK : null);
const fx = (x) => (num(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

// NSE cash session, minutes after midnight IST
const T = { open: 9 * 60 + 15, rangeSet: 9 * 60 + 30, midday: 11 * 60 + 30, afternoon: 13 * 60 + 30, cutoff: 14 * 60 + 45, squareOff: 15 * 60 + 15, close: 15 * 60 + 30 };
const SESSION_MIN = T.close - T.open;

const PHASES = {
  closed: { label: "Market closed", note: "The cash market trades 9:15 AM – 3:30 PM IST, Monday to Friday.", entries: false },
  preopen: { label: "Before the open", note: "The market opens at 9:15 AM. Levels below are for the session ahead.", entries: false },
  opening: { label: "Opening range forming", note: "The first 15 minutes set the day's range. No entries until 9:30 AM — the open is where most false moves happen.", entries: false },
  morning: { label: "Morning session", note: "9:30 – 11:30 AM: the most volume and the cleanest breakouts of the day.", entries: true },
  midday: { label: "Midday lull", note: "11:30 AM – 1:30 PM: volume thins and breakouts fail more often, so a stronger reading is required.", entries: true },
  afternoon: { label: "Afternoon session", note: "1:30 – 2:45 PM: trends often resume. Entries still have time to work.", entries: true },
  late: { label: "Last hour — no fresh entries", note: "After 2:45 PM a new trade has too little time. Manage what is open; do not start anything.", entries: false },
  squareoff: { label: "Square-off window", note: "Brokers close open intraday (MIS) positions automatically around 3:15 – 3:20 PM. Be flat before that.", entries: false },
};

/** Where the clock is in the trading day. Holidays are not known here — no bars means no call. */
function sessionAt(nowMs) {
  const d = new Date(nowMs + IST);
  const dow = d.getUTCDay();
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const weekday = dow >= 1 && dow <= 5;
  let phase = "closed";
  if (weekday) {
    if (m >= T.open - 15 && m < T.open) phase = "preopen";
    else if (m >= T.open && m < T.rangeSet) phase = "opening";
    else if (m >= T.rangeSet && m < T.midday) phase = "morning";
    else if (m >= T.midday && m < T.afternoon) phase = "midday";
    else if (m >= T.afternoon && m < T.cutoff) phase = "afternoon";
    else if (m >= T.cutoff && m < T.squareOff) phase = "late";
    else if (m >= T.squareOff && m < T.close) phase = "squareoff";
  }
  const open = weekday && m >= T.open && m < T.close;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    ist: `${hh}:${mm}`,
    phase,
    label: PHASES[phase].label,
    note: PHASES[phase].note,
    open,
    entries: PHASES[phase].entries,
    elapsedPct: open ? Math.round(((m - T.open) / SESSION_MIN) * 100) : null,
    minutesToCutoff: open && m < T.cutoff ? T.cutoff - m : open ? 0 : null,
    minutesToSquareOff: open && m < T.squareOff ? T.squareOff - m : open ? 0 : null,
    minutesToClose: open ? T.close - m : null,
  };
}

/** Kite sends "2026-11-12 10:15:00" in IST, with no zone. */
function tradeTime(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)$/);
  const ms = m ? Date.parse(`${m[1]}T${m[2]}+05:30`) : Date.parse(String(s));
  return Number.isFinite(ms) ? ms : null;
}

/** When a 5-minute bar began. Kite writes the zone as "+0530". */
function barStart(t) {
  const ms = Date.parse(String(t).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One session's bars, shaped for the intraday chart: time, OHLC, volume and running VWAP.
 * Works for 5-minute and 1-minute bars alike: the opening range is every bar before 9:30.
 */
function buildTape(bars, { prevClose = null } = {}) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const vw = I.vwap(bars);
  const clock = (b) => String(b.t).slice(11, 16);
  const opening = bars.filter((b) => clock(b) < "09:30");
  const set = opening.length > 0 && bars.some((b) => clock(b) >= "09:30");
  return {
    date: String(bars[0].t).slice(0, 10),
    bars: bars.map((b, i) => ({ t: clock(b), o: r2(b.o), h: r2(b.h), l: r2(b.l), c: r2(b.c), v: b.v || 0, w: r2(vw[i]) })),
    orHigh: set ? r2(Math.max(...opening.map((b) => b.h))) : null,
    orLow: set ? r2(Math.min(...opening.map((b) => b.l))) : null,
    prevClose: r2(prevClose),
  };
}

/**
 * A quick read of the 1-minute tape — trend, momentum, structure and volume. The fastest
 * view the desk has: it turns before the 5-minute view does, and is wrong more often.
 * @param bars  today's 1-minute bars, oldest first
 * @param last  the live price (it stands in for the close of the bar still forming)
 */
function fastRead(bars, { last = null } = {}) {
  if (!Array.isArray(bars) || bars.length < 5) return { available: false, reason: "Fewer than five 1-minute bars so far." };
  const closes = bars.map((b) => b.c);
  const px = num(last) && last > 0 ? last : closes[closes.length - 1];
  closes[closes.length - 1] = px;
  const k = closes.length - 1;
  const warm = closes.length >= 22;
  const e9 = warm ? I.ema(closes, 9)[k] : null;
  const e21 = warm ? I.ema(closes, 21)[k] : null;
  const rsi = closes.length >= 16 ? I.rsi(closes, 14)[k] : null;
  const back = (n) => (k - n >= 0 ? pct(px, closes[k - n]) : null);

  let structure = "not enough bars yet";
  let swingLow = null;
  let swingHigh = null;
  const closed = bars.slice(0, -1);
  if (closed.length >= 10) {
    const sw = I.swings(closed, 3);
    const lows = sw.lows.slice(-2);
    const highs = sw.highs.slice(-2);
    if (lows.length) swingLow = lows[lows.length - 1].price;
    if (highs.length) swingHigh = highs[highs.length - 1].price;
    const hl = lows.length === 2 && lows[1].price > lows[0].price;
    const ll = lows.length === 2 && lows[1].price < lows[0].price;
    const hh = highs.length === 2 && highs[1].price > highs[0].price;
    const lh = highs.length === 2 && highs[1].price < highs[0].price;
    structure = hh && hl ? "higher highs and higher lows" : lh && ll ? "lower highs and lower lows" : hl ? "higher lows" : lh ? "lower highs" : "no clear structure";
  }

  const vols = bars.map((b) => b.v || 0);
  const all = vols.reduce((s, v) => s + v, 0) / vols.length;
  const lastFive = vols.slice(-5);
  const recent = lastFive.reduce((s, v) => s + v, 0) / lastFive.length;
  let trend = "warming up";
  if (num(e9) && num(e21)) {
    const gap = (e9 - e21) / px;
    // averages closer than 0.01% of the price are not a trend in either direction
    trend = Math.abs(gap) < 0.0001 ? "flat" : gap > 0 ? (px >= e9 ? "up" : "up, pausing") : px <= e9 ? "down" : "down, pausing";
  }
  const m5 = back(5);
  return {
    available: true,
    bars: bars.length,
    trend,
    ema9: r2(e9),
    ema21: r2(e21),
    rsi: r1(rsi),
    m1Pct: r2(back(1)),
    m5Pct: r2(m5),
    m15Pct: r2(back(15)),
    structure,
    swingLow: r2(swingLow),
    swingHigh: r2(swingHigh),
    volumeSurge: all > 0 ? r2(recent / all) : null,
    summary: `1-minute trend ${trend}; ${structure}${num(rsi) ? `; RSI ${Math.round(rsi)}` : ""}${num(m5) ? `; ${m5 >= 0 ? "+" : ""}${m5.toFixed(2)}% in five minutes` : ""}.`,
  };
}

/**
 * @param bars       today's 5-minute bars, oldest first/**
 * @param bars       today's 5-minute bars, oldest first
 * @param prior      earlier days' 5-minute bars (only to warm up the moving averages and RSI)
 * @param quote      live quote: { last, open, high, low, prevClose, volume, avgPrice, time }
 * @param atr        the daily ATR (a normal day's range)
 * @param done       the last completed daily bar
 * @param pivots     pivots from that bar: { r1, r2, r3, s1, s2, s3, p }
 * @param circuit    { upper, lower } or null
 * @param nowMs      the clock
 * @param dailyDirection  "bullish" | "bearish" | "neutral" — the swing reading, for context only
 * @param avgVolume  average full-day volume over the last 20 completed sessions
 * @param market     the market around the stock, or null:
 *                   { tide: { score, label, summary }, nifty: { fromOpenPct }, vix: { changePct }, world: { mood, time, headline } }
 * @param micro      how far the price moved in the last seconds, from the tick stream, or null: { d30, d60, d180 }
 */
function liveCall({ bars, prior = [], quote, atr, done, pivots = {}, circuit = null, nowMs, dailyDirection = "neutral", avgVolume = null, market = null, micro = null, fast = null }) {
  const session = sessionAt(nowMs);
  const off = (reason) => ({ available: false, reason, session });

  if (!session.open) return off(session.phase === "preopen" ? "The market has not opened yet." : "The market is closed. The live call starts at 9:15 AM IST on the next trading day.");
  if (!Array.isArray(bars) || bars.length === 0) return off("No trades today yet — a market holiday, a suspended stock, or the intraday feed is not available.");
  if (!quote || !num(quote.last) || quote.last <= 0) return off("No live quote for this symbol, so there is nothing to make a live call on.");
  if (!num(atr) || atr <= 0) return off("A normal day's range (ATR) is not known for this stock yet.");

  /* ------------------------------------------------------------ the tape */
  const last = quote.last;
  const lastBar = bars[bars.length - 1];
  const dayOpen = num(quote.open) && quote.open > 0 ? quote.open : bars[0].o;
  const dayHigh = Math.max(num(quote.high) ? quote.high : -Infinity, ...bars.map((b) => b.h), last);
  const dayLow = Math.min(num(quote.low) && quote.low > 0 ? quote.low : Infinity, ...bars.map((b) => b.l), last);
  const prevClose = num(quote.prevClose) && quote.prevClose > 0 ? quote.prevClose : done ? done.c : null;

  // the exchange's own average traded price is the true VWAP; 5-minute bars only approximate it
  const barVwap = I.vwap(bars);
  const fromBars = barVwap[barVwap.length - 1];
  // an index has no volume: fall back to the plain average of the bars so there is always an anchor
  const plain = bars.reduce((t, x) => t + (x.h + x.l + x.c) / 3, 0) / bars.length;
  const vwap = num(quote.avgPrice) && quote.avgPrice > 0 ? quote.avgPrice : num(fromBars) && fromBars > 0 ? fromBars : plain;

  const opening = bars.slice(0, 3);
  const rangeSet = bars.length >= 3 && session.phase !== "opening";
  const orHigh = Math.max(...opening.map((b) => b.h));
  const orLow = Math.min(...opening.map((b) => b.l));

  // A breakout counts only once a full 5-minute bar has CLOSED beyond the level.
  // A single tick through it is how most false breakouts begin.
  const closed = bars.filter((b) => {
    const s = barStart(b.t);
    return s === null ? b !== lastBar : s + 300000 <= nowMs;
  });
  const lastClosed = closed.length > 3 ? closed[closed.length - 1] : null;
  const closedAbove = Boolean(lastClosed && lastClosed.c > orHigh);
  const closedBelow = Boolean(lastClosed && lastClosed.c < orLow);

  const closes = [...prior, ...bars].map((b) => b.c);
  closes[closes.length - 1] = last; // the forming bar ends at the live price
  const k = closes.length - 1;
  const e9 = closes.length >= 22 ? I.ema(closes, 9)[k] : null;
  const e21 = closes.length >= 22 ? I.ema(closes, 21)[k] : null;
  const rsiSeries = closes.length >= 16 ? I.rsi(closes, 14) : null;
  const rsi5 = rsiSeries ? rsiSeries[k] : null;

  const ref15 = bars.length > 3 ? bars[bars.length - 4].c : dayOpen;
  const ref30 = bars.length > 6 ? bars[bars.length - 7].c : dayOpen;

  const barVolume = bars.reduce((s, b) => s + (b.v || 0), 0);
  const volume = num(quote.volume) && quote.volume > 0 ? quote.volume : barVolume;
  const elapsed = clamp((session.elapsedPct || 0) / 100, 0.02, 1);
  const volumePace = num(avgVolume) && avgVolume > 0 ? volume / (avgVolume * elapsed) : null;
  // are the last three bars busier than the rest of the day?
  let surge = null;
  let surgeDir = 0;
  if (bars.length >= 8) {
    const recent = bars.slice(-3);
    const rest = bars.slice(0, -3);
    const avgRest = rest.reduce((s, b) => s + (b.v || 0), 0) / rest.length;
    const avgRecent = recent.reduce((s, b) => s + (b.v || 0), 0) / 3;
    if (avgRest > 0) surge = avgRecent / avgRest;
    surgeDir = Math.sign(last - recent[0].o);
  }

  const span = dayHigh - dayLow;
  const dayPos = span > 0 ? (last - dayLow) / span : 0.5;
  const rangeUsedPct = Math.round((span / atr) * 100);

  /* ------------------------------------------------------------ the score */
  const factors = [];
  const add = (name, reading, pts, max) => factors.push({ name, reading, pts: Math.round(pts), max });

  const vwapDist = pct(last, vwap);
  add("Price vs VWAP", `${last >= vwap ? "above" : "below"} VWAP ${fx(vwap)} by ${Math.abs(vwapDist).toFixed(2)}%`, clamp(vwapDist / 0.25, -1, 1) * 25, 25);

  if (rangeSet) {
    add(
      "Opening range",
      last > orHigh ? `above the first-15-minute high ${fx(orHigh)}` : last < orLow ? `below the first-15-minute low ${fx(orLow)}` : `inside ${fx(orLow)} – ${fx(orHigh)}`,
      last > orHigh ? 20 : last < orLow ? -20 : 0,
      20
    );
  } else add("Opening range", "still forming", 0, 20);

  if (num(e9) && num(e21)) {
    const up = e9 > e21;
    const strong = up ? last > e9 : last < e9;
    add("5-minute trend", `9 EMA ${up ? "above" : "below"} 21 EMA${strong ? `, price ${up ? "above" : "below"} both` : ", price between them"}`, (up ? 1 : -1) * (strong ? 15 : 8), 15);
  } else add("5-minute trend", "not enough bars yet", 0, 15);

  const mom = last - ref30;
  add("Last 30 minutes", `${mom >= 0 ? "+" : ""}${fx(mom)} (${(pct(last, ref30) || 0).toFixed(2)}%)`, clamp(mom / (0.3 * atr), -1, 1) * 15, 15);

  add("Place in today's range", `${Math.round(dayPos * 100)}% of the way from the low ${fx(dayLow)} to the high ${fx(dayHigh)}`, (dayPos - 0.5) * 2 * 10, 10);

  const fromOpen = last - dayOpen;
  add("Since the open", `${fromOpen >= 0 ? "+" : ""}${fx(fromOpen)} from ${fx(dayOpen)}`, clamp(fromOpen / (0.4 * atr), -1, 1) * 10, 10);

  if (num(surge)) add("Volume behind the move", `last 15 min at ${surge.toFixed(1)}× the day's average bar`, surge >= 1.3 ? surgeDir * 5 : 0, 5);
  else add("Volume behind the move", "not enough bars yet", 0, 5);

  const tapeScore = clamp(Math.round(factors.reduce((s, f) => s + f.pts, 0)), -100, 100);

  // The market around the stock. A long needs more of its own evidence while the Nifty is
  // falling, a short needs more while it is rising, and a stock moving against the index is
  // showing real strength or weakness. Kept apart from the tape factors so its effect is visible.
  const marketFactors = [];
  if (market && market.tide && num(market.tide.score)) {
    marketFactors.push({ name: "Market tide (Nifty)", reading: market.tide.summary || `${market.tide.label} (${market.tide.score})`, pts: Math.round((market.tide.score / 100) * 8), max: 8 });
    const niftyOpen = market.nifty ? market.nifty.fromOpenPct : null;
    const mine = pct(last, dayOpen);
    if (num(niftyOpen) && num(mine)) {
      const unit = Math.max(0.3, 0.4 * (atr / last) * 100); // 0.4 ATR, in percent
      marketFactors.push({
        name: "Strength vs Nifty since the open",
        reading: `stock ${mine >= 0 ? "+" : ""}${mine.toFixed(2)}% vs Nifty ${niftyOpen >= 0 ? "+" : ""}${niftyOpen.toFixed(2)}%`,
        pts: Math.round(clamp((mine - niftyOpen) / unit, -1, 1) * 7),
        max: 7,
      });
    }
  }
  const marketAdj = marketFactors.reduce((s, f) => s + f.pts, 0);
  const score = clamp(tapeScore + marketAdj, -100, 100);
  const threshold = session.phase === "midday" ? 45 : 35;
  const bias = score >= threshold ? "long" : score <= -threshold ? "short" : "none";

  /* ---------------------------------------------------------- the triggers */
  const longTrigger = tick(orHigh + TICK);
  const shortTrigger = tick(orLow - TICK);
  const capUp = circuit && num(circuit.upper) ? circuit.upper * 0.998 : Infinity;
  const capDown = circuit && num(circuit.lower) ? circuit.lower * 1.002 : -Infinity;

  const levelsAbove = (from) =>
    [
      ["R1", pivots.r1],
      ["R2", pivots.r2],
      ["R3", pivots.r3],
      ["Previous day high", done && done.h],
      ["Day high", dayHigh],
    ]
      .filter(([, p]) => num(p) && p > from + 0.1 * atr && p < capUp)
      .sort((x, y) => x[1] - y[1])
      .slice(0, 2)
      .map(([label, p]) => ({ label, price: r2(p) }));
  const levelsBelow = (from) =>
    [
      ["S1", pivots.s1],
      ["S2", pivots.s2],
      ["S3", pivots.s3],
      ["Previous day low", done && done.l],
      ["Day low", dayLow],
    ]
      .filter(([, p]) => num(p) && p > 0 && p < from - 0.1 * atr && p > capDown)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 2)
      .map(([label, p]) => ({ label, price: r2(p) }));

  function plan(side, entry, stop, entryNote) {
    const risk = Math.abs(entry - stop);
    const dir = side === "long" ? 1 : -1;
    const raw = [1, 2].map((m) => ({ label: `${m}R`, price: entry + dir * m * risk }));
    const targets = raw.filter((t) => (side === "long" ? t.price < capUp : t.price > capDown && t.price > 0)).map((t) => ({ label: t.label, price: r2(t.price) }));
    return {
      side,
      entry: r2(entry),
      entryNote,
      stop: r2(stop),
      riskPerShare: r2(risk),
      riskPct: r2((risk / entry) * 100),
      targets,
      clipped: targets.length < raw.length,
      nextLevels: side === "long" ? levelsAbove(entry) : levelsBelow(entry),
    };
  }

  /* -------------------------------------------------------------- the call */
  const notes = [];
  let state = "wait";
  let headline = "Wait — no edge right now";
  let detail = `The intraday score is ${score}; it needs ${threshold} or more on either side. Long only above ${fx(longTrigger)}, short only below ${fx(shortTrigger)}.`;
  let tradePlan = null;

  const MIN_STOP = 0.2 * atr;
  const MAX_STOP = 0.8 * atr;

  if (bias === "long") {
    if (rangeSet && last > longTrigger && last > vwap && !closedAbove) {
      state = "wait-long";
      headline = `Wait — breaking out, not yet confirmed above ₹${fx(orHigh)}`;
      detail = `Price is through the opening-range high (score ${score}), but no 5-minute bar has closed above it yet. One tick through a level is how most false breakouts start — wait for the close.`;
      tradePlan = plan("long", longTrigger, tick(longTrigger - 0.5 * atr), "after a 5-minute close above it");
    } else if (rangeSet && last > longTrigger && last > vwap) {
      let stop = tick(Math.min(vwap, orHigh) - 0.1 * atr);
      if (last - stop < MIN_STOP) stop = tick(last - MIN_STOP);
      if (last - stop > MAX_STOP) {
        const back = Math.max(vwap, longTrigger);
        state = "wait-long";
        headline = `Wait — long, but only on a pullback toward ₹${fx(back)}`;
        detail = `Buyers are in control (score ${score}), but price is ${((last - stop) / atr).toFixed(1)} ATRs above the level that would prove the idea wrong. Chasing here means a stop too wide for a day trade.`;
        tradePlan = plan("long", tick(back + TICK), tick(back - 0.3 * atr), "on a pullback");
      } else {
        state = "long";
        headline = "Long — in play";
        detail = `Above VWAP and above the opening range with a score of ${score}. The idea is wrong if price falls back under ₹${fx(stop)}.`;
        tradePlan = plan("long", last, stop, "at the current price");
      }
    } else {
      state = "wait-long";
      headline = `Wait — long only above ₹${fx(longTrigger)}`;
      detail = `The tape leans up (score ${score}) but price has not cleared the opening-range high${last <= vwap ? " and is still under VWAP" : ""}. No trigger, no trade.`;
      tradePlan = plan("long", longTrigger, tick(longTrigger - 0.5 * atr), "only if it trades there");
    }
  } else if (bias === "short") {
    if (rangeSet && last < shortTrigger && last < vwap && !closedBelow) {
      state = "wait-short";
      headline = `Wait — breaking down, not yet confirmed below ₹${fx(orLow)}`;
      detail = `Price is through the opening-range low (score ${score}), but no 5-minute bar has closed below it yet. One tick through a level is how most false breakdowns start — wait for the close.`;
      tradePlan = plan("short", shortTrigger, tick(shortTrigger + 0.5 * atr), "after a 5-minute close below it");
    } else if (rangeSet && last < shortTrigger && last < vwap) {
      let stop = tick(Math.max(vwap, orLow) + 0.1 * atr);
      if (stop - last < MIN_STOP) stop = tick(last + MIN_STOP);
      if (stop - last > MAX_STOP) {
        const back = Math.min(vwap, shortTrigger);
        state = "wait-short";
        headline = `Wait — short, but only on a bounce toward ₹${fx(back)}`;
        detail = `Sellers are in control (score ${score}), but price is ${((stop - last) / atr).toFixed(1)} ATRs below the level that would prove the idea wrong. Chasing here means a stop too wide for a day trade.`;
        tradePlan = plan("short", tick(back - TICK), tick(back + 0.3 * atr), "on a bounce");
      } else {
        state = "short";
        headline = "Short — in play";
        detail = `Below VWAP and below the opening range with a score of ${score}. The idea is wrong if price climbs back over ₹${fx(stop)}.`;
        tradePlan = plan("short", last, stop, "at the current price");
      }
    } else {
      state = "wait-short";
      headline = `Wait — short only below ₹${fx(shortTrigger)}`;
      detail = `The tape leans down (score ${score}) but price has not broken the opening-range low${last >= vwap ? " and is still above VWAP" : ""}. No trigger, no trade.`;
      tradePlan = plan("short", shortTrigger, tick(shortTrigger + 0.5 * atr), "only if it trades there");
    }
  }

  // a stop must always sit on the losing side of the entry, at least one tick away
  if (tradePlan) {
    if (tradePlan.side === "long" && !(tradePlan.stop < tradePlan.entry)) tradePlan = plan("long", tradePlan.entry, tradePlan.entry - Math.max(TICK, MIN_STOP), tradePlan.entryNote);
    if (tradePlan.side === "short" && !(tradePlan.stop > tradePlan.entry)) tradePlan = plan("short", tradePlan.entry, tradePlan.entry + Math.max(TICK, MIN_STOP), tradePlan.entryNote);
  }

  /* ----------------------------------------- reasons to stand down anyway */
  const block = (why, text) => {
    state = "no-trade";
    headline = why;
    detail = text;
  };
  const leaning = bias === "none" ? "" : ` The tape leans ${bias} (score ${score}).`;

  const tradedAt = tradeTime(quote.time);
  const quoteAgeSec = tradedAt ? Math.max(0, Math.round((nowMs - tradedAt) / 1000)) : null;
  const upRoom = circuit && num(circuit.upper) ? pct(circuit.upper, last) : null;
  const downRoom = circuit && num(circuit.lower) ? pct(last, circuit.lower) : null;

  if (session.phase === "opening") {
    block("No trade yet — the opening range is forming", `${PHASES.opening.note}${leaning}`);
  } else if (!rangeSet) {
    block("No trade — too few bars today", "Fewer than three 5-minute bars have printed, so there is no opening range to trade against.");
  } else if (quoteAgeSec !== null && quoteAgeSec > 300) {
    block("No trade — the last trade is old", `The last trade was ${Math.round(quoteAgeSec / 60)} minutes ago. Either the stock is too thinly traded for a day trade, or the feed is delayed.`);
  } else if (upRoom !== null && upRoom <= 0.15) {
    block("No trade — at the upper circuit", `Price is at its upper circuit (₹${fx(circuit.upper)}). There are no sellers to buy from, and a short cannot be covered if it stays locked.`);
  } else if (downRoom !== null && downRoom <= 0.15) {
    block("No trade — at the lower circuit", `Price is at its lower circuit (₹${fx(circuit.lower)}). There are no buyers to sell to; a long cannot exit while it stays locked.`);
  } else if ((state === "long" || state === "wait-long") && upRoom !== null && upRoom < 1.5) {
    block("No long — too close to the upper circuit", `Only ${upRoom.toFixed(2)}% of room to the upper circuit (₹${fx(circuit.upper)}): the reward is capped.${leaning}`);
  } else if ((state === "short" || state === "wait-short") && downRoom !== null && downRoom < 1.5) {
    block("No short — too close to the lower circuit", `Only ${downRoom.toFixed(2)}% above the lower circuit (₹${fx(circuit.lower)}): the reward is capped and a lock would trap the short.${leaning}`);
  } else if (!session.entries) {
    const open = state === "long" || state === "short";
    block(
      session.phase === "squareoff" ? "No trade — square-off window" : "No fresh entries — last hour",
      `${PHASES[session.phase].note}${leaning}${open ? ` If you are already ${state}, your stop is ₹${fx(tradePlan.stop)}.` : ""}`
    );
  }
  if (state === "no-trade") tradePlan = null;

  /* ------------------------------------------------------- early warnings */
  // The first signs that a move is changing character. They never start a trade — an entry
  // still needs the confirmation above — but they are what to know first when you are in one,
  // and a reason to wait when you are not. Fast to warn, slow to commit.
  const early = [];
  const warn = (id, against, text) => early.push({ id, against, text });
  if (rangeSet) {
    if (dayHigh > orHigh + 0.1 * atr && last < orHigh && last < vwap) {
      warn("failed-breakout", "long", `Broke above the opening range (as far as ₹${fx(dayHigh)}) and is back inside it, under VWAP: a failed breakout. Buyers who chased it are trapped.`);
    }
    if (dayLow < orLow - 0.1 * atr && last > orLow && last > vwap) {
      warn("failed-breakdown", "short", `Broke below the opening range (as far as ₹${fx(dayLow)}) and is back inside it, above VWAP: a failed breakdown. Sellers who chased it are trapped.`);
    }
  }
  if (closed.length >= 8) {
    const sw = I.swings(closed, 2);
    const lows = sw.lows.slice(-2);
    const highs = sw.highs.slice(-2);
    if (lows.length === 2 && lows[1].price > lows[0].price && last < lows[1].price) {
      warn("structure-down", "long", `Fell through the last 5-minute swing low (₹${fx(lows[1].price)}): the run of higher lows is broken.`);
    }
    if (highs.length === 2 && highs[1].price < highs[0].price && last > highs[1].price) {
      warn("structure-up", "short", `Rose through the last 5-minute swing high (₹${fx(highs[1].price)}): the run of lower highs is broken.`);
    }
    if (rsiSeries) {
      // a new extreme made on weaker momentum than the one before it
      const at = (s) => rsiSeries[prior.length + s.i];
      const recent = (s) => closed.length - 1 - s.i <= 6;
      if (highs.length === 2 && highs[1].price > highs[0].price && recent(highs[1]) && num(at(highs[0])) && num(at(highs[1])) && at(highs[1]) < at(highs[0]) - 3 && last < highs[1].price) {
        warn("divergence-down", "long", `The latest high (₹${fx(highs[1].price)}) came on weaker momentum than the one before it (5-minute RSI ${Math.round(at(highs[1]))} against ${Math.round(at(highs[0]))}): the push is tiring.`);
      }
      if (lows.length === 2 && lows[1].price < lows[0].price && recent(lows[1]) && num(at(lows[0])) && num(at(lows[1])) && at(lows[1]) > at(lows[0]) + 3 && last > lows[1].price) {
        warn("divergence-up", "short", `The latest low (₹${fx(lows[1].price)}) came on weaker selling than the one before it (5-minute RSI ${Math.round(at(lows[1]))} against ${Math.round(at(lows[0]))}): the selling is tiring.`);
      }
    }
  }
  if (micro && num(micro.d60)) {
    // a whole day's normal range is one ATR; a tenth of that in a minute is a rush
    const speed = micro.d60 / atr;
    if (speed <= -0.12) warn("tape-down", "long", `Dropping fast: ${fx(micro.d60)} in the last minute — ${Math.round(-speed * 100)}% of a normal day's range in sixty seconds.`);
    if (speed >= 0.12) warn("tape-up", "short", `Rising fast: +${fx(micro.d60)} in the last minute — ${Math.round(speed * 100)}% of a normal day's range in sixty seconds.`);
  }
  if (micro && micro.flow && num(micro.flow.pressure)) {
    // the order book and the last minute of trades, from the live stream
    const fp = micro.flow.pressure;
    if (fp <= -50) warn("book-down", "long", `The order book has tilted to sellers (pressure ${fp}): more is offered than bid near the price, and recent volume has been hitting the bid.`);
    if (fp >= 50) warn("book-up", "short", `The order book has tilted to buyers (pressure +${fp}): more is bid than offered near the price, and recent volume has been lifting the offer.`);
  }
  if (fast && fast.available && num(fast.m5Pct)) {
    // the 1-minute tape turns before the 5-minute view does. Three things must agree before it
    // is called a turn: the averages, the swing structure, and the last five minutes.
    if (fast.trend === "down" && /lower highs/.test(fast.structure) && fast.m5Pct < 0) {
      warn("fast-down", "long", `The 1-minute tape has turned down: ${fast.structure}, ${fast.m5Pct.toFixed(2)}% in five minutes, and price is under its 9- and 21-minute averages.`);
    }
    if (fast.trend === "up" && /higher lows/.test(fast.structure) && fast.m5Pct > 0) {
      warn("fast-up", "short", `The 1-minute tape has turned up: ${fast.structure}, +${fast.m5Pct.toFixed(2)}% in five minutes, and price is over its 9- and 21-minute averages.`);
    }
  }
  if (rangeSet && bars.length >= 6 && Math.abs(vwapDist) <= 0.06) {
    warn("vwap-test", "either", `Sitting on VWAP (₹${fx(vwap)}): the day's fair price is being tested, and whichever side wins it usually sets the next move.`);
  }
  const mySide = state === "long" || state === "wait-long" ? "long" : state === "short" || state === "wait-short" ? "short" : null;
  const threats = mySide ? early.filter((e) => e.against === mySide) : [];
  const weakening = (state === "long" || state === "short") && threats.length > 0;
  if (weakening) detail += ` Early warning: ${threats[0].text}`;

  /* ------------------------------------------------------------- context */
  if (rangeUsedPct >= 150) notes.push(`Today's range is already ${rangeUsedPct}% of a normal day. Moves this stretched often stall or reverse — late entries have less room.`);
  if (num(rsi5) && rsi5 >= 78 && (state === "long" || state === "wait-long")) notes.push(`5-minute RSI is ${Math.round(rsi5)}: short-term overbought. A pause or dip is common before the next push.`);
  if (num(rsi5) && rsi5 <= 22 && (state === "short" || state === "wait-short")) notes.push(`5-minute RSI is ${Math.round(rsi5)}: short-term oversold. A bounce is common before the next leg down.`);
  const against = (bias === "long" && dailyDirection === "bearish") || (bias === "short" && dailyDirection === "bullish");
  const withTrend = (bias === "long" && dailyDirection === "bullish") || (bias === "short" && dailyDirection === "bearish");
  if (against) notes.push(`This is against the daily trend (${dailyDirection}). Counter-trend day trades fail more often: smaller size, quicker exit.`);
  if (num(volumePace) && volumePace < 0.6 && session.elapsedPct >= 20) notes.push(`Volume is running at ${volumePace.toFixed(1)}× its usual pace. Moves on thin volume are easier to reverse.`);
  const gapPct = pct(dayOpen, prevClose);
  if (num(gapPct) && Math.abs(gapPct) >= 2) {
    const held = gapPct > 0 ? last >= dayOpen : last <= dayOpen;
    notes.push(`Opened with a ${gapPct > 0 ? "+" : ""}${gapPct.toFixed(1)}% gap and is ${held ? "holding it" : "giving it back"} (${fromOpen >= 0 ? "+" : ""}${fx(fromOpen)} since the open).`);
  }
  if (market && market.tide && num(market.tide.score)) {
    if (bias === "long" && market.tide.score <= -50) notes.push(`The market is falling — ${market.tide.summary} A long here swims against it: it has to be clearly stronger than the index, and deserves smaller size.`);
    if (bias === "short" && market.tide.score >= 50) notes.push(`The market is rising — ${market.tide.summary} A short here swims against it: smaller size, quicker exit.`);
  }
  if (market && market.vix && num(market.vix.changePct) && market.vix.changePct >= 7) notes.push(`India VIX is up ${market.vix.changePct.toFixed(1)}% today: swings are wider than usual, so a stop at the normal distance is hit more easily.`);
  if (market && market.world && market.world.mood) {
    const w = market.world;
    if ((bias === "long" && w.mood === "risk_off") || (bias === "short" && w.mood === "risk_on")) {
      notes.push(`World cues at ${w.time} read ${w.mood === "risk_off" ? "risk-off" : "risk-on"} (${w.headline}) — against this ${bias}. That brief comes from a web search, so treat it as background, not as a signal.`);
    }
  }
  if (state === "short" || state === "wait-short") notes.push("A short in the cash market is intraday-only (MIS): it must be bought back before the square-off.");
  if (session.minutesToCutoff !== null && session.minutesToCutoff > 0 && session.minutesToCutoff <= 30) notes.push(`${session.minutesToCutoff} minutes left before the 2:45 PM cut-off for new entries.`);

  return {
    available: true,
    session,
    state,
    side: state === "long" || state === "wait-long" ? "long" : state === "short" || state === "wait-short" ? "short" : "none",
    headline,
    detail,
    score,
    tapeScore,
    marketAdj,
    marketFactors,
    threshold,
    bias,
    withDaily: withTrend ? "with" : against ? "against" : "neutral",
    factors,
    early,
    weakening,
    tapeSpeed: micro ? { last30s: r2(micro.d30), last60s: r2(micro.d60), last3min: r2(micro.d180) } : null,
    fast: fast && fast.available ? fast : null,
    plan: tradePlan,
    triggers: { long: r2(longTrigger), short: r2(shortTrigger), rangeSet, closedAbove, closedBelow },
    movement: {
      last: r2(last),
      changePct: r2(pct(last, prevClose)),
      gapPct: r2(gapPct),
      fromOpenPct: r2(pct(last, dayOpen)),
      open: r2(dayOpen),
      vwap: r2(vwap),
      vsVwapPct: r2(vwapDist),
      dayHigh: r2(dayHigh),
      dayLow: r2(dayLow),
      dayPosPct: Math.round(dayPos * 100),
      rangeUsedPct,
      atr: r2(atr),
      m15Pct: r2(pct(last, ref15)),
      m30Pct: r2(pct(last, ref30)),
      orHigh: r2(orHigh),
      orLow: r2(orLow),
      rsi5: r1(rsi5),
      volume,
      volumePace: r2(volumePace),
      volumeSurge: r2(surge),
      bars: bars.length,
      lastBarAt: lastBar.t,
      quoteAgeSec,
    },
    notes,
  };
}

module.exports = { liveCall, sessionAt, tradeTime, buildTape, fastRead, barStart, PHASES };
