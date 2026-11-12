"use strict";
// Backtester for the daily, long-only setups in strategies.js.
//
// Honest by construction:
//   • a signal on bar i is acted on at the OPEN of bar i+1 — never on the same
//     bar's close, which would be trading on information you did not have yet;
//   • a stop is checked against each bar's low. If a bar gaps below the stop, the
//     fill is the open (worse than the stop), not the stop price;
//   • if a bar could have hit both the stop and the exit rule, the stop wins
//     (the pessimistic assumption);
//   • every round trip pays `costPct` (brokerage, STT, stamp duty, exchange
//     charges, slippage) — default 0.3% for delivery trades;
//   • one position at a time, fully invested, no leverage.
//
// Past results on one stock say how a rule behaved, not how it will behave.

const { buildContext, triggered, WARMUP } = require("./strategies");

const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

function yearsBetween(a, b) {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (365.25 * 86400000);
}

/**
 * @param candles   daily bars, oldest first
 * @param strategy  an entry from STRATEGIES
 * @param opts      { costPct = 0.3, ctx? }
 */
function runBacktest(candles, strategy, opts = {}) {
  const costPct = Number.isFinite(opts.costPct) ? opts.costPct : 0.3;
  const ctx = opts.ctx || buildContext(candles);
  const n = candles.length;
  const start = Math.min(WARMUP, n);

  const trades = [];
  const equity = []; // { t, v } marked to market on every bar from `start`
  let cash = 1; // equity while flat (starts at 1.0)
  let pos = null; // { entryI, entry, stop, shares }
  let barsInMarket = 0;

  const close = (i, price, reason) => {
    const gross = price / pos.entry - 1;
    const net = (1 + gross) * (1 - costPct / 100) - 1;
    cash = pos.cashAtEntry * (1 + net);
    trades.push({
      entryDate: candles[pos.entryI].t,
      entry: round(pos.entry),
      stop: round(pos.stop),
      exitDate: candles[i].t,
      exit: round(price),
      reason,
      bars: i - pos.entryI + 1,
      returnPct: round(net * 100),
      r: pos.entry > pos.stop ? round((price - pos.entry) / (pos.entry - pos.stop)) : null,
    });
    pos = null;
  };

  let pendingEntry = null; // { stop } — decided on the previous bar's close
  let pendingExit = null; // reason — decided on the previous bar's close

  for (let i = start; i < n; i += 1) {
    const bar = candles[i];

    // 1. yesterday's decisions are executed at today's open
    if (pos && pendingExit) {
      close(i, bar.o, pendingExit);
    } else if (!pos && pendingEntry && bar.o > pendingEntry.stop) {
      // (if the open has already gapped to or below the stop, the trade is skipped)
      pos = { entryI: i, entry: bar.o, stop: pendingEntry.stop, cashAtEntry: cash };
    }
    pendingEntry = null;
    pendingExit = null;

    if (pos) barsInMarket += 1;

    // 2. the stop, against the bar's low. A gap through the stop fills at the open.
    if (pos && bar.l <= pos.stop) close(i, Math.min(bar.o, pos.stop), "Stop-loss hit");

    // 3. the strategy's own exit rule, or its time stop, judged on the close
    if (pos) {
      const held = i - pos.entryI + 1;
      const why = strategy.exit(ctx, i, pos) || (strategy.maxHold && held >= strategy.maxHold ? `Time stop (${strategy.maxHold} bars)` : null);
      if (why) {
        if (i + 1 < n) pendingExit = why;
        else close(i, bar.c, `${why} (last bar, closed at the close)`);
      }
    }

    // 4. mark to market
    equity.push({ t: bar.t, v: pos ? pos.cashAtEntry * (bar.c / pos.entry) : cash });

    // 5. a new signal on this close becomes an order for the next open
    if (!pos && i + 1 < n && triggered(strategy, ctx, i)) {
      const stop = strategy.stop(ctx, i);
      if (Number.isFinite(stop) && stop > 0) pendingEntry = { stop };
    }
  }

  // an open position at the end is reported, not silently closed
  let open = null;
  if (pos) {
    const last = candles[n - 1];
    open = {
      entryDate: candles[pos.entryI].t,
      entry: round(pos.entry),
      stop: round(pos.stop),
      lastClose: round(last.c),
      unrealisedPct: round((last.c / pos.entry - 1) * 100),
    };
  }

  return { strategy: strategy.id, costPct, trades, open, equity, stats: summarise(candles, start, trades, equity, barsInMarket) };
}

function summarise(candles, start, trades, equity, barsInMarket) {
  const n = candles.length;
  const tested = n - start;
  if (tested <= 0) return { enoughData: false, trades: 0 };

  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const grossWin = sum(wins.map((t) => t.returnPct));
  const grossLoss = Math.abs(sum(losses.map((t) => t.returnPct)));

  const first = equity[0];
  const last = equity[equity.length - 1];
  const yrs = Math.max(yearsBetween(first.t, last.t), 1 / 365.25);
  const total = last.v / 1 - 1;

  // max drawdown of the marked-to-market equity curve
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of equity) {
    if (p.v > peak) peak = p.v;
    const dd = peak > 0 ? (peak - p.v) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  // buy & hold over the same window, paying the same cost once
  const bhStart = candles[start].o;
  const bh = candles[n - 1].c / bhStart - 1;
  let bhPeak = -Infinity;
  let bhDd = 0;
  for (let i = start; i < n; i += 1) {
    if (candles[i].c > bhPeak) bhPeak = candles[i].c;
    const dd = (bhPeak - candles[i].c) / bhPeak;
    if (dd > bhDd) bhDd = dd;
  }

  let streak = 0;
  let worstStreak = 0;
  for (const t of trades) {
    streak = t.returnPct <= 0 ? streak + 1 : 0;
    if (streak > worstStreak) worstStreak = streak;
  }

  return {
    enoughData: true,
    from: first.t,
    to: last.t,
    years: round(yrs, 1),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? round((wins.length / trades.length) * 100, 1) : null,
    avgWinPct: wins.length ? round(grossWin / wins.length) : null,
    avgLossPct: losses.length ? round(-grossLoss / losses.length) : null,
    payoffRatio: wins.length && losses.length && grossLoss > 0 ? round(grossWin / wins.length / (grossLoss / losses.length)) : null,
    expectancyPct: trades.length ? round(sum(trades.map((t) => t.returnPct)) / trades.length) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    avgBars: trades.length ? round(sum(trades.map((t) => t.bars)) / trades.length, 1) : null,
    worstLosingStreak: worstStreak,
    totalReturnPct: round(total * 100),
    cagrPct: round(((1 + total) ** (1 / yrs) - 1) * 100),
    maxDrawdownPct: round(maxDd * 100),
    exposurePct: round((barsInMarket / tested) * 100, 1),
    buyHoldReturnPct: round(bh * 100),
    buyHoldCagrPct: round(((1 + bh) ** (1 / yrs) - 1) * 100),
    buyHoldMaxDrawdownPct: round(bhDd * 100),
    // fewer than ~20 trades is too few to tell skill from luck
    reliability: trades.length >= 30 ? "reasonable" : trades.length >= 15 ? "thin" : "too few trades to trust",
  };
}

module.exports = { runBacktest };
