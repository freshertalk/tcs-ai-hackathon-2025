"use strict";
// The desk agent: TradeAI works out for itself what it needs to read before it answers.
//
// TradeAI's first plan comes from the words of the question (tradeai.js `plan`). That is fast and
// free, but it only reads what the words name. The agent adds the step an analyst takes next:
//
//   SEED   what is free and nearly always matters is read without asking a model: for every stock
//          the trader HOLDS that the question touches — the exit coach's live reading of the
//          position, the tape (RSI, VWAP, Bollinger, volume, the order book), the level map with
//          each level's measured record — and, for any stock, what the desk's other AI features
//          have already found on it (the shared research: paid for once, read by all).
//   PLAN   the model is shown the question, the list of the desk's READERS and what has been read
//          so far, and names what else it needs (up to four readers a step).
//   READ   the desk runs those readers: its own engines, the broker (read-only, the owner only),
//          the day's replay, the level learner — and, when the thinking level allows it, the web.
//   AGAIN  up to the number of steps the thinking level gives; then the answer is written from
//          everything gathered.
//
// A reader returns facts; it never places an order. Readers that reach the broker, the flight deck
// or the learner are functions app.js hands in (`tradeai.desk`) — this folder cannot load them. How
// many steps run, whether the planner sees the data itself and whether the web may be searched are
// set by the thinking level, so the trader decides how many tokens a question may burn.

const { askOne } = require("./mixture");

const AGENT_SYSTEM = `You are the planning step of TradeAI, the research agent of a private NSE (India) intraday trading desk. A trader has asked a question. The desk has READERS: functions that return facts from its own engines, from the broker (read-only) and, when offered, from the web. Some have been read already. Decide what ELSE has to be read before a senior analyst can answer well — then stop. You do not answer the question here.

Rules:
- Call a reader only when its facts would change or sharpen the answer. Never call one that ALREADY READ lists for the same stock. At most four calls in a step.
- A question about an open position (exit, hold, book, trail, stop, target, how is it doing): the facts that matter are "position" (the exit coach's live reading: its word, exit price, stop, target and reasons), "tape" (RSI, VWAP, Bollinger bands, volume, the order book) and "levels" (the level map, with how often each kind of level has held) for that stock. Read the ones that are missing.
- "shared" holds what the desk's other AI features have already found on a stock — paid for earlier. Read it before anything marked PAID.
- A reader marked PAID searches the web or asks another model: call it only when the question needs news, the reason for a move or a fact from outside the desk. At most one PAID call for the whole question.
- "symbol" is the NSE symbol in capitals for a reader that needs one, else "". "query" is the search text, or a date as YYYY-MM-DD, for a reader that takes one, else "".
- When nothing more is needed, return an empty "calls" list with "enough": true.
- "thought": one short plain sentence on what is missing and why. The trader sees it as the agent's step.`;

const STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["thought", "calls", "enough"],
  properties: {
    thought: { type: "string" },
    calls: { type: "array", items: { type: "object", additionalProperties: false, required: ["tool", "symbol", "query"], properties: { tool: { type: "string" }, symbol: { type: "string" }, query: { type: "string" } } } },
    enough: { type: "boolean" },
  },
};

const WEB_SYSTEM = `You research one question for an NSE (India) intraday trading desk by searching the web. Report only what the sources say, with the date of each fact, in at most twelve short bullet points; say plainly when the sources disagree or when nothing relevant was found. Prefer exchange filings, company statements and established financial news. No advice, no forecast of your own, no promise.`;

// the readers: `via` names a block the first plan already knows how to gather (tradeai.js `gather`)
const READERS = [
  { id: "shared", needs: "symbol", about: "What the desk's AI features have already found on this stock (AI Live, AI Research, the exit advisor and its checked exit levels, the position coach, TradeAI): summary, call, prices, how old, and whether the price has moved since. Free." },
  { id: "position", needs: "symbol", owner: true, about: "The exit coach's live reading of the trader's OPEN position in this stock: HOLD / TIGHTEN / BOOK PART / EXIT NOW, exit pressure, the price to exit at, the stop, the next target, why leave and why stay, the P&L and its best, the order book, and the AI's checked exit levels. Leave symbol empty for every open position." },
  { id: "tape", needs: "symbol", about: "Today's tape for the stock from its 1-minute bars: RSI on 1 and 5 minutes with divergence, VWAP and its bands, Bollinger bands (%B, squeeze, a close outside), volume against the usual and its biggest minute, momentum over 3–30 minutes, 5-minute price action, and the live quote with the bid, the offer and who holds the order book." },
  { id: "levels", needs: "symbol", about: "The desk's level map around the price: every level above and below (day and previous-day highs and lows, VWAP, pivots, swings, round numbers, Bollinger bands, order walls), its strength, how often levels of that kind have HELD when tested (the level learner's record) and the odds of a touch before 3:15 PM." },
  { id: "learned", needs: "symbol", about: "What the desk has measured from its own history: how often each kind of level held or broke (overall, for this stock, by time of day, by volume, by RSI, inside or outside the Bollinger band, by order book), and the record of the AI's exit levels. Symbol may be empty." },
  { id: "snapshot", needs: "symbol", via: ["snapshot"], about: "The desk's engines on the stock: the live intraday call, the multi-timeframe verdict, the ladder of levels, daily indicators, candlestick patterns, the stock's habits and the measured odds of today's set-ups." },
  { id: "outlook", needs: "symbol", via: ["snapshot", "outlook"], about: "The next-session outlook for the stock: lean, range, pivots and scenarios (with the snapshot)." },
  { id: "plan", needs: "symbol", via: ["plan"], about: "The desk's intraday plan for the stock with its measured record." },
  { id: "options", needs: "symbol", via: ["options"], about: "The option chain: open interest by strike and its change, PCR, call and put walls, max pain, ATM IV. Symbol may be NIFTY or BANKNIFTY." },
  { id: "market", via: ["market"], about: "The market now: Nifty, Bank Nifty, India VIX, sector moves, breadth and the market's tide." },
  { id: "global", via: ["global"], about: "The NSE forecast from the world: GIFT Nifty, the US, Europe, Asia, the rupee, crude, FII flows." },
  { id: "social", via: ["social"], about: "The organised news and social feed: market mood, the stocks in the news, the latest headlines." },
  { id: "positions", owner: true, via: ["positions", "goal"], about: "Every open position with its P&L, the funds, and the day's goal (target, daily stop, giveback guard)." },
  { id: "pnl", owner: true, via: ["pnl"], about: "The trader's results: the last 30 days, the last seven days one by one, and journal statistics (win rate, expectancy, by hour, mistakes)." },
  { id: "orders", owner: true, via: ["orders"], about: "Orders still waiting at the broker." },
  { id: "picks", about: "The Research tab's Top 10: the desk's ranked stocks to trade in this session (or the next), each with its side, score, reasons with numbers, the plan's entry, stop and target, and the AI's note; the names that just left the list; the list's measured record; and the live RSI extremes of the NIFTY 500 (14-day RSI 15 or less, 80 or more, ₹100 crore a day or more). Free." },
  { id: "scanner", about: "The live NIFTY 100 scanner, read every two seconds from the broker's stream on 5-minute bars (VWAP, EMA 9/21, Supertrend, MACD, RSI, ADX, ATR, Bollinger, the opening range, yesterday's levels and pivots, volume against the usual, strength against the NIFTY, the order book): the market's lean (the NIFTY and the breadth), the stocks ELIGIBLE for an intraday trade now with side, score, agreement, the next-move lean for 15–30 minutes, the plan (entry, stop, 1.5R and 2.5R targets) and reasons; the near misses and the rule each fails; the AI's note; and the scanner's measured record (calls to target or stop today, how often its leans were right, the last sessions). Free." },
  { id: "indices", needs: "query", about: "NIFTY 50 or SENSEX in history (query: NIFTY or SENSEX): month to date and year to date, how this calendar month has done each year (win rate, average, median, best and worst), the desk's projection for the month and the year with its 68% and 90% ranges and its measured walk-forward record, the AI's latest projection, the fall from the all-time high. Free." },
  { id: "lab", needs: "query", owner: true, about: "The Execution Lab's replay of a trading day (query: YYYY-MM-DD, or empty for the latest): every trade's best moment to have left, exit efficiency, habits that cost money, and the Coach's comparison with earlier days — what to prevent and what to keep." },
  { id: "news", needs: "symbol", paid: true, via: ["news"], about: "A web search on the company's news today and whether it explains the move (kept for 30 minutes)." },
  { id: "web", needs: "query", paid: true, about: "An open web search for a fact from outside the desk (results, policy, a global event, a sector story). The query must be specific." },
];
const BY_ID = new Map(READERS.map((r) => [r.id, r]));
const SYMBOL = /^[A-Z][A-Z0-9&-]{1,19}$/;
const GIST = {
  market: "the market: indices, VIX, sectors, tide",
  positions: "every open position with its P&L",
  funds: "available margin",
  goal: "the day's goal",
  pnl: "results of the last 30 days and journal statistics",
  orders: "orders waiting",
  alerts: "price alerts",
  options: "the option chain",
  forecast: "the NSE forecast from the world",
  social: "the news and social feed",
  plan: "the intraday plan",
  news: "the company's news today",
  lab: "the Execution Lab's replay and the Coach's comparison",
  picks: "the Research tab's Top 10 and the RSI extremes",
  scanner: "the live NIFTY 100 scanner: eligible intraday stocks, leans, plans, its record",
  indices_NIFTY: "NIFTY 50 in history, its projections and their record",
  indices_SENSEX: "SENSEX in history, its projections and their record",
  learned: "what the desk has measured about levels",
};
const gistOf = (key) => {
  const m = key.match(/^(stock|tape|levels|position|shared|learned|web)_(.+)$/);
  if (!m) return GIST[key] || key;
  const what = { stock: "the engines' snapshot (live call, verdict, ladder, indicators, habits, odds)", tape: "the tape (RSI, VWAP, Bollinger, volume, order book)", levels: "the level map with each level's record", position: "the exit coach's live reading of the open position", shared: "what the desk's AI already found", learned: "the measured record of levels", web: "a web search" }[m[1]];
  return `${what} — ${m[2]}`;
};

class DeskAgent {
  constructor(tradeai) {
    this.t = tradeai;
    this.ai = tradeai.ai;
  }

  /** The readers that may be offered now. */
  catalogue({ owner = false, web = false } = {}) {
    const desk = this.t.desk || {};
    return READERS.filter((r) => {
      if (r.owner && !owner) return false;
      if (r.paid && !web) return false;
      if (r.id === "shared") return Boolean(this.ai.shared);
      if (["position", "tape", "levels", "lab", "learned", "indices", "picks", "scanner"].includes(r.id)) return typeof desk[r.id === "position" ? "reading" : r.id] === "function";
      if (r.id === "web" || r.id === "news") return Boolean(this.ai._searchProvider && this.ai._searchProvider());
      return true;
    });
  }

  /** One reader, run. Adds its block(s) to `data` and returns the keys it filled. */
  async read(tool, { symbol = "", query = "" } = {}, { data, used, owner, onStep = () => {} }) {
    const r = BY_ID.get(tool);
    if (!r) return [];
    const sym = String(symbol || "").toUpperCase().trim();
    if (r.needs === "symbol" && sym && !SYMBOL.test(sym)) return [];
    const desk = this.t.desk || {};
    const put = (key, value, label) => {
      if (value === null || value === undefined) return [];
      data[key] = value;
      if (label) used.push(label);
      return [key];
    };
    const within = (p, ms) => this.t._within(Promise.resolve(p), ms).then((x) => (x && x.__timeout ? null : x)).catch(() => null);

    if (r.via) {
      if (r.needs === "symbol" && !sym && !["options"].includes(r.id)) return [];
      const got = await this.t.gather({ symbols: sym ? [sym] : [], tools: r.via, positions: [] }, { owner, onStep, only: r.via });
      const keys = [];
      for (const [k, v] of Object.entries(got.data)) {
        if (k === "asOf" || k === "plan" || data[k] !== undefined) continue;
        data[k] = v;
        keys.push(k);
      }
      got.used.forEach((u) => !used.includes(u) && used.push(u));
      return keys;
    }
    if (r.id === "shared") {
      if (!sym || !this.ai.shared) return [];
      const last = data[`position_${sym}`] ? data[`position_${sym}`].numbers && data[`position_${sym}`].numbers.last : data[`stock_${sym}`] && data[`stock_${sym}`].quote ? data[`stock_${sym}`].quote.last : null;
      const found = this.ai.shared.forSymbol(sym, { last, reader: "tradeai", owner });
      if (!found.length) return [];
      return put(`shared_${sym}`, { note: "Findings of the desk's other AI features, already paid for. `moved` = the price has moved more than 0.6% since.", findings: found.map((f) => ({ from: f.source, model: f.by, at: f.clock, minutesAgo: f.ageMin, madeAtPrice: f.last, moved: f.moved, summary: f.summary, ...(Object.keys(f.tags).length ? { call: f.tags } : {}), ...(Object.keys(f.facts).length ? { prices: f.facts } : {}), ...(f.detail ? { detail: f.detail } : {}) })) }, `shared research ${sym}`);
    }
    if (r.id === "position") {
      if (!owner || typeof desk.reading !== "function") return [];
      onStep(sym ? `Reading the exit coach on your ${sym} position` : "Reading the exit coach on your open positions");
      const list = await within(desk.reading(sym || null), 9000);
      const keys = [];
      for (const p of Array.isArray(list) ? list.slice(0, 4) : []) keys.push(...put(`position_${p.symbol}`, p, `exit coach ${p.symbol}`));
      return keys;
    }
    if (r.id === "tape") {
      if (!sym || typeof desk.tape !== "function") return [];
      onStep(`Reading ${sym}'s tape: RSI, VWAP, Bollinger bands, volume, the order book`);
      return put(`tape_${sym}`, await within(desk.tape(sym), 12000), `tape ${sym}`);
    }
    if (r.id === "levels") {
      if (!sym || typeof desk.levels !== "function") return [];
      onStep(`Reading ${sym}'s level map and each level's record`);
      return put(`levels_${sym}`, await within(desk.levels(sym), 12000), `level map ${sym}`);
    }
    if (r.id === "learned") {
      if (typeof desk.learned !== "function") return [];
      const v = await within(desk.learned(sym || null), 5000);
      return v && v.available !== false ? put(sym ? `learned_${sym}` : "learned", v, "what the desk has measured") : [];
    }
    if (r.id === "picks") {
      if (typeof desk.picks !== "function") return [];
      onStep("Reading the Research tab's Top 10 and the RSI extremes");
      const v = await within(desk.picks(), 15000);
      return v && v.available !== false ? put("picks", v, "Top 10") : [];
    }
    if (r.id === "scanner") {
      if (typeof desk.scanner !== "function") return [];
      onStep("Reading the live NIFTY 100 scanner");
      const v = await within(Promise.resolve(desk.scanner()), 5000);
      return v ? put("scanner", v, "live scanner") : [];
    }
    if (r.id === "indices") {
      if (typeof desk.indices !== "function") return [];
      const which = /SENSEX|BSE/i.test(String(query || symbol || "")) ? "SENSEX" : "NIFTY";
      onStep(`Reading ${which === "SENSEX" ? "SENSEX" : "NIFTY 50"} in history: this month in past years, the projections and their record`);
      const v = await within(desk.indices(which), 20000);
      return v && v.available !== false ? put(`indices_${which}`, v, `${which} history`) : [];
    }
    if (r.id === "lab") {
      if (!owner || typeof desk.lab !== "function") return [];
      onStep("Reading the Execution Lab's replay and the Coach");
      return put("lab", await within(desk.lab(/^\d{4}-\d{2}-\d{2}$/.test(query) ? query : null), 20000), "Execution Lab");
    }
    if (r.id === "web") {
      const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 240);
      if (q.length < 6 || !this.ai._searchClient) return [];
      onStep(`Searching the web: ${q}`);
      const stamp = new Date(this.ai.now() + 5.5 * 3600000).toISOString().slice(0, 16).replace("T", " ");
      const found = await within(this.ai._searchClient().search({ system: WEB_SYSTEM, user: `It is ${stamp} India time. Research: ${q}`, maxUses: 3, maxTokens: 3000, effort: "low" }), 90000);
      if (!found || !found.text) return [];
      const n = Object.keys(data).filter((k) => k.startsWith("web_")).length + 1;
      return put(`web_${n}`, { query: q, findings: String(found.text).slice(0, 4000), sources: (found.sources || []).slice(0, 6).map((s) => ({ title: s.title, url: s.url })) }, `web: ${q.slice(0, 40)}`);
    }
    return [];
  }

  /**
   * What is free and nearly always matters, read without asking a model.
   * @param want { exit: the question is about managing a position }
   */
  async seed(plan, data, used, { owner, onStep, exit = false }) {
    const held = owner ? (plan.positions || []).filter((p) => p.exchange === "NSE" || p.exchange === "BSE").map((p) => p.symbol) : [];
    const asked = plan.named || plan.symbols || []; // what the question names, not every stock held
    // the positions the question is about: the ones it names, or all of them when it names none
    const mine = exit && !asked.some((s) => held.includes(s)) && !asked.length ? held.slice(0, 3) : asked.filter((s) => held.includes(s)).slice(0, 3);
    const jobs = [];
    const ctx = { data, used, owner, onStep };
    if (mine.length) jobs.push(this.read("position", { symbol: mine.length === 1 ? mine[0] : "" }, ctx));
    for (const s of mine.slice(0, 2)) {
      jobs.push(this.read("tape", { symbol: s }, ctx));
      jobs.push(this.read("levels", { symbol: s }, ctx));
    }
    await Promise.all(jobs.map((j) => j.catch(() => [])));
    for (const s of [...new Set([...asked, ...mine])].slice(0, 3)) await this.read("shared", { symbol: s }, ctx).catch(() => []);
    return mine;
  }

  /**
   * The planning steps.
   * @param level { steps, seeData, web }
   * @returns { steps: [{ n, thought, calls: [{ tool, symbol, query, ok, keys }] }], usage, tried }
   */
  async run(question, { data, used, models, level, owner, history = [], onStep = () => {}, fresh = false }) {
    const out = { steps: [], usage: { input: 0, output: 0 }, tried: [] };
    if (!models.length || !level || !(level.steps > 0)) return out;
    let paid = 0;
    const convo = history.slice(-4).map((m) => `${m.role === "user" ? "Trader" : "TradeAI"}: ${String(m.text).slice(0, 400)}`).join("\n");
    for (let n = 1; n <= level.steps; n += 1) {
      const readers = this.catalogue({ owner, web: Boolean(level.web) && paid === 0 });
      const have = Object.keys(data).filter((k) => k !== "asOf" && k !== "plan");
      let seen = "";
      if (level.seeData) {
        const json = JSON.stringify(data);
        seen = `\n\nDATA SO FAR:\n${json.length > 14000 ? `${json.slice(0, 14000)}…(cut)` : json}`;
      }
      const user = `READERS:\n${readers.map((r) => `- ${r.id}${r.needs ? ` (needs ${r.needs})` : ""}${r.paid ? " [PAID]" : ""}: ${r.about}`).join("\n")}\n\nALREADY READ:\n${have.length ? have.map((k) => `- ${k}: ${gistOf(k)}`).join("\n") : "- nothing yet"}${seen}\n\n${convo ? `The conversation so far:\n${convo}\n\n` : ""}The trader asks: ${question}\n\nStep ${n} of ${level.steps}.`;
      onStep(n === 1 ? "The agent is deciding what else it needs" : "The agent is checking what is still missing");
      const r = await askOne(this.ai, models, { system: AGENT_SYSTEM, user, schema: STEP_SCHEMA, maxTokens: 1500, effort: "low", timeoutSec: 40, fresh });
      out.usage.input += r.usage.input;
      out.usage.output += r.usage.output;
      out.tried.push(...(r.tried || []));
      if (!r.data) break;
      const offered = new Set(readers.map((x) => x.id));
      const calls = (Array.isArray(r.data.calls) ? r.data.calls : []).filter((c) => c && offered.has(String(c.tool))).slice(0, 4);
      const step = { n, thought: String(r.data.thought || "").replace(/\s+/g, " ").trim().slice(0, 240), calls: [] };
      if (step.thought) onStep(`Agent: ${step.thought}`);
      const jobs = [];
      for (const c of calls) {
        const reader = BY_ID.get(String(c.tool));
        const entry = { tool: reader.id, symbol: String(c.symbol || "").toUpperCase().slice(0, 20), query: String(c.query || "").slice(0, 240), ok: false, keys: [] };
        // what is already there is not read twice
        const key = { position: "position", tape: "tape", levels: "levels", shared: "shared", learned: "learned", snapshot: "stock" }[reader.id];
        if (key && entry.symbol && data[`${key}_${entry.symbol}`] !== undefined) continue;
        if (step.calls.some((x) => x.tool === entry.tool && x.symbol === entry.symbol && x.query === entry.query)) continue;
        if (reader.paid) {
          if (paid >= 1) continue; // one paid reader for the whole question
          paid += 1;
        }
        step.calls.push(entry);
        jobs.push(
          this.read(reader.id, entry, { data, used, owner, onStep })
            .then((keys) => {
              entry.keys = keys;
              entry.ok = keys.length > 0;
            })
            .catch(() => {}),
        );
      }
      await Promise.all(jobs);
      out.steps.push(step);
      if (r.data.enough === true || !step.calls.some((c) => c.ok)) break;
    }
    return out;
  }
}

require("./brains").register("tradeai", AGENT_SYSTEM, "TradeAI agent: choosing what to read");
require("./brains").register("tradeai", WEB_SYSTEM, "TradeAI agent: web research");

module.exports = { DeskAgent, READERS, AGENT_SYSTEM, STEP_SCHEMA, WEB_SYSTEM, gistOf };
