"use strict";
// The Live Pulse: a deterministic read of where one stock is heading over the next 15–30 minutes,
// from the live session's own numbers — no AI, no network, no clock, no order.
//
// It sits ON TOP of the desk's existing live call (intraday.js liveCall): that call's score is one
// of the components below, so nothing is replaced. What it adds is the short window — the last
// 15 and 30 minutes — looked at six more ways:
//   momentum     how far, and how fast, price moved in 15 and 30 minutes, against a normal 5-minute move
//   VWAP         which side of the day's fair price, and whether it just reclaimed or lost it
//   structure    higher highs / higher lows (or the reverse) on the 1-minute tape
//   volume       is the move on rising volume, and do the up bars carry more of it than the down bars
//   RSI          rising from a healthy level, or stretched (stretched counts against the move)
//   candles      the patterns that closed in the last three 5-minute bars
//   opening range  broken, and held
//   order flow   the five-level book and signed volume, when the tick stream has them
//
// Each component votes between -1 (down) and +1 (up) with a weight. The weighted sum is the lean,
// and how much of the weight AGREES with the lean is the confidence — agreement, not a
// probability of profit. Where the evidence is thin or split the answer is "wait", which is a
// position. A window of expected movement (volatility, not direction) is given alongside.
//
// Plans for BOTH directions are always produced so the trader sees the long and the short side;
// which one (if either) is called depends on the lean. Nothing here can promise a winning trade.

const I = require("./indicators");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TICK = 0.05;
const onTick = (x) => (num(x) ? r2(Math.round(x / TICK) * TICK) : null);
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

const W = { engine: 2, momentum: 2, vwap: 1.5, structure: 1, volume: 1, rsi: 1, candles: 0.75, orb: 1, flow: 0.75 };

/** True range of 5-minute bars: a normal move of one bar, the yardstick for everything else. */
function atr5(bars, n = 12) {
  const rows = bars.slice(-(n + 1));
  if (rows.length < 3) return null;
  let s = 0;
  let k = 0;
  for (let i = 1; i < rows.length; i += 1) {
    s += Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
    k += 1;
  }
  return k ? s / k : null;
}

/**
 * @param day     verdict.day — the desk's live call and its movement block (must be available)
 * @param bars5   today's 5-minute bars as the tape gives them: { t, o, h, l, c, v, w }
 * @param fast    the 1-minute read (verdict.day.fast or tape.fast), or null
 * @param flow    market.flowSnapshot(symbol), or null
 * @param account { position, funds } read-only, or null
 */
function buildPulse({ day, bars5 = [], fast = null, flow = null, account = null, riskPct = 1 }) {
  if (!day || !day.available) return { available: false, reason: (day && day.reason) || "The live session is not available: it needs the market open and Zerodha connected." };
  const m = day.movement;
  const last = m.last;
  const closed = bars5.length > 1 ? bars5.slice(0, -1) : bars5; // the newest bar is still forming
  if (bars5.length < 4) return { available: false, reason: "Fewer than four 5-minute bars so far: too early for a 15–30 minute read." };

  const a5 = atr5(bars5) || (m.atr ? m.atr / 8 : null);
  if (!num(a5) || a5 <= 0) return { available: false, reason: "The recent bars have no range to measure." };
  const comps = [];
  const add = (id, label, w, v, why) => comps.push({ id, label, weight: w, vote: r2(clamp(v, -1, 1)), why });
  const k = bars5.length - 1;
  const closeAt = (n) => (k - n >= 0 ? bars5[k - n].c : null);
  const m15 = num(m.m15Pct) ? m.m15Pct : pct(last, closeAt(3));
  const m30 = num(m.m30Pct) ? m.m30Pct : pct(last, closeAt(6));
  const move15 = num(closeAt(3)) ? last - closeAt(3) : null;
  const move30 = num(closeAt(6)) ? last - closeAt(6) : null;

  /* 1. the desk's own live call (every factor it already weighs) */
  const eng = num(day.score) ? clamp(day.score / 100, -1, 1) * (day.state === "wait" || day.state === "no-trade" ? 0.5 : 1) : 0;
  add("engine", "Desk live call", W.engine, eng, `${day.headline} (score ${day.score})`);

  /* 2. momentum over 15 and 30 minutes, in units of a normal 5-minute move */
  if (num(move15) || num(move30)) {
    const u15 = num(move15) ? move15 / (a5 * 1.7) : 0; // three bars of drift ≈ 1.7 bar-ranges is a clear push
    const u30 = num(move30) ? move30 / (a5 * 2.4) : 0;
    const v = clamp(0.6 * u15 + 0.4 * u30, -1, 1);
    // the same direction in both windows is momentum; opposite directions is a turn, and counts for less
    const mixed = num(move15) && num(move30) && Math.sign(move15) !== Math.sign(move30) && Math.abs(move15) > a5 * 0.5;
    add("momentum", "Momentum 15 / 30 min", W.momentum, mixed ? v * 0.5 : v, `${num(m15) ? `${m15 >= 0 ? "+" : ""}${m15.toFixed(2)}%` : "—"} in 15 min, ${num(m30) ? `${m30 >= 0 ? "+" : ""}${m30.toFixed(2)}%` : "—"} in 30 min${mixed ? " (the windows disagree: a turn)" : ""}`);
  }

  /* 3. VWAP: the side, and a fresh cross in the last 30 minutes */
  const withW = bars5.filter((b) => num(b.w));
  if (withW.length >= 3 && num(m.vwap)) {
    const dist = pct(last, m.vwap);
    let crosses = 0;
    let lastCross = null;
    const tail = withW.slice(-7);
    for (let i = 1; i < tail.length; i += 1) {
      const was = tail[i - 1].c >= tail[i - 1].w;
      const now = tail[i].c >= tail[i].w;
      if (was !== now) {
        crosses += 1;
        lastCross = now ? "reclaimed" : "lost";
      }
    }
    let v = clamp(dist / 0.4, -1, 1); // 0.4% beyond VWAP is a firm side
    if (crosses >= 3) v *= 0.3; // chopping through VWAP is no side at all
    else if (lastCross && crosses === 1) v += lastCross === "reclaimed" ? 0.3 : -0.3;
    add("vwap", "VWAP", W.vwap, v, `${dist >= 0 ? "+" : ""}${num(dist) ? dist.toFixed(2) : "—"}% from VWAP ₹${r2(m.vwap)}${crosses >= 3 ? `; crossed ${crosses} times in 30 min (choppy)` : lastCross ? `; ${lastCross} it in the last 30 min` : ""}`);
  }

  /* 4. structure on the 1-minute tape */
  if (fast && fast.available) {
    const s = String(fast.structure || "");
    let v = 0;
    if (/higher highs and higher lows/.test(s)) v = 1;
    else if (/lower highs and lower lows/.test(s)) v = -1;
    else if (/higher lows/.test(s)) v = 0.5;
    else if (/lower highs/.test(s)) v = -0.5;
    if (/^up/.test(fast.trend)) v += 0.25;
    else if (/^down/.test(fast.trend)) v -= 0.25;
    add("structure", "1-minute structure", W.structure, v, `${fast.structure}; trend ${fast.trend}`);
  }

  /* 5. volume: is the move on volume, and who carries it */
  const vols = bars5.map((b) => b.v || 0);
  const total = vols.reduce((s, x) => s + x, 0);
  const avgBar = total / vols.length;
  const recent3 = vols.slice(-3).reduce((s, x) => s + x, 0) / 3;
  const surge = avgBar > 0 ? recent3 / avgBar : null;
  const win = bars5.slice(-6);
  let upVol = 0;
  let downVol = 0;
  for (const b of win) (b.c >= b.o ? (upVol += b.v || 0) : (downVol += b.v || 0));
  if (upVol + downVol > 0) {
    const tilt = (upVol - downVol) / (upVol + downVol); // +1: all the volume on up bars
    const loud = num(surge) ? clamp(surge, 0.4, 1.8) / 1.2 : 0.8; // quiet moves count for less
    add("volume", "Volume", W.volume, tilt * loud, `${num(surge) ? `last 15 min at ${surge.toFixed(1)}× the session's bar volume; ` : ""}${Math.round((upVol / (upVol + downVol)) * 100)}% of the last 30 min's volume on up bars`);
  }

  /* 6. RSI of the 5-minute closes: where, and which way */
  const closes = bars5.map((b) => b.c);
  closes[closes.length - 1] = last;
  const rs = closes.length >= 16 ? I.rsi(closes, 14) : null;
  const rsiNow = rs ? rs[rs.length - 1] : m.rsi5;
  const rsiThen = rs && rs.length > 4 ? rs[rs.length - 4] : null;
  if (num(rsiNow)) {
    const slope = num(rsiThen) ? rsiNow - rsiThen : 0;
    let v = clamp((rsiNow - 50) / 25, -1, 1) * 0.6 + clamp(slope / 15, -1, 1) * 0.4;
    // stretched readings fade the move: above 78 it is more likely to pause than to run
    if (rsiNow >= 78) v -= 0.6;
    else if (rsiNow <= 22) v += 0.6;
    add("rsi", "RSI (5-min)", W.rsi, v, `RSI ${Math.round(rsiNow)}${num(rsiThen) ? ` (${slope >= 0 ? "up" : "down"} ${Math.abs(Math.round(slope))} in 15 min)` : ""}${rsiNow >= 78 ? " — stretched, may pause" : rsiNow <= 22 ? " — stretched, may bounce" : ""}`);
  }

  /* 7. candle patterns that closed in the last three 5-minute bars */
  const found = [];
  for (let i = Math.max(1, closed.length - 3); i < closed.length; i += 1) for (const p of I.candlePatterns(closed, i)) found.push({ ...p, at: closed[i].t });
  const dir = found.filter((p) => p.bias !== "neutral");
  if (dir.length) {
    const net = dir.reduce((s, p) => s + (p.bias === "bullish" ? 1 : -1), 0);
    add("candles", "Candles", W.candles, clamp(net / 2, -1, 1), dir.map((p) => `${p.name} at ${p.at}`).join(", "));
  }

  /* 8. opening range: broken, and held */
  if (num(m.orHigh) && num(m.orLow) && m.orHigh > m.orLow) {
    const room = m.orHigh - m.orLow;
    let v = 0;
    let why = `inside the opening range ${r2(m.orLow)}–${r2(m.orHigh)}`;
    if (last > m.orHigh) {
      v = clamp(0.4 + (last - m.orHigh) / room, 0.4, 1);
      why = `above the opening range high ${r2(m.orHigh)}`;
    } else if (last < m.orLow) {
      v = -clamp(0.4 + (m.orLow - last) / room, 0.4, 1);
      why = `below the opening range low ${r2(m.orLow)}`;
    }
    add("orb", "Opening range", W.orb, v, why);
  }

  /* 9. order flow, when the tick stream has it (resting quantity can be pulled: it counts for little) */
  if (flow && num(flow.pressure)) add("flow", "Order flow", W.flow, clamp(flow.pressure / 100, -1, 1), `${flow.label || "order book"}; signed volume last 5 min ${flow.delta300 ?? "—"}`);

  /* ---------------------------------------------------------------- the lean and its agreement */
  const wsum = comps.reduce((s, c) => s + c.weight, 0);
  const lean = wsum ? comps.reduce((s, c) => s + c.vote * c.weight, 0) / wsum : 0; // -1..+1
  const score = Math.round(lean * 100);
  const side = score > 0 ? 1 : score < 0 ? -1 : 0;
  const agreeW = side === 0 ? 0 : comps.filter((c) => Math.sign(c.vote) === side && Math.abs(c.vote) >= 0.1).reduce((s, c) => s + c.weight, 0);
  const againstW = side === 0 ? 0 : comps.filter((c) => Math.sign(c.vote) === -side && Math.abs(c.vote) >= 0.1).reduce((s, c) => s + c.weight, 0);
  const agreement = wsum ? Math.round((agreeW / wsum) * 100) : 0;

  /* gates: reasons to stand aside whatever the lean */
  const gates = [];
  const sess = day.session || {};
  if (sess.entries === false) gates.push(sess.label ? `${sess.label}: no fresh intraday entries now.` : "Outside the entry window.");
  if (num(m.volumePace) && m.volumePace < 0.5) gates.push(`Volume is running at ${m.volumePace.toFixed(1)}× its usual pace: moves on thin volume are easy to reverse.`);
  if (flow && num(flow.spreadTicks) && flow.spreadTicks > 6) gates.push(`The bid–ask spread is ${flow.spreadTicks} ticks: slippage would eat a short-term trade.`);
  if (num(m.quoteAgeSec) && m.quoteAgeSec > 90) gates.push(`The last quote is ${m.quoteAgeSec} seconds old.`);
  if (againstW > 0 && againstW >= agreeW * 0.8 && agreeW > 0) gates.push("The evidence is split: nearly as much weight points the other way.");

  const confidence = clamp(Math.round(agreement * (Math.min(Math.abs(score), 60) / 60) * 0.5 + agreement * 0.5), 0, 100);
  const strong = Math.abs(score) >= 28 && agreement >= 62;
  let call = "wait";
  if (strong && gates.length === 0) call = score > 0 ? "long" : "short";
  const lean3 = score >= 28 ? "up" : score <= -28 ? "down" : "sideways";

  /* ------------------------------------------------------------ the window ahead (volatility) */
  const horizon = Math.sqrt(6) * a5 * 0.9; // 30 minutes = six bars; a random walk's typical reach
  const window = { minutes: 30, typicalMove: r2(horizon), low: onTick(last - horizon), high: onTick(last + horizon), basis: `a 5-minute move is typically ₹${r2(a5)}; over 30 minutes that is ₹${r2(horizon)} either way — a measure of how far it may travel, not which way` };

  /* ------------------------------------------------------------------- plans for both sides */
  const dailyAtr = num(m.atr) ? m.atr : a5 * 8;
  const swingLow = fast && fast.available && num(fast.swingLow) ? fast.swingLow : null;
  const swingHigh = fast && fast.available && num(fast.swingHigh) ? fast.swingHigh : null;
  const minStop = 0.12 * dailyAtr;
  const maxStop = 0.8 * dailyAtr;
  const plans = {};
  for (const sideName of ["long", "short"]) {
    const long = sideName === "long";
    const beyond = long ? Math.min(...bars5.slice(-4).map((b) => b.l)) : Math.max(...bars5.slice(-4).map((b) => b.h));
    let stop = long ? Math.min(beyond, swingLow ?? beyond) - 0.15 * a5 : Math.max(beyond, swingHigh ?? beyond) + 0.15 * a5;
    let dist = Math.abs(last - stop);
    dist = clamp(dist, Math.max(minStop, 1.2 * a5), maxStop);
    stop = long ? last - dist : last + dist;
    const t1 = long ? last + dist : last - dist; // 1R
    const t2 = long ? last + 2 * dist : last - 2 * dist; // 2R
    const circuit = long ? day.plan && day.plan.side === "long" : day.plan && day.plan.side === "short";
    plans[sideName] = {
      side: sideName,
      entry: onTick(last),
      stop: onTick(stop),
      targets: [onTick(t1), onTick(t2)],
      riskPerShare: r2(dist),
      riskPct: r2((dist / last) * 100),
      rewardToRisk: 1,
      basis: `stop just beyond the last four bars' ${long ? "low" : "high"}${(long ? swingLow : swingHigh) ? " and the 1-minute swing" : ""}, at least ${r2(Math.max(minStop, 1.2 * a5))} away; targets at 1R and 2R`,
      matchesEngine: Boolean(circuit),
      engine: circuit ? { entry: day.plan.entry, stop: day.plan.stop, targets: day.plan.targets.map((t) => t.price) } : null,
    };
  }

  /* -------------------------------------------------- the trader's own position and margin (read only) */
  let you = null;
  if (account) {
    const pos = account.position;
    const funds = account.funds;
    const cash = funds && num(funds.available) ? funds.available : null;
    const plan = call === "long" ? plans.long : call === "short" ? plans.short : null;
    you = { hasPosition: false, cash: r2(cash) };
    if (pos && num(pos.quantity) && pos.quantity !== 0) {
      const long = pos.quantity > 0;
      const mineLean = long ? score : -score;
      const pnl = (last - pos.average) * pos.quantity;
      let advice;
      let why;
      if (mineLean >= 28 && agreement >= 60) {
        advice = "hold";
        why = `The short-window read still leans ${long ? "up" : "down"} with your position.`;
      } else if (mineLean <= -28 && agreement >= 55) {
        advice = "exit-or-tighten";
        why = `The short-window read now leans ${long ? "down" : "up"}, against your ${long ? "long" : "short"}: consider tightening the stop or exiting.`;
      } else {
        advice = "hold-stop-in-place";
        why = "No clear short-window lean either way: keep the stop where it is and do not add.";
      }
      you = { ...you, hasPosition: true, side: long ? "long" : "short", quantity: Math.abs(pos.quantity), average: r2(pos.average), pnl: r2(pnl), product: pos.product || null, advice, why };
    }
    if (plan && num(cash) && cash > 0) {
      const riskRs = (cash * riskPct) / 100;
      const byRisk = Math.floor(riskRs / plan.riskPerShare);
      const byCash = Math.floor(cash / last);
      you.sizing = { riskPct, riskRs: r2(riskRs), qtyByRisk: byRisk, qtyByCash: byCash, qty: Math.max(0, Math.min(byRisk, byCash)), note: "Cash only (no leverage assumed). The order ticket's margin check has the final say." };
    }
  }

  const headline =
    call === "long"
      ? `Leans UP — a long has the weight of evidence (${agreement}% agree)`
      : call === "short"
        ? `Leans DOWN — a short has the weight of evidence (${agreement}% agree)`
        : lean3 !== "sideways" && gates.length
          ? `Leans ${lean3.toUpperCase()}, but stand aside: ${gates[0]}`
          : lean3 !== "sideways"
            ? `Leans ${lean3.toUpperCase()}, not strongly enough to call (${agreement}% agree)`
            : "No clear lean: price is going sideways";

  return {
    available: true,
    symbol: day.symbol || null,
    at: day.movement.lastBarAt || null,
    last: r2(last),
    call, // "long" | "short" | "wait"
    lean: lean3,
    score,
    confidence,
    agreement,
    headline,
    gates,
    components: comps,
    window,
    plans,
    you,
    patterns: found.map((p) => ({ name: p.name, bias: p.bias, at: p.at })),
    stats: { dailyAtr: r2(dailyAtr), atr5: r2(a5), m15Pct: r2(m15), m30Pct: r2(m30), rsi5: r1(rsiNow), volumeSurge: r2(surge), vsVwapPct: m.vsVwapPct ?? null },
    rule: "Each component votes between −1 and +1 with a fixed weight; the lean is their weighted sum, and confidence is how much of the weight agrees with it. A lean of ±28 with 62% agreement and no gate is a call; anything else is 'wait'. Agreement is not a probability of profit.",
  };
}

module.exports = { buildPulse, atr5, W };
