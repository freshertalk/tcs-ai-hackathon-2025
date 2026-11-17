"use strict";
// The playbook for a stock and a day: what state the market is in, what usually happens when, and — for every
// situation that can arise — the trigger, the action, the size, the stop and the way out.
//
// It answers the three questions a working trader asks before the open:
//   WHAT KIND OF DAY is this likely to be?   the regime (trending, range, squeeze, volatile) from the daily chart
//   WHAT HAPPENS WHEN?                       the day's script by time window, with this stock's own measured habits
//   IF X, THEN WHAT?                         scenarios: each a machine-checkable trigger with its action, entry, stop,
//                                            targets, size factor and what cancels it
//
// Scenarios are data, not prose, so the autonomous desk can watch them live (evaluate) and turn a fired one into an
// order PROPOSAL. A probability appears only where it was measured (the plan's replayed record, the stock's opening-range
// habits, the calibration of past outlooks) and never otherwise.
//
// Pure functions: the service supplies the daily bars, the intraday plan, the events and the live prices.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const TICK = 0.05;
const onTick = (x) => (num(x) ? r2(Math.round(x / TICK) * TICK) : null);
const rank = (xs, v) => (xs.length ? Math.round((xs.filter((x) => x <= v).length / xs.length) * 100) : null);
const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const OPEN = mins("09:15");

/* ------------------------------------------------------------------------------------------- the regime */

function ema(xs, n) {
  const k = 2 / (n + 1);
  let e = xs[0];
  const out = [e];
  for (let i = 1; i < xs.length; i += 1) {
    e = xs[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

/**
 * What kind of market this stock is in, from its completed daily bars.
 *   trending   Kaufman's efficiency ratio (net move ÷ total path) over 20 sessions is high and price is stacked on its averages
 *   squeeze    Bollinger width in the lowest part of its own last 120 sessions: compression, which tends to end in expansion
 *   volatile   the 14-day average range is in the top of its own last 120 sessions
 *   range      none of the above
 * @returns { kind, word, er, atrPct, atrRank, bbRank, doThis[] } or null with fewer than 60 bars
 */
function regimeOf(daily) {
  if (!Array.isArray(daily) || daily.length < 60) return null;
  const c = daily.map((b) => b.c);
  const n = c.length - 1;
  const trPct = daily.map((b, i) => (i ? (Math.max(b.h, daily[i - 1].c) - Math.min(b.l, daily[i - 1].c)) / daily[i - 1].c * 100 : null));
  const atrSeries = [];
  for (let i = 14; i <= n; i += 1) atrSeries.push(mean(trPct.slice(i - 13, i + 1)));
  const atrPct = atrSeries[atrSeries.length - 1];
  const atrRank = rank(atrSeries.slice(-120), atrPct);
  const path = c.slice(n - 19).reduce((s, x, i, a) => (i ? s + Math.abs(x - a[i - 1]) : s), 0);
  const er = path > 0 ? Math.abs(c[n] - c[n - 19]) / path : 0;
  const e20 = ema(c, 20)[n];
  const e50 = ema(c, 50)[n];
  const bbw = [];
  for (let i = 19; i <= n; i += 1) {
    const w = c.slice(i - 19, i + 1);
    const m = mean(w);
    const sd = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / 19);
    bbw.push((4 * sd) / m * 100);
  }
  const bbRank = rank(bbw.slice(-120), bbw[bbw.length - 1]);
  let kind = "range";
  if (bbRank <= 15) kind = "squeeze";
  else if (atrRank >= 85) kind = "volatile";
  if (er >= 0.35 && c[n] > e20 && e20 > e50) kind = "trending-up";
  else if (er >= 0.35 && c[n] < e20 && e20 < e50) kind = "trending-down";
  const GUIDE = {
    "trending-up": { word: "Trending up", doThis: ["Trade with the trend: buy pullbacks to the 20-day average and breaks of the day's range; skip shorts unless a daily support fails.", "Let winners run to the second target; trail under each higher low.", "A first fade at the open is usually a gift in an uptrend, not a reversal."] },
    "trending-down": { word: "Trending down", doThis: ["Trade with the trend: short rallies into resistance and breaks of the day's low (intraday only in cash); skip longs unless a daily resistance is reclaimed.", "Cover into strength; do not hold a short overnight in the cash market.", "A bounce that fails at the 20-day average is the classic place to be short."] },
    squeeze: { word: "Squeeze (compressed)", doThis: ["Volatility is unusually low for this stock: expansion tends to follow, direction unknown. Do not anticipate — trade the break with the opening-range scenarios and a tight stop.", "Expect the first break to be the best; a false break that returns inside is a signal in itself.", "Keep size normal, not larger: the move is likely, its direction is not."] },
    volatile: { word: "Volatile (wide ranges)", doThis: ["Ranges are wide for this stock: use wider stops with smaller size so the rupee risk stays the same.", "Do not chase: moves overshoot and retrace. Prefer entries at levels over entries in motion.", "Take profits sooner; targets are reached faster and given back faster."] },
    range: { word: "Range-bound", doThis: ["No trend to ride: fade the extremes of the range with small size, take profit at the middle, and do not hold breakouts without volume.", "Breakouts from a range fail often: wait for a close beyond the range, not a spike.", "Fewer trades: the edge here is patience at the edges."] },
  };
  return { kind, word: GUIDE[kind].word, er: r2(er), atrPct: r2(atrPct), atrRank, bbRank, doThis: GUIDE[kind].doThis };
}

/* --------------------------------------------------------------------------------------------- the day */

/** The day by time window — what usually happens, and what to do — with this stock's own measured habits where they exist. */
function scriptFor({ open = null, habits = null, plan = null, events = null } = {}) {
  const orb = habits && habits.openingRange;
  const gapLine = open && num(open.gapPct) ? `This morning's forecast open is ${open.expected ? `₹${open.expected}` : "near the last close"} (${open.gapPct >= 0 ? "+" : ""}${open.gapPct}%).` : "";
  const gapHabit = habits && num(habits.gapFillPct) ? ` This stock has filled ${habits.gapFillPct}% of its gaps within the day (${habits.gaps} gaps).` : "";
  const out = [
    { from: "08:45", to: "09:15", title: "Pre-open", happens: "The exchange collects orders until 9:08 and sets the opening price in an auction. Overseas markets and GIFT Nifty set the tone.", do: `Plan, do not trade. ${gapLine}${gapHabit} Decide which scenarios you would take.` },
    { from: "09:15", to: "09:30", title: "Opening range", happens: orb && orb.note ? `Spreads are wide and early moves often reverse. ${orb.note}` : "Spreads are wide and early moves often reverse; the first 15 minutes' high and low become the day's first levels.", do: "Mark the 9:15–9:30 high and low. No entries: a spike in these minutes does not count." },
    { from: "09:30", to: "11:30", title: "Prime window", happens: habits && num(habits.firstHourExtremePct) ? `Volume is deepest and trends form. This stock has set the day's high or low in its first hour on ${habits.firstHourExtremePct}% of days.` : "Volume is deepest and trends form.", do: "The best place for the planned break scenarios, with a stop in with the order. Trend days (about " + (habits && num(habits.trendDayPct) ? `${habits.trendDayPct}% for this stock` : "one in four") + ") reward holding to the second target." },
    { from: "11:30", to: "13:30", title: "Midday lull", happens: habits && num(habits.vwapHoldPct) ? `Volume thins and prices chop around VWAP. The first VWAP break here has held ${habits.vwapHoldPct}% of the time.` : "Volume thins and prices chop around VWAP.", do: "Fewer, smaller trades. Skip setups that need momentum; manage what you hold." },
    { from: "13:30", to: "14:45", title: "Afternoon", happens: "Activity often returns. A trend that has run all day can still reverse, and the day's late high or low is often set here.", do: "Trade the plan only. Trail stops under structure; do not add to a position that has already given most of its move." },
    { from: "14:45", to: "15:20", title: "Wind-down", happens: "Squaring begins. Late moves are as much flows as information.", do: "No new entries after 3:00 PM. Close or tighten everything; a cash-market short must be bought back today." },
    { from: "15:20", to: "15:30", title: "Square-off and close", happens: "Brokers square off intraday (MIS) positions from about 3:20 PM (check yours). The closing price is the last half hour's weighted average.", do: "Be flat. Review the day: what the plan said, what happened, what you did." },
  ];
  if (events && events.events && events.events.length) out.unshift({ from: "00:00", to: "08:45", title: "Before you start", happens: events.events.map((e) => e.title).join("; "), do: events.events.map((e) => e.advice).join(" ") });
  return out;
}

/* ----------------------------------------------------------------------------------------- scenarios */

const edgeOf = (rec) => (rec && rec.trades >= 8 ? { n: rec.trades, avgR: rec.avgR, winRate: rec.winRate, verdict: rec.verdict } : rec && rec.trades ? { n: rec.trades, avgR: rec.avgR, winRate: rec.winRate, verdict: "too few to judge" } : null);

/** The opening-range plan once the range is known: a break of its high or low, the stop at the other side (capped), 1.5R and 2.5R. */
function orbPlan(orb, side, dayRs) {
  const entry = side === "long" ? orb.high : orb.low;
  const far = side === "long" ? orb.low : orb.high;
  const cap = 0.5 * dayRs;
  const floor = Math.max(TICK * 2, 0.15 * dayRs);
  const dist = clamp(Math.abs(entry - far), floor, cap);
  const stop = side === "long" ? entry - dist : entry + dist;
  const t = (k) => (side === "long" ? entry + k * dist : entry - k * dist);
  return { entry: onTick(entry), stop: onTick(stop), targets: [onTick(t(1.5)), onTick(t(2.5))], riskPerShare: r2(dist), riskPct: r2((dist / entry) * 100), rewardToRisk: 1.5 };
}

/**
 * Every situation worth having a plan for.
 * @param a { symbol, plan (the intraday plan: plans, open, decision, lean, habits, record, options, pivots, dayRangePct),
 *            regime, events (eventsOn), dayRs (a normal day's range in ₹) }
 * @returns [{ id, label, kind: "entry"|"advice", side?, trigger?, plan?, sizeFactor, measured, edge, why, cancels, tags }]
 */
function buildScenarios({ symbol, plan, regime = null, events = null, dayRs = null }) {
  if (!plan || !plan.available) return [];
  const out = [];
  const lean = plan.lean ? plan.lean.call : "neutral";
  const withLean = (side) => (lean === "long-bias" ? side === "long" : lean === "short-bias" ? side === "short" : null);
  const ev = events || { sizeFactor: 1, noOvernight: false, avoidNew: false, events: [] };
  const rec = plan.record || null;
  const orbHab = plan.habits && plan.habits.openingRange;
  const reg = regime ? regime.kind : "range";
  // how much to trade: events, regime and the setup's own record all scale it, and never above 1
  const base = (side, rec2, tag) => {
    let f = ev.sizeFactor;
    const notes = [];
    if (ev.sizeFactor < 1) notes.push(`events today ×${ev.sizeFactor}`);
    if (reg === "volatile") {
      f *= 0.75;
      notes.push("volatile regime ×0.75 (wider stops, same rupee risk)");
    }
    const w = withLean(side);
    if (w === false) {
      f *= 0.6;
      notes.push("against the chart's lean ×0.6");
    }
    if ((reg === "trending-up" && side === "short") || (reg === "trending-down" && side === "long")) {
      f *= 0.6;
      notes.push("against the trend ×0.6");
    }
    if (rec2 && rec2.trades >= 8 && rec2.avgR < 0) {
      f = 0;
      notes.push(`its replayed record lost money (${rec2.avgR}R over ${rec2.trades} sessions) — not proposed`);
    }
    return { sizeFactor: r2(clamp(f, 0, 1)), sizeNotes: notes, with: w };
  };

  for (const side of ["long", "short"]) {
    const p = plan.plans && plan.plans[side];
    if (!p) continue;
    const rec2 = rec ? (rec.lean && rec.lean[side] && rec.lean[side].trades ? rec.lean[side] : rec.both && rec.both[side]) : null;
    const b = base(side, rec2, "break");
    out.push({
      id: `break-${side}`,
      label: side === "long" ? `Break above ₹${p.entry} holds → long` : `Break below ₹${p.entry} holds → short (intraday only)`,
      kind: "entry",
      side,
      trigger: { type: "break", side, level: p.entry, after: "09:30", before: "14:45", hold: 2 },
      plan: { entry: p.entry, stop: p.stop, targets: p.targets, riskPerShare: p.riskPerShare, riskPct: p.riskPct, rewardToRisk: p.rewardToRisk },
      ...b,
      measured: rec2 && rec2.trades ? `Replayed on ${rec2.trades} past sessions with 5-minute bars: ${rec2.winRate}% won, average ${rec2.avgR}R after costs (${rec2.verdict}).` : "No replayed record yet for this side.",
      edge: edgeOf(rec2),
      why: side === "long" ? "The previous session's high (or the pivot) is where yesterday's sellers gave up; a hold above it after 9:30 means buyers took over." : "The previous session's low (or the pivot) is where yesterday's buyers gave up; a hold below it after 9:30 means sellers took over.",
      cancels: [`Price falls back through ₹${p.stop} (the stop) before it triggers`, `It opens beyond ₹${onTick(side === "long" ? p.entry + 0.5 * p.riskPerShare : p.entry - 0.5 * p.riskPerShare)}: it has run away — no chasing`, "After 2:45 PM", "The Nifty moves hard the other way (more than 0.5% against) at the moment of entry"],
      tags: [side, "plan"],
    });
  }

  // the opening-range break: the levels are only known at 9:30, so the plan is made then
  if (dayRs) {
    for (const side of ["long", "short"]) {
      const rec2 = rec && rec.orb && rec.orb.trades ? rec.orb : null;
      const b = base(side, rec2, "orb");
      out.push({
        id: `orb-${side === "long" ? "up" : "down"}`,
        label: side === "long" ? "Opening-range break up → long" : "Opening-range break down → short (intraday only)",
        kind: "entry",
        side,
        trigger: { type: "orb", side, after: "09:30", before: "14:30", hold: 1, dayRs: r2(dayRs) },
        plan: null,
        ...b,
        measured: orbHab && orbHab.note ? orbHab.note : "No measured habit for this stock's opening range yet.",
        edge: edgeOf(rec2),
        why: "The first 15 minutes set the day's first range; a break after 9:30 shows which side has the order flow. The stop is the other side of the range (never more than half a normal day's range); the target is 1.5× the risk.",
        cancels: ["The first break fails back inside the range: do not flip sides on the same day", "After 2:30 PM", "The range is wider than half a normal day: it is too big to risk — skip"],
        tags: [side, "orb"],
      });
    }
  }

  // gaps
  const o = plan.open || null;
  if (o && num(o.gapPct) && num(o.expected)) {
    const big = Math.abs(o.gapPct) >= Math.max(0.8, 1.5 * ((o.high - o.low) / 2 / plan.last) * 100);
    if (big) {
      const up = o.gapPct > 0;
      out.push({
        id: up ? "gap-up" : "gap-down",
        label: `Expected gap ${up ? "up" : "down"} (${o.gapPct > 0 ? "+" : ""}${o.gapPct}%)`,
        kind: "advice",
        sizeFactor: 1,
        measured: plan.habits && num(plan.habits.gapFillPct) ? `This stock has filled ${plan.habits.gapFillPct}% of its gaps within the day (${plan.habits.gaps} gaps).` : "No measured gap habit yet.",
        why: "A gap this size re-anchors the day: yesterday's levels are behind the price.",
        then: [`Wait for 9:15–9:45 to trade; the first fifteen minutes' ${up ? "low" : "high"} is the level that matters.`, up ? "If it holds above the open, the gap is accepted: look for the opening-range break up." : "If it holds below the open, the gap is accepted: look for the opening-range break down.", up ? "If it falls back through yesterday's high within the first 30 minutes, the gap is failing: the move back toward the previous close is the trade (small size)." : "If it rises back through yesterday's low within the first 30 minutes, the gap is failing: the move back toward the previous close is the trade (small size)."],
        cancels: [],
        tags: ["gap"],
      });
    }
  }

  // regime
  if (reg === "squeeze") out.push({ id: "squeeze", label: "Compressed volatility: expect expansion", kind: "advice", sizeFactor: 1, measured: `Bollinger width is in the lowest ${regime.bbRank}% of its last 120 sessions.`, why: "Quiet periods tend to end in a larger move; the direction is not known in advance.", then: ["Do not anticipate. Trade the first confirmed break (the opening-range scenarios) with a tight stop.", "A failed break that returns inside the range is a signal in the other direction."], cancels: [], tags: ["regime"] });

  // levels from the option chain and pivots: where to take profit and where to expect trouble
  const opt = plan.options || null;
  if (opt && num(opt.resistance)) out.push({ id: "call-wall", label: `Test of the call wall ₹${opt.resistance}`, kind: "advice", sizeFactor: 1, measured: `PCR ${opt.pcr ?? "—"}; max pain ₹${opt.maxPain ?? "—"}; bias ${opt.label}.`, why: "The strike with the most call open interest is where writers defend; price often stalls there, especially into expiry.", then: ["Take part-profit on a long into it.", "A clean close through it with volume shows the writers giving way: hold the rest with the stop at the wall."], cancels: [], tags: ["levels"] });
  if (opt && num(opt.support)) out.push({ id: "put-wall", label: `Test of the put wall ₹${opt.support}`, kind: "advice", sizeFactor: 1, measured: `PCR ${opt.pcr ?? "—"}; max pain ₹${opt.maxPain ?? "—"}.`, why: "The strike with the most put open interest is where writers defend support.", then: ["Cover part of a short into it.", "A clean close below it shows the support giving way: hold the rest with the stop at the wall."], cancels: [], tags: ["levels"] });

  // events
  for (const e of ev.events || []) {
    out.push({ id: `event-${e.kind}-${e.date}`, label: `${e.title} (${e.date})`, kind: "advice", sizeFactor: e.sizeFactor, measured: "", why: e.advice, then: [e.noOvernight ? "Be flat before the close." : "No special handling beyond the size factor.", e.avoidNew ? "No new trades around the announcement." : ""].filter(Boolean), cancels: [], tags: ["event"], event: true });
  }

  // the market turning against you
  out.push({ id: "risk-off", label: "The Nifty turns hard against you", kind: "advice", sizeFactor: 1, measured: "", why: "When the index moves 0.7% or more against a trade in a short time, stocks follow whatever their own chart says.", then: ["Longs: stop adding; cut size by half or exit if the stock is below VWAP.", "Shorts: the same in a sharp rally.", "Do not average down."], cancels: [], tags: ["market"] });

  return out;
}

/* ----------------------------------------------------------------------------------- watching live */

/**
 * Where one scenario stands against the live market.
 * @param sc    a scenario from buildScenarios
 * @param live  { minute, price, bars1: [{ t, o, h, l, c }] today's COMPLETED 1-minute bars (the minute still forming left out), orb: {high,low}|null, fired: boolean }
 * @returns { state: "waiting"|"armed"|"breaking"|"triggered"|"late"|"invalid"|"expired"|"info", note, plan? }
 */
function evaluate(sc, live) {
  if (!sc || sc.kind !== "entry" || !sc.trigger) return { state: "info", note: "" };
  const t = sc.trigger;
  const after = mins(t.after);
  const before = mins(t.before);
  if (live.fired) return { state: "triggered", note: "It has fired today.", plan: live.firedPlan || sc.plan };
  if (live.minute < after) return { state: "waiting", note: `Not before ${t.after}.` };
  if (live.minute >= before) return { state: "expired", note: `After ${t.before}: no new entries.` };
  const price = live.price;
  if (!num(price)) return { state: "waiting", note: "No live price." };
  const long = t.side === "long";
  let level;
  let plan = sc.plan;
  if (t.type === "orb") {
    if (!live.orb || !num(live.orb.high) || !num(live.orb.low)) return { state: "waiting", note: "The 9:15–9:30 range is not known yet." };
    const h = live.orb.high - live.orb.low;
    if (t.dayRs && h > 0.5 * t.dayRs) return { state: "invalid", note: `The opening range (₹${r2(h)}) is wider than half a normal day (₹${r2(0.5 * t.dayRs)}): too big to risk.` };
    plan = orbPlan(live.orb, t.side, t.dayRs || h * 2);
    level = plan.entry;
  } else level = t.level;
  const risk = plan.riskPerShare;
  const distPct = Math.round(((price / level - 1) * 100) * 100) / 100;
  const through = long ? price > level : price < level;
  if (long ? price <= plan.stop : price >= plan.stop) return { state: "invalid", note: "Price is already through the stop: this setup is spoiled for today.", plan };
  if (!through) return { state: "armed", note: `${Math.abs(distPct)}% ${long ? "below" : "above"} the trigger ₹${level}.`, plan, distancePct: distPct };
  if (Math.abs(price - level) > 0.5 * risk) return { state: "late", note: `Already ₹${r2(Math.abs(price - level))} beyond the trigger (more than half the risk): no chasing.`, plan };
  // it is through the level: has it held? the completed 1-minute bars since 9:30 must have closed beyond it
  const need = t.hold || 1;
  const recent = (live.bars1 || []).slice(-need); // completed minutes only: the caller leaves out the one still forming
  const held = recent.length >= need && recent.every((b) => (long ? b.c > level : b.c < level));
  return held ? { state: "triggered", note: `Held ${need} minute${need > 1 ? "s" : ""} ${long ? "above" : "below"} ₹${level}.`, plan } : { state: "breaking", note: `Through ₹${level}; waiting for it to hold ${need} minute${need > 1 ? "s" : ""}.`, plan };
}

/** The opening range from today's 1-minute bars: the high and low of 9:15–9:29. Null until 9:30 or with too few bars. */
function openingRange(bars1, dayStartMs) {
  const from = dayStartMs + OPEN * 60000;
  const to = from + 15 * 60000;
  const w = (bars1 || []).filter((b) => b.t >= from && b.t < to);
  if (w.length < 10) return null;
  return { high: Math.max(...w.map((b) => b.h)), low: Math.min(...w.map((b) => b.l)), bars: w.length };
}

module.exports = { regimeOf, scriptFor, buildScenarios, evaluate, orbPlan, openingRange, edgeOf };
