"use strict";
// The exit coach: for a position that is open now, when is it best to leave?
//
// One look (`coach`) reads everything the desk already knows about the stock at this moment and
// answers with one of four words — HOLD, TIGHTEN, BOOK PART, EXIT NOW — an exit pressure from 0 to
// 100, the price to exit at, the stop to keep, the next target, and the reasons on both sides:
//
//   the position   the gain or loss, the best gain so far and how much of it has been given back
//                  (the habit this desk guards against), the time in the trade and to the 3:15 PM
//                  square-off
//   the tape       the last minutes' direction, a break of the last five minutes' low (or high),
//                  lower highs, RSI rolling over, VWAP lost or held, a volume climax with rejection
//   the book       the order-flow engine's reading (market/flow.js): who is pressing in the five
//                  best bids and offers, where the last minute's trades hit, its 30-second lean, a
//                  wall of orders ahead
//   the levels     the next support or resistance on the desk's ladder
//   the forecast   the Live Pulse (the next 15–30 minutes), the market's tide, the NSE forecast from
//                  the world (GIFT Nifty, overseas markets), the news and posts about the stock, the
//                  desk's live call, and the day's goal
//
// It keeps its own protective stop: a first stop, moved to break-even once the trade has paid, then
// trailed behind the best price by a distance taken from the stock's own one-minute ranges. A stop
// that is hit is EXIT NOW whatever else says.
//
// Pure arithmetic: no AI, no network, no timer, no order. The same function replays a finished trade
// on its 1-minute bars (`replay`) to show when the coach would have said EXIT. A reading of the
// evidence — never a promise, and never an instruction that is carried out by itself.

const IST = 5.5 * 3600 * 1000;
const TICK = 0.05;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const onTick = (x) => (num(x) ? Math.round(Math.round(x / TICK) * TICK * 100) / 100 : null);
const rs = (x) => (num(x) ? `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const pc = (x) => (num(x) ? `${x > 0 ? "+" : ""}${x.toFixed(2)}%` : "—");
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const squareOffOf = (ms) => Date.parse(`${new Date(ms + IST).toISOString().slice(0, 10)}T09:45:00Z`); // 3:15 PM IST

const RANK = { hold: 0, tighten: 1, "book-part": 2, "exit-now": 3 };
const WORD = { hold: "HOLD", tighten: "TIGHTEN", "book-part": "BOOK PART", "exit-now": "EXIT NOW" };

/** Wilder's RSI on closes. */
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let up = 0;
  let dn = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) up += d;
    else dn -= d;
  }
  up /= n;
  dn /= n;
  for (let i = n + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    up = (up * (n - 1) + Math.max(0, d)) / n;
    dn = (dn * (n - 1) + Math.max(0, -d)) / n;
  }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}

function vwapOf(bars) {
  let pv = 0;
  let v = 0;
  for (const b of bars) {
    const vol = num(b.v) && b.v > 0 ? b.v : 1;
    pv += ((b.h + b.l + b.c) / 3) * vol;
    v += vol;
  }
  return v ? pv / v : null;
}

/** What the coach remembers about one position between two looks. */
function newMemory(pos) {
  return { peak: pos.avg, peakAt: pos.entryAt, trough: pos.avg, troughAt: pos.entryAt, trail: null, state: "hold", stateAt: pos.entryAt, seeded: false };
}

/**
 * One look at one open position.
 * @param pos   { symbol, side: "long" | "short", qty, avg, entryAt (ms), product }
 * @param bars  today's 1-minute bars [{ t (ms), o, h, l, c, v }], oldest first, up to now
 * @param tick  { last, bid, ask, vwap } — the latest price (bid / ask when the book is streamed)
 * @param opts  { now, memory, flow, levels: [{ label, price }], pulse: { score, lean, window: { low, high } },
 *                tide: { score }, forecast: { score, word, firm }, news: { sentiment, high, title, at },
 *                goal: { state }, liveCall: { side, active }, costPct = 0.06, bar: { h, l } (a replay's bar) }
 * @returns { state, word, pressure, headline, exit, stop, target, reasons: { exit, hold }, parts, metrics, memory }
 */
function coach(pos, bars, tick, opts = {}) {
  const now = opts.now || Date.now();
  const s = pos.side === "short" ? -1 : 1;
  const e = pos.avg;
  const qty = Math.abs(pos.qty);
  const mem = { ...(opts.memory || newMemory(pos)) };
  const since = bars.filter((b) => b.t >= pos.entryAt - 60000 && b.t <= now);
  const last = num(tick && tick.last) ? tick.last : bars.length ? bars[bars.length - 1].c : e;
  const done = bars.filter((b) => b.t <= now - 60000 || opts.bar); // completed bars (in a replay every bar handed in is complete)
  const closes = done.map((b) => b.c);

  /* ---- the position: best and worst so far (rebuilt from the bars after a restart) */
  if (!mem.seeded) {
    for (const b of since) {
      const best = s > 0 ? b.h : b.l;
      const worst = s > 0 ? b.l : b.h;
      if (s * (best - mem.peak) > 0) Object.assign(mem, { peak: best, peakAt: b.t });
      if (s * (worst - mem.trough) < 0) Object.assign(mem, { trough: worst, troughAt: b.t });
    }
    mem.seeded = true;
  }
  const hiNow = opts.bar ? (s > 0 ? opts.bar.h : opts.bar.l) : last;
  const loNow = opts.bar ? (s > 0 ? opts.bar.l : opts.bar.h) : last;
  if (s * (hiNow - mem.peak) > 0) Object.assign(mem, { peak: hiNow, peakAt: now });
  if (s * (loNow - mem.trough) < 0) Object.assign(mem, { trough: loNow, troughAt: now });
  const gainPct = (s * (last - e)) / e * 100;
  const peakPct = (s * (mem.peak - e)) / e * 100;
  const troughPct = (s * (mem.trough - e)) / e * 100;
  const pnl = s * (last - e) * qty;
  const minutesIn = Math.max(0, Math.round((now - pos.entryAt) / 60000));
  const sqAt = opts.squareOffAt || squareOffOf(now);
  const minsToSq = Math.round((sqAt - now) / 60000);
  const intraday = !pos.product || pos.product === "MIS";

  /* ---- the stock's own step: the trail distance from its one-minute ranges */
  const recent = done.slice(-20);
  const avgRange = recent.length ? recent.reduce((a, b) => a + (b.h - b.l), 0) / recent.length : e * 0.001;
  const unit = clamp(avgRange * 2.5, e * 0.0025, e * 0.008);

  /* ---- the coach's own stop: first stop → break-even → trailing */
  const costPct = num(opts.costPct) ? opts.costPct : 0.06;
  let stop = e - s * Math.max(unit * 1.6, e * 0.005);
  let stopKind = "first stop";
  if (peakPct >= 0.4) {
    const be = e * (1 + (s * costPct) / 100);
    if (s * (be - stop) > 0) {
      stop = be;
      stopKind = "break-even";
    }
  }
  if (peakPct >= 0.7) {
    const tr = mem.peak - s * unit;
    if (s * (tr - stop) > 0) {
      stop = tr;
      stopKind = "trailing stop";
    }
  }
  if (num(mem.trail) && s * (mem.trail - stop) > 0) {
    stop = mem.trail; // a stop is only ever moved towards the price
    stopKind = mem.trailKind || stopKind;
  }
  stop = onTick(stop);

  const parts = [];
  const hold = [];
  const add = (id, pts, text) => parts.push({ id, pts, text });

  /* ---- hard exits */
  const stopHit = s * (loNow - stop) <= 0;
  let hard = "";
  if (stopHit) hard = `The ${stopKind} at ${rs(stop)} is hit.`;
  else if (intraday && minsToSq <= 5 && minsToSq > -30) hard = `${Math.max(0, minsToSq)} minutes to the 3:15 PM square-off: exit yourself rather than at the broker's market order.`;

  /* ---- the position */
  const giveback = peakPct >= 0.4 ? clamp((peakPct - gainPct) / peakPct, 0, 2) : null;
  if (giveback !== null && giveback >= 0.25) add("giveback", giveback >= 0.6 ? 26 : giveback >= 0.4 ? 16 : 8, `You have given back ${Math.round(Math.min(1, giveback) * 100)}% of the best gain (${pc(peakPct)} at ${clock(mem.peakAt)}, now ${pc(gainPct)}).`);
  else if (peakPct >= 0.4) hold.push(`Holding near its best: ${pc(gainPct)} of a ${pc(peakPct)} peak.`);
  if (gainPct <= -0.8) add("loss", 22, `Down ${pc(gainPct)} from the entry: beyond a normal intraday stop.`);
  else if (gainPct <= -0.5) add("loss", 12, `Down ${pc(gainPct)} from the entry.`);
  if (gainPct < 0 && minutesIn >= 30 && troughPct <= -1) add("heldLoser", 10, `A loser held for ${minutesIn} minutes (it has been ${pc(troughPct)} against you).`);
  if (intraday && minsToSq <= 15 && minsToSq > 5) add("time", 15, `${minsToSq} minutes to the 3:15 PM square-off.`);
  else if (intraday && minsToSq <= 30 && minsToSq > 15) add("time", 6, `${minsToSq} minutes to the 3:15 PM square-off.`);

  /* ---- the tape */
  let m3 = null;
  if (closes.length >= 4) {
    m3 = (s * (last - closes[closes.length - 4])) / e * 100;
    if (m3 <= -0.25) add("momentum", 10, `Moving against you for three minutes (${pc(s * m3)}).`);
    else if (m3 >= 0.15) hold.push(`Still moving your way (${pc(s * m3)} in three minutes).`);
  }
  const afterPeak = done.filter((b) => b.t > mem.peakAt);
  const five = done.slice(-5);
  if (five.length === 5 && afterPeak.length >= 2) {
    const edge = s > 0 ? Math.min(...five.map((b) => b.l)) : Math.max(...five.map((b) => b.h));
    if (s * (last - edge) < 0) add("structure", 12, `Broke the ${s > 0 ? "low" : "high"} of the last five minutes (${rs(edge)}).`);
  }
  if (afterPeak.length >= 3) {
    const t3 = afterPeak.slice(-3);
    const lower = s > 0 ? t3[0].h > t3[1].h && t3[1].h > t3[2].h : t3[0].l < t3[1].l && t3[1].l < t3[2].l;
    if (lower) add("lowerHighs", 6, s > 0 ? "Three lower highs since the peak." : "Three higher lows since the low.");
  }
  const rsiNow = rsi(closes.slice(-60));
  if (num(rsiNow) && closes.length >= 20) {
    const earlier = [];
    for (let k = 2; k <= 6; k += 1) earlier.push(rsi(closes.slice(-60 - k, -k)));
    const ext = earlier.filter(num);
    if (s > 0 && ext.some((x) => x >= 75) && rsiNow < 65) add("rsi", 8, `Momentum rolled over from overbought (1-minute RSI ${Math.round(Math.max(...ext))} → ${Math.round(rsiNow)}).`);
    if (s < 0 && ext.some((x) => x <= 25) && rsiNow > 35) add("rsi", 8, `Momentum turned up from oversold (1-minute RSI ${Math.round(Math.min(...ext))} → ${Math.round(rsiNow)}).`);
  }
  const vw = num(tick && tick.vwap) && tick.vwap > 0 ? tick.vwap : vwapOf(bars);
  const vsVwap = num(vw) ? ((last - vw) / vw) * 100 : null;
  if (num(vw)) {
    const wasRight = s * (mem.peak - vw * (1 + s * 0.001)) > 0;
    if (s * (last - vw) < 0 && wasRight) add("vwap", 10, `Lost VWAP (${rs(vw)}): the average buyer today is now ${s > 0 ? "underwater" : "in profit"}.`);
    else if (s * (last - vw) < 0) add("vwap", 6, `On the wrong side of VWAP (${rs(vw)}).`);
    else hold.push(`${s > 0 ? "Above" : "Below"} VWAP ${rs(vw)} (${pc(vsVwap)}).`);
  }
  const lastDone = done[done.length - 1];
  if (lastDone && done.length >= 21) {
    const avgVol = done.slice(-21, -1).reduce((a, b) => a + (b.v || 0), 0) / 20;
    const range = lastDone.h - lastDone.l;
    const closeAt = range > 0 ? (lastDone.c - lastDone.l) / range : 0.5; // 0 = closed on its low
    const rejected = s > 0 ? closeAt <= 0.4 : closeAt >= 0.6;
    const nearPeak = Math.abs(lastDone[s > 0 ? "h" : "l"] - mem.peak) <= unit;
    if (avgVol > 0 && lastDone.v >= avgVol * 3 && rejected && nearPeak) add("climax", 10, `Volume climax with rejection near ${rs(mem.peak)} (${(lastDone.v / avgVol).toFixed(1)}× the usual minute): the move may be exhausted.`);
  }

  /* ---- the book (the order-flow engine, when the depth is streamed) */
  const flow = opts.flow && opts.flow.available ? opts.flow : null;
  let wallAhead = null;
  if (flow) {
    const against = -s * flow.pressure;
    const sidePct = Math.round(((s > 0 ? flow.sellTotal : flow.buyTotal) / Math.max(1, flow.buyTotal + flow.sellTotal)) * 100);
    if (against >= 60) add("book", 14, `The order book is against you: ${s > 0 ? "sellers" : "buyers"} hold ${sidePct}% of the five best levels (pressure ${flow.pressure}).`);
    else if (against >= 30) add("book", 10, `${s > 0 ? "Sellers" : "Buyers"} are pressing in the order book (pressure ${flow.pressure}; ${sidePct}% of the five best levels).`);
    else if (against <= -30) hold.push(`${s > 0 ? "Buyers" : "Sellers"} are pressing in the order book (pressure ${flow.pressure}).`);
    if (num(flow.deltaRatio60Pct) && s * flow.deltaRatio60Pct <= -35 && flow.volume60 > 0) add("trades", 6, `The last minute's trades hit the ${s > 0 ? "bid" : "offer"} (${Math.abs(flow.deltaRatio60Pct)}% net ${s > 0 ? "selling" : "buying"}).`);
    const lean = flow.lean;
    if (lean && lean.trained && ((s > 0 && lean.dir === "down") || (s < 0 && lean.dir === "up")) && (!num(lean.hitRatePct) || lean.hitRatePct >= 55)) add("lean", 6, `The 30-second order-flow lean is ${lean.dir}${num(lean.hitRatePct) ? ` (right ${lean.hitRatePct}% of the time today)` : ""}.`);
    if (flow.wall && num(flow.wall.price)) {
      const ahead = s > 0 ? flow.wall.side === "ask" && flow.wall.price > last : flow.wall.side === "bid" && flow.wall.price < last;
      if (ahead && (Math.abs(flow.wall.price - last) / last) * 100 <= 0.3) {
        wallAhead = flow.wall;
        add("wall", 5, `A wall of ${Number(flow.wall.qty || 0).toLocaleString("en-IN")} shares waits at ${rs(flow.wall.price)}, just ${s > 0 ? "above" : "below"}.`);
      }
    }
  }

  /* ---- the levels */
  const levels = (opts.levels || []).filter((l) => num(l.price) && l.price > 0);
  const ahead = levels.filter((l) => s * (l.price - last) > last * 0.0005 && Math.abs(l.price - last) / last <= 0.02).sort((a, b) => Math.abs(a.price - last) - Math.abs(b.price - last))[0] || null;
  if (ahead && (Math.abs(ahead.price - last) / last) * 100 <= 0.15 && gainPct > 0) add("level", 6, `At ${ahead.label} ${rs(ahead.price)}: a level where the price can pause or turn.`);

  /* ---- the forecast: the next 15–30 minutes, the market, the world, the news, the day */
  const pulse = opts.pulse && num(opts.pulse.score) ? opts.pulse : null;
  if (pulse) {
    if (s * pulse.score <= -28) add("pulse", 10, `The desk's pulse for the next 15–30 minutes leans ${pulse.score < 0 ? "DOWN" : "UP"} (score ${pulse.score}).`);
    else if (s * pulse.score >= 28) hold.push(`The pulse for the next 15–30 minutes leans your way (score ${pulse.score}).`);
  }
  if (opts.tide && num(opts.tide.score) && s * opts.tide.score <= -40) add("tide", 5, `The market's tide is against you (${opts.tide.score}).`);
  if (opts.forecast && opts.forecast.firm && num(opts.forecast.score) && s * opts.forecast.score < 0) add("world", 3, `The NSE forecast from the world leans ${opts.forecast.word || (opts.forecast.score < 0 ? "down" : "up")} for the rest of the day.`);
  const news = opts.news;
  if (news && news.high > 0 && num(news.sentiment) && s * news.sentiment <= -0.2 && (!news.at || now - Date.parse(news.at) <= 90 * 60000)) add("news", 8, `High-impact news against the position: “${String(news.title || "").slice(0, 110)}”.`);
  const goal = opts.goal && opts.goal.state;
  if (goal === "stop" || goal === "stop-hit") add("goal", 12, "The day's stop is reached: close and stop for the day.");
  else if (goal && /target|protect|giveback|near-target/.test(goal) && gainPct > 0) add("goal", 6, "The day's target is in hand: protect it.");
  if (opts.liveCall && opts.liveCall.active && ((s > 0 && opts.liveCall.side === "short") || (s < 0 && opts.liveCall.side === "long"))) add("liveCall", 10, `The desk's live call is now ${opts.liveCall.side.toUpperCase()} — the other way.`);

  /* ---- the word */
  const pressure = hard ? 100 : clamp(Math.round(parts.reduce((a, p) => a + p.pts, 0)), 0, 99);
  let state;
  if (hard) state = "exit-now";
  else if (gainPct < 0) state = pressure >= 55 ? "exit-now" : pressure >= 25 ? "tighten" : "hold";
  else state = pressure >= 70 ? "exit-now" : pressure >= 45 ? "book-part" : pressure >= 25 ? "tighten" : "hold";
  // steady: it steps up at once, but steps down only after a while (a minute; three after EXIT NOW)
  // and only once the pressure is clearly under the line it crossed — no flicker around a threshold
  if (RANK[state] < RANK[mem.state]) {
    const floor = { tighten: 25, "book-part": 45, "exit-now": gainPct < 0 ? 55 : 70 }[mem.state] || 0;
    const waited = now - mem.stateAt >= (mem.state === "exit-now" ? 180000 : 60000);
    if (!waited || pressure > floor - 8) state = mem.state;
  }
  if (state !== mem.state) Object.assign(mem, { state, stateAt: now });

  /* ---- the prices */
  if (RANK[state] >= 1 && !hard) {
    const tight = last - s * unit * 0.7;
    if (s * (tight - stop) > 0) {
      stop = onTick(tight);
      stopKind = "tightened stop";
    }
  }
  if (!num(mem.trail) || s * (stop - mem.trail) > 0) Object.assign(mem, { trail: stop, trailKind: stopKind });
  const bid = num(tick && tick.bid) ? tick.bid : null;
  const ask = num(tick && tick.ask) ? tick.ask : null;
  const touch = s > 0 ? bid : ask; // what a market order would get
  const wide = num(bid) && num(ask) && ask - bid >= TICK * 3;
  const pulseEdge = pulse && pulse.window ? (s > 0 ? pulse.window.high : pulse.window.low) : null;
  let target = ahead ? ahead.price : null;
  if (wallAhead) target = wallAhead.price - s * TICK;
  if (!num(target) && num(pulseEdge) && s * (pulseEdge - last) > 0) target = pulseEdge;
  if (!num(target)) target = last + s * unit * 2;
  target = onTick(target);
  let exit;
  if (state === "exit-now") {
    const px = stopHit && opts.bar ? stop : num(touch) ? touch : last;
    exit = { price: onTick(px), qty, how: wide ? "limit" : "market", limit: wide ? onTick(s > 0 ? ask - TICK : bid + TICK) : null, note: wide ? `The spread is wide: a limit at ${rs(onTick(s > 0 ? ask - TICK : bid + TICK))} may get a better price than the market's ${rs(touch)}.` : `At market: about ${rs(onTick(px))}.` };
  } else if (state === "book-part") {
    const half = Math.max(1, Math.floor(qty / 2));
    exit = { price: onTick(num(touch) ? touch : last), qty: half, how: "market", limit: null, note: `Book ${half} of ${qty} near ${rs(onTick(num(touch) ? touch : last))}; trail the rest at ${rs(stop)}.` };
  } else {
    exit = { price: target, qty, how: "limit", limit: target, note: `The next place to take profit is ${rs(target)}${ahead ? ` (${ahead.label})` : wallAhead ? " (just before the wall of orders)" : ""}; the stop is ${rs(stop)}.` };
  }

  const exitReasons = parts.slice().sort((a, b) => b.pts - a.pts).map((p) => p.text);
  if (hard) exitReasons.unshift(hard);
  const top = exitReasons[0] || hold[0] || "";
  const headline =
    state === "exit-now"
      ? `EXIT NOW — about ${rs(exit.price)}. ${top}`
      : state === "book-part"
        ? `BOOK PART — ${exit.qty} of ${qty} near ${rs(exit.price)}, trail the rest at ${rs(stop)}. ${top}`
        : state === "tighten"
          ? `TIGHTEN — move the stop to ${rs(stop)}. ${top}`
          : `HOLD — stop ${rs(stop)}, next target ${rs(target)}. ${hold[0] || ""}`;

  return {
    state,
    word: WORD[state],
    pressure,
    headline: headline.trim(),
    hard: Boolean(hard),
    hardKind: stopHit ? "stop" : hard ? "time" : "",
    exit,
    stop,
    stopKind,
    target,
    reasons: { exit: exitReasons.slice(0, 6), hold: hold.slice(0, 5) },
    parts,
    metrics: {
      last: r2(last),
      pnl: r2(pnl),
      gainPct: r2(gainPct),
      peak: { price: r2(mem.peak), at: mem.peakAt, clock: clock(mem.peakAt), gainPct: r2(peakPct), pnl: r2(s * (mem.peak - e) * qty) },
      trough: { price: r2(mem.trough), at: mem.troughAt, clock: clock(mem.troughAt), gainPct: r2(troughPct), pnl: r2(s * (mem.trough - e) * qty) },
      givebackPct: giveback === null ? null : Math.round(clamp(giveback, 0, 1) * 100),
      minutesIn,
      minutesToSquareOff: intraday ? minsToSq : null,
      vwap: r2(vw),
      vsVwapPct: r2(vsVwap),
      rsi1: r1(rsiNow),
      move3Pct: r2(num(m3) ? s * m3 : null),
      unit: r2(unit),
      bid: r2(bid),
      ask: r2(ask),
      book: flow ? { pressure: flow.pressure, label: flow.label, buyersPct: Math.round((flow.buyTotal / Math.max(1, flow.buyTotal + flow.sellTotal)) * 100), delta60: flow.delta60, lean: flow.lean ? flow.lean.dir : null, wall: flow.wall || null, spread: flow.spread } : null,
      pulse: pulse ? { score: pulse.score, lean: pulse.lean, low: pulse.window ? pulse.window.low : null, high: pulse.window ? pulse.window.high : null } : null,
    },
    memory: mem,
  };
}

/**
 * A finished trade replayed bar by bar: what the coach would have said, minute by minute, from the
 * entry to 3:15 PM (bars only — no order book in the past). Stops at its first EXIT NOW.
 * @returns { changes: [{ at, clock, state, price, why }], exit: { at, clock, price, pnl, why, kind: "signal" | "stop" | "time" } | null }
 */
function replay(trade, bars, { costPct } = {}) {
  const s = trade.side === "short" ? -1 : 1;
  const pos = { symbol: trade.symbol, side: trade.side, qty: trade.qty, avg: trade.entryAvg, entryAt: trade.entryAt, product: "MIS" };
  const sq = squareOffOf(trade.entryAt);
  const day = bars.filter((b) => b.t <= sq).sort((a, b) => a.t - b.t);
  let memory = { ...newMemory(pos), seeded: true };
  const changes = [];
  let exit = null;
  let state = "hold";
  for (let i = 0; i < day.length; i += 1) {
    const b = day[i];
    if (b.t < trade.entryAt) continue;
    const now = b.t + 60000;
    const a = coach(pos, day.slice(0, i + 1), { last: b.c }, { now, memory, bar: b, costPct, squareOffAt: sq });
    memory = a.memory;
    if (a.state !== state) {
      state = a.state;
      changes.push({ at: now, clock: clock(now), state, price: r2(a.state === "exit-now" ? a.exit.price : b.c), why: a.reasons.exit[0] || a.reasons.hold[0] || "" });
    }
    if (a.state === "exit-now") {
      exit = { at: now, clock: clock(now), price: a.exit.price, pnl: r2(s * (a.exit.price - trade.entryAvg) * trade.qty), why: a.reasons.exit[0] || "", kind: a.hardKind || "signal" };
      break;
    }
  }
  return { changes, exit };
}

module.exports = { coach, replay, newMemory, rsi, vwapOf, squareOffOf, RANK, WORD };
