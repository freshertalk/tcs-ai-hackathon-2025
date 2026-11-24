"use strict";
// One trading day, read back to you: what you made, what you lost, what the government and the
// broker took, how many trades, what margin was left — and, from the trades themselves, what you
// did well and what you did badly, each with its figures. Pure arithmetic on the day's closed round
// trips (server/trading/journal.js) and a few readings; no AI, no network, no clock, no order.
//
// Definitions, used everywhere on the Trade Analysis pages:
//   Profit   the sum of the round trips that closed above zero, before charges
//   Loss     the sum of the round trips that closed below zero, before charges (shown as a positive number)
//   Charges  brokerage, STT, exchange fees, SEBI fee, GST, stamp duty and DP charge — an ESTIMATE from
//            Zerodha's published equity rates (the contract note is the truth)
//   Net      Profit − Loss − Charges
//   A trade counts on the day it was CLOSED. A win is a trade that closed above zero before charges.
//
// The practices are rules of thumb about process, taken from the desk's own trading-skills file
// (no entries in the first 15 minutes or after 2:45 PM, stop after two losing trades, size by the
// stop, cut losers, let winners run). They describe the day; they do not predict the next one, and
// a day can be profitable with bad process or a loss with good process.

const IST = 5.5 * 3600 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PARTS = ["brokerage", "stt", "exchange", "sebi", "gst", "stamp", "dp", "other"]; // "other": a few paise of IPFT and the like, so the heads always add up to the charges
const PART_LABEL = { brokerage: "Brokerage", stt: "STT / CTT", exchange: "Exchange transaction charges", sebi: "SEBI turnover fee", gst: "GST", stamp: "Stamp duty", dp: "DP charges", other: "Other (IPFT, corrections)" };

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sum = (a, f) => a.reduce((s, t) => s + f(t), 0);
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const rs = (x) => `${x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
const median = (xs) => {
  const a = xs.filter(num).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const emptyParts = () => Object.fromEntries(PARTS.map((k) => [k, 0]));

/** Charges as a total and by kind; "statutory" is STT + GST + stamp duty + SEBI fee. */
function chargeSet(parts) {
  const p = { ...emptyParts(), ...parts };
  const out = Object.fromEntries(PARTS.map((k) => [k, r2(p[k])]));
  out.total = r2(sum(PARTS, (k) => p[k]));
  out.statutory = r2(p.stt + p.gst + p.stamp + p.sebi);
  out.brokerAndOther = r2(p.brokerage + p.dp);
  return out;
}

/* ------------------------------------------------------------------------------ the practices */

/**
 * @param closed   the day's closed round trips, oldest exit first (each with entryAt, exitAt, pnl, net, qty, symbol)
 * @param ctx      { avgTrades (usual per day, or null), avgLossDay (usual losing day, or null), openPositions }
 * @returns { good: [...], bad: [...] }  each { id, title, detail, impact? }
 */
function practices(closed, sm, ctx) {
  const good = [];
  const bad = [];
  const n = closed.length;
  if (!n) return { good, bad };
  const G = (id, title, detail) => good.push({ id, title, detail });
  const B = (id, title, detail, advice, impact = null) => bad.push({ id, title, detail, advice, impact: r2(impact) });

  /* how many trades */
  if (ctx.avgTrades && n >= 6 && n > 1.5 * ctx.avgTrades) B("overtrading", "Overtrading", `${n} trades today against your usual ${r1(ctx.avgTrades)} a day (${Math.round((n / ctx.avgTrades) * 100)}%). More trades means more charges and more chances to be wrong.`, `Set a ceiling of about ${Math.max(3, Math.round(ctx.avgTrades * 1.2))} trades a day and stop when you reach it.`);
  else if (!ctx.avgTrades && n > 12) B("overtrading", "Overtrading", `${n} trades in one day. Costs add up with every round trip.`, "Set a daily ceiling on trades and stop when you reach it.");
  else if (ctx.avgTrades && n <= ctx.avgTrades * 1.1) G("trade-count", "Trade count in line", `${n} trades against your usual ${r1(ctx.avgTrades)}: no overtrading.`);

  /* winners against losers */
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  if (wins.length && losses.length) {
    const aw = sm.avgWin;
    const al = sm.avgLoss;
    if (aw >= 1.5 * al) G("payoff", "Winners bigger than losers", `Average win ${rs(aw)} against average loss ${rs(al)} (${r1(aw / al)}×): losses were kept small.`);
    else if (aw < al && sm.winRatePct < 65) B("payoff", "Winners smaller than losers", `Average win ${rs(aw)} against average loss ${rs(al)} (${r1(aw / al)}×) with only ${sm.winRatePct}% of trades winning: that cannot add up over time.`, "Hold the stop where it is and let the first target be at least as far as the stop.");
  }
  if (losses.length && wins.length) {
    const worst = losses.reduce((a, t) => (t.pnl < a.pnl ? t : a), losses[0]);
    if (Math.abs(worst.pnl) > 2.5 * sm.avgWin) B("big-loss", "One loss outweighed the winners", `${worst.symbol} lost ${rs(Math.abs(worst.pnl))} — ${r1(Math.abs(worst.pnl) / sm.avgWin)}× the average win. That single trade is ${Math.round((Math.abs(worst.pnl) / sm.grossLoss) * 100)}% of the day's losses.`, "Decide the exit before the entry and never widen a stop: a planned loss is small, an unplanned one is not.", worst.pnl);
  }

  /* holding time */
  const hold = (a) => (a.length ? sum(a, (t) => t.holdMin || 0) / a.length : null);
  const hw = hold(wins);
  const hl = hold(losses);
  if (hw !== null && hl !== null) {
    if (hl > 1.5 * hw && hl - hw >= 5) B("hold-losers", "Held losers longer than winners", `Losers were held ${Math.round(hl)} minutes on average, winners ${Math.round(hw)}. Hoping for a recovery is how small losses become large ones.`, "If a trade is not working within the time you gave it, exit; do not add time to a loser.");
    else if (hw > 1.5 * hl && hw - hl >= 5) G("hold-winners", "Let winners run, cut losers", `Winners were held ${Math.round(hw)} minutes, losers ${Math.round(hl)}.`);
  }

  /* when the entries were */
  const early = closed.filter((t) => clock(t.entryAt) < "09:30");
  const late = closed.filter((t) => clock(t.entryAt) >= "14:45");
  const off = [...early, ...late];
  if (off.length) {
    // a breach of the rule is a breach even when it happened to pay: that is luck, and it does not repeat
    const net = sum(off, (t) => t.net);
    B("window", "Entries outside the 9:30 AM – 2:45 PM window", `${off.length} trade${off.length === 1 ? "" : "s"} began ${early.length ? `in the first 15 minutes (${early.length})` : ""}${early.length && late.length ? " or " : ""}${late.length ? `after 2:45 PM (${late.length})` : ""} and netted ${signed(net)}${net >= 0 ? " — it happened to pay, which is luck, not a method" : ""}.`, "No entries before 9:30 or after 2:45 PM: the opening is noise and the close is a rush to square off.", net < 0 ? net : 0);
  } else if (n >= 3) G("window", "Every entry inside the window", "All entries came between 9:30 AM and 2:45 PM.");

  /* revenge: back in within ten minutes of a loss, on the same stock or with a bigger size */
  const byEntry = [...closed].sort((a, b) => a.entryAt - b.entryAt);
  const revenge = [];
  for (const t of byEntry) {
    const prev = closed.filter((p) => p !== t && p.exitAt <= t.entryAt && p.pnl < 0).sort((a, b) => b.exitAt - a.exitAt)[0];
    if (prev && t.entryAt - prev.exitAt <= 10 * 60000 && (t.symbol === prev.symbol || t.qty >= 1.5 * prev.qty)) revenge.push(t);
  }
  if (revenge.length) {
    const net = sum(revenge, (t) => t.net);
    B("revenge", "Revenge trades", `${revenge.length} trade${revenge.length === 1 ? "" : "s"} taken within 10 minutes of a loss, on the same stock or a bigger size, netted ${signed(net)}.`, "After a loss, step away for at least 15 minutes. The next trade must meet the same rules as the first.", net);
  } else if (losses.length) G("no-revenge", "No revenge trading", "No trade was rushed in within 10 minutes of a loss.");

  /* the rule: after two losing trades in a row, stop for the day */
  let run = 0;
  let stopAt = null;
  for (const t of closed) {
    run = t.pnl < 0 ? run + 1 : 0;
    if (run >= 2) {
      stopAt = t.exitAt;
      break;
    }
  }
  if (stopAt !== null) {
    const after = closed.filter((t) => t.entryAt >= stopAt);
    if (after.length) B("stop-rule", "Kept trading after two losses in a row", `${after.length} more trade${after.length === 1 ? "" : "s"} after the second straight loss (at ${clock(stopAt)}), netting ${signed(sum(after, (t) => t.net))}. Your own rule is to stop for the day.`, "Two losing trades in a row: stop. Tilt costs more than any missed move.", sum(after, (t) => t.net));
    else G("stop-rule", "Stopped after two losses in a row", `You stopped at ${clock(stopAt)}, after the second straight loss.`);
  }

  /* size */
  if (n >= 4) {
    const med = median(closed.map((t) => t.qty));
    const big = closed.reduce((a, t) => (t.qty > a.qty ? t : a), closed[0]);
    if (med > 0 && big.qty >= 3 * med) B("oversized", "Oversized position", `${big.symbol} was ${big.qty} shares against a typical ${Math.round(med)} (${r1(big.qty / med)}×) and made ${signed(big.net)}.`, "Size every trade from its stop distance and your risk per trade, never from how sure you feel.", big.net < 0 ? big.net : 0);
    else G("sizing", "Position sizes were steady", `Sizes stayed within ${r1(big.qty / (med || 1))}× of the typical ${Math.round(med)} shares.`);
  }

  /* what it cost */
  if (sm.gross > 0 && sm.net < 0) B("costs", "Charges turned a profit into a loss", `Before charges the day made ${rs(sm.gross)}; charges of ${rs(sm.charges.total)} left ${signed(sm.net)}. Brokerage, STT and GST are paid win or lose.`, "Fewer, better trades: a trade must have a target large enough to pay for its own charges.", sm.net);
  else if (sm.gross > 0 && sm.charges.total / sm.gross > 0.25) B("costs", "Charges took a large share of the profit", `Charges of ${rs(sm.charges.total)} were ${Math.round((sm.charges.total / sm.gross) * 100)}% of the day's gross profit.`, "Cut the trades that only make a few rupees: they cost almost as much as they earn.", -sm.charges.total);
  else if (sm.grossProfit > 0 && sm.charges.total / sm.grossProfit < 0.1) G("costs", "Costs stayed light", `Charges were ${Math.round((sm.charges.total / sm.grossProfit) * 100)}% of the profit made.`);

  /* where the trades piled up */
  const bySym = new Map();
  for (const t of closed) {
    const g = bySym.get(t.symbol) || { symbol: t.symbol, trades: 0, net: 0 };
    g.trades += 1;
    g.net += t.net;
    bySym.set(t.symbol, g);
  }
  const top = [...bySym.values()].sort((a, b) => b.trades - a.trades)[0];
  if (n >= 5 && top.trades / n >= 0.6 && top.net < 0) B("concentration", "Piled into one stock", `${top.symbol} was ${top.trades} of ${n} trades (${Math.round((top.trades / n) * 100)}%) and netted ${signed(top.net)}.`, "If a stock has beaten you twice in a day, leave it alone until tomorrow.", top.net);
  else if (bySym.size >= 3 && n >= 5) G("spread", "Spread across stocks", `${n} trades across ${bySym.size} stocks.`);

  /* win rate */
  if (n >= 5 && sm.winRatePct >= 55) G("win-rate", "A good hit rate", `${sm.wins} of ${n} trades won (${sm.winRatePct}%).`);
  else if (n >= 5 && sm.winRatePct <= 35) B("win-rate", "A low hit rate", `Only ${sm.wins} of ${n} trades won (${sm.winRatePct}%).`, "Trade only the setups that line up with the trend, VWAP and volume; skip the rest.");

  /* a day far worse than your usual bad day */
  if (ctx.avgLossDay && sm.net < 0 && Math.abs(sm.net) > 2 * ctx.avgLossDay) B("heavy-day", "A heavier loss than your usual losing day", `${rs(Math.abs(sm.net))} lost against a usual losing day of ${rs(ctx.avgLossDay)} (${r1(Math.abs(sm.net) / ctx.avgLossDay)}×).`, "Set a daily loss limit (the risk guard has one) and let it end the day.", sm.net);

  /* positions left open at the close */
  if (ctx.openPositions && ctx.openPositions.length) {
    const mis = ctx.openPositions.filter((p) => p.product === "MIS");
    if (mis.length) B("left-open", "Intraday position still open", `${mis.map((p) => `${p.symbol} (${p.quantity})`).join(", ")} still open after the close. Zerodha squares intraday positions off automatically and charges for it.`, "Be flat before 3:15 PM yourself.");
  } else if (ctx.openPositions && n) G("flat", "Flat at the close", "No intraday position was left open.");

  return { good, bad };
}

/** Process score, 0–100, from the practices: a reminder, not a grade of the result. */
const scoreOf = (p, n) => (n ? clamp(60 + 8 * Math.min(p.good.length, 5) - 12 * p.bad.length, 0, 100) : null);

/* ------------------------------------------------------------------------------- the day */

/**
 * @param date      "YYYY-MM-DD"
 * @param trips     the day's CLOSED round trips: { key, symbol, side, qty, entryAt, exitAt, entryAvg, exitAvg, pnl, charges, parts, net, holdMin, product, intraday }
 * @param funds     the equity margin segment, or null
 * @param market    { niftyChangePct } or null
 * @param history   earlier days' summaries, for the usual figures
 * @param openPositions  [{ symbol, quantity, product }] at the time of capture, or null when not known
 * Every figure comes from the trades (Zerodha's fills in the journal) and the broker's readings;
 * nothing is entered by hand.
 */
function buildDay({ date, trips, funds = null, market = null, history = [], openPositions = null }) {
  const closed = [...trips].sort((a, b) => a.exitAt - b.exitAt);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const parts = emptyParts();
  for (const t of closed) for (const k of PARTS) parts[k] += (t.parts && t.parts[k]) || 0;
  const nTrades = closed.length;
  const nWins = wins.length;
  const nLosses = losses.length;
  const grossProfit = sum(wins, (t) => t.pnl);
  const grossLoss = -sum(losses, (t) => t.pnl);
  const ch = chargeSet(parts);
  const gross = grossProfit - grossLoss;
  // Other credits & debits of the day (Console's ledger lines that are not trades) are part of the day's net, as in Console's P&L
  const other = r2(sum(closed, (t) => t.other || 0));
  const net = gross - ch.total + other;
  const seg = funds && funds.available ? funds : null;
  const opening = seg ? seg.available.opening : null;
  const availableMargin = seg ? (num(seg.available.live) ? seg.available.live : seg.available.cash) : null;
  const margin = availableMargin === null && !seg ? null : { available: r2(availableMargin), opening: r2(opening), used: seg && seg.used ? r2(seg.used.debits) : null, net: seg ? r2(seg.net) : null, source: seg ? "kite" : null };
  const base = margin && num(margin.opening) && margin.opening > 0 ? margin.opening : margin && num(margin.available) && margin.available > 0 ? margin.available + Math.max(0, -net) : null;
  const avgWin = nWins ? grossProfit / nWins : 0;
  const avgLoss = nLosses ? grossLoss / nLosses : 0;

  const sm = {
    trades: nTrades,
    wins: nWins,
    losses: nLosses,
    flat: Math.max(0, nTrades - nWins - nLosses),
    winRatePct: nTrades ? r1((nWins / nTrades) * 100) : 0,
    grossProfit: r2(grossProfit),
    grossLoss: r2(grossLoss),
    gross: r2(gross),
    charges: ch,
    other,
    net: r2(net),
    netPctOfMargin: base ? r2((net / base) * 100) : null,
    chargesPctOfGross: gross > 0 ? r1((ch.total / gross) * 100) : null,
    chargesPctOfProfit: grossProfit > 0 ? r1((ch.total / grossProfit) * 100) : null,
    avgWin: r2(avgWin),
    avgLoss: r2(avgLoss),
    payoff: avgLoss > 0 && avgWin > 0 ? r2(avgWin / avgLoss) : null,
    profitFactor: grossLoss > 0 ? r2(grossProfit / grossLoss) : null,
    bestTrade: closed.length ? r2(Math.max(...closed.map((t) => t.pnl))) : null,
    worstTrade: closed.length ? r2(Math.min(...closed.map((t) => t.pnl))) : null,
    avgHoldMin: closed.length ? Math.round(sum(closed, (t) => t.holdMin || 0) / closed.length) : null,
    turnover: r2(sum(closed, (t) => (t.turnoverBuy || 0) + (t.turnoverSell || 0))),
    long: closed.filter((t) => t.side === "long").length,
    short: closed.filter((t) => t.side === "short").length,
    intraday: closed.filter((t) => t.intraday).length,
    openPositions: openPositions ? openPositions.length : null,
  };

  const past = history.filter((h) => h.date < date && h.summary && h.summary.trades > 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);
  const ctx = {
    avgTrades: past.length >= 5 ? sum(past, (h) => h.summary.trades) / past.length : null,
    avgLossDay: (() => {
      const l = past.filter((h) => h.summary.net < 0);
      return l.length >= 3 ? sum(l, (h) => -h.summary.net) / l.length : null;
    })(),
    openPositions,
  };
  const pr = practices(closed, sm, ctx);

  /* by hour and by stock */
  const hours = new Map();
  const syms = new Map();
  for (const t of closed) {
    const h = clock(t.entryAt).slice(0, 2);
    const a = hours.get(h) || { hour: h, trades: 0, wins: 0, net: 0 };
    a.trades += 1;
    if (t.pnl > 0) a.wins += 1;
    a.net += t.net;
    hours.set(h, a);
    const s = syms.get(t.symbol) || { symbol: t.symbol, trades: 0, wins: 0, net: 0 };
    s.trades += 1;
    if (t.pnl > 0) s.wins += 1;
    s.net += t.net;
    syms.set(t.symbol, s);
  }
  const hoursOut = [...hours.values()].sort((a, b) => (a.hour < b.hour ? -1 : 1)).map((h) => ({ ...h, net: r2(h.net) }));
  const symsOut = [...syms.values()].sort((a, b) => b.net - a.net).map((s) => ({ ...s, net: r2(s.net) }));

  /* why: the day in plain sentences, from the numbers */
  const why = [];
  if (nTrades) {
    why.push(`${net >= 0 ? "Net profit" : "Net loss"} of ${rs(Math.abs(net))}: winners made ${rs(grossProfit)}, losers lost ${rs(grossLoss)}, and charges and taxes took ${rs(ch.total)}${ch.total && gross > 0 ? ` (${Math.round((ch.total / gross) * 100)}% of the gross profit)` : ""}.`);
    why.push(`${nWins} of ${nTrades} trades won (${sm.winRatePct}%)${sm.payoff !== null ? `; the average win (${rs(avgWin)}) was ${sm.payoff}× the average loss (${rs(avgLoss)})` : ""}.`);
    const worst = losses.length ? losses.reduce((a, t) => (t.pnl < a.pnl ? t : a), losses[0]) : null;
    const best = wins.length ? wins.reduce((a, t) => (t.pnl > a.pnl ? t : a), wins[0]) : null;
    if (worst && grossLoss > 0) why.push(`The biggest drag was ${worst.symbol} (${signed(worst.pnl)}, ${Math.round((Math.abs(worst.pnl) / grossLoss) * 100)}% of all losses).`);
    if (best && grossProfit > 0) why.push(`The best trade was ${best.symbol} (${signed(best.pnl)}, ${Math.round((best.pnl / grossProfit) * 100)}% of all profit).`);
    if (hoursOut.length >= 2) {
      const bh = hoursOut.reduce((a, h) => (h.net > a.net ? h : a), hoursOut[0]);
      const wh = hoursOut.reduce((a, h) => (h.net < a.net ? h : a), hoursOut[0]);
      if (bh.hour !== wh.hour) why.push(`By hour of entry: best ${bh.hour}:00 (${signed(bh.net)} over ${bh.trades} trade${bh.trades === 1 ? "" : "s"}), worst ${wh.hour}:00 (${signed(wh.net)} over ${wh.trades}).`);
    }
    const longNet = sum(closed.filter((t) => t.side === "long"), (t) => t.net);
    const shortNet = sum(closed.filter((t) => t.side === "short"), (t) => t.net);
    if (sm.long && sm.short) why.push(`Longs: ${sm.long} trades, ${signed(longNet)}. Shorts: ${sm.short} trades, ${signed(shortNet)}.`);
    if (market && num(market.niftyChangePct)) why.push(`The Nifty ${market.niftyChangePct >= 0 ? "rose" : "fell"} ${Math.abs(market.niftyChangePct).toFixed(2)}% that day${sm.long > sm.short && market.niftyChangePct < -0.4 ? ": mostly long trades against a falling market" : sm.short > sm.long && market.niftyChangePct > 0.4 ? ": mostly short trades against a rising market" : ""}.`);
  } else why.push("No closed trades were found for this day.");

  /* advice: what the bad practices say to do, then what to keep doing */
  const advice = pr.bad.map((b) => b.advice).filter(Boolean);
  if (!pr.bad.length && nTrades) advice.push(net >= 0 ? "The process was sound today. Repeat it, with the same size and the same stops." : "A loss with sound process happens. Keep the size and the stops exactly as they are; do not 'fix' what was not broken.");
  if (pr.good.length && pr.bad.length) advice.push(`Keep doing: ${pr.good.slice(0, 2).map((g) => g.title.toLowerCase()).join("; ")}.`);

  return {
    date,
    weekday: WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()],
    summary: sm,
    margin,
    market: market && num(market.niftyChangePct) ? { niftyChangePct: r2(market.niftyChangePct) } : null,
    trades: closed.map((t) => ({ key: t.key, symbol: t.symbol, side: t.side, qty: t.qty, entryAt: clock(t.entryAt), exitAt: clock(t.exitAt), entryAvg: t.entryAvg, exitAvg: t.exitAvg, pnl: t.pnl, charges: t.charges, net: t.net, holdMin: t.holdMin, product: t.product })),
    hours: hoursOut,
    symbols: symsOut,
    practices: pr,
    score: scoreOf(pr, closed.length),
    why,
    advice,
    edited: false,
  };
}

/* -------------------------------------------------------------------------------- analytics */

const rate = (a, b) => (b ? r1((a / b) * 100) : null);

function totalsOf(days) {
  const d = days.filter((x) => x.summary);
  const tot = { days: d.length, trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, charges: { ...emptyParts(), total: 0, statutory: 0, brokerAndOther: 0 }, net: 0, other: 0 };
  for (const x of d) {
    const s = x.summary;
    tot.trades += s.trades;
    tot.wins += s.wins;
    tot.losses += s.losses;
    tot.grossProfit += s.grossProfit;
    tot.grossLoss += s.grossLoss;
    tot.net += s.net;
    tot.other += s.other || 0;
    for (const k of [...PARTS, "total", "statutory", "brokerAndOther"]) tot.charges[k] += s.charges[k] || 0;
  }
  const gross = tot.grossProfit - tot.grossLoss;
  const green = d.filter((x) => x.summary.net > 0).length;
  const red = d.filter((x) => x.summary.net < 0).length;
  const best = d.length ? d.reduce((a, x) => (x.summary.net > a.summary.net ? x : a), d[0]) : null;
  const worst = d.length ? d.reduce((a, x) => (x.summary.net < a.summary.net ? x : a), d[0]) : null;
  // the daily equity curve and its deepest fall
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let run = 0;
  let bestRun = 0;
  let worstRun = 0;
  for (const x of [...d].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    eq += x.summary.net;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    run = x.summary.net > 0 ? (run > 0 ? run + 1 : 1) : x.summary.net < 0 ? (run < 0 ? run - 1 : -1) : 0;
    bestRun = Math.max(bestRun, run);
    worstRun = Math.min(worstRun, run);
  }
  const scores = d.map((x) => x.score).filter(num);
  const chargesOut = Object.fromEntries(Object.entries(tot.charges).map(([k, v]) => [k, r2(v)]));
  return {
    days: d.length,
    trades: tot.trades,
    wins: tot.wins,
    losses: tot.losses,
    winRatePct: rate(tot.wins, tot.trades),
    grossProfit: r2(tot.grossProfit),
    grossLoss: r2(tot.grossLoss),
    gross: r2(gross),
    charges: chargesOut,
    other: r2(tot.other),
    net: r2(tot.net),
    avgNetPerDay: d.length ? r2(tot.net / d.length) : null,
    avgTradesPerDay: d.length ? r1(tot.trades / d.length) : null,
    profitFactor: tot.grossLoss > 0 ? r2(tot.grossProfit / tot.grossLoss) : null,
    expectancyPerTrade: tot.trades ? r2(tot.net / tot.trades) : null,
    payoff: tot.wins && tot.losses && tot.grossLoss > 0 ? r2(tot.grossProfit / tot.wins / (tot.grossLoss / tot.losses)) : null,
    greenDays: green,
    redDays: red,
    greenDaysPct: rate(green, d.length),
    bestDay: best ? { date: best.date, net: best.summary.net } : null,
    worstDay: worst ? { date: worst.date, net: worst.summary.net } : null,
    maxDrawdown: r2(dd),
    bestStreak: bestRun,
    worstStreak: -worstRun,
    chargesPctOfGross: gross > 0 ? r1((tot.charges.total / gross) * 100) : null,
    avgScore: scores.length ? Math.round(sum(scores, (x) => x) / scores.length) : null,
  };
}

/**
 * Everything the dashboard draws, for the days between from and to (inclusive), with the same
 * length of days before them for comparison.
 * @param days  stored day reports (any order)
 */
function analytics(days, { from = null, to = null } = {}) {
  const all = days.filter((d) => d && d.summary).sort((a, b) => (a.date < b.date ? -1 : 1));
  const inRange = all.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  const t = totalsOf(inRange);
  // the comparison period: the same number of calendar days just before
  let previous = null;
  if (from && to) {
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    const pTo = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const pFrom = new Date(Date.parse(`${from}T00:00:00Z`) - span * 86400000).toISOString().slice(0, 10);
    const prev = all.filter((d) => d.date >= pFrom && d.date <= pTo);
    previous = prev.length ? { from: pFrom, to: pTo, ...totalsOf(prev) } : null;
  }
  let cum = 0;
  let cumGross = 0;
  let peak = 0;
  const series = inRange.map((d, i) => {
    const s = d.summary;
    cum += s.net;
    cumGross += s.gross;
    peak = Math.max(peak, cum);
    const win10 = inRange.slice(Math.max(0, i - 9), i + 1);
    const w = sum(win10, (x) => x.summary.wins);
    const tr = sum(win10, (x) => x.summary.trades);
    return { date: d.date, weekday: d.weekday, wins: s.wins, net: s.net, gross: s.gross, grossProfit: s.grossProfit, grossLoss: s.grossLoss, charges: s.charges.total, trades: s.trades, winRatePct: s.winRatePct, cumNet: r2(cum), cumGross: r2(cumGross), drawdown: r2(peak - cum), rollingWinPct: tr ? r1((w / tr) * 100) : null, score: d.score, marginAvailable: d.margin ? d.margin.available : null, netPctOfMargin: s.netPctOfMargin };
  });
  const group = (rows, keyOf, order) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const g = m.get(k) || { key: k, days: 0, trades: 0, wins: 0, net: 0, greenDays: 0 };
      g.days += 1;
      g.trades += r.trades;
      g.wins += r.wins;
      g.net += r.net;
      if (r.net > 0) g.greenDays += 1;
      m.set(k, g);
    }
    const out = [...m.values()].map((g) => ({ ...g, net: r2(g.net), avg: g.days ? r2(g.net / g.days) : 0, winRatePct: rate(g.wins, g.trades), greenDaysPct: rate(g.greenDays, g.days) }));
    return order ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : out;
  };
  const weekday = group(series, (s) => s.weekday, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  // hours: from each day's own buckets
  const hm = new Map();
  for (const d of inRange) for (const h of d.hours || []) {
    const g = hm.get(h.hour) || { key: `${h.hour}:00`, trades: 0, wins: 0, net: 0 };
    g.trades += h.trades;
    g.wins += h.wins;
    g.net += h.net;
    hm.set(h.hour, g);
  }
  const hours = [...hm.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((g) => ({ ...g, net: r2(g.net), winRatePct: rate(g.wins, g.trades) }));
  const sm = new Map();
  for (const d of inRange) for (const s of d.symbols || []) {
    const g = sm.get(s.symbol) || { symbol: s.symbol, trades: 0, wins: 0, net: 0, days: 0 };
    g.trades += s.trades;
    g.wins += s.wins;
    g.net += s.net;
    g.days += 1;
    sm.set(s.symbol, g);
  }
  const symbols = [...sm.values()].map((g) => ({ ...g, net: r2(g.net), winRatePct: rate(g.wins, g.trades) })).sort((a, b) => b.net - a.net);
  // which practices recur, and what the days that had them netted against the days that did not
  const pr = (kind) => {
    const m = new Map();
    for (const d of inRange) for (const p of (d.practices && d.practices[kind]) || []) {
      const g = m.get(p.id) || { id: p.id, title: p.title, days: 0, net: 0, impact: 0 };
      g.days += 1;
      g.net += d.summary.net;
      g.impact += p.impact || 0;
      m.set(p.id, g);
    }
    return [...m.values()]
      .map((g) => {
        const others = inRange.filter((d) => !((d.practices && d.practices[kind]) || []).some((p) => p.id === g.id));
        return { id: g.id, title: g.title, days: g.days, pctDays: rate(g.days, inRange.length), netOnThoseDays: r2(g.net), avgOnThoseDays: r2(g.net / g.days), avgOnOtherDays: others.length ? r2(sum(others, (d) => d.summary.net) / others.length) : null, impact: r2(g.impact) };
      })
      .sort((a, b) => b.days - a.days);
  };
  const c = t.charges;
  const charges = PARTS.map((k) => ({ key: k, label: PART_LABEL[k], amount: c[k], pct: c.total ? r1((c[k] / c.total) * 100) : 0 })).filter((x) => x.amount > 0 || x.key === "brokerage");
  return {
    range: { from: inRange.length ? inRange[0].date : from, to: inRange.length ? inRange[inRange.length - 1].date : to, days: inRange.length },
    totals: t,
    previous,
    series,
    weekday,
    hours,
    symbols: { best: symbols.filter((s) => s.net > 0).slice(0, 8), worst: symbols.filter((s) => s.net < 0).slice(-8).reverse() },
    practices: { bad: pr("bad"), good: pr("good") },
    charges,
    composition: { profit: t.grossProfit, loss: t.grossLoss, charges: c.total, net: t.net },
    scatter: series.map((s) => ({ date: s.date, trades: s.trades, net: s.net })),
  };
}

module.exports = { buildDay, analytics, totalsOf, practices, chargeSet, PARTS, PART_LABEL, WEEKDAYS };
