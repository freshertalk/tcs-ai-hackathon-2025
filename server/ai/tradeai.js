"use strict";
// TradeAI: an agentic chat about your trading, in plain English.
//
// For each question it works like an analyst at the desk:
//   1. PLAN — which stocks and which data the question needs (positions, P&L history, a stock's
//      live call, levels, patterns, habits, measured odds, next-session outlook, the market, news).
//   2. GATHER — reads them from the desk's own engines, the broker (read-only, owner only), the
//      journal and Trade Analysis records, and the stored history. News is a web search by the
//      default model's company (or another saved one that can search) only when the question asks
//      why / for news.
//   3. ANSWER — routed by the question's words (route.js): data questions are answered INSTANTLY from
//      the desk's data with no model; every other one by the DEFAULT MODEL (Claude Sonnet 5.5 unless
//      the owner picked another on the AI page) — brief for light questions, with the full data for
//      advice, thinking longer for "deep" ones. The trader can also pick Fast or Deep. When the
//      default model fails, the AI page's fallback models are asked one at a time. If every model
//      fails (or today's limit of model answers is reached), the desk's own arithmetic answers —
//      the chat never goes down.
//
// Every model comes from the AI Engine, so it gets the owner's AI brains for "tradeai" and the core
// trading-skills rules, like every other AI feature. It can never place an order; it reads account
// data only through functions app.js hands it (this file cannot load the broker).
//
// Around the answer: SUGGESTIONS for the empty chat, picked from what the trader is most likely to
// ask now (their open positions — losers first —, pending orders, today's closed trades, watchlist
// movers, alerts close to the price, the time of day), and RELATED questions after every answer (the
// models' own follow-ups plus ones built from the stocks, levels and data the answer used).
// Conversations are kept in the database, one record each (chats.js).

const crypto = require("node:crypto");
const { askOne, team } = require("./mixture");
const { ChatStore } = require("./chats");
const { classify, instantAnswer, MODES, isKnowledgeQuestion, knowledgeAnswer } = require("./route");
const KB = require("../market/knowledge");
const KC = require("../market/situation");
const { DeskAgent } = require("./agent");
const { AttachStore, AttachError, promptBlock } = require("./attach");
const { canSee } = require("./providers");

const MAX_Q = 4000; // characters of a question (it was 1500 before files could be attached)

const SETTINGS_DOC = "ai/tradeai-settings.json";
const SPEED_DOC = "ai/tradeai-speed.json";
const ACTIVITY_DOC = "ai/tradeai-activity.json"; // every question: how it was answered, what was read, what it cost
// the thinking level: auto (by the kind of question), or the trader's own choice
const EFFORTS = ["auto", "low", "medium", "high"];
const EXITISH = /\b(exit|book|square.?off|get out|trail|stop.?loss|my stop|my target|hold|close (my|the)|sell my|cover my|average)\b/i;
// usePaid: TradeAI may use the AI model (every model is paid); paidDailyCap: model answers a day
const TRADEAI_DEFAULTS = { usePaid: true, paidDailyCap: 150, mode: "auto" };
// how much each tier may write and think, and how long it may take
const TIER = {
  fast: { maxTokens: 4000, effort: "low", timeoutSec: 45, data: 14000, rules: 1500 },
  advice: { maxTokens: 8000, effort: "low", timeoutSec: 90, data: 32000, rules: 3500 },
  deep: { maxTokens: 16000, effort: "medium", timeoutSec: 150, data: 32000, rules: 3500 },
};
const istDay = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

const MAX_MSGS = 200;
const MAX_DATA = 32000;
const MAX_RULES = 3500; // characters of the trading-skills file every question carries

const SYSTEM = `You are TradeAI, the agentic trading analyst of a private NSE (India) trading desk. One trader asks you questions about the market, about stocks and about their own open positions and results; they decide and act for themselves. You cannot place orders (the trader uses the desk's order ticket).

You are given DATA the desk gathered for this question: its engines' readings (live intraday call, daily score, levels, indicators, candlestick patterns, setups, multi-timeframe verdict, measured odds, behaviour habits, next-session outlook), the trader's positions and funds (read-only), their P&L history and journal statistics, the market's state, and sometimes a news summary. You also see the last turns of the conversation.

How to answer:
- The trader is an INTRADAY trader (MIS: in and out the same session, squared off by Zerodha at 3:12 PM in a stock that has a closing auction — every stock with futures and options, which stops trading at 3:15 PM — and at 3:25 PM in any other stock). Unless they ask about swing, delivery or the long term, every view, level, plan, stop, target and forecast is for intraday — the next minutes to hours and today's close.
- Use only the DATA. Quote the actual numbers (prices, RSI, VWAP, volume, circuit limits, support and resistance, P&L). If something you need is missing, say so plainly instead of guessing.
- Explain in simple, friendly English, like a senior trader talking to a colleague. No jargon without a few words of meaning.
- Write the answer in Markdown: a one-line direct answer first, then short sections with "### " headings when there is more than one topic, **bold** for the key numbers and words, "- " bullets, "1. " steps, and a Markdown table (| Level | Price | Note |) whenever you compare several stocks, levels, positions or days. Keep tables small (at most 6 rows, 4 columns). No code blocks, no images, no links.
- Follow the desk's trading rules you are given (the skills file) and the owner's brains.
- Cover what matters for the question: the technical picture (trend, momentum, levels, patterns such as double bottoms, VWAP, RSI, volume, buyers vs sellers, circuits) and the behavioural one (the stock's habits, and the trader's own habits from the journal when shown).
- Forecasts: give a lean (up, down or sideways) for a stated horizon, the scenarios that would confirm or cancel it, and the levels to watch. Never promise a profit, a win rate or a certainty; confidence means how well the evidence agrees.
- Actions: "corrective" ones for what is open now (a stop to respect or tighten, size to reduce, an exit to consider) and "proactive" ones (alerts to set, setups to wait for, levels to watch). Never tell the trader to remove a stop-loss or to average down a losing intraday trade.
- Follow-ups: 3 or 4 short questions the trader is most likely to ask next, specific to the stocks, levels and numbers you discussed (for example "What if SBIN closes below 799?"), never generic.
- The daily goal (DATA.goal, when shown): the trader's target is a share of the morning's margin (3% by default) and the daily stop half of it. Their known weakness: staying in a winning day for "more" until the gain, and then capital, is gone. So if the day has reached or nearly reached the target, is giving profits back, or turned red after being green, say that FIRST in one bold line with the rupee figures and tell them to book and stop. Never encourage a new trade after the target is reached or the stop is hit.
- The option chain (DATA.options, when shown) is one factor among the others: quote its PCR, the call and put walls, max pain, ATM IV and its bias, and never make it the only reason.
- The intraday plan (DATA.plan, when shown) is the desk's own plan for the next session with its measured record: build on its levels and say how strong its record is.
- The world forecast (DATA.forecast, when shown) reads GIFT Nifty (the successor of SGX Nifty), the US, Europe, Japan, Singapore, Hong Kong, Korea, China, the rupee, crude, both VIXes, FII flows, the Nifty option chain and the world-news brief into an expected Nifty open and a lean: quote its figures and their times, say which cues agree and which do not, and remember overseas cues explain only part of the Nifty's moves.
- An open position (DATA.position_SYMBOL, when shown) carries the desk's exit coach as it reads the position right now: its word (HOLD, TIGHTEN, BOOK PART, EXIT NOW), the exit pressure, the price to exit at, the stop, the next target, why leave and why stay, the P&L and its best, the order book, and the AI's exit levels that passed the desk's check. Answer for THIS position, not from a textbook: use its entry price, its size, the minutes it has been open and the minutes left to the 3:15 PM square-off. Give one plan: where to take profit (a price from the coach or the level map), where the stop belongs (never further from the price than the coach's stop), and what would make you leave at once. If the trade is losing, say how to keep the loss small; never suggest averaging it or widening the stop. If you disagree with the coach, say what it is missing.
- The tape (DATA.tape_SYMBOL): RSI on 1 and 5 minutes and any divergence, VWAP and its bands, the Bollinger bands (%B, a squeeze, a close outside), volume against the usual, momentum, 5-minute price action, the bid, the offer and who holds the order book. Quote the numbers that decide the answer.
- The level map (DATA.levels_SYMBOL): every level above and below the price with its strength, the odds of a touch before the square-off (no trend assumed) and, where the desk has measured it, how often levels of that kind have HELD (with the number of tests). Prefer a level with a record over one without; always quote the sample size and never call a level certain.
- Shared research (DATA.shared_SYMBOL): what the desk's other AI features already found on the stock, with their time and the price they were made at. Build on them instead of repeating the work; say where you agree or disagree, and discount a finding marked moved.
- What the desk has measured (DATA.learned…): counts from its own history. They are evidence with a sample size, not a promise.
- The agent's web findings (DATA.web_…): facts from outside the desk with their sources; say they come from the web.
- If the question is not about trading, answer briefly and steer back.
- The consensus forecast (DATA.forecast_SYMBOL): the desk's ONE level forecast for about 5 and 15 minutes ahead — the price, the likely band (low–high), the chance of a rise and its strength (tier), the level likely touched first above and below, and which engine leads: "blend" (the forecaster, the evidence desk, the early calls and the order book weighed together, leading because its checked record beats the forecaster alone) or "forecaster" (the blend is still proving itself). Quote its numbers with its record (checks, how often the direction was right, the average miss) — never present a band edge as a target or a forecast as a certainty.
- The refiner inside the forecast (refiner, volatility, topOfBook, offForm): the microprice (the mid-price weighted by the best bid and offer queues — where the next trades are likelier to happen than the last price), today's realized volatility against the usual and what the last days forecast for today (volatility.expected, volatility.outlook — a wild week makes a wild morning likelier), a band made from the forecast's own recent misses that keeps its stated 70% (its measured coverage beside the old band's), and an off-form alarm. Quote the refiner only as far as its record says it leads; when offForm is true, say the desk's forecasts are missing more than usual today and lower your confidence.
- The trade setup (DATA.setup): the morning's fifteen readings, measured by the desk itself and kept current — NIFTY and BANKNIFTY pivots, supports and resistances; the option chain's most OI, writing (OI added) and unwinding (OI shed) for calls and puts; PCR; max pain; India VIX; FII/DII cash flows (₹ crore); every F&O stock's futures build-up now and in the last session (long build-up, short build-up, short covering, long unwinding, with counts and the strongest names); high-delivery stocks; the F&O ban list; and a setup lean with its reasons and its measured record. DATA.setup_SYMBOL carries one stock's own build-up, ban and delivery. Use them for the market's picture and for each stock's context; a stock in the F&O ban takes no new derivative positions; quote the lean's record when you lean on it.
- Delivery (DATA.delivery_SYMBOL): NSE's published share of traded quantity taken for delivery on the last sessions (never today's — it is published after the close), its 20-session average, the trend and the reading of the last session (accumulation, distribution, speculative churn). Use it for the days' picture, not for the next five minutes.
- Deep research (DATA.research_SYMBOL): every data point the desk has on the stock in one read — the order book price by price on NSE and BSE (five bids and offers with quantities, pending buy and sell totals, the imbalance and any wall), the 15-minute forecaster's path to 30 minutes with its accuracy, the evidence desk's calls with the techniques speaking and their records, its live readings (futures open interest, the option chain, NIFTY and SENSEX, the sector, India VIX, GIFT NIFTY, Wall Street and Asia, each with whether it has proven itself), the early calls (reversal, carry-on, momentum), delivery, the world and the news. "missing" lists what could not be read — say so instead of guessing.
- When the trader asks you to research, analyse or forecast a stock (or DATA.research_SYMBOL is present), write a full research note with these "### " sections, each with the actual numbers: **Verdict** (one line: lean, strength, horizon); **Next 5 and 15 minutes** (the consensus forecast: price, band, chance of a rise, the level likely touched first, which engine leads and its record); **Buyers and sellers** (the order book on NSE and BSE: best bids and offers with quantities, pending totals, imbalance, walls; the quote's buy and sell quantity); **Price, volume and delivery** (VWAP and the distance from it, volume against usual, the recent delivery and what it says); **Indicators** (RSI on 5 minutes and daily, MACD, ADX, Supertrend, Bollinger, EMAs — what they agree on and where they conflict); **Levels and how it behaved there** (the level map with each level's measured record and touch odds); **Market and the world** (NIFTY and SENSEX trend, the sector, India VIX, GIFT NIFTY, Wall Street and Asia — only those that are open or fresh, and whether each has proven itself here); **Options and open interest**; **Risks and what would change the view** (the level that cancels it); **Plan** (entry zone, stop, targets as levels, size by risk — never an instruction to trade). Weigh a reading by its measured record: a proven technique or live reading counts more; an unproven one is context.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "datapoints", "actions", "forecast", "confidence", "followups"],
  properties: {
    answer: { type: "string", description: "The answer in Markdown: a direct first line, ### headings, **bold**, '- ' bullets, '1. ' steps, and small | tables | when comparing." },
    datapoints: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    actions: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { type: "string", enum: ["corrective", "proactive", "watch"] }, text: { type: "string" } } } },
    forecast: {
      type: "object",
      additionalProperties: false,
      required: ["lean", "horizon", "scenarios"],
      properties: { lean: { type: "string", enum: ["up", "down", "sideways", "n/a"] }, horizon: { type: "string" }, scenarios: { type: "array", items: { type: "string" } } },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    followups: { type: "array", items: { type: "string" } },
  },
};


const STOP = new Set("A I IN ON AT OF TO THE AND OR IS IT MY ME WE BE DO GO NO YES NOT FOR WITH WHAT WHY HOW WHEN WHERE WHO SHOULD COULD WOULD CAN WILL TODAY NOW BUY SELL LONG SHORT HOLD EXIT STOP LOSS PROFIT RSI VWAP NSE BSE MIS CNC ALL ANY OPEN CLOSE HIGH LOW UP DOWN TELL GIVE SHOW NEXT WEEK DAY MONTH YEAR PNL P&L SL TP ATR EMA SMA MACD ADX OI F&O FNO NIFTY BANK INDEX MARKET STOCK STOCKS SHARE SHARES TRADE TRADES POSITION POSITIONS PORTFOLIO PLEASE THANKS HI HELLO ABOUT ARE AM WAS HAS HAVE HAD THIS THAT THESE THOSE ITS OUR YOUR THEIR VS FROM BY AN AS IF SO THEN THAN ALSO JUST VERY MORE LESS MUCH MANY SOME AFTER BEFORE BETWEEN SUPPORT RESISTANCE TARGET LEVEL LEVELS TREND VOLUME PRICE NEWS RESULT RESULTS".split(" "));
const has = (q, words) => words.some((w) => q.includes(w));
// words that ask for the full research on a stock (21 Nov 2026)
const DEEP_WORDS = ["research", "analys", "analyz", "deep", "in depth", "in-depth", "everything about", "full picture", "all data", "detailed", "predict", "forecast", "next 5", "next 15", "5 min", "15 min", "5-min", "15-min", "five minutes", "fifteen minutes", "where will", "buy or sell", "should i buy", "should i sell", "good to buy", "entry", "levels for"];

/** The consensus forecast, trimmed for the model. */
function consensusBrief(v) {
  return {
    symbol: v.symbol,
    asOf: v.asOf,
    anchor: v.anchor,
    headline: v.headline,
    horizons: (v.horizons || []).map((x) => ({ key: x.key, minutesAhead: x.minutesAhead, at: x.at, price: x.price, low: x.low, high: x.high, pct: x.pct, pUp: x.pUp, lean: x.lean, tier: x.tier, leads: x.leads, refined: x.refined || false, refiner: x.refine ? { leads: x.refine.leads, offForm: x.refine.offForm, conformalBand: x.refine.conformal, record: x.refine.record } : null, forecaster: x.forecaster, blend: x.blend, evidence: x.parts && x.parts.evidence, early: x.parts && x.parts.early && x.parts.early.read, book: x.parts && x.parts.book, record: x.record })),
    firstUp: v.firstUp,
    firstDown: v.firstDown,
    volatility: v.volatility || null,
    topOfBook: v.topOfBook || null,
    offForm: Boolean(v.offForm),
  };
}

/** The research dossier, without what the stock's snapshot and the forecast already carry. */
function researchBrief(d, withSnapshot) {
  const { consensus, delivery, ...rest } = d;
  if (withSnapshot) {
    delete rest.session;
    delete rest.daily;
    delete rest.habits;
    delete rest.market;
  }
  return rest;
}
const short = (x, n = 600) => {
  const s = JSON.stringify(x);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);

class TradeAI {
  constructor(ai) {
    this.ai = ai;
    this.account = null; // set by app.js: read-only { positions, funds, history, orders, today }
    this.jobs = new Map();
    this.chats = new ChatStore(ai.docs); // every conversation is its own record in the database
    this.attach = new AttachStore({ now: () => ai.now() }); // files attached to questions (attach.js)
    this._reuse = new Map(); // question key → { at, dkey, reply }: an answer reused while the question and data are unchanged
    this.desk = null; // set by app.js: read-only { reading, tape, levels, lab, learned } — the flight deck, the tape, the level learner
    this.agent = new DeskAgent(this); // decides what else to read, and reads it (agent.js)
  }

  /* -------------------------------------------------------------------- conversations */
  async list(owner, { q = "" } = {}) {
    return { convs: await this.chats.list(owner, { q }) };
  }
  async get(id, owner) {
    const c = await this.chats.need(id, owner);
    const running = [...this.jobs.values()].find((j) => j.conv === c.id && !j.finishedAt);
    // the pages get the names of the attached files, not their text
    const messages = (c.messages || []).map((m) => (m.files ? { ...m, files: m.files.map(({ text, ...f }) => f) } : m));
    return { ...c, messages, job: running ? running.id : null };
  }
  async remove(id, owner) {
    for (const j of this.jobs.values()) if (j.conv === id && j.owner === owner) j.cancelled = true;
    await this.chats.remove(id, owner);
    return this.list(owner);
  }
  async rename(id, owner, title) {
    const t = String(title || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) throw Object.assign(new Error("Give the chat a name."), { code: "invalid", status: 400 });
    const c = await this.chats.need(id, owner);
    await this.chats.put({ ...c, title: t });
    return this.list(owner);
  }
  async pin(id, owner, pinned) {
    const c = await this.chats.need(id, owner);
    await this.chats.put({ ...c, pinned: Boolean(pinned) });
    return this.list(owner);
  }

  /* ------------------------------------------------------------------------- the plan */
  async _symbols(question, known) {
    const words = String(question).toUpperCase().match(/[A-Z][A-Z0-9&-]{1,19}/g) || [];
    const cands = [...new Set(words)].filter((w) => !STOP.has(w));
    const out = [];
    let list = null;
    for (const w of cands) {
      if (known.has(w)) out.push(w);
      else {
        if (!list) {
          try {
            const ins = await this.ai.market.instruments();
            // Zerodha's list names a stock "s"; older and demo lists "symbol"
            list = new Set((ins || []).map((x) => x.s || x.symbol).filter(Boolean));
          } catch (_) {
            list = new Set();
          }
        }
        if (list.has(w)) out.push(w);
      }
      if (out.length >= 3) break;
    }
    return out;
  }

  async plan(question, { owner }) {
    const q = ` ${String(question).toLowerCase()} `;
    const known = new Set(this.ai.market.watchlist ? this.ai.market.watchlist() : []);
    let positions = [];
    if (owner && this.account) {
      try {
        positions = (await this.account.positions()).filter((p) => p.quantity !== 0);
        positions.forEach((p) => known.add(p.symbol));
      } catch (_) {
        positions = [];
      }
    }
    const symbols = await this._symbols(question, known);
    const tools = new Set();
    if (owner && (has(q, ["position", "holding", "portfolio", "my trade", "open trade", "my stock", "exposure", "margin", "fund"]) || (positions.length && !symbols.length))) tools.add("positions");
    if (owner && has(q, ["p&l", "pnl", "profit", "loss", "yesterday", "this week", "this month", "last week", "last month", "journal", "performance", "result of my", "how did i", "charges", "taxes", "brokerage", "win rate", "mistake", "habit"])) tools.add("pnl");
    if (has(q, ["market", "nifty", "tide", "vix", "sector", "overall", "today's market", "bank nifty"]) || !symbols.length) tools.add("market");
    if (has(q, ["news", " why ", "result", "earning", "announcement", "falling", "rising", "moving"])) tools.add("news");
    if (has(q, ["alert"])) tools.add("alerts");
    if (symbols.length) tools.add("snapshot");
    // a stock you hold: its position comes with it
    if (owner && positions.some((p) => symbols.includes(p.symbol))) tools.add("positions");
    if (has(q, ["forecast", "tomorrow", "next session", "next day", "predict", "will it", "target", "outlook", "where will", "expect"])) tools.add("outlook");
    // the daily goal: today's P&L against the target and stop, and the giveback guard
    if (owner && (tools.has("positions") || has(q, ["target", "goal", "how am i doing", "today", "p&l", "pnl", "profit", "loss", "greed", "giving back", "given back", "stop for"]))) tools.add("goal");
    // the option chain: asked for, or a stock question where it is one more factor
    if (has(q, ["option", "pcr", "put call", "put-call", "max pain", "open interest", " oi ", "call wall", "put wall", "expiry"]) || (symbols.length === 1 && tools.has("outlook"))) tools.add("options");
    // the intraday plan for the next session
    if (symbols.length && has(q, ["intraday", "plan", "tomorrow", "next session", "levels for", "trade plan", "setup"])) tools.add("plan");
    // deep research (21 Nov 2026): a stock asked to be researched, analysed or forecast — every data point in one read (server/dossier.js)
    if (symbols.length && (has(q, DEEP_WORDS) || tools.has("outlook"))) tools.add("research");
    // the NSE forecast from the world: GIFT Nifty, the US, Europe, Japan, Singapore and the rest
    if (has(q, ["gift", "sgx", "global", "world", "overseas", "us market", "wall street", "nasdaq", "s&p", "dow", "nikkei", "japan", "singapore", "straits", "hang seng", "asia", "europe", "dax", "ftse", "open tomorrow", "pre-open", "preopen", "premarket", "pre-market", "market open", "will the market", "will nifty", "next week"]) || (tools.has("market") && tools.has("outlook"))) tools.add("global");
    // the Social Media page's organised news and posts (news sites, X, Reddit, NSE announcements)
    if (tools.has("news") || has(q, ["tweet", "twitter", "x post", "social", "headline", "buzz", "trending", "talked about", "rumour", "rumor", "sentiment", "reddit", "what's the news", "latest news", "market news"])) tools.add("social");
    // named: the stocks the question itself names (gathering later adds the stocks you hold to `symbols`)
    return { symbols, named: symbols.slice(), tools: [...tools], positions };
  }

  /* ------------------------------------------------------------------------- gathering */
  async _within(p, ms = 9000) {
    // a deadline for one data read inside a request (the same AbortSignal.timeout the providers
    // use) — it only cuts a slow read short; nothing in this folder starts work on a timer
    const sig = AbortSignal.timeout(ms);
    return Promise.race([p, new Promise((r) => sig.addEventListener("abort", () => r({ __timeout: true }), { once: true }))]);
  }

  async _snapshot(symbol, { outlook }) {
    const m = this.ai.market;
    const out = { symbol };
    const v = await this._within(m.verdict(symbol)).catch((e) => ({ error: e.message }));
    let q = null;
    try {
      q = (await this._within(m.quotes([symbol]), 4000)).quotes[symbol] || null;
    } catch (_) {
      q = null;
    }
    if (q) out.quote = { last: q.last, prevClose: q.prevClose, changePct: q.changePct, open: q.open, high: q.high, low: q.low, volume: q.volume, vwap: q.avgPrice, buyersQty: q.buyQty, sellersQty: q.sellQty, buyersShare: q.buyQty && q.sellQty ? Math.round((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null, upperCircuit: q.upperCircuit, lowerCircuit: q.lowerCircuit };
    if (v && !v.error && !v.__timeout && v.available !== false) {
      const day = v.day || {};
      const mv = day.movement || {};
      out.liveCall = day.available ? { state: day.state, headline: day.headline, score: day.score, threshold: day.threshold, plan: day.plan, triggers: day.triggers, earlyWarnings: (day.early || []).map((e) => e.text || e.id).slice(0, 4), vwap: mv.vwap, vsVwapPct: mv.vsVwapPct, rsi5: mv.rsi5, last15Pct: mv.m15Pct, last30Pct: mv.m30Pct, rangeUsedPct: mv.rangeUsedPct, volumePace: mv.volumePace, notes: (day.notes || []).slice(0, 4) } : { available: false, reason: day.reason };
      out.verdict = { stance: v.stance, conviction: v.conviction, convictionLabel: v.convictionLabel, summary: v.summary, frames: (v.frames || []).map((f) => ({ frame: f.frame || f.name, trend: f.label || f.trend })), swing: v.swing && { kind: v.swing.kind, headline: v.swing.headline, entry: v.swing.entry, stop: v.swing.stop, targets: v.swing.targets }, intraday: v.intraday && { long: v.intraday.long && { entry: v.intraday.long.entry, stop: v.intraday.long.stop, targets: v.intraday.long.targets }, short: v.intraday.short && { entry: v.intraday.short.entry, stop: v.intraday.short.stop, targets: v.intraday.short.targets }, preferred: v.intraday.preferred, state: v.intraday.state }, against: (v.against || []).slice(0, 5), circuit: v.circuit, movement: v.movement, warnings: v.warnings, activeSetups: v.activeSetups };
      const last = v.last;
      out.levels = (v.ladder || []).filter((l) => Number.isFinite(l.price)).sort((x, y) => Math.abs(x.price - last) - Math.abs(y.price - last)).slice(0, 14).map((l) => ({ name: l.label, price: l.price, awayPct: l.awayPct }));
    } else out.liveError = (v && (v.error || v.reason)) || (v && v.__timeout ? "timed out" : "unavailable");
    const a = await this._within(m.analysis(symbol, { chartBars: 120 })).catch((e) => ({ error: e.message }));
    if (a && !a.error && !a.__timeout && a.enoughData !== false) {
      const ind = a.indicators || {};
      out.daily = { score: a.score && { value: a.score.value, label: a.score.label }, rsi14: ind.rsi14, rsi2: ind.rsi2, macdHist: ind.macdHist, adx: ind.adx, plusDI: ind.plusDI, minusDI: ind.minusDI, stochK: ind.stochK, bbPctB: ind.bbPctB, supertrendDir: ind.supertrendDir, relVolume: ind.relVolume, atrPct: ind.atrPct, patterns: (a.patterns || []).map((x) => `${x.name} (${x.bias})`).slice(0, 6), setupsOn: (a.setups || []).filter((x) => x.triggered).map((x) => x.name), bearishEvents: (a.bearish || []).filter((x) => x.barsAgo <= 3).map((x) => x.name), cautions: (a.cautions || []).slice(0, 5), week52: a.levels && a.levels.week52, supports: a.levels && (a.levels.supports || []).slice(0, 3), resistances: a.levels && (a.levels.resistances || []).slice(0, 3), movingAverages: a.levels && a.levels.movingAverages, returns: a.returns, relative: a.relative };
    }
    try {
      const b = this.ai.market.behaviourList ? this.ai.market.behaviourList() : null;
      const prof = b && (b.profiles || b)[symbol];
      if (prof && prof.habits) out.habits = prof.habits.slice(0, 5);
    } catch (_) {
      /* no habits */
    }
    if (this.ai.market.edge) {
      const e = await this._within(Promise.resolve(this.ai.market.edge(symbol)), 6000).catch(() => null);
      if (e && !e.__timeout && e.available !== false && e.kinds) {
        const graded = [];
        for (const [kind, sides] of Object.entries(e.kinds)) for (const [side, x] of Object.entries(sides || {})) if (x && x.grade) graded.push({ kind, side, grade: x.grade, trades: x.live && x.live.n, winPct: x.live && x.live.winPct, expR: x.live && x.live.expR });
        out.odds = { graded: graded.slice(0, 4), note: graded.length ? "Measured on the days most like today; a grade is evidence, not a promise." : "No grade today: the history gives no reliable edge." };
      }
    }
    if (outlook && this.ai.ensemble) {
      const o = await this._within(this.ai.ensemble.outlook(symbol)).catch(() => null);
      if (o && o.available) out.outlook = { lean: o.lean, score: o.score, agreement: o.agreement, call: o.call, headline: o.headline, range: o.range, pivots: o.pivots, scenarios: (o.scenarios || []).slice(0, 4) };
    }
    // the knowledge base's checks on the stock now (market/situation.js): the rules of the trade read against
    // the readings above — the daily picture from the analysis, the session from the verdict — with the rules
    try {
      const vOk = v && !v.error && !v.__timeout && v.available !== false;
      const aOk = a && !a.error && !a.__timeout && a.enoughData !== false;
      const daily = aOk ? KC.fromDaily({ horizon: "intraday", price: { last: vOk ? v.last : a.price && a.price.last }, indicators: a.indicators, movingAverages: a.levels && a.levels.movingAverages, week52: a.levels && a.levels.week52, liquidity: a.liquidity, circuit: vOk ? v.circuit : null }) : null;
      const facts = KC.merge(daily, vOk ? KC.fromVerdict(v) : null);
      if (Object.keys(facts).length) out.knowledge = KC.forAi(KC.check(facts), { maxTopicChars: 1500 });
    } catch (_) {
      /* the knowledge base never stops an answer */
    }
    // the desk's own forecast for the next 5 and 15 minutes and everything it was weighed from (server/evidence.js): the call
    // with measured chances, the techniques speaking with their records, the order book, open interest, the sector, the world
    try {
      if (typeof this.ai.deskEvidence === "function") {
        const e = await this._within(this.ai.deskEvidence(symbol), 7000);
        if (e && !e.__timeout) out.deskForecastNext15min = e;
      }
    } catch (_) {
      /* the answer stands without it */
    }
    return out;
  }

  async gather(plan, { owner, onStep, only = null }) {
    const data = { asOf: new Date(this.ai.now()).toISOString(), plan: { symbols: plan.symbols, tools: plan.tools } };
    const used = [];
    const m = this.ai.market;
    const want = (t) => (only ? only.includes(t) : plan.tools.includes(t));
    const jobs = [];
    // every independent read starts at once: the slowest one sets the wait, not their sum
    if (want("market")) {
      onStep("Reading the market: Nifty, Bank Nifty, India VIX, sectors");
      jobs.push(
        this._within(m.context())
          .catch(() => null)
          .then((c) => {
            if (c && c.available) {
              data.market = { tide: c.tide && { score: c.tide.score, label: c.tide.label, summary: c.tide.summary }, vix: c.vix, sectors: (c.sectors || []).map((s) => ({ name: s.name, changePct: s.changePct })), notes: (c.notes || []).slice(0, 5) };
              used.push("market");
            } else data.market = { available: false, reason: c ? c.reason : "unavailable" };
          }),
      );
    }
    if (owner && (want("positions") || want("funds")) && this.account) {
      onStep("Reading your open positions and funds (read-only)");
      jobs.push(
        (async () => {
          try {
            const [pos, funds] = await Promise.all([plan.positions.length ? plan.positions : this.account.positions().then((x) => x.filter((p) => p.quantity !== 0)), this.account.funds().catch(() => null)]);
            data.positions = pos.slice(0, 10).map((p) => ({ symbol: p.symbol, exchange: p.exchange, product: p.product, side: p.quantity > 0 ? "long" : "short", quantity: p.quantity, average: p.average, last: p.last, pnl: r2(p.pnl), m2m: r2(p.m2m) }));
            data.funds = funds && funds.equity ? { available: funds.equity.net, used: funds.equity.used } : null;
            used.push("positions");
          } catch (e) {
            data.positions = { error: e.message };
          }
        })(),
      );
    }
    if (owner && want("goal") && this.account && this.account.goal) {
      jobs.push(
        this._within(Promise.resolve(this.account.goal()), 6000)
          .then((g) => {
            if (g && !g.__timeout && g.available) {
              data.goal = { ...g, events: (g.events || []).slice(0, 4) };
              used.push("daily goal");
            }
          })
          .catch(() => {}),
      );
    }
    if (owner && want("pnl") && this.account) {
      onStep("Reading your profit and loss history");
      jobs.push(
        Promise.resolve(this.account.history())
          .then((h) => {
            data.pnl = h;
            used.push("pnl history");
          })
          .catch((e) => {
            data.pnl = { error: e.message };
          }),
      );
    }
    if (owner && want("orders") && this.account && this.account.orders) {
      jobs.push(
        Promise.resolve(this.account.orders())
          .then((o) => {
            data.orders = o;
            used.push("orders");
          })
          .catch(() => {}),
      );
    }
    if (want("alerts")) {
      data.alerts = m.alerts().alerts.filter((a) => !a.firedAt).slice(0, 20).map((a) => ({ symbol: a.symbol, dir: a.dir, price: a.price, note: a.note }));
      used.push("alerts");
    }
    // a stock you hold comes into the question with your position
    if (Array.isArray(plan.positions)) for (const p of plan.positions.slice(0, 4)) if (want("positions") && !plan.symbols.includes(p.symbol) && (p.exchange === "NSE" || p.exchange === "BSE") && plan.symbols.length < 4) plan.symbols.push(p.symbol);
    const syms = plan.symbols.slice(0, 4);
    if (want("snapshot") || want("quote")) {
      for (const s of syms) {
        onStep(`Reading ${s}: live call, levels, indicators, patterns, habits, odds${want("outlook") ? ", outlook" : ""}`);
        jobs.push(
          (only && only.includes("quote") ? this._quoteOnly(s) : this._snapshot(s, { outlook: want("outlook") || syms.length === 1 })).then((x) => {
            data[`stock_${s}`] = x;
            used.push(s);
          }),
        );
      }
    }
    // the consensus forecast for about 5 and 15 minutes and NSE's delivery, for every stock read (the desk's own arithmetic; free)
    if ((want("snapshot") || want("forecast")) && typeof this.ai.deskConsensus === "function") {
      for (const s of syms) {
        jobs.push(
          this._within(this.ai.deskConsensus(s), 9000)
            .then((v) => {
              if (v && !v.__timeout && v.available) {
                data[`forecast_${s}`] = consensusBrief(v);
                used.push(`forecast ${s}`);
              }
            })
            .catch(() => {}),
        );
      }
    }
    // the trade setup (server/setup.js): the morning's fifteen readings, kept fresh by the desk itself — free data
    if ((want("market") || want("options") || want("research") || want("plan")) && typeof this.ai.deskSetup === "function") {
      try {
        data.setup = this.ai.deskSetup();
        used.push("trade setup");
      } catch (_) {
        /* the answer stands without it */
      }
    }
    if ((want("snapshot") || want("research") || want("forecast")) && typeof this.ai.deskSetupFor === "function") {
      for (const s of syms) {
        try {
          const t = this.ai.deskSetupFor(s);
          if (t && (t.live || t.prev || t.banned || t.highDelivery)) data[`setup_${s}`] = { buildupNow: t.live, buildupLastSession: t.prev, inFnoBan: t.banned, highDelivery: t.highDelivery };
        } catch (_) {
          /* the answer stands without it */
        }
      }
    }
    if ((want("snapshot") || want("delivery") || want("research")) && typeof this.ai.deskDelivery === "function") {
      for (const s of syms) {
        try {
          const d = this.ai.deskDelivery(s);
          if (d && d.available) {
            data[`delivery_${s}`] = { asOf: d.asOf, last: d.last, avgDelivPct: d.avgDelivPct, avgVolume: d.avgVolume, trend: d.trend, upDayShare: d.upDayShare, reading: d.reading, sessions: d.sessions.slice(0, 6).map((x) => ({ date: x.date, changePct: x.changePct, volume: x.volume, delivPct: x.delivPct })), note: d.note };
            used.push(`delivery ${s}`);
          }
        } catch (_) {
          /* the answer stands without it */
        }
      }
    }
    if (want("research") && typeof this.ai.deskDossier === "function") {
      for (const s of syms.slice(0, 2)) {
        onStep(`Deep research on ${s}: the order book on NSE and BSE, the forecasters, techniques, open interest, options, NIFTY and SENSEX, GIFT NIFTY and the world, delivery`);
        jobs.push(
          this._within(this.ai.deskDossier(s), 22000)
            .then((d) => {
              if (d && !d.__timeout) {
                data[`research_${s}`] = researchBrief(d, Boolean(want("snapshot")));
                used.push(`deep research ${s}`);
              }
            })
            .catch(() => {}),
        );
      }
    }
    if (want("options") && m.optionChain) {
      const u = syms[0] || "NIFTY 50";
      onStep(`Reading the option chain of ${u}: OI, PCR, max pain, IV`);
      jobs.push(
        this._within(m.optionChain(u), 12000)
          .then((c) => {
            if (c && !c.__timeout) {
              const { rows, ...rest } = c;
              data.options = rows ? { ...rest, rows: rows.filter((r) => Math.abs(r.strike - c.spot) / c.spot <= 0.04).map((r) => ({ strike: r.strike, ceOi: r.ce && r.ce.oi, ceOiChg: r.ce && r.ce.oiChange, ceIv: r.ce && r.ce.iv, peOi: r.pe && r.pe.oi, peOiChg: r.pe && r.pe.oiChange, peIv: r.pe && r.pe.iv })) } : rest;
              used.push(`options ${u}`);
            }
          })
          .catch(() => {}),
      );
    }
    if (want("global") && this.ai.ensemble && this.ai.ensemble.forecast) {
      onStep("Reading the world: GIFT Nifty, the US, Europe, Japan, Singapore, the rupee, crude, flows");
      jobs.push(
        this._within(this.ai.ensemble.forecast(), 12000)
          .then((f) => {
            if (f && !f.__timeout) {
              data.forecast = f;
              used.push("world markets");
            }
          })
          .catch(() => {}),
      );
    }
    const soc = this.ai.market && this.ai.market.social;
    if (want("social") && soc) {
      onStep("Reading the Social Media feed: news sites, X, Reddit and NSE announcements");
      try {
        const sig = soc.signal();
        const per = syms.slice(0, 3).map((x) => soc.forSymbol(x)).filter(Boolean);
        const latest = soc.feed({ relevant: true, limit: 8 }).items.map((it) => ({ at: it.at, source: it.sourceLabel, kind: it.type, title: it.title, summary: it.reading.summary, stocks: it.reading.symbols, impact: it.reading.impact, sentiment: it.reading.sentiment }));
        data.social = { signal: sig, stocks: per, latest, note: "Headlines and posts as published; social posts are unverified." };
        if (sig || per.length || latest.length) used.push("news & social");
      } catch (_) {
        /* the chat goes on without it */
      }
    }
    if (want("plan") && syms.length && this.ai.ensemble && this.ai.ensemble.intraday) {
      onStep(`Building the intraday plan for ${syms[0]}`);
      jobs.push(
        this._within(this.ai.ensemble.intraday(syms[0]), 15000)
          .then((x) => {
            if (x && !x.__timeout) {
              const { record, habits, ladder, ...rest } = x;
              data.plan = { ...rest, ladder: (ladder || []).slice(0, 12), habits: habits && { sessions: habits.sessions, rangePct: habits.rangePct, openingRange: habits.openingRange, firstHourExtremePct: habits.firstHourExtremePct, trendDayPct: habits.trendDayPct }, record: record && { sessions: record.sessions, lean: { trades: record.lean.trades, winRate: record.lean.winRate, avgR: record.lean.avgR, verdict: record.lean.verdict }, orb: { trades: record.orb.trades, winRate: record.orb.winRate, avgR: record.orb.avgR, verdict: record.orb.verdict } } };
              used.push(`intraday plan ${syms[0]}`);
            }
          })
          .catch(() => {}),
      );
    }
    if (want("news") && syms.length && this.ai._searchProvider && this.ai._searchProvider()) {
      onStep(`News on ${syms[0]} (a web search by the paid model; kept 30 minutes)`);
      jobs.push(
        this._within(this.ai.news(syms[0]), 90000)
          .catch(() => null)
          .then((n) => {
            if (n && n.news) {
              data.news = { symbol: syms[0], tone: n.news.tone, headline: n.news.headline, items: (n.news.items || []).slice(0, 5) };
              used.push(`news ${syms[0]}`);
            }
          }),
      );
    } else if (want("news")) data.news = { available: false, reason: "News needs a paid model with web search (Anthropic, OpenAI or Gemini key)." };
    await Promise.all(jobs);
    return { data, used };
  }

  /** Just the price of one stock: the instant answer to "what is the price of …". */
  async _quoteOnly(symbol) {
    try {
      const q = (await this._within(this.ai.market.quotes([symbol]), 4000)).quotes[symbol] || null;
      return { symbol, quote: q ? { last: q.last, prevClose: q.prevClose, changePct: q.changePct, open: q.open, high: q.high, low: q.low, volume: q.volume, vwap: q.avgPrice, buyersShare: q.buyQty && q.sellQty ? Math.round((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null, upperCircuit: q.upperCircuit, lowerCircuit: q.lowerCircuit } : null };
    } catch (_) {
      return { symbol, quote: null };
    }
  }

  /* ------------------------------------------------------------- the desk's own answer */
  fallbackAnswer(question, data, why = "The AI model did not answer just now") {
    const lines = [];
    if (Array.isArray(data.positions) && data.positions.length) {
      const tot = data.positions.reduce((s, p) => s + (p.pnl || 0), 0);
      lines.push(`You have ${data.positions.length} open position(s), P&L ₹${Math.round(tot)} in all:`);
      data.positions.forEach((p) => lines.push(`- ${p.symbol} ${p.side} ${Math.abs(p.quantity)} @ ₹${p.average} → ₹${p.last} (₹${Math.round(p.pnl)})`));
    }
    for (const k of Object.keys(data).filter((x) => x.startsWith("stock_"))) {
      const s = data[k];
      const lc = s.liveCall && s.liveCall.headline ? `live call: ${s.liveCall.headline} (score ${s.liveCall.score})` : "no live call now";
      const d = s.daily && s.daily.score ? `daily score ${s.daily.score.value} (${s.daily.score.label}), RSI ${r2(s.daily.rsi14)}` : "";
      lines.push(`- ${s.symbol}: ₹${s.live ? s.live.last : "?"}; ${lc}${d ? `; ${d}` : ""}${s.outlook ? `; next session leans ${s.outlook.lean}` : ""}.`);
    }
    // the consensus forecast, when it was read: the desk's own numbers for about 5 and 15 minutes
    for (const k of Object.keys(data).filter((x) => x.startsWith("forecast_"))) {
      const f = data[k];
      for (const h of f.horizons || []) lines.push(`- ${f.symbol} in about ${h.minutesAhead} min: ₹${h.price} (likely ₹${h.low}–₹${h.high}), chance of a rise ${Math.round((h.pUp || 0) * 100)}% — led by the ${h.leads}.`);
    }
    if (data.market && data.market.tide) lines.push(`Market: ${data.market.tide.summary || data.market.tide.label}.`);
    if (data.pnl && data.pnl.last30) lines.push(`Last 30 days: net ₹${Math.round(data.pnl.last30.net || 0)} over ${data.pnl.last30.days || 0} saved days.`);
    return {
      answer: `${why}, so this is the desk's own arithmetic.\n\n${lines.join("\n") || "There was no data for that question."}`,
      datapoints: [],
      actions: [],
      forecast: { lean: "n/a", horizon: "", scenarios: [] },
      confidence: "low",
      followups: ["How are my open positions?", "What does the market look like?"],
    };
  }

  /* --------------------------------------------------------------------------- the run */
  _clean(d) {
    const s = (x, n) => String(x === undefined || x === null ? "" : x).slice(0, n);
    return {
      answer: s(d.answer, 8000),
      datapoints: (Array.isArray(d.datapoints) ? d.datapoints : []).slice(0, 16).map((x) => ({ label: s(x.label, 60), value: s(x.value, 120) })),
      actions: (Array.isArray(d.actions) ? d.actions : []).slice(0, 8).map((x) => ({ kind: ["corrective", "proactive", "watch"].includes(x.kind) ? x.kind : "watch", text: s(x.text, 400) })),
      forecast: d.forecast && typeof d.forecast === "object" ? { lean: ["up", "down", "sideways", "n/a"].includes(d.forecast.lean) ? d.forecast.lean : "n/a", horizon: s(d.forecast.horizon, 60), scenarios: (d.forecast.scenarios || []).slice(0, 5).map((x) => s(x, 300)) } : { lean: "n/a", horizon: "", scenarios: [] },
      confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
      followups: (Array.isArray(d.followups) ? d.followups : []).slice(0, 4).map((x) => s(x, 140)),
    };
  }

  /* ------------------------------------------------------------- settings and speed */
  settings() {
    const d = (this.ai.docs && this.ai.docs.read(SETTINGS_DOC, null)) || {};
    const cap = Number(d.paidDailyCap);
    return {
      usePaid: d.usePaid === undefined ? TRADEAI_DEFAULTS.usePaid : Boolean(d.usePaid),
      paidDailyCap: Number.isFinite(cap) && cap >= 0 ? Math.min(2000, Math.round(cap)) : TRADEAI_DEFAULTS.paidDailyCap,
      mode: MODES.includes(d.mode) ? d.mode : TRADEAI_DEFAULTS.mode,
      effort: EFFORTS.includes(d.effort) ? d.effort : "auto",
      paidToday: d.paid && d.paid.day === istDay(this.ai.now()) ? d.paid.n : 0,
    };
  }
  setSettings(patch = {}) {
    const d = (this.ai.docs && this.ai.docs.read(SETTINGS_DOC, null)) || {};
    if (typeof patch.usePaid === "boolean") d.usePaid = patch.usePaid;
    if (patch.paidDailyCap !== undefined) {
      const v = Number(patch.paidDailyCap);
      if (!Number.isFinite(v) || v < 0) throw Object.assign(new Error("The daily limit must be 0 or more."), { code: "invalid", status: 400 });
      d.paidDailyCap = Math.min(2000, Math.round(v));
    }
    if (patch.mode !== undefined) {
      if (!MODES.includes(patch.mode)) throw Object.assign(new Error("Mode is auto, fast or deep."), { code: "invalid", status: 400 });
      d.mode = patch.mode;
    }
    if (patch.effort !== undefined) {
      if (!EFFORTS.includes(patch.effort)) throw Object.assign(new Error("The thinking level is auto, low, medium or high."), { code: "invalid", status: 400 });
      d.effort = patch.effort;
    }
    this.ai.docs.write(SETTINGS_DOC, d);
    return this.status();
  }
  _countPaid() {
    const d = (this.ai.docs && this.ai.docs.read(SETTINGS_DOC, null)) || {};
    const day = istDay(this.ai.now());
    d.paid = d.paid && d.paid.day === day ? { day, n: d.paid.n + 1 } : { day, n: 1 };
    this.ai.docs.write(SETTINGS_DOC, d);
  }
  /**
   * The models TradeAI may ask now: the trader's pick for this question first (when its company's key is
   * saved), then the default model and the fallbacks — none when switched off or today's limit is reached.
   */
  _models(pick = null) {
    const st = this.settings();
    if (!st.usePaid || st.paidToday >= st.paidDailyCap) return [];
    const base = team(this.ai).models;
    const chosen = this._pick(pick);
    return chosen ? [chosen, ...base.filter((m) => m.id !== chosen.id)] : base;
  }
  /** A model the trader picked in the chat, as the Engine wants it — or null when it cannot be asked. */
  _pick(pick) {
    if (!pick || typeof pick !== "object") return null;
    const provider = String(pick.provider || "");
    const model = String(pick.model || "");
    if (!provider || !model || typeof this.ai._key !== "function" || !this.ai._key(provider)) return null;
    const list = typeof this.ai.modelsFor === "function" ? this.ai.modelsFor(provider) || [] : [];
    const m = list.find((x) => x.id === model);
    if (!m) return null; // only a model the saved key is known to reach
    const company = this.choices().models.find((x) => x.provider === provider);
    return { id: `${provider}|${model}`, provider, model, name: m.name || model, company: company ? company.company : provider, lead: true };
  }
  /** What the trader may choose in the chat: every model of every company whose key is saved, and the thinking levels. */
  choices() {
    let models = [];
    try {
      const st = typeof this.ai.status === "function" ? this.ai.status() : null;
      const def = st && st.defaultModel ? `${st.defaultModel.provider}|${st.defaultModel.model}` : "";
      models = ((st && st.providers) || [])
        .filter((p) => p.configured)
        .flatMap((p) => (p.models || []).slice(0, 10).map((m) => ({ provider: p.id, model: m.id, name: m.name || m.id, company: p.name, isDefault: `${p.id}|${m.id}` === def })));
    } catch (_) {
      models = [];
    }
    return {
      models,
      efforts: [
        { id: "auto", name: "Auto", text: "By the question: data questions cost nothing; advice thinks briefly with one agent step; deep questions think longer." },
        { id: "low", name: "Low", text: "One brief answer from what the desk gathered. No agent steps. The fewest tokens." },
        { id: "medium", name: "Medium", text: "The agent may read once more (the web when needed), then a considered answer." },
        { id: "high", name: "High", text: "Up to three agent steps with the full data and the web, and the model thinks hardest. The most tokens." },
      ],
    };
  }
  /** How hard the model thinks and how far the agent may go: the trader's level, or by the kind of question. */
  _level(tier, effort) {
    if (effort === "low") return { effort: "low", steps: 0, seeData: false, web: false, tier: {} };
    if (effort === "medium") return { effort: "medium", steps: 1, seeData: false, web: true, tier: { maxTokens: 8000, timeoutSec: 120, data: 32000, rules: 3500 } };
    if (effort === "high") return { effort: "high", steps: 3, seeData: true, web: true, tier: { maxTokens: 16000, timeoutSec: 180, data: 48000, rules: 3500 } };
    if (tier === "deep") return { effort: "medium", steps: 2, seeData: true, web: true, tier: {} };
    if (tier === "advice") return { effort: "low", steps: 1, seeData: false, web: false, tier: {} };
    return { effort: "low", steps: 0, seeData: false, web: false, tier: {} };
  }
  _speeds() {
    return (this.ai.docs && this.ai.docs.read(SPEED_DOC, null)) || {};
  }
  _learn(tried) {
    if (!this.ai.docs || !Array.isArray(tried) || !tried.length) return;
    const sp = this._speeds();
    for (const t of tried) {
      if (!t.id) continue;
      const o = sp[t.id] || { ms: null, n: 0, fail: 0 };
      if (t.ok) o.ms = o.ms === null ? t.ms : Math.round(o.ms * 0.7 + t.ms * 0.3);
      else o.fail = (o.fail || 0) + 1;
      o.n = (o.n || 0) + 1;
      o.name = t.name;
      sp[t.id] = o;
    }
    this.ai.docs.write(SPEED_DOC, sp);
  }
  status() {
    const st = this.settings();
    const chain = team(this.ai).models;
    const sp = this._speeds();
    return {
      ...st,
      lead: chain[0] ? { name: chain[0].name, company: chain[0].company } : null,
      // the default model first, then the fallbacks, with their measured answer time
      choices: this.choices(),
      today: this.activity({ limit: 0 }).today,
      readers: this.agent.catalogue({ owner: true, web: true }).length,
      models: chain.slice(0, 4).map((a, i) => ({ name: a.name, company: a.company, fallback: i > 0, avgSec: sp[a.id] && sp[a.id].ms !== null ? Math.round(sp[a.id].ms / 100) / 10 : null })),
    };
  }

  /** One question, answered now (used by the chat's jobs and by WhatsApp's ASK). */
  async answer(question, opts = {}) {
    const reply = await this._answer(question, opts);
    this._log(question, reply, opts);
    return reply;
  }

  /** Every question is written down: how it was answered, what was read, by which model, at what cost. */
  _log(question, reply, opts = {}) {
    if (!this.ai.docs || !reply || !reply.meta) return;
    try {
      const m = reply.meta;
      const d = this.ai.docs.read(ACTIVITY_DOC, null) || { items: [] };
      const item = {
        at: this.ai.now(),
        q: String(question || "").replace(/\s+/g, " ").trim().slice(0, 160),
        owner: Boolean(opts.owner),
        how: m.reused ? "reused" : m.tier === "instant" ? "instant" : m.engineOnly ? "desk only" : "model",
        tier: m.tier,
        intent: m.intent || null,
        effort: m.effort || null,
        model: (m.by && m.by[0]) || null,
        symbols: (m.symbols || []).slice(0, 4),
        read: (m.used || []).slice(0, 16),
        agent: m.agent ? m.agent.steps.map((x) => ({ thought: x.thought, calls: x.calls.map((c) => `${c.tool}${c.symbol ? ` ${c.symbol}` : ""}${c.ok ? "" : " (nothing)"}`) })) : [],
        tokensIn: (m.usage && m.usage.input) || 0,
        tokensOut: (m.usage && m.usage.output) || 0,
        ms: m.ms || 0,
      };
      d.items = [item, ...(Array.isArray(d.items) ? d.items : [])].slice(0, 500);
      this.ai.docs.write(ACTIVITY_DOC, d);
    } catch (_) {
      /* the log never fails an answer */
    }
  }

  /** The log, newest first, with today's totals. */
  activity({ limit = 50 } = {}) {
    const d = (this.ai.docs && this.ai.docs.read(ACTIVITY_DOC, null)) || { items: [] };
    const items = Array.isArray(d.items) ? d.items : [];
    const day = istDay(this.ai.now());
    const mine = items.filter((x) => istDay(x.at) === day);
    const count = (how) => mine.filter((x) => x.how === how).length;
    return {
      today: { questions: mine.length, instant: count("instant"), reused: count("reused"), model: count("model"), deskOnly: count("desk only"), agentSteps: mine.reduce((a, x) => a + (x.agent ? x.agent.length : 0), 0), tokensIn: mine.reduce((a, x) => a + (x.tokensIn || 0), 0), tokensOut: mine.reduce((a, x) => a + (x.tokensOut || 0), 0) },
      items: items.slice(0, Math.max(0, Math.min(200, limit))).map((x) => ({ ...x, clock: new Date(x.at + 5.5 * 3600000).toISOString().slice(0, 16).replace("T", " ") })),
    };
  }

  async _answer(question, { owner = false, history = [], onStep = () => {}, onRoute = () => {}, mode = null, fresh = false, model = null, effort = null, files = [] } = {}) {
    const q = String(question || "").trim().slice(0, MAX_Q);
    const hasFiles = files.length > 0;
    if (!q) throw Object.assign(new Error("Ask a question."), { code: "invalid", status: 400 });
    const t0 = Date.now();
    onStep("Working out what this needs");
    const plan = await this.plan(q, { owner });
    const route = classify(q, { symbols: plan.symbols, mode: mode || this.settings().mode });
    // the thinking level: this question's, else the saved one, else by the kind of question
    const saved = this.settings().effort;
    const eff = EFFORTS.includes(effort) && effort !== "auto" ? effort : saved !== "auto" ? saved : null;
    // "when should I exit?" is answered at once from the exit coach — unless the trader asked the model to think
    if (route.tier === "instant" && route.intent === "exit" && (eff === "medium" || eff === "high")) Object.assign(route, { tier: "advice", why: "You asked the model to think about it: the exit coach's reading goes to the model with the tape and the levels." });

    // 0. a question about how markets and trading work: the desk's knowledge base answers — no model
    const kbHits = KB.search(q, { limit: 3 });
    if (!hasFiles && !plan.symbols.length && kbHits.length && kbHits[0].score >= 8 && isKnowledgeQuestion(q) && route.tier !== "deep" && eff !== "medium" && eff !== "high") {
      const r = knowledgeAnswer(kbHits);
      if (r) {
        onRoute({ tier: "instant", intent: "knowledge", why: "The desk's knowledge base answers this — no model needed.", model: null });
        return { ...r, related: [], meta: { used: ["knowledge"], symbols: [], tools: ["knowledge"], by: [], mergedBy: null, fallback: false, models: [], usage: { input: 0, output: 0 }, engineOnly: true, tier: "instant", intent: "knowledge", why: "The desk's knowledge base answers this — no model needed.", ms: Date.now() - t0 } };
      }
    }

    // a question with a file is never answered from the desk's data alone: the file has to be read
    if (hasFiles && route.tier === "instant") Object.assign(route, { tier: "advice", why: "You attached a file, so the model reads it with the desk's data." });

    // 1. instant: the desk's own data answers — no model
    if (route.tier === "instant") {
      onRoute({ ...route, model: null });
      const need = { goal: ["goal", "positions"], positions: ["positions", "goal"], funds: ["funds", "goal"], orders: ["orders"], alerts: ["alerts"], exit: ["goal"], quote: ["quote"], options: ["options"], plan: ["plan"], global: ["global"], social: ["social"], levels: ["snapshot"], call: ["snapshot"], outlook: ["snapshot", "outlook"], market: ["market"], pnl: ["pnl"] }[route.intent] || [];
      const { data, used } = await this.gather(plan, { owner, onStep, only: need });
      if (route.intent === "exit") await this.agent.seed(plan, data, used, { owner, onStep, exit: true }).catch(() => []);
      const r = instantAnswer(route.intent, data, { symbol: plan.symbols[0] || "" });
      if (r) return { ...r, related: this.related(q, r, data, plan), meta: { used, symbols: plan.symbols, tools: need, by: [], mergedBy: null, fallback: false, models: [], usage: { input: 0, output: 0 }, engineOnly: true, tier: "instant", intent: route.intent, why: route.why, ms: Date.now() - t0 } };
      route.tier = route.intent === "exit" ? "advice" : "fast"; // the data was not there: the model answers with what could be read
      route.why = "The data for an instant answer was not available: one quick model answers instead.";
    }

    const { data, used } = await this.gather(plan, { owner, onStep });
    // the knowledge base's pages on the question go with the data (free): the model explains from them
    if (kbHits.length && kbHits[0].score >= 6) {
      data.knowledge = KB.searchText(q, { limit: 3, maxChars: 3000 });
      used.push("knowledge");
    }
    // free, and nearly always what matters: the exit coach, the tape and the level map of the positions
    // the question is about, and what the desk's other AI features have already found (agent.js)
    await this.agent.seed(plan, data, used, { owner, onStep, exit: route.intent === "exit" || EXITISH.test(q) }).catch(() => []);
    const level = this._level(route.tier, eff);
    const tier = { ...(TIER[route.tier] || TIER.advice), ...level.tier };
    const convo = history.slice(-6).map((m) => `${m.role === "user" ? "Trader" : "TradeAI"}: ${String(m.text).slice(0, 800)}${m.files && m.files.length ? ` [attached: ${m.files.map((f) => f.name).join(", ")}]` : ""}`).join("\n");
    // the files of the last two earlier questions stay in view for a follow-up; this question's own files come first
    const earlier = history.filter((m) => m.role === "user" && Array.isArray(m.files) && m.files.length).slice(-2).flatMap((m) => m.files.map((f) => ({ kind: "text", name: f.name, text: String(f.text || ""), truncated: Boolean(f.truncated) })));
    const filesBlock = promptBlock([...files, ...earlier]);
    const images = files.filter((f) => f.kind === "image");
    const rules = this.ai.playbook ? String(this.ai.playbook.read() || "").slice(0, Math.min(tier.rules, MAX_RULES)) : "";
    // the same question on the same data (or within three minutes, while prices tick) is answered with
    // the answer already paid for — no new AI call, and no agent step. Retry and edited questions always
    // ask again. (the models and the thinking level are in the key: another model or level asks again)
    const models = this._models(model);
    const ckey = crypto.createHash("sha256").update(JSON.stringify([q.toLowerCase().replace(/\s+/g, " "), route.tier, level.effort, level.steps, plan.symbols, history.slice(-2).map((m) => String(m.text).slice(0, 400)), owner, models.map((x) => x.id)])).digest("hex");
    const dkey = crypto.createHash("sha256").update(JSON.stringify(data, (k, v) => (k === "asOf" ? undefined : v))).digest("hex");
    const prev = this._reuse.get(ckey);
    const age = prev ? this.ai.now() - prev.at : Infinity;
    if (!fresh && !hasFiles && prev && age < 6 * 3600000 && (prev.dkey === dkey || age < 3 * 60000)) {
      onRoute({ ...route, model: null, reused: true });
      return { ...prev.reply, meta: { ...prev.reply.meta, reused: true, reusedAt: new Date(prev.at).toISOString(), sameData: prev.dkey === dkey, models: [], usage: { input: 0, output: 0 }, ms: Date.now() - t0 } };
    }
    // a picture goes only to a model that can see it — the paid fallback when the free ones cannot (the one thing free cannot do)
    let askModels = models;
    let sightNote = "";
    if (images.length) {
      const seeing = models.filter((m) => canSee(m.provider, m.model));
      if (seeing.length) askModels = seeing;
      else sightNote = `The trader attached ${images.length} image${images.length === 1 ? "" : "s"}, but no model that can see images is set up (Anthropic, OpenAI and Gemini can). Say so plainly, answer from the rest, and suggest saving one of those keys on the AI page.`;
    }
    onRoute({ ...route, model: askModels[0] ? askModels[0].name : null, effort: level.effort, steps: level.steps });
    // the agent: the model names what else it needs and the desk reads it, as many steps as the level gives
    const ag = await this.agent.run(q, { data, used, models, level, owner, history, onStep, fresh }).catch(() => ({ steps: [], usage: { input: 0, output: 0 }, tried: [] }));
    // the position, the tape, the levels and the shared research go first: a long answer is cut from the end
    const first = Object.keys(data).filter((k) => /^(position|forecast|tape|levels|shared|research)_/.test(k));
    const ordered = { asOf: data.asOf, plan: data.plan };
    for (const k of first) ordered[k] = data[k];
    for (const k of Object.keys(data)) if (ordered[k] === undefined) ordered[k] = data[k];
    let json = JSON.stringify(ordered);
    const cap = Math.min(tier.data, Math.max(MAX_DATA, level.tier.data || 0));
    if (json.length > cap) json = `${json.slice(0, cap)}…(cut)`;
    const user = `${rules ? `THE DESK'S TRADING RULES (the skills file every AI feature reads, first part):\n${rules}\n\n` : ""}${convo ? `The conversation so far:\n${convo}\n\n` : ""}${filesBlock ? `${filesBlock}\n\n` : ""}${sightNote ? `NOTE: ${sightNote}\n\n` : ""}${images.length && !sightNote ? `The trader attached ${images.length} image${images.length === 1 ? "" : "s"} (below): read ${images.length === 1 ? "it" : "them"} with the data.\n\n` : ""}DATA (gathered now):\n${json}\n\nThe trader asks: ${q}`;
    // what this answer is about, for the shared research: the first stock of the question — or nothing
    const s0 = (plan.named || plan.symbols)[0] || "";
    const lastOf = s0 ? (data[`position_${s0}`] && data[`position_${s0}`].numbers ? data[`position_${s0}`].numbers.last : data[`stock_${s0}`] && data[`stock_${s0}`].quote ? data[`stock_${s0}`].quote.last : null) : null;
    const r = askModels.length ? await askOne(this.ai, askModels, { ...(images.length && !sightNote ? { images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })) } : {}), system: SYSTEM, user, schema: SCHEMA, maxTokens: tier.maxTokens, effort: level.effort, timeoutSec: tier.timeoutSec, onStep, fresh, subject: s0 ? { symbol: s0, last: lastOf } : { none: true } }) : { data: null, by: [], mergedBy: null, tried: [], fallback: false, usage: { input: 0, output: 0 } };
    const tried = [...ag.tried, ...(r.tried || [])];
    this._learn(tried);
    if (tried.some((t) => t.ok && !t.cached)) this._countPaid();
    const usage = { input: (r.usage ? r.usage.input : 0) + ag.usage.input, output: (r.usage ? r.usage.output : 0) + ag.usage.output };
    const st = this.settings();
    const why = models.length ? "The AI model did not answer just now" : !st.usePaid ? "TradeAI's AI model is switched off (TradeAI settings)" : st.paidToday >= st.paidDailyCap ? `Today's limit of ${st.paidDailyCap} model answers is reached (TradeAI settings)` : "No AI key is saved — the default model is Claude Sonnet 5.5; save the Anthropic key on the AI page";
    const ai = r.data ? this._clean(r.data) : this.fallbackAnswer(q, data, why);
    const out = { ...ai, related: this.related(q, ai, data, plan), meta: { used, symbols: plan.symbols, tools: plan.tools, by: r.by, mergedBy: r.mergedBy, fallback: r.fallback, models: r.tried, usage, engineOnly: !r.data, tier: route.tier, intent: route.intent || null, why: route.why, effort: level.effort, agent: { steps: ag.steps, allowed: level.steps }, picked: this._pick(model) ? models[0].name : null, ms: Date.now() - t0 } };
    if (r.data && !hasFiles) {
      this._reuse.set(ckey, { at: this.ai.now(), dkey, reply: out });
      if (this._reuse.size > 200) this._reuse.delete(this._reuse.keys().next().value);
    }
    return out;
  }

  /* ------------------------------------------------------------ related questions */
  /**
   * After every answer: the questions the trader is most likely to ask next — the models' own
   * follow-ups first, then ones built from the stocks, levels and data the answer used.
   */
  related(question, reply, data, plan) {
    const q = String(question).toLowerCase();
    const out = [];
    const add = (t) => {
      const text = String(t || "").trim();
      if (!text || text.length > 140) return;
      const k = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (k === q.replace(/[^a-z0-9]/g, "") || out.some((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === k)) return;
      out.push(text);
    };
    (reply.followups || []).forEach(add);
    const pos = new Map((Array.isArray(data.positions) ? data.positions : []).map((p) => [p.symbol, p]));
    for (const sym of (plan.symbols || []).slice(0, 2)) {
      const st = data[`stock_${sym}`] || {};
      const last = st.quote && st.quote.last;
      // the nearest levels at least 0.15% away: a level a tick from the price is no question
      const below = (st.levels || []).filter((l) => Number.isFinite(l.price) && last && l.price < last * 0.9985).sort((a, b) => b.price - a.price)[0];
      const above = (st.levels || []).filter((l) => Number.isFinite(l.price) && last && l.price > last * 1.0015).sort((a, b) => a.price - b.price)[0];
      const p = pos.get(sym);
      if (p) {
        const side = p.side === "short" ? "short" : "long";
        const risk = side === "long" ? below : above;
        add(`Where should I trail my stop on my ${sym} ${side}?`);
        if (risk) add(`What should I do with my ${sym} ${side} if it ${side === "long" ? "falls below" : "rises above"} ${risk.name} at ₹${risk.price}?`);
      } else {
        if (above) add(`Is it worth buying ${sym} if it crosses ${above.name} at ₹${above.price}?`);
        if (below) add(`What if ${sym} falls below ${below.name} at ₹${below.price}?`);
      }
      if (!q.includes("tomorrow") && !q.includes("next")) add(`What is the outlook for ${sym} in the next session?`);
      if (!q.includes("news") && !q.includes("why")) add(`Why is ${sym} moving today — any news?`);
      if (!q.includes("habit")) add(`How does ${sym} usually behave at this time of day?`);
    }
    if ((plan.tools || []).includes("positions") && pos.size > 1) add("Which of my open positions is the riskiest right now?");
    if ((plan.tools || []).includes("pnl")) {
      add("Which mistakes cost me the most this month?");
      add("At what time of day do I trade best?");
    }
    if ((plan.tools || []).includes("market")) add("Which sectors are leading and lagging today?");
    return out.slice(0, 6);
  }

  /* ------------------------------------------------------------------ suggestions */
  /**
   * The questions the trader is most likely to ask right now, best first — from their open
   * positions (losers first), pending orders, today's closed trades, watchlist movers, alerts close
   * to the price and the time of day. Deterministic and quick: no AI is asked.
   */
  async suggest({ isOwner = false } = {}) {
    const out = [];
    const add = (text, why, kind, score, symbol = "") => out.push({ text, why, kind, score: Math.round(score), symbol });
    const now = this.ai.now();
    const ist = new Date(now + 5.5 * 3600000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const weekday = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5;
    const phase = !weekday ? "weekend" : mins < 555 ? "pre" : mins < 930 ? "live" : "post";
    const m = this.ai.market;
    const inr = (x) => `₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
    const a = isOwner ? this.account : null;

    let positions = [];
    if (a && a.positions) positions = await this._within(Promise.resolve(a.positions()), 5000).then((p) => (Array.isArray(p) ? p.filter((x) => x.quantity !== 0) : [])).catch(() => []);
    const held = new Set(positions.map((p) => p.symbol));
    for (const p of positions.slice().sort((x, y) => (x.pnl || 0) - (y.pnl || 0)).slice(0, 4)) {
      const side = p.quantity > 0 ? "long" : "short";
      const pnl = Number(p.pnl) || 0;
      const pct = p.average ? ((p.last - p.average) / p.average) * 100 * (p.quantity > 0 ? 1 : -1) : 0;
      const why = `Open ${side} · ${pnl >= 0 ? "+" : "−"}${inr(pnl)}`;
      if (pnl < 0) {
        add(`My ${p.symbol} ${side} is down ${inr(pnl)} — should I exit or hold?`, why, "position", 120 + Math.min(40, Math.abs(pct) * 10), p.symbol);
        add(`Where is the right stop-loss for my ${p.symbol} ${side} now?`, why, "position", 96, p.symbol);
      } else {
        add(`My ${p.symbol} ${side} is up ${inr(pnl)} — book profit or trail the stop?`, why, "position", 110 + Math.min(30, pct * 10), p.symbol);
        add(`What could turn ${p.symbol} against my ${side} today?`, why, "position", 84, p.symbol);
      }
    }
    if (positions.length > 1) add(`Review my ${positions.length} open positions — which needs attention first?`, `${positions.length} open positions`, "position", 105);

    if (a && a.orders) {
      const orders = await this._within(Promise.resolve(a.orders()), 4000).then((o) => (Array.isArray(o) ? o : [])).catch(() => []);
      for (const o of orders.slice(0, 2)) add(`Will my ${String(o.side || "").toLowerCase()} order for ${o.symbol}${o.price ? ` at ₹${o.price}` : ""} fill, and is it still a good idea?`, "Pending order", "order", 92, o.symbol);
    }
    if (a && a.today) {
      const trips = await this._within(Promise.resolve(a.today()), 4000).then((t) => (Array.isArray(t) ? t : [])).catch(() => []);
      if (trips.length) {
        const worst = trips.slice().sort((x, y) => (x.net || 0) - (y.net || 0))[0];
        if (worst && worst.net < 0) add(`What went wrong in my ${worst.symbol} trade today (${inr(worst.net)} loss)?`, "Closed today", "review", phase === "post" ? 98 : 78, worst.symbol);
        const net = trips.reduce((x, t) => x + (t.net || 0), 0);
        add(`Review my ${trips.length} trade${trips.length === 1 ? "" : "s"} today — what did I do well and badly?`, `Today ${net >= 0 ? "+" : "−"}${inr(net)}`, "review", phase === "post" ? 100 : 66);
      }
    }

    const wl = m.watchlist ? m.watchlist().slice(0, 40) : [];
    let quotes = {};
    if (wl.length && m.quotes) quotes = await this._within(m.quotes(wl), 4000).then((r) => (r && !r.__timeout && r.quotes) || {}).catch(() => ({}));
    const movers = Object.entries(quotes)
      .filter(([sym, q]) => q && Number.isFinite(q.changePct) && !held.has(sym))
      .sort((x, y) => Math.abs(y[1].changePct) - Math.abs(x[1].changePct))
      .slice(0, 3);
    for (const [sym, q] of movers) {
      const up = q.changePct >= 0;
      const pct = Math.abs(q.changePct).toFixed(1);
      add(up ? `${sym} is up ${pct}% — still a buy, or too late?` : `${sym} is down ${pct}% — short it, or wait for a bounce?`, `Watchlist ${up ? "+" : "−"}${pct}%`, "probable", 58 + Math.min(32, Math.abs(q.changePct) * 8), sym);
    }
    const alerts = m.alerts ? (m.alerts().alerts || []).filter((x) => !x.firedAt) : [];
    for (const al of alerts) {
      const q = quotes[al.symbol];
      if (!q || !q.last) continue;
      const away = Math.abs(((al.price - q.last) / q.last) * 100);
      if (away <= 1) add(`${al.symbol} is ${away.toFixed(2)}% from my alert at ₹${al.price} — what should I do if it hits?`, "Alert close by", "alert", 80 + (1 - away) * 15, al.symbol);
    }

    if (phase === "pre") add("What is the plan for today's open — which watchlist stocks look best?", "Before the open", "time", 70);
    if (phase === "live") add("What is the market doing right now — is it a good time to trade?", "Market open", "time", 62);
    if (phase === "post") add("Which of my watchlist stocks look best for tomorrow?", "After the close", "time", 68);
    if (phase === "weekend") add("What should I expect from the market next week?", "Weekend", "time", 72);
    if (isOwner) add("How did my trading go this month, and what should I fix?", "Your results", "review", phase === "weekend" ? 74 : 50);
    add("Which sectors are leading today, and which are weak?", "The market", "market", 45);
    add("Explain today's market mood in simple words", "The market", "market", 40);
    if (wl[0]) add(`Give me a plan for ${wl[0]} for the next session`, "Your watchlist", "probable", 42, wl[0]);

    const seen = new Set();
    const list = out
      .sort((x, y) => y.score - x.score)
      .filter((x) => {
        const k = x.text.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 8);
    return { suggestions: list, phase, positions: positions.length, at: new Date(now).toISOString() };
  }

  /**
   * Start a chat turn as a background job (the page polls it). With from (the index of one of your
   * earlier questions), the chat goes back to that point first: that is how "edit" and "retry" work.
   */
  async start({ conv = null, text, owner = "", isOwner = false, from = null, mode = null, model = null, effort = null, attachments = [] }) {
    const running = [...this.jobs.values()].filter((j) => !j.finishedAt).length;
    if (running >= 3) throw Object.assign(new Error("TradeAI is already answering three questions. Try again in a moment."), { code: "busy", status: 429 });
    let files = this.attach.take(owner, attachments);
    const question = String(text || "").trim().slice(0, MAX_Q) || (files.length ? "Read the attached file" + (files.length === 1 ? "" : "s") + " and tell me what matters for my trading." : "");
    if (!question) throw Object.assign(new Error("Ask a question."), { code: "invalid", status: 400 });
    const at = new Date(this.ai.now()).toISOString();
    let c = conv ? await this.chats.get(String(conv), owner) : null;
    if (conv && !c) throw Object.assign(new Error("That conversation is not there any more."), { code: "not_found", status: 404 });
    if (c && [...this.jobs.values()].some((j) => j.conv === c.id && !j.finishedAt)) throw Object.assign(new Error("This chat is still answering. Wait for it, or press Stop."), { code: "busy", status: 409 });
    if (!c) c = { id: crypto.randomBytes(8).toString("hex"), owner, title: question.replace(/\s+/g, " ").slice(0, 60), createdAt: at, updatedAt: at, pinned: false, messages: [] };
    const cut = Number.isInteger(from) && from >= 0 && from < c.messages.length && c.messages[from].role === "user" ? from : null;
    // an edit or a retry of a question that had documents keeps them (a picture was not kept)
    if (cut !== null && !files.length && Array.isArray(c.messages[cut].files)) files = c.messages[cut].files.filter((f) => f.kind === "text" && f.text).map((f) => ({ kind: "text", name: f.name, text: f.text, chars: f.chars, truncated: f.truncated }));
    if (cut !== null) c.messages = c.messages.slice(0, cut);
    // the chat keeps the files' names (and the text of the documents, for a follow-up); a picture is not kept
    c.messages.push({ id: crypto.randomBytes(5).toString("hex"), role: "user", text: question, at, ...(files.length ? { files: files.map((f) => (f.kind === "image" ? { name: f.name, kind: "image" } : { name: f.name, kind: "text", chars: f.chars, truncated: f.truncated, text: f.text.slice(0, 20000) })) } : {}) });
    c.updatedAt = at;
    await this.chats.put(c);
    const job = { id: crypto.randomBytes(6).toString("hex"), conv: c.id, owner, steps: [], startedAt: at, finishedAt: null, error: "", reply: null, cancelled: false, route: null };
    this.jobs.set(job.id, job);
    if (this.jobs.size > 40) this.jobs.delete(this.jobs.keys().next().value);
    const history = c.messages.slice(0, -1);
    const t0 = Date.now();
    // Retry or an edited question asks for a new answer: never the reused one
    this.answer(question, { owner: isOwner, history, files, fresh: from !== null || files.length > 0, mode: MODES.includes(mode) ? mode : null, model, effort: EFFORTS.includes(effort) ? effort : null, onStep: (s) => job.steps.push({ at: Date.now(), text: s }), onRoute: (r) => (job.route = r) })
      .then(async (reply) => {
        if (job.cancelled) return;
        reply.meta = { ...reply.meta, sec: Math.round((Date.now() - t0) / 100) / 10, steps: job.steps.map((x) => x.text) };
        job.reply = reply;
        const c2 = await this.chats.get(c.id, owner);
        if (!c2) return; // deleted while it was answering
        c2.messages.push({ id: crypto.randomBytes(5).toString("hex"), role: "assistant", text: reply.answer, at: new Date(this.ai.now()).toISOString(), reply });
        c2.messages = c2.messages.slice(-MAX_MSGS);
        c2.updatedAt = new Date(this.ai.now()).toISOString();
        c2.preview = String(reply.answer || "").replace(/[#*|_`>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
        await this.chats.put(c2);
      })
      .catch((err) => {
        job.error = err && err.message ? err.message : "TradeAI failed.";
      })
      .finally(() => {
        job.finishedAt = new Date(this.ai.now()).toISOString();
      });
    return { job: this.job(job.id, owner), conv: c.id };
  }

  job(id, owner = null) {
    const j = this.jobs.get(id);
    if (!j || (owner !== null && j.owner !== owner)) throw Object.assign(new Error("That answer is no longer kept."), { code: "not_found", status: 404 });
    return { id: j.id, conv: j.conv, steps: j.steps.map((s) => s.text), startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, cancelled: j.cancelled, reply: j.reply, route: j.route };
  }

  /** Stop: the answer, when it comes, is not kept (the models may still finish in the background). */
  cancel(id, owner) {
    const j = this.jobs.get(id);
    if (!j || j.owner !== owner) throw Object.assign(new Error("That answer is no longer kept."), { code: "not_found", status: 404 });
    j.cancelled = true;
    if (!j.finishedAt) j.finishedAt = new Date(this.ai.now()).toISOString();
    return this.job(id, owner);
  }
}

require("./brains").register("tradeai", SYSTEM, "TradeAI chat");

module.exports = { TradeAI, SYSTEM, SCHEMA, short, EFFORTS, MAX_Q };
