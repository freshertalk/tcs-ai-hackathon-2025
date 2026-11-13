"use strict";
// The direction for one stock: every reading the terminal has, looked at through the lenses
// that experienced investors and traders use, weighed into one clear call — with the plan,
// what would cancel it, and where the lenses disagree.
//
// Lenses (each says bullish / bearish / neutral, with its evidence):
//   long-term owner   is this a stock in a durable uptrend worth owning? (200-day line,
//                     long-term checks, place in the 52-week range, depth of its drawdown)
//   trend follower    is the swing trend up, and is it strong? (the swing verdict, ADX)
//   momentum          is buying pressure building or fading? (RSI, MACD, 20-day rate of change)
//   measured odds     did days like today pay, tested forward? (the Advisor's grade)
//   habits            how does this stock usually behave from here? (its 1-year profile)
//   market            is the tide with it or against it? (the Nifty's state)
//   risk              can it be traded sensibly? (volatility, liquidity, the room to the
//                     next level, circuit limits)
// A value investor's lens needs company financials — earnings, debt, cash flow, valuation —
// which the terminal's data source (Zerodha) does not provide. It is shown as not available
// rather than guessed.
//
// Pure arithmetic on the readings passed in: no network, no clock, no order. The call is a
// summary of evidence, not a forecast and not advice; nothing can promise a winning trade.

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (isNum(x) ? Math.round(x * 100) / 100 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TICK = 0.05;
const onTick = (x) => r2(Math.round(x / TICK) * TICK);

function lens(id, name, weight) {
  return { id, name, weight, score: 0, view: "neutral", evidence: [], available: true };
}
function settle(l) {
  l.score = clamp(Math.round(l.score), -100, 100);
  l.view = l.score >= 20 ? "bullish" : l.score <= -20 ? "bearish" : "neutral";
  return l;
}

/**
 * @param sheet     the research data sheet (price, atr, indicators, levels, swing, longTerm, …)
 * @param edge      the measured-odds report for the stock, or null
 * @param profile   the behaviour profile, or null
 * @param market    { tide: { score, label } } or null
 */
function buildDirection({ sheet, edge = null, profile = null, market = null }) {
  if (!sheet || !sheet.price || !isNum(sheet.price.last)) return { available: false, reason: "No price for this stock." };
  const last = sheet.price.last;
  const ind = sheet.indicators || {};
  const ma = sheet.movingAverages || {};
  const w52 = sheet.week52 || {};
  const atr = isNum(sheet.atr) ? sheet.atr : isNum(ind.atr14) ? ind.atr14 : null;
  const L = [];

  // ---- long-term owner
  const own = lens("owner", "Long-term owner", 1.2);
  const ma200 = isNum(ma.sma200) ? ma.sma200 : ma.ema200;
  if (isNum(ma200)) {
    const away = ((last - ma200) / ma200) * 100;
    own.score += away > 0 ? 35 : -35;
    own.evidence.push(`${away > 0 ? "Above" : "Below"} its 200-day average (${r2(ma200)}), ${Math.abs(away).toFixed(1)}% ${away > 0 ? "over" : "under"}.`);
  }
  if (sheet.longTerm && sheet.longTerm.stance) {
    const up = /uptrend/i.test(sheet.longTerm.stance);
    const down = /downtrend/i.test(sheet.longTerm.stance);
    own.score += up ? 35 : down ? -35 : 0;
    own.evidence.push(`${sheet.longTerm.stance} (${sheet.longTerm.checks || "?"} long-term checks met).`);
  }
  if (isNum(w52.positionPct)) {
    own.score += w52.positionPct >= 70 ? 15 : w52.positionPct <= 25 ? -15 : 0;
    own.evidence.push(`At ${Math.round(w52.positionPct)}% of its 52-week range (${r2(w52.low)} – ${r2(w52.high)}).`);
  }
  if (profile && profile.available && profile.drawdown && isNum(profile.drawdown.currentPct) && profile.drawdown.currentPct < -25) {
    own.score -= 15;
    own.evidence.push(`${Math.abs(profile.drawdown.currentPct).toFixed(0)}% below its highest close of the year.`);
  }
  L.push(settle(own));

  // ---- trend follower
  const tr = lens("trend", "Trend follower", 1.2);
  if (sheet.swing && sheet.swing.stance) {
    const s = sheet.swing.stance;
    tr.score += s === "Bullish" ? 45 : s === "Bearish" ? -45 : 0;
    tr.evidence.push(`Swing reading ${s.toLowerCase()} (score ${sheet.swing.score > 0 ? "+" : ""}${sheet.swing.score}, ${sheet.swing.conviction || "?"} conviction).`);
  }
  if (isNum(ma.ema20) && isNum(ma.ema50)) {
    const up = ma.ema20 > ma.ema50;
    tr.score += up ? 20 : -20;
    tr.evidence.push(`20-day average ${up ? "above" : "below"} the 50-day.`);
  }
  if (isNum(ind.adx)) {
    const strong = ind.adx >= 25;
    tr.score *= strong ? 1.2 : ind.adx < 18 ? 0.6 : 1;
    tr.evidence.push(`ADX ${ind.adx}: ${strong ? "a strong trend" : ind.adx < 18 ? "no real trend — trend signals are weak" : "a moderate trend"}.`);
  }
  L.push(settle(tr));

  // ---- momentum
  const mo = lens("momentum", "Momentum", 0.9);
  if (isNum(ind.rsi14)) {
    const r = ind.rsi14;
    mo.score += r >= 55 && r < 70 ? 30 : r >= 70 ? 10 : r <= 45 && r > 30 ? -30 : r <= 30 ? -10 : 0;
    mo.evidence.push(`RSI ${r}${r >= 70 ? " — overbought: strong, but a chase" : r <= 30 ? " — oversold: weak, but stretched" : ""}.`);
  }
  if (isNum(ind.macdHist)) {
    mo.score += ind.macdHist > 0 ? 25 : -25;
    mo.evidence.push(`MACD histogram ${ind.macdHist > 0 ? "positive" : "negative"} (${ind.macdHist}).`);
  }
  if (isNum(ind.roc20)) {
    mo.score += ind.roc20 > 3 ? 20 : ind.roc20 < -3 ? -20 : 0;
    mo.evidence.push(`${ind.roc20 > 0 ? "+" : ""}${ind.roc20}% over 20 sessions.`);
  }
  L.push(settle(mo));

  // ---- measured odds
  const od = lens("odds", "Measured odds", 1.5);
  if (edge && edge.available) {
    const b = edge.best;
    if (b && (b.grade === "A" || b.grade === "B")) {
      const dir = b.side === "long" ? 1 : -1;
      od.score += dir * (b.grade === "A" ? 70 : 45);
      od.evidence.push(`Grade ${b.grade} ${b.kind} ${b.side}: ${b.winPct}% of ${b.n} similar days paid, ${b.expR > 0 ? "+" : ""}${b.expR}R on average after costs — backed by the forward test.`);
    } else if (b && b.grade === "C") {
      od.evidence.push(`Today looks favourable for a ${b.kind} ${b.side}, but the forward test does not back it (grade C).`);
    } else {
      od.evidence.push("No favourable reading: the days most like today did not pay after costs.");
    }
    if (edge.warning) {
      od.score -= 40;
      od.evidence.push(edge.warning);
    }
  } else {
    od.available = false;
    od.evidence.push(edge && edge.reason ? edge.reason : "Not measured yet.");
  }
  L.push(settle(od));

  // ---- habits
  const hb = lens("habits", "Habits", 0.7);
  if (profile && profile.available) {
    const t = profile.trend && profile.trend.now;
    hb.score += t === "uptrend" ? 30 : t === "downtrend" ? -30 : 0;
    hb.evidence.push(`Its trend by its own 1-year record: ${t || "unknown"}.`);
    const bo = profile.breakouts;
    if (bo && isNum(bo.followThroughPct) && bo.n >= 5) {
      hb.score += bo.followThroughPct >= 60 ? 15 : bo.followThroughPct <= 40 ? -15 : 0;
      hb.evidence.push(`Its 20-day breakouts followed through ${bo.followThroughPct}% of the time (${bo.n} breakouts).`);
    }
    (profile.facts || []).slice(1, 3).forEach((f) => hb.evidence.push(f));
  } else {
    hb.available = false;
    hb.evidence.push("No behaviour profile yet.");
  }
  L.push(settle(hb));

  // ---- market
  const mk = lens("market", "Market backdrop", 0.8);
  if (market && market.tide && isNum(market.tide.score)) {
    mk.score += clamp(market.tide.score, -60, 60);
    mk.evidence.push(`Market tide ${market.tide.label || ""} (${market.tide.score > 0 ? "+" : ""}${market.tide.score}).`);
  } else {
    mk.available = false;
    mk.evidence.push("The market's state was not available.");
  }
  L.push(settle(mk));

  // ---- risk: it does not pick a direction, it limits how far to trust one
  const rk = lens("risk", "Risk", 0);
  let riskPenalty = 0;
  if (isNum(ind.atrPct)) {
    rk.evidence.push(`Moves ${ind.atrPct}% a day on average (ATR ${r2(atr)}).`);
    if (ind.atrPct > 4) {
      riskPenalty += 15;
      rk.evidence.push("High volatility: size small, stops wide.");
    }
  }
  const sup = (sheet.supports || []).find((x) => isNum(x.price) && x.price < last);
  const res = (sheet.resistances || []).find((x) => isNum(x.price) && x.price > last);
  if (res && atr && res.price - last < 0.6 * atr) {
    riskPenalty += 10;
    rk.evidence.push(`Resistance at ${r2(res.price)} is less than a day's move above: little room.`);
  }
  if (sheet.liquidity && isNum(sheet.liquidity.turnoverCr) && sheet.liquidity.turnoverCr < 5) {
    riskPenalty += 15;
    rk.evidence.push(`Thin trading (₹${sheet.liquidity.turnoverCr} Cr a day).`);
  }
  if (!rk.evidence.length) rk.evidence.push("Nothing unusual.");
  rk.view = riskPenalty >= 20 ? "bearish" : "neutral";
  L.push(rk);

  // ---- a value investor's lens: honestly not available
  L.push({ id: "value", name: "Value investor", weight: 0, score: 0, view: "neutral", available: false, evidence: ["Needs company financials (earnings, debt, cash flow, valuation), which the data source does not provide. Not guessed."] });

  // ---- weigh it
  const used = L.filter((l) => l.available && l.weight > 0);
  const wsum = used.reduce((a, l) => a + l.weight, 0) || 1;
  let score = used.reduce((a, l) => a + l.score * l.weight, 0) / wsum;
  const bulls = used.filter((l) => l.view === "bullish").length;
  const bears = used.filter((l) => l.view === "bearish").length;
  const agreement = used.length ? Math.max(bulls, bears) / used.length : 0;
  const conflicts = used.filter((l) => (score > 0 && l.view === "bearish") || (score < 0 && l.view === "bullish")).map((l) => `${l.name}: ${l.evidence[0]}`);
  score = clamp(Math.round(score), -100, 100);
  let confidence = Math.round(clamp(Math.abs(score) * (0.5 + agreement / 2) - riskPenalty, 0, 100));

  // the measured odds are the only lens tested forward: without them a "buy" cannot be strong
  const oddsBack = od.available && od.view === "bullish";
  let call;
  if (score >= 35 && confidence >= 35) call = oddsBack ? "buy" : "watch";
  else if (score >= 15) call = "watch";
  else if (score <= -35) call = "avoid";
  else if (score <= -15) call = "caution";
  else call = "no-trade";
  if (!oddsBack && call === "watch" && score >= 35) confidence = Math.min(confidence, 55);

  // ---- the plan, from the stock's own levels
  let plan = null;
  if ((call === "buy" || call === "watch") && atr) {
    const pull = sup && last - sup.price > 1.2 * atr; // far above support: wait for a pullback
    const entry = call === "watch" && res ? onTick(res.price + 0.1 * atr) : pull ? onTick(sup.price + 0.25 * atr) : onTick(last);
    const stop = onTick(sup && sup.price < entry ? Math.min(sup.price - 0.25 * atr, entry - 0.8 * atr) : entry - 1.5 * atr);
    const risk = entry - stop;
    const tgts = (sheet.resistances || []).map((x) => x.price).filter((p) => isNum(p) && p > entry + 0.5 * risk).slice(0, 2).map(onTick);
    if (!tgts.length) tgts.push(onTick(entry + 2 * risk));
    plan = {
      how: call === "watch" && res ? `Only on a close above ${r2(res.price)}` : pull ? `On a pullback toward ${r2(sup.price)}` : "Near the current price",
      entry,
      stop,
      targets: tgts,
      riskPerShare: r2(risk),
      rewardToRisk: r2((tgts[0] - entry) / risk),
      invalidation: `A daily close below ${r2(stop)}.`,
    };
    // a trade whose first target barely pays for its stop is not worth taking yet
    if (plan.rewardToRisk < 1.5) {
      conflicts.unshift(`The first target is only ${plan.rewardToRisk}× the risk from this entry: too little reward for the stop. Wait for a better price or a breakout.`);
      confidence = Math.min(confidence, 40);
      if (call === "buy") call = "watch";
    }
  }

  const WORD = { buy: "Buy", watch: "Watch for entry", "no-trade": "No trade", caution: "Caution", avoid: "Avoid" };
  const why =
    call === "buy"
      ? "Most lenses agree it is rising, and the measured odds — the one test done forward — back a long."
      : call === "watch"
        ? oddsBack
          ? "Leaning up, but not yet a clean entry."
          : "Leaning up, but the measured odds do not back a long yet: wait for the trigger."
        : call === "avoid"
          ? "Most lenses point down. Not a stock to buy now; holders may tighten stops."
          : call === "caution"
            ? "Leaning down. Better left alone until it repairs."
            : "The lenses do not agree on a direction. Doing nothing is a position.";
  return { available: true, call, label: WORD[call], score, confidence, agreement: Math.round(agreement * 100), why, lenses: L, conflicts: conflicts.slice(0, 4), plan, last: r2(last) };
}

module.exports = { buildDirection };
