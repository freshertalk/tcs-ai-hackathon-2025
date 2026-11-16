"use strict";
// Knowledge checks: the desk's knowledge base (market/knowledge.js and market/kb/) applied to ONE stock's
// readings now. The encyclopedia says what VWAP, RSI, ADX, volume, gaps, the time of day, price bands,
// the VIX, costs and the masters' rules mean; this file turns those rules into checks on the numbers the
// desk already has. So every decision — the live scanner, the Top 10, the Advisor, a stock's direction
// and every AI forecast — can say which rules of the trade agree with a call, which argue against it,
// and which only ask for care.
//
// Each check gives a NOTE: { id, topic, title, stance, side, text, weight, counts }
//   topic    the knowledge-base topic the rule comes from (its title is shown with it)
//   stance   "for"      supports that side
//            "against"  argues against that side
//            "caution"  asks for care either way (size, timing, costs) — no direction
//            "info"     context worth knowing (a narrow CPR, a squeeze) — no direction
//   side     "long" | "short" | "both"
//   counts   true when the check reads something the desk's engines do not already weigh — the context
//            the textbook adds: RSI read against the strength of the trend, a stretch from VWAP, the
//            volume behind a break, a gap that fades, a chase, a leader in a weak market, a price band,
//            costs against the target. Only these move the knowledge VOTE, so no reading is counted
//            twice; the others are the textbook's reading of numbers the engines already score. A
//            caller that already scores one of these passes it in `skip`.
//
// The VOTE (−1 … +1, long minus short) is a small weight in the engines that take it, never a veto:
// what the desk has MEASURED on its own history outranks any textbook rule (see "honest-odds").
//
// Pure: no network, no clock (the minute is passed in), no AI, no order. A reading of evidence, not a
// promise and not advice.

const KB = require("./knowledge");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 || 0 : null);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 || 0 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const sg = (x) => (num(x) ? `${x > 0 ? "+" : ""}${r2(x)}` : "—");
const TITLES = new Map(KB.ALL.map((t) => [t.id, t.title]));
const OPPOSITE = { long: "short", short: "long" };

// minutes after 9:15 IST
const MIDDAY_FROM = 135; // 11:30
const MIDDAY_TO = 255; // 13:30
const LAST_ENTRY = 330; // 14:45

/**
 * The checks. Each reads the facts (all optional — a check whose facts are missing says nothing) and
 * returns { stance, side, text, weight? } or null.
 *
 * Facts: horizon ("intraday" | "swing"), live (the session is open and the numbers are live), minsIn
 * (minutes since 9:15), last, chgPct, gapPct, vsOpenPct, vsVwapPct, vsVwapAtr, rsi, adx, plusDI, minusDI,
 * relVol (volume so far against the usual by this time), relVolDaily (the last session's volume against
 * its average), orb ("above" | "below" | "inside" | "forming"), rangePos (0 = the day's low, 1 = its
 * high), squeeze, cprWidthPct, dailyTrend (1 | −1 | 0), vsEma20, vsEma50, vsEma200, toHi20Pct, toLo20Pct,
 * fromHi52Pct, fromLo52Pct, nr7, inside, closeLoc, rsNifty, market (the market's lean, −100…+100), vix,
 * atrPct (the daily range in %), turnoverCr, circuit ({ upper, lower, toUpperPct, toLowerPct }), plan
 * ({ side, entry, stop, t1 }), events (scheduled company events, in words).
 */
const CHECKS = [
  // ---------------------------------------------------------------- VWAP
  {
    id: "vwap-side",
    topic: "ind-vwap",
    run(f) {
      if (!f.live || !num(f.vsVwapPct)) return null;
      if (f.vsVwapPct >= 0.15) return { stance: "for", side: "long", text: `Above VWAP (${sg(f.vsVwapPct)}%): the day's average buyer is in profit — the textbook's intraday line for longs.` };
      if (f.vsVwapPct <= -0.15) return { stance: "for", side: "short", text: `Below VWAP (${sg(f.vsVwapPct)}%): the day's average buyer is under water — the textbook's intraday line for shorts.` };
      return { stance: "info", side: "both", text: `On VWAP (${sg(f.vsVwapPct)}%): neither side is in control yet; the textbook waits for price to pick a side.` };
    },
  },
  {
    id: "vwap-stretch",
    topic: "ind-vwap",
    counts: true,
    weight: 1.5,
    run(f) {
      if (!f.live) return null;
      const byAtr = num(f.vsVwapAtr);
      const far = byAtr ? Math.abs(f.vsVwapAtr) >= 2 : num(f.vsVwapPct) && Math.abs(f.vsVwapPct) >= 2.5;
      if (!far) return null;
      const up = (byAtr ? f.vsVwapAtr : f.vsVwapPct) > 0;
      const how = byAtr ? `${r1(Math.abs(f.vsVwapAtr))} ATR` : `${r2(Math.abs(f.vsVwapPct))}%`;
      return { stance: "against", side: up ? "long" : "short", text: `Stretched ${how} ${up ? "above" : "below"} VWAP: an entry this far out needs a wide stop and price often snaps back toward VWAP — the textbook waits for a pullback.` };
    },
  },
  // ---------------------------------------------------------------- RSI and ADX
  {
    id: "rsi-context",
    topic: "ind-rsi",
    counts: true,
    run(f) {
      if (!num(f.rsi) || !num(f.adx)) return null;
      const di = num(f.plusDI) && num(f.minusDI) ? f.plusDI - f.minusDI : null;
      if (f.rsi >= 70) {
        if (f.adx >= 25 && (di === null || di > 0)) return { stance: "for", side: "long", weight: 0.5, text: `RSI ${f.rsi} in a strong up-trend (ADX ${f.adx}): RSI stays overbought for long stretches in a trend — on its own it is no reason to short.` };
        if (f.adx < 20) return { stance: "against", side: "long", text: `RSI ${f.rsi} with no trend (ADX ${f.adx}): in a range an overbought RSI tends to fade — a long here buys the top of the range.` };
      }
      if (f.rsi <= 30) {
        if (f.adx >= 25 && (di === null || di < 0)) return { stance: "for", side: "short", weight: 0.5, text: `RSI ${f.rsi} in a strong down-trend (ADX ${f.adx}): RSI stays oversold for long stretches in a trend — on its own it is no reason to buy.` };
        if (f.adx < 20) return { stance: "against", side: "short", text: `RSI ${f.rsi} with no trend (ADX ${f.adx}): in a range an oversold RSI tends to bounce — a short here sells the bottom of the range.` };
      }
      return null;
    },
  },
  {
    id: "adx-regime",
    topic: "ind-adx",
    run(f) {
      if (!num(f.adx)) return null;
      if (f.adx < 18) return { stance: "caution", side: "both", text: `ADX ${f.adx}: no trend — breakouts fail more often in a range; the textbook fades the range's edges or waits.` };
      if (f.adx >= 25 && num(f.plusDI) && num(f.minusDI)) {
        const up = f.plusDI > f.minusDI;
        return { stance: "for", side: up ? "long" : "short", text: `ADX ${f.adx} with ${up ? "+DI over −DI" : "−DI over +DI"}: a trend — the textbook trades with it, entering on pullbacks rather than against it.` };
      }
      return null;
    },
  },
  // ---------------------------------------------------------------- volume, breaks, the opening range
  {
    id: "break-volume",
    topic: "vol-analysis",
    counts: true,
    weight: 1.5,
    run(f) {
      let side = null;
      let what = "";
      let vol = null;
      if (f.live && (f.orb === "above" || f.orb === "below")) {
        side = f.orb === "above" ? "long" : "short";
        what = f.orb === "above" ? "the opening-range high" : "the opening-range low";
        vol = f.relVol;
      } else if (num(f.toHi20Pct) && f.toHi20Pct <= 0) {
        side = "long";
        what = "its 20-day high";
        vol = f.live && num(f.relVol) ? f.relVol : f.relVolDaily;
      } else if (num(f.toLo20Pct) && f.toLo20Pct < 0) {
        side = "short";
        what = "its 20-day low";
        vol = f.live && num(f.relVol) ? f.relVol : f.relVolDaily;
      }
      if (!side || !num(vol)) return null;
      if (vol >= 1.5) return { stance: "for", side, text: `Through ${what} on ${r2(vol)}× its usual volume: heavy volume is the textbook's first test of a real break.` };
      if (vol < 0.8) return { stance: "against", side, text: `Through ${what} on only ${r2(vol)}× its usual volume: a break on thin volume is the classic false breakout.` };
      return null;
    },
  },
  {
    id: "opening-range",
    topic: "st-intraday",
    run(f) {
      if (!f.live) return null;
      if (f.orb === "above") return { stance: "for", side: "long", text: "Above the opening-range high: the opening-range breakout, the textbook's first intraday set-up — its stop sits at the other side of the range." };
      if (f.orb === "below") return { stance: "for", side: "short", text: "Below the opening-range low: the opening-range breakdown, the textbook's first intraday set-up — its stop sits at the other side of the range." };
      if (f.orb === "inside") return { stance: "info", side: "both", text: "Inside the opening range: no break yet — the textbook waits for one, or fades the edges on a range day." };
      return null;
    },
  },
  // ---------------------------------------------------------------- the time of day
  {
    id: "time-of-day",
    topic: "time",
    run(f) {
      if (!f.live || !num(f.minsIn) || f.horizon !== "intraday") return null;
      if (f.minsIn < 15) return { stance: "caution", side: "both", text: "The first 15 minutes: the opening range is still forming, spreads are wide and moves reverse — the textbook waits for 9:30." };
      if (f.minsIn >= MIDDAY_FROM && f.minsIn < MIDDAY_TO) return { stance: "caution", side: "both", text: "The midday lull (11:30 AM – 1:30 PM): volume thins and price chops — breakouts fail more often, so the textbook asks for a stronger reading or waits for the 1:30 PM pick-up." };
      if (f.minsIn >= LAST_ENTRY) return { stance: "caution", side: "both", text: "After 2:45 PM: too little time for a target before brokers square off intraday positions (about 3:15–3:20 PM) — the textbook starts nothing new and manages what is open." };
      return null;
    },
  },
  // ---------------------------------------------------------------- gaps and chasing
  {
    id: "gap",
    topic: "pa-gaps",
    counts: true,
    run(f) {
      if (!f.live || !num(f.gapPct) || Math.abs(f.gapPct) < 1.5) return null;
      const up = f.gapPct > 0;
      if (num(f.minsIn) && f.minsIn < 30) return { stance: "caution", side: "both", text: `A ${sg(f.gapPct)}% gap: the textbook lets the first 15–30 minutes show whether it holds (gap-and-go) or starts to fill before trading it.` };
      if (!num(f.vsOpenPct)) return null;
      const holds = up ? f.vsOpenPct >= 0 : f.vsOpenPct <= 0;
      return holds
        ? { stance: "for", side: up ? "long" : "short", text: `A ${sg(f.gapPct)}% gap holding ${up ? "above" : "below"} the open (${sg(f.vsOpenPct)}% from it): a gap that holds is a gap-and-go — the textbook trades it the gap's way.` }
        : { stance: "against", side: up ? "long" : "short", text: `A ${sg(f.gapPct)}% gap fading from the open (${sg(f.vsOpenPct)}% from it): big gaps often fill part-way — the textbook does not chase the gap's side once it fades.` };
    },
  },
  {
    id: "chase",
    topic: "psy-biases",
    counts: true,
    run(f) {
      if (!f.live || !num(f.chgPct) || !num(f.rangePos)) return null;
      if (f.chgPct >= 3 && f.rangePos >= 0.85) return { stance: "against", side: "long", text: `Already ${sg(f.chgPct)}% up and at the top of the day's range: buying here is the chase the textbook warns about (fear of missing out) — the risk is the whole way back to VWAP.` };
      if (f.chgPct <= -3 && f.rangePos <= 0.15) return { stance: "against", side: "short", text: `Already ${sg(f.chgPct)}% down and at the bottom of the day's range: shorting here is a chase — the risk is the whole way back to VWAP.` };
      return null;
    },
  },
  // ---------------------------------------------------------------- volatility and the day's type
  {
    id: "squeeze",
    topic: "ind-bollinger",
    run(f) {
      if (!f.squeeze) return null;
      return { stance: "info", side: "both", text: "A Bollinger squeeze: volatility has contracted, and contraction comes before expansion — the textbook takes the direction from the break, not from the squeeze." };
    },
  },
  {
    id: "narrow-range",
    topic: "m-shortterm",
    run(f) {
      if (f.nr7) return { stance: "info", side: "both", text: "NR7, the narrowest daily range of seven sessions: short-term traders' studies (Crabel) found range expansion tends to follow — a break either way is the set-up." };
      if (f.inside) return { stance: "info", side: "both", text: "An inside day (inside the previous day's range): a break of its high or low tends to run — a short-term trader's classic." };
      return null;
    },
  },
  {
    id: "cpr",
    topic: "st-daytypes",
    run(f) {
      if (!num(f.cprWidthPct)) return null;
      if (f.cprWidthPct <= 0.25) return { stance: "info", side: "both", text: `A narrow CPR (${r2(f.cprWidthPct)}% wide): trend days are more likely — the textbook favours breakouts over fades today.` };
      if (f.cprWidthPct >= 0.8) return { stance: "info", side: "both", text: `A wide CPR (${r2(f.cprWidthPct)}% wide): range days are more likely — the textbook favours fading the range's edges over breakouts.` };
      return null;
    },
  },
  // ---------------------------------------------------------------- the bigger picture
  {
    id: "higher-timeframe",
    topic: "pa-timeframes",
    run(f) {
      if (f.horizon !== "intraday") return null;
      const t = f.dailyTrend === 1 || f.dailyTrend === -1 ? f.dailyTrend : num(f.vsEma20) && num(f.vsEma50) ? (f.vsEma20 > 0 && f.vsEma50 > 0 ? 1 : f.vsEma20 < 0 && f.vsEma50 < 0 ? -1 : 0) : 0;
      if (t === 1) return { stance: "for", side: "long", text: "The daily chart is up (above its 20- and 50-day averages): the textbook trades the intraday chart in the direction of the higher time frame." };
      if (t === -1) return { stance: "for", side: "short", text: "The daily chart is down (below its 20- and 50-day averages): the textbook trades the intraday chart in the direction of the higher time frame." };
      return null;
    },
  },
  {
    id: "trend-template",
    topic: "m-minervini",
    run(f) {
      if (!num(f.vsEma200)) return null;
      if (f.vsEma200 > 0 && num(f.vsEma50) && f.vsEma50 > 0) return { stance: "for", side: "long", text: "Above its 50- and 200-day averages: the long-term trend is up — the trend template that Minervini- and O'Neil-style buying starts from." };
      if (f.vsEma200 < 0) return { stance: "against", side: "long", text: `Below its 200-day average (${sg(f.vsEma200)}%): trend-following buyers (Minervini, O'Neil) do not buy a stock in a long-term down-trend.` };
      return null;
    },
  },
  {
    id: "week52",
    topic: "m-oneil",
    run(f) {
      if (num(f.fromHi52Pct) && f.fromHi52Pct >= -3 && (!num(f.vsEma50) || f.vsEma50 > 0)) return { stance: "for", side: "long", text: `Within ${r2(Math.abs(f.fromHi52Pct))}% of its 52-week high: leaders make new highs — O'Neil and Darvas bought strength near highs, where few trapped sellers wait above.` };
      if (num(f.fromLo52Pct) && f.fromLo52Pct <= 3 && (!num(f.vsEma50) || f.vsEma50 < 0)) return { stance: "against", side: "long", text: `Within ${r2(Math.abs(f.fromLo52Pct))}% of its 52-week low: buying here is catching a falling knife — the masters buy strength, not weakness.` };
      return null;
    },
  },
  {
    id: "market-tide",
    topic: "regime",
    run(f) {
      if (!num(f.market)) return null;
      if (f.market <= -40) return { stance: "against", side: "long", text: `The market leans down (${sg(f.market)}): most stocks move with the market (O'Neil's "M") — a long fights the tide and needs stronger evidence.` };
      if (f.market >= 40) return { stance: "against", side: "short", text: `The market leans up (${sg(f.market)}): most stocks move with the market — a short fights the tide and needs stronger evidence.` };
      return null;
    },
  },
  {
    id: "leader",
    topic: "selection",
    counts: true,
    run(f) {
      if (!num(f.rsNifty) || !num(f.market) || !num(f.chgPct)) return null;
      if (f.market <= -20 && f.rsNifty >= 1 && f.chgPct > 0) return { stance: "for", side: "long", text: `Up ${sg(f.chgPct)}% while the market leans down: strength against a weak market marks a leader — the textbook's first list for longs when the market turns.` };
      if (f.market >= 20 && f.rsNifty <= -1 && f.chgPct < 0) return { stance: "for", side: "short", text: `Down ${sg(f.chgPct)}% while the market leans up: weakness against a strong market marks a laggard — the textbook's list for shorts.` };
      return null;
    },
  },
  {
    id: "close-location",
    topic: "pa-candles",
    run(f) {
      if (f.live || !num(f.closeLoc) || !num(f.relVolDaily) || f.relVolDaily < 1.5) return null;
      if (f.closeLoc >= 0.8) return { stance: "for", side: "long", text: `Closed in the top fifth of its range on ${r2(f.relVolDaily)}× its usual volume: buyers were in control into the close.` };
      if (f.closeLoc <= 0.2) return { stance: "for", side: "short", text: `Closed in the bottom fifth of its range on ${r2(f.relVolDaily)}× its usual volume: sellers were in control into the close.` };
      return null;
    },
  },
  // ---------------------------------------------------------------- risk, size, costs, rules
  {
    id: "vix",
    topic: "in-indices",
    run(f) {
      if (!num(f.vix)) return null;
      if (f.vix >= 20) return { stance: "caution", side: "both", text: `India VIX ${r2(f.vix)}: the market expects wide swings — the textbook keeps the rupee risk the same, which means a wider stop and fewer shares.` };
      if (f.vix <= 11) return { stance: "info", side: "both", text: `India VIX ${r2(f.vix)}: a calm market — moves tend to travel less, so nearer targets.` };
      return null;
    },
  },
  {
    id: "volatility",
    topic: "risk-sizing",
    run(f) {
      if (!num(f.atrPct)) return null;
      if (f.atrPct > 4) return { stance: "caution", side: "both", text: `Moves ${r2(f.atrPct)}% a day on average: size by the stop's distance — the same rupee risk buys fewer shares.` };
      if (f.horizon === "intraday" && f.atrPct < 0.8) return { stance: "caution", side: "both", text: `Moves only ${r2(f.atrPct)}% a day on average: a quiet stock's intraday move may not cover charges and slippage.` };
      return null;
    },
  },
  {
    id: "liquidity",
    topic: "in-execution",
    run(f) {
      if (!num(f.turnoverCr) || f.turnoverCr >= 50) return null;
      return { stance: "caution", side: "both", text: `About ₹${Math.round(f.turnoverCr)} crore traded a day: in a thin stock spreads and slippage take a larger share — limit orders and a smaller size.` };
    },
  },
  {
    id: "price-band",
    topic: "in-bands",
    counts: true,
    weight: 2,
    run(f) {
      const c = f.circuit;
      if (!c) return null;
      if (num(c.toUpperPct) && c.toUpperPct >= 0 && c.toUpperPct < 2) return { stance: "against", side: "long", text: `Only ${r2(c.toUpperPct)}% below its upper price band (${c.upper}): the band caps the rise, leaving a long little room — and a short is trapped if it locks there (no sellers at the band).` };
      if (num(c.toLowerPct) && c.toLowerPct <= 0 && c.toLowerPct > -2) return { stance: "against", side: "short", text: `Only ${r2(Math.abs(c.toLowerPct))}% above its lower price band (${c.lower}): the band caps the fall, leaving a short little room — and a long is trapped if it locks there (no buyers at the band).` };
      return null;
    },
  },
  {
    // whether a trade pays at all, not which way the stock goes: shown, never counted in the vote
    id: "costs",
    topic: "costs",
    weight: 1.5,
    run(f) {
      const p = f.plan;
      if (f.horizon !== "intraday" || !p || !num(p.entry) || !num(p.t1) || p.entry <= 0 || !OPPOSITE[p.side]) return null;
      const rewardPct = (Math.abs(p.t1 - p.entry) / p.entry) * 100;
      if (rewardPct >= 0.35) return null;
      return { stance: "against", side: p.side, text: `The first target is only ${r2(rewardPct)}% away: brokerage, STT, exchange charges, GST, stamp duty and slippage (about 0.1% a round trip, more on small orders) take a large share of a move this small.` };
    },
  },
  {
    id: "reward-risk",
    topic: "risk-expectancy",
    run(f) {
      const p = f.plan;
      if (!p || !num(p.entry) || !num(p.stop) || !num(p.t1)) return null;
      const risk = Math.abs(p.entry - p.stop);
      if (!risk) return null;
      const rr = Math.abs(p.t1 - p.entry) / risk;
      if (rr >= 1.45) return null; // a 1.5R target rounded to the tick is still 1.5R
      return { stance: "caution", side: "both", text: `The first target is ${r2(rr)}× the risk: below 1.5× a plan must win more than ${Math.round(100 / (1 + rr))}% of the time just to break even, before costs.` };
    },
  },
  {
    id: "event",
    topic: "st-news",
    run(f) {
      const list = Array.isArray(f.events) ? f.events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))) : [];
      const hit = list.find((e) => /result|earning|board meeting|dividend|bonus|split|agm|record date|buyback/i.test(e));
      if (!hit) return null;
      return { stance: "caution", side: "both", text: `A company event is scheduled (${hit.slice(0, 90)}): results and corporate actions can gap the price past any stop — the textbook trades smaller or stands aside into the event.` };
    },
  },
];

const STANCE_ORDER = { against: 0, caution: 1, for: 2, info: 3 };

/**
 * Every check that has something to say about these facts, and the knowledge vote.
 * @param skip  ids of checks the caller already scores: still shown, never counted
 * @returns { notes, vote (−1…+1 or null when nothing counted), long, short, cautions, voteWhy }
 */
function check(facts, { skip = [] } = {}) {
  const f = facts || {};
  const notes = [];
  for (const c of CHECKS) {
    let r = null;
    try {
      r = c.run(f);
    } catch (_) {
      r = null; // a check that cannot read its facts says nothing
    }
    if (!r || !r.text) continue;
    const directional = (r.stance === "for" || r.stance === "against") && (r.side === "long" || r.side === "short");
    notes.push({ id: c.id, topic: c.topic, title: TITLES.get(c.topic) || c.topic, stance: r.stance, side: r.side, text: r.text, weight: num(r.weight) ? r.weight : num(c.weight) ? c.weight : 1, counts: Boolean(c.counts) && directional && !skip.includes(c.id) });
  }
  let long = 0;
  let short = 0;
  for (const n of notes) {
    if (!n.counts) continue;
    const v = n.stance === "for" ? n.weight : -n.weight;
    if (n.side === "long") long += v;
    else short += v;
  }
  const counted = notes.filter((n) => n.counts);
  const vote = counted.length ? r2(clamp((long - short) / 3, -1, 1)) : null;
  // the reason in words: the counted notes that push the way the vote points, the heaviest first
  const way = num(vote) && vote !== 0 ? (vote > 0 ? "long" : "short") : null;
  const pushing = way ? counted.filter((n) => (n.side === way && n.stance === "for") || (n.side === OPPOSITE[way] && n.stance === "against")).sort((a, b) => b.weight - a.weight) : [];
  notes.sort((a, b) => STANCE_ORDER[a.stance] - STANCE_ORDER[b.stance] || Number(b.counts) - Number(a.counts) || b.weight - a.weight);
  return {
    notes,
    vote,
    long: r1(long),
    short: r1(short),
    cautions: notes.filter((n) => n.stance === "caution").length,
    voteWhy: pushing.length ? `the knowledge base: ${pushing.slice(0, 2).map((n) => n.text.split(":")[0]).join("; ")}` : "",
  };
}

/** The notes as they bear on one side: what agrees, what argues against, what asks for care, the context. */
function forSide(result, side) {
  const notes = (result && result.notes) || [];
  const other = OPPOSITE[side];
  return {
    agree: notes.filter((n) => n.stance === "for" && n.side === side).concat(notes.filter((n) => n.stance === "against" && n.side === other)),
    against: notes.filter((n) => n.stance === "against" && n.side === side).concat(notes.filter((n) => n.stance === "for" && n.side === other)),
    cautions: notes.filter((n) => n.stance === "caution"),
    info: notes.filter((n) => n.stance === "info"),
  };
}

/** A short form for an engine's output or a screen: at most `limit` notes, the fields a reader needs. */
function brief(result, { limit = 6 } = {}) {
  if (!result || !result.notes.length) return null;
  return {
    vote: result.vote,
    cautions: result.cautions,
    notes: result.notes.slice(0, limit).map((n) => ({ id: n.id, topic: n.topic, title: n.title, stance: n.stance, side: n.side, text: n.text })),
  };
}

const HOW = "KNOWLEDGE CHECKS: the desk's knowledge base (the rules of the Indian market, indicators, price action, volume, strategies, risk, costs and the masters' documented methods) applied to this stock's readings now. Each check says which side it supports or argues against, or asks for care, and which topic it comes from. Weigh them with the trading-skills file and the measured records; where the desk's own measurement disagrees with a textbook rule, the measurement wins. Say which checks you relied on, and answer every check that argues against your call — never treat a rule as a promise.";

/**
 * What an AI request is given: the instructions, the checks, and the full rules of the topics behind the
 * checks that matter most (so the model reads the knowledge, not only a one-line summary of it).
 */
function forAi(result, { maxTopicChars = 2400 } = {}) {
  if (!result || !result.notes.length) return null;
  const order = [];
  for (const n of result.notes) if (n.stance !== "info" && !order.includes(n.topic)) order.push(n.topic);
  for (const n of result.notes) if (!order.includes(n.topic)) order.push(n.topic);
  const topics = [];
  let used = 0;
  for (const id of order) {
    const t = KB.ALL.find((x) => x.id === id);
    if (!t) continue;
    const text = `${t.title}: ${t.rules.join(" ")}`;
    if (used + text.length > maxTopicChars) continue;
    topics.push(text);
    used += text.length;
  }
  return {
    how: HOW,
    vote: result.vote,
    checks: result.notes.map((n) => ({ stance: n.stance, side: n.side, says: n.text, from: n.title })),
    rules: topics,
  };
}

/* ------------------------------------------------------------------------------- adapters */

/** From the live scanner's readings (market/scan.js features). */
function fromScan(f, { market = null, vix = null, plan = null } = {}) {
  if (!f) return {};
  const pv = f.pivots;
  return {
    horizon: "intraday",
    live: true,
    minsIn: f.minsIn,
    last: f.last,
    chgPct: f.chgPct,
    gapPct: f.gapPct,
    vsOpenPct: r2(pct(f.last, f.dayOpen)),
    vsVwapPct: f.vsVwapPct,
    vsVwapAtr: f.vsVwapAtr,
    rsi: f.rsi,
    adx: f.adx,
    plusDI: f.plusDI,
    minusDI: f.minusDI,
    relVol: f.relVol,
    orb: f.orb,
    rangePos: f.rangePos,
    squeeze: f.squeeze,
    cprWidthPct: pv && num(pv.cprTop) && num(pv.cprBottom) && num(f.last) && f.last > 0 ? r2((Math.abs(pv.cprTop - pv.cprBottom) / f.last) * 100) : null,
    dailyTrend: f.dailyTrend,
    rsNifty: f.rsNifty,
    market: market && num(market.score) ? market.score : null,
    vix: num(vix) ? vix : null,
    turnoverCr: f.turnoverCr,
    plan: plan || null,
  };
}

/** From the Top 10's daily and live features (market/picks.js). */
function fromPick(df, lf, ctx = {}) {
  const d = df || {};
  const l = (ctx.live && lf) || {};
  const live = Boolean(ctx.live && lf);
  return {
    horizon: "intraday",
    live,
    minsIn: live && num(ctx.minutesIn) ? ctx.minutesIn : null,
    last: num(l.last) ? l.last : d.close,
    chgPct: live ? l.changePct : null,
    gapPct: live ? l.gapPct : null,
    vsOpenPct: live ? l.vsOpenPct : null,
    vsVwapPct: live ? l.vsVwapPct : null,
    rangePos: live ? l.rangePos : null,
    relVol: live ? l.relVolNow : null,
    relVolDaily: d.relVol,
    rsi: d.rsi14,
    vsEma20: d.vsEma20,
    vsEma50: d.vsEma50,
    vsEma200: d.vsEma200,
    toHi20Pct: d.toHi20Pct,
    toLo20Pct: d.toLo20Pct,
    fromHi52Pct: d.fromHi52Pct,
    fromLo52Pct: d.fromLo52Pct,
    nr7: d.nr7,
    inside: d.inside,
    closeLoc: d.closeLoc,
    atrPct: d.atrPct,
    turnoverCr: d.turnoverCr,
    rsNifty: live && num(l.changePct) && num(ctx.niftyChangePct) ? r2(l.changePct - ctx.niftyChangePct) : null,
    market: live && ctx.tide && num(ctx.tide.score) ? ctx.tide.score : null,
  };
}

/**
 * From a stock's daily analysis (market/analyze.js): the research sheet, the AI brief's `daily` part, or
 * the analysis itself — whichever the caller has.
 * @param x { price, indicators, movingAverages, week52, liquidity, circuit, session, market, vix, plan, events }
 */
function fromDaily(x = {}) {
  const p = x.price || {};
  const ind = x.indicators || {};
  const ma = x.movingAverages || {};
  const w = x.week52 || {};
  const last = num(p.last) ? p.last : null;
  const live = Boolean(x.live);
  const ses = x.session || null;
  const minsIn = ses && typeof ses.ist === "string" && /^\d{2}:\d{2}$/.test(ses.ist) ? Number(ses.ist.slice(0, 2)) * 60 + Number(ses.ist.slice(3)) - 555 : null;
  const range = num(p.dayHigh) && num(p.dayLow) && p.dayHigh > p.dayLow ? p.dayHigh - p.dayLow : null;
  return {
    horizon: x.horizon || "swing",
    live,
    minsIn: live && num(minsIn) ? clamp(minsIn, 0, 375) : null,
    last,
    chgPct: live ? r2(pct(last, p.prevClose)) : null,
    gapPct: live ? r2(pct(p.open, p.prevClose)) : null,
    vsOpenPct: live ? r2(pct(last, p.open)) : null,
    vsVwapPct: live && num(x.vwap) ? r2(pct(last, x.vwap)) : null,
    rangePos: live && range ? r2((last - p.dayLow) / range) : null,
    rsi: ind.rsi14,
    adx: ind.adx,
    plusDI: ind.plusDI,
    minusDI: ind.minusDI,
    relVolDaily: ind.relVolume,
    vsEma20: r2(pct(last, ma.ema20)),
    vsEma50: r2(pct(last, ma.ema50)),
    vsEma200: r2(pct(last, num(ma.sma200) ? ma.sma200 : ma.ema200)),
    toHi20Pct: r2(pct(ind.high20, last)),
    toLo20Pct: r2(pct(last, ind.low20)),
    fromHi52Pct: num(w.fromHighPct) ? w.fromHighPct : r2(pct(last, w.high)),
    fromLo52Pct: num(w.fromLowPct) ? w.fromLowPct : r2(pct(last, w.low)),
    atrPct: ind.atrPct,
    turnoverCr: x.liquidity ? (num(x.liquidity.avgTurnoverCr) ? x.liquidity.avgTurnoverCr : x.liquidity.turnoverCr) : null,
    circuit: x.circuit || null,
    market: num(x.market) ? x.market : null,
    rsNifty: num(x.rsNifty) ? x.rsNifty : null,
    vix: num(x.vix) ? x.vix : null,
    plan: x.plan || null,
    events: x.events || null,
  };
}

/**
 * From the desk verdict (market/verdict.js) with its live call (market/intraday.js): what the co-pilot, the
 * AI Live analysts, the coach and the exit advisor see of a stock in the session.
 * @param market the market's tide score (−100…+100); vix the India VIX; niftyChangePct the NIFTY today
 */
function fromVerdict(v, { market = null, vix = null, niftyChangePct = null, plan = null } = {}) {
  if (!v || v.available === false) return {};
  const day = v.day && v.day.available ? v.day : null;
  const m = (day && day.movement) || {};
  const ses = day ? day.session : null;
  const live = Boolean(day && ses && ses.open);
  const minsIn = live && typeof ses.ist === "string" && /^\d{2}:\d{2}$/.test(ses.ist) ? clamp(Number(ses.ist.slice(0, 2)) * 60 + Number(ses.ist.slice(3)) - 555, 0, 375) : null;
  const last = num(m.last) ? m.last : v.last;
  const orb = live && num(m.orHigh) && num(m.orLow) && num(minsIn) ? (minsIn < 15 ? "forming" : last > m.orHigh ? "above" : last < m.orLow ? "below" : "inside") : null;
  const atr = v.movement && num(v.movement.atr) ? v.movement.atr : null;
  return {
    horizon: "intraday",
    live,
    minsIn,
    last,
    chgPct: live ? m.changePct : null,
    gapPct: live ? m.gapPct : null,
    vsOpenPct: live ? m.fromOpenPct : null,
    vsVwapPct: live ? m.vsVwapPct : null,
    rangePos: live && num(m.dayPosPct) ? r2(m.dayPosPct / 100) : null,
    relVol: live ? m.volumePace : null,
    orb,
    dailyTrend: v.direction === "bullish" ? 1 : v.direction === "bearish" ? -1 : 0,
    atrPct: atr && num(last) && last > 0 ? r2((atr / last) * 100) : null,
    circuit: v.circuit || null,
    market: num(market) ? market : null,
    vix: num(vix) ? vix : null,
    rsNifty: live && num(m.changePct) && num(niftyChangePct) ? r2(m.changePct - niftyChangePct) : null,
    plan: plan || null,
  };
}

/** The India context (market/context.js) as the facts above take it. */
function marketOf(c) {
  if (!c) return {};
  return {
    market: c.tide && num(c.tide.score) ? c.tide.score : null,
    vix: c.vix && num(c.vix.last) ? c.vix.last : c.indiaVix && num(c.indiaVix.last) ? c.indiaVix.last : null,
    niftyChangePct: c.nifty && num(c.nifty.changePct) ? c.nifty.changePct : null,
  };
}

/** From the AI brief of one stock (ai/service.js brief()): its daily reading plus the live session. */
function fromBrief(b, { horizon = "intraday", plan = null } = {}) {
  if (!b) return {};
  const d = b.daily || {};
  const lv = d.levels || {};
  const tape = b.todayTape5min && Array.isArray(b.todayTape5min.rows) ? b.todayTape5min.rows : [];
  const vwap = tape.length ? tape[tape.length - 1][6] : null;
  const m = b.indianMarket || null;
  const nifty = m && m.nifty ? m.nifty : null;
  const live = Boolean(b.price && b.price.live && b.session && b.session.open);
  const facts = fromDaily({
    horizon,
    live,
    price: b.price,
    indicators: d.indicators,
    movingAverages: lv.movingAverages,
    week52: lv.week52,
    liquidity: d.liquidity,
    circuit: b.circuit,
    session: b.session,
    vwap,
    market: m && m.tide && num(m.tide.score) ? m.tide.score : null,
    vix: m && m.indiaVix && num(m.indiaVix.last) ? m.indiaVix.last : null,
    plan,
    events: b.companyNews && b.companyNews.scheduled ? b.companyNews.scheduled : null,
  });
  if (live && nifty && num(nifty.changePct) && num(facts.chgPct)) facts.rsNifty = r2(facts.chgPct - nifty.changePct);
  if (lv.pivots && num(lv.pivots.cprTop) && num(lv.pivots.cprBottom) && num(facts.last) && facts.last > 0) facts.cprWidthPct = r2((Math.abs(lv.pivots.cprTop - lv.pivots.cprBottom) / facts.last) * 100);
  return facts;
}

/** Several sets of facts as one: a later set's value wins wherever it has one (null and undefined never do). */
function merge(...list) {
  const out = {};
  for (const f of list) for (const [k, x] of Object.entries(f || {})) if (x !== null && x !== undefined) out[k] = x;
  return out;
}

/**
 * For an AI request about a stock in the session: the checks from its verdict and the India context, with
 * the rules behind them (null when nothing speaks, or the facts cannot be read).
 */
function forVerdict(v, india = null, opts = {}) {
  try {
    return forAi(check(fromVerdict(v, { ...marketOf(india), ...opts })), { maxTopicChars: 1800 });
  } catch (_) {
    return null;
  }
}

module.exports = { CHECKS, check, forSide, brief, forAi, forVerdict, merge, fromScan, fromPick, fromDaily, fromBrief, fromVerdict, marketOf, HOW };
