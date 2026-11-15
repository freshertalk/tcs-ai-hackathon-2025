"use strict";
// The coach's comparison: one day's trading set against the trader's own history, fairly.
//
//   today vs usual   the day's score, share of the move kept, exit efficiency, trades, win rate and
//                    net beside the average of the earlier days — said to be better or worse only
//                    when the history is long enough and the gap is real
//   to prevent       the habits that cost money: each one seen today, and each one that keeps
//                    coming back, with what it has cost so far and one concrete rule to stop it
//   to keep          what works: the ways of entering that pay, a habit that stayed away today, a
//                    figure that beat the usual, an exit taken close to the coach's signal, a streak
//   similar days     the earlier days most like this one (how many trades, when the first came, how
//                    many against VWAP, the habits, the result) and how they ended
//   similar trades   for each of today's trades, the earlier trades taken the same way (side, hour,
//                    with or against VWAP, an opening-range break) — how they did, and which exit
//                    would have served them best
//
// Arithmetic on the Execution Lab's replays (lab.js): no AI, no network. Counts and sums of the
// trader's own past trades — evidence with a sample size, never a promise about the next trade.

const { FLAGS, RULES } = require("./lab");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const avg = (xs) => (xs.length ? sum(xs, (x) => x) / xs.length : null);
const rs = (x) => (num(x) ? `${x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
const IST = 5.5 * 3600 * 1000;
const hourOf = (ms) => new Date(ms + IST).getUTCHours();
const minuteOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes() - 555; // minutes after 9:15
};
const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** One concrete rule for each habit. */
const ACTION = {
  revenge: "After a losing exit, wait 15 minutes before the next entry. The order ticket warns you when you come back sooner — stop when it does.",
  afterStop: "When the day's loss reaches the daily stop, the day is over. Switch on “lock new trades at the stop” in the Risk guard so the desk refuses the next order.",
  afterTarget: "At the day's target, stop — or go on at half size with the stop at break-even. The Goal pill tells you the moment it is reached.",
  overtrading: "Cap the day at six trades (Risk guard → trades a day). The seventh trade is rarely a plan.",
  heldLoser: "Put the stop in with the entry and never move it away. When the Live board says EXIT NOW on a losing position, leave on that tick.",
  cutWinner: "Once a trade is +0.5%, stop exiting by feel: trail the stop the Live board shows and let the stop take you out.",
  firstMinutes: "No entry before 9:20 AM. Let the first five minutes print the opening range.",
  late: "No new entry after 2:45 PM: there is too little time before the 3:15 square-off.",
  againstVwap: "Longs only above VWAP, shorts only below it. Wait for the price to reclaim VWAP before the entry.",
  chased: "Do not buy the top tenth of the day's range or sell the bottom tenth: wait for a pullback towards VWAP.",
  costs: "Skip trades whose likely move is under three times the charges: small scalps hand the profit to costs.",
};

/** The figures of one day's lab that are compared. */
function dayStats(lab) {
  const t = lab.trades || [];
  const wins = t.filter((x) => x.net > 0);
  const losses = t.filter((x) => x.net < 0);
  const replayed = t.filter((x) => x.read);
  const against = replayed.filter((x) => x.flags.includes("againstVwap")).length;
  return {
    date: lab.date,
    trades: t.length,
    net: lab.summary.net,
    score: lab.summary.score,
    capture: lab.summary.capture,
    efficiency: lab.summary.efficiency ?? null,
    winRate: t.length ? Math.round((wins.length / t.length) * 100) : null,
    holdWin: wins.length ? Math.round(avg(wins.map((x) => x.holdMin))) : null,
    holdLoss: losses.length ? Math.round(avg(losses.map((x) => x.holdMin))) : null,
    firstMin: t.length ? minuteOf(Math.min(...t.map((x) => x.entryAt))) : null,
    againstShare: replayed.length ? against / replayed.length : 0,
    major: (lab.flags || []).filter((f) => f.major).reduce((a, f) => a + f.count, 0),
    flagIds: (lab.flags || []).map((f) => f.id),
  };
}

/** How one of today's trades was taken, for finding the earlier ones like it. */
function shape(t) {
  const r = t.read || {};
  return { side: t.side, hour: hourOf(t.entryAt), vwap: !num(r.vsVwapPct) ? null : (t.side === "long" ? r.vsVwapPct >= 0 : r.vsVwapPct <= 0) ? "with" : "against", orBreak: r.orBreak === true, chased: t.flags.includes("chased"), symbol: t.symbol };
}
const alike = (a, b) => a.side === b.side && Math.abs(a.hour - b.hour) <= 1 && a.vwap !== null && a.vwap === b.vwap && a.orBreak === b.orBreak;
const describe = (x) => `${x.side === "long" ? "Longs" : "Shorts"} ${x.vwap === "with" ? "with" : "against"} VWAP${x.orBreak ? " on an opening-range break" : ""} around ${x.hour > 12 ? x.hour - 12 : x.hour} ${x.hour >= 12 ? "PM" : "AM"}`;

/**
 * @param today    the lab of the day being read (labDay's result)
 * @param history  the labs of earlier days, any order
 */
function compareDay(today, history = []) {
  const past = history.filter((l) => l && l.date < today.date && l.trades && l.trades.length).sort((a, b) => (a.date < b.date ? 1 : -1));
  const t = dayStats(today);
  const ps = past.map(dayStats);
  const enough = ps.length >= 3;
  const mean = (k) => {
    const v = ps.map((x) => x[k]).filter(num);
    return v.length ? avg(v) : null;
  };
  const baseline = { days: ps.length, trades: r2(mean("trades")), net: r2(mean("net")), score: Math.round(mean("score") ?? NaN) || null, capture: Math.round(mean("capture") ?? NaN) || null, efficiency: Math.round(mean("efficiency") ?? NaN) || null, winRate: Math.round(mean("winRate") ?? NaN) || null, holdWin: Math.round(mean("holdWin") ?? NaN) || null, holdLoss: Math.round(mean("holdLoss") ?? NaN) || null };

  /* ---- today against the usual */
  const row = (id, name, unit, margin, higherIsBetter = true) => {
    const a = t[id];
    const b = baseline[id];
    let better = null;
    if (enough && num(a) && num(b) && Math.abs(a - b) >= margin) better = higherIsBetter ? a > b : a < b;
    return { id, name, unit, today: num(a) ? a : null, usual: num(b) ? b : null, better };
  };
  const versus = [row("score", "Execution score", "/100", 6), row("capture", "Share of the move kept", "%", 8), row("efficiency", "Exit efficiency", "%", 8), row("winRate", "Trades won", "%", 10), row("trades", "Trades taken", "", 2, false), row("net", "Net after charges", "₹", Math.max(200, Math.abs(baseline.net || 0) * 0.25)), row("holdLoss", "Minutes in a losing trade", "min", 5, false)];

  /* ---- the habits: what to prevent */
  const histTrades = past.flatMap((l) => l.trades);
  const prevent = [];
  const keep = [];
  for (const [id, f] of Object.entries(FLAGS)) {
    const now = (today.flags || []).find((x) => x.id === id);
    const hx = histTrades.filter((x) => x.flags.includes(id));
    const days = past.filter((l) => (l.flags || []).some((x) => x.id === id)).length;
    const hist = { count: hx.length, net: r2(sum(hx, (x) => x.net)), days, wins: hx.filter((x) => x.net > 0).length };
    const recurring = hx.length >= 3 && hist.net < 0 && ps.length > 0 && days / ps.length >= 0.3;
    if (now || recurring) {
      const kind = now && hist.count ? "again" : now ? "new" : "watch";
      const evidence = hist.count ? `${hist.count} time${hist.count === 1 ? "" : "s"} on ${days} of your last ${ps.length} trading day${ps.length === 1 ? "" : "s"}: ${rs(hist.net)} net${hist.wins ? `, ${hist.wins} won` : ""}.` : "Not seen in your earlier days on record.";
      prevent.push({ id, habit: f.name, major: f.major, what: f.text, kind, today: now ? { count: now.count, net: now.net } : null, history: hist, evidence, action: ACTION[id], cost: r2((now ? now.net : 0) + hist.net) });
    } else if (hist.count >= 2 && days / Math.max(1, ps.length) >= 0.3 && (today.trades || []).length) {
      keep.push({ id: `clean-${id}`, text: `No “${f.name.toLowerCase()}” today — it showed on ${days} of your last ${ps.length} days and cost ${rs(Math.abs(hist.net))}. Keep it away.`, weight: Math.abs(hist.net) });
    }
  }
  prevent.sort((a, b) => (a.today ? 0 : 1) - (b.today ? 0 : 1) || (a.cost || 0) - (b.cost || 0));

  /* ---- what to keep */
  for (const v of versus) {
    if (v.better !== true || v.id === "trades") continue;
    keep.push({ id: `better-${v.id}`, text: `${v.name}: ${v.unit === "₹" ? rs(v.today) : `${v.today}${v.unit}`} today against your usual ${v.unit === "₹" ? rs(v.usual) : `${v.usual}${v.unit}`}. Whatever you did differently today, do it again.`, weight: 500 });
  }
  const all = [...histTrades, ...(today.trades || [])].filter((x) => x.read);
  const ctx = (name, pred) => {
    const xs = all.filter(pred);
    const net = sum(xs, (x) => x.net);
    const wins = xs.filter((x) => x.net > 0).length;
    if (xs.length >= 5 && net > 0 && wins / xs.length >= 0.55) keep.push({ id: `ctx-${name}`, text: `${name} works for you: ${xs.length} trades, ${Math.round((wins / xs.length) * 100)}% won, ${rs(net)} net. Keep to it.`, weight: net });
  };
  ctx("Entering with VWAP (longs above it, shorts below)", (x) => num(x.read.vsVwapPct) && !x.flags.includes("againstVwap"));
  ctx("Trading the opening-range break", (x) => x.read.orBreak === true);
  ctx("Trades with no habit flagged", (x) => x.flags.length === 0);
  for (const x of (today.trades || []).filter((y) => y.read && y.read.coach && y.read.coach.exit && y.read.coach.exit.said)) {
    if (Math.abs(x.read.coach.gapMin) <= 3 && x.net > 0) keep.push({ id: `coach-${x.key}`, text: `${x.symbol}: you left within ${Math.abs(x.read.coach.gapMin)} minute${Math.abs(x.read.coach.gapMin) === 1 ? "" : "s"} of the exit coach's EXIT NOW (${x.read.coach.exit.clock}) and kept ${rs(x.net)}. That is the discipline.`, weight: x.net });
  }
  let clean = 0;
  for (const l of [today, ...past]) {
    if ((l.flags || []).some((f) => f.major)) break;
    clean += 1;
  }
  if (clean >= 2) keep.push({ id: "streak", text: `${clean} trading days in a row without a costly habit (revenge, trading past the stop or the target, over-trading, a held loser). Protect the streak.`, weight: 1000 });
  keep.sort((a, b) => b.weight - a.weight);

  /* ---- the earlier days most like this one */
  const vec = (x) => [Math.min(2, x.trades / 6), (x.firstMin ?? 60) / 375, x.againstShare, Math.min(1, x.major / 3), x.net > 0 ? 1 : x.net < 0 ? -1 : 0, (x.capture ?? 40) / 100];
  const W = [1, 0.6, 0.8, 1, 0.7, 0.5];
  const tv = vec(t);
  const similarDays = ps
    .map((x) => {
      const v = vec(x);
      return { x, d: Math.sqrt(v.reduce((a, c, i) => a + W[i] * (c - tv[i]) ** 2, 0)) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .filter((y) => y.d <= 1.1)
    .map(({ x }) => {
      const shared = x.flagIds.filter((id) => t.flagIds.includes(id) && FLAGS[id].major).map((id) => FLAGS[id].name.toLowerCase());
      return { date: x.date, label: dayLabel(x.date), trades: x.trades, net: x.net, score: x.score, capture: x.capture, shared, text: `${dayLabel(x.date)}: ${x.trades} trade${x.trades === 1 ? "" : "s"}, ${rs(x.net)} net, score ${x.score ?? "—"}${shared.length ? ` — the same ${shared.join(" and ")}` : ""}.` };
    });

  /* ---- the earlier trades taken the same way */
  const hist = histTrades.filter((x) => x.read).map((x) => ({ x, sh: shape(x) }));
  const seen = new Set();
  const similarTrades = [];
  for (const tr of (today.trades || []).filter((x) => x.read)) {
    const sh = shape(tr);
    if (sh.vwap === null) continue;
    const k = `${sh.side}|${sh.hour}|${sh.vwap}|${sh.orBreak}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const like = hist.filter((h) => alike(h.sh, sh)).map((h) => h.x);
    if (like.length < 4) continue;
    const net = sum(like, (x) => x.net);
    const wins = like.filter((x) => x.net > 0).length;
    const rules = RULES.slice(1)
      .map((r) => {
        const xs = like.filter((x) => x.whatIf && x.whatIf[r.id]);
        return { id: r.id, name: r.name, n: xs.length, vs: r2(sum(xs, (x) => x.whatIf[r.id].net - x.net)) };
      })
      .filter((r) => r.n >= 4)
      .sort((a, b) => b.vs - a.vs);
    const best = rules[0] && rules[0].vs > 0 ? rules[0] : null;
    similarTrades.push({ key: tr.key, symbol: tr.symbol, like: { n: like.length, wins, net: r2(net), avg: r2(net / like.length), sameSymbol: like.filter((x) => x.symbol === tr.symbol).length }, bestRule: best, good: net > 0, text: `${describe(sh)}: ${like.length} earlier trades, ${wins} won, ${rs(net)} net${best ? `; “${best.name}” would have added ${rs(best.vs)}` : ""}.` });
  }

  const worst = prevent.find((p) => p.today);
  const headline = !(today.trades || []).length
    ? "No closed trade on this day."
    : !enough
      ? `${today.trades.length} trade${today.trades.length === 1 ? "" : "s"}, ${rs(t.net)} net. The comparison needs at least three earlier days on record (${ps.length} so far).`
      : `${rs(t.net)} net against your usual ${rs(baseline.net)}; score ${t.score ?? "—"} against ${baseline.score ?? "—"}.${worst ? ` First to fix: ${worst.habit.toLowerCase()}.` : keep[0] ? " A clean day: keep doing this." : ""}`;

  return { date: today.date, enough, headline, baseline, today: t, versus, prevent: prevent.slice(0, 8), keep: keep.slice(0, 6), similarDays, similarTrades: similarTrades.slice(0, 6), cleanDays: clean };
}

module.exports = { compareDay, dayStats, ACTION };
