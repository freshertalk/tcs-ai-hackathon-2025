"use strict";
// Raw posts and headlines → organised information for the trading desk, by rules (no AI): which NSE
// stocks and sectors an item is about, what kind of event it is, whether it reads good or bad for the
// stock, and how much it matters for Indian markets. Then, over many items: the market's mood from the
// news, a radar of the stocks being talked about, the sectors in the news, and the alerts.
//
// It is the floor that always works. When the AI model is on, it reads the items that pass this
// filter and adds its own reading (server/ai/social.js), which is preferred where present.

const SECTORS = {
  banks: { name: "Banks & financials", words: ["bank", "banking", "nbfc", "lender", "loan", "credit growth", "deposit", "npa", "insurance", "fintech", "microfinance", "housing finance"] },
  it: { name: "IT & tech", words: ["it services", "software", "tech services", "infosys", "tcs", "wipro", "hcl tech", "deal win", "outsourcing", "ai deal", "nasdaq"] },
  pharma: { name: "Pharma & health", words: ["pharma", "drug", "usfda", "fda", "hospital", "healthcare", "vaccine", "generic"] },
  auto: { name: "Auto", words: ["auto sales", "automaker", "car sales", "two-wheeler", "two wheeler", "tractor", "ev ", "electric vehicle", "passenger vehicle"] },
  metals: { name: "Metals & mining", words: ["steel", "aluminium", "aluminum", "copper", "zinc", "iron ore", "metal", "mining", "coal"] },
  energy: { name: "Oil, gas & energy", words: ["crude", "oil price", "brent", "refin", "petrol", "diesel", "natural gas", "lng", "opec", "ongc"] },
  power: { name: "Power & renewables", words: ["power demand", "electricity", "renewable", "solar", "wind energy", "transmission", "power plant", "green hydrogen"] },
  fmcg: { name: "FMCG & consumer", words: ["fmcg", "consumer goods", "rural demand", "staples", "packaged", "retail sales"] },
  realty: { name: "Real estate", words: ["realty", "real estate", "housing sales", "property", "developer"] },
  telecom: { name: "Telecom", words: ["telecom", "tariff hike", "5g", "spectrum", "subscriber"] },
  infra: { name: "Infra & capital goods", words: ["infrastructure", "capex", "order book", "road project", "railway", "capital goods", "construction", "epc"] },
  defence: { name: "Defence", words: ["defence", "defense", "military", "missile", "drdo", "fighter jet"] },
  psu: { name: "PSU", words: ["psu", "public sector", "disinvestment", "government stake", "divestment"] },
  cement: { name: "Cement", words: ["cement"] },
  aviation: { name: "Aviation", words: ["airline", "aviation", "air traffic", "jet fuel", "atf"] },
  chemicals: { name: "Chemicals", words: ["chemical", "agrochem", "fertiliser", "fertilizer", "specialty chem"] },
};

const MARKET = ["nifty", "sensex", "nse", "bse", "stock", "shares", "share price", "market", "equity", "equities", "rbi", "repo rate", "inflation", "cpi", "wpi", "gdp", "fii", "fpi", "dii", "sebi", "ipo", "results", "earnings", "q1", "q2", "q3", "q4", "net profit", "revenue", "guidance", "order", "contract", "rating", "upgrade", "downgrade", "target price", "block deal", "bulk deal", "stake", "buyback", "dividend", "bonus", "split", "merger", "acquisition", "crude", "rupee", "fed", "rate cut", "rate hike", "tariff", "budget", "gst", "fiscal", "bond yield", "f&o", "expiry", "options", "futures", "gift nifty", "sgx nifty", "dow", "nasdaq", "s&p", "wall street", "foreign investors"];
const EVENTS = [
  ["results", ["results", "earnings", "net profit", "q1", "q2", "q3", "q4", "quarterly", "revenue", "ebitda", "margin"]],
  ["order", ["order", "contract", "bags", "wins", "deal", "tender", "letter of award"]],
  ["rating", ["upgrade", "downgrade", "target price", "rating", "brokerage", "initiates coverage", "overweight", "underweight", "outperform"]],
  ["corporate", ["dividend", "bonus", "split", "buyback", "merger", "acquisition", "demerger", "stake", "block deal", "bulk deal", "promoter", "pledge", "ipo", "listing", "qip", "fund raise", "fund raising", "raise funds", "board meeting", "board to meet", "rights issue", "ncd"]],
  ["regulatory", ["sebi", "probe", "penalty", "ban", "raid", "notice", "court", "tribunal", "nclt", "investigation", "ed ", "cbi"]],
  ["policy", ["rbi", "repo", "policy", "budget", "gst", "government", "ministry", "cabinet", "tariff", "duty", "subsidy", "pli"]],
  ["macro", ["inflation", "cpi", "wpi", "gdp", "iip", "pmi", "fii", "fpi", "dii", "rupee", "bond yield", "trade deficit", "fiscal"]],
  ["global", ["fed", "wall street", "dow", "nasdaq", "s&p", "china", "crude", "brent", "opec", "us ", "europe", "japan", "nikkei", "gift nifty", "sgx nifty"]],
  ["market", ["nifty", "sensex", "market", "rally", "sell-off", "selloff", "closing bell", "opening bell"]],
];
const POS = ["surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "gain", "gains", "rise", "rises", "climb", "beat", "beats", "record high", "all-time high", "upgrade", "upgraded", "outperform", "buy", "bullish", "wins", "bags", "order win", "approval", "approved", "profit rises", "profit jumps", "strong", "robust", "growth", "expands", "boost", "positive", "inflow", "inflows", "rate cut", "recovers", "rebound", "rebounds", "higher", "upbeat", "optimism", "green"];
const NEG = ["fall", "falls", "plunge", "plunges", "slump", "slumps", "drop", "drops", "decline", "declines", "tumble", "tumbles", "crash", "miss", "misses", "downgrade", "downgraded", "underperform", "sell", "bearish", "loss", "losses", "probe", "raid", "penalty", "ban", "fraud", "default", "sell-off", "selloff", "weak", "slowdown", "cut", "cuts", "outflow", "outflows", "rate hike", "lower", "concern", "worries", "fear", "fears", "red", "slips", "slides", "pressure", "warning", "resigns", "resignation", "lawsuit"];

// well-known names a headline uses for an NSE symbol
const ALIASES = {
  reliance: "RELIANCE", "reliance industries": "RELIANCE", ril: "RELIANCE", infosys: "INFY", tcs: "TCS", "tata consultancy": "TCS", wipro: "WIPRO", "hcl tech": "HCLTECH", "hcltech": "HCLTECH", "tech mahindra": "TECHM",
  sbi: "SBIN", "state bank": "SBIN", "hdfc bank": "HDFCBANK", "icici bank": "ICICIBANK", "axis bank": "AXISBANK", "kotak": "KOTAKBANK", "kotak mahindra": "KOTAKBANK", "indusind": "INDUSINDBK", "bajaj finance": "BAJFINANCE", "bajaj finserv": "BAJAJFINSV",
  airtel: "BHARTIARTL", "bharti airtel": "BHARTIARTL", "l&t": "LT", "larsen": "LT", itc: "ITC", "hindustan unilever": "HINDUNILVR", hul: "HINDUNILVR", "asian paints": "ASIANPAINT", "maruti": "MARUTI", "tata motors": "TATAMOTORS", "mahindra & mahindra": "M&M", "m&m": "M&M",
  "tata steel": "TATASTEEL", "jsw steel": "JSWSTEEL", hindalco: "HINDALCO", vedanta: "VEDL", "coal india": "COALINDIA", ongc: "ONGC", ntpc: "NTPC", "power grid": "POWERGRID", "adani enterprises": "ADANIENT", "adani ports": "ADANIPORTS",
  "sun pharma": "SUNPHARMA", cipla: "CIPLA", "dr reddy": "DRREDDY", "dr. reddy": "DRREDDY", "divi's": "DIVISLAB", titan: "TITAN", nestle: "NESTLEIND", "ultratech": "ULTRACEMCO", "grasim": "GRASIM", "bajaj auto": "BAJAJ-AUTO", "hero motocorp": "HEROMOTOCO", "eicher": "EICHERMOT",
  "hindustan copper": "HINDCOPPER", bel: "BEL", "bharat electronics": "BEL", hal: "HAL", "hindustan aeronautics": "HAL", irctc: "IRCTC", zomato: "ZOMATO", eternal: "ETERNAL", paytm: "PAYTM", "lic": "LICI", "life insurance corporation": "LICI",
};
// short or common symbols that are also everyday words: only matched as $SYMBOL / #SYMBOL / "SYMBOL shares"
const COMMON = new Set(["IT", "ONE", "NEW", "ALL", "CAN", "BANK", "GOOD", "BEST", "SUN", "STAR", "HOME", "CARE", "LIFE", "GOLD", "FIRST", "IDEA", "UNION", "HERO", "INDIA", "PAGE", "TATA", "OIL", "POWER", "MAX", "GAIL", "UPL", "PNB", "BEL", "HAL", "LT", "MM", "ITC", "NMDC", "SAIL", "BOB", "ACC", "LIC", "EIH", "CEAT", "MRF", "DLF", "JSW", "IRB", "NBCC", "RVNL", "ZEE", "ABB", "AWL", "BSE"]);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (t, w) => (w.endsWith(" ") ? t.includes(w) : new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(t));

/**
 * The look-up from the NSE instrument list: symbols, and company names (without "Limited"/"Ltd").
 * @param instruments [{ symbol|s, name|n }]
 */
function buildIndex(instruments = []) {
  const symbols = new Set();
  const names = new Map(); // "tata motors" → TATAMOTORS
  for (const it of instruments) {
    const sym = String(it.symbol || it.s || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9&-]{1,19}$/.test(sym)) continue;
    symbols.add(sym);
    const n = String(it.name || it.n || "").toLowerCase().replace(/\b(limited|ltd|ltd\.)\b/g, "").replace(/\s+/g, " ").trim();
    if (n && n.split(" ").length >= 2 && n.length >= 8) names.set(n, sym);
  }
  for (const [a, sym] of Object.entries(ALIASES)) names.set(a, sym);
  const nameRes = [...names.entries()].map(([n, sym]) => [new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`), sym]);
  return { symbols, nameRes };
}

function symbolsIn(raw, index, watch = []) {
  const found = new Set();
  const text = String(raw || "");
  const low = text.toLowerCase();
  for (const [re, sym] of index.nameRes) if (re.test(low)) found.add(sym);
  // explicit tickers: $SBIN, #SBIN, NSE:SBIN
  for (const m of text.matchAll(/(?:\$|#|NSE:\s?|BSE:\s?)([A-Z][A-Z0-9&-]{1,19})\b/g)) if (index.symbols.has(m[1])) found.add(m[1]);
  // upper-case words that are NSE symbols (common words only next to "shares"/"stock")
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9&-]{2,19})\b/g)) {
    const w = m[1];
    if (!index.symbols.has(w)) continue;
    if (COMMON.has(w) && !new RegExp(`\\b${esc(w)}\\b\\s+(shares|stock|share price|ltd|q[1-4])`, "i").test(text)) continue;
    found.add(w);
  }
  for (const w of watch) if (new RegExp(`\\b${esc(w)}\\b`, "i").test(text)) found.add(w.toUpperCase());
  return [...found].slice(0, 8);
}

/**
 * One item's reading by rules.
 * @returns { symbols, sectors, event, sentiment (−1…+1), relevance (0…100), terms }
 */
function enrich(item, { index = { symbols: new Set(), nameRes: [] }, watch = [], sectors: tracked = null, keywords = [] } = {}) {
  const raw = `${item.title || ""}. ${item.text || ""}`;
  const t = ` ${raw.toLowerCase()} `;
  const symbols = symbolsIn(raw, index, watch);
  const sectors = Object.entries(SECTORS)
    .filter(([id, s]) => (!tracked || !tracked.length || tracked.includes(id)) && s.words.some((w) => has(t, w)))
    .map(([id]) => id);
  const terms = MARKET.filter((w) => has(t, w));
  const kw = keywords.filter((k) => k && t.includes(String(k).toLowerCase()));
  let event = "other";
  for (const [id, words] of EVENTS) {
    if (words.some((w) => has(t, w))) {
      event = id;
      break;
    }
  }
  const tone = toneOf(t);
  const sentiment = tone.score;
  let relevance = 0;
  relevance += Math.min(40, symbols.length * 25);
  relevance += Math.min(25, terms.length * 6);
  relevance += sectors.length ? 10 : 0;
  relevance += Math.min(20, kw.length * 10);
  relevance += event !== "other" ? 10 : 0;
  if (watch.length && symbols.some((s) => watch.includes(s))) relevance += 15;
  // an announcement by a regulator or the government moves the whole market
  if (["policy", "regulatory", "macro"].includes(event) && terms.some((w) => ["rbi", "sebi", "repo rate", "inflation", "gdp", "cpi"].includes(w))) relevance += 15;
  if (tone.strong && symbols.length) relevance += 10; // "beats estimates", "SEBI probe", a 5% move named for a stock
  relevance = clamp(Math.round(relevance), 0, 100);
  // how much it may matter, from the rules alone: a strong phrase or a big move about a named stock,
  // or a market-wide policy / macro event, is high
  const big = Math.abs(tone.movePct || 0) >= 4;
  const impact = relevance >= 75 || (symbols.length && (tone.strong || big)) || (["policy", "macro"].includes(event) && relevance >= 55) ? "high" : relevance >= 45 ? "medium" : "low";
  return { symbols, sectors, event, sentiment, certainty: tone.certainty, movePct: tone.movePct, impact, relevance, terms: terms.slice(0, 8), keywords: kw };
}

/* ----------------------------------------------------------------------------- the tone */
// phrases that decide a headline's tone on their own (worth two plain words)
const POS2 = ["beats estimates", "beat estimates", "above estimates", "record profit", "profit jumps", "profit surges", "profit rises", "profit soars", "net profit up", "order win", "bags order", "bags an order", "wins order", "wins a", "upgrade to buy", "upgraded to buy", "raises target", "target raised", "raises guidance", "guidance raised", "dividend", "bonus issue", "buyback", "gets approval", "approval for", "52-week high", "all-time high", "record high", "rate cut", "cuts repo", "fii buying", "fiis buy", "net buyers", "strong demand", "margin expansion", "turns profitable"];
const NEG2 = ["misses estimates", "miss estimates", "below estimates", "profit falls", "profit drops", "profit declines", "net loss", "loss widens", "downgrade to sell", "downgraded to sell", "cuts target", "target cut", "cuts guidance", "guidance cut", "sebi probe", "sebi notice", "ed raid", "income tax raid", "fraud", "default", "pledge", "resigns", "52-week low", "rate hike", "hikes repo", "fii selling", "fiis sell", "net sellers", "stake sale", "margin pressure", "weak demand", "turns loss", "lower circuit", "show-cause"];
const NEGATE = /\b(not|no|never|fails? to|unlikely to|without)\s+(\w+\s+){0,2}$/;
const UP_MOVE = /\b(rise|rises|rose|gain|gains|gained|up|jump|jumps|jumped|surge|surges|surged|climb|climbs|climbed|rally|rallies|rallied|higher|soar|soars|soared|zoom|zooms)\s+(?:by\s+|over\s+|nearly\s+|about\s+)?(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/;
const DOWN_MOVE = /\b(fall|falls|fell|down|drop|drops|dropped|slump|slumps|slumped|decline|declines|declined|lower|tumble|tumbles|tumbled|plunge|plunges|plunged|slide|slides|slid|sink|sinks|sank|crash|crashes|crashed)\s+(?:by\s+|over\s+|nearly\s+|about\s+)?(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/;

/**
 * A headline's tone from its words: plain words count one, decisive phrases two, a word after "not",
 * "fails to"… counts the other way, and a stated move ("falls 6%") counts by its size.
 * @returns { score −1…+1, certainty 0…1 (how decisive), strong (a decisive phrase or a big move), movePct }
 */
function toneOf(t) {
  let pos = 0;
  let neg = 0;
  let strong = false;
  const at = (w) => {
    const i = t.indexOf(w);
    return i < 0 ? null : t.slice(Math.max(0, i - 30), i);
  };
  const count = (list, weight, sign) => {
    for (const w of list) {
      if (!has(t, w)) continue;
      const before = at(w);
      const flip = before !== null && NEGATE.test(before);
      if ((sign > 0) !== flip) pos += weight;
      else neg += weight;
      if (weight > 1) strong = true;
    }
  };
  count(POS2, 2, 1);
  count(NEG2, 2, -1);
  count(POS.filter((w) => !POS2.some((p) => p.includes(w))), 1, 1);
  count(NEG.filter((w) => !NEG2.some((p) => p.includes(w))), 1, -1);
  let movePct = null;
  const up = UP_MOVE.exec(t);
  const down = DOWN_MOVE.exec(t);
  if (up && (!down || up.index < down.index)) movePct = Number(up[2]);
  else if (down) movePct = -Number(down[2]);
  if (movePct !== null && Math.abs(movePct) < 60) {
    const w = Math.min(3, 1 + Math.abs(movePct) / 3);
    if (movePct > 0) pos += w;
    else neg += w;
    if (Math.abs(movePct) >= 4) strong = true;
  } else movePct = null;
  const score = Math.round(clamp((pos - neg) / (pos + neg + 1), -1, 1) * 100) / 100;
  const certainty = Math.round(clamp(Math.abs(pos - neg) / 3, 0, 1) * 100) / 100;
  return { score, certainty, strong, movePct };
}

const READ = { bullish: 1, bearish: -1, neutral: 0 };
const IMPACT_W = { high: 3, medium: 2, low: 1 };

/** The reading to use for an item: the AI's where it has read the item, the rules' otherwise. */
function readingOf(it) {
  const ai = it.ai && it.ai.relevant !== false ? it.ai : null;
  return {
    relevant: it.ai ? it.ai.relevant !== false : it.rules.relevance >= 30,
    symbols: ai && ai.symbols && ai.symbols.length ? ai.symbols : it.rules.symbols,
    sectors: ai && ai.sectors && ai.sectors.length ? ai.sectors : it.rules.sectors,
    event: ai && ai.event ? ai.event : it.rules.event,
    sentiment: ai && ai.sentiment ? READ[ai.sentiment] : it.rules.sentiment,
    impact: ai && ai.impact ? ai.impact : it.rules.impact || (it.rules.relevance >= 70 ? "high" : it.rules.relevance >= 45 ? "medium" : "low"),
    summary: ai && ai.summary ? ai.summary : "",
    by: ai ? "ai" : "rules",
  };
}

/**
 * Many items → the organised picture for the last `hours`: mood, stock radar, sectors, events, alerts.
 * Newer items weigh more (half-weight after 6 hours); higher impact weighs more.
 */
function aggregate(items, { now = Date.now(), hours = 24, watch = [] } = {}) {
  const since = now - hours * 3600000;
  const live = items.filter((it) => it.rules && Date.parse(it.at || it.seenAt) >= since).map((it) => ({ it, r: readingOf(it) })).filter((x) => x.r.relevant);
  const ageW = (it) => Math.pow(0.5, (now - Date.parse(it.at || it.seenAt)) / (6 * 3600000));
  let wsum = 0;
  let ssum = 0;
  const stocks = new Map();
  const sectors = new Map();
  for (const { it, r } of live) {
    const w = ageW(it) * (IMPACT_W[r.impact] || 1);
    wsum += w;
    ssum += w * r.sentiment;
    for (const sym of r.symbols) {
      const s = stocks.get(sym) || { symbol: sym, mentions: 0, w: 0, net: 0, top: null, topW: -1, last: null };
      s.mentions += 1;
      s.w += w;
      s.net += w * r.sentiment;
      if (w > s.topW) {
        s.top = { title: it.title, link: it.link, source: it.sourceLabel, at: it.at, summary: r.summary };
        s.topW = w;
      }
      if (!s.last || (it.at || "") > s.last) s.last = it.at;
      stocks.set(sym, s);
    }
    for (const sec of r.sectors) {
      const s = sectors.get(sec) || { id: sec, name: (SECTORS[sec] && SECTORS[sec].name) || sec, mentions: 0, w: 0, net: 0 };
      s.mentions += 1;
      s.w += w;
      s.net += w * r.sentiment;
      sectors.set(sec, s);
    }
  }
  const score = wsum ? Math.round((ssum / wsum) * 100) : 0;
  const tone = (x) => (x >= 0.2 ? "bullish" : x <= -0.2 ? "bearish" : "mixed");
  const radar = [...stocks.values()]
    .map((s) => ({ symbol: s.symbol, mentions: s.mentions, sentiment: Math.round((s.net / (s.w || 1)) * 100) / 100, tone: tone(s.net / (s.w || 1)), weight: Math.round(s.w * 100) / 100, watched: watch.includes(s.symbol), top: s.top, last: s.last }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 25);
  const heat = [...sectors.values()].map((s) => ({ id: s.id, name: s.name, mentions: s.mentions, sentiment: Math.round((s.net / (s.w || 1)) * 100) / 100, tone: tone(s.net / (s.w || 1)) })).sort((a, b) => b.mentions - a.mentions);
  // the same story from several sources is one entry, with the number of sources that carried it
  const events = stories(live.filter(({ r }) => r.impact !== "low"))
    .slice(0, 30)
    .map(({ it, r, n }) => ({ id: it.id, at: it.at, title: it.title, link: it.link, source: it.sourceLabel, sources: n, event: r.event, impact: r.impact, sentiment: r.sentiment, symbols: r.symbols, summary: r.summary }));
  const alerts = stories(live.filter(({ r }) => r.impact === "high" || (r.symbols.some((s) => watch.includes(s)) && r.impact !== "low")))
    .slice(0, 12)
    .map(({ it, r, n }) => ({ id: it.id, at: it.at, title: it.title, link: it.link, source: it.sourceLabel, sources: n, impact: r.impact, sentiment: r.sentiment, symbols: r.symbols, summary: r.summary, why: r.symbols.some((s) => watch.includes(s)) ? "a stock you watch" : `${r.impact} impact` }));
  const byKind = {};
  for (const it of items.filter((x) => Date.parse(x.at || x.seenAt) >= since)) byKind[it.type] = (byKind[it.type] || 0) + 1;
  return {
    hours,
    items: live.length,
    total: items.filter((x) => Date.parse(x.at || x.seenAt) >= since).length,
    byKind,
    aiRead: live.filter(({ r }) => r.by === "ai").length,
    mood: { score, label: score >= 20 ? "Positive" : score <= -20 ? "Negative" : "Mixed" },
    radar,
    sectors: heat,
    events,
    alerts,
  };
}

/* ------------------------------------------------------------- stories across sources */
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "as", "at", "by", "with", "from", "is", "are", "its", "it", "after", "over", "amid", "says", "said", "shares", "share", "stock", "stocks", "today", "news", "india", "indian", "ltd", "limited"]);
const wordsOf = (title) => new Set(String(title || "").toLowerCase().replace(/[^a-z0-9%.&]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w)));
function similar(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n / Math.min(a.size, b.size);
}
/**
 * Newest first, one entry per story: headlines that share most of their words (and name the same
 * stocks, if any) are the same story told by several sources. Returns [{ it, r, n }].
 */
function stories(rows) {
  const sorted = rows.slice().sort((a, b) => (b.it.at || "").localeCompare(a.it.at || ""));
  const out = [];
  for (const row of sorted.slice(0, 120)) {
    const w = wordsOf(row.it.title);
    const same = out.find((x) => similar(x.w, w) >= 0.6 && (x.r.symbols.join() === row.r.symbols.join() || !x.r.symbols.length || !row.r.symbols.length));
    if (same) {
      same.n += 1;
      if (row.r.by === "ai" && same.r.by !== "ai") Object.assign(same, { it: row.it, r: row.r });
    } else out.push({ ...row, w, n: 1 });
  }
  return out;
}

/* ------------------------------------------------------------------ the desk's brief */
const EVENT_NAME = { results: "Results", order: "Orders and deals", rating: "Broker ratings", corporate: "Corporate actions", regulatory: "Regulators", policy: "Policy", macro: "Macro data and flows", global: "Global cues", market: "The market", other: "Other" };
/**
 * The brief the desk writes from the organised picture alone — no AI, so it is always there and
 * costs nothing: the headline, the themes (the kinds of event in the news), the stocks to watch,
 * the sectors, the risks and a checklist. Same shape as the AI brief.
 */
function deskBrief(agg, items, { now = Date.now(), hours = 6 } = {}) {
  if (!agg || !agg.items) return null;
  const since = now - hours * 3600000;
  const live = items.filter((it) => it.rules && Date.parse(it.at || it.seenAt) >= since).map((it) => ({ it, r: readingOf(it) })).filter((x) => x.r.relevant);
  const dir = (tone) => (tone === "bullish" ? "up" : tone === "bearish" ? "down" : "unclear");
  const top = agg.radar.slice(0, 3).map((x) => x.symbol);
  const lead = agg.alerts[0];
  const byEvent = {};
  for (const { it, r } of live) (byEvent[r.event] = byEvent[r.event] || []).push({ it, r });
  const themes = Object.entries(byEvent)
    .filter(([k]) => k !== "other")
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([k, list]) => {
      const st = stories(list);
      const net = list.reduce((a, x) => a + x.r.sentiment, 0) / list.length;
      return { title: EVENT_NAME[k] || k, detail: `${list.length} item${list.length === 1 ? "" : "s"}, ${net >= 0.2 ? "mostly positive" : net <= -0.2 ? "mostly negative" : "mixed"} — latest: “${st[0].it.title}” (${st[0].it.sourceLabel}${st[0].n > 1 ? `, and ${st[0].n - 1} more source${st[0].n > 2 ? "s" : ""}` : ""}).` };
    });
  const social = live.filter(({ it, r }) => (it.type === "x" || it.type === "reddit") && r.symbols.length);
  const badHigh = agg.alerts.filter((a) => a.sentiment <= -0.2).slice(0, 2);
  return {
    headline: `${agg.mood.label} news mood (${agg.mood.score > 0 ? "+" : ""}${agg.mood.score}) across ${agg.items} market items${top.length ? `; most talked about: ${top.join(", ")}` : ""}${lead ? `. Top item: ${lead.title}` : ""}.`,
    mood: agg.mood.score >= 20 ? "risk_on" : agg.mood.score <= -20 ? "risk_off" : "mixed",
    themes,
    watch: agg.radar.slice(0, 6).map((x) => ({ symbol: x.symbol, direction: dir(x.tone), why: `${x.mentions} item${x.mentions === 1 ? "" : "s"}, ${x.tone}${x.top ? ` — “${x.top.title}”` : ""}` })),
    sectors: agg.sectors.slice(0, 6).map((x) => ({ sector: x.name, bias: x.tone === "bullish" ? "tailwind" : x.tone === "bearish" ? "headwind" : "watch", why: `${x.mentions} item${x.mentions === 1 ? "" : "s"} in the news, ${x.tone}.` })),
    risks: [
      ...(social.length ? [`${social.length} social post${social.length === 1 ? "" : "s"} name stocks (${[...new Set(social.flatMap((x) => x.r.symbols))].slice(0, 4).join(", ")}) — unverified until a company or exchange confirms.`] : []),
      ...badHigh.map((a) => `High-impact negative item: ${a.title} (${a.source}).`),
    ],
    checklist: [
      ...top.slice(0, 2).map((s) => `Read the latest on ${s} before trading it, and check its opening range.`),
      "Treat a single post or headline as context, never as the trigger: wait for the price to confirm.",
    ],
    by: "the desk's rules (no AI)",
    ai: false,
    at: new Date(now).toISOString(),
    items: live.length,
  };
}

module.exports = { SECTORS, buildIndex, symbolsIn, enrich, aggregate, readingOf, toneOf, stories, deskBrief };
