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
const { classify, instantAnswer, MODES } = require("./route");

const SETTINGS_DOC = "ai/tradeai-settings.json";
const SPEED_DOC = "ai/tradeai-speed.json";
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
- If the question is not about trading, answer briefly and steer back.`;

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
    this._reuse = new Map(); // question key → { at, dkey, reply }: an answer reused while the question and data are unchanged
  }

  /* -------------------------------------------------------------------- conversations */
  async list(owner, { q = "" } = {}) {
    return { convs: await this.chats.list(owner, { q }) };
  }
  async get(id, owner) {
    const c = await this.chats.need(id, owner);
    const running = [...this.jobs.values()].find((j) => j.conv === c.id && !j.finishedAt);
    return { ...c, job: running ? running.id : null };
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
    // the NSE forecast from the world: GIFT Nifty, the US, Europe, Japan, Singapore and the rest
    if (has(q, ["gift", "sgx", "global", "world", "overseas", "us market", "wall street", "nasdaq", "s&p", "dow", "nikkei", "japan", "singapore", "straits", "hang seng", "asia", "europe", "dax", "ftse", "open tomorrow", "pre-open", "preopen", "premarket", "pre-market", "market open", "will the market", "will nifty", "next week"]) || (tools.has("market") && tools.has("outlook"))) tools.add("global");
    // the Social Media page's organised news and posts (news sites, X, Reddit, NSE announcements)
    if (tools.has("news") || has(q, ["tweet", "twitter", "x post", "social", "headline", "buzz", "trending", "talked about", "rumour", "rumor", "sentiment", "reddit", "what's the news", "latest news", "market news"])) tools.add("social");
    return { symbols, tools: [...tools], positions };
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
    this.ai.docs.write(SETTINGS_DOC, d);
    return this.status();
  }
  _countPaid() {
    const d = (this.ai.docs && this.ai.docs.read(SETTINGS_DOC, null)) || {};
    const day = istDay(this.ai.now());
    d.paid = d.paid && d.paid.day === day ? { day, n: d.paid.n + 1 } : { day, n: 1 };
    this.ai.docs.write(SETTINGS_DOC, d);
  }
  /** The models TradeAI may ask now: the default model, then the fallbacks — none when switched off or today's limit is reached. */
  _models() {
    const st = this.settings();
    if (!st.usePaid || st.paidToday >= st.paidDailyCap) return [];
    return team(this.ai).models;
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
      models: chain.slice(0, 4).map((a, i) => ({ name: a.name, company: a.company, fallback: i > 0, avgSec: sp[a.id] && sp[a.id].ms !== null ? Math.round(sp[a.id].ms / 100) / 10 : null })),
    };
  }

  /** One question, answered now (used by the chat's jobs and by WhatsApp's ASK). */
  async answer(question, { owner = false, history = [], onStep = () => {}, onRoute = () => {}, mode = null, fresh = false } = {}) {
    const q = String(question || "").trim().slice(0, 1500);
    if (!q) throw Object.assign(new Error("Ask a question."), { code: "invalid", status: 400 });
    const t0 = Date.now();
    onStep("Working out what this needs");
    const plan = await this.plan(q, { owner });
    const route = classify(q, { symbols: plan.symbols, mode: mode || this.settings().mode });

    // 1. instant: the desk's own data answers — no model
    if (route.tier === "instant") {
      onRoute({ ...route, model: null });
      const need = { goal: ["goal", "positions"], positions: ["positions", "goal"], funds: ["funds", "goal"], orders: ["orders"], alerts: ["alerts"], quote: ["quote"], options: ["options"], plan: ["plan"], global: ["global"], social: ["social"], levels: ["snapshot"], call: ["snapshot"], outlook: ["snapshot", "outlook"], market: ["market"], pnl: ["pnl"] }[route.intent] || [];
      const { data, used } = await this.gather(plan, { owner, onStep, only: need });
      const r = instantAnswer(route.intent, data, { symbol: plan.symbols[0] || "" });
      if (r) return { ...r, related: this.related(q, r, data, plan), meta: { used, symbols: plan.symbols, tools: need, by: [], mergedBy: null, fallback: false, models: [], usage: { input: 0, output: 0 }, engineOnly: true, tier: "instant", intent: route.intent, why: route.why, ms: Date.now() - t0 } };
      route.tier = "fast"; // the data was not there: one quick model with what could be read
      route.why = "The data for an instant answer was not available: one quick model answers instead.";
    }

    const { data, used } = await this.gather(plan, { owner, onStep });
    const tier = TIER[route.tier] || TIER.advice;
    let json = JSON.stringify(data);
    const cap = Math.min(tier.data, MAX_DATA);
    if (json.length > cap) json = `${json.slice(0, cap)}…(cut)`;
    const convo = history.slice(-6).map((m) => `${m.role === "user" ? "Trader" : "TradeAI"}: ${String(m.text).slice(0, 800)}`).join("\n");
    const rules = this.ai.playbook ? String(this.ai.playbook.read() || "").slice(0, Math.min(tier.rules, MAX_RULES)) : "";
    const user = `${rules ? `THE DESK'S TRADING RULES (the skills file every AI feature reads, first part):\n${rules}\n\n` : ""}${convo ? `The conversation so far:\n${convo}\n\n` : ""}DATA (gathered now):\n${json}\n\nThe trader asks: ${q}`;
    // the same question on the same data (or within three minutes, while prices tick) is answered with
    // the answer already paid for — no new AI call. Retry and edited questions always ask again.
    // (the models in the key: a new default model, or the fallback switched, asks again)
    const models = this._models();
    const ckey = crypto.createHash("sha256").update(JSON.stringify([q.toLowerCase().replace(/\s+/g, " "), route.tier, plan.symbols, history.slice(-2).map((m) => String(m.text).slice(0, 400)), owner, models.map((x) => x.id)])).digest("hex");
    const dkey = crypto.createHash("sha256").update(JSON.stringify(data, (k, v) => (k === "asOf" ? undefined : v))).digest("hex");
    const prev = this._reuse.get(ckey);
    const age = prev ? this.ai.now() - prev.at : Infinity;
    if (!fresh && prev && age < 6 * 3600000 && (prev.dkey === dkey || age < 3 * 60000)) {
      onRoute({ ...route, model: null, reused: true });
      return { ...prev.reply, meta: { ...prev.reply.meta, reused: true, reusedAt: new Date(prev.at).toISOString(), sameData: prev.dkey === dkey, models: [], usage: { input: 0, output: 0 }, ms: Date.now() - t0 } };
    }
    onRoute({ ...route, model: models[0] ? models[0].name : null });
    const r = models.length ? await askOne(this.ai, models, { system: SYSTEM, user, schema: SCHEMA, maxTokens: tier.maxTokens, effort: tier.effort, timeoutSec: tier.timeoutSec, onStep, fresh }) : { data: null, by: [], mergedBy: null, tried: [], fallback: false, usage: { input: 0, output: 0 } };
    this._learn(r.tried);
    if ((r.tried || []).some((t) => t.ok && !t.cached)) this._countPaid();
    const st = this.settings();
    const why = models.length ? "The AI model did not answer just now" : !st.usePaid ? "TradeAI's AI model is switched off (TradeAI settings)" : st.paidToday >= st.paidDailyCap ? `Today's limit of ${st.paidDailyCap} model answers is reached (TradeAI settings)` : "No AI key is saved — the default model is Claude Sonnet 5.5; save the Anthropic key on the AI page";
    const ai = r.data ? this._clean(r.data) : this.fallbackAnswer(q, data, why);
    const out = { ...ai, related: this.related(q, ai, data, plan), meta: { used, symbols: plan.symbols, tools: plan.tools, by: r.by, mergedBy: r.mergedBy, fallback: r.fallback, models: r.tried, usage: r.usage, engineOnly: !r.data, tier: route.tier, why: route.why, ms: Date.now() - t0 } };
    if (r.data) {
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
  async start({ conv = null, text, owner = "", isOwner = false, from = null, mode = null }) {
    const running = [...this.jobs.values()].filter((j) => !j.finishedAt).length;
    if (running >= 3) throw Object.assign(new Error("TradeAI is already answering three questions. Try again in a moment."), { code: "busy", status: 429 });
    const question = String(text || "").trim().slice(0, 1500);
    if (!question) throw Object.assign(new Error("Ask a question."), { code: "invalid", status: 400 });
    const at = new Date(this.ai.now()).toISOString();
    let c = conv ? await this.chats.get(String(conv), owner) : null;
    if (conv && !c) throw Object.assign(new Error("That conversation is not there any more."), { code: "not_found", status: 404 });
    if (c && [...this.jobs.values()].some((j) => j.conv === c.id && !j.finishedAt)) throw Object.assign(new Error("This chat is still answering. Wait for it, or press Stop."), { code: "busy", status: 409 });
    if (!c) c = { id: crypto.randomBytes(8).toString("hex"), owner, title: question.replace(/\s+/g, " ").slice(0, 60), createdAt: at, updatedAt: at, pinned: false, messages: [] };
    const cut = Number.isInteger(from) && from >= 0 && from < c.messages.length && c.messages[from].role === "user" ? from : null;
    if (cut !== null) c.messages = c.messages.slice(0, cut);
    c.messages.push({ id: crypto.randomBytes(5).toString("hex"), role: "user", text: question, at });
    c.updatedAt = at;
    await this.chats.put(c);
    const job = { id: crypto.randomBytes(6).toString("hex"), conv: c.id, owner, steps: [], startedAt: at, finishedAt: null, error: "", reply: null, cancelled: false, route: null };
    this.jobs.set(job.id, job);
    if (this.jobs.size > 40) this.jobs.delete(this.jobs.keys().next().value);
    const history = c.messages.slice(0, -1);
    const t0 = Date.now();
    // Retry or an edited question asks for a new answer: never the reused one
    this.answer(question, { owner: isOwner, history, fresh: from !== null, mode: MODES.includes(mode) ? mode : null, onStep: (s) => job.steps.push({ at: Date.now(), text: s }), onRoute: (r) => (job.route = r) })
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

module.exports = { TradeAI, SYSTEM, SCHEMA, short };
