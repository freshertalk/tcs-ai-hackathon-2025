"use strict";
// The Journal's deeper figures for one period, and the Retrospective: what went well, what went
// wrong, what to keep doing, what to stop, and what to try next — each with its figures, in short,
// simple sentences. Arithmetic on the trader's own closed trades only: no AI, no prediction, no
// advice about which stock to buy. Pure functions; journal.js gives them the trips.

const IST = 5.5 * 3600 * 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const istIso = (ms) => new Date(ms + IST).toISOString();
const day = (ms) => istIso(ms).slice(0, 10);
const rs = (x) => `₹${Math.round(Math.abs(x)).toLocaleString("en-IN")}`;
const sgn = (x) => `${x >= 0 ? "+" : "−"}${rs(x)}`;
const pct = (x) => `${Math.round(x)}%`;
const sum = (a, f) => a.reduce((s, t) => s + f(t), 0);
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const DERIV = new Set(["NFO", "BFO", "CDS", "BCD", "MCX", "NCO"]);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HOLD = [
  { key: "lt5", label: "Under 5 min", max: 5 },
  { key: "5to15", label: "5–15 min", max: 15 },
  { key: "15to60", label: "15–60 min", max: 60 },
  { key: "1to3h", label: "1–3 hours", max: 180 },
  { key: "gt3h", label: "Over 3 hours", max: Infinity },
];

/** A round step for the P&L-per-trade buckets: about the size of a normal trade's result. */
function niceStep(x) {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  return steps.find((s) => s >= x) || steps[steps.length - 1];
}

/**
 * The figures behind the Journal's charts, for closed trips (each with pnl, charges, net, parts?,
 * entryAt, exitAt, holdMin, intraday, exchange, side, symbol).
 */
function deeper(closed, { chargeParts } = {}) {
  const trips = [...closed].sort((a, b) => a.exitAt - b.exitAt);
  // day by day: profit, loss, charges, net
  const byDay = new Map();
  for (const t of trips) {
    const k = day(t.exitAt);
    const g = byDay.get(k) || { date: k, trades: 0, wins: 0, grossProfit: 0, grossLoss: 0, charges: 0, net: 0 };
    g.trades += 1;
    if (t.net > 0) g.wins += 1;
    if (t.pnl > 0) g.grossProfit += t.pnl;
    else g.grossLoss -= t.pnl;
    g.charges += t.charges;
    g.net += t.net;
    byDay.set(k, g);
  }
  const days = [...byDay.values()].map((g) => ({ ...g, grossProfit: r2(g.grossProfit), grossLoss: r2(g.grossLoss), charges: r2(g.charges), net: r2(g.net) }));
  // the running total and the fall from its highest point
  let eq = 0;
  let peak = 0;
  const curve = days.map((d) => {
    eq += d.net;
    peak = Math.max(peak, eq);
    return { date: d.date, equity: r2(eq), drawdown: r2(eq - peak) };
  });
  // costs by kind
  const costs = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, dp: 0 };
  if (chargeParts) for (const t of trips) {
    const p = chargeParts(t);
    for (const k of Object.keys(costs)) costs[k] += p[k] || 0;
  }
  for (const k of Object.keys(costs)) costs[k] = r2(costs[k]);
  // how long trades were held
  const holding = [...HOLD.map((h) => ({ key: h.key, label: h.label, trades: 0, wins: 0, net: 0 })), { key: "multi", label: "Kept overnight", trades: 0, wins: 0, net: 0 }];
  for (const t of trips) {
    const b = !t.intraday ? holding[holding.length - 1] : holding[HOLD.findIndex((h) => (t.holdMin || 0) < h.max)];
    b.trades += 1;
    if (t.net > 0) b.wins += 1;
    b.net += t.net;
  }
  holding.forEach((b) => {
    b.net = r2(b.net);
    b.winRate = b.trades ? Math.round((b.wins / b.trades) * 100) : 0;
  });
  // how big each trade's result was
  const abs = trips.map((t) => Math.abs(t.net)).sort((a, b) => a - b);
  const step = niceStep(abs.length ? abs[Math.floor(abs.length * 0.6)] || 100 : 100);
  const spreadDef = [
    { key: "l2", label: `Lost over ${rs(2 * step)}`, lo: -Infinity, hi: -2 * step, tone: "down" },
    { key: "l1", label: `Lost ${rs(step)}–${rs(2 * step)}`, lo: -2 * step, hi: -step, tone: "down" },
    { key: "l0", label: `Lost up to ${rs(step)}`, lo: -step, hi: 0, tone: "down" },
    { key: "w0", label: `Made up to ${rs(step)}`, lo: 0, hi: step, tone: "up" },
    { key: "w1", label: `Made ${rs(step)}–${rs(2 * step)}`, lo: step, hi: 2 * step, tone: "up" },
    { key: "w2", label: `Made over ${rs(2 * step)}`, lo: 2 * step, hi: Infinity, tone: "up" },
  ];
  const spread = spreadDef.map((b) => ({ key: b.key, label: b.label, tone: b.tone, trades: 0, net: 0 }));
  for (const t of trips) {
    const i = t.net <= 0 ? spreadDef.findIndex((b) => t.net > b.lo && t.net <= b.hi) : spreadDef.findIndex((b) => t.net > b.lo && t.net <= b.hi);
    const b = spread[i < 0 ? (t.net > 0 ? 5 : 0) : i];
    b.trades += 1;
    b.net += t.net;
  }
  spread.forEach((b) => (b.net = r2(b.net)));
  // win rate and average result over the last 20 trades, at the end of each day
  const rolling = [];
  let idx = 0;
  for (const d of days) {
    while (idx < trips.length && day(trips[idx].exitAt) <= d.date) idx += 1;
    const last = trips.slice(Math.max(0, idx - 20), idx);
    rolling.push({ date: d.date, winRate: last.length ? Math.round((last.filter((t) => t.net > 0).length / last.length) * 1000) / 10 : null, avg: last.length ? r2(sum(last, (t) => t.net) / last.length) : null, n: last.length });
  }
  // what kind of trades
  const mixDef = [
    { key: "intraday", label: "Intraday (same day)", test: (t) => t.intraday && !DERIV.has(t.exchange) },
    { key: "delivery", label: "Delivery (kept overnight)", test: (t) => !t.intraday && !DERIV.has(t.exchange) },
    { key: "deriv", label: "F&O, currency, commodity", test: (t) => DERIV.has(t.exchange) },
  ];
  const mix = mixDef.map((m) => {
    const list = trips.filter(m.test);
    return { key: m.key, label: m.label, trades: list.length, wins: list.filter((t) => t.net > 0).length, net: r2(sum(list, (t) => t.net)) };
  }).filter((m) => m.trades);
  const sides = ["long", "short"].map((s) => {
    const list = trips.filter((t) => t.side === s);
    return { key: s, label: s === "long" ? "Buy first (long)" : "Sell first (short)", trades: list.length, wins: list.filter((t) => t.net > 0).length, net: r2(sum(list, (t) => t.net)) };
  }).filter((m) => m.trades);
  return { days, curve, costs, holding: holding.filter((b) => b.trades), spread, spreadStep: step, rolling, mix, sides };
}

/**
 * A plain 0–100 health score from six parts, each 0–100. It describes how the period was traded,
 * not what will happen next.
 */
function health(summary) {
  const s = summary;
  if (!s || s.trades < 1) return null;
  const won = s.avgWin * s.wins;
  const parts = [
    { key: "wins", label: "How often you win", score: clamp(((s.winRate - 30) / 30) * 100), value: `${Math.round(s.winRate)}% of trades won` },
    { key: "size", label: "Win size vs loss size", score: s.avgLoss ? clamp(((s.avgWin / Math.abs(s.avgLoss) - 0.5) / 1.5) * 100) : s.wins ? 100 : 0, value: s.avgLoss ? `average win ${rs(s.avgWin)}, average loss ${rs(s.avgLoss)}` : "no losing trades" },
    { key: "pf", label: "Money won vs money lost", score: s.profitFactor === null ? 100 : clamp(((s.profitFactor - 0.6) / 1.4) * 100), value: s.profitFactor === null ? "no losses" : `₹${s.profitFactor.toFixed(2)} won for every ₹1 lost` },
    { key: "risk", label: "Control of falls", score: won > 0 ? clamp(((1 - s.maxDrawdown / won) / 0.8) * 100) : s.maxDrawdown ? 0 : 50, value: `largest fall ${rs(s.maxDrawdown)}` },
    { key: "costs", label: "Costs", score: s.gross > 0 ? clamp(((0.5 - s.charges / Math.max(1, won)) / 0.4) * 100) : clamp(100 - (s.charges / Math.max(1, Math.abs(s.net) + s.charges)) * 100), value: `costs ${rs(s.charges)}` },
    { key: "days", label: "Good days", score: s.days ? clamp(((s.greenDays / s.days - 0.3) / 0.4) * 100) : 0, value: `${s.greenDays} of ${s.days} days in profit` },
  ].map((p) => ({ ...p, score: Math.round(p.score) }));
  const weights = { wins: 1, size: 1.2, pf: 1.4, risk: 1, costs: 0.8, days: 0.8 };
  const total = Math.round(sum(parts, (p) => p.score * weights[p.key]) / sum(parts, (p) => weights[p.key]));
  return { score: total, label: total >= 70 ? "Strong" : total >= 50 ? "Mixed" : "Needs work", parts, enough: s.trades >= 10 };
}

/* ------------------------------------------------------------------------ the retrospective */

/**
 * @param trips  the period's closed trips (with tags), in any order
 * @param summary journal.js summarize() of them; prev the previous period's (or null)
 * @param period { label, fromDay, toDay }
 */
function retrospective({ trips, summary, prev = null, period, deep }) {
  const s = summary;
  const good = [];
  const bad = [];
  const keep = [];
  const stop = [];
  const tryNext = [];
  // a "keep doing" or "stop doing" line weighs what the finding just before it weighed
  const last = { bad: 0, good: 0 };
  const add = (list, text, figure, extra = {}) => {
    let impact = extra.impact;
    if (list === bad) last.bad = impact || 0;
    if (list === good) last.good = impact || 0;
    if (impact === undefined && list === stop) impact = last.bad;
    if (impact === undefined && list === keep) impact = last.good;
    list.push({ text, figure: figure || "", ...extra, impact });
  };
  const closed = [...trips].sort((a, b) => a.entryAt - b.entryAt);
  if (!closed.length) {
    return { period, verdict: "none", headline: `No closed trades in ${period.label}.`, summary: s, wentWell: [], wentWrong: [], keepDoing: [], stopDoing: [], tryNext: ["Pick a longer period, or upload your tradebooks for the history."] };
  }
  const wins = closed.filter((t) => t.net > 0);
  const losses = closed.filter((t) => t.net <= 0);
  const avgW = wins.length ? sum(wins, (t) => t.net) / wins.length : 0;
  const avgL = losses.length ? sum(losses, (t) => t.net) / losses.length : 0;

  // 1. the result
  if (s.net > 0) add(good, `You made money: ${sgn(s.net)} after all costs.`, `${s.trades} trades`, { pin: true });
  else add(bad, `You lost money: ${sgn(s.net)} after all costs.`, `${s.trades} trades`, { pin: true });
  if (s.gross > 0 && s.net <= 0) add(bad, `Your trades made ${sgn(s.gross)} before costs, but costs of ${rs(s.charges)} turned it into a loss.`, "costs", { why: "costs", impact: s.charges });

  // 2. how often you won, and how big
  if (s.winRate >= 55) add(good, `You won ${s.wins} of ${s.trades} trades (${pct(s.winRate)}).`, "win rate", { impact: Math.abs(s.net) * 0.5 });
  else if (s.winRate < 40 && s.trades >= 5) add(bad, `Only ${s.wins} of ${s.trades} trades won (${pct(s.winRate)}).`, "win rate", { why: "too few winning trades", impact: Math.abs(s.net) * 0.5 });
  if (wins.length && losses.length) {
    const ratio = avgW / Math.abs(avgL || 1);
    if (ratio >= 1.3) {
      add(good, `Your average win (${rs(avgW)}) was bigger than your average loss (${rs(avgL)}).`, `${ratio.toFixed(1)}×`, { impact: (avgW - Math.abs(avgL)) * wins.length });
      add(keep, "Letting winning trades run and cutting losing ones early.", `win ${rs(avgW)} vs loss ${rs(avgL)}`);
    } else if (ratio < 0.8) {
      add(bad, `Your average loss (${rs(avgL)}) was bigger than your average win (${rs(avgW)}).`, `${ratio.toFixed(1)}×`, { why: "losses bigger than wins", impact: (Math.abs(avgL) - avgW) * losses.length });
      add(stop, "Letting losing trades grow bigger than winning ones.", `loss ${rs(avgL)} vs win ${rs(avgW)}`);
      add(tryNext, `Before each trade, decide your exit if it goes wrong, and keep the loss smaller than ${rs(avgW)} (your average win).`);
    }
  }

  // 3. one big loss
  if (losses.length >= 3) {
    const worst = losses.reduce((a, t) => (t.net < a.net ? t : a), losses[0]);
    if (Math.abs(worst.net) > 2.5 * Math.abs(avgL)) {
      add(bad, `One trade lost ${rs(worst.net)} (${worst.symbol} on ${day(worst.exitAt)}) — ${(Math.abs(worst.net) / Math.abs(avgL)).toFixed(1)} times your normal loss.`, "biggest loss", { why: "one big loss", impact: Math.abs(worst.net) });
      add(stop, "Taking one loss much bigger than the others.", rs(worst.net));
    }
  }

  // 4. holding losers longer than winners (same-day trades)
  const intraW = wins.filter((t) => t.intraday);
  const intraL = losses.filter((t) => t.intraday);
  if (intraW.length >= 3 && intraL.length >= 3) {
    const hw = sum(intraW, (t) => t.holdMin || 0) / intraW.length;
    const hl = sum(intraL, (t) => t.holdMin || 0) / intraL.length;
    if (hl > hw * 1.3 && hl - hw >= 5) {
      add(bad, `You kept losing trades open longer (${Math.round(hl)} min) than winning ones (${Math.round(hw)} min).`, "holding time", { why: "holding losing trades too long", impact: Math.abs(sum(intraL, (t) => t.net)) * 0.3 });
      add(stop, "Waiting and hoping when a trade goes against you.", `${Math.round(hl)} min vs ${Math.round(hw)} min`);
    } else if (hw > hl * 1.3 && hw - hl >= 5) {
      add(good, `You closed losing trades quickly (${Math.round(hl)} min) and gave winners more time (${Math.round(hw)} min).`, "holding time", { impact: sum(intraW, (t) => t.net) * 0.3 });
      add(keep, "Closing losing trades quickly.", `${Math.round(hl)} min`);
    }
  }

  // 5. best and worst hour, weekday and stock (3+ trades each)
  const groupBy = (keyOf, min = 3) => {
    const m = new Map();
    for (const t of closed) {
      const k = keyOf(t);
      const g = m.get(k) || { key: k, trades: 0, wins: 0, net: 0 };
      g.trades += 1;
      if (t.net > 0) g.wins += 1;
      g.net += t.net;
      m.set(k, g);
    }
    return [...m.values()].filter((g) => g.trades >= min).sort((a, b) => b.net - a.net);
  };
  const hourName = (h) => {
    const f = (x) => `${((x + 11) % 12) + 1} ${x < 12 ? "AM" : "PM"}`;
    return `${f(h)}–${f(h + 1)}`;
  };
  const hours = groupBy((t) => new Date(t.entryAt + IST).getUTCHours());
  if (hours.length >= 2) {
    const b = hours[0];
    const w = hours[hours.length - 1];
    if (b.net > 0) {
      add(good, `Trades you started at ${hourName(b.key)} made ${sgn(b.net)} (${b.trades} trades).`, "best time", { impact: b.net });
      add(keep, `Trading at ${hourName(b.key)} — your best time.`, sgn(b.net));
    }
    if (w.net < 0) {
      add(bad, `Trades you started at ${hourName(w.key)} lost ${rs(w.net)} (${w.trades} trades).`, "worst time", { why: "trading at a bad time of day", impact: Math.abs(w.net) });
      add(stop, `Trading at ${hourName(w.key)}, or trade smaller then.`, rs(w.net));
      if (b.net > 0) tryNext.push({ text: `For the next two weeks, trade only at ${hourName(b.key)} and skip ${hourName(w.key)}. Then compare.`, figure: "" });
    }
  }
  const wdays = groupBy((t) => new Date(t.entryAt + IST).getUTCDay());
  if (wdays.length >= 3) {
    const b = wdays[0];
    const w = wdays[wdays.length - 1];
    if (b.net > 0) add(good, `${WEEKDAYS[b.key]}s were your best day: ${sgn(b.net)}.`, `${b.trades} trades`, { impact: b.net * 0.6 });
    if (w.net < 0) add(bad, `${WEEKDAYS[w.key]}s were your worst day: ${sgn(w.net)}.`, `${w.trades} trades`, { impact: Math.abs(w.net) * 0.6 });
  }
  const stocks = groupBy((t) => t.symbol, 2);
  if (stocks.length) {
    const b = stocks[0];
    const w = stocks[stocks.length - 1];
    if (b.net > 0) {
      add(good, `${b.key} made you ${sgn(b.net)} in ${b.trades} trades.`, "best stock", { impact: b.net });
      add(keep, `Trading ${b.key} the way you did.`, sgn(b.net));
    }
    if (w.net < 0 && w.key !== b.key) {
      add(bad, `${w.key} lost you ${rs(w.net)} in ${w.trades} trades.`, "worst stock", { why: `losses in ${w.key}`, impact: Math.abs(w.net) });
      add(stop, `Trading ${w.key} until you find what goes wrong with it.`, rs(w.net));
    }
  }

  // 6. too many trades in a day, revenge trades, trading on after two losses
  const perDay = new Map();
  for (const t of closed) {
    const k = day(t.exitAt);
    const g = perDay.get(k) || { n: 0, net: 0 };
    g.n += 1;
    g.net += t.net;
    perDay.set(k, g);
  }
  const counts = [...perDay.values()].map((g) => g.n).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const busy = [...perDay.entries()].filter(([, g]) => g.n >= Math.max(6, median * 2));
  if (busy.length) {
    const net = sum(busy, ([, g]) => g.net);
    if (net < 0) {
      add(bad, `On ${busy.length} very busy day${busy.length === 1 ? "" : "s"} (${Math.max(6, median * 2)}+ trades) you lost ${rs(net)}.`, "too many trades", { why: "too many trades on some days", impact: Math.abs(net) });
      add(stop, "Taking too many trades in one day.", rs(net));
      tryNext.push({ text: `Set a limit of ${Math.max(3, median + 1)} trades a day, and stop when you reach it.`, figure: "" });
    }
  }
  let revenge = 0;
  let revengeNet = 0;
  closed.forEach((t, i) => {
    if (t.net >= 0) return;
    const next = closed.slice(i + 1).find((x) => x.symbol === t.symbol && x.entryAt >= t.exitAt);
    if (next && next.entryAt - t.exitAt <= 15 * 60000) {
      revenge += 1;
      revengeNet += next.net;
    }
  });
  if (revenge >= 2 && revengeNet < 0) {
    add(bad, `${revenge} times you jumped back into the same stock within 15 minutes of a loss. Those trades lost ${rs(revengeNet)}.`, "revenge trades", { why: "revenge trades", impact: Math.abs(revengeNet) * 1.2 });
    add(stop, "Jumping back in right after a loss to win it back.", rs(revengeNet));
    tryNext.push({ text: "After a loss, wait 30 minutes before the next trade.", figure: "" });
  }
  let after2 = 0;
  let after2Net = 0;
  for (const [k] of perDay) {
    const list = closed.filter((t) => day(t.exitAt) === k).sort((a, b) => a.exitAt - b.exitAt);
    let streak = 0;
    for (const t of list) {
      if (streak >= 2) {
        after2 += 1;
        after2Net += t.net;
      }
      streak = t.net <= 0 ? streak + 1 : 0;
    }
  }
  if (after2 >= 3 && after2Net < 0) {
    add(bad, `After two losses in a row you kept trading: those ${after2} trades lost ${rs(after2Net)}.`, "after 2 losses", { why: "trading on after losses", impact: Math.abs(after2Net) });
    tryNext.push({ text: "Stop for the day after two losses in a row.", figure: rs(after2Net) });
  } else if (after2 >= 3 && after2Net > 0) add(good, `After two losses in a row you stayed calm: the next ${after2} trades made ${sgn(after2Net)}.`, "after 2 losses", { impact: after2Net });

  // 7. costs
  const won = sum(wins, (t) => t.net + t.charges);
  if (won > 0) {
    const share = (s.charges / won) * 100;
    if (share >= 30) {
      add(bad, `Costs (brokerage and taxes) took ${pct(share)} of the money your winning trades made.`, rs(s.charges), { why: "costs", impact: s.charges * 0.8 });
      add(tryNext, "Take fewer, better trades: every trade pays brokerage and taxes, win or lose.");
    } else if (share <= 12 && s.trades >= 5) add(good, `Costs stayed low: ${rs(s.charges)}, only ${pct(share)} of what your winners made.`, "costs", { impact: s.charges * 0.3 });
  }

  // 8. good days, streaks, the largest fall
  if (s.days >= 5) {
    if (s.greenDays / s.days >= 0.6) add(good, `${s.greenDays} of ${s.days} trading days ended in profit.`, "good days", { impact: Math.abs(s.net) * 0.4 });
    else if (s.greenDays / s.days < 0.35) add(bad, `Only ${s.greenDays} of ${s.days} trading days ended in profit.`, "good days", { impact: Math.abs(s.net) * 0.4 });
  }
  if (s.maxDrawdown > 0 && won > 0 && s.maxDrawdown > won * 0.6) add(bad, `At one point your total fell ${rs(s.maxDrawdown)} from its highest — a big fall.`, "largest fall", { why: "a big fall from the top", impact: s.maxDrawdown * 0.5 });

  // 9. your tags: setups and mistakes
  const tagged = closed.filter((t) => t.tags && (t.tags.setup || (t.tags.mistakes || []).length));
  if (tagged.length >= 3) {
    const setups = groupBy((t) => (t.tags && t.tags.setup) || "—", 3).filter((g) => g.key !== "—");
    if (setups.length && setups[0].net > 0) {
      add(good, `Your “${setups[0].key}” trades made ${sgn(setups[0].net)}.`, `${setups[0].trades} trades`, { impact: setups[0].net });
      add(keep, `Using your “${setups[0].key}” setup.`, sgn(setups[0].net));
    }
    const mist = new Map();
    for (const t of closed) for (const m of (t.tags && t.tags.mistakes) || []) mist.set(m, (mist.get(m) || 0) + t.net);
    const worstM = [...mist.entries()].sort((a, b) => a[1] - b[1])[0];
    if (worstM && worstM[1] < 0) {
      add(bad, `Trades tagged “${worstM[0]}” cost you ${rs(worstM[1])}.`, "your tags", { why: `“${worstM[0]}”`, impact: Math.abs(worstM[1]) });
      add(stop, `“${worstM[0]}”.`, rs(worstM[1]));
    }
  } else if (closed.length >= 10) tryNext.push({ text: "Tag your trades (setup and mistakes) in the list below: the next retrospective will tell you which setups work.", figure: "" });

  // 10. compared with the period before
  if (prev && prev.trades >= 3) {
    const d = s.net - prev.net;
    if (d > 0) add(good, `Better than the period before: ${sgn(d)} more (${sgn(prev.net)} then, ${sgn(s.net)} now).`, "vs before", { impact: d * 0.7 });
    else if (d < 0) add(bad, `Worse than the period before: ${rs(d)} less (${sgn(prev.net)} then, ${sgn(s.net)} now).`, "vs before", { impact: Math.abs(d) * 0.7 });
    if (s.winRate - prev.winRate >= 8) add(good, `You won more often than before: ${pct(s.winRate)} now, ${pct(prev.winRate)} then.`, "vs before");
    if (prev.winRate - s.winRate >= 8) add(bad, `You won less often than before: ${pct(s.winRate)} now, ${pct(prev.winRate)} then.`, "vs before");
  }

  if (!keep.length && s.net > 0) add(keep, "The way you traded in this period — it made money.", sgn(s.net));
  if (!tryNext.length) tryNext.push({ text: s.net > 0 ? "Keep a short note on each trade (why you took it) to repeat what works." : "Trade smaller for a while, and write down why you take each trade.", figure: "" });
  const hp = health(s);
  const verdict = s.net > 0 && (!hp || hp.score >= 55) ? "good" : s.net <= 0 && (!hp || hp.score < 45) ? "bad" : "mixed";
  const rank = (list) => [...list.filter((x) => x.pin), ...list.filter((x) => !x.pin).sort((a, b) => (b.impact || 0) - (a.impact || 0))].map(({ pin, impact, ...x }) => x);
  const goodR = rank(good);
  const badR = rank(bad);
  const main = [...new Set(badR.map((x) => x.why).filter(Boolean))].slice(0, 2);
  const headline =
    verdict === "good"
      ? `A good period: you made ${sgn(s.net)} after costs.`
      : verdict === "bad"
        ? `A losing period: ${sgn(s.net)} after costs${main.length ? ` — mainly ${main.join(" and ")}` : ""}.`
        : `A mixed period: ${sgn(s.net)} after costs${main.length ? ` — watch ${main.join(" and ")}` : ""}.`;
  return {
    period,
    verdict,
    headline,
    score: hp ? hp.score : null,
    summary: { trades: s.trades, winRate: s.winRate, net: s.net, gross: s.gross, charges: s.charges, profitFactor: s.profitFactor, maxDrawdown: s.maxDrawdown },
    prev: prev ? { trades: prev.trades, winRate: prev.winRate, net: prev.net } : null,
    wentWell: goodR.slice(0, 10),
    wentWrong: badR.slice(0, 10),
    keepDoing: rank(keep).slice(0, 6),
    stopDoing: rank(stop).slice(0, 6),
    tryNext: tryNext.slice(0, 4).map((x) => (typeof x === "string" ? { text: x, figure: "" } : x)),
    note: "Worked out from your own trades in this period. It describes what happened; it does not predict the next trade and is not investment advice.",
    deepDays: deep ? deep.days.length : undefined,
  };
}

module.exports = { deeper, health, retrospective, niceStep, HOLD };
