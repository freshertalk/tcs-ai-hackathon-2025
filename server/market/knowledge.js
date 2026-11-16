"use strict";
// The desk's intraday knowledge base: how NSE cash-equity intraday trading works and what experienced
// intraday traders widely agree on — market structure, costs, risk, time of day, the market's regime,
// choosing stocks, execution, discipline, and the classic set-ups (their rules, and when NOT to take
// them). It is written from widely published market practice and exchange rules, not from any one
// person, and it speaks for no one.
//
// Knowledge is only a starting point: every set-up here is coded in market/setups.js and MEASURED on
// this desk — live by the scanner, and every evening on the NIFTY 100's last sessions after costs
// (server/setuplab.js). Where the measurement disagrees with the textbook, the measurement wins.
//
// The AI features are handed only the topics relevant to the moment (relevant()), so the requests stay
// small. Pure data and a selector: no AI, no network, no timer.

const TOPICS = [
  {
    id: "honest-odds",
    title: "The honest odds",
    tags: ["always"],
    rules: [
      "Most intraday traders lose money. SEBI's study of the equity cash segment (July 2024, for 2022–23) found about 7 in 10 individual intraday traders made a net loss, and about 8 in 10 of those who traded more than 500 times a year.",
      "The edge, when there is one, is small and comes from discipline: few, selective trades, small fixed risk, losses cut at once, costs counted.",
      "No set-up wins every time. A set-up is worth trading only if its measured average result after costs is positive over enough trades.",
    ],
  },
  {
    id: "structure",
    title: "How the NSE session works",
    tags: ["structure"],
    rules: [
      "Pre-open 9:00–9:15 AM (orders 9:00–9:08, matching to 9:12): it sets the opening price. The normal session runs 9:15 AM – 3:30 PM.",
      "The day's official closing price is the volume-weighted average of the last 30 minutes (3:00–3:30 PM), not the last trade.",
      "Intraday (MIS) positions must be closed the same day; the broker squares them off by itself at about 3:15–3:20 PM, at whatever price is there. Be flat before that.",
      "A short sale in the cash market is intraday only.",
      "Stocks in the F&O segment have no fixed circuit (dynamic price bands that widen in steps); other stocks have fixed bands of 2%, 5%, 10% or 20%. Near a fixed circuit a stock can freeze: never enter within about 1.5% of one, never target beyond it.",
      "MIS margin is usually about 20% of the position (up to 5× leverage), more for volatile stocks. Leverage multiplies losses as fast as gains.",
    ],
  },
  {
    id: "costs",
    title: "What a trade really costs",
    tags: ["always", "costs"],
    rules: [
      "An intraday round trip on ₹1 lakh costs about ₹80 — roughly 0.08% of the position (about 0.1% on ₹50,000): a smaller move is a loss before slippage.",
      "The charges: brokerage (Zerodha: 0.03% or ₹20 an order, whichever is lower), STT 0.025% on the sell side, exchange charges, the SEBI fee, GST on brokerage and charges, and stamp duty on the buy side.",
      "So scalping for a few paise loses to costs; a set-up needs targets of several times the round-trip cost. The desk's measurements are always after these costs.",
    ],
  },
  {
    id: "risk",
    title: "Risk and position size",
    tags: ["always", "risk"],
    rules: [
      "Decide the stop before the entry, at the price where the idea is clearly wrong — behind structure (the last swing, VWAP, the opening range), not at a round percentage.",
      "Risk a small fixed part of capital per trade (commonly 0.5–1%). Quantity = money at risk ÷ (entry − stop). The stop sets the size, never the other way round.",
      "A daily loss limit (commonly 2–3% of capital, or two or three losing trades) ends the day. The desk's daily goal and risk guard enforce this.",
      "Never average down a losing intraday position, and never widen a stop after entry.",
      "Take at least 1.5× the risk as the first target; move the stop to breakeven once 1R is in hand; book part at the first target and trail the rest (VWAP, EMA 9 or Supertrend).",
    ],
  },
  {
    id: "time",
    title: "Time of day",
    tags: ["time"],
    rules: [
      "9:15–9:30 AM: the opening range forms; prices are fastest and least reliable. Watch, do not enter.",
      "9:30–11:30 AM: the cleanest trends of the day usually start here — opening-range breaks, first pullbacks, gap continuation.",
      "11:30 AM – 1:30 PM: volume thins and prices chop; breakouts fail more often. Demand stronger evidence or stand aside.",
      "1:30–2:45 PM: trends often resume (Europe opens); a second chance at the morning's leaders.",
      "After 2:45 PM: no fresh intraday entries — little time for a trade to work, and square-off flows distort the last half hour.",
    ],
  },
  {
    id: "regime",
    title: "The market's mood",
    tags: ["regime", "market"],
    rules: [
      "Trade with the market when it has a direction: on a day the NIFTY trends and breadth is lopsided (advances 2:1 or more), longs in strong stocks (or shorts in weak ones) work best; counter-trend trades need much stronger reasons.",
      "A narrow CPR (pivot range) from yesterday's prices tends to come before a trending day; a wide one before a range-bound day.",
      "India VIX high (above about 20) means wider swings: smaller size, wider stops. Very low VIX means quiet, range-bound days on which breakouts often fail.",
      "On a range day, fade the edges back to VWAP or stay out; on a trend day, buy pullbacks to VWAP or EMA 9/21 in the trend's direction.",
    ],
  },
  {
    id: "selection",
    title: "Choosing what to trade",
    tags: ["selection"],
    rules: [
      "Liquid stocks only (₹50–100 crore or more traded a day): thin stocks slip and gap through stops.",
      "Stocks 'in play' move cleanly: volume well above their usual by this time of day, a meaningful gap, news, or clear strength or weakness against the NIFTY and their sector.",
      "A daily range (ATR) of roughly 1–4% gives room for a target without being wild.",
      "Leave alone: a stock locked near a circuit, a stock on its results day (unless that is the plan), stocks in the F&O ban period, and stocks with a corporate action that distorts the gap.",
      "Relative strength leads: a stock rising while the NIFTY falls is where buyers are; a stock falling while the NIFTY rises is where sellers are.",
    ],
  },
  {
    id: "execution",
    title: "Execution",
    tags: ["execution"],
    rules: [
      "Act on a 5-minute bar's close beyond the level, not the first tick through it: single ticks fake out.",
      "Do not chase: if the price has run more than about 0.8 ATR past the trigger, wait for a pullback.",
      "Prefer limit orders and stop-loss orders placed at once; in a thin stock a market order can fill far away.",
      "Place the stop just beyond the level that would prove the idea wrong, with a little room for noise (a tenth of an ATR).",
    ],
  },
  {
    id: "discipline",
    title: "Discipline",
    tags: ["always", "discipline"],
    rules: [
      "Write the plan first: entry, stop, target, size, and what cancels it. Then follow it.",
      "Revenge trading after a loss, chasing a move already made, and trading for boredom in the midday lull are the habits that cost most (the Execution Lab measures them on your own trades).",
      "Fewer, better trades: most days offer two or three good set-ups at most. 'No trade' is a position.",
      "Keep trading and investing apart: a failed day trade is closed, never turned into an 'investment'.",
      "The long-term investors often named in India and abroad built their wealth by holding businesses for years, not by intraday trading. What carries over is capital preservation, patience, and never taking leverage you cannot survive. Zerodha's founders have often pointed publicly to the regulator's data showing that most active traders lose money, and stress small positions and risk control.",
    ],
  },
];

/** The classic set-ups as the knowledge base describes them. Their code is in market/setups.js. */
const SETUP_NOTES = {
  orb: { name: "Opening-range breakout", rules: "A 5-minute close beyond the 9:15–9:30 high (low) after 9:30, on volume above its usual, on the right side of VWAP. Stop at the middle of the range (or the bar's other end). Best in the morning, with the market's direction.", avoid: "An opening range already wider than the stock's usual daily range; a break against a clearly trending market; after about 11:30 AM." },
  "vwap-pullback": { name: "VWAP pullback in a trend", rules: "In a stock trending above VWAP (EMA 9 over EMA 21), a dip to VWAP that is bought — the bar closes back up. Stop just under VWAP or the dip's low. Mirror for shorts.", avoid: "A stock that has crossed VWAP back and forth all day (no trend); the midday lull." },
  "vwap-reclaim": { name: "VWAP reclaim (or loss)", rules: "After at least half an hour below VWAP, a close back above it on rising volume — buyers taking control. Stop under the reclaim bar. Mirror for a loss of VWAP.", avoid: "A reclaim into yesterday's high or a heavy level just above; thin volume." },
  "pd-break": { name: "Yesterday's high or low broken", rules: "A 5-minute close above yesterday's high (below its low) after 9:30, on volume, on the right side of VWAP. Stop back inside yesterday's range.", avoid: "A break far from VWAP (stretched); a market moving the other way." },
  "gap-go": { name: "Gap and go", rules: "A gap of about 0.75% or more in the stock's direction that holds through the opening range, then breaks the range high (low) before 10:30 AM. Stop under the range.", avoid: "A gap on news that is already fading; a gap against the market's direction." },
  "gap-fade": { name: "Gap fade", rules: "A gap up of about 1% or more that fails — the price falls back under the open and VWAP before 11 AM — is shorted toward yesterday's close (mirror for a gap down that recovers). Stop above the day's high.", avoid: "A gap on strong news with heavy volume holding above VWAP; a strongly trending market in the gap's direction." },
  "squeeze-break": { name: "Squeeze breakout", rules: "Bollinger bands at their narrowest for a while (energy stored), then a close outside the band on volume. Stop back inside the bands.", avoid: "A break in the midday lull; a break straight into a heavy level." },
  "trend-pullback": { name: "First pullback in a strong move", rules: "After a sharp move of two ATRs or more, a shallow pullback (two to five bars, under half the move, holding above EMA 21) that turns back up past the last bar's high. Stop under the pullback.", avoid: "A pullback deeper than half the move; a third or fourth pullback (the move is tiring)." },
  "vwap-fade": { name: "Stretched move faded to VWAP", rules: "Counter-trend: a stock 2.5 ATR or more from VWAP with RSI stretched (78+ or 22−) printing a reversal bar is faded back toward VWAP, with small size and a tight stop beyond the extreme.", avoid: "A trend day in the move's direction — stretched can stay stretched; news-driven moves." },
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The topics that matter for a situation, as compact text for an AI request. The most specific come
 * first — the set-ups in play, then the time of day and the market's mood, then risk, costs, the honest
 * odds and discipline — and whole topics are left out (never cut in the middle) once the length is used.
 * @param ctx { setups: [ids], minute (IST minutes), gapPct, question, market: { score }, tags: [...] }
 * @param maxChars  the whole block's length at most
 */
function relevant(ctx = {}, maxChars = 3500) {
  const want = new Set(["always", ...(ctx.tags || [])]);
  const m = Number.isFinite(ctx.minute) ? ctx.minute : null;
  if (m !== null) want.add("time");
  if (ctx.market) want.add("regime");
  const q = String(ctx.question || "").toLowerCase();
  if (/cost|charge|brokerage|stt|tax/.test(q)) want.add("costs");
  if (/size|risk|stop|loss|quantity/.test(q)) want.add("risk");
  if (/which stock|select|choose|pick|scan/.test(q)) want.add("selection");
  if (/order|entry|exit|execute|chase/.test(q)) want.add("execution");
  if (/vix|market|nifty|trend day|range day|regime/.test(q)) want.add("regime");
  if (/square|circuit|session|timing|pre-open|close/.test(q)) want.add("structure");
  const blocks = [];
  const ids = [...new Set(ctx.setups || [])].filter((id) => SETUP_NOTES[id]);
  const NL = String.fromCharCode(10);
  if (ids.length) blocks.push(`The set-ups in play:${NL}${ids.map((id) => `- ${SETUP_NOTES[id].name}: ${SETUP_NOTES[id].rules} Not when: ${SETUP_NOTES[id].avoid}`).join(NL)}`);
  // most specific first; the honest odds always near the top
  const order = ["honest-odds", "time", "regime", "risk", "costs", "selection", "execution", "structure", "discipline"];
  const picked = TOPICS.filter((t) => t.tags.some((x) => want.has(x)) || want.has(t.id)).sort((a, z) => order.indexOf(a.id) - order.indexOf(z.id));
  const shorts = [];
  for (const t of picked) {
    blocks.push(`${t.title}:${NL}${t.rules.map((r) => `- ${r}`).join(NL)}`);
    shorts.push(`${t.title}:${NL}- ${t.rules[0]}`);
  }
  const out = [];
  let used = 0;
  blocks.forEach((bl, k) => {
    // a topic that does not fit whole keeps its first rule, if that fits
    const short = k === 0 && ids.length ? null : shorts[ids.length ? k - 1 : k];
    const pick = used + bl.length + 2 <= maxChars ? bl : short && used + short.length + 2 <= maxChars ? short : null;
    if (pick) {
      out.push(pick);
      used += pick.length + 2;
    } else if (!out.length) {
      out.push(clip(bl, maxChars)); // the first block always goes in, shortened if it must
      used = maxChars;
    }
  });
  return out.join(NL + NL);
}

/* ------------------------------------------------------------------ the encyclopedia */
// The wider knowledge base (market/kb/): the Indian market and its rules, orders, costs and taxes,
// the indicators, price action and patterns, volume and open interest, strategies, risk, psychology,
// testing, macro and sectors, fundamentals, and the documented methods of well-known traders and
// investors. The desk's own essentials above come first.
const ENCYCLOPEDIA = [...require("./kb/market"), ...require("./kb/technical"), ...require("./kb/method"), ...require("./kb/masters")];
const ESSENTIALS = TOPICS.map((t) => ({ ...t, area: "The desk's essentials", keys: `${t.id} ${t.tags.join(" ")}` }));
const SETUP_TOPIC = { id: "setups", area: "Strategies", title: "The desk's coded set-ups", keys: "setup set-up orb vwap pullback reclaim gap fade squeeze first pullback breakout desk", rules: Object.values(SETUP_NOTES).map((x) => `${x.name}: ${x.rules} Not when: ${x.avoid}`) };
const ALL = [...ESSENTIALS, ...ENCYCLOPEDIA, SETUP_TOPIC];
const BY_ID = new Map(ALL.map((t) => [t.id, t]));
const AREAS = [...new Set(ALL.map((t) => t.area))];

const STOP = new Set("a an the and or of to in on for is are was be by with how what why when which who does do i my me it its this that at as from about explain meaning mean tell show give between vs versus can should would use used using work works".split(" "));
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9%&+.\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));

/**
 * The topics that answer a question best, scored by where the question's words appear (a phrase from the
 * topic's keywords counts most, then the title, the keywords, the text).
 * @returns [{ id, area, title, rules, score }]
 */
function search(query, { limit = 5 } = {}) {
  const q = String(query || "").toLowerCase();
  const ws = words(q);
  if (!ws.length) return [];
  const scored = ALL.map((t) => {
    const title = t.title.toLowerCase();
    const keys = String(t.keys || "").toLowerCase();
    const body = t.rules.join(" ").toLowerCase();
    let sc = 0;
    // phrases: two or three words of the question that appear together in the keywords or the title
    for (let i = 0; i < ws.length - 1; i += 1) {
      const two = `${ws[i]} ${ws[i + 1]}`;
      if (keys.includes(two) || title.includes(two)) sc += 8;
    }
    for (const w of ws) {
      // a whole word (its plural counts): "ban" must not find "bands"
      const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?(?![a-z0-9])`);
      if (re.test(title)) sc += 4;
      if (re.test(keys)) sc += 3;
      if (re.test(body)) sc += 1;
    }
    return { t, sc };
  })
    .filter((x) => x.sc >= 3)
    .sort((a, z) => z.sc - a.sc)
    .slice(0, limit);
  return scored.map(({ t, sc }) => ({ id: t.id, area: t.area, title: t.title, rules: t.rules, score: sc }));
}

/** Search results as compact text within a length (whole topics; the first rule of one that does not fit). */
function searchText(query, { limit = 5, maxChars = 5000 } = {}) {
  const NL = String.fromCharCode(10);
  const out = [];
  let used = 0;
  for (const t of search(query, { limit })) {
    const full = `${t.title} (${t.area}):${NL}${t.rules.map((r) => `- ${r}`).join(NL)}`;
    const short = `${t.title} (${t.area}):${NL}- ${t.rules[0]}`;
    const pick = used + full.length + 2 <= maxChars ? full : used + short.length + 2 <= maxChars ? short : null;
    if (!pick) continue;
    out.push(pick);
    used += pick.length + 2;
  }
  return out.join(NL + NL);
}

// What each AI feature is given with every request: a compact pack of the topics that matter to its job.
// TradeAI reads more on demand (its "playbook" reader searches the whole knowledge base).
const PACKS = {
  copilot: ["st-intraday", "ind-vwap", "vol-analysis", "st-daytypes", "risk-stops"],
  "ensemble-live": ["st-intraday", "ind-vwap", "vol-analysis", "st-daytypes", "time"],
  decision: ["pa-structure", "ind-usage", "risk-sizing", "st-news", "honest-odds"],
  exit: ["risk-stops", "risk-pyramid", "pa-levels", "psy-biases"],
  "exit-levels": ["pa-levels", "pa-pivots", "risk-stops", "vol-profile"],
  coach: ["risk-stops", "risk-pyramid", "risk-sizing", "psy-biases"],
  research: ["pa-structure", "st-swing", "ind-usage", "macro-india", "st-news"],
  "ensemble-research": ["pa-structure", "st-daytypes", "pa-gaps", "macro-india", "st-news"],
  strategist: ["pa-structure", "st-swing", "risk-sizing", "risk-stops", "ind-usage"],
  picks: ["st-swing", "macro-sectors", "macro-india", "in-data", "selection"],
  review: ["psy-biases", "psy-discipline", "risk-expectancy", "psy-routine"],
  dayreview: ["psy-biases", "psy-discipline", "risk-expectancy", "risk-stops"],
  debrief: ["psy-discipline", "risk-expectancy", "res-testing", "st-daytypes"],
  learn: ["res-testing", "risk-expectancy", "psy-discipline"],
  indices: ["in-indices", "macro-india", "pa-structure", "in-data"],
  social: ["macro-india", "macro-sectors", "st-news"],
  tradeai: ["honest-odds", "risk-sizing", "psy-discipline"],
  whatsapp: ["risk-stops", "honest-odds"],
};
const PACK_CHARS = 1800;
const packs = new Map();

/** The knowledge pack for one AI feature, as text to add to its instructions ("" for none). */
function packFor(feature) {
  if (!feature || !PACKS[feature]) return "";
  if (packs.has(feature)) return packs.get(feature);
  const NL = String.fromCharCode(10);
  let body = "";
  for (const id of PACKS[feature]) {
    const t = BY_ID.get(id);
    if (!t) continue;
    const line = `- ${t.title}: ${t.rules.slice(0, 2).join(" ")}${NL}`;
    if (body.length + line.length > PACK_CHARS) {
      const short = `- ${t.title}: ${t.rules[0]}${NL}`;
      if (body.length + short.length <= PACK_CHARS) body += short;
      continue;
    }
    body += line;
  }
  const checks = CHECKS_FEATURES.has(feature) ? `${NL}${CHECKS_RULE}${NL}` : "";
  const text = body ? `${NL}${NL}---${NL}THE DESK'S KNOWLEDGE BASE — core points for this task, from widely published market practice and the exchange's rules (where the desk's own measured records differ, the measurement wins; never treat any of it as a promise):${NL}${body}${checks}` : "";
  packs.set(feature, text);
  return text;
}

// The features whose requests carry the knowledge checks on a stock (market/situation.js), and how to use them.
// (The scanner and the Top 10 reviews explain the checks in their own instructions.)
const CHECKS_FEATURES = new Set(["copilot", "ensemble-live", "ensemble-research", "decision", "exit", "exit-levels", "coach", "research", "strategist", "tradeai"]);
const CHECKS_RULE = 'When the request carries "knowledge" or "knowledgeChecks" (the knowledge base applied to the stock\'s readings now): weigh each check as evidence beside the trading-skills file and the measured records; name the checks your answer rests on; answer every check that argues against your call, or let it lower your confidence; where a measured record disagrees with a textbook check, the measurement wins.';

/** Every topic and set-up, for the page that shows the knowledge base. */
function all() {
  return {
    topics: TOPICS.map((t) => ({ id: t.id, title: t.title, rules: t.rules })),
    setups: Object.entries(SETUP_NOTES).map(([id, s]) => ({ id, ...s })),
    areas: AREAS.map((area) => ({ area, topics: ALL.filter((t) => t.area === area).map((t) => ({ id: t.id, title: t.title, rules: t.rules })) })),
    count: ALL.length,
  };
}

module.exports = { TOPICS, SETUP_NOTES, ENCYCLOPEDIA, ALL, AREAS, PACKS, relevant, all, search, searchText, packFor };
