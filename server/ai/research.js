"use strict";
// Pre-market and post-market research for the watchlist: preparation for the next session.
//
// For every stock it gathers everything the desk knows — daily indicators and levels, the
// seven setups and their backtests on that stock, the weekly/daily/intraday verdict, the
// long-term view, today's tape, the company news check, the Indian market and the world
// brief — and lays it out as a data sheet. With an Anthropic key the model then writes a
// research note per stock (bias, the levels that matter, if-then scenarios for the open,
// triggers, what would cancel the idea) and one summary across the list: the stocks worth
// the most attention and a checklist for the open.
//
// It runs when asked, as a job the page follows; nothing here works by the clock. The
// notes are preparation, not orders: they never claim a probability or a profit.

const crypto = require("crypto");
const { AiError } = require("./client");
const { buildDirection } = require("../market/direction");

const KEEP = 20;
const MAX_STOCKS = 12;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&_-]{0,29}$/;
const IST = 5.5 * 3600 * 1000;
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);
const nums = (x, max) => (Array.isArray(x) ? x : []).map(Number).filter((v) => Number.isFinite(v) && v > 0).slice(0, max);

const RESEARCH_SYSTEM = `You are the research analyst on a private trading desk for NSE (India) cash equities. You prepare one stock for the trader's next session. It is either PRE-MARKET (before the open: what to expect today) or POST-MARKET (after the close: what today did, and how to prepare for tomorrow).

You are given a complete data sheet: daily indicators and levels, the desk's seven rule-based setups with their backtests on this very stock, a verdict across weekly, daily and intraday time frames, a long-term view, the last 30 daily bars, today's 5-minute tape when there is one, a company-news check gathered by web search (when there is one), the Indian market's direction and a world-markets brief.

How to work:
- Use only the data sheet. Quote its numbers. Never invent a price, a level, an event or a date. Where the data is missing or stale, say so.
- Separate what the chart shows from what the news says. News comes from web search and can be wrong or old — treat it as such.
- Key levels come from the sheet (pivots, supports, resistances, previous day high/low, VWAP, the 52-week range). Give scenarios as "if … then …" with those levels: for example how the stock trades relative to the previous day's range or the pivot in the first 15–30 minutes.
- A backtest with few trades is weak evidence; say so when you lean on one.
- The plan is conditional preparation: triggers to watch, the level that would prove the idea wrong, and when to stand aside. It is not an instruction to trade.
- Never promise or imply a profit, a win rate or a probability. Short, concrete sentences. No filler.`;

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bias", "conviction", "summary", "trend", "momentum", "volume_and_volatility", "key_levels", "scenarios", "setups_to_watch", "news_read", "risks", "plan", "checklist"],
  properties: {
    bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    conviction: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string", description: "Three to five sentences: where the stock stands and what matters for the next session." },
    trend: { type: "string", description: "Weekly, daily and intraday trend in two sentences, with the moving averages that define it." },
    momentum: { type: "string", description: "RSI, MACD and the other momentum readings, with their values." },
    volume_and_volatility: { type: "string", description: "Volume against its average, ATR, the day's range against it, liquidity." },
    key_levels: {
      type: "object",
      additionalProperties: false,
      required: ["resistances", "supports", "pivot", "note"],
      properties: {
        resistances: { type: "array", items: { type: "number" }, description: "Up to four, nearest first, from the sheet." },
        supports: { type: "array", items: { type: "number" }, description: "Up to four, nearest first, from the sheet." },
        pivot: { type: "number", description: "The pivot for the next session from the sheet, or 0." },
        note: { type: "string", description: "Which levels matter most and why, in one or two sentences." },
      },
    },
    scenarios: {
      type: "array",
      description: "Two to four if-then scenarios for the next session, each tied to a level.",
      items: { type: "object", additionalProperties: false, required: ["if", "then"], properties: { if: { type: "string" }, then: { type: "string" } } },
    },
    setups_to_watch: { type: "array", items: { type: "string" }, description: "Setups that are on or close, with their conditions met and backtest evidence." },
    news_read: { type: "string", description: "What the news check says and how much weight it deserves, or that there was none." },
    risks: { type: "array", items: { type: "string" }, description: "Up to five things that argue against the bias." },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["long_trigger", "short_trigger", "invalidation", "stand_aside_if"],
      properties: {
        long_trigger: { type: "string", description: "What would justify a long, with its level, or 'none'." },
        short_trigger: { type: "string", description: "What would justify an intraday short, with its level, or 'none'." },
        invalidation: { type: "string", description: "The level or event that would cancel the bias." },
        stand_aside_if: { type: "string", description: "Conditions under which to leave the stock alone." },
      },
    },
    checklist: { type: "array", items: { type: "string" }, description: "Up to five things to check at the open." },
  },
};

const SUMMARY_SYSTEM = `You write the one-page summary of a watchlist's research for a day trader in NSE (India) equities, for the next session. You are given each stock's research note (bias, conviction, levels, triggers), the Indian market's direction and a world-markets brief.

Rank the stocks by how clear their set-up is, not by how much you like them. Name the few worth the most attention and why, the ones to leave alone and why, and a short checklist for the open. Use only what you are given; never invent a number. Never promise or imply a profit or a probability.`;

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "market_view", "focus", "avoid", "open_checklist", "caveat"],
  properties: {
    headline: { type: "string", description: "Under 16 words." },
    market_view: { type: "string", description: "Two to four sentences on the market backdrop for the session." },
    focus: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "why"], properties: { symbol: { type: "string" }, why: { type: "string" } } }, description: "Up to five stocks, clearest set-up first." },
    avoid: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "why"], properties: { symbol: { type: "string" }, why: { type: "string" } } } },
    open_checklist: { type: "array", items: { type: "string" }, description: "Up to six things to check in the first 30 minutes." },
    caveat: { type: "string" },
  },
};

/** The parts of the brief a person reads first: a data sheet that needs no AI. */
function sheet(b, v) {
  const d = b.daily || {};
  const ind = d.indicators || {};
  const lv = d.levels || {};
  const eng = b.ruleEngine || {};
  return {
    price: b.price,
    atr: b.atr,
    reading: d.reading,
    indicators: ind,
    pivots: lv.pivots || null,
    supports: (lv.supports || []).slice(0, 4),
    resistances: (lv.resistances || []).slice(0, 4),
    movingAverages: lv.movingAverages || null,
    week52: lv.week52 || null,
    setups: d.setups || [],
    warnings: d.warnings || [],
    patterns: d.patterns || [],
    returns: d.returns || null,
    volatilityPct: d.volatilityPct,
    liquidity: d.liquidity || null,
    relativeStrength: d.relativeStrength || null,
    swing: eng.swing ? { stance: eng.swing.stance, score: eng.swing.score, conviction: eng.swing.conviction } : null,
    longTerm: eng.longTerm && eng.longTerm.stance ? { stance: eng.longTerm.stance, checks: eng.longTerm.checksMet } : null,
    intraday: eng.intraday && eng.intraday.call ? { call: eng.intraday.call, state: eng.intraday.state, score: eng.intraday.tapeScore } : null,
    bestBacktests: (b.backtestsOnThisStock || []).filter((x) => x.trades > 0).sort((x, y) => (y.avgPerTradePct || 0) - (x.avgPerTradePct || 0)).slice(0, 3),
    news: b.companyNews ? { tone: b.companyNews.tone, headline: b.companyNews.headline, at: b.companyNews.gatheredAt } : null,
    circuit: v && v.circuit ? v.circuit : null,
    dataNotes: b.dataNotes || [],
  };
}

class Research {
  constructor(ai) {
    this.ai = ai;
    this.name = "ai/research.json";
    this.job = null; // { id, phase, symbols, done, current, startedAt, finishedAt, error, reportId }
  }

  _all() {
    const a = this.ai.docs.read(this.name, []);
    return Array.isArray(a) ? a : [];
  }

  /** The phase that fits the clock (IST): mornings prepare the day ("pre"), afternoons and evenings review it ("post"). */
  defaultPhase() {
    const ist = new Date(this.ai.now() + IST);
    return ist.getUTCHours() < 12 ? "pre" : "post";
  }

  status() {
    return {
      configured: this.ai.configured(),
      job: this.job,
      defaultPhase: this.defaultPhase(),
      watchlist: this.ai.market.watchlist(),
      reports: this._all().map((r) => ({ id: r.id, at: r.at, phase: r.phase, symbols: r.stocks.map((s) => s.symbol), headline: r.summary ? r.summary.headline : "", withAi: Boolean(r.model) })),
    };
  }

  report(id) {
    const r = this._all().find((x) => x.id === id);
    if (!r) throw new AiError("No such research report.", "not_found", 404);
    return r;
  }

  /** Starts a research job and returns at once; the page follows it through status(). */
  start({ symbols, phase, news = false, world = false, useAi = true } = {}) {
    if (this.job && !this.job.finishedAt) throw new AiError("Research is already running. Wait for it to finish.", "busy", 409);
    const want = (Array.isArray(symbols) && symbols.length ? symbols : this.ai.market.watchlist()).map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s));
    const list2 = [...new Set(want)].slice(0, MAX_STOCKS);
    if (!list2.length) throw new AiError("Add stocks to the watchlist first, or pick some.", "invalid", 400);
    const withAi = Boolean(useAi) && this.ai.configured();
    if (useAi && !this.ai.configured() && (news || world)) throw new AiError("News and the world brief need an Anthropic API key.", "not_configured", 409);
    const p = phase === "post" ? "post" : phase === "pre" ? "pre" : this.defaultPhase();
    this.job = { id: crypto.randomBytes(6).toString("hex"), phase: p, symbols: list2, done: 0, current: "", step: "starting", startedAt: new Date(this.ai.now()).toISOString(), finishedAt: null, error: "", reportId: null, withAi, failures: [] };
    const job = this.job;
    this._run(job, { news: news && withAi, world: world && withAi }).catch((err) => {
      job.error = err && err.message ? err.message : "Research failed.";
      job.finishedAt = new Date(this.ai.now()).toISOString();
    });
    return this.status();
  }

  async _run(job, { news, world }) {
    const ai = this.ai;
    if (world) {
      job.step = "world brief";
      try {
        await ai.worldBrief({ refresh: true });
      } catch (err) {
        job.failures.push({ symbol: "world brief", error: err.message });
      }
    }
    const stocks = [];
    const client = job.withAi ? ai._client() : null;
    // the market's state, once for the whole job: one of the lenses of every direction
    let tide = null;
    try {
      const c = await ai.market.context();
      if (c && c.available) tide = { tide: c.tide };
    } catch (_) {
      tide = null;
    }
    for (const symbol of job.symbols) {
      job.current = symbol;
      const row = { symbol, available: false, sheet: null, direction: null, note: null, error: "" };
      try {
        if (news) {
          job.step = "news";
          try {
            await ai.news(symbol, { refresh: false });
          } catch (err) {
            job.failures.push({ symbol, error: `news: ${err.message}` });
          }
        }
        job.step = "data";
        const { brief, verdict } = await ai.brief(symbol);
        row.available = true;
        row.sheet = sheet(brief, verdict);
        // the direction: every lens weighed into one call (works without an AI key)
        job.step = "direction";
        const [edge, profile] = await Promise.all([
          typeof ai.market.edge === "function" ? ai.market.edge(symbol).catch(() => null) : null,
          typeof ai.market.behaviour === "function" ? ai.market.behaviour(symbol).catch(() => null) : null,
        ]);
        row.direction = buildDirection({ sheet: row.sheet, edge, profile, market: tide });
        if (client) {
          job.step = "analysis";
          const user = `Trading-skills file:\n\n${ai.playbook.read()}\n\n---\n\n${job.phase === "pre" ? "PRE-MARKET" : "POST-MARKET"} research for ${symbol}. Data sheet:\n\n${JSON.stringify(brief)}\n\n---\n\nThe desk's own multi-lens direction (arithmetic on the readings, including the forward-tested measured odds) — agree or disagree with it, and say why:\n\n${JSON.stringify(row.direction)}\n\n---\n\nWrite the research note for ${symbol}.`;
          const answer = await client.ask({ system: RESEARCH_SYSTEM, user, schema: RESEARCH_SCHEMA, effort: "medium", maxTokens: 12000 });
          const d = answer.data;
          const kl = d.key_levels || {};
          const pl = d.plan || {};
          row.note = {
            bias: ["bullish", "bearish", "neutral"].includes(d.bias) ? d.bias : "neutral",
            conviction: ["low", "medium", "high"].includes(d.conviction) ? d.conviction : "low",
            summary: str(d.summary, 1500),
            trend: str(d.trend, 700),
            momentum: str(d.momentum, 700),
            volume: str(d.volume_and_volatility, 700),
            levels: { resistances: nums(kl.resistances, 4), supports: nums(kl.supports, 4), pivot: Number(kl.pivot) > 0 ? Number(kl.pivot) : null, note: str(kl.note, 500) },
            scenarios: (Array.isArray(d.scenarios) ? d.scenarios : []).slice(0, 4).map((s) => ({ if: str(s.if, 300), then: str(s.then, 300) })),
            setups: list(d.setups_to_watch, 5, 300),
            news: str(d.news_read, 600),
            risks: list(d.risks, 5, 300),
            plan: { long: str(pl.long_trigger, 300), short: str(pl.short_trigger, 300), invalidation: str(pl.invalidation, 300), standAside: str(pl.stand_aside_if, 300) },
            checklist: list(d.checklist, 5, 200),
            usage: answer.usage,
          };
          job.model = answer.model;
        }
      } catch (err) {
        row.error = err && err.message ? err.message : "failed";
        job.failures.push({ symbol, error: row.error });
      }
      stocks.push(row);
      job.done += 1;
    }
    let summary = null;
    const noted = stocks.filter((s) => s.note);
    if (client && noted.length >= 2) {
      job.current = "";
      job.step = "summary";
      try {
        let market = null;
        try {
          const c = await ai.market.context();
          if (c && c.available) market = { tide: c.tide, nifty: c.nifty, vix: c.vix, sectors: c.sectors };
        } catch (_) {
          market = null;
        }
        const facts = { phase: job.phase, market, world: ai.worldSummary() || null, stocks: noted.map((s) => ({ symbol: s.symbol, bias: s.note.bias, conviction: s.note.conviction, summary: s.note.summary, levels: s.note.levels, plan: s.note.plan, risks: s.note.risks })) };
        const a = await client.ask({ system: SUMMARY_SYSTEM, user: JSON.stringify(facts), schema: SUMMARY_SCHEMA, effort: "medium", maxTokens: 8000 });
        const d = a.data;
        const pair = (x) => (Array.isArray(x) ? x : []).slice(0, 6).map((y) => ({ symbol: str(y.symbol, 30), why: str(y.why, 400) }));
        summary = { headline: str(d.headline, 200), market: str(d.market_view, 1200), focus: pair(d.focus), avoid: pair(d.avoid), checklist: list(d.open_checklist, 6, 250), caveat: str(d.caveat, 400) };
      } catch (err) {
        job.failures.push({ symbol: "summary", error: err.message });
      }
    }
    const report = { id: job.id, at: new Date(ai.now()).toISOString(), phase: job.phase, model: job.withAi ? job.model || null : null, summary, stocks, failures: job.failures };
    const all = [report, ...this._all()].slice(0, KEEP);
    ai.docs.write(this.name, all);
    job.reportId = report.id;
    job.step = "done";
    job.current = "";
    job.finishedAt = new Date(ai.now()).toISOString();
    ai.log.log(`[ai] ${job.phase}-market research: ${stocks.length} stocks, ${noted.length} notes${job.withAi ? ` by ${job.model}` : " (data only)"}`);
  }
}

module.exports = { Research, RESEARCH_SYSTEM, RESEARCH_SCHEMA, SUMMARY_SCHEMA };
