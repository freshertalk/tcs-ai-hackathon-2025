"use strict";
// The Next-Session Outlook: a deterministic read of what the next trading day may bring for one
// stock, from its daily history and the readings the desk already has — no AI, no network, no
// clock, no order.
//
// It sits ON TOP of the research direction (direction.js, every lens weighed) and the Advisor's
// measured odds (edge.js): both enter below as components, so nothing is replaced. What it adds
// is the next session's shape:
//   the lean         trend, momentum, how the last session closed, three-day drift, candles,
//                    stretch (a stock far from its average is more likely to pause), and the
//                    forward-tested odds of the days that looked most like today
//   the range        where a normal day from here would trade (volatility, not direction)
//   the gap          how this stock usually opens: size, direction, and how often it is filled
//   the levels       tomorrow's pivots, the last session's high and low
//   both plans       a long and a short, each with a trigger, a stop where the idea is wrong, and
//                    targets at real levels — plus if-then scenarios for the first half hour
//
// Every component votes between −1 and +1 with a weight; the lean is the weighted sum and the
// confidence is how much weight agrees. Weak or split evidence reads "neutral". It is a summary of
// evidence — not a forecast, not advice, and never a promise of profit.

const I = require("./indicators");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TICK = 0.05;
const onTick = (x) => (num(x) ? r2(Math.round(x / TICK) * TICK) : null);
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

const W = { direction: 2, trend: 1.5, odds: 1.5, momentum: 1, session: 1, drift: 0.75, candles: 0.5, stretch: 1 };

/**
 * @param candles    daily bars, oldest first: { t, o, h, l, c, v }
 * @param forming    true when the newest bar is today's and still being written
 * @param direction  buildDirection(...) output, or null
 * @param edge       market.edge(symbol) output, or null
 */
function buildOutlook({ candles, forming = false, direction = null, edge = null }) {
  if (!Array.isArray(candles) || candles.length < 40) return { available: false, reason: "Fewer than 40 daily bars: not enough history for an outlook." };
  const done = forming ? candles.slice(0, -1) : candles; // the last COMPLETED session
  const L = done[done.length - 1];
  const prev = done[done.length - 2];
  const closes = done.map((c) => c.c);
  const k = closes.length - 1;
  const atrArr = I.atr(done, 14);
  const atr = atrArr[k];
  if (!num(atr) || atr <= 0) return { available: false, reason: "The daily bars have no range to measure." };

  const comps = [];
  const add = (id, label, w, v, why) => comps.push({ id, label, weight: w, vote: r2(clamp(v, -1, 1)), why });

  /* the research direction and the measured odds: both already exist and enter whole */
  if (direction && direction.available && num(direction.score)) add("direction", "Research direction", W.direction, clamp(direction.score / 100, -1, 1), `${direction.label}: ${direction.why}`);
  const fwd = edge && edge.available && edge.kinds && edge.kinds.swing && edge.kinds.swing.forward ? edge.kinds.swing.forward.d1 : null;
  if (fwd && num(fwd.upPct)) add("odds", "Days like today (next session)", W.odds, clamp((fwd.upPct - 50) / 25, -1, 1) * clamp(Math.abs(fwd.avgPct || 0) / 0.3 + 0.4, 0.4, 1), `after the days it most resembled, the next session closed up ${fwd.upPct}% of the time, averaging ${fwd.avgPct >= 0 ? "+" : ""}${fwd.avgPct}%`);

  /* trend: the averages, and their order */
  const e20 = I.ema(closes, 20)[k];
  const e50 = I.ema(closes, 50)[k];
  const e200 = closes.length >= 200 ? I.ema(closes, 200)[k] : null;
  let tv = 0;
  const tw = [];
  if (num(e20)) {
    tv += L.c > e20 ? 0.35 : -0.35;
    tw.push(L.c > e20 ? "above the 20-day average" : "below the 20-day average");
  }
  if (num(e50)) {
    tv += L.c > e50 ? 0.3 : -0.3;
    if (num(e20)) tv += e20 > e50 ? 0.15 : -0.15;
  }
  if (num(e200)) tv += L.c > e200 ? 0.2 : -0.2;
  add("trend", "Trend", W.trend, tv, `${tw.join(", ")}${num(e50) ? `; ${L.c > e50 ? "above" : "below"} the 50-day` : ""}${num(e200) ? `; ${L.c > e200 ? "above" : "below"} the 200-day` : ""}`);

  /* momentum: RSI level and direction, MACD histogram */
  const rs = I.rsi(closes, 14);
  const rsi = rs[k];
  const rsiThen = rs[k - 3];
  const mc = I.macd(closes);
  const hist = mc && mc.hist ? mc.hist[k] : null;
  const histThen = mc && mc.hist ? mc.hist[k - 2] : null;
  if (num(rsi)) {
    let v = clamp((rsi - 50) / 25, -1, 1) * 0.5 + (num(rsiThen) ? clamp((rsi - rsiThen) / 15, -1, 1) * 0.25 : 0);
    if (num(hist)) v += (hist > 0 ? 0.15 : -0.15) + (num(histThen) && hist > histThen ? 0.1 : num(histThen) ? -0.1 : 0);
    add("momentum", "Momentum", W.momentum, v, `RSI ${Math.round(rsi)}${num(rsiThen) ? ` (${rsi >= rsiThen ? "rising" : "falling"})` : ""}${num(hist) ? `; MACD histogram ${hist > 0 ? "positive" : "negative"}${num(histThen) ? (hist > histThen ? " and rising" : " and falling") : ""}` : ""}`);
  }

  /* how the last session closed: near its high (buyers held on) or its low, and on what volume */
  const range = L.h - L.l;
  if (range > 0) {
    const place = (L.c - L.l) / range; // 0 = closed on the low, 1 = on the high
    const body = (L.c - L.o) / range;
    const v20 = done.slice(-21, -1).reduce((s, c) => s + (c.v || 0), 0) / 20;
    const volX = v20 > 0 ? L.v / v20 : null;
    const loud = num(volX) ? clamp(volX, 0.6, 1.8) / 1.2 : 1;
    add("session", "Last session's close", W.session, (clamp((place - 0.5) * 2, -1, 1) * 0.6 + clamp(body, -1, 1) * 0.4) * loud, `closed ${Math.round(place * 100)}% of the way up its range${num(volX) ? ` on ${volX.toFixed(1)}× the usual volume` : ""}`);
  }

  /* three-day drift against a normal daily move */
  if (k >= 3) {
    const d3 = L.c - closes[k - 3];
    add("drift", "Three-day drift", W.drift, clamp(d3 / (atr * 1.8), -1, 1), `${pct(L.c, closes[k - 3]) >= 0 ? "+" : ""}${r2(pct(L.c, closes[k - 3]))}% in three sessions`);
  }

  /* candles that completed on the last session */
  const pats = I.candlePatterns(done, k).filter((p) => p.bias !== "neutral");
  if (pats.length) add("candles", "Candle pattern", W.candles, clamp(pats.reduce((s, p) => s + (p.bias === "bullish" ? 1 : -1), 0), -1, 1), pats.map((p) => p.name).join(", "));

  /* stretch: far from the 20-day average, or at an extreme RSI, is more likely to pause than to run */
  if (num(e20)) {
    const away = (L.c - e20) / atr; // in daily ranges
    let v = 0;
    if (away > 2.5) v = -clamp((away - 2.5) / 2, 0, 1);
    else if (away < -2.5) v = clamp((-away - 2.5) / 2, 0, 1);
    if (num(rsi) && rsi >= 80) v -= 0.4;
    else if (num(rsi) && rsi <= 20) v += 0.4;
    if (v !== 0) add("stretch", "Stretch", W.stretch, v, `${away >= 0 ? "+" : ""}${away.toFixed(1)} daily ranges from the 20-day average${num(rsi) && (rsi >= 80 || rsi <= 20) ? `; RSI ${Math.round(rsi)}` : ""} — stretched moves tend to pause`);
  }

  /* ------------------------------------------------------------------- the lean and its agreement */
  const wsum = comps.reduce((s, c) => s + c.weight, 0);
  const lean = wsum ? comps.reduce((s, c) => s + c.vote * c.weight, 0) / wsum : 0;
  const score = Math.round(lean * 100);
  const side = Math.sign(score);
  const agreeW = side === 0 ? 0 : comps.filter((c) => Math.sign(c.vote) === side && Math.abs(c.vote) >= 0.1).reduce((s, c) => s + c.weight, 0);
  const againstW = side === 0 ? 0 : comps.filter((c) => Math.sign(c.vote) === -side && Math.abs(c.vote) >= 0.1).reduce((s, c) => s + c.weight, 0);
  const agreement = wsum ? Math.round((agreeW / wsum) * 100) : 0;
  const confidence = clamp(Math.round(agreement * (Math.min(Math.abs(score), 50) / 50) * 0.5 + agreement * 0.5), 0, 100);
  const gates = [];
  if (againstW > 0 && againstW >= agreeW * 0.8 && agreeW > 0) gates.push("The evidence is split: nearly as much weight points the other way.");
  const leanWord = score >= 22 ? "up" : score <= -22 ? "down" : "sideways";
  const strong = Math.abs(score) >= 22 && agreement >= 60 && gates.length === 0;
  const call = !strong ? "neutral" : score > 0 ? "long-bias" : "short-bias";

  /* ------------------------------------------------------------------------------ the levels */
  const pv = I.pivots({ h: L.h, l: L.l, c: L.c }) || null;
  const lean20 = (score / 100) * 0.12 * atr; // a lean tilts the middle of the range, a little
  const range1 = { low: onTick(L.c + lean20 - 0.6 * atr), high: onTick(L.c + lean20 + 0.6 * atr), atr: r2(atr), basis: "a normal day from the last close: about 0.6 of the 14-day average range each way, tilted slightly toward the lean — how far it may travel, not which way" };

  /* how this stock opens: size, direction, and whether the gap is filled by the close */
  const win = done.slice(-61);
  let gaps = 0;
  let up = 0;
  let sum = 0;
  let filled = 0;
  let big = 0;
  for (let i = 1; i < win.length; i += 1) {
    const g = pct(win[i].o, win[i - 1].c);
    if (!num(g)) continue;
    gaps += 1;
    sum += Math.abs(g);
    if (g > 0) up += 1;
    if (Math.abs(g) >= 0.5) {
      big += 1;
      if (g > 0 ? win[i].l <= win[i - 1].c : win[i].h >= win[i - 1].c) filled += 1;
    }
  }
  const gap = gaps >= 20 ? { sessions: gaps, avgAbsPct: r2(sum / gaps), upPct: Math.round((up / gaps) * 100), bigGapPct: Math.round((big / gaps) * 100), filledPct: big >= 5 ? Math.round((filled / big) * 100) : null, note: big >= 5 ? `Gaps of 0.5% or more were filled during the day ${Math.round((filled / big) * 100)}% of the time (${big} gaps in ${gaps} sessions).` : `Few gaps of 0.5% or more (${big} in ${gaps} sessions).` } : null;

  /* ---------------------------------------------------------------------- plans for both sides */
  const plans = {};
  const res = pv ? [pv.r1, pv.r2, pv.r3].filter(num) : [];
  const sup = pv ? [pv.s1, pv.s2, pv.s3].filter(num) : [];
  const stopMin = 0.3 * atr;
  {
    const entry = onTick(Math.max(L.h, pv ? pv.p : L.h) + 0.05 * atr);
    let stop = Math.min(L.l, pv ? pv.p - 0.25 * atr : L.l);
    if (entry - stop < stopMin) stop = entry - stopMin;
    if (entry - stop > 1.2 * atr) stop = entry - 1.2 * atr;
    const risk = entry - stop;
    const tg = res.filter((p) => p > entry + 1.1 * risk).slice(0, 2); // a pivot counts only if it pays at least 1.1× the risk
    while (tg.length < 2) tg.push(entry + (tg.length + 1) * risk * 1.2);
    plans.long = { side: "long", trigger: `Trade above ${r2(entry)} (the last session's high / pivot) after the first 15 minutes`, entry, stop: onTick(stop), targets: tg.map(onTick), riskPerShare: r2(risk), riskPct: r2((risk / entry) * 100), rewardToRisk: r2((tg[0] - entry) / risk), invalidation: `Back below ${onTick(stop)}` };
  }
  {
    const entry = onTick(Math.min(L.l, pv ? pv.p : L.l) - 0.05 * atr);
    let stop = Math.max(L.h, pv ? pv.p + 0.25 * atr : L.h);
    if (stop - entry < stopMin) stop = entry + stopMin;
    if (stop - entry > 1.2 * atr) stop = entry + 1.2 * atr;
    const risk = stop - entry;
    const tg = sup.filter((p) => p < entry - 1.1 * risk).slice(0, 2);
    while (tg.length < 2) tg.push(entry - (tg.length + 1) * risk * 1.2);
    plans.short = { side: "short", trigger: `Trade below ${r2(entry)} (the last session's low / pivot) after the first 15 minutes — intraday only`, entry, stop: onTick(stop), targets: tg.map(onTick), riskPerShare: r2(risk), riskPct: r2((risk / entry) * 100), rewardToRisk: r2((entry - tg[0]) / risk), invalidation: `Back above ${onTick(stop)}` };
  }

  const scenarios = [
    { if: `It opens above ${r2(L.h)} and holds above it through the first 15 minutes`, then: leanWord === "down" ? "A gap up against the lean often fades: wait for a failed hold before thinking short." : `The long plan is live (entry ${plans.long.entry}, stop ${plans.long.stop}).` },
    { if: `It opens below ${r2(L.l)} and stays below it through the first 15 minutes`, then: leanWord === "up" ? "A gap down against the lean often recovers: wait for a failed break before thinking long." : `The short plan is live (entry ${plans.short.entry}, stop ${plans.short.stop}) — intraday only.` },
    { if: `It trades inside ${r2(L.l)}–${r2(L.h)} for the first half hour`, then: "No edge yet: let the opening range form (9:15–9:30) and trade the break, or leave it." },
  ];
  if (gap && gap.filledPct !== null && gap.filledPct >= 60) scenarios.push({ if: "It opens with a gap of 0.5% or more", then: `This stock filled such gaps ${gap.filledPct}% of the time: fading the gap back toward ${r2(L.c)} has been the better habit than chasing it.` });

  return {
    available: true,
    asOf: L.t,
    last: r2(L.c),
    forming: Boolean(forming),
    call, // "long-bias" | "short-bias" | "neutral"
    lean: leanWord,
    score,
    confidence,
    agreement,
    headline:
      call === "long-bias"
        ? `Next session leans UP (${agreement}% of the evidence agrees)`
        : call === "short-bias"
          ? `Next session leans DOWN (${agreement}% of the evidence agrees)`
          : gates.length
            ? `Leans ${leanWord.toUpperCase()}, but the evidence is split`
            : leanWord === "sideways"
              ? "No clear lean for the next session"
              : `Leans ${leanWord.toUpperCase()}, not strongly enough to call (${agreement}% agree)`,
    gates,
    components: comps,
    range: range1,
    gap,
    pivots: pv ? { p: onTick(pv.p), r1: onTick(pv.r1), r2: onTick(pv.r2), r3: onTick(pv.r3), s1: onTick(pv.s1), s2: onTick(pv.s2), s3: onTick(pv.s3) } : null,
    lastSession: { date: L.t, open: r2(L.o), high: r2(L.h), low: r2(L.l), close: r2(L.c), prevClose: prev ? r2(prev.c) : null, changePct: prev ? r2(pct(L.c, prev.c)) : null },
    plans,
    scenarios,
    rule: "Each component votes between −1 and +1 with a fixed weight; the lean is their weighted sum and confidence is how much of the weight agrees. A lean of ±22 with 60% agreement and no split is a bias; anything else is neutral. It uses the research direction and the measured odds as two of its components. Agreement is not a probability of profit.",
  };
}

module.exports = { buildOutlook, W };
