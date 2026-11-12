"use strict";
// The day replayed: what the live call would have said at each 5-minute close, and
// how every "in play" call then turned out — by arithmetic, on the day's own bars.
//
// For each completed 5-minute bar the engine is asked the question it is asked live,
// with only what was known at that moment: the bars so far, a quote made from them,
// and the daily picture as it stood at the previous close. When the answer changes to
// "Long — in play" or "Short — in play", that call is followed forward bar by bar:
//   • the stop first — a bar that touches both the stop and the target counts as a stop,
//     and a gap through the stop is filled at the bar's open, not at the stop
//   • then the 1R target
//   • the opposite call closes it at that bar's close
//   • otherwise it is closed at the open of the 3:15 PM bar (the square-off)
// One trade at a time; a call that merely repeats itself while a trade is open is not
// a new trade. Results are in multiples of the risk taken (R), before and after an
// assumed cost per round trip.
//
// What a replay is not. The live call also saw the market's direction, the tick stream
// and the order book, and was read every two seconds rather than once every five
// minutes — so the calls seen on the day can differ from these. It is not a record of
// anything that was traded. And one day proves nothing.

const I = require("./indicators");
const { buildVerdict } = require("./verdict");
const { barStart } = require("./intraday");

const IST = 5.5 * 3600 * 1000;
const STEP_MS = 5 * 60000;
const SQUARE_OFF = "15:15";
// Brokerage, STT, exchange fees, GST and stamp duty on an intraday round trip, as a share
// of the position's value. An assumption, not a quote: the contract note is the truth.
const DEFAULT_COST_PCT = 0.1;
const LABEL = {
  long: "LONG in play",
  short: "SHORT in play",
  "wait-long": "WAIT · long side",
  "wait-short": "WAIT · short side",
  wait: "WAIT · no edge",
  "no-trade": "NO TRADE",
  closed: "Closed",
};

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const stamp = (ms) => new Date(ms + IST).toISOString().slice(0, 19).replace("T", " ");
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

/**
 * @param analysis  the daily analysis as of the previous close
 * @param candles   daily bars up to and including the previous session (oldest first)
 * @param bars      the session's 5-minute bars (oldest first)
 * @param prior     earlier sessions' 5-minute bars (warm-up for the intraday averages)
 * @param circuit   { upper, lower } | null — the day's price band, when it is known
 * @param costPct   assumed cost of a round trip, in percent of the position's value
 * @returns { available, date, costPct, day, steps, changes, trades, summary }
 */
function* run({ analysis, candles, bars, prior = [], circuit = null, costPct = DEFAULT_COST_PCT }) {
  if (!analysis || !analysis.enoughData || !Array.isArray(candles) || candles.length === 0) {
    return { available: false, reason: (analysis && analysis.message) || "Not enough price history to replay the day." };
  }
  if (!Array.isArray(bars) || bars.length === 0) return { available: false, reason: "There are no 5-minute bars for the session." };

  const date = String(bars[0].t).slice(0, 10);
  const prevClose = candles[candles.length - 1].c;
  const atr = analysis.levels && analysis.levels.atr ? analysis.levels.atr.value : null;
  const steps = [];
  const changes = [];
  const trades = [];
  let open = null; // the one simulated trade in progress
  let was = null;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;

  const finish = (t, when, price, why) => {
    const dir = t.side === "long" ? 1 : -1;
    t.exitAt = when;
    t.exit = r2(price);
    t.why = why;
    t.r = r2((dir * (price - t.entry)) / t.risk);
    t.netR = r2(t.r - t.costR);
    if (why !== "open") open = null;
  };

  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const start = barStart(b.t);
    if (start === null) continue;
    const at = start + STEP_MS; // the moment this bar closed
    const began = clock(start);
    const closedAt = clock(at);
    high = Math.max(high, b.h);
    low = Math.min(low, b.l);
    volume += b.v || 0;

    /* 1. a trade that is already open lives through this bar first */
    if (open) {
      const long = open.side === "long";
      if (began >= SQUARE_OFF) finish(open, began, b.o, "square-off");
      else if (long ? b.l <= open.stop : b.h >= open.stop) finish(open, began, long ? Math.min(open.stop, b.o) : Math.max(open.stop, b.o), "stop");
      else if (num(open.target) && (long ? b.h >= open.target : b.l <= open.target)) finish(open, began, open.target, "target");
    }

    /* 2. what the engine says at this bar's close, knowing only what was known then */
    const quote = { last: b.c, open: bars[0].o, high, low, prevClose, volume, time: stamp(at) };
    if (circuit && num(circuit.upper) && num(circuit.lower)) {
      quote.upperCircuit = circuit.upper;
      quote.lowerCircuit = circuit.lower;
    }
    const v = buildVerdict({ analysis, candles, quote, intradayBars: bars.slice(0, i + 1), priorBars: prior, inProgress: false, nowMs: at });
    const call = v.available && v.day && v.day.available ? v.day : null;
    const state = call ? call.state : "closed";
    steps.push({ t: closedAt, state, score: call ? call.score : null, price: r2(b.c) });
    if (was !== null && was !== state) changes.push({ t: closedAt, from: LABEL[was], to: LABEL[state], price: r2(b.c) });
    const fresh = (state === "long" || state === "short") && was !== state;
    was = state;

    /* 3. a fresh "in play" call starts a trade; the opposite call closes the one that is open */
    if (fresh && call.plan) {
      if (open && open.side !== state) finish(open, closedAt, b.c, "flip");
      const risk = Math.abs(b.c - call.plan.stop);
      if (!open && risk > 0) {
        const first = call.plan.targets[0];
        open = {
          side: state,
          at: closedAt,
          entry: r2(b.c),
          stop: call.plan.stop,
          target: first ? first.price : null, // a target beyond the circuit limit is not one
          risk,
          riskPerShare: r2(risk),
          riskPct: r2((risk / b.c) * 100),
          score: call.score,
          withDaily: call.withDaily,
          phase: call.session.phase,
          costR: r2(((costPct / 100) * b.c) / risk),
          exitAt: null,
          exit: null,
          why: null,
          r: null,
          netR: null,
        };
        trades.push(open);
      }
    }
    yield; // one bar done: a caller that must stay responsive can pause here
  }
  // the bars ran out with a trade still open (the session is not over): mark it at the last price
  const lastBar = bars[bars.length - 1];
  if (open) finish(open, clock(barStart(lastBar.t) + STEP_MS), lastBar.c, "open");

  const done = trades.filter((t) => t.why !== "open");
  const total = (k) => r2(done.reduce((s, t) => s + t[k], 0));
  const count = (why) => trades.filter((t) => t.why === why).length;
  const summary = {
    calls: trades.length,
    finished: done.length,
    target: count("target"),
    stop: count("stop"),
    squareOff: count("square-off"),
    flip: count("flip"),
    open: count("open"),
    wins: done.filter((t) => t.netR > 0).length,
    losses: done.filter((t) => t.netR < 0).length,
    grossR: total("r"),
    costR: total("costR"),
    netR: total("netR"),
    bestR: done.length ? Math.max(...done.map((t) => t.netR)) : null,
    worstR: done.length ? Math.min(...done.map((t) => t.netR)) : null,
    callChanges: changes.length,
  };

  const vw = I.vwap(bars);
  const vwap = vw[vw.length - 1];
  const opening = bars.filter((b) => String(b.t).slice(11, 16) < "09:30");
  const orHigh = opening.length ? Math.max(...opening.map((b) => b.h)) : null;
  const orLow = opening.length ? Math.min(...opening.map((b) => b.l)) : null;
  const closePx = lastBar.c;
  const day = {
    date,
    bars: bars.length,
    complete: String(lastBar.t).slice(11, 16) >= "15:25",
    open: r2(bars[0].o),
    high: r2(high),
    low: r2(low),
    close: r2(closePx),
    prevClose: r2(prevClose),
    changePct: r2(pct(closePx, prevClose)),
    gapPct: r2(pct(bars[0].o, prevClose)),
    fromOpenPct: r2(pct(closePx, bars[0].o)),
    rangePct: r2(((high - low) / prevClose) * 100),
    rangeVsAtr: num(atr) && atr > 0 ? r2((high - low) / atr) : null,
    atr: r2(atr),
    vwap: r2(vwap),
    closeVsVwapPct: r2(pct(closePx, vwap)),
    orHigh: r2(orHigh),
    orLow: r2(orLow),
    closedVsOpeningRange: !num(orHigh) ? null : closePx > orHigh ? "above" : closePx < orLow ? "below" : "inside",
    volume,
  };

  return {
    available: true,
    date,
    costPct,
    day,
    steps,
    changes,
    trades: trades.map(({ risk, ...t }) => t),
    summary,
  };
}

/** The whole replay in one go. Pure arithmetic: the same bars always give the same answer. */
function replayDay(args) {
  const it = run(args);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * The same replay, stepping aside every few bars so a server that is also streaming
 * live prices is never held up by it.
 */
async function replayDayAsync(args, { every = 6 } = {}) {
  const it = run(args);
  let step = it.next();
  let n = 0;
  while (!step.done) {
    n += 1;
    if (n % every === 0) await new Promise((resolve) => setImmediate(resolve));
    step = it.next();
  }
  return step.value;
}

/**
 * Many stocks' replays as one day: every finished call in time order with a running
 * total, so the day can be drawn as one line in R.
 * @param rows  [{ symbol, available, trades, summary }]
 */
function combine(rows) {
  const ok = rows.filter((r) => r.available);
  const all = ok.flatMap((r) => r.trades.filter((t) => t.why !== "open").map((t) => ({ symbol: r.symbol, ...t })));
  all.sort((a, b) => (a.exitAt < b.exitAt ? -1 : a.exitAt > b.exitAt ? 1 : a.symbol < b.symbol ? -1 : 1));
  let run = 0;
  const curve = all.map((t) => {
    run += t.netR;
    return { t: t.exitAt, symbol: t.symbol, side: t.side, why: t.why, netR: t.netR, total: r2(run) };
  });
  const sum = (k) => r2(ok.reduce((s, r) => s + (r.summary[k] || 0), 0));
  const totals = {
    stocks: ok.length,
    calls: sum("calls"),
    finished: sum("finished"),
    target: sum("target"),
    stop: sum("stop"),
    squareOff: sum("squareOff"),
    flip: sum("flip"),
    open: sum("open"),
    wins: sum("wins"),
    losses: sum("losses"),
    grossR: sum("grossR"),
    costR: sum("costR"),
    netR: sum("netR"),
  };
  // the deepest fall of the running total from an earlier high: what following every call would have felt like
  let peak = 0;
  let worst = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.total);
    worst = Math.min(worst, p.total - peak);
  }
  totals.deepestDipR = r2(worst);
  return { totals, curve };
}

module.exports = { replayDay, replayDayAsync, combine, DEFAULT_COST_PCT, LABEL, SQUARE_OFF };
