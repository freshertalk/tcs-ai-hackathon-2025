"use strict";
// The "desk verdict": one mechanical reading for a stock, built from three time
// frames, with concrete levels for a swing plan and an intraday plan.
//
// What this is — and is not
//   • It is a fixed set of rules applied the same way every time: weekly trend,
//     daily technical score, and (when the market is live) the intraday picture.
//   • It always shows what argues AGAINST its own conclusion, and the price at
//     which the conclusion stops being valid.
//   • It cannot be "never wrong". Markets gap, news arrives, and rules that work
//     for months stop working. Conviction here means "how much the evidence
//     agrees", not "how likely this is to make money".
//
// Sides
//   swing     long only (delivery). A bearish verdict means stay out / exit.
//   intraday  long or short. In the NSE cash segment a short must be closed the
//             same day (MIS); carrying a short needs futures or options.

const I = require("./indicators");
const { liveCall } = require("./intraday");
const { longTermView, toWeekly, weekStart } = require("./longterm");

const num = I.isNum;
const TICK = 0.05;
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const tick = (x) => (num(x) ? Math.round(x / TICK) * TICK : null);
const pctOf = (a, b) => (num(a) && num(b) && b !== 0 ? r2(((a - b) / b) * 100) : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** A price inside a sentence: always two decimals. */
const fx = (x) => (num(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
/** The daily score must itself be at least this far from zero before any direction is called. */
const DAILY_MIN = 15;

/* ---------------------------------------------------------- time frames */

const frame = (name, dir, basis, extra = {}) => ({
  name,
  dir, // "up" | "down" | "sideways" | null (not enough data)
  label: dir === "up" ? "Up" : dir === "down" ? "Down" : dir === "sideways" ? "Sideways" : "Not enough data",
  basis,
  ...extra,
});

function weeklyTrend(candles) {
  const wk = toWeekly(candles);
  if (wk.length < 32) return frame("Weekly", null, `Only ${wk.length} weekly bars — 32 are needed.`);
  const closes = wk.map((w) => w.c);
  const e10 = I.ema(closes, 10);
  const e30 = I.ema(closes, 30);
  const i = wk.length - 1;
  const c = closes[i];
  const up = c > e30[i] && e10[i] > e30[i];
  const down = c < e30[i] && e10[i] < e30[i];
  return frame("Weekly", up ? "up" : down ? "down" : "sideways", `Close ${fx(c)} vs 30-week EMA ${fx(e30[i])}; 10-week EMA ${fx(e10[i])}`, {
    ema10: r2(e10[i]),
    ema30: r2(e30[i]),
  });
}

function dailyTrend(a) {
  const ma = a.levels.movingAverages;
  const c = a.price.last;
  if (!num(ma.ema50) || !num(ma.ema20)) return frame("Daily", null, "Fewer than 50 daily bars.");
  const up = c > ma.ema50 && ma.ema20 > ma.ema50;
  const down = c < ma.ema50 && ma.ema20 < ma.ema50;
  const adx = a.indicators.adx;
  const weak = num(adx) && adx < 18;
  return frame("Daily", up ? "up" : down ? "down" : "sideways", `Close ${fx(c)} vs 50 EMA ${fx(ma.ema50)}; 20 EMA ${fx(ma.ema20)}; ADX ${num(adx) ? adx : "—"}${weak ? " (no real trend)" : ""}`, { weak });
}

/** Today's 5-minute bars: VWAP, the first-15-minute range, and short moving averages. */
function intradayPicture(bars, last) {
  if (!Array.isArray(bars) || bars.length < 4) return null;
  const v = I.vwap(bars);
  const vwap = v[v.length - 1];
  const opening = bars.slice(0, 3);
  const orHigh = Math.max(...opening.map((b) => b.h));
  const orLow = Math.min(...opening.map((b) => b.l));
  const closes = bars.map((b) => b.c);
  const px = num(last) ? last : closes[closes.length - 1];
  let pts = 0;
  const why = [];
  if (num(vwap)) {
    pts += px > vwap ? 1 : px < vwap ? -1 : 0;
    why.push(`price ${px > vwap ? "above" : "below"} VWAP ${fx(vwap)}`);
  }
  if (px > orHigh) {
    pts += 1;
    why.push(`above the opening range (${fx(orHigh)})`);
  } else if (px < orLow) {
    pts -= 1;
    why.push(`below the opening range (${fx(orLow)})`);
  } else why.push(`inside the opening range (${fx(orLow)}–${fx(orHigh)})`);
  if (closes.length >= 21) {
    const e9 = I.ema(closes, 9);
    const e21 = I.ema(closes, 21);
    const k = closes.length - 1;
    pts += e9[k] > e21[k] ? 1 : e9[k] < e21[k] ? -1 : 0;
    why.push(`5-min 9 EMA ${e9[k] > e21[k] ? "above" : "below"} 21 EMA`);
  }
  return {
    dir: pts >= 2 ? "up" : pts <= -2 ? "down" : "sideways",
    basis: why.join("; "),
    vwap: r2(vwap),
    orHigh: r2(orHigh),
    orLow: r2(orLow),
    dayHigh: r2(Math.max(...bars.map((b) => b.h))),
    dayLow: r2(Math.min(...bars.map((b) => b.l))),
    bars: bars.length,
  };
}

/* ------------------------------------------------------------- verdict */

const dirScore = (d) => (d === "up" ? 100 : d === "down" ? -100 : 0);
const want = (direction) => (direction === "bullish" ? "up" : direction === "bearish" ? "down" : "sideways");

/**
 * @param analysis      output of analyze() for the daily bars
 * @param candles       the daily bars (oldest first)
 * @param quote         live quote or null: { last, open, high, low, prevClose, upperCircuit, lowerCircuit, … }
 * @param intradayBars  today's 5-minute bars or null
 * @param inProgress    true when the newest daily bar is today's unfinished one
 * @param stale         true when the daily data could not be refreshed
 * @param priorBars     earlier days' 5-minute bars (warm-up for the intraday averages)
 * @param nowMs         the clock; without it there is no live intraday call
 */
function buildVerdict({ analysis: a, candles, quote = null, intradayBars = null, inProgress = false, stale = false, priorBars = [], nowMs = null, market = null, micro = null, fast = null }) {
  if (!a || !a.enoughData) return { available: false, reason: (a && a.message) || "Not enough price history for a verdict." };

  const n = candles.length;
  // the last COMPLETED session: yesterday while today's bar is still forming
  const done = inProgress && n >= 2 ? candles[n - 2] : candles[n - 1];
  const live = Boolean(quote && num(quote.last));
  const last = live ? quote.last : a.price.last;
  const atr = a.levels.atr ? a.levels.atr.value : null;
  if (!num(atr) || atr <= 0 || !num(last) || last <= 0) return { available: false, reason: "Volatility could not be measured for this stock yet." };

  // Sanity: a live price far from the saved history means the history is wrong for
  // today (a split, bonus or demerger re-bases every past price). Levels built on
  // it would be nonsense, so no verdict is better than a confident wrong one.
  const lastClose = candles[n - 1].c;
  if (live && Math.abs(last / lastClose - 1) > 0.3) {
    return {
      available: false,
      reason: `The live price (${fx(last)}) is ${Math.round(Math.abs(last / lastClose - 1) * 100)}% away from the last close in the saved history (${fx(lastClose)}). That usually means a split, bonus or other corporate action. No verdict until the price history has been refreshed and agrees.`,
    };
  }

  /* ---- 1. the three time frames */
  const weekly = weeklyTrend(candles);
  const daily = dailyTrend(a);
  const pic = intradayPicture(intradayBars, last);
  const intraday = pic ? frame("Intraday (5 min)", pic.dir, pic.basis) : frame("Intraday (5 min)", null, "No live intraday bars — the market is closed or data is not connected.");

  /* ---- 2. one number, then one word */
  const parts = [{ w: 0.5, v: a.score.value }];
  if (weekly.dir) parts.push({ w: 0.3, v: dirScore(weekly.dir) });
  if (intraday.dir) parts.push({ w: 0.2, v: dirScore(intraday.dir) });
  const composite = Math.round(parts.reduce((s, p) => s + p.w * p.v, 0) / parts.reduce((s, p) => s + p.w, 0));
  let direction = composite >= 25 ? "bullish" : composite <= -25 ? "bearish" : "neutral";
  // The daily chart is what gets traded. A higher or lower time frame can strengthen
  // or weaken its reading, but can never create a direction the daily chart lacks.
  let lean = "";
  if ((direction === "bullish" && a.score.value < DAILY_MIN) || (direction === "bearish" && a.score.value > -DAILY_MIN)) {
    lean = direction;
    direction = "neutral";
  }

  /* ---- 3. what argues against it */
  const against = [];
  const frames = [weekly, daily, intraday].filter((f) => f.dir);
  let conviction = Math.abs(composite);
  if (direction !== "neutral") {
    const opposite = direction === "bullish" ? "down" : "up";
    const opposing = frames.filter((f) => f.dir === opposite);
    opposing.forEach((f) => against.push(`${f.name} trend is ${f.label.toLowerCase()} — it disagrees with the ${direction} reading.`));
    conviction += frames.length >= 2 && frames.every((f) => f.dir === want(direction)) ? 15 : 0;
    conviction -= 15 * opposing.length;
  }
  const adx = a.indicators.adx;
  if (num(adx) && adx < 18) {
    conviction -= 10;
    against.push(`ADX is ${adx}: the daily chart has no real trend, so breakouts and trend signals fail more often.`);
  }
  const rsi = a.indicators.rsi14;
  if (direction === "bullish" && num(rsi) && rsi >= 72) against.push(`RSI is ${rsi} — already overbought. Late entries usually need a wide stop.`);
  if (direction === "bearish" && num(rsi) && rsi <= 28) against.push(`RSI is ${rsi} — already oversold. A snap-back rally is common from here.`);
  const res1 = a.levels.resistances.find((r) => r.price > last);
  const sup1 = a.levels.supports.find((s) => s.price < last);
  if (direction === "bullish" && res1 && res1.price - last < atr) against.push(`Resistance at ${fx(res1.price)} is less than one day's range (ATR ${fx(atr)}) above the price.`);
  if (direction === "bearish" && sup1 && last - sup1.price < atr) against.push(`Support at ${fx(sup1.price)} is less than one day's range below the price.`);
  if (num(a.liquidity.avgTurnoverCr) && a.liquidity.avgTurnoverCr < 5) against.push(`Thin trading (about ₹${a.liquidity.avgTurnoverCr} crore a day): entries and exits can slip.`);
  if (stale) {
    conviction -= 20;
    against.push("The price history could not be refreshed — this is based on saved data.");
  }
  if (inProgress) against.push("Today's daily bar is unfinished; the daily reading can change before the close.");
  if (!live) against.push("No live quote: levels are measured from the last close, not the current price.");
  if (live && num(quote.prevClose) && quote.prevClose > 0) {
    // the exchange's previous close should be one of the last two closes in the history
    const near = (x) => Math.abs(quote.prevClose / x - 1) < 0.01;
    if (!near(lastClose) && !(n >= 2 && near(candles[n - 2].c))) {
      conviction -= 15;
      against.push(`The exchange's previous close (${fx(quote.prevClose)}) does not match the saved price history (${fx(done.c)}). Prices may have been re-based by a corporate action, or a session is missing — treat every level here with suspicion.`);
    }
  }

  /* ---- 4. circuit limits */
  const circuit = live && num(quote.upperCircuit) && num(quote.lowerCircuit) && quote.upperCircuit > quote.lowerCircuit
    ? {
        upper: r2(quote.upperCircuit),
        lower: r2(quote.lowerCircuit),
        toUpperPct: pctOf(quote.upperCircuit, last),
        toLowerPct: pctOf(quote.lowerCircuit, last),
        positionPct: r2(((last - quote.lowerCircuit) / (quote.upperCircuit - quote.lowerCircuit)) * 100),
      }
    : null;
  if (circuit && circuit.toUpperPct !== null && circuit.toUpperPct < 2) {
    conviction -= 10;
    against.push(`Only ${circuit.toUpperPct}% below the upper circuit (${circuit.upper}). Buyers have little room, and a short can be trapped if it locks.`);
  }
  if (circuit && circuit.toLowerPct !== null && circuit.toLowerPct > -2) {
    conviction -= 10;
    against.push(`Only ${Math.abs(circuit.toLowerPct)}% above the lower circuit (${circuit.lower}). If it locks there, sellers cannot exit.`);
  }
  // no direction, no conviction: a half-full meter beside "Neutral" would only mislead
  conviction = direction === "neutral" ? 0 : Math.round(clamp(conviction, 0, 100));
  const convictionLabel = direction === "neutral" ? "No edge" : conviction >= 65 ? "High" : conviction >= 40 ? "Medium" : "Low";

  /* ---- 5. pivots from the last completed session */
  const pv = I.pivots(done);

  /* ---- 6. swing plan (delivery, long only) */
  const active = a.setups.find((s) => s.triggered && s.plan);
  const ma = a.levels.movingAverages;
  let swing;
  if (direction === "bullish") {
    let entry;
    let stop;
    let basis;
    if (active) {
      entry = active.plan.entryRef;
      stop = active.plan.stop;
      basis = `Setup active: ${active.name}. ${active.plan.exitRule}`;
    } else {
      entry = tick(Math.max(a.price.high, last) + TICK);
      stop = entry - 1.5 * atr;
      const s = a.levels.supports.find((x) => x.price < entry - 0.4 * atr && x.price > entry - 2.5 * atr);
      if (s) stop = s.price - 0.25 * atr;
      stop = tick(stop);
      basis = `No setup has triggered. Strength is confirmed only if price trades above ${fx(entry)} (the latest high); the stop sits ${s ? `just under support at ${fx(s.price)}` : "1.5 ATR below"}.`;
    }
    const risk = entry - stop;
    const resistance = a.levels.resistances.find((r) => r.price > entry);
    const extended = num(ma.ema20) && last - ma.ema20 > atr;
    swing = {
      action: active ? "buy-setup" : "buy-on-trigger",
      headline: active ? `Buy setup is active — ${active.name}` : `Bullish, but wait: buy only above ${fx(entry)}`,
      basis,
      entry: r2(entry),
      stop: r2(stop),
      riskPerShare: r2(risk),
      riskPct: r2((risk / entry) * 100),
      targets: [1, 2, 3].map((m) => ({ r: m, price: r2(entry + m * risk) })),
      firstResistance: resistance ? { price: r2(resistance.price), rewardToRisk: r2((resistance.price - entry) / risk) } : null,
      pullbackZone: extended ? { low: r2(ma.ema20), high: r2(ma.ema20 + 0.5 * atr), note: `Price is ${fx((last - ma.ema20) / atr)} ATRs above its 20 EMA. A dip into this zone is a lower-risk entry than chasing.` } : null,
      invalidBelow: num(ma.ema50) && ma.ema50 < entry ? r2(ma.ema50) : r2(stop),
      invalidNote: num(ma.ema50) && ma.ema50 < entry ? "A daily close below the 50 EMA ends the bullish case." : "A close below the stop ends the bullish case.",
    };
    if (swing.firstResistance && swing.firstResistance.rewardToRisk < 1.5) {
      against.push(`Reward to first resistance is only ${swing.firstResistance.rewardToRisk}× the risk — thin for a swing trade.`);
    }
  } else if (direction === "bearish") {
    swing = {
      action: "avoid",
      headline: "No fresh longs — stay out or follow your exit rule",
      basis: "The weight of evidence is down. Delivery trades are long-only, so the instruction is to avoid, not to short.",
      holdersExitBelow: sup1 ? r2(sup1.price) : r2(a.indicators.low20),
      holdersNote: sup1 ? `If you hold it: a close below support at ${fx(sup1.price)} is the next warning.` : "If you hold it: a close below the 20-day low is the next warning.",
      improvesAbove: num(ma.ema50) ? r2(ma.ema50) : r2(a.indicators.high20),
      improvesNote: num(ma.ema50) ? "The picture improves only on a daily close back above the 50 EMA." : "The picture improves only above the 20-day high.",
    };
  } else {
    swing = {
      action: "wait",
      headline: "No edge — stand aside",
      basis: lean
        ? `Other time frames lean ${lean}, but the daily chart itself shows no edge (daily score ${a.score.value}). A direction is not called on a flat daily chart. Not trading is a position.`
        : "The time frames do not agree and the score is close to zero. Not trading is a position.",
      bullishAbove: r2(a.indicators.high20),
      bearishBelow: r2(a.indicators.low20),
      note: "A close above the 20-day high or below the 20-day low is what would create a direction.",
    };
  }

  /* ---- 7. intraday plan (long or short, same-day) */
  const usingOpeningRange = Boolean(pic);
  const refHigh = usingOpeningRange ? pic.orHigh : done.h;
  const refLow = usingOpeningRange ? pic.orLow : done.l;
  const longEntry = tick(refHigh + TICK);
  const shortEntry = tick(refLow - TICK);
  const half = 0.5 * atr;

  const capUp = circuit ? circuit.upper * 0.998 : Infinity;
  const capDown = circuit ? circuit.lower * 1.002 : -Infinity;
  let longTargets = [pv.r1, pv.r2, pv.r3].filter((x) => x > longEntry + 0.2 * atr);
  if (longTargets.length === 0) longTargets = [longEntry + half, longEntry + atr];
  let shortTargets = [pv.s1, pv.s2, pv.s3].filter((x) => x < shortEntry - 0.2 * atr && x > 0);
  if (shortTargets.length === 0) shortTargets = [shortEntry - half, shortEntry - atr].filter((x) => x > 0);
  const longClipped = longTargets.some((x) => x >= capUp);
  const shortClipped = shortTargets.some((x) => x <= capDown);
  longTargets = longTargets.filter((x) => x < capUp).slice(0, 3);
  shortTargets = shortTargets.filter((x) => x > capDown).slice(0, 3);

  const vwapSide = pic && num(pic.vwap) ? (last >= pic.vwap ? "long" : "short") : null;
  let preferred = "either";
  if (direction === "bullish" && vwapSide !== "short") preferred = "long";
  else if (direction === "bearish" && vwapSide !== "long") preferred = "short";

  const intradayPlan = {
    basedOn: usingOpeningRange ? "today's opening range (first 15 minutes)" : `the last completed session (${done.t})`,
    forSession: usingOpeningRange ? "today" : "the next session",
    preferred,
    preferredNote:
      preferred === "long"
        ? "Take only the long trigger; ignore the short side today."
        : preferred === "short"
          ? "Take only the short trigger; ignore the long side. A cash-market short must be closed the same day."
          : "No preferred side: the daily bias and the intraday picture do not line up. If trading the break at all, use smaller size.",
    state: live ? (last > longEntry ? "above-long" : last < shortEntry ? "below-short" : "between") : "unknown",
    // the stop is always at least one tick away, even on a very low-priced share
    long: {
      entry: r2(longEntry),
      stop: r2(Math.min(tick(longEntry - half), longEntry - TICK)),
      riskPerShare: r2(half),
      targets: longTargets.map(r2),
      note: longClipped ? "Targets beyond the upper circuit were removed." : "",
    },
    short: {
      entry: r2(shortEntry),
      stop: r2(Math.max(tick(shortEntry + half), shortEntry + TICK)),
      riskPerShare: r2(half),
      targets: shortTargets.map(r2),
      note: shortClipped ? "Targets beyond the lower circuit were removed." : "",
    },
    vwap: pic ? pic.vwap : null,
    stopRule: `Stops are half the average daily range (ATR ${fx(atr)}) from the trigger.`,
  };

  /* ---- 8. how far it has moved, how far it usually moves */
  const dayHigh = live && num(quote.high) ? quote.high : pic ? pic.dayHigh : null;
  const dayLow = live && num(quote.low) ? quote.low : pic ? pic.dayLow : null;
  const movement = {
    atr: r2(atr),
    atrPct: r2((atr / last) * 100),
    expectedLow: r2((live && num(quote.prevClose) ? quote.prevClose : done.c) - atr),
    expectedHigh: r2((live && num(quote.prevClose) ? quote.prevClose : done.c) + atr),
    gapPct: live && num(quote.open) && num(quote.prevClose) ? pctOf(quote.open, quote.prevClose) : null,
    dayHigh: r2(dayHigh),
    dayLow: r2(dayLow),
    rangeUsedPct: num(dayHigh) && num(dayLow) ? Math.round(((dayHigh - dayLow) / atr) * 100) : null,
    relVolume: a.indicators.relVolume,
  };
  if (movement.rangeUsedPct !== null && movement.rangeUsedPct >= 100) {
    against.push(`Today's range is already ${movement.rangeUsedPct}% of a normal day (ATR). Fresh breakouts this late have less room.`);
  }

  /* ---- 9. the ladder: every level, top to bottom */
  const rungs = [];
  const add = (label, price, kind) => {
    if (num(price) && price > 0) rungs.push({ label, price: r2(price), kind, awayPct: pctOf(price, last) });
  };
  if (circuit) {
    add("Upper circuit", circuit.upper, "circuit");
    add("Lower circuit", circuit.lower, "circuit");
  }
  add("R3", pv.r3, "pivot");
  add("R2", pv.r2, "pivot");
  add("R1", pv.r1, "pivot");
  add("Pivot", pv.p, "pivot");
  add("S1", pv.s1, "pivot");
  add("S2", pv.s2, "pivot");
  add("S3", pv.s3, "pivot");
  add("CPR top", pv.cprTop, "pivot");
  add("CPR bottom", pv.cprBottom, "pivot");
  a.levels.resistances.forEach((x) => add(`Resistance (${x.touches}×)`, x.price, "resistance"));
  a.levels.supports.forEach((x) => add(`Support (${x.touches}×)`, x.price, "support"));
  add("52-week high", a.levels.week52.high, "resistance");
  add("52-week low", a.levels.week52.low, "support");
  add("Previous day high", done.h, "ref");
  add("Previous day low", done.l, "ref");
  add("Previous close", done.c, "ref");
  if (num(dayHigh)) add("Day high", dayHigh, "ref");
  if (num(dayLow)) add("Day low", dayLow, "ref");
  if (pic) {
    add("VWAP", pic.vwap, "ref");
    add("Opening range high", pic.orHigh, "ref");
    add("Opening range low", pic.orLow, "ref");
  }
  add("20 EMA", ma.ema20, "ma");
  add("50 EMA", ma.ema50, "ma");
  add("200 EMA", ma.ema200, "ma");
  add(live ? "Last price" : "Last close", last, "price");
  rungs.sort((x, y) => y.price - x.price || (x.kind === "price" ? -1 : 1));

  /* ---- 10. the live intraday call (same-day) and the long-term view (months to years) */
  const completed = inProgress ? candles.slice(0, -1) : candles;
  const vols = completed.slice(-20).map((c) => c.v).filter((x) => num(x) && x > 0);
  const avgVolume = vols.length ? vols.reduce((s, x) => s + x, 0) / vols.length : null;
  const day = num(nowMs)
    ? liveCall({ bars: intradayBars, prior: priorBars, quote, atr, done, pivots: pv, circuit, nowMs, dailyDirection: direction, avgVolume, market, micro, fast })
    : { available: false, reason: "No clock was supplied, so there is no live call.", session: null };
  const longTerm = longTermView(candles, a, last);

  const summary =
    direction === "bullish"
      ? `Bullish${convictionLabel === "Low" ? ", weakly" : ""}. ${swing.headline}.`
      : direction === "bearish"
        ? `Bearish${convictionLabel === "Low" ? ", weakly" : ""}. No delivery longs; shorts are intraday-only in the cash market.`
        : "Neutral. The evidence does not point one way — the disciplined trade is no trade.";

  return {
    available: true,
    direction,
    stance: direction === "bullish" ? "Bullish" : direction === "bearish" ? "Bearish" : "Neutral",
    composite,
    conviction,
    convictionLabel,
    summary,
    live,
    last: r2(last),
    asOf: a.asOf,
    completedSession: done.t,
    frames: [weekly, daily, intraday],
    dailyScore: a.score.value,
    swing,
    intraday: intradayPlan,
    day,
    longTerm,
    circuit,
    movement,
    ladder: rungs,
    against,
    activeSetups: a.setups.filter((s) => s.triggered).map((s) => s.name),
    warnings: a.bearish.filter((b) => b.barsAgo <= 1).map((b) => b.name),
  };
}

module.exports = { buildVerdict, toWeekly, weekStart, weeklyTrend, intradayPicture };
