"use strict";
// Day snapshots, outcomes and learnings — Trade Analysis's memory.
//
//   SNAPSHOT   one record per trading day, kept for good (the 1-minute bars Zerodha keeps are gone after
//              about 60 days; the snapshot is not): a timeline of every moment of the day with its
//              timestamp — each entry, the best moment of each trade (while you were in it) and what
//              you did about it, the deepest point, where the exit coach would have said EXIT NOW, the
//              exit, the best the price offered after you left, the signals the live board gave, the
//              day's own profit-and-loss curve (its peak and trough with their times, how much of the
//              peak was given back) and the minute the daily stop or target was reached.
//   OUTCOMES   one row per trade, from every snapshot: what became of the peak. Did you book it
//              (near the best moment), stay past it (gave it back), leave before the bigger move,
//              watch a winner turn into a loser, never get paid at all, or cut a loss in time.
//   LEARNINGS  the register of what not to repeat (and what to keep doing), counted from the outcomes
//              and the habits flagged by the Execution Lab: how often, what it cost, when it last
//              happened, how many recorded days ago, the one rule to follow instead — with your own
//              status on each ("working on it", "mastered") and a flag when something you marked
//              mastered comes back.
//
// Pure arithmetic on Zerodha's own fills and bars, on what the Execution Lab already measured
// (lab.js): no AI, no network, no clock, no orders. A snapshot describes the past; it is evidence
// with a sample size, never a promise about the next trade.

const { FLAGS } = require("./lab");
const { ACTION } = require("./compare");

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const OPEN = (date) => Date.parse(`${date}T03:45:00Z`); // 9:15 AM IST
const CLOSE = (date) => Date.parse(`${date}T10:00:00Z`); // 3:30 PM IST
const clockOf = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const rs = (x) => (num(x) ? `₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
const sg = (x) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
const px = (x) => (num(x) ? `₹${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const cut = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

const VER = 1;
const MATERIAL_PCT = 0.3; // a move of at least 0.3% in your favour is a real peak, not noise
const SLACK_MIN = 2; // leaving within two minutes of the best moment is "at the best"
const RAN_ON_MIN = 45; // a bigger move counts as "the move that ran on" only when it came within 45 minutes of your exit
const MAX_MOMENTS = 260;
const CURVE_STEP = 5; // the day's curve is kept every five minutes (and at its peak and trough)

/** What became of each trade's peak. */
const OUTCOMES = {
  "winner-to-loser": { name: "Winner turned loser", tone: "bad", short: "up, then a loss", rule: "Once a trade is up 0.5%, move the stop to break-even and book part. A trade that was up and ended in a loss is the most expensive kind: you had the money and gave it back." },
  "gave-back": { name: "Stayed past the peak", tone: "bad", short: "gave part back", rule: "Trail the stop under the move (the Live board shows it) or book half at the first target. Waiting for “a little more” after the best moment is where the profit leaks." },
  "left-early": { name: "Left before the bigger move", tone: "bad", short: "left early", rule: "When the trade is working with volume behind it and the trend intact, book half and let the rest run with a trailing stop, rather than the whole position at once." },
  "never-paid": { name: "Never paid", tone: "bad", short: "never in profit", rule: "A trade that never went your way was probably early. Wait for the confirmation — a close beyond VWAP or the opening range, with volume — before you enter." },
  "near-best": { name: "Booked near the best", tone: "good", short: "booked the peak", rule: "Keep doing this: you left within minutes of the best moment, or took almost all of it." },
  "kept-most": { name: "Kept most of the move", tone: "good", short: "kept most", rule: "Keep doing this: you took most of the move on offer." },
  "loss-cut": { name: "Cut the loss in time", tone: "good", short: "cut in time", rule: "Keep doing this: you left a trade that never worked before it cost more — the price went on against you after you left." },
  scratch: { name: "No real move", tone: "flat", short: "no real move", rule: "" },
  unmeasured: { name: "Not replayed", tone: "flat", short: "not replayed", rule: "" },
};

/** The day's best moment for this trade came after you left, within RAN_ON_MIN minutes of your exit. */
const ranOnAfter = (t) => {
  const d = t.read && t.read.bestExitDay;
  return Boolean(d && d.at > t.exitAt + SLACK_MIN * 60000 && d.at <= t.exitAt + RAN_ON_MIN * 60000);
};

/**
 * What became of one trade's peak.
 * @param t  a trade of the Execution Lab (lab.js): { pnl, net, exitAt, exitClock, read: { bestExit, bestExitDay, timing, mfePct, ranOn, avoided } }
 * @returns { id, name, tone, text }
 */
function classify(t) {
  const meta = (id, text) => ({ id, name: OUTCOMES[id].name, tone: OUTCOMES[id].tone, text });
  const r = t.read;
  if (!r || !r.bestExit || !r.timing) return meta("unmeasured", t.intraday === false ? "Held overnight: the lab replays intraday trades only." : "No 1-minute bars were available, so the best moment could not be measured.");
  const peak = r.bestExit;
  const gap = r.timing.gapMin;
  const eff = r.timing.efficiency;
  const dayBest = r.bestExitDay;
  const material = num(r.mfePct) && r.mfePct >= MATERIAL_PCT && peak.pnl > 0;
  const peakText = `${sg(peak.pnl)} at ${peak.clock}`;
  if (!material) {
    if (t.net < 0) {
      const spared = num(r.avoided) ? r.avoided : 0;
      if (spared >= 2 * Math.abs(t.net) && spared > 0) return meta("loss-cut", `The price never went your way (best ${peakText}) and went on against you after you left — leaving at ${t.exitClock} spared up to ${rs(spared)}.`);
      return meta("never-paid", `The price never went meaningfully your way (best ${peakText}); you closed at ${t.exitClock} for ${sg(t.net)}. The entry was not confirmed.`);
    }
    return meta("scratch", `No real move either way (best ${peakText}); you closed at ${t.exitClock} for ${sg(t.net)}.`);
  }
  if (t.pnl <= 0) return meta("winner-to-loser", `You were up ${peakText} (${r2(r.mfePct)}%) and did not book it; you closed at ${t.exitClock} for ${sg(t.net)} — ${rs(peak.pnl - t.pnl)} of profit gone.`);
  const early = ranOnAfter(t) && dayBest.pnl > Math.max(0, peak.pnl) * 1.2 + 1;
  if (early) return meta("left-early", `You booked ${sg(t.pnl)} at ${t.exitClock}; after you left the price offered ${sg(dayBest.pnl)} at ${dayBest.clock} — ${rs(dayBest.pnl - t.pnl)} more.`);
  if (gap <= SLACK_MIN || (num(eff) && eff >= 85)) return meta("near-best", `The best moment was ${peakText}; you closed at ${t.exitClock} with ${sg(t.pnl)}${num(eff) ? ` (${eff}% of it)` : ""}${gap > SLACK_MIN ? ` — ${gap} min later` : " — at the best moment"}.`);
  if (num(eff) && eff < 60) return meta("gave-back", `The best moment was ${peakText}; you stayed ${gap} min longer and closed at ${t.exitClock} with ${sg(t.pnl)} — ${rs(r.timing.leftOnTable)} left on the table.`);
  return meta("kept-most", `The best moment was ${peakText}; you closed at ${t.exitClock} with ${sg(t.pnl)}${num(eff) ? ` (${eff}% of it)` : ""}.`);
}

/** The day's profit-and-loss minute by minute: closed trades at their net, open ones at the bar's close. */
function dayCurve(trades, bars, date) {
  const list = trades.filter((t) => num(t.entryAt) && num(t.exitAt));
  const series = {};
  const at = {};
  let measured = false;
  for (const t of list) {
    if (t.intraday === false || series[t.symbol] || !Array.isArray(bars[t.symbol]) || !bars[t.symbol].length) continue;
    series[t.symbol] = bars[t.symbol].filter((b) => num(b.t) && num(b.c)).sort((a, b) => a.t - b.t);
    at[t.symbol] = 0;
  }
  const pts = [];
  for (let t = OPEN(date); t <= CLOSE(date); t += 60000) {
    for (const sym of Object.keys(series)) {
      const s = series[sym];
      while (at[sym] + 1 < s.length && s[at[sym] + 1].t <= t) at[sym] += 1;
    }
    let v = 0;
    const holding = [];
    for (const tr of list) {
      if (tr.exitAt <= t) {
        v += num(tr.net) ? tr.net : tr.pnl || 0;
      } else if (tr.entryAt <= t) {
        const s = series[tr.symbol];
        if (!s || s[at[tr.symbol]].t > t) continue;
        measured = true;
        v += (tr.side === "long" ? 1 : -1) * (s[at[tr.symbol]].c - tr.entryAvg) * tr.qty;
        holding.push(tr.symbol);
      }
    }
    pts.push({ t, v: r2(v), holding });
  }
  return { pts, measured };
}

/** The peak, trough and close of the day's curve, the minute the daily limits were reached, and the curve thinned for storage. */
function readCurve({ pts, measured }, limits, trades) {
  if (!pts.length) return null;
  let hi = pts[0];
  let lo = pts[0];
  for (const p of pts) {
    if (p.v > hi.v) hi = p;
    if (p.v < lo.v) lo = p;
  }
  const final = r2(trades.reduce((a, t) => a + (num(t.net) ? t.net : t.pnl || 0), 0));
  const mk = (p) => ({ at: p.t, clock: clockOf(p.t), pnl: p.v, holding: [...new Set(p.holding)] });
  const keep = new Set([hi.t, lo.t, pts[pts.length - 1].t]);
  const curve = pts.filter((p, i) => i % CURVE_STEP === 0 || keep.has(p.t)).map((p) => [p.t, p.v]);
  const firstTime = (pred) => {
    const p = pts.find(pred);
    return p ? p.t : null;
  };
  const stopAt = limits && num(limits.stop) && limits.stop > 0 ? firstTime((p) => p.v <= -limits.stop) : null;
  const targetAt = limits && num(limits.target) && limits.target > 0 ? firstTime((p) => p.v >= limits.target) : null;
  const peak = mk(hi);
  return {
    measured,
    peak,
    trough: mk(lo),
    close: final,
    givenBack: peak.pnl > 0 && final < peak.pnl ? r2(peak.pnl - final) : 0,
    stopAt,
    targetAt,
    curve,
  };
}

/** The recorded flights of a day matched to a trade: the same stock and side, entered within three minutes. */
const flightOf = (flights, t) => (flights || []).find((f) => f && f.symbol === t.symbol && f.side === t.side && num(f.entryAt) && Math.abs(f.entryAt - t.entryAt) <= 3 * 60000) || null;

/** The moments of one trade, each with its timestamp. */
function momentsOf(t, flight) {
  const out = [];
  const base = { key: t.key, symbol: t.symbol, side: t.side };
  const add = (at, kind, text, extra = {}) => num(at) && out.push({ at, clock: clockOf(at), kind, ...base, text: cut(text, 320), ...extra });
  const r = t.read;
  const verb = t.side === "long" ? "Bought" : "Sold short";
  const ctx = [];
  if (r) {
    if (num(r.vsVwapPct)) ctx.push(`${r.vsVwapPct > 0 ? "+" : ""}${r.vsVwapPct}% vs VWAP`);
    if (r.opening) ctx.push(r.opening);
    if (num(r.rangePos)) ctx.push(`at ${r.rangePos}% of the day's range`);
  }
  const habits = t.flags.map((f) => (FLAGS[f] ? FLAGS[f].name.toLowerCase() : f));
  add(t.entryAt, "entry", `${verb} ${t.qty} ${t.symbol} at ${px(t.entryAvg)}${ctx.length ? ` (${ctx.join(" · ")})` : ""}${habits.length ? ` — ${habits.join(", ")}` : ""}.`, { price: t.entryAvg, flags: t.flags });
  if (r && r.bestExit) {
    const pk = r.bestExit;
    if (pk.pnl > 0) {
      const booked = r.timing && r.timing.gapMin <= SLACK_MIN;
      add(pk.at, "peak", `${t.symbol} at its best while you were in: ${sg(pk.pnl)} at ${px(pk.price)}${num(r.mfePct) ? ` (${r.mfePct}%)` : ""}. ${booked ? "You left within minutes of it." : t.exitAt > pk.at ? `You stayed in — and closed ${r.timing.gapMin} min later at ${sg(t.pnl)}${r.timing.leftOnTable > 0 ? `, ${rs(r.timing.leftOnTable)} less` : ""}.` : ""}`, { price: pk.price, pnl: pk.pnl });
    }
  }
  if (r && r.worst && r.worst.pnl < 0 && r.worst.at !== t.entryAt) add(r.worst.at, "worst", `${t.symbol} at its worst while you were in: ${sg(r.worst.pnl)} at ${px(r.worst.price)}${num(r.maePct) ? ` (${r.maePct}%)` : ""}.`, { price: r.worst.price, pnl: r.worst.pnl });
  if (r && r.coach && r.coach.exit && r.coach.exit.said) {
    const c = r.coach.exit;
    add(c.at, "coach", `The exit coach, replayed on the bars, says EXIT NOW on ${t.symbol} here: closing at ${px(c.price)} makes ${sg(c.pnl)}${num(r.coach.vsYours) ? ` — ${sg(r.coach.vsYours)} against what you made` : ""}.`, { price: c.price, pnl: c.pnl });
  }
  add(t.exitAt, "exit", `You closed ${t.symbol} at ${px(t.exitAvg)}: ${sg(t.pnl)} gross, ${sg(t.net)} after charges, ${t.holdMin} min in.${t.outcome ? ` ${t.outcome.name}.` : ""}`, { price: t.exitAvg, pnl: t.net, outcome: t.outcome ? t.outcome.id : null });
  if (ranOnAfter(t) && r.bestExitDay.pnl > t.pnl) {
    const d = r.bestExitDay;
    add(d.at, "after", `After you left ${t.symbol}, it offered ${sg(d.pnl)} at ${px(d.price)} — ${rs(d.pnl - t.pnl)} more than you took.`, { price: d.price, pnl: d.pnl });
  }
  // what the live board said while the trade was open (the flight recorder), only the changes
  if (flight && Array.isArray(flight.events)) {
    for (const e of flight.events) {
      if (!e || !num(e.at) || !["signal", "level", "alert", "ai"].includes(e.kind) || e.at < t.entryAt || e.at > t.exitAt + 60000) continue;
      add(e.at, e.kind, `${t.symbol}: ${e.text || e.state || e.kind}`, { state: e.state || null, price: num(e.price) ? e.price : null });
    }
  }
  return out;
}

/**
 * The snapshot of one day.
 * @param date    "YYYY-MM-DD"
 * @param lab     the Execution Lab's day (labDay)
 * @param bars    { SYMBOL: [{ t, o, h, l, c, v }] } — the day's 1-minute bars (a symbol may be missing)
 * @param flights the flight recorder's flights for the day (optional)
 */
function buildSnapshot({ date, lab, bars = {}, flights = [] }) {
  const trades = (lab && lab.trades ? lab.trades : []).map((t) => ({ ...t }));
  for (const t of trades) t.outcome = classify(t);
  const curve = readCurve(dayCurve(trades, bars, date), lab ? lab.limits : null, trades);
  const notes = lab && lab.notes ? [...lab.notes] : [];
  if (trades.length && !(curve && curve.measured)) notes.push("The day's own profit curve (its peak and trough) needs the day's 1-minute bars, which Zerodha keeps for about 60 days: this day's trades are listed without it.");
  const moments = [];
  for (const t of trades) moments.push(...momentsOf(t, flightOf(flights, t)));
  if (curve && curve.measured) {
    const p = curve.peak;
    moments.push({ at: p.at, clock: p.clock, kind: "day-peak", text: `The day's profit-and-loss was at its highest: ${sg(p.pnl)}${p.holding.length ? ` (open: ${p.holding.join(", ")})` : ""}.`, pnl: p.pnl });
    if (curve.trough.at !== p.at && curve.trough.pnl < 0) moments.push({ at: curve.trough.at, clock: curve.trough.clock, kind: "day-trough", text: `The day's profit-and-loss was at its lowest: ${sg(curve.trough.pnl)}${curve.trough.holding.length ? ` (open: ${curve.trough.holding.join(", ")})` : ""}.`, pnl: curve.trough.pnl });
  }
  if (curve && curve.targetAt) moments.push({ at: curve.targetAt, clock: clockOf(curve.targetAt), kind: "target", text: `The day's profit reached your daily target (${rs(lab.limits.target)}). ${trades.filter((t) => t.entryAt > curve.targetAt).length} trade(s) were taken after it.` });
  if (curve && curve.stopAt) moments.push({ at: curve.stopAt, clock: clockOf(curve.stopAt), kind: "stop", text: `The day's loss reached your daily stop (${rs(lab.limits.stop)}). ${trades.filter((t) => t.entryAt > curve.stopAt).length} trade(s) were taken after it.` });
  const rank = { entry: 0, signal: 1, level: 1, ai: 1, alert: 1, peak: 2, worst: 2, "day-peak": 2, "day-trough": 2, target: 2, stop: 2, coach: 3, exit: 4, after: 5 };
  moments.sort((a, b) => a.at - b.at || (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
  const slim = moments.length > MAX_MOMENTS ? moments.filter((m) => !["signal", "ai", "level"].includes(m.kind)).slice(0, MAX_MOMENTS) : moments;
  const rows = trades.map((t) => {
    const r = t.read;
    return {
      key: t.key,
      n: t.n,
      symbol: t.symbol,
      side: t.side,
      qty: t.qty,
      entryAt: t.entryAt,
      exitAt: t.exitAt,
      entryClock: t.entryClock,
      exitClock: t.exitClock,
      entryAvg: t.entryAvg,
      exitAvg: t.exitAvg,
      holdMin: t.holdMin,
      pnl: t.pnl,
      charges: t.charges,
      net: t.net,
      peak: r && r.bestExit ? { at: r.bestExit.at, clock: r.bestExit.clock, price: r.bestExit.price, pnl: r.bestExit.pnl, pct: r.mfePct ?? null, kind: r.bestExit.kind } : null,
      worst: r && r.worst ? { at: r.worst.at, clock: r.worst.clock, price: r.worst.price, pnl: r.worst.pnl, pct: r.maePct ?? null } : null,
      booked: t.net,
      leftOnTable: r && r.timing ? Math.max(0, r.timing.leftOnTable) : null,
      gapMin: r && r.timing ? r.timing.gapMin : null,
      efficiency: r && r.timing ? r.timing.efficiency : null,
      ranOn: r ? r.ranOn ?? null : null,
      avoided: r ? r.avoided ?? null : null,
      missed: ranOnAfter(t) && r.bestExitDay.pnl > t.pnl ? r2(r.bestExitDay.pnl - t.pnl) : 0,
      afterPeak: ranOnAfter(t) ? { at: r.bestExitDay.at, clock: r.bestExitDay.clock, price: r.bestExitDay.price, pnl: r.bestExitDay.pnl } : null,
      coach: r && r.coach && r.coach.exit ? { at: r.coach.exit.at, clock: r.coach.exit.clock, price: r.coach.exit.price, pnl: r.coach.exit.pnl, said: Boolean(r.coach.exit.said), vsYours: r.coach.vsYours ?? null } : null,
      context: r ? { vsVwapPct: r.vsVwapPct ?? null, opening: r.opening || null, rangePos: r.rangePos ?? null, minutesIn: r.minutesIn ?? null } : null,
      flags: t.flags,
      outcome: t.outcome,
    };
  });
  const measured = rows.filter((x) => x.outcome.id !== "unmeasured");
  const count = (id) => rows.filter((x) => x.outcome.id === id).length;
  const left = measured.reduce((a, x) => a + (x.leftOnTable || 0), 0);
  const summary = {
    trades: rows.length,
    net: lab && lab.summary ? lab.summary.net : r2(rows.reduce((a, x) => a + x.net, 0)),
    leftOnTable: r2(left),
    booked: count("near-best") + count("kept-most"),
    gaveBack: count("gave-back") + count("winner-to-loser"),
    leftEarly: count("left-early"),
    neverPaid: count("never-paid"),
    cutInTime: count("loss-cut"),
    score: lab && lab.summary ? lab.summary.score : null,
    peak: curve && curve.measured ? curve.peak : null,
    trough: curve && curve.measured ? curve.trough : null,
    givenBack: curve && curve.measured ? curve.givenBack : null,
  };
  const headline = [];
  if (summary.peak && summary.peak.pnl > 0) headline.push(`The day's profit peaked at ${sg(summary.peak.pnl)} at ${summary.peak.clock}${summary.givenBack > 0 ? `; it closed at ${sg(curve.close)}, so ${rs(summary.givenBack)} of the peak was given back` : "; you kept it"}.`);
  else if (summary.trough && summary.trough.pnl < 0) headline.push(`The day was never in profit; its lowest was ${sg(summary.trough.pnl)} at ${summary.trough.clock}, and it closed at ${sg(curve.close)}.`);
  const worstLeft = rows.filter((x) => x.leftOnTable > 0).sort((a, b) => b.leftOnTable - a.leftOnTable)[0];
  if (worstLeft && worstLeft.leftOnTable >= 50) headline.push(`The biggest peak not booked: ${worstLeft.symbol} — ${sg(worstLeft.peak.pnl)} at ${worstLeft.peak.clock}, closed ${sg(worstLeft.net)} (${rs(worstLeft.leftOnTable)} left).`);
  return { ver: VER, date, summary, headline, day: curve, trades: rows, moments: slim, notes };
}

/** One row per trade of a snapshot — the outcomes table. */
function outcomeRows(snap) {
  return snap.trades.map((t) => ({
    id: `${snap.date}:${t.key}`,
    date: snap.date,
    key: t.key,
    symbol: t.symbol,
    side: t.side,
    qty: t.qty,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    entryClock: t.entryClock,
    exitClock: t.exitClock,
    entryAvg: t.entryAvg,
    exitAvg: t.exitAvg,
    holdMin: t.holdMin,
    net: t.net,
    pnl: t.pnl,
    peakClock: t.peak ? t.peak.clock : null,
    peakPnl: t.peak ? t.peak.pnl : null,
    peakPct: t.peak ? t.peak.pct : null,
    leftOnTable: t.leftOnTable,
    gapMin: t.gapMin,
    efficiency: t.efficiency,
    ranOn: t.ranOn,
    missed: t.missed,
    avoided: t.avoided,
    outcome: t.outcome.id,
    tone: t.outcome.tone,
    text: t.outcome.text,
    flags: t.flags,
    vsVwapPct: t.context ? t.context.vsVwapPct : null,
    opening: t.context ? t.context.opening : null,
    minutesIn: t.context ? t.context.minutesIn : null,
  }));
}

/** The outcomes added up: how many of each, what each cost or earned. */
function outcomeSummary(rows) {
  const by = {};
  for (const id of Object.keys(OUTCOMES)) by[id] = { id, ...{ name: OUTCOMES[id].name, tone: OUTCOMES[id].tone, short: OUTCOMES[id].short }, count: 0, net: 0, left: 0 };
  for (const r of rows) {
    const b = by[r.outcome] || by.unmeasured;
    b.count += 1;
    b.net += r.net || 0;
    b.left += r.leftOnTable || 0;
  }
  const list = Object.values(by).map((b) => ({ ...b, net: r2(b.net), left: r2(b.left) }));
  const measured = rows.filter((r) => r.outcome !== "unmeasured");
  const withPeak = measured.filter((r) => num(r.peakPnl) && r.peakPnl > 0);
  return {
    trades: rows.length,
    net: r2(rows.reduce((a, r) => a + (r.net || 0), 0)),
    leftOnTable: r2(measured.reduce((a, r) => a + (r.leftOnTable || 0), 0)),
    missedAfter: r2(measured.reduce((a, r) => a + (r.missed || 0), 0)),
    peakOnOffer: r2(withPeak.reduce((a, r) => a + r.peakPnl, 0)),
    took: r2(withPeak.reduce((a, r) => a + Math.max(0, r.net), 0)),
    byOutcome: list,
  };
}

/* ----------------------------------------------------------------------------------- learnings */

/** The patterns the register counts: each with the rows that match, what it cost (or earned) and the rule to follow. */
const PATTERNS = [
  { id: "o:winner-to-loser", kind: "avoid", title: OUTCOMES["winner-to-loser"].name, text: "A trade that was up and closed at a loss.", rule: OUTCOMES["winner-to-loser"].rule, match: (r) => r.outcome === "winner-to-loser", cost: (r) => Math.max(0, r.leftOnTable || 0) },
  { id: "o:gave-back", kind: "avoid", title: OUTCOMES["gave-back"].name, text: "A winner held well past its best moment: part of the profit went back.", rule: OUTCOMES["gave-back"].rule, match: (r) => r.outcome === "gave-back", cost: (r) => Math.max(0, r.leftOnTable || 0) },
  { id: "o:left-early", kind: "avoid", title: OUTCOMES["left-early"].name, text: "A winner closed in full before the bigger move came.", rule: OUTCOMES["left-early"].rule, match: (r) => r.outcome === "left-early", cost: (r) => Math.max(0, r.missed || 0) },
  { id: "o:never-paid", kind: "avoid", title: OUTCOMES["never-paid"].name, text: "A trade the price never moved meaningfully in your favour.", rule: OUTCOMES["never-paid"].rule, match: (r) => r.outcome === "never-paid", cost: (r) => Math.max(0, -(r.net || 0)) },
  ...Object.entries(FLAGS).map(([id, f]) => ({ id: `f:${id}`, kind: "avoid", title: f.name, text: f.text, rule: ACTION[id] || "", match: (r) => (r.flags || []).includes(id), cost: (r) => Math.max(0, -(r.net || 0)) })),
  { id: "k:near-best", kind: "keep", title: OUTCOMES["near-best"].name, text: "You left within minutes of the best moment, or took nearly all of it.", rule: OUTCOMES["near-best"].rule, match: (r) => r.outcome === "near-best", cost: (r) => Math.max(0, r.net || 0) },
  { id: "k:loss-cut", kind: "keep", title: OUTCOMES["loss-cut"].name, text: "A trade that never worked, closed before the price went further against you.", rule: OUTCOMES["loss-cut"].rule, match: (r) => r.outcome === "loss-cut", cost: (r) => Math.max(0, r.avoided || 0) },
];

const STATUSES = ["open", "working", "mastered", "ignored"];

/**
 * The register of learnings from the outcome rows.
 * @param rows   every outcome row ({ date, … }), any order
 * @param mine   the stored records: { id, status, note, masteredAt, kind: "own", text, rule, createdAt } (statuses of the counted patterns and the trader's own lessons)
 * @param dates  the recorded days (sorted ascending): how many recorded days ago something last happened
 */
function learnings(rows, mine = [], dates = []) {
  const days = [...new Set([...dates, ...rows.map((r) => r.date)])].sort();
  const own = new Map(mine.map((m) => [m.id, m]));
  const out = [];
  for (const p of PATTERNS) {
    const hits = rows.filter(p.match).sort((a, b) => (a.date === b.date ? a.entryAt - b.entryAt : a.date < b.date ? -1 : 1));
    const m = own.get(p.id) || null;
    if (!hits.length && !(m && (m.status !== "open" || m.note))) continue;
    const last = hits.length ? hits[hits.length - 1] : null;
    const first = hits[0] || null;
    const since = last ? days.filter((d) => d > last.date).length : null;
    const dayCount = new Set(hits.map((h) => h.date)).size;
    const recentDays = days.slice(-3);
    let state = "new";
    if (p.kind === "keep") state = "strength";
    else if (hits.length) state = last && recentDays.includes(last.date) ? (dayCount >= 2 ? "repeating" : "new") : since >= 5 ? "quiet" : "easing";
    const relapse = Boolean(m && m.status === "mastered" && m.masteredAt && last && last.date > m.masteredAt);
    const wins = hits.filter((h) => h.net > 0).length;
    out.push({
      id: p.id,
      kind: p.kind,
      source: "measured",
      title: p.title,
      text: p.text,
      rule: p.rule,
      count: hits.length,
      days: dayCount,
      wins,
      cost: r2(hits.reduce((a, h) => a + p.cost(h), 0)),
      net: r2(hits.reduce((a, h) => a + (h.net || 0), 0)),
      firstSeen: first ? first.date : null,
      lastSeen: last ? last.date : null,
      daysSince: since,
      state,
      status: m ? m.status : "open",
      note: m ? m.note || "" : "",
      masteredAt: m ? m.masteredAt || null : null,
      relapse,
      recent: hits.slice(-5).reverse().map((h) => ({ date: h.date, symbol: h.symbol, clock: h.entryClock, net: h.net, id: h.id })),
    });
  }
  for (const m of mine) {
    if (m.kind !== "own") continue;
    out.push({ id: m.id, kind: "own", source: "own", title: m.title || cut(m.text, 80), text: m.text || "", rule: m.rule || "", count: null, days: null, wins: null, cost: null, net: null, firstSeen: m.createdAt ? String(m.createdAt).slice(0, 10) : null, lastSeen: null, daysSince: null, state: "own", status: m.status || "open", note: m.note || "", masteredAt: m.masteredAt || null, relapse: false, recent: [] });
  }
  const rank = { repeating: 0, new: 1, easing: 2, own: 3, quiet: 4, strength: 5 };
  return out.sort((a, b) => {
    const dead = (x) => (x.status === "ignored" ? 1 : 0);
    if (dead(a) !== dead(b)) return dead(a) - dead(b);
    if ((a.kind === "keep") !== (b.kind === "keep")) return a.kind === "keep" ? 1 : -1;
    if (a.relapse !== b.relapse) return a.relapse ? -1 : 1;
    return (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || (b.cost || 0) - (a.cost || 0);
  });
}

module.exports = { VER, OUTCOMES, PATTERNS, STATUSES, MATERIAL_PCT, classify, dayCurve, readCurve, momentsOf, buildSnapshot, outcomeRows, outcomeSummary, learnings, flightOf };
