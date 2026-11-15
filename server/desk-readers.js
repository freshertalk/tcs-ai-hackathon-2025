"use strict";
// What TradeAI's agent may read from outside the AI folder.
//
// The AI folder cannot load the broker, the flight deck or anything with a timer. app.js builds
// these read-only functions and hands them to TradeAI (`ai.tradeai.desk`); the agent (ai/agent.js)
// calls them when a question needs them:
//
//   reading(symbol)  the exit coach's live reading of the trader's open position(s): the word, the
//                    exit pressure, the price to exit at, the stop, the next target, the reasons on
//                    both sides, the P&L and its best, the order book, and the AI's checked levels
//   tape(symbol)     today's tape from the 1-minute bars (market/tape.js: RSI, VWAP, Bollinger,
//                    volume, momentum, price action) with the live quote and the order-flow reading
//   levels(symbol)   the desk's level map around the price (trading/exitlevels.js), each level with
//                    how often its kind has held (the level learner) and the odds of a touch
//   lab(date)        the Execution Lab's replay of a day and the Coach's comparison, in brief
//   learned(symbol)  what the level learner has measured
//
// Every function only reads. None can place, change or cancel an order.

const { tapeRead } = require("./market/tape");
const { levelMap } = require("./trading/exitlevels");

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const openOf = (ms) => Date.parse(`${istDate(ms)}T03:45:00Z`); // 9:15 AM IST

/** One level of the map as the model reads it. */
const levelRow = (a) => ({
  price: a.price,
  what: a.label,
  strength: a.strength,
  awayPct: a.awayPct,
  touchesToday: a.touches,
  reachPct: a.touchPct,
  ...(a.held ? { held: `${a.held.pct}% of ${a.held.n} tests (${a.held.scope})${a.held.hour ? `; ${a.held.hour.name}, all stocks: ${a.held.hour.pct}% of ${a.held.hour.n}` : ""}` } : {}),
});

/** A position on the Live board, as the model and the instant answer read it. */
function readingOf(p) {
  const a = p.advice;
  const m = a.metrics;
  const set = p.levels && !p.levels.failed ? p.levels : null;
  const near = (side, n) => ((p.map && p.map.anchors) || []).filter((x) => x.side === side).sort((x, y) => Math.abs(x.awayPct) - Math.abs(y.awayPct)).slice(0, n).map(levelRow);
  return {
    symbol: p.symbol,
    exchange: p.exchange,
    product: p.product,
    side: p.side,
    qty: p.qty,
    avg: p.avg,
    enteredAt: p.entryClock,
    coach: { word: a.word, state: a.state, pressure: a.pressure, headline: a.headline, exit: a.exit, stop: a.stop, stopKind: a.stopKind, target: a.target, whyLeave: a.reasons.exit, whyStay: a.reasons.hold },
    numbers: {
      last: m.last,
      pnl: m.pnl,
      gainPct: m.gainPct,
      best: m.peak ? { price: m.peak.price, clock: m.peak.clock, pnl: m.peak.pnl, gainPct: m.peak.gainPct } : null,
      worst: m.trough ? { price: m.trough.price, clock: m.trough.clock, pnl: m.trough.pnl } : null,
      givenBackPct: m.givebackPct,
      minutesIn: m.minutesIn,
      minutesToSquareOff: m.minutesToSquareOff,
      vwap: m.vwap,
      vsVwapPct: m.vsVwapPct,
      rsi1min: m.rsi1,
      last3minPct: m.move3Pct,
      bid: m.bid,
      ask: m.ask,
      orderBook: m.book ? { buyersPct: m.book.buyersPct, label: m.book.label, pressure: m.book.pressure, lastMinuteDelta: m.book.delta60, lean: m.book.lean, wall: m.book.wall } : null,
      next15to30min: m.pulse,
    },
    aiLevels: set
      ? {
          at: set.clock,
          by: set.by,
          passed: `${set.checks.passed} of ${set.checks.asked}`,
          summary: set.summary,
          targets: set.targets.map((t) => ({ n: t.n, level: t.level, limit: t.price, label: t.label, r: t.r, reachPct: t.touchPct, status: t.status, held: t.held ? { pct: t.held.pct, n: t.held.n } : null })),
          stop: set.stop ? { price: set.stop.price, label: set.stop.clamped || set.stop.anchor === "coach" ? "the coach's stop" : set.stop.label } : null,
          turn: set.reversal ? { price: set.reversal.price, label: set.reversal.label, sign: set.reversal.sign } : null,
        }
      : null,
    aiOpinion: p.ai ? { at: p.ai.clock, by: p.ai.by, action: p.ai.action, exitPrice: p.ai.exitPrice, stop: p.ai.stop, reason: p.ai.reason, watch: p.ai.watch } : null,
    levelsAhead: { above: near("above", 3), below: near("below", 3) },
    recent: (p.events || []).slice(-5).map((e) => `${e.clock} ${e.text}`),
  };
}

/**
 * @param market   the MarketService
 * @param flight   the FlightDeck
 * @param analysis the AnalysisService (the Execution Lab)
 * @param learn    the LearnWatch (the level learner), or null
 */
function makeDeskReaders({ market, flight, analysis = null, learn = null, now = () => Date.now() }) {
  return {
    async reading(symbol = null) {
      await flight.sync().catch(() => {});
      return flight
        .board()
        .positions.filter((p) => p.advice && (!symbol || p.symbol === symbol))
        .map(readingOf);
    },

    async tape(symbol) {
      const t = now();
      const [bars, qs] = await Promise.all([market.minuteBarsBetween(symbol, openOf(t), t).catch(() => []), market.quotes([symbol]).catch(() => null)]);
      const q = qs && qs.quotes ? qs.quotes[symbol] : null;
      const read = tapeRead(bars, { now: t, last: q && num(q.last) ? q.last : undefined });
      let flow = null;
      try {
        const token = typeof market._token === "function" ? market._token(symbol) : null;
        flow = token && market.flow ? market.flow.snapshot(token) : null;
      } catch (_) {
        flow = null;
      }
      return {
        symbol,
        ...read,
        quote: q
          ? { last: q.last, changePct: q.changePct, open: q.open, high: q.high, low: q.low, volume: q.volume, vwap: q.avgPrice, bid: q.bid, ask: q.ask, bidQty: q.bidQty, askQty: q.askQty, buyersQty: q.buyQty, sellersQty: q.sellQty, buyersSharePct: num(q.buyQty) && num(q.sellQty) && q.buyQty + q.sellQty > 0 ? Math.round((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null }
          : null,
        orderBook:
          flow && flow.available
            ? { pressure: flow.pressure, label: flow.label, buyersPct: Math.round((flow.buyTotal / Math.max(1, flow.buyTotal + flow.sellTotal)) * 100), lastMinuteNetBuyingPct: flow.deltaRatio60Pct, next30seconds: flow.lean ? flow.lean.dir : null, wall: flow.wall || null, spread: flow.spread }
            : { available: false, note: "The five best bids and offers are streamed for stocks with an open position; the quote's totals are above." },
      };
    },

    async levels(symbol) {
      const t = now();
      const slot = [...flight.slots.values()].find((s) => s.symbol === symbol);
      let map = slot ? flight._map(slot) : null;
      if (!map || !map.anchors.length) {
        const [bars, daily, verdict, qs, pulse] = await Promise.all([
          market.minuteBarsBetween(symbol, openOf(t), t).catch(() => []),
          typeof market.daily === "function" ? market.daily(symbol).catch(() => null) : null,
          market.verdict(symbol).catch(() => null),
          market.quotes([symbol]).catch(() => null),
          typeof market.pulse === "function" ? market.pulse(symbol).catch(() => null) : null,
        ]);
        const q = qs && qs.quotes ? qs.quotes[symbol] : null;
        const last = q && num(q.last) ? q.last : bars.length ? bars[bars.length - 1].c : null;
        if (!num(last)) return null;
        map = levelMap({ side: "long", avg: last, entryAt: t }, bars, {
          now: t,
          last,
          daily: daily && Array.isArray(daily.candles) ? daily.candles.slice(-30).map((c) => ({ t: String(c.t).slice(0, 10), o: c.o, h: c.h, l: c.l, c: c.c })) : [],
          ladder: verdict && verdict.available !== false ? (verdict.ladder || []).filter((l) => num(l.price) && l.kind !== "circuit" && l.kind !== "price").map((l) => ({ label: l.label, price: l.price })) : [],
          vwap: q && num(q.avgPrice) ? q.avgPrice : null,
          pulse: pulse && pulse.available && pulse.window ? { window: { low: pulse.window.low, high: pulse.window.high } } : null,
          learned: learn ? (sources) => learn.holdOf(symbol, sources, { at: t }) : undefined,
        });
      }
      return {
        symbol,
        last: map.last,
        minutesToSquareOff: map.minutesLeft,
        note: "Every level is a price from the desk's own data. reachPct = the odds of a touch before 3:15 PM with no trend assumed. held = how often levels of that kind held when tested (the level learner).",
        above: map.anchors.filter((a) => a.side === "above").sort((x, y) => x.price - y.price).slice(0, 7).map(levelRow),
        below: map.anchors.filter((a) => a.side === "below").sort((x, y) => y.price - x.price).slice(0, 7).map(levelRow),
      };
    },

    async lab(date = null) {
      if (!analysis) return null;
      let day = date;
      if (!day) {
        const days = analysis.labRange({}) || {};
        const list = Array.isArray(days.trend) ? days.trend.map((x) => x.date) : [];
        day = list.length ? list.slice().sort().pop() : istDate(now());
      }
      const lab = await analysis.lab(day).catch(() => null);
      if (!lab || lab.available === false) return { available: false, date: day, reason: (lab && lab.reason) || "No replay for that day." };
      const cmp = await analysis.compare(day).catch(() => null);
      return {
        available: true,
        date: day,
        summary: lab.summary,
        bestOtherExit: lab.best ? { name: lab.best.name, vsYours: lab.best.vsActual } : null,
        habits: (lab.flags || []).slice(0, 8).map((f) => ({ habit: f.name, times: f.count, net: f.net })),
        trades: (lab.trades || []).slice(0, 10).map((x) => ({ symbol: x.symbol, side: x.side, in: x.entryClock, out: x.exitClock, pnl: x.pnl, bestExit: x.read && x.read.bestExit ? { at: x.read.bestExit.clock, price: x.read.bestExit.price, pnl: x.read.bestExit.pnl } : null, gapMin: x.read && x.read.timing ? x.read.timing.gapMin : null, efficiencyPct: x.read && x.read.timing ? x.read.timing.efficiency : null, coachExit: x.read && x.read.coach && x.read.coach.exit.said ? { at: x.read.coach.exit.clock, pnl: x.read.coach.exit.pnl } : null })),
        coach: cmp && cmp.available ? { headline: cmp.headline, toPrevent: (cmp.prevent || []).slice(0, 5).map((p) => ({ habit: p.habit, kind: p.kind, evidence: p.evidence, rule: p.action })), toKeep: (cmp.keep || []).slice(0, 5).map((k) => k.text) } : null,
      };
    },

    learned(symbol = null) {
      return learn ? learn.view(symbol) : { available: false };
    },
  };
}

module.exports = { makeDeskReaders, readingOf, levelRow };
