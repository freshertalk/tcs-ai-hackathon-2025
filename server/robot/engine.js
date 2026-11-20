"use strict";
// The paper robot's rulebook and its hands: when to take one of the advisor's calls, how big, and how
// to run the position — all arithmetic on numbers handed in, all with play money.
//
//   RULEBOOK   the parameters the robot trades by. They start at DEFAULTS and are moved, within BOUNDS,
//              only by its own corrections (improve.js), each written down with the evidence.
//   GATE       one of the live scanner's eligible picks becomes a trade only if it passes every check,
//              in order, and the first one that fails is written down as the reason it was skipped.
//   POSITION   entered at the pick's price with a little slippage; the pick's own stop and targets; half
//              booked at the first target and the stop moved to the entry; a trailing stop after it;
//              out on the stop, the second target, a give-back of the best gain, the advisor turning
//              against the trade, too long in it, or the broker's square-off (market/session.js: 3:12 PM since August 2026).
//   OUTCOME    each finished trade is classed by what became of its best moment — the same classes the
//              Trade Analysis snapshots use for the trader's own trades, so the two can be compared.
//
// It prices fills at the price it sees (a tick every few seconds), so a stop can fill a little worse in a
// fast market than here. No clock, no network, no broker: this file cannot place an order.

const { classify } = require("../analysis/snapshot");
const { chargeParts } = require("../trading/journal");

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const minOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const clockOf = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const SESSION = require("../market/session");
const SQUARE = 15 * 60 + 15; // the old rules' minute, kept for whoever imports it; each day's own comes from the session table
/** The broker's square-off on the IST day of `ms`, as { min, clock }: 3:12 PM in a closing-auction stock since August 2026. */
const squareOf = (ms) => {
  const day = SESSION.sessionFor(new Date(ms + IST).toISOString().slice(0, 10));
  return { min: day.squareOffMin, clock: day.squareOffClock };
};

const DEFAULTS = {
  capital: 1000000,
  riskPct: 0.5, // of the capital, risked on one trade
  minScore: 45, // the scanner's score (either side) a pick needs
  minAgree: 0.6, // the share of the scanner's engines that agree
  maxOpen: 3,
  maxTradesDay: 8,
  entryFrom: 9 * 60 + 30,
  entryTo: 14 * 60 + 30,
  middayExtra: 8, // added to the score needed between 11:30 and 1:30
  minRoomR: 0.8, // room, in R, to the next level against the trade
  maxCostR: 0.35, // the round trip's charges, in R of the risk to the stop, above which a call is not worth taking
  giveBackPct: 50, // out when this share of the best gain (past +1R) has been given back
  t1Share: 50, // percent of the position booked at the first target
  beR: 1, // the stop moves to the entry at this gain in R
  trailR: 0.8, // after the first target the stop trails this many R behind the best price
  maxHoldMin: 150,
  slipPct: 0.03, // worse than the price seen, each way
  dayStopPct: 1.5, // no new entry once the day is down this share of the capital
  cooldownMin: 30, // before the same stock is entered again
  maxPositionPct: 25, // of the capital in one position
  minLevelEdge: -0.05, // the Level Book's expected R below which a level kind is not traded
  respectAi: true, // skip what the AI's review of the scanner dropped
  requireMarket: false, // skip trades against the market's lean
  sideBump: { long: 0, short: 0 }, // added to the score needed on a side
  blockHours: [], // hours of the day entries are not taken in
  blockSymbols: {}, // { SYMBOL: "YYYY-MM-DD" } — not entered until that date
};
const BOUNDS = {
  riskPct: [0.1, 1],
  minScore: [35, 75],
  minAgree: [0.5, 0.85],
  maxOpen: [1, 5],
  maxTradesDay: [2, 12],
  middayExtra: [0, 25],
  minRoomR: [0.3, 2],
  maxCostR: [0.15, 0.8],
  giveBackPct: [25, 60],
  t1Share: [25, 75],
  beR: [0.5, 1.5],
  trailR: [0.4, 1.5],
  maxHoldMin: [45, 240],
  dayStopPct: [0.5, 3],
  cooldownMin: [10, 90],
  minLevelEdge: [-0.2, 0.1],
};
const SIDE_BOUNDS = [0, 15];

/** The rulebook with every number inside its bounds (an unknown key is dropped). */
function clampRules(r = {}) {
  const out = { ...DEFAULTS, ...r, sideBump: { ...DEFAULTS.sideBump, ...(r.sideBump || {}) }, blockHours: [...(r.blockHours || [])], blockSymbols: { ...(r.blockSymbols || {}) } };
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) out[k] = Math.min(hi, Math.max(lo, Number(out[k])));
  for (const s of ["long", "short"]) out.sideBump[s] = Math.min(SIDE_BOUNDS[1], Math.max(SIDE_BOUNDS[0], Number(out.sideBump[s]) || 0));
  out.blockHours = [...new Set(out.blockHours.map(Number).filter((h) => h >= 9 && h <= 15))].sort((a, b) => a - b);
  out.capital = Math.max(10000, Number(out.capital) || DEFAULTS.capital);
  out.respectAi = Boolean(out.respectAi);
  out.requireMarket = Boolean(out.requireMarket);
  return out;
}

/** The round trip's charges in rupees: Zerodha-style intraday equity on NSE (the journal's own calculation). */
function costOf(entry, exit, qty, long) {
  const buy = (long ? entry : exit) * qty;
  const sell = (long ? exit : entry) * qty;
  const p = chargeParts({ exchange: "NSE", turnoverBuy: buy, turnoverSell: sell, intraday: true });
  return p.brokerage + p.stt + p.exchange + p.sebi + p.gst + p.stamp;
}

/**
 * May this pick be taken now?
 * @param pick  a scanner row: { symbol, side, eligible, score, agree, plan, ai }
 * @param ctx   { now, openSymbols: Set, open: n, today: n, dayNetPct, lastClosed: { SYM: ms }, date, lean: number|null, levelEdge: { ev, pooledN }|null }
 * @returns { ok, why }
 */
function gate(pick, rules, ctx) {
  const no = (why) => ({ ok: false, why });
  if (!pick || !pick.eligible || !pick.side) return no("not eligible on the scanner");
  const p = pick.plan;
  if (!p || ![p.entry, p.stop, p.t1, p.t2].every(num) || !(Math.abs(p.entry - p.stop) > 0)) return no("no priced plan");
  const m = minOf(ctx.now);
  if (m < rules.entryFrom) return no("before 9:30: the opening range is still forming");
  if (m > rules.entryTo) return no("too late in the session for a new entry");
  const hour = Math.floor(m / 60);
  if (rules.blockHours.includes(hour)) return no(`${hour}:00 hour blocked by its own correction`);
  if (num(ctx.dayNetPct) && ctx.dayNetPct <= -rules.dayStopPct) return no("the day's loss limit is reached");
  if (ctx.today >= rules.maxTradesDay) return no("the day's trade limit is reached");
  if (ctx.open >= rules.maxOpen) return no("as many positions open as allowed");
  if (ctx.openSymbols.has(pick.symbol)) return no("already holding it");
  const until = rules.blockSymbols[pick.symbol];
  if (until && ctx.date < until) return no(`kept out of ${pick.symbol} until ${until} by its own correction`);
  const last = ctx.lastClosed[pick.symbol];
  if (num(last) && ctx.now - last < rules.cooldownMin * 60000) return no("closed it a moment ago");
  const mid = m >= 11 * 60 + 30 && m < 13 * 60 + 30;
  const need = rules.minScore + (mid ? rules.middayExtra : 0) + (rules.sideBump[pick.side] || 0);
  if (Math.abs(pick.score) < need) return no(`score ${Math.round(Math.abs(pick.score))} is under the ${need} needed${mid ? " in the midday lull" : ""}`);
  if ((pick.agree || 0) < rules.minAgree) return no(`only ${Math.round((pick.agree || 0) * 100)}% of the engines agree`);
  if (rules.respectAi && pick.ai && pick.ai.keep === false) return no("the AI's review dropped it");
  if (p.level && num(p.level.roomR) && p.level.roomR < rules.minRoomR) return no(`${p.level.name} is only ${p.level.roomR}R away`);
  const long = pick.side === "long";
  const q = Math.max(1, Math.floor((rules.capital * rules.maxPositionPct) / 100 / p.entry));
  const costR = (costOf(p.entry, p.entry, q, long) / q / Math.abs(p.entry - p.stop));
  if (costR > rules.maxCostR) return no(`charges would take ${r2(costR)}R of a stopped trade (the stop is only ${r2((Math.abs(p.entry - p.stop) / p.entry) * 100)}% away)`);
  if (ctx.levelEdge && num(ctx.levelEdge.ev) && ctx.levelEdge.ev < rules.minLevelEdge) return no(`the Level Book: this kind of level has averaged ${ctx.levelEdge.ev}R here`);
  if (rules.requireMarket && num(ctx.lean) && (pick.side === "long" ? ctx.lean < -20 : ctx.lean > 20)) return no("against the market's lean");
  return { ok: true, why: "" };
}

/** A new position from a pick, or null when it cannot be sized. */
function openPosition(pick, rules, { now, id, level = null, lean = null }) {
  const dir = pick.side === "long" ? 1 : -1;
  const p = pick.plan;
  const fill = r2(p.entry * (1 + (dir * rules.slipPct) / 100));
  const risk = Math.abs(fill - p.stop);
  if (!(risk > 0) || (dir > 0 ? p.stop >= fill : p.stop <= fill)) return null;
  const riskRs = (rules.capital * rules.riskPct) / 100;
  const qty = Math.min(Math.floor(riskRs / risk), Math.floor((rules.capital * rules.maxPositionPct) / 100 / fill));
  if (qty < 1) return null;
  const date = new Date(now + IST).toISOString().slice(0, 10);
  return {
    id,
    date,
    symbol: pick.symbol,
    side: pick.side,
    qty,
    qty0: qty,
    entryAt: now,
    entryClock: clockOf(now),
    entryAvg: fill,
    stop: p.stop,
    stop0: p.stop,
    t1: p.t1,
    t2: p.t2,
    risk: r2(risk),
    riskRs: r2(qty * risk),
    score: Math.round(Math.abs(pick.score)), // the strength of the call, whichever side
    agree: Math.round((pick.agree || 0) * 100),
    why: (pick.reasons || []).slice(0, 4).map((x) => (typeof x === "string" ? x : x && x.text) || "").filter(Boolean),
    knowledge: pick.knowledge && num(pick.knowledge.vote) ? pick.knowledge.vote : null,
    aiKept: pick.ai ? pick.ai.keep : null,
    lean: num(lean) ? Math.round(lean) : null,
    level: level || null,
    nextLevel: p.level || null,
    hour: Math.floor(minOf(now) / 60),
    midday: minOf(now) >= 11 * 60 + 30 && minOf(now) < 13 * 60 + 30,
    realised: 0,
    exits: [],
    peak: { price: fill, at: now, clock: clockOf(now) },
    trough: { price: fill, at: now, clock: clockOf(now) },
    t1Hit: false,
    beDone: false,
    trailLogged: 0,
    events: [],
    status: "open",
  };
}

const ev = (pos, now, kind, text, extra = {}) => pos.events.push({ at: now, clock: clockOf(now), kind, text, ...extra });
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;

/** Book `q` shares at `price` (already including slippage). */
function exitPart(pos, q, price, why, now, text) {
  const dir = pos.side === "long" ? 1 : -1;
  const n = Math.min(q, pos.qty);
  if (n <= 0) return;
  const px = r2(price);
  pos.exits.push({ at: now, clock: clockOf(now), price: px, qty: n, why });
  pos.realised += dir * (px - pos.entryAvg) * n;
  pos.qty -= n;
  ev(pos, now, why === "target1" ? "target" : "exit", text || `Out ${n} at ₹${px.toFixed(2)} (${why}).`, { price: px, qty: n });
  if (pos.qty <= 0) {
    pos.status = "closed";
    pos.exitAt = now;
    pos.exitClock = clockOf(now);
    pos.why = why;
  }
}

/**
 * One look at an open position at `price`. Mutates `pos`; closes it when everything is out.
 * @param ctx { flip: bool (the advisor now says the other side), reason: string }
 */
function step(pos, price, now, rules, ctx = {}) {
  if (pos.status !== "open" || !num(price) || price <= 0) return pos;
  const dir = pos.side === "long" ? 1 : -1;
  const slip = rules.slipPct / 100;
  if (dir * (price - pos.peak.price) > 0) pos.peak = { price, at: now, clock: clockOf(now) };
  if (dir * (price - pos.trough.price) < 0) pos.trough = { price, at: now, clock: clockOf(now) };
  const peakR = (dir * (pos.peak.price - pos.entryAvg)) / pos.risk;
  const gain = dir * (price - pos.entryAvg);
  const m = minOf(now);
  // the stop
  if (dir * (price - pos.stop) <= 0) {
    const fill = dir > 0 ? Math.min(price, pos.stop * (1 - slip)) : Math.max(price, pos.stop * (1 + slip));
    const kind = pos.stop === pos.stop0 ? "stop" : pos.stop === pos.entryAvg ? "break-even stop" : "trailing stop";
    exitPart(pos, pos.qty, fill, kind === "stop" ? "stop" : kind === "break-even stop" ? "break-even" : "trail", now, `${kind[0].toUpperCase()}${kind.slice(1)} hit: out ${pos.qty} at ₹${r2(fill).toFixed(2)} (${signed(pos.realised + dir * (fill - pos.entryAvg) * pos.qty)} on the trade).`);
    return pos;
  }
  // the first target: book a share, stop to the entry
  if (!pos.t1Hit && dir * (price - pos.t1) >= 0) {
    const part = pos.qty0 > 1 ? Math.min(pos.qty - 1, Math.max(1, Math.round((pos.qty0 * rules.t1Share) / 100))) : pos.qty;
    pos.t1Hit = true;
    exitPart(pos, part, pos.t1 * (1 - dir * slip), "target1", now, `First target ₹${pos.t1.toFixed(2)} reached: ${part} of ${pos.qty0} booked, stop moved to the entry.`);
    if (pos.status === "open" && dir * (pos.entryAvg - pos.stop) > 0) pos.stop = pos.entryAvg;
    if (pos.status !== "open") return pos;
  }
  // the second target: the rest
  if (dir * (price - pos.t2) >= 0) {
    exitPart(pos, pos.qty, pos.t2 * (1 - dir * slip), "target", now, `Second target ₹${pos.t2.toFixed(2)} reached: the rest is out.`);
    return pos;
  }
  // the stop to the entry once the gain reaches beR
  if (!pos.beDone && peakR >= rules.beR) {
    pos.beDone = true;
    if (dir * (pos.entryAvg - pos.stop) > 0) {
      pos.stop = pos.entryAvg;
      ev(pos, now, "stop", `+${r2(peakR)}R reached: the stop moved to the entry ₹${pos.entryAvg.toFixed(2)}.`, { price: pos.stop });
    }
  }
  // a trailing stop once the first target is behind it
  if (pos.t1Hit) {
    const trail = r2(pos.peak.price - dir * rules.trailR * pos.risk);
    if (dir * (trail - pos.stop) > 0) {
      pos.stop = trail;
      if (peakR - pos.trailLogged >= 0.25) {
        pos.trailLogged = peakR;
        ev(pos, now, "stop", `Trailing stop raised to ₹${trail.toFixed(2)} (best ₹${pos.peak.price.toFixed(2)}).`, { price: trail });
      }
    }
  }
  // gave back much of a good gain
  if (peakR >= 1) {
    const peakGain = dir * (pos.peak.price - pos.entryAvg);
    const given = peakGain > 0 ? ((peakGain - gain) / peakGain) * 100 : 0;
    if (given >= rules.giveBackPct) {
      exitPart(pos, pos.qty, price * (1 - dir * slip), "giveback", now, `Gave back ${Math.round(given)}% of its best gain (best +${r2(peakR)}R at ${pos.peak.clock}): out ${pos.qty} at ₹${price.toFixed(2)}.`);
      return pos;
    }
  }
  if (ctx.flip) {
    exitPart(pos, pos.qty, price * (1 - dir * slip), "flip", now, `${ctx.reason || "The advisor now says the other side"}: out ${pos.qty} at ₹${price.toFixed(2)}.`);
    return pos;
  }
  const sq = squareOf(now);
  if (m >= sq.min) {
    exitPart(pos, pos.qty, price * (1 - dir * slip), "square-off", now, `${sq.clock} square-off: out ${pos.qty} at ₹${price.toFixed(2)}.`);
    return pos;
  }
  if (now - pos.entryAt >= rules.maxHoldMin * 60000) {
    exitPart(pos, pos.qty, price * (1 - dir * slip), "time", now, `Held ${rules.maxHoldMin} minutes without a result: out ${pos.qty} at ₹${price.toFixed(2)}.`);
    return pos;
  }
  return pos;
}

/** The figures of a closed position: gross, charges, net, R, the best moment. Adds them to a copy. */
function finish(pos) {
  const dir = pos.side === "long" ? 1 : -1;
  const q = pos.exits.reduce((a, e) => a + e.qty, 0);
  const exitAvg = q ? r2(pos.exits.reduce((a, e) => a + e.price * e.qty, 0) / q) : pos.entryAvg;
  const pnl = r2(pos.exits.reduce((a, e) => a + dir * (e.price - pos.entryAvg) * e.qty, 0));
  const charges = r2(costOf(pos.entryAvg, exitAvg, pos.qty0, dir > 0));
  const net = r2(pnl - charges);
  const peakPnl = r2(dir * (pos.peak.price - pos.entryAvg) * pos.qty0);
  const t = {
    ...pos,
    exitAvg,
    pnl,
    charges,
    net,
    netR: pos.riskRs > 0 ? r2(net / pos.riskRs) : null,
    peakR: r2((dir * (pos.peak.price - pos.entryAvg)) / pos.risk),
    peakPnl,
    peakPct: r2((dir * (pos.peak.price - pos.entryAvg)) / pos.entryAvg * 100),
    holdMin: Math.round((pos.exitAt - pos.entryAt) / 60000),
  };
  t.outcome = outcomeOf(t);
  return t;
}

/** What became of the best moment, in the Trade Analysis classes (the trader's trades use the same). */
function outcomeOf(t) {
  const dir = t.side === "long" ? 1 : -1;
  const peak = { at: t.peak.at, clock: t.peak.clock, price: t.peak.price, pnl: t.peakPnl, kind: t.peakPnl > 0 ? "profit" : "least-loss" };
  const gap = Math.round((t.exitAt - t.peak.at) / 60000);
  const after = t.after && t.after.best ? t.after : null;
  const ranPnl = after ? r2(dir * (after.best.price - t.entryAvg) * t.qty0) : null;
  const read = {
    bestExit: peak,
    timing: { gapMin: Math.max(0, gap), leftOnTable: r2(Math.max(0, t.peakPnl - t.pnl)), efficiency: t.peakPnl > 0 ? Math.max(-100, Math.min(100, Math.round((t.pnl / t.peakPnl) * 100))) : null },
    mfePct: t.peakPct,
    ranOn: after ? r2(Math.max(0, dir * (after.best.price - t.exitAvg) * t.qty0)) : null,
    avoided: after && after.worst ? r2(Math.max(0, dir * (t.exitAvg - after.worst.price) * t.qty0)) : null,
    bestExitDay: after && ranPnl !== null ? { at: after.best.at, clock: clockOf(after.best.at), price: after.best.price, pnl: ranPnl } : null,
  };
  return classify({ intraday: true, pnl: t.pnl, net: t.net, exitAt: t.exitAt, exitClock: t.exitClock, read });
}

/** Follow a closed trade's symbol for 45 minutes after the exit: what the price did next. */
function watchAfter(t, price, now) {
  if (!t.after) t.after = { until: t.exitAt + 45 * 60000, best: null, worst: null };
  const dir = t.side === "long" ? 1 : -1;
  if (!num(price) || now > t.after.until) return false;
  if (!t.after.best || dir * (price - t.after.best.price) > 0) t.after.best = { price, at: now };
  if (!t.after.worst || dir * (price - t.after.worst.price) < 0) t.after.worst = { price, at: now };
  return true;
}

module.exports = { DEFAULTS, BOUNDS, clampRules, costOf, gate, openPosition, step, finish, outcomeOf, watchAfter, minOf, clockOf, SQUARE, squareOf };
