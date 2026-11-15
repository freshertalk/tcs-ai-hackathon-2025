"use strict";
// The Execution Lab (Trade Analysis): every closed intraday trade of a day replayed on that day's
// 1-minute bars, to measure HOW it was traded — not only what it made.
//
//   per trade   how far it went for you and against you (MFE / MAE), the share of the best move you
//               kept, what the price did after you left, where you came in (against VWAP, an
//               opening-range break, chasing the day's high or low, minutes after the open), and
//               what other exits would have made on the very same entry: a fixed 0.5% stop with a 1%
//               target (2R), a 0.5% trailing stop, a 0.5% stop moved to break-even at +0.5%, and
//               holding to 3:15 PM
//   the best    the best moment to have left, with its time and price — while you were in, and up to
//   exit        3:15 PM — which is the least loss when the trade never paid; how many minutes before
//               or after it you left; and when the desk's exit coach (trading/exitcoach.js) would
//               have said EXIT NOW on the same bars
//   behaviour   revenge trades (in within 10 minutes of a loss), trading after the day's stop or
//               target was reached, over-trading, the first five minutes, the last 30 minutes,
//               holding a loser, cutting a winner early, costs eating the profit
//   the day     an execution score (0–100) from the share kept, the behaviour and the costs
//   a period    the same, added up: which exit rule would have paid best on your own trades, what
//               each habit cost, profit by hour and by entry context, and the lessons in plain words
//
// Pure arithmetic on Zerodha's own fills and bars: no AI, no orders, no network (the bars are handed
// in). A replay is a measurement of the past, not a promise about the next trade.

const { replay: coachReplay } = require("../trading/exitcoach");

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const OPEN = (date) => Date.parse(`${date}T03:45:00Z`); // 9:15 AM IST
const OR_END = (date) => Date.parse(`${date}T04:00:00Z`); // 9:30 AM IST
const SQUARE = (date) => Date.parse(`${date}T09:45:00Z`); // 3:15 PM IST
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istHour = (ms) => new Date(ms + IST).getUTCHours();
const istClock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);

/** The exit rules every trade is replayed with (on the same entry and quantity). */
const RULES = [
  { id: "actual", name: "Your exits" },
  { id: "fixed", name: "Stop 0.5% · target 1% (2R)", stopPct: 0.5, targetPct: 1 },
  { id: "trail", name: "Trailing stop 0.5%", trailPct: 0.5 },
  { id: "breakeven", name: "Stop 0.5%, to break-even at +0.5%", stopPct: 0.5, bePct: 0.5 },
  { id: "close", name: "Hold to 3:15 PM" },
  { id: "coach", name: "The exit coach's EXIT NOW" },
];

const FLAGS = {
  revenge: { name: "Revenge trade", major: true, text: "In within 10 minutes of closing a loss." },
  afterStop: { name: "After the daily stop", major: true, text: "Taken after the day's loss had reached the daily stop." },
  afterTarget: { name: "After the daily target", major: true, text: "Taken after the day's profit had reached the target — the giveback risk." },
  overtrading: { name: "Over-trading", major: true, text: "Beyond the day's sixth trade." },
  heldLoser: { name: "Held a loser", major: true, text: "Went 1% or more against you and was held for over 30 minutes." },
  cutWinner: { name: "Cut a winner early", major: false, text: "Kept under 30% of a move of 1% or more." },
  firstMinutes: { name: "First five minutes", major: false, text: "Entered before 9:20 AM, while the opening auction settles." },
  late: { name: "Last 30 minutes", major: false, text: "Entered after 2:45 PM, with little time left before the square-off." },
  againstVwap: { name: "Against VWAP", major: false, text: "A long below VWAP, or a short above it." },
  chased: { name: "Chased the move", major: false, text: "A long in the top 10% of the day's range so far, or a short in the bottom 10%." },
  costs: { name: "Costs ate the profit", major: false, text: "Charges took half or more of the gross profit." },
};

/** The volume-weighted average price from the first bar up to (and including) the bar at `t`. */
function vwapAt(bars, t) {
  let pv = 0;
  let v = 0;
  for (const b of bars) {
    if (b.t > t) break;
    const vol = num(b.v) && b.v > 0 ? b.v : 1;
    pv += ((b.h + b.l + b.c) / 3) * vol;
    v += vol;
  }
  return v ? pv / v : null;
}

/**
 * One exit rule on one trade: walk the 1-minute bars from the entry to 3:15 PM. When a bar touches
 * both the stop and the target, the stop is taken (the cautious reading).
 */
function simulate(rule, trade, bars, date) {
  const s = trade.side === "long" ? 1 : -1;
  const e = trade.entryAvg;
  const q = trade.qty;
  const after = bars.filter((b) => b.t >= trade.entryAt - 60000 && b.t <= SQUARE(date));
  if (!after.length) return null;
  const done = (exit, how, at) => ({ exit: r2(exit), how, at, pnl: r2(s * (exit - e) * q) });
  if (rule.id === "close") {
    const last = after[after.length - 1];
    return done(last.c, "time", last.t);
  }
  let stop = rule.stopPct ? e * (1 - (s * rule.stopPct) / 100) : null;
  const target = rule.targetPct ? e * (1 + (s * rule.targetPct) / 100) : null;
  let best = e;
  for (const b of after) {
    if (rule.id === "trail") stop = best * (1 - (s * rule.trailPct) / 100);
    const hitStop = stop !== null && (s > 0 ? b.l <= stop : b.h >= stop);
    if (hitStop) return done(stop, rule.id === "trail" ? "trail" : Math.abs(stop - e) < 1e-9 ? "break-even" : "stop", b.t);
    if (target !== null && (s > 0 ? b.h >= target : b.l <= target)) return done(target, "target", b.t);
    best = s > 0 ? Math.max(best, b.h) : Math.min(best, b.l);
    if (rule.bePct && (s * (best - e)) / e >= rule.bePct / 100) stop = e;
  }
  const last = after[after.length - 1];
  return done(last.c, "time", last.t);
}

/** What the bars say about one closed intraday trade. */
function readTrade(trade, bars, date) {
  const s = trade.side === "long" ? 1 : -1;
  const q = trade.qty;
  const e = trade.entryAvg;
  const inside = bars.filter((b) => b.t >= trade.entryAt - 60000 && b.t <= trade.exitAt);
  const pre = bars.filter((b) => b.t >= OPEN(date) && b.t <= trade.entryAt);
  const later = bars.filter((b) => b.t > trade.exitAt && b.t <= SQUARE(date));
  const out = { bars: inside.length };
  if (inside.length) {
    const hi = Math.max(...inside.map((b) => b.h));
    const lo = Math.min(...inside.map((b) => b.l));
    const fav = Math.max(0, s > 0 ? hi - e : e - lo);
    const adv = Math.min(0, s > 0 ? lo - e : e - hi);
    out.mfe = r2(fav * q);
    out.mae = r2(adv * q);
    out.mfePct = r2((fav / e) * 100);
    out.maePct = r2((adv / e) * 100);
    out.capture = fav > 0 ? Math.round((trade.pnl / (fav * q)) * 100) : null;
  }
  if (later.length) {
    const hi = Math.max(...later.map((b) => b.h));
    const lo = Math.min(...later.map((b) => b.l));
    out.ranOn = r2(Math.max(0, s > 0 ? hi - trade.exitAvg : trade.exitAvg - lo) * q); // the move went on after you left
    out.avoided = r2(Math.max(0, s > 0 ? trade.exitAvg - lo : hi - trade.exitAvg) * q); // what leaving spared you
  }
  if (pre.length) {
    const vw = vwapAt(bars.filter((b) => b.t >= OPEN(date)), trade.entryAt);
    out.vwap = r2(vw);
    out.vsVwapPct = num(vw) ? r2(((e - vw) / vw) * 100) : null;
    const hi = Math.max(...pre.map((b) => b.h));
    const lo = Math.min(...pre.map((b) => b.l));
    out.rangePos = hi > lo ? Math.max(0, Math.min(100, Math.round(((e - lo) / (hi - lo)) * 100))) : null; // 0 = the day's low so far (or a new low), 100 = its high
    const or = bars.filter((b) => b.t >= OPEN(date) && b.t < OR_END(date));
    if (or.length && trade.entryAt >= OR_END(date)) {
      const oh = Math.max(...or.map((b) => b.h));
      const ol = Math.min(...or.map((b) => b.l));
      out.opening = e > oh ? "above the opening range" : e < ol ? "below the opening range" : "inside the opening range";
      out.orBreak = (s > 0 && e > oh) || (s < 0 && e < ol);
    }
  }
  out.minutesIn = Math.round((trade.entryAt - OPEN(date)) / 60000);

  // the best moment to have left: the bar where the position was worth most (the least loss when it never paid)
  const best = (list) => {
    let top = null;
    for (const b of list) {
      const px = s > 0 ? b.h : b.l;
      const v = s * (px - e) * q;
      if (!top || v > top.pnl) top = { at: b.t, clock: istClock(b.t), price: r2(px), pnl: r2(v) };
    }
    return top ? { ...top, kind: top.pnl > 0 ? "profit" : "least-loss" } : null;
  };
  const held = bars.filter((b) => b.t >= trade.entryAt && b.t <= trade.exitAt);
  const toClose = bars.filter((b) => b.t >= trade.entryAt && b.t <= SQUARE(date));
  out.bestExit = best(held.length ? held : inside);
  out.bestExitDay = best(toClose);
  let worst = null;
  for (const b of held.length ? held : inside) {
    const px = s > 0 ? b.l : b.h;
    const v = s * (px - e) * q;
    if (!worst || v < worst.pnl) worst = { at: b.t, clock: istClock(b.t), price: r2(px), pnl: r2(v) };
  }
  out.worst = worst;
  if (out.bestExit) {
    out.timing = {
      gapMin: Math.round((trade.exitAt - out.bestExit.at) / 60000), // minutes you stayed after the best moment
      leftOnTable: r2(out.bestExit.pnl - trade.pnl),
      efficiency: out.bestExit.pnl > 0 ? Math.max(-100, Math.min(100, Math.round((trade.pnl / out.bestExit.pnl) * 100))) : null,
    };
  }
  // the price path around the trade, for the chart (one point a minute)
  const from = trade.entryAt - 15 * 60000;
  const to = Math.min(SQUARE(date), Math.max(trade.exitAt, out.bestExitDay ? out.bestExitDay.at : 0) + 20 * 60000);
  out.path = bars.filter((b) => b.t >= from && b.t <= to).map((b) => [b.t, r2(b.c)]);
  return out;
}

/**
 * The timing of the exits over a set of replayed trades: the most that was on offer while you were in
 * (hindsight's ceiling), the share of it you took, what was left, how many exits came before and
 * after the best moment, and the same entries closed where the exit coach said EXIT NOW.
 */
function exitStats(replayed) {
  const xs = replayed.filter((t) => t.read && t.read.bestExit);
  if (!xs.length) return { bestPossible: null, efficiency: null, leftOnTable: null, early: 0, late: 0, onTime: 0, avgGapMin: null, coachNet: null, coachVsYours: null };
  const bestSum = xs.reduce((a, t) => a + Math.max(0, t.read.bestExit.pnl), 0);
  const took = xs.reduce((a, t) => a + t.pnl, 0);
  const gaps = xs.map((t) => t.read.timing.gapMin);
  const withCoach = xs.filter((t) => t.whatIf && t.whatIf.coach);
  const coachNet = withCoach.reduce((a, t) => a + t.whatIf.coach.net, 0);
  return {
    bestPossible: r2(bestSum),
    efficiency: bestSum > 0 ? Math.max(-100, Math.min(100, Math.round((took / bestSum) * 100))) : null,
    leftOnTable: r2(xs.reduce((a, t) => a + Math.max(0, t.read.timing.leftOnTable), 0)),
    late: gaps.filter((g) => g > 2).length, // stayed more than two minutes past the best moment
    onTime: gaps.filter((g) => g <= 2).length,
    early: xs.filter((t) => t.read.bestExitDay && t.read.bestExitDay.at > t.exitAt + 2 * 60000 && t.read.bestExitDay.pnl > Math.max(0, t.read.bestExit.pnl) * 1.2 + 1).length, // the bigger move came after you left
    avgGapMin: Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length),
    coachNet: withCoach.length ? r2(coachNet) : null,
    coachVsYours: withCoach.length ? r2(coachNet - withCoach.reduce((a, t) => a + t.net, 0)) : null,
  };
}

/**
 * The lab for one day.
 * @param trips   the day's closed round trips from the journal ({ key, symbol, side, entryAt, exitAt, entryAvg, exitAvg, maxQty|qty, pnl, charges, net, intraday })
 * @param bars    { SYMBOL: [{ t, o, h, l, c, v }] } — that day's 1-minute bars (a symbol may be missing)
 * @param limits  { stop, target } in ₹ for the day (from the daily goal), or null
 */
function labDay({ date, trips = [], bars = {}, limits = null, maxTrades = 6 }) {
  const closed = trips.filter((t) => !t.open && num(t.entryAt) && num(t.exitAt)).sort((a, b) => a.entryAt - b.entryAt);
  const notes = [];
  const trades = [];
  let i = 0;
  for (const t of closed) {
    i += 1;
    const same = istDate(t.entryAt) === date && istDate(t.exitAt) === date;
    const qty = t.maxQty || t.qty || 0;
    const base = { key: t.key || `${t.symbol}-${t.entryAt}`, symbol: t.symbol, side: t.side, qty, entryAt: t.entryAt, exitAt: t.exitAt, entryClock: istClock(t.entryAt), exitClock: istClock(t.exitAt), entryAvg: r2(t.entryAvg), exitAvg: r2(t.exitAvg), holdMin: Math.round((t.exitAt - t.entryAt) / 60000), pnl: r2(t.pnl), charges: r2(t.charges || 0), net: r2(num(t.net) ? t.net : t.pnl - (t.charges || 0)), n: i, intraday: same };
    const b = Array.isArray(bars[t.symbol]) ? bars[t.symbol].slice().sort((x, y) => x.t - y.t) : [];
    const read = same && b.length ? readTrade({ ...t, qty }, b, date) : null;
    const whatIf = {};
    if (same && b.length) {
      for (const rule of RULES.slice(1)) {
        if (rule.id === "coach") continue;
        const sim = simulate(rule, { ...t, qty }, b, date);
        if (sim) whatIf[rule.id] = { ...sim, net: r2(sim.pnl - base.charges) };
      }
      // the desk's exit coach on the same bars: its signals minute by minute, and where it said EXIT NOW
      const cr = coachReplay({ symbol: t.symbol, side: t.side, qty, entryAvg: t.entryAvg, entryAt: t.entryAt }, b);
      const end = cr.exit || (whatIf.close ? { at: whatIf.close.at, clock: istClock(whatIf.close.at), price: whatIf.close.exit, pnl: whatIf.close.pnl, why: "No EXIT NOW before 3:15 PM." } : null);
      if (end) {
        whatIf.coach = { exit: end.price, how: cr.exit && cr.exit.kind !== "time" ? "coach" : "time", at: end.at, pnl: end.pnl, net: r2(end.pnl - base.charges) };
        read.coach = { exit: { ...end, said: Boolean(cr.exit && cr.exit.kind !== "time") }, changes: cr.changes.slice(0, 12), gapMin: Math.round((t.exitAt - end.at) / 60000), vsYours: r2(end.pnl - t.pnl) };
      }
    }
    trades.push({ ...base, read, whatIf, flags: [] });
  }
  if (closed.some((t) => istDate(t.entryAt) !== istDate(t.exitAt))) notes.push("Trades held overnight are counted but left out of the replay: the lab replays intraday trades only.");
  if (trades.some((t) => t.intraday && !t.read)) notes.push("1-minute bars could not be read for some trades (they need the Zerodha connection; Zerodha keeps about 60 days of them): those trades are counted without the replay.");

  // behaviour, in the order the trades were taken
  for (const t of trades) {
    const before = trades.filter((x) => x.exitAt <= t.entryAt);
    const dayNet = before.reduce((a, x) => a + x.net, 0);
    const lastLoss = before.filter((x) => x.net < 0).sort((a, b) => b.exitAt - a.exitAt)[0];
    const f = t.flags;
    if (lastLoss && t.entryAt - lastLoss.exitAt <= 10 * 60000) f.push("revenge");
    if (limits && num(limits.stop) && limits.stop > 0 && dayNet <= -limits.stop) f.push("afterStop");
    if (limits && num(limits.target) && limits.target > 0 && dayNet >= limits.target) f.push("afterTarget");
    if (t.n > maxTrades) f.push("overtrading");
    if (t.intraday && t.read) {
      const r = t.read;
      if (num(r.maePct) && r.maePct <= -1 && t.holdMin > 30 && t.net < 0) f.push("heldLoser");
      if (num(r.mfePct) && r.mfePct >= 1 && num(r.capture) && r.capture < 30) f.push("cutWinner");
      if (num(r.minutesIn) && r.minutesIn < 5) f.push("firstMinutes");
      if (num(r.minutesIn) && r.minutesIn > 330) f.push("late");
      if (num(r.vsVwapPct) && ((t.side === "long" && r.vsVwapPct < 0) || (t.side === "short" && r.vsVwapPct > 0))) f.push("againstVwap");
      if (num(r.rangePos) && ((t.side === "long" && r.rangePos >= 90) || (t.side === "short" && r.rangePos <= 10))) f.push("chased");
    }
    if (t.pnl > 0 && t.charges >= t.pnl * 0.5) f.push("costs");
  }

  const sum = (xs, f) => r2(xs.reduce((a, x) => a + (f(x) || 0), 0));
  const replayed = trades.filter((t) => t.read);
  const mfeSum = replayed.reduce((a, t) => a + (t.read.mfe || 0), 0);
  const capture = mfeSum > 0 ? Math.round((replayed.reduce((a, t) => a + t.pnl, 0) / mfeSum) * 100) : null;
  const rules = RULES.map((rule) => {
    if (rule.id === "actual") return { id: rule.id, name: rule.name, net: sum(replayed, (t) => t.net), trades: replayed.length };
    const xs = replayed.filter((t) => t.whatIf[rule.id]);
    return { id: rule.id, name: rule.name, net: sum(xs, (t) => t.whatIf[rule.id].net), trades: xs.length };
  });
  const actual = rules[0].net;
  for (const r of rules) r.vsActual = r2(r.net - actual);
  const flagRows = Object.entries(FLAGS)
    .map(([id, x]) => {
      const xs = trades.filter((t) => t.flags.includes(id));
      return { id, name: x.name, major: x.major, text: x.text, count: xs.length, net: sum(xs, (t) => t.net) };
    })
    .filter((x) => x.count);
  const gross = sum(trades, (t) => t.pnl);
  const charges = sum(trades, (t) => t.charges);
  const net = sum(trades, (t) => t.net);
  const major = flagRows.filter((x) => x.major).reduce((a, x) => a + x.count, 0);
  const minor = flagRows.filter((x) => !x.major).reduce((a, x) => a + x.count, 0);
  let score = null;
  if (trades.length) {
    score = 70 + (num(capture) ? Math.max(-20, Math.min(20, (capture - 40) / 2)) : 0) - 8 * major - 3 * minor - (gross > 0 && charges >= gross * 0.4 ? 10 : 0);
    score = Math.round(Math.max(0, Math.min(100, score)));
  }
  return {
    date,
    trades,
    summary: { trades: trades.length, replayed: replayed.length, gross, charges, net, capture, ranOn: sum(replayed, (t) => t.read.ranOn), avoided: sum(replayed, (t) => t.read.avoided), score, label: score === null ? "—" : score >= 75 ? "Disciplined" : score >= 50 ? "Mixed" : "Leaky", ...exitStats(replayed) },
    rules,
    best: rules.slice(1).filter((r) => r.trades).sort((a, b) => b.net - a.net)[0] || null,
    flags: flagRows,
    limits: limits && (num(limits.stop) || num(limits.target)) ? { stop: r2(limits.stop), target: r2(limits.target) } : null,
    notes,
  };
}

/**
 * Many days' labs added up, with the lessons in plain words.
 * @param labs [labDay(...)]
 */
function labRange(labs) {
  const days = labs.filter((l) => l && l.trades && l.trades.length);
  const trades = days.flatMap((d) => d.trades);
  const replayed = trades.filter((t) => t.read);
  const sum = (xs, f) => r2(xs.reduce((a, x) => a + (f(x) || 0), 0));
  const mfeSum = replayed.reduce((a, t) => a + (t.read.mfe || 0), 0);
  const capture = mfeSum > 0 ? Math.round((replayed.reduce((a, t) => a + t.pnl, 0) / mfeSum) * 100) : null;
  const rules = RULES.map((rule) => {
    if (rule.id === "actual") return { id: rule.id, name: rule.name, net: sum(replayed, (t) => t.net), trades: replayed.length, wins: replayed.filter((t) => t.net > 0).length };
    const xs = replayed.filter((t) => t.whatIf[rule.id]);
    return { id: rule.id, name: rule.name, net: sum(xs, (t) => t.whatIf[rule.id].net), trades: xs.length, wins: xs.filter((t) => t.whatIf[rule.id].net > 0).length };
  });
  for (const r of rules) r.vsActual = r2(r.net - rules[0].net);
  const flags = Object.entries(FLAGS)
    .map(([id, x]) => {
      const xs = trades.filter((t) => t.flags.includes(id));
      return { id, name: x.name, major: x.major, text: x.text, count: xs.length, net: sum(xs, (t) => t.net), wins: xs.filter((t) => t.net > 0).length };
    })
    .filter((x) => x.count)
    .sort((a, b) => a.net - b.net);
  const byHour = [];
  for (let h = 9; h <= 15; h += 1) {
    const xs = trades.filter((t) => istHour(t.entryAt) === h);
    if (xs.length) byHour.push({ hour: h, label: `${h > 12 ? h - 12 : h}${h >= 12 ? " PM" : " AM"}`, trades: xs.length, net: sum(xs, (t) => t.net), wins: xs.filter((t) => t.net > 0).length });
  }
  const ctx = (pred) => {
    const xs = replayed.filter(pred);
    return { trades: xs.length, net: sum(xs, (t) => t.net), wins: xs.filter((t) => t.net > 0).length };
  };
  const context = [
    { id: "withVwap", name: "With VWAP (long above, short below)", ...ctx((t) => num(t.read.vsVwapPct) && ((t.side === "long" && t.read.vsVwapPct >= 0) || (t.side === "short" && t.read.vsVwapPct <= 0))) },
    { id: "againstVwap", name: "Against VWAP", ...ctx((t) => t.flags.includes("againstVwap")) },
    { id: "orBreak", name: "Opening-range break", ...ctx((t) => t.read.orBreak === true) },
    { id: "chased", name: "Chasing the day's high / low", ...ctx((t) => t.flags.includes("chased")) },
    { id: "long", name: "Longs", ...ctx((t) => t.side === "long") },
    { id: "short", name: "Shorts", ...ctx((t) => t.side === "short") },
  ].filter((x) => x.trades);
  const scores = days.map((d) => d.summary.score).filter(num);
  const best = rules.slice(1).filter((r) => r.trades).sort((a, b) => b.net - a.net)[0] || null;
  const rs = (x) => `₹${Math.round(Math.abs(x)).toLocaleString("en-IN")}`;
  const lessons = [];
  if (best && best.vsActual > 0 && best.trades >= 5) lessons.push(`“${best.name}” would have made ${rs(best.vsActual)} more than your own exits on the same ${best.trades} entries.`);
  else if (best && best.vsActual < 0 && best.trades >= 5) lessons.push(`Your own exits beat every fixed rule tested, by at least ${rs(-best.vsActual)} — your exit timing is a strength.`);
  const worst = flags.filter((x) => x.net < 0 && x.count >= 2)[0];
  if (worst) lessons.push(`${worst.name}: ${worst.count} trades, ${worst.net < 0 ? "−" : ""}${rs(worst.net)} net${worst.wins ? ` (${worst.wins} won)` : ""}. ${worst.text}`);
  const against = context.find((x) => x.id === "againstVwap");
  const withV = context.find((x) => x.id === "withVwap");
  if (against && withV && against.trades >= 3 && against.net < withV.net) lessons.push(`Against VWAP you made ${against.net < 0 ? "−" : ""}${rs(against.net)} on ${against.trades} trades; with VWAP ${withV.net < 0 ? "−" : ""}${rs(withV.net)} on ${withV.trades}.`);
  const hourBad = byHour.filter((x) => x.trades >= 3).sort((a, b) => a.net - b.net)[0];
  if (hourBad && hourBad.net < 0) lessons.push(`Your weakest hour is ${hourBad.label}: ${hourBad.trades} trades, −${rs(hourBad.net)} net.`);
  if (num(capture) && capture < 40 && replayed.length >= 5) lessons.push(`You kept ${capture}% of the best move on average; after your exits the price ran on by ${rs(sum(replayed, (t) => t.read.ranOn))} in all.`);
  return {
    days: days.length,
    summary: { trades: trades.length, replayed: replayed.length, net: sum(trades, (t) => t.net), gross: sum(trades, (t) => t.pnl), charges: sum(trades, (t) => t.charges), capture, ranOn: sum(replayed, (t) => t.read.ranOn), avoided: sum(replayed, (t) => t.read.avoided), score: scores.length ? Math.round(scores.reduce((a, x) => a + x, 0) / scores.length) : null, ...exitStats(replayed) },
    rules,
    best,
    flags,
    byHour,
    context,
    lessons,
    trend: days.map((d) => ({ date: d.date, net: d.summary.net, score: d.summary.score, capture: d.summary.capture, efficiency: d.summary.efficiency ?? null, leftOnTable: d.summary.leftOnTable ?? null })).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

module.exports = { labDay, labRange, simulate, readTrade, vwapAt, exitStats, RULES, FLAGS };
