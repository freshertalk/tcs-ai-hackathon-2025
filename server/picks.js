"use strict";
// The Research tab's Top 10, made and kept up to date by itself.
//
//   WHEN      before the open (from 8:35 AM, for today's session), every five minutes in the session
//             (re-ranked as the market moves), and after the close (from 3:45 PM, for the next session) —
//             weekdays, while Zerodha is connected. Refresh now makes one on request.
//   HOW       the universe — NIFTY 100, the watchlist and the stocks in the news — is scored by
//             market/picks.js: a first pass on every stock from its daily candles and one batch of quotes,
//             then the best twenty again with the desk's engines (the live call, the measured odds, the
//             intraday plan, the Live Pulse). The NSE forecast from the world (GIFT Nifty, the US, Asia),
//             the market's tide, each sector against the NIFTY and the news weigh in. The daily candles are
//             read once a day (and again after the close); in the session only the quotes and the engines
//             of the shortlist are read again, so the five-minute re-rank stays light on Zerodha.
//   AI        on need only: the AI Engine reviews the candidates before the open and after the close, and in
//             the session only when the list has really changed (three or more names since its last
//             review, an hour apart) or the world's lean or the market's tide has turned — within a daily
//             limit. It may only order and keep or drop the desk's candidates and write each one's thesis
//             and risk; it cannot add a stock or flip a side. Without a key the desk's ranking stands.
//   SHARED    each name on the list is published to the shared research (ai/shared.js), so TradeAI, the
//             Desk and every workspace read it without asking again; TradeAI's agent can read the list.
//   RSI       the NIFTY 500's extremes, live: every stock with a 14-day RSI of 15 or less, or 80 or more,
//             that trades ₹100 crore a day or more (the Screener's RSI search, run by itself — the daily
//             history it needs is downloaded once, by itself, when Zerodha is connected).
//   RECORD    every list made before the open, and every list made after the close for the next session,
//             is scored when that session ends: each pick from the open to the close in its direction, and
//             against the same move for the whole universe — overall and by reason. Once ten sessions are
//             scored the findings are written into the trading-skills file every AI feature reads.
//
// It reads the market. It never trades. It lives outside server/ai (which holds no timers).

const P = require("./market/picks");

const IST = 5.5 * 3600 * 1000;
const SETTINGS = "picks/settings.json";
const LATEST = "picks/latest.json";
const RECORD = "picks/record.json";
const dayDoc = (date) => `picks/day-${date}.json`;
const DEFAULTS = { aiMode: "need", aiDailyCap: 6 };
const SHORTLIST = 20;
const LIVE_EVERY_MS = 5 * 60000;
const AI_LIVE_GAP_MS = 60 * 60000;
const MAX_SNAPS = 90;
const SECTION = "## What the desk's daily Top 10 has done (written by itself)";
const RSI_RULE = { period: 14, low: 15, high: 80, minTurnover: 100 }; // the owner's standing RSI watch
const RSI_CACHE_MS = 30000;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const istIso = (ms) => new Date(ms + IST).toISOString();
const istDate = (ms) => istIso(ms).slice(0, 10);
const clock = (ms) => istIso(ms).slice(11, 16);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const isWeekday = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const nextWeekday = (iso) => {
  let t = Date.parse(`${iso}T00:00:00Z`) + 86400000;
  while (!isWeekday(new Date(t).toISOString().slice(0, 10))) t += 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

class PicksError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A few at a time: the broker allows three requests a second. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const k = i;
      i += 1;
      try {
        out[k] = await fn(items[k], k);
      } catch (_) {
        out[k] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

class TopPicks {
  /**
   * @param market the MarketService
   * @param ai     the AiService (ai.picksAi, ai.shared, ai.ensemble, ai.playbook), optional
   */
  constructor({ market, ai = null, docs, now = () => Date.now(), log = console }) {
    this.market = market;
    this.ai = ai;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.feat = null; // { day, stage: "pre"|"post", map: { SYM: dailyFeatures } } — the daily part, read once a day
    this.plans = new Map(); // symbol → { day, plan } — the intraday plans of the day
    this.running = null;
    this.timer = null;
    this._liveAt = 0;
    this._aiBusy = false;
    this.progress = null;
  }

  /* ---------------------------------------------------------------------------- settings */
  settings() {
    const d = this.docs.read(SETTINGS, null) || {};
    const today = istDate(this.now());
    const cap = Number(d.aiDailyCap);
    return {
      aiMode: ["need", "off"].includes(d.aiMode) ? d.aiMode : DEFAULTS.aiMode,
      aiDailyCap: Number.isFinite(cap) && cap >= 0 ? Math.min(30, Math.round(cap)) : DEFAULTS.aiDailyCap,
      aiToday: d.ai && d.ai.day === today ? d.ai.n : 0,
      aiReady: Boolean(this.ai && this.ai.picksAi && this.ai.picksAi.ready()),
    };
  }
  setSettings(patch = {}) {
    const d = this.docs.read(SETTINGS, null) || {};
    if (patch.aiMode !== undefined) {
      if (!["need", "off"].includes(patch.aiMode)) throw new PicksError("The AI mode is need or off.");
      d.aiMode = patch.aiMode;
    }
    if (patch.aiDailyCap !== undefined) {
      const v = Number(patch.aiDailyCap);
      if (!Number.isFinite(v) || v < 0 || v > 30) throw new PicksError("AI reviews a day: 0 to 30.");
      d.aiDailyCap = Math.round(v);
    }
    this.docs.write(SETTINGS, d);
    return this.settings();
  }
  _countAi() {
    const d = this.docs.read(SETTINGS, null) || {};
    const today = istDate(this.now());
    d.ai = d.ai && d.ai.day === today ? { day: today, n: d.ai.n + 1 } : { day: today, n: 1 };
    this.docs.write(SETTINGS, d);
  }

  /* ----------------------------------------------------------------------------- phases */
  /** Which list is due now, and for which session. */
  phaseOf(ms = this.now()) {
    const day = istDate(ms);
    const m = minuteOfDay(ms);
    if (!isWeekday(day)) return { phase: "post", session: nextWeekday(day), day };
    if (m < 9 * 60 + 15) return { phase: "pre", session: day, day };
    if (m < 15 * 60 + 30) return { phase: "live", session: day, day };
    return { phase: "post", session: nextWeekday(day), day };
  }

  _mode() {
    try {
      return typeof this.market.mode === "function" ? this.market.mode() : "kite";
    } catch (_) {
      return "none";
    }
  }

  /* --------------------------------------------------------------------------- universe */
  /** NIFTY 100, the watchlist and the stocks in the news — with each stock's sector. */
  universe() {
    const m = this.market;
    const set = new Set();
    const lists = m.indexList || null;
    if (this._mode() === "demo") (m.watchlist ? m.watchlist() : []).forEach((s) => set.add(s));
    else {
      if (lists) lists.list("nifty100").forEach((s) => set.add(s));
      (m.watchlist ? m.watchlist() : []).forEach((s) => set.add(s));
      try {
        const sig = m.social ? m.social.signal() : null;
        (sig && sig.stocks ? sig.stocks : []).slice(0, 10).forEach((x) => x && x.symbol && set.add(x.symbol));
      } catch (_) {
        /* no news feed */
      }
    }
    const sectorOf = new Map();
    if (lists && typeof lists.catalog === "function") {
      for (const c of lists.catalog()) {
        if (!/sector/i.test(c.group || "")) continue;
        for (const s of lists.list(c.id)) if (!sectorOf.has(s)) sectorOf.set(s, { id: c.id, name: c.name, kite: (c.kite || [])[0] || null });
      }
    }
    return [...set].filter((s) => /^[A-Z0-9][A-Z0-9&._-]{0,24}$/.test(s)).slice(0, 140).map((s) => ({ symbol: s, sector: sectorOf.get(s) || null }));
  }

  /** The daily part of each stock, read once a day (and again after the close). */
  async _features(uni, phase) {
    const day = istDate(this.now());
    const stage = phase === "post" ? "post" : "pre";
    if (this.feat && this.feat.day === day && (this.feat.stage === "post" || this.feat.stage === stage) && uni.every((u) => u.symbol in this.feat.map)) return this.feat.map;
    const live = phase === "live";
    const map = {};
    const today = {};
    let done = 0;
    this.progress = { step: "Reading each stock's daily history", done: 0, of: uni.length };
    await pool(uni, 3, async (u) => {
      const d = await this.market.daily(u.symbol);
      const candles = (d && d.candles) || [];
      const t = istDate(this.now());
      // the session in progress is not a completed bar
      map[u.symbol] = P.dailyFeatures(live ? candles.filter((c) => String(c.t).slice(0, 10) < t) : candles);
      const last = candles[candles.length - 1];
      if (last && String(last.t).slice(0, 10) === t) today[u.symbol] = { o: last.o, h: last.h, l: last.l, c: last.c };
      done += 1;
      this.progress = { step: "Reading each stock's daily history", done, of: uni.length };
    });
    this.feat = { day, stage, map, today };
    return map;
  }

  async _quotes(symbols) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 100) {
      try {
        const r = await this.market.quotes(symbols.slice(i, i + 100));
        Object.assign(out, (r && r.quotes) || {});
      } catch (_) {
        /* the rest still count */
      }
    }
    return out;
  }

  /** The market around the list: the world, the tide, the NIFTY, the sectors, the news. */
  async _context(uni, live) {
    const m = this.market;
    const ctx = { world: null, tide: null, nifty: null, sectors: {}, mood: null };
    await Promise.all([
      (typeof m.marketForecast === "function" ? m.marketForecast() : Promise.resolve(null))
        .then((f) => {
          if (f && f.available && f.lean) ctx.world = { score: f.lean.score, word: f.lean.word, firm: Boolean(f.lean.firm), headline: f.headline || "" };
        })
        .catch(() => {}),
      live && typeof m.context === "function"
        ? m
            .context()
            .then((c) => {
              if (c && c.available && c.tide) ctx.tide = { score: c.tide.score, label: c.tide.label };
            })
            .catch(() => {})
        : Promise.resolve(),
      (this._nifty && this._nifty.day === istDate(this.now()) && this._nifty.live === live
        ? Promise.resolve(this._nifty.f)
        : typeof m.daily === "function" && this._mode() === "kite"
          ? m.daily("NIFTY 50").then((d) => {
              // read once a day (and once for the session): the NIFTY's 20-session move for relative strength
              const f = d && d.candles ? P.dailyFeatures(d.candles.filter((c) => !live || String(c.t).slice(0, 10) < istDate(this.now()))) : null;
              this._nifty = { day: istDate(this.now()), live, f };
              return f;
            })
          : Promise.resolve(null)
      )
        .then((f) => {
          if (f) ctx.nifty = { ret20: f.ret20, close: f.close };
        })
        .catch(() => {}),
    ]);
    if (live) {
      const names = [...new Set(uni.map((u) => u.sector && u.sector.kite).filter(Boolean))];
      const q = await this._quotes(["NIFTY 50", ...names]);
      if (q["NIFTY 50"]) ctx.nifty = { ...(ctx.nifty || {}), changePct: q["NIFTY 50"].changePct, last: q["NIFTY 50"].last };
      for (const n of names) if (q[n] && num(q[n].changePct)) ctx.sectors[n] = q[n].changePct;
    }
    try {
      const sig = m.social ? m.social.signal() : null;
      ctx.mood = sig && sig.mood ? { label: sig.mood.label, score: sig.mood.score } : null;
    } catch (_) {
      ctx.mood = null;
    }
    return ctx;
  }

  _news(symbol) {
    try {
      const n = this.market.social ? this.market.social.forSymbol(symbol, { hours: 18 }) : null;
      return n && n.mentions ? { sentiment: n.sentiment, high: n.high, mentions: n.mentions, title: n.items && n.items[0] ? n.items[0].title : "" } : null;
    } catch (_) {
      return null;
    }
  }

  /* -------------------------------------------------------------------------------- build */
  /** Make the list now (one at a time). @param phase "pre" | "live" | "post" (default: the phase of the moment) */
  build({ phase = null, trigger = "itself" } = {}) {
    if (this.running) return this.running;
    this.running = this._build(phase || this.phaseOf().phase, trigger).finally(() => {
      this.running = null;
      this.progress = null;
    });
    return this.running;
  }

  async _build(phase, trigger) {
    const mode = this._mode();
    if (mode !== "kite" && mode !== "demo") throw new PicksError("The Top 10 needs the Zerodha connection (log in to Kite on the Desk).", "not_connected", 409);
    const t0 = Date.now();
    const at = this.now();
    const { session } = this.phaseOf(at);
    const live = phase === "live";
    const uni = this.universe();
    if (!uni.length) throw new PicksError("No stocks to rank: the NIFTY 100 list and the watchlist are empty.", "empty", 409);
    const feats = await this._features(uni, phase);
    const ctx = await this._context(uni, live);
    this.progress = { step: "Scoring every stock", done: 0, of: uni.length };
    const quotes = live ? await this._quotes(uni.map((u) => u.symbol)) : {};
    const mins = Math.max(0, minuteOfDay(at) - (9 * 60 + 15));
    // the first pass, on every stock
    const rows = uni.map((u) => {
      const df = feats[u.symbol] || null;
      const lf = live ? P.liveFeatures(quotes[u.symbol], df, { minutesIn: mins }) : null;
      const sector = u.sector ? { name: u.sector.name, vsNiftyPct: live && num(ctx.sectors[u.sector.kite]) && ctx.nifty && num(ctx.nifty.changePct) ? ctx.sectors[u.sector.kite] - ctx.nifty.changePct : null } : null;
      const s = df ? P.score(df, lf, { niftyRet20: ctx.nifty ? ctx.nifty.ret20 : null, niftyChangePct: ctx.nifty ? ctx.nifty.changePct : null, world: ctx.world, tide: ctx.tide, sector, news: this._news(u.symbol), live }) : null;
      return { symbol: u.symbol, sector: u.sector ? u.sector.name : null, df, lf, s };
    });
    const scored = rows.filter((r) => r.s);
    // the second pass: the best twenty with the desk's engines
    const short = scored.filter((r) => !r.s.excluded).sort((a, b) => b.s.score - a.s.score).slice(0, SHORTLIST);
    this.progress = { step: "Reading the desk's engines for the shortlist", done: 0, of: short.length };
    let k = 0;
    await pool(short, 3, async (r) => {
      const eng = { live };
      const within = (p, ms) => Promise.race([Promise.resolve(p), new Promise((res) => setTimeout(() => res(null), ms))]).catch(() => null);
      const jobs = [within(this.market.verdict(r.symbol), 12000).then((v) => (eng.verdict = v)), within(typeof this.market.edge === "function" ? this.market.edge(r.symbol) : null, 12000).then((e) => (eng.edge = e))];
      const today = istDate(this.now());
      const cached = this.plans.get(r.symbol);
      if (cached && cached.day === today && phase !== "post") eng.plan = cached.plan;
      // the intraday plan is built from completed bars: worked out once a day per name (and again after the close)
      else if (this.ai && this.ai.ensemble && typeof this.ai.ensemble.intraday === "function") {
        jobs.push(
          within(this.ai.ensemble.intraday(r.symbol), 25000).then((p) => {
            eng.plan = p;
            if (p && p.available !== false) this.plans.set(r.symbol, { day: phase === "post" ? session : today, plan: p });
          })
        );
      }
      if (live && typeof this.market.pulse === "function") jobs.push(within(this.market.pulse(r.symbol), 12000).then((p) => (eng.pulse = p)));
      await Promise.all(jobs);
      r.s = P.deepen(r.s, eng);
      k += 1;
      this.progress = { step: "Reading the desk's engines for the shortlist", done: k, of: short.length };
    });
    const ranked = P.rank(scored, { limit: 15 });
    const list = ranked.slice(0, 10).map((r, i) => this._row(r, i + 1, quotes));
    const onDeck = ranked.slice(10, 15).map((r, i) => this._row(r, 11 + i, quotes));
    const prev = this._latest();
    const changes = this._changes(prev, list, session);
    // the AI's notes on a name stay with it through the session's re-ranks (until its next review)
    if (prev && prev.session === session) {
      const notes = new Map([...prev.list, ...(prev.onDeck || [])].filter((x) => x.ai).map((x) => [x.symbol, x.ai]));
      for (const x of [...list, ...onDeck]) if (notes.has(x.symbol)) x.ai = { ...notes.get(x.symbol), carried: true };
    }
    const snap = {
      id: `${session}-${phase}-${at}`,
      at: new Date(at).toISOString(),
      clock: clock(at),
      phase,
      session,
      trigger,
      list,
      onDeck,
      left: changes.left,
      context: { world: ctx.world, tide: ctx.tide, nifty: ctx.nifty, mood: ctx.mood },
      stats: { universe: uni.length, scored: scored.length, excluded: scored.filter((r) => r.s.excluded).length, ms: Date.now() - t0 },
      ai: prev && prev.session === session && prev.ai ? { ...prev.ai, carried: true } : null,
    };
    // the AI's review: before the open and after the close, and in the session only on need
    const need = this._aiNeed(snap, prev, changes);
    if (need) {
      if (live) {
        this._save(snap);
        this._review(snap, need).catch(() => {});
        return this._view(snap);
      }
      await this._review(snap, need).catch(() => {});
    }
    if (phase === "post") await this._settle().catch((err) => this.log.error(`[picks] scoring: ${err.message}`));
    this._save(snap);
    this._share(snap);
    return this._view(snap);
  }

  _row(r, rank, quotes) {
    const df = r.df || {};
    const lf = r.lf || null;
    const q = quotes[r.symbol];
    // in the session: where the price stands against the plan's levels (they were set before the open)
    let plan = r.s.plan || null;
    if (plan && lf && num(lf.last) && (plan.kind === "long" || plan.kind === "short") && num(plan.entry)) {
      const s = plan.kind === "long" ? 1 : -1;
      const x = lf.last;
      const status = num(plan.stop) && s * (x - plan.stop) <= 0 ? "stop" : num(plan.target) && s * (x - plan.target) >= 0 ? "target" : s * (x - plan.entry) >= 0 ? "triggered" : "waiting";
      plan = { ...plan, status };
    }
    return {
      rank,
      symbol: r.symbol,
      sector: r.sector,
      side: r.s.side,
      score: r.s.score,
      margin: r.s.margin,
      deep: Boolean(r.s.deep),
      last: lf ? lf.last : df.close,
      changePct: lf ? lf.changePct : df.ret1,
      reasons: r.s.reasons.slice(0, 8),
      against: r.s.against,
      tags: r.s.tags,
      plan,
      data: {
        atrPct: df.atrPct,
        ret5: df.ret5,
        ret20: df.ret20,
        ret60: df.ret60,
        rsi14: df.rsi14,
        vsEma20: df.vsEma20,
        vsEma50: df.vsEma50,
        vsEma200: df.vsEma200,
        relVol: df.relVol,
        toHi20Pct: df.toHi20Pct,
        toLo20Pct: df.toLo20Pct,
        fromHi52Pct: df.fromHi52Pct,
        turnoverCr: df.turnoverCr,
        ...(lf ? { vsVwapPct: lf.vsVwapPct, rangePos: lf.rangePos, relVolNow: lf.relVolNow, gapPct: lf.gapPct, buyersPct: lf.buyersPct } : {}),
        ...(q && num(q.avgPrice) ? { vwap: q.avgPrice } : {}),
      },
    };
  }

  /** What moved since the list before (in the same session): new names, the ones that left, rank changes. */
  _changes(prev, list, session) {
    if (!prev || prev.session !== session) return { left: [], fresh: list.length };
    const before = new Map(prev.list.map((x) => [x.symbol, x.rank]));
    for (const x of list) x.move = before.has(x.symbol) ? before.get(x.symbol) - x.rank : null; // positive: up the list; null: new
    const now = new Set(list.map((x) => x.symbol));
    const left = prev.list.filter((x) => !now.has(x.symbol)).map((x) => ({ symbol: x.symbol, side: x.side, rank: x.rank }));
    return { left, fresh: list.filter((x) => x.move === null).length };
  }

  /* ------------------------------------------------------------------------------- the AI */
  _aiNeed(snap, prev, changes) {
    const st = this.settings();
    if (st.aiMode !== "need" || !st.aiReady || st.aiToday >= st.aiDailyCap || !snap.list.length) return "";
    if (this._mode() === "demo") return ""; // demo data never costs AI credits by itself
    if (snap.trigger === "asked") return "you asked";
    const reviewed = prev && prev.session === snap.session && prev.ai && !prev.ai.failed ? prev.ai : null;
    if (snap.phase !== "live") return reviewed && reviewed.phase === snap.phase ? "" : snap.phase === "pre" ? "the pre-market list" : "the list for the next session";
    // the open changes everything: the first list of the session gets its own review
    if (!reviewed || reviewed.phase !== "live") return "the first list of the session";
    const since = this.now() - Date.parse(reviewed.at);
    if (since < AI_LIVE_GAP_MS) return "";
    const base = new Set(reviewed.symbols || []);
    const changed = snap.list.filter((x) => !base.has(x.symbol)).length;
    if (changed >= 3) return `${changed} names changed since the AI's last review`;
    const turned = (a, b) => a && b && num(a.score) && num(b.score) && Math.sign(a.score) !== Math.sign(b.score) && Math.abs(a.score - b.score) >= 30;
    if (turned(snap.context.world, reviewed.world)) return "the world's lean turned";
    if (turned(snap.context.tide, reviewed.tide)) return "the market's tide turned";
    void changes;
    return "";
  }

  async _review(snap, why) {
    if (this._aiBusy) return;
    this._aiBusy = true;
    try {
      const rec = this.record();
      const cands = [...snap.list, ...snap.onDeck];
      const input = {
        phase: snap.phase,
        session: snap.session,
        timeIST: snap.clock,
        market: snap.context,
        deskRecord: rec.sessions >= 3 ? { sessions: rec.sessions, hitRatePct: rec.hitRate, avgMovePct: rec.avgPct, avgEdgeVsUniversePct: rec.avgEdgePct, longs: rec.longs, shorts: rec.shorts, reasonsThatPaid: rec.byReason.slice(0, 8) } : null,
        candidates: cands.map((x) => ({ symbol: x.symbol, deskRank: x.rank, side: x.side, score: x.score, sector: x.sector, last: x.last, changePct: x.changePct, plan: x.plan, reasons: x.reasons.slice(0, 6), against: x.against, data: x.data })),
      };
      const r = await this.ai.picksAi.review(input);
      if (!r) throw new Error("no answer");
      if (!r.cached) this._countAi();
      const known = new Map(cands.map((x) => [x.symbol, x]));
      const notes = {};
      const order = [];
      const dropped = [];
      for (const o of r.picks) {
        const x = known.get(o.symbol);
        if (!x || order.includes(o.symbol) || dropped.some((d) => d.symbol === o.symbol)) continue; // only the desk's candidates, once each
        if (o.keep) {
          order.push(o.symbol);
          notes[o.symbol] = { thesis: o.thesis, risk: o.risk, confidence: o.confidence };
        } else dropped.push({ symbol: o.symbol, why: o.thesis });
      }
      // the desk's order fills whatever the AI did not place
      for (const x of cands) if (!order.includes(x.symbol) && !dropped.some((d) => d.symbol === x.symbol)) order.push(x.symbol);
      const top = order.slice(0, 10);
      const newList = top.map((s, i) => ({ ...known.get(s), rank: i + 1, deskRank: known.get(s).rank, ai: notes[s] || null }));
      const prevRanks = new Map(snap.list.map((x) => [x.symbol, x.move]));
      for (const x of newList) x.move = prevRanks.has(x.symbol) ? prevRanks.get(x.symbol) : null;
      snap.list = newList;
      snap.onDeck = order.slice(10, 15).map((s, i) => ({ ...known.get(s), rank: 11 + i, deskRank: known.get(s).rank }));
      snap.ai = { at: new Date(this.now()).toISOString(), clock: clock(this.now()), by: r.by, why, phase: snap.phase, summary: r.summary, marketView: r.marketView, dropped, symbols: top, world: snap.context.world, tide: snap.context.tide };
    } catch (err) {
      snap.ai = { at: new Date(this.now()).toISOString(), clock: clock(this.now()), failed: true, why, error: String(err && err.message ? err.message : err).slice(0, 160), phase: snap.phase };
    } finally {
      this._aiBusy = false;
      if (snap.phase === "live") {
        // the live list was already saved: save it again with the review
        this._save(snap);
        this._share(snap);
      }
    }
  }

  /* ---------------------------------------------------------------------------- keeping */
  _latest() {
    return this.docs.read(LATEST, null);
  }
  _save(snap) {
    this.docs.write(LATEST, snap);
    const date = istDate(Date.parse(snap.at));
    const d = this.docs.read(dayDoc(date), null) || { date, snaps: [] };
    const i = d.snaps.findIndex((x) => x.id === snap.id);
    const lite = { id: snap.id, at: snap.at, clock: snap.clock, phase: snap.phase, session: snap.session, ranks: snap.list.map((x) => [x.symbol, x.side, x.score]), ai: snap.ai && !snap.ai.failed ? snap.ai.by : null };
    if (i >= 0) d.snaps[i] = lite;
    else d.snaps.push(lite);
    if (d.snaps.length > MAX_SNAPS) d.snaps.splice(0, d.snaps.length - MAX_SNAPS);
    // the lists that are scored later: the one made before the open, the one made after the close
    if (snap.phase === "pre" || snap.phase === "post") d[snap.phase] = { at: snap.at, session: snap.session, picks: snap.list.map((x) => ({ symbol: x.symbol, side: x.side, rank: x.rank, tags: x.tags })), ai: snap.ai && !snap.ai.failed ? snap.ai.by : null };
    this.docs.write(dayDoc(date), d);
  }

  _share(snap) {
    if (!this.ai || !this.ai.shared || this._mode() === "demo") return;
    for (const x of snap.list) {
      try {
        const plan = x.plan && x.plan.entry ? ` Plan: ${x.plan.kind} ${x.plan.kind === "long" ? "above" : "below"} ${x.plan.entry}, stop ${x.plan.stop}, target ${x.plan.target}.` : "";
        this.ai.shared.publish({
          feature: "picks",
          symbol: x.symbol,
          by: snap.ai && !snap.ai.failed ? `Desk + ${snap.ai.by}` : "Desk ranking",
          last: x.last,
          summary: `Top 10 #${x.rank} for ${snap.phase === "post" ? "the next session" : "today's session"}: ${x.side.toUpperCase()}, score ${x.score}. ${x.reasons.slice(0, 2).join(" ")}${plan}${x.ai && x.ai.thesis ? ` AI: ${x.ai.thesis}` : ""}`,
          tags: { side: x.side, rank: x.rank },
          facts: x.plan && x.plan.entry ? { entry: x.plan.entry, stop: x.plan.stop, target: x.plan.target } : {},
          ttlMin: snap.phase === "live" ? 30 : 720,
        });
      } catch (_) {
        /* sharing never fails the list */
      }
    }
  }

  /* ------------------------------------------------------------------------ RSI extremes */
  /**
   * NIFTY 500 stocks at a 14-day RSI of 15 or less, or 80 or more, trading ₹100 crore a day or more —
   * with today's live price as the newest bar. Kept for 30 seconds.
   */
  async rsiExtremes() {
    const now = this.now();
    if (this._rsi && now - this._rsi.at < RSI_CACHE_MS) return this._rsi.out;
    const rule = { ...RSI_RULE };
    if (this._mode() !== "kite") return { available: false, rule, reason: this._mode() === "demo" ? "The RSI watch reads the NIFTY 500 from Zerodha: it is not available on demo data." : "The RSI watch needs the Zerodha connection (log in to Kite on the Desk)." };
    let status = null;
    try {
      status = this.market.screenerStatus();
    } catch (_) {
      status = null;
    }
    if (status && !status.ready) {
      // the daily history of the NIFTY 500 is downloaded once, by itself
      if (!status.job.running && this._rsiSyncDay !== istDate(now)) {
        this._rsiSyncDay = istDate(now);
        try {
          status = this.market.screenerStart({});
        } catch (_) {
          /* the next look tries again tomorrow */
        }
      }
      return { available: false, rule, preparing: true, status, reason: status && status.job && status.job.running ? `Downloading the NIFTY 500's daily history, ${status.job.done} of ${status.job.total} stocks — about ${Math.max(1, Math.round((status.job.etaSeconds || 0) / 60))} min. The lists appear by themselves.` : "The NIFTY 500's daily history is being prepared." };
    }
    const q = { period: rule.period, minTurnover: rule.minTurnover };
    const [low, high] = await Promise.all([this.market.screenerRsi({ ...q, max: rule.low }), this.market.screenerRsi({ ...q, min: rule.high })]);
    const lite = (r) => ({ symbol: r.symbol, name: r.name, last: r.last, changePct: r.changePct, rsi: r.rsi, rsiPrev: r.rsiPrev, avgTurnoverCr: r.avgTurnoverCr });
    const out = {
      available: true,
      rule,
      at: high.at || low.at,
      live: Boolean(high.live || low.live),
      session: high.session || low.session,
      considered: high.considered || low.considered || 0,
      oversold: (low.rows || []).map(lite),
      overbought: (high.rows || []).map(lite),
      status: high.status || low.status || null,
    };
    this._rsi = { at: now, out };
    return out;
  }

  /* ----------------------------------------------------------------------------- record */
  record() {
    const d = this.docs.read(RECORD, null) || { lists: [] };
    return { ...P.record(d.lists), recent: d.lists.slice(-10).reverse().map((l) => ({ session: l.session, kind: l.kind, n: l.result.n, hitRate: l.result.hitRate, avgPct: l.result.avgPct, edgePct: l.result.edgePct, ai: l.ai || null })) };
  }

  /**
   * After the close: today's lists — the one made before the open and the one made last evening for
   * today — scored on today's candles.
   */
  async _settle() {
    const today = istDate(this.now());
    if (!isWeekday(today) || minuteOfDay(this.now()) < 15 * 60 + 30) return 0;
    const rec = this.docs.read(RECORD, null) || { lists: [] };
    const lists = [];
    const todayDoc = this.docs.read(dayDoc(today), null);
    if (todayDoc && todayDoc.pre && todayDoc.pre.session === today) lists.push({ kind: "pre", made: todayDoc.pre.at, picks: todayDoc.pre.picks, ai: todayDoc.pre.ai });
    // last evening's list for today: the most recent earlier day whose post list is for today
    for (let back = 1; back <= 4; back += 1) {
      const d = new Date(Date.parse(`${today}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
      const doc = this.docs.read(dayDoc(d), null);
      if (doc && doc.post && doc.post.session === today) {
        lists.push({ kind: "evening", made: doc.post.at, picks: doc.post.picks, ai: doc.post.ai });
        break;
      }
    }
    const todo = lists.filter((l) => !rec.lists.some((x) => x.session === today && x.kind === l.kind));
    if (!todo.length) return 0;
    const day = (this.feat && this.feat.day === today && this.feat.today) || {};
    const need = [...new Set(todo.flatMap((l) => l.picks.map((p) => p.symbol)))].filter((s) => !day[s]);
    await pool(need, 3, async (s) => {
      const d = await this.market.daily(s);
      const last = d && d.candles ? d.candles[d.candles.length - 1] : null;
      if (last && String(last.t).slice(0, 10) === today) day[s] = { o: last.o, h: last.h, l: last.l, c: last.c };
    });
    const uni = Object.keys(day);
    for (const l of todo) {
      const result = P.scoreList(l.picks, day, uni);
      if (!result.n) continue;
      rec.lists.push({ session: today, kind: l.kind, made: l.made, ai: l.ai || null, result });
    }
    rec.lists = rec.lists.slice(-300);
    this.docs.write(RECORD, rec);
    this._lessons();
    return todo.length;
  }

  /** Once ten sessions are scored: what the record says, in the skills file every AI feature reads. */
  _lessons() {
    const r = this.record();
    if (r.sessions < 10 || !this.ai || !this.ai.playbook) return;
    const lines = [`Scored on ${r.sessions} sessions (${r.picks} picks), each pick from the open to the close in its direction: ${r.hitRate}% moved its way, ${r.avgPct}% on average; against the whole universe ${r.avgEdgePct > 0 ? "+" : ""}${r.avgEdgePct}% a session (beat it in ${r.beatUniverse} of ${r.sessions}).`];
    if (r.longs.n) lines.push(`Longs: ${r.longs.hitRate}% of ${r.longs.n} moved their way (${r.longs.avgPct}% on average). Shorts: ${r.shorts.n ? `${r.shorts.hitRate}% of ${r.shorts.n} (${r.shorts.avgPct}%)` : "none yet"}.`);
    const good = r.byReason.filter((x) => x.n >= 8).sort((a, b) => b.avgPct - a.avgPct);
    if (good.length >= 2) {
      const best = good.slice(0, 3).map((x) => `${P.TAG_NAME[x.tag] || x.tag} (${x.hitRate}% of ${x.n}, ${x.avgPct}%)`);
      const worst = good.slice(-2).map((x) => `${P.TAG_NAME[x.tag] || x.tag} (${x.hitRate}% of ${x.n}, ${x.avgPct}%)`);
      lines.push(`Reasons behind the best picks: ${best.join("; ")}. Behind the weakest: ${worst.join("; ")}.`);
    }
    lines.push("Counts from the desk's own lists, not promises.");
    try {
      this.ai.playbook.setSection(SECTION, lines.map((l) => `- ${l}`).join("\n"));
    } catch (_) {
      /* the record stays in the database */
    }
  }

  /* ------------------------------------------------------------------------------ views */
  _view(snap) {
    if (!snap) return null;
    const d = this.docs.read(dayDoc(istDate(Date.parse(snap.at))), null);
    return { ...snap, history: d ? d.snaps.filter((x) => x.session === snap.session).slice(-40) : [] };
  }

  /** What the Research tab shows. */
  view() {
    const snap = this._latest();
    const p = this.phaseOf();
    return {
      phase: p,
      snap: snap ? this._view(snap) : null,
      stale: Boolean(snap && snap.session !== p.session),
      running: Boolean(this.running),
      progress: this.progress,
      record: this.record(),
      settings: this.settings(),
      connected: this._mode() === "kite" || this._mode() === "demo",
      demo: this._mode() === "demo",
      tagNames: P.TAG_NAME,
    };
  }

  /** A short reading for TradeAI's agent. */
  brief() {
    const snap = this._latest();
    if (!snap) return { available: false, reason: "No Top 10 has been made yet." };
    const r = this.record();
    return {
      available: true,
      madeAt: `${snap.clock} IST`,
      phase: snap.phase,
      forSession: snap.session,
      list: snap.list.map((x) => ({ rank: x.rank, symbol: x.symbol, side: x.side, score: x.score, sector: x.sector, last: x.last, changePct: x.changePct, plan: x.plan, reasons: x.reasons.slice(0, 4), against: x.against, ai: x.ai || null })),
      left: snap.left,
      market: snap.context,
      ai: snap.ai && !snap.ai.failed ? { by: snap.ai.by, at: snap.ai.clock, summary: snap.ai.summary } : null,
      record: r.sessions ? { sessions: r.sessions, hitRatePct: r.hitRate, avgMovePct: r.avgPct, avgEdgeVsUniversePct: r.avgEdgePct } : null,
      note: "The desk's ranked list of stocks to trade, with each reason and its number. A ranking of evidence, not advice.",
    };
  }

  /* ------------------------------------------------------------------------------ clock */
  async tick() {
    const now = this.now();
    const day = istDate(now);
    if (!isWeekday(day) || this._mode() !== "kite" || this.running) return;
    const m = minuteOfDay(now);
    const latest = this._latest();
    const doc = this.docs.read(dayDoc(day), null);
    if (m >= 8 * 60 + 35 && m < 9 * 60 + 15) {
      if (!(doc && doc.pre)) await this.build({ phase: "pre" });
      return;
    }
    if (m >= 9 * 60 + 16 && m <= 15 * 60 + 25) {
      if (now - this._liveAt >= LIVE_EVERY_MS || !latest || latest.phase !== "live" || latest.session !== day) {
        this._liveAt = now;
        await this.build({ phase: "live" });
      }
      return;
    }
    if (m >= 15 * 60 + 45 && !(doc && doc.post)) await this.build({ phase: "post" });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[picks] ${err.message}`));
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { TopPicks, PicksError, SECTION };
