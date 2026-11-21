"use strict";
// The research dossier: everything the desk knows about one stock right now, in one read — for TradeAI's deep research
// and for anyone who asks GET /api/admin/market/dossier/:symbol.
//
//   PRICE & FLOW   the quote (open, high, low, VWAP, volume, the buy and sell quantities waiting, the circuits); the order
//                  book price by price on NSE and BSE (five bids and five offers, with their quantities and orders)
//   FORECASTS      the consensus forecast for 5 and 15 minutes (server/consensus.js) — price, band, chance of a rise, the
//                  level likely to be touched first, which engine leads and its record; the 15-minute forecaster's own path
//                  to 30 minutes with its measured accuracy; the evidence desk's calls with the techniques speaking and
//                  their records; the early calls (reversal, carry-on, momentum)
//   THE SESSION    the live intraday call and the multi-timeframe verdict with their plans; the intraday indicators
//   THE DAYS       daily indicators (RSI, MACD, ADX, Supertrend, Bollinger, ATR, relative volume), patterns, set-ups,
//                  moving averages, 52-week range, supports and resistances, returns; the stock's habits; delivery
//                  (server/market/delivery.js) — the last sessions' delivered share and what it says
//   AROUND IT      futures open interest, the option chain, NIFTY and SENSEX, the sector, India VIX, GIFT NIFTY, Wall
//                  Street and Asia (as the evidence desk reads them live), the market's tide, the news and social feed
//
// Every part is read with a deadline and may be missing (said so, never guessed). Only the desk's arithmetic and stored
// readings are used: no AI model is asked, nothing is spent, no order can be placed.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);

async function within(p, ms) {
  let t;
  try {
    return await Promise.race([Promise.resolve().then(() => p), new Promise((r) => (t = setTimeout(() => r({ __timeout: true }), ms)))]);
  } catch (err) {
    return { __error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}
const ok = (x) => x && !x.__timeout && !x.__error;
const why = (x, what) => (x && x.__timeout ? `${what} took too long` : x && x.__error ? `${what}: ${x.__error}` : x && x.reason ? x.reason : `${what} is not available`);

/** The order book ladder, trimmed to what a reader needs. */
function ladder(b) {
  if (!b) return null;
  const side = (rows) => (Array.isArray(rows) ? rows.slice(0, 5).map((r) => ({ price: r.price, qty: r.qty ?? r.quantity, orders: r.orders })) : null);
  // the evidence desk's ladder (server/evidence.js `_ladder`): five bids and asks, the quantity at the best five, all pending
  // buy and sell orders, the spread, the imbalance and any wall
  return { bids: side(b.bids || b.buy), offers: side(b.asks || b.offers || b.sell), bestFiveBuyQty: b.bidQty ?? null, bestFiveSellQty: b.askQty ?? null, pendingBuy: b.buyTotal ?? b.buyQty ?? null, pendingSell: b.sellTotal ?? b.sellQty ?? null, spreadPct: b.spreadPct ?? null, imbalance: b.imbalance ?? null, wall: b.wall || null };
}

/**
 * @param symbol  an NSE symbol
 * @param deps    { market, horizon, evidence, ahead, consensus, delivery, ensemble, social, now }
 */
async function dossier(symbol, deps) {
  const { market, horizon, evidence, ahead, consensus, delivery, ensemble, now = () => Date.now() } = deps;
  const out = { symbol, asOf: new Date(now()).toISOString(), missing: [] };
  const miss = (what, x) => out.missing.push(why(x, what));
  const [q, cons, hv, ev, av, verdict, analysis, ctx] = await Promise.all([
    within(market.quotes([symbol]).then((r) => (r && r.quotes && r.quotes[symbol]) || null), 5000),
    consensus ? within(consensus.view(symbol), 12000) : null,
    horizon ? within(horizon.view(symbol), 10000) : null,
    evidence ? within(evidence.view(symbol, { full: true }), 14000) : null,
    ahead ? within(ahead.view(symbol), 10000) : null,
    market.verdict ? within(market.verdict(symbol), 10000) : null,
    market.analysis ? within(market.analysis(symbol, { chartBars: 120 }), 12000) : null,
    market.context ? within(market.context(), 8000) : null,
  ]);

  if (ok(q) && q) out.quote = { last: q.last, prevClose: q.prevClose, changePct: q.changePct, open: q.open, high: q.high, low: q.low, vwap: q.avgPrice, volume: q.volume, buyQty: q.buyQty, sellQty: q.sellQty, buyShare: num(q.buyQty) && num(q.sellQty) && q.buyQty + q.sellQty > 0 ? r2((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null, upperCircuit: q.upperCircuit, lowerCircuit: q.lowerCircuit };
  else miss("the live quote", q);

  if (ok(cons) && cons && cons.available) out.consensus = { headline: cons.headline, horizons: cons.horizons.map((x) => ({ key: x.key, minutesAhead: x.minutesAhead, at: x.at, price: x.price, low: x.low, high: x.high, pct: x.pct, pUp: x.pUp, lean: x.lean, tier: x.tier, leads: x.leads, forecaster: x.forecaster, blend: x.blend, evidence: x.parts.evidence, early: x.parts.early, record: x.record })), firstUp: cons.firstUp, firstDown: cons.firstDown, rule: cons.rule };
  else miss("the consensus forecast", cons);

  if (ok(hv) && hv && hv.available) out.forecaster = { headline: hv.headline, headline5: hv.headline5, path: (hv.horizons || []).map((x) => ({ minutes: x.minutes, price: x.price, low: x.low, high: x.high, pUp: x.pUp })), reach: hv.reach, why: (hv.why || []).slice(0, 6), live: hv.live, ownRecord: hv.own, stock: hv.stock, flow: hv.flow };
  else miss("the 15-minute forecaster", hv);

  if (ok(ev) && ev && ev.available) {
    out.evidence = {
      calls: ev.calls,
      first: ev.first,
      regime: ev.regime,
      count: ev.count,
      techniques: (ev.witnesses || []).filter((w) => w.state).slice(0, 14).map((w) => ({ name: w.name || w.id, says: w.state > 0 ? "up" : "down", record15: w.record && w.record[15] ? { verdict: w.record[15].verdict, right: w.record[15].right ?? w.record[15].acc ?? null, n: w.record[15].n ?? null } : null })),
      live: (ev.live || []).slice(0, 16).map((r) => ({ name: r.name || r.id, value: r.value ?? r.text ?? null, says: r.state > 0 ? "up" : r.state < 0 ? "down" : "neutral", proven: r.record && r.record[15] ? r.record[15].verdict : null })),
      bookNse: ladder(ev.book && ev.book.nse),
      bookBse: ev.book && ev.book.bse ? { ...ladder(ev.book.bse), last: ev.book.bse.last, changePct: ev.book.bse.changePct, volume: ev.book.bse.volume } : null,
      volume: ev.volume,
      indicators: ev.indicators,
      levels: ev.levels,
      sources: ev.sources,
    };
  } else miss("the evidence desk (order book, open interest, options, indices, world)", ev);

  if (ok(av) && av && av.available) out.earlyCalls = { move: av.move, horizons: (av.horizons || []).map((x) => ({ key: x.key, minutesAhead: x.minutesAhead, read: x.read, tone: x.tone, reversal: x.reversal, follow: x.follow, momentum: x.momentum && x.momentum.state })) };
  else miss("the early calls", av);

  if (ok(verdict) && verdict && verdict.available !== false) {
    const day = verdict.day || {};
    const mv = day.movement || {};
    out.session = {
      liveCall: day.available ? { state: day.state, headline: day.headline, score: day.score, plan: day.plan, triggers: day.triggers, vwap: mv.vwap, vsVwapPct: mv.vsVwapPct, rsi5: mv.rsi5, last15Pct: mv.m15Pct, last30Pct: mv.m30Pct, rangeUsedPct: mv.rangeUsedPct, volumePace: mv.volumePace } : null,
      verdict: { stance: verdict.stance, conviction: verdict.conviction, summary: verdict.summary, frames: (verdict.frames || []).map((f) => ({ frame: f.frame || f.name, trend: f.label || f.trend })), intraday: verdict.intraday && { preferred: verdict.intraday.preferred, long: verdict.intraday.long && { entry: verdict.intraday.long.entry, stop: verdict.intraday.long.stop, targets: verdict.intraday.long.targets }, short: verdict.intraday.short && { entry: verdict.intraday.short.entry, stop: verdict.intraday.short.stop, targets: verdict.intraday.short.targets } }, circuit: verdict.circuit, warnings: verdict.warnings },
    };
  } else miss("the live intraday call", verdict);

  if (ok(analysis) && analysis && analysis.enoughData !== false) {
    const ind = analysis.indicators || {};
    out.daily = { score: analysis.score && { value: analysis.score.value, label: analysis.score.label }, rsi14: ind.rsi14, macdHist: ind.macdHist, adx: ind.adx, plusDI: ind.plusDI, minusDI: ind.minusDI, stochK: ind.stochK, bbPctB: ind.bbPctB, supertrendDir: ind.supertrendDir, relVolume: ind.relVolume, atrPct: ind.atrPct, patterns: (analysis.patterns || []).map((x) => `${x.name} (${x.bias})`).slice(0, 6), setupsOn: (analysis.setups || []).filter((x) => x.triggered).map((x) => x.name), week52: analysis.levels && analysis.levels.week52, movingAverages: analysis.levels && analysis.levels.movingAverages, supports: analysis.levels && (analysis.levels.supports || []).slice(0, 3), resistances: analysis.levels && (analysis.levels.resistances || []).slice(0, 3), returns: analysis.returns, relative: analysis.relative };
  } else miss("the daily indicators", analysis);

  if (delivery) {
    const d = delivery.forSymbol(symbol, { days: 10 });
    if (d && d.available) out.delivery = d;
    else miss("delivery", d);
  }

  if (ok(ctx) && ctx && ctx.available) out.market = { tide: ctx.tide && { score: ctx.tide.score, label: ctx.tide.label, summary: ctx.tide.summary }, vix: ctx.vix, sectors: (ctx.sectors || []).map((s) => ({ name: s.name, changePct: s.changePct })).slice(0, 12) };
  else miss("the market's tide", ctx);

  try {
    const b = market.behaviourList ? market.behaviourList() : null;
    const prof = b && (b.profiles || b)[symbol];
    if (prof && prof.habits) out.habits = prof.habits.slice(0, 6);
  } catch (_) {
    /* no habits */
  }
  try {
    const soc = market.social;
    if (soc && typeof soc.forSymbol === "function") {
      const s = soc.forSymbol(symbol);
      if (s) out.news = s;
    }
  } catch (_) {
    /* no feed */
  }
  if (ensemble && typeof ensemble.forecast === "function") {
    const f = await within(ensemble.forecast(), 8000);
    if (ok(f) && f) out.world = { lean: f.lean, headline: f.headline || f.summary, gift: f.gift || f.giftNifty || null, drivers: (f.drivers || f.factors || []).slice(0, 8) };
  }
  out.note = "Every number is the desk's own reading at the time shown; a part that could not be read is listed under `missing`, never guessed. Forecasts carry their measured records — evidence, not a promise.";
  return out;
}

module.exports = { dossier, ladder };
