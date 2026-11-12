"use strict";
// The live co-pilot: the AI, live on the one stock a page has open.
//
// It is not a loop. The page asks for a reading when something happens — the
// engine's call changes, a level breaks, an early warning appears, the order book
// tilts, or a set time has passed — and the server decides whether that reading
// is allowed:
//   • never sooner than `minGapSec` after the last one for that stock
//   • never more than `dailyCap` readings in a day, across every stock
//   • only while the live call itself exists (market open, Zerodha connected)
// Close the page and nothing runs: nothing in this folder works on a clock.
//
// It never gives prices of its own. It is shown the same snapshot the rule engine
// used — plus the 1-minute tape and the order book — and says whether the call
// deserves trust right now and what to watch. Every "up" or "down" it gives is
// scored against the price ten minutes later, by arithmetic, and the record is
// shown next to it.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { AiError, MODELS } = require("./client");

const IST = 5.5 * 3600 * 1000;
const SCORE_AFTER_MIN = 10; // a bias is judged on the price this many minutes later
const FLAT_PCT = 0.05; // a move smaller than this, either way, is "flat"
const MANUAL_GAP_SEC = 20; // "Ask now" may be pressed this often
const KEEP_PER_SYMBOL = 20;
const KEEP_SYMBOLS = 30;
const DEFAULTS = { minGapSec: 120, dailyCap: 80, refreshMin: 10, model: "" };
const LIMITS = { minGapSec: [30, 900], dailyCap: [1, 500], refreshMin: [0, 60] };
const REASONS = {
  manual: "the trader asked for a reading",
  "switched-on": "the co-pilot was just switched on for this stock",
  "call-change": "the rule engine's call changed",
  tripwire: "the price broke one of the call's levels",
  weakening: "an early warning appeared against the trade in play",
  "flow-flip": "the order book tilted hard to one side",
  refresh: "time has passed since the last reading",
};

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const hhmm = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const bounded = (x, [lo, hi], fallback) => {
  const v = Math.round(Number(x));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

const LIVE_SYSTEM = `You are the co-pilot on a private day-trading desk for NSE (India) cash equities. One trader has one stock open and is watching it live. A rule-based engine on the desk already makes the call (long, short, wait or no trade) with its own entry, stop and targets. You do not replace it, and you never give prices to trade at. Your job is to read the same live snapshot the way an experienced tape reader would and say, in a few plain sentences, whether the engine's call deserves trust right now and what to watch over the next few minutes.

You will receive a JSON snapshot: the engine's call and how its score is built, its early warnings, how far the price has moved in the last seconds and minutes, a read of the 1-minute bars, the order book (best bids and offers, imbalance, signed trade flow, and a small statistical model's 30-second lean with its measured hit rate), the direction of the Indian market, a one-line world and company-news summary when there is one, what triggered this reading, and your own previous reading with how it turned out.

How to work:
- Use only what is in the snapshot and quote its numbers. If something you need is missing, say so in "caution".
- "bias" is your read of the next ten to fifteen minutes: "up", "down" or "unclear". "unclear" is a normal, respectable answer — use it whenever the evidence is mixed or thin, or the session clock says not to trade. Each "up" or "down" is scored against the price ten minutes later and the record is shown to the trader, so do not guess.
- Say whether you agree with the engine's call. Disagree only for a reason that is visible in the snapshot (for example the order book and the 1-minute tape both leaning against it), and name it.
- Treat the order book with suspicion. Resting quantity can be placed to mislead and pulled before it trades, and the 30-second lean matters only when its measured hit rate is clearly above half over a meaningful number of calls.
- The world and company-news lines were gathered by web search and can be stale or wrong: background, never a trigger.
- "watch" is one to three specific things, each with a price taken from the snapshot (a trigger, VWAP, the opening range, a swing low or high, the engine's stop).
- Never invent an entry, stop or target of your own. Never promise or imply a profit or a probability, and never tell the trader to buy or sell. "confidence" is low, medium or high and means only how well the evidence agrees.
- Write for someone glancing away from a chart: short sentences, real numbers, no filler.`;

const LIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "bias", "confidence", "agrees_with_engine", "reading", "what_changed", "watch", "caution"],
  properties: {
    headline: { type: "string", description: "One line, under 14 words." },
    bias: { type: "string", enum: ["up", "down", "unclear"], description: "The next ten to fifteen minutes." },
    confidence: { type: "string", enum: ["low", "medium", "high"], description: "How well the evidence agrees. Not a probability." },
    agrees_with_engine: { type: "string", enum: ["yes", "partly", "no"] },
    reading: { type: "string", description: "Two to four short sentences with the numbers that matter." },
    what_changed: { type: "string", description: "What is different since your previous reading, or what the trigger means. Empty if there is nothing to add." },
    watch: { type: "array", items: { type: "string" }, description: "One to three things to watch, each with a price from the snapshot." },
    caution: { type: "string", description: "The main reason this reading could be wrong, or what the snapshot lacks." },
  },
};

class Copilot {
  /** @param ai  the AiService: the key, the model, the market service and the clock all come from it */
  constructor(ai) {
    this.ai = ai;
    this.file = path.join(ai.dir, "live.json");
    this._busy = new Map(); // symbol → the request in flight, so two tabs do not pay twice
  }

  /* ------------------------------------------------------------- settings */

  settings() {
    const s = this.ai.store.data.settings.aiLive || {};
    return {
      minGapSec: bounded(s.minGapSec, LIMITS.minGapSec, DEFAULTS.minGapSec),
      dailyCap: bounded(s.dailyCap, LIMITS.dailyCap, DEFAULTS.dailyCap),
      refreshMin: bounded(s.refreshMin, LIMITS.refreshMin, DEFAULTS.refreshMin),
      // "" means: the same model as the strategist
      model: MODELS.some((m) => m.id === s.model) ? s.model : "",
    };
  }

  setSettings(patch = {}) {
    if (patch.model !== undefined && patch.model !== "" && !MODELS.some((m) => m.id === patch.model)) throw new AiError("Unknown model.", "invalid", 400);
    for (const k of Object.keys(LIMITS)) {
      if (patch[k] === undefined) continue;
      const v = Number(patch[k]);
      if (!Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) throw new AiError(`"${k}" must be between ${LIMITS[k][0]} and ${LIMITS[k][1]}.`, "invalid", 400);
    }
    const next = { ...this.settings() };
    for (const k of Object.keys(LIMITS)) if (patch[k] !== undefined) next[k] = Math.round(Number(patch[k]));
    if (patch.model !== undefined) next.model = patch.model;
    this.ai.store.update((d) => {
      d.settings.aiLive = next;
    });
    return this.settings();
  }

  /* ---------------------------------------------------------------- state */

  _load() {
    const today = istDate(this.ai.now());
    let s = null;
    try {
      s = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (_) {
      s = null;
    }
    if (!s || typeof s !== "object") s = {};
    const t = s.tally && typeof s.tally === "object" ? s.tally : {};
    const tally = { right: t.right || 0, wrong: t.wrong || 0, flat: t.flat || 0, since: t.since || today };
    // a new day starts a new count; yesterday's readings are history, the running tally stays
    if (s.day !== today) return { day: today, count: 0, inputTokens: 0, outputTokens: 0, reads: {}, tally };
    return { day: today, count: s.count || 0, inputTokens: s.inputTokens || 0, outputTokens: s.outputTokens || 0, reads: s.reads && typeof s.reads === "object" ? s.reads : {}, tally };
  }

  _save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(state));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  /** What the day's use looks like — for the settings page and the card's footer. */
  summary() {
    const state = this._load();
    return { settings: this.settings(), usage: this._usage(state), record: this._record(state) };
  }

  _usage(state) {
    const cap = this.settings().dailyCap;
    return { day: state.day, used: state.count, cap, left: Math.max(0, cap - state.count), inputTokens: state.inputTokens, outputTokens: state.outputTokens };
  }

  _record(state) {
    const today = { scored: 0, right: 0, wrong: 0, flat: 0, unclear: 0, pending: 0 };
    for (const list of Object.values(state.reads)) {
      for (const r of list) {
        if (r.bias === "unclear") today.unclear += 1;
        else if (!r.outcome) today.pending += 1;
        else if (["right", "wrong", "flat"].includes(r.outcome.status)) {
          today.scored += 1;
          today[r.outcome.status] += 1;
        }
      }
    }
    return { today, allTime: { ...state.tally, scored: state.tally.right + state.tally.wrong + state.tally.flat }, rule: `A bias is right when the price ${SCORE_AFTER_MIN} minutes later has moved its way by at least ${FLAT_PCT}%, wrong when it has moved the other way by as much, flat otherwise.` };
  }

  _view(state, symbol) {
    const s = this.settings();
    return {
      configured: this.ai.configured(),
      // the server's clock, so a page can tell how old a reading is without trusting its own
      now: new Date(this.ai.now()).toISOString(),
      settings: s,
      model: s.model || this.ai._model(),
      usage: this._usage(state),
      record: this._record(state),
      reads: (state.reads[symbol] || []).slice().reverse(),
    };
  }

  /** Is there a reading whose ten minutes are up? */
  _due(state, symbol) {
    const now = this.ai.now();
    return (state.reads[symbol] || []).some((r) => !r.outcome && r.bias !== "unclear" && now - Date.parse(r.at) >= SCORE_AFTER_MIN * 60000);
  }

  /**
   * Score this stock's readings whose ten minutes are up, from today's 1-minute bars.
   * @param tape  { today, bars: [{ t: "HH:MM", o, … }] }
   * @returns true when something was scored
   */
  _score(state, symbol, tape) {
    if (!tape || !tape.today || !Array.isArray(tape.bars) || tape.bars.length === 0) return false;
    const now = this.ai.now();
    let changed = false;
    for (const r of state.reads[symbol] || []) {
      if (r.outcome || r.bias === "unclear") continue;
      const made = Date.parse(r.at);
      if (now - made < SCORE_AFTER_MIN * 60000) continue;
      const due = hhmm(made + SCORE_AFTER_MIN * 60000);
      // the bar that opens ten minutes on: its open is the price at that moment
      const bar = tape.bars.find((b) => b.t >= due);
      if (!bar) {
        if (hhmm(now) > "15:30" || now - made > 3600000) {
          r.outcome = { status: "unscored", note: "The session ended before ten minutes had passed." };
          changed = true;
        }
        continue;
      }
      if (!num(r.price) || r.price <= 0 || !num(bar.o)) continue;
      const movePct = ((bar.o - r.price) / r.price) * 100;
      const status = Math.abs(movePct) < FLAT_PCT ? "flat" : movePct > 0 === (r.bias === "up") ? "right" : "wrong";
      r.outcome = { status, movePct: r2(movePct), price: bar.o, at: bar.t };
      state.tally[status] += 1;
      changed = true;
    }
    return changed;
  }

  /** The readings for one stock, with anything that has come due scored. Costs nothing. */
  async view(symbol) {
    const state = this._load();
    if (this._due(state, symbol) && typeof this.ai.market.tape === "function") {
      try {
        const t = await this.ai.market.tape(symbol, 1);
        if (t && t.available && this._score(state, symbol, t.tape)) this._save(state);
      } catch (_) {
        /* scored next time */
      }
    }
    return this._view(state, symbol);
  }

  /* ----------------------------------------------------------------- read */

  /**
   * One reading, if it is allowed now.
   * @returns the view, plus { read } for a new reading or { skipped: "too-soon", waitSec } when it is too early
   */
  async read(symbol, { reason = "manual", event = "" } = {}) {
    const why = Object.prototype.hasOwnProperty.call(REASONS, reason) ? reason : "manual";
    const s = this.settings();
    const client = this.ai._client(s.model || undefined); // fails here, before any data is fetched, when no key is set
    const running = this._busy.get(symbol);
    if (running) return running;
    // the detail comes from the page: keep it short and plain before it goes into a prompt
    const detail = String(event || "").replace(/[^\x20-\x7E₹–—·’→]/g, " ").trim().slice(0, 240);
    const job = this._read(symbol, why, detail, s, client).finally(() => this._busy.delete(symbol));
    this._busy.set(symbol, job);
    return job;
  }

  async _read(symbol, why, detail, s, client) {
    const market = this.ai.market;
    let state = this._load();
    const now = this.ai.now();
    const list = state.reads[symbol] || [];
    const prev = list[list.length - 1] || null;
    const gapSec = why === "manual" ? MANUAL_GAP_SEC : s.minGapSec;
    if (prev && now - Date.parse(prev.at) < gapSec * 1000) {
      return { ...this._view(state, symbol), skipped: "too-soon", waitSec: Math.ceil((gapSec * 1000 - (now - Date.parse(prev.at))) / 1000) };
    }
    if (state.count >= s.dailyCap) {
      throw new AiError(`The co-pilot has used all ${s.dailyCap} of today's readings. Raise the daily limit in the AI settings, or carry on with the rule engine — it does not need the AI.`, "cap_reached", 429);
    }

    const v = await market.verdict(symbol);
    const day = v.available && v.day ? v.day : null;
    if (v.source !== "kite" || !day || !day.available) {
      throw new AiError(`The co-pilot reads the live session only: it needs the market open and Zerodha connected.${day && day.reason ? ` (${day.reason})` : ""}`, "live_only", 409);
    }

    // the 1-minute tape: the newest bars for the snapshot, and the prices that score earlier readings
    let minute = null;
    if (typeof market.tape === "function") {
      try {
        const t = await market.tape(symbol, 1);
        if (t && t.available && t.tape.today) minute = t;
      } catch (_) {
        minute = null;
      }
    }
    if (minute && this._score(state, symbol, minute.tape)) this._save(state);

    let flow = null;
    try {
      flow = typeof market.flowSnapshot === "function" ? market.flowSnapshot(symbol) : null;
    } catch (_) {
      flow = null;
    }
    let india = null;
    if (typeof market.context === "function") {
      try {
        const c = await market.context();
        if (c.available) india = { tide: c.tide, nifty: c.nifty, indiaVix: c.vix };
      } catch (_) {
        india = null;
      }
    }
    const world = this.ai.worldSummary();
    const news = this.ai.newsSummary(symbol);
    const m = day.movement;
    const fast = day.fast || (minute && minute.fast && minute.fast.available ? minute.fast : null);

    const snapshot = {
      symbol,
      timeIST: hhmm(now),
      session: { phase: day.session.label, minutesToEntryCutOff: day.session.minutesToCutoff, minutesToSquareOff: day.session.minutesToSquareOff },
      price: {
        last: m.last,
        changePct: m.changePct,
        sinceOpenPct: m.fromOpenPct,
        vwap: m.vwap,
        vsVwapPct: m.vsVwapPct,
        dayHigh: m.dayHigh,
        dayLow: m.dayLow,
        placeInDayRangePct: m.dayPosPct,
        openingRange: [m.orLow, m.orHigh],
        atr: m.atr,
        rangeUsedPct: m.rangeUsedPct,
        rsi5min: m.rsi5,
        last15minPct: m.m15Pct,
        last30minPct: m.m30Pct,
        volumePace: m.volumePace,
      },
      engine: {
        call: day.headline,
        state: day.state,
        side: day.side,
        score: day.score,
        needs: day.threshold,
        tapeScore: day.tapeScore,
        marketAdjustment: day.marketAdj,
        factors: (day.factors || []).map((f) => ({ name: f.name, points: f.pts, of: f.max, reading: f.reading })),
        plan: day.plan ? { side: day.plan.side, entry: day.plan.entry, stop: day.plan.stop, targets: day.plan.targets.map((t) => t.price) } : null,
        triggers: { longAbove: day.triggers.long, shortBelow: day.triggers.short },
        earlyWarnings: (day.early || []).map((e) => ({ against: e.against, text: e.text })),
        weakening: Boolean(day.weakening),
        dailyTrend: day.withDaily,
        notes: day.notes || [],
      },
      rupeesMovedRecently: day.tapeSpeed || null,
      oneMinuteTape: fast ? { trend: fast.trend, structure: fast.structure, rsi: fast.rsi, last1minPct: fast.m1Pct, last5minPct: fast.m5Pct, last15minPct: fast.m15Pct, swingLow: fast.swingLow, swingHigh: fast.swingHigh, volumeLast5minVsSession: fast.volumeSurge } : null,
      lastOneMinuteBars: minute ? { columns: ["time", "open", "high", "low", "close", "volume"], rows: minute.tape.bars.slice(-12).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]) } : null,
      orderBook: flow
        ? {
            bid: flow.bid,
            ask: flow.ask,
            spreadTicks: flow.spreadTicks,
            quantityNearPrice: { bids: flow.bidQty, offers: flow.askQty, imbalancePct: flow.imbalancePct },
            wholeBook: { bids: flow.buyTotal, offers: flow.sellTotal, imbalancePct: flow.imbalanceTotalPct },
            averageSize: { bid: flow.avgBid, offer: flow.avgAsk },
            wall: flow.wall,
            signedVolume: { last30s: flow.delta30, last60s: flow.delta60, last5min: flow.delta300, volumeLast60s: flow.volume60 },
            pressure: flow.pressure,
            pressureLabel: flow.label,
            thirtySecondLean: { direction: flow.lean.dir, upPct: flow.lean.upPct, callsScored: flow.lean.calls, hitRatePct: flow.lean.hitRatePct, reliable: flow.lean.reliable },
            note: "Five best levels only; resting quantity can be pulled before it trades.",
          }
        : null,
      indianMarket: india,
      worldToday: world ? { mood: world.mood, headline: world.headline, gatheredAt: world.time, source: "web search — can be stale or wrong" } : null,
      companyNews: news ? { tone: news.tone, headline: news.headline, explainsTodaysMove: news.explainsMove, gatheredAt: news.time, source: "web search — can be stale or wrong" } : null,
      trigger: { why: REASONS[why], detail: detail || null },
      yourPreviousReading: prev
        ? { minutesAgo: Math.round((now - Date.parse(prev.at)) / 60000), bias: prev.bias, confidence: prev.confidence, headline: prev.headline, priceThen: prev.price, priceNow: m.last, outcome: prev.outcome ? prev.outcome.status : "not scored yet" }
        : null,
      yourRecordToday: this._record(state).today,
    };

    const answer = await client.ask({ system: LIVE_SYSTEM, user: `Live snapshot for ${symbol}:\n\n${JSON.stringify(snapshot)}\n\nGive your reading.`, schema: LIVE_SCHEMA, maxTokens: 4000, effort: "low" });
    const d = answer.data;
    const read = {
      id: crypto.randomBytes(6).toString("hex"),
      at: new Date(now).toISOString(),
      time: hhmm(now),
      symbol,
      reason: why,
      event: detail,
      price: m.last,
      engine: { state: day.state, side: day.side, score: day.score, call: day.headline },
      bias: ["up", "down", "unclear"].includes(d.bias) ? d.bias : "unclear",
      confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
      agrees: ["yes", "partly", "no"].includes(d.agrees_with_engine) ? d.agrees_with_engine : "partly",
      headline: str(d.headline, 160),
      reading: str(d.reading, 900),
      whatChanged: str(d.what_changed, 400),
      watch: (Array.isArray(d.watch) ? d.watch : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 3),
      caution: str(d.caution, 400),
      sawOrderBook: Boolean(flow),
      sawOneMinute: Boolean(fast),
      model: answer.model,
      usage: answer.usage,
      outcome: null,
    };

    // another stock's reading may have landed while this one was being written: start from the file
    state = this._load();
    state.count += 1;
    state.inputTokens += answer.usage.inputTokens;
    state.outputTokens += answer.usage.outputTokens;
    state.reads[symbol] = [...(state.reads[symbol] || []), read].slice(-KEEP_PER_SYMBOL);
    const symbols = Object.keys(state.reads);
    if (symbols.length > KEEP_SYMBOLS) {
      const lastAt = (k) => Date.parse(state.reads[k][state.reads[k].length - 1].at);
      symbols.sort((a, b) => lastAt(a) - lastAt(b)).slice(0, symbols.length - KEEP_SYMBOLS).forEach((k) => delete state.reads[k]);
    }
    this._save(state);
    this.ai.log.log(`[ai] co-pilot ${symbol} (${why}) by ${answer.model}: ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out tokens — ${state.count}/${s.dailyCap} today`);
    return { ...this._view(state, symbol), read };
  }
}

module.exports = { Copilot, LIVE_SYSTEM, LIVE_SCHEMA, REASONS, SCORE_AFTER_MIN, FLAT_PCT, DEFAULTS };
