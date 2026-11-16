"use strict";
// After the close: the robot's paper day set against the trader's actual day — both told the same way.
//
//   PAIRS       a stock both traded on the same side while the other was in it: who came in earlier, who came
//               in at the better price, who left at the better price, and what each made
//   ROBOT ONLY  the advisor's calls the robot took and the trader did not, with what they made
//   YOU ONLY    the trader's trades the robot did not take, and why not (what the robot wrote down the
//               first time it looked at the stock: not eligible, score too low, a blocked hour…)
//   HABITS      the trader's costly habits of the day (the Execution Lab's flags) and the rule the robot
//               trades by that stands against each
//   BEST MOMENTS the share of each trade's best moment kept, by the trader and by the robot
//
// Arithmetic on two lists of finished trades. No AI, no network, no clock, no orders. A comparison of one
// day is a small sample: the page says so, and the lessons are phrased as what happened, never as what
// will.

const { FLAGS } = require("../analysis/lab");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const rs = (x) => (num(x) ? `${x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
const sg = (x) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");

/** The rule the robot trades by that stands against each of the trader's habits. */
const ANSWER = {
  revenge: "The robot waits 30 minutes before it enters the same stock again.",
  afterStop: "The robot takes no new entry once the day is down 1.5% of its capital.",
  afterTarget: "The robot's give-back exit and trailing stop protect a good day.",
  overtrading: "The robot takes at most eight trades a day and three at a time.",
  heldLoser: "The robot's stop is placed with the entry and is only ever moved towards the price.",
  cutWinner: "The robot books half at the first target and trails the rest.",
  firstMinutes: "The robot takes no entry before 9:30.",
  late: "The robot takes no entry after 2:30 PM.",
  againstVwap: "The robot only takes the scanner's eligible calls, which weigh VWAP.",
  chased: "The robot's gate skips a call with a level in the way.",
  costs: "The robot's size comes from the risk to the stop, and the costs are taken off every trade.",
};

const stats = (list) => {
  const done = list.filter((t) => num(t.net));
  const eff = list.filter((t) => num(t.efficiency));
  return {
    trades: list.length,
    net: r2(sum(done, (t) => t.net)),
    wins: done.filter((t) => t.net > 0).length,
    winPct: done.length ? Math.round((done.filter((t) => t.net > 0).length / done.length) * 100) : null,
    leftOnTable: r2(sum(list, (t) => t.leftOnTable)),
    efficiency: eff.length ? Math.round(sum(eff, (t) => t.efficiency) / eff.length) : null,
  };
};

/** The shape both sides are compared in. */
const norm = (t, who) => ({
  who,
  key: t.key || t.id,
  symbol: t.symbol,
  side: t.side,
  qty: t.qty0 || t.qty,
  entryAt: t.entryAt,
  exitAt: t.exitAt,
  entryClock: t.entryClock,
  exitClock: t.exitClock,
  entryAvg: t.entryAvg,
  exitAvg: t.exitAvg,
  net: t.net,
  pnl: t.pnl,
  peakClock: t.peak ? t.peak.clock : null,
  peakPnl: num(t.peakPnl) ? t.peakPnl : t.peak && num(t.peak.pnl) ? t.peak.pnl : null,
  leftOnTable: num(t.leftOnTable) ? t.leftOnTable : num(t.peakPnl) ? Math.max(0, t.peakPnl - (t.pnl || 0)) : null,
  efficiency: num(t.efficiency) ? t.efficiency : num(t.peakPnl) && t.peakPnl > 0 ? Math.max(-100, Math.min(100, Math.round(((t.pnl || 0) / t.peakPnl) * 100))) : null,
  outcome: t.outcome ? { id: t.outcome.id, name: t.outcome.name, tone: t.outcome.tone } : null,
  flags: t.flags || [],
  why: t.why || null,
});

/**
 * @param date    "YYYY-MM-DD"
 * @param robot   the robot's finished trades of the day (engine.finish)
 * @param actual  the trader's trades of the day (the Trade Analysis snapshot's trades)
 * @param skips   the robot's decisions of the day: [{ symbol, action: "skip"|"enter", why, at }]
 */
function compareDay({ date, robot = [], actual = [], skips = [] }) {
  const R = robot.map((t) => norm(t, "robot"));
  const Y = actual.map((t) => norm(t, "you"));
  const used = new Set();
  const pairs = [];
  for (const y of Y) {
    let best = null;
    R.forEach((r, i) => {
      if (used.has(i) || r.symbol !== y.symbol || r.side !== y.side || !(r.entryAt <= y.exitAt && y.entryAt <= r.exitAt)) return;
      const d = Math.abs(r.entryAt - y.entryAt);
      if (!best || d < best.d) best = { i, d };
    });
    if (best) {
      used.add(best.i);
      const r = R[best.i];
      const dir = y.side === "long" ? 1 : -1;
      pairs.push({
        symbol: y.symbol,
        side: y.side,
        you: y,
        robot: r,
        youLaterMin: Math.round((y.entryAt - r.entryAt) / 60000),
        entryEdgePct: r2((dir * (r.entryAvg - y.entryAvg) / r.entryAvg) * 100), // + : you came in at the better price
        exitEdgePct: r2((dir * (y.exitAvg - r.exitAvg) / r.entryAvg) * 100), // + : you left at the better price
        netDiff: r2(y.net - r.net), // + : you made more
        better: Math.abs(y.net - r.net) < 1 ? "same" : y.net > r.net ? "you" : "robot",
      });
    }
  }
  const youPaired = new Set(pairs.map((p) => p.you.key));
  const robotOnly = R.filter((_, i) => !used.has(i));
  const reasonFor = (sym) => {
    const rows = skips.filter((s) => s.symbol === sym && s.action === "skip");
    if (rows.length) return rows[rows.length - 1].why;
    return "the scanner never listed it as eligible";
  };
  const youOnly = Y.filter((y) => !youPaired.has(y.key)).map((y) => ({ ...y, reason: reasonFor(y.symbol) }));
  const you = stats(Y);
  const bot = stats(R);
  const gap = r2((bot.net || 0) - (you.net || 0));
  // the trader's habits of the day
  const counts = {};
  for (const y of Y) for (const f of y.flags || []) counts[f] = (counts[f] || 0) + 1;
  const habits = Object.entries(counts)
    .filter(([id]) => FLAGS[id])
    .map(([id, n]) => ({ id, name: FLAGS[id].name, count: n, net: r2(sum(Y.filter((y) => (y.flags || []).includes(id)), (y) => y.net)), answer: ANSWER[id] || "" }))
    .sort((a, b) => a.net - b.net);
  // the lessons, in plain words
  const lessons = [];
  if (R.length && !Y.length) lessons.push(`The robot took ${R.length} trade${R.length === 1 ? "" : "s"} and made ${sg(bot.net)}; you took none.`);
  else if (!R.length && Y.length) lessons.push(`You took ${Y.length} trade${Y.length === 1 ? "" : "s"} and made ${sg(you.net)}; the robot took none.`);
  else if (R.length || Y.length) lessons.push(`The robot took ${R.length} trade${R.length === 1 ? "" : "s"} and made ${sg(bot.net)}; you took ${Y.length} and made ${sg(you.net)}${R.length && Y.length ? ` — ${gap >= 0 ? "the robot" : "you"} made ${rs(Math.abs(gap))} more` : ""}.`);
  if (pairs.length) {
    const rb = pairs.filter((p) => p.better === "robot");
    const yb = pairs.filter((p) => p.better === "you");
    const entry = pairs.reduce((a, p) => a + (p.entryEdgePct || 0), 0) / pairs.length;
    const exit = pairs.reduce((a, p) => a + (p.exitEdgePct || 0), 0) / pairs.length;
    lessons.push(`On the ${pairs.length} stock${pairs.length === 1 ? "" : "s"} you both traded the robot made more on ${rb.length} and you on ${yb.length}. On average you came in ${Math.abs(r2(entry))}% ${entry >= 0 ? "better" : "worse"} than the robot and left ${Math.abs(r2(exit))}% ${exit >= 0 ? "better" : "worse"}.`);
    const late = pairs.filter((p) => p.youLaterMin >= 5).length;
    if (late >= 2) lessons.push(`You came in five minutes or more after the robot on ${late} of them: the advisor's call was there first.`);
  }
  if (robotOnly.length) lessons.push(`${robotOnly.length} advisor call${robotOnly.length === 1 ? "" : "s"} you did not take made ${sg(sum(robotOnly, (t) => t.net))} on paper (${robotOnly.filter((t) => t.net > 0).length} won).`);
  if (youOnly.length) {
    const bad = youOnly.filter((t) => t.net < 0);
    lessons.push(`${youOnly.length} of your trade${youOnly.length === 1 ? "" : "s"} the robot did not take made ${sg(sum(youOnly, (t) => t.net))}${bad.length ? `; the ${bad.length} loser${bad.length === 1 ? "" : "s"} cost ${rs(-sum(bad, (t) => t.net))}` : ""}.`);
  }
  if (num(you.efficiency) && num(bot.efficiency)) lessons.push(`You kept ${you.efficiency}% of your trades' best moments on average; the robot kept ${bot.efficiency}%.`);
  if (habits[0] && habits[0].net < 0) lessons.push(`${habits[0].name} cost you ${rs(-habits[0].net)} (${habits[0].count}×). ${habits[0].answer}`);
  return { date, available: true, you, robot: bot, gap, pairs, robotOnly, youOnly, habits, lessons, sample: "One day is a small sample. The comparison says what happened on this day, not what will happen next." };
}

/** The comparisons of many days added up. @param days [compareDay(...)] */
function compareRange(days) {
  const d = days.filter((x) => x && x.available);
  const n = d.length;
  return {
    days: n,
    youNet: r2(sum(d, (x) => x.you.net)),
    robotNet: r2(sum(d, (x) => x.robot.net)),
    gap: r2(sum(d, (x) => x.gap)),
    robotAhead: d.filter((x) => x.gap > 0).length,
    youAhead: d.filter((x) => x.gap < 0).length,
    pairs: sum(d, (x) => x.pairs.length),
    series: d.map((x) => ({ date: x.date, you: x.you.net, robot: x.robot.net, gap: x.gap })).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

module.exports = { compareDay, compareRange, ANSWER };
