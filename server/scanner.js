"use strict";
// The live scanner (Research): the NIFTY 100 held in a buffer and read every two seconds, so the desk
// always knows which stocks are worth an intraday trade now, on which side, and why.
//
//   FEED      while Zerodha is connected on a weekday (9:00 AM – 3:40 PM IST) every NIFTY 100 stock and the
//             NIFTY 50 index are kept on the live stream (Zerodha's WebSocket: price, VWAP, volume, the day's
//             range, the order book). Each stock's 5-minute bars of the last few sessions are read once from
//             Zerodha's history — one stock at a time, well inside its limit of three a second — and again
//             every twenty minutes to correct any drift; today's bars are then built from the ticks.
//   READ      every two seconds the stocks that moved are read by market/scan.js: the readings (VWAP, EMA 9/21,
//             Supertrend, MACD, RSI, ADX, ATR, Bollinger, the opening range, yesterday's levels and the
//             pivots, volume against the usual, strength against the NIFTY, the order book), the score, the
//             next-move lean, the eligibility rules and the plan. The market's lean comes from the NIFTY's
//             own reading and the breadth of the hundred.
//   RECORD    every stock that turns eligible opens a call, followed to its first target, its stop or thirty
//             minutes; every lean is checked fifteen minutes on. The day's record is saved; the last thirty
//             sessions are kept — the scanner's accuracy is counted, not claimed.
//   AI        on need only: when the leading eligible names change (ten minutes apart at least), on the first
//             eligible list of the day, or when asked — within a daily limit. The AI Engine may order the
//             desk's candidates, keep or drop each one with a reason, and write a thesis and a risk; it cannot
//             add a stock, make an ineligible stock eligible, flip a side or move a level. Without a key the
//             desk's arithmetic stands.
//   SHARED    the leading eligible names are published to the shared research (ai/shared.js), so TradeAI and
//             every workspace read them without asking again.
//   PUSH      every change goes to the pages that asked for it on the live-price stream they already hold.
//
// It reads the market. It never trades. It lives outside server/ai (which holds no timers).

const { EventEmitter } = require("node:events");
const S = require("./market/scan");
const SNAP = require("./market/index-snapshots.json");
const KB = require("./market/knowledge");
const KC = require("./market/situation");
const { wantAi } = require("./ai/spend"); // an automatic AI wish becomes an ask the owner can allow (23 Nov 2026)

const NIFTY = { symbol: "NIFTY 50", token: 256265 };
const LOOP_MS = 1000;
const READ_MS = 2000;
const SEED_GAP_MS = 400;
const RESYNC_MS = 20 * 60000;
const SAVE_MS = 60000;
const AI_GAP_MS = 10 * 60000;
const FROM_MIN = 540; // 9:00 IST: the buffer is filled before the open
const TO_MIN = 940; // 15:40 IST
const SETTINGS = "scanner/settings.json";
const RECORD = "scanner/record.json";
const dayDoc = (d) => `scanner/day-${d}.json`;
const DEFAULTS = { aiMode: "need", aiDailyCap: 12 };
const MAX_PICKS = 8;
const MAX_WATCH = 6;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const IST = 5.5 * 3600 * 1000;
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 19);

class ScannerError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class Scanner extends EventEmitter {
  /** @param ai  the AiService (ai.scanAi, ai.shared), optional */
  constructor({ market, ai = null, docs, now = () => Date.now(), log = console, universe = null }) {
    super();
    this.setMaxListeners(200);
    this.market = market;
    this.ai = ai;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.fixedUniverse = universe; // tests
    this.states = new Map(); // symbol → buffer state
    this.byToken = new Map(); // token → symbol
    this.nifty = S.newState(NIFTY.symbol, NIFTY.token);
    this.rows = new Map(); // symbol → the latest reading
    this.niftyRow = null;
    this.lean = null;
    this.rec = null;
    this.state = "off";
    this.reason = "Waiting for Zerodha.";
    this.held = new Set();
    this.timers = [];
    this.seeding = false;
    this.lastSeedAt = 0;
    this.lastReadAt = 0;
    this.lastSaveAt = 0;
    this.lastBar = 0;
    this.readAt = 0;
    this.aiNote = null; // the AI's latest review
    this._aiBusy = false;
    this._shared = "";
    this._view = null;
    this._onTick = (t) => this._tick(t);
    this.edges = null; // () => each set-up's measured record (server/setuplab.js), set by the app
  }

  _edges() {
    try {
      return typeof this.edges === "function" ? this.edges() : null;
    } catch (_) {
      return null;
    }
  }

  /** One set-up with what it has measured on this desk (or null when not measured yet). */
  _withEdge(su, edges) {
    const e = edges ? edges[`${su.id}:${su.side}`] : null;
    return { ...su, edge: e && e.n ? { n: e.n, winPct: e.winPct, avgR: e.avgR } : null };
  }

  /* ------------------------------------------------------------------ settings */
  settings() {
    const d = (this.docs && this.docs.read(SETTINGS, null)) || {};
    const today = S.istDate(this.now());
    const cap = Number(d.aiDailyCap);
    return {
      aiMode: ["need", "off"].includes(d.aiMode) ? d.aiMode : DEFAULTS.aiMode,
      aiDailyCap: Number.isFinite(cap) && cap >= 0 ? Math.min(40, Math.round(cap)) : DEFAULTS.aiDailyCap,
      aiToday: d.ai && d.ai.day === today ? d.ai.n : 0,
      aiReady: Boolean(this.ai && this.ai.scanAi && this.ai.scanAi.ready()),
    };
  }

  setSettings(patch = {}) {
    const d = (this.docs && this.docs.read(SETTINGS, null)) || {};
    if (patch.aiMode !== undefined) {
      if (!["need", "off"].includes(patch.aiMode)) throw new ScannerError("The AI mode is need or off.");
      d.aiMode = patch.aiMode;
    }
    if (patch.aiDailyCap !== undefined) {
      const v = Number(patch.aiDailyCap);
      if (!Number.isFinite(v) || v < 0 || v > 40) throw new ScannerError("AI reviews a day: 0 to 40.");
      d.aiDailyCap = Math.round(v);
    }
    this.docs.write(SETTINGS, d);
    this._view = null;
    return this.settings();
  }

  _countAi() {
    const d = this.docs.read(SETTINGS, null) || {};
    const today = S.istDate(this.now());
    d.ai = d.ai && d.ai.day === today ? { day: today, n: d.ai.n + 1 } : { day: today, n: 1 };
    this.docs.write(SETTINGS, d);
  }

  /* ------------------------------------------------------------------ universe */
  universe() {
    if (Array.isArray(this.fixedUniverse)) return this.fixedUniverse.slice(0, 100);
    let list = null;
    try {
      list = this.market.indexList ? this.market.indexList.list("nifty100") : null;
    } catch (_) {
      list = null;
    }
    return (list && list.length ? list : SNAP.indices.nifty100 || []).slice(0, 100);
  }

  _live() {
    try {
      return this.market.mode() === "kite" && Boolean(this.market.kiteState().connected);
    } catch (_) {
      return false;
    }
  }

  _window(ms = this.now()) {
    const d = new Date(ms + IST);
    const day = d.getUTCDay();
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    return day >= 1 && day <= 5 && m >= FROM_MIN && m < TO_MIN;
  }

  /* --------------------------------------------------------------------- running */
  start() {
    if (this.timers.length) return;
    if (this.market.ticker) this.market.ticker.on("tick", this._onTick);
    const t = setInterval(() => this.loop().catch((err) => this.log.error(`[scanner] ${err.message}`)), LOOP_MS);
    if (t.unref) t.unref();
    this.timers.push(t);
  }

  stop() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    if (this.market.ticker) this.market.ticker.off("tick", this._onTick);
    this._hold([]);
    this._save(true);
  }

  _hold(tokens) {
    const tk = this.market.ticker;
    const next = new Set(tokens.filter((t) => Number.isInteger(t) && t > 0));
    const add = [...next].filter((t) => !this.held.has(t));
    const drop = [...this.held].filter((t) => !next.has(t));
    if (tk) {
      if (add.length) tk.subscribe(add);
      if (drop.length) tk.unsubscribe(drop);
    }
    this.held = next;
  }

  _set(state, reason = "") {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    this._view = null;
    this._push(true);
  }

  /** One turn of the loop: keep the feed, fill the buffer, read, record, push. */
  async loop() {
    const now = this.now();
    if (!this._live()) {
      if (this.held.size) this._hold([]);
      this._set("off", "Connect Zerodha (live data) to run the scanner: it reads the NIFTY 100 from Zerodha's live stream.");
      return;
    }
    if (!this._window(now)) {
      if (this.held.size) {
        this._hold([]);
        this._save(true);
      }
      this._set("closed", "The scanner runs on weekdays from 9:00 AM to 3:40 PM IST. The last session's reading and record stay on screen.");
      return;
    }
    await this._ensure();
    if (this.state !== "live" && this.state !== "filling") this._set("filling", "Filling the buffer from Zerodha…");
    if (!this.seeding && now - this.lastSeedAt >= SEED_GAP_MS) this._seedNext().catch(() => {});
    if (now - this.lastReadAt >= READ_MS) this.readAll();
    if (now - this.lastSaveAt >= SAVE_MS) this._save();
  }

  /** The instrument tokens of the hundred (and the index), held on the stream. */
  async _ensure() {
    const uni = this.universe();
    // once set up, looked at again every five minutes (a list change, a stock missing from the instruments)
    if (this.states.size && this.now() - (this._ensuredAt || 0) < 5 * 60000) return;
    this._ensuredAt = this.now();
    try {
      if (typeof this.market.instruments === "function") await this.market.instruments();
    } catch (err) {
      this._ensuredAt = 0; // tried again on the next turn
      this._set("filling", `The instrument list could not be read: ${err.message}`);
      return;
    }
    for (const s of uni) {
      if (this.states.has(s)) continue;
      const tok = typeof this.market._token === "function" ? this.market._token(s) : null;
      if (!tok) continue; // not on the instrument list (renamed or delisted): left out
      this.states.set(s, S.newState(s, tok));
      this.byToken.set(tok, s);
    }
    for (const s of [...this.states.keys()]) if (!uni.includes(s)) {
      this.byToken.delete(this.states.get(s).token);
      this.states.delete(s);
      this.rows.delete(s);
    }
    this.byToken.set(NIFTY.token, NIFTY.symbol);
    this._hold([NIFTY.token, ...[...this.states.values()].map((x) => x.token)]);
  }

  _tick(t) {
    if (!t || !this.held.has(t.token)) return;
    const sym = this.byToken.get(t.token);
    if (!sym) return;
    const st = sym === NIFTY.symbol ? this.nifty : this.states.get(sym);
    if (st) S.addTick(st, t, this.now());
  }

  /** The next stock whose bars have never been read, or the oldest past its re-read time. One at a time. */
  async _seedNext() {
    if (this.seeding) return; // one history read at a time, whoever asks
    const now = this.now();
    const all = [this.nifty, ...this.states.values()];
    let st = all.find((x) => !x.seededAt);
    if (!st) {
      const old = all.filter((x) => now - x.seededAt >= RESYNC_MS).sort((a, b) => a.seededAt - b.seededAt)[0];
      // a re-read every twelve seconds at most: the buffer is full, there is no hurry
      if (!old || now - this.lastSeedAt < 12000) return;
      st = old;
    }
    this.seeding = true;
    this.lastSeedAt = now;
    try {
      const to = new Date(now);
      const from = new Date(now - 7 * 86400000);
      const bars = await this.market._call((k) => k.historical(st.token, "5minute", from, to));
      S.seed(st, bars, this.now());
      if (st !== this.nifty && !st.daily) {
        try {
          const d = await this.market.daily(st.symbol);
          st.daily = S.dailyContext(d && d.candles, S.istDate(this.now()));
        } catch (_) {
          st.daily = null; // the readings that need it say so
        }
      } else if (st === this.nifty && !st.daily) {
        st.daily = S.dailyContext(this._dailyBars(bars), S.istDate(this.now()));
      }
    } catch (err) {
      st.seededAt = now - RESYNC_MS + 60000; // try this one again in a minute
      st.seedError = err && err.message ? err.message : String(err);
    } finally {
      this.seeding = false;
    }
  }

  /** Daily candles folded from 5-minute bars (the index's yesterday, for its levels). */
  _dailyBars(bars) {
    const by = new Map();
    for (const b of bars || []) {
      const t = S.msOf(b.t);
      if (!num(t)) continue;
      const d = S.istDate(t);
      const x = by.get(d);
      if (!x) by.set(d, { t: d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
      else {
        x.h = Math.max(x.h, b.h);
        x.l = Math.min(x.l, b.l);
        x.c = b.c;
        x.v += b.v || 0;
      }
    }
    return [...by.values()];
  }

  /* --------------------------------------------------------------------- reading */
  /** Read every stock that changed, rank, record, and decide whether the AI is needed. */
  readAll() {
    const now = this.now();
    this.lastReadAt = now;
    const today = S.istDate(now);
    if (!this.rec || this.rec.date !== today) this.rec = this._loadDay(today);
    if (this.nifty.dirty || !this.niftyRow) {
      this.niftyRow = S.read(this.nifty, { now });
      this.nifty.dirty = false;
    }
    const nf = this.niftyRow && this.niftyRow.ready ? this.niftyRow.f : null;
    const ctx = { now, nifty: nf, market: this.lean, edges: this._edges() };
    let changed = false;
    for (const [sym, st] of this.states) {
      if (!st.dirty && this.rows.has(sym)) continue;
      st.dirty = false;
      const prev = this.rows.get(sym);
      const r = S.read(st, ctx);
      this.rows.set(sym, r);
      changed = true;
      // a stock that has just turned eligible (or changed side) opens a call that is followed — but not
      // again while its last call on that side is open or was opened in the last fifteen minutes (a stock
      // hovering at a rule's edge must not count as many calls)
      if (r.ready && r.eligible && (!prev || !prev.eligible || prev.side !== r.side)) {
        const recent = this.rec.calls.some((c) => c.symbol === sym && c.side === r.side && (!c.outcome || now - c.at < 15 * 60000));
        if (!recent) S.openCall(this.rec, r, now);
      }
    }
    const rows = [...this.rows.values()];
    this.lean = S.marketLean(this.niftyRow, rows);
    const priceOf = (s) => {
      const st = this.states.get(s);
      return st && st.tick ? st.tick.last : null;
    };
    S.followCalls(this.rec, priceOf, now);
    // at each 5-minute close every lean is written down, to be checked fifteen minutes on
    const bar = S.bucket(now);
    if (bar !== this.lastBar) {
      if (this.lastBar) S.addLeans(this.rec, rows, now);
      this.lastBar = bar;
    }
    S.settleLeans(this.rec, priceOf, now);
    const ready = rows.filter((r) => r.ready).length;
    if (ready >= Math.min(20, this.states.size) && this.state !== "live") this._set("live", "");
    if (changed || !this._view) {
      this.readAt = now;
      this._view = null;
      this._push();
      this._afterRead();
    }
  }

  _ranked() {
    const rows = [...this.rows.values()].filter((r) => r.ready);
    const key = (r) => Math.abs(r.score) * (r.agree || 0);
    const picks = rows.filter((r) => r.eligible).sort((a, b) => key(b) - key(a));
    const watch = rows.filter((r) => !r.eligible && r.next.dir !== "flat" && Math.abs(r.score) >= 25).sort((a, b) => key(b) - key(a));
    // the AI's order, where it has given one, for the names it kept (eligibility is still the desk's)
    const order = this.aiNote && !this.aiNote.failed ? this.aiNote.order || [] : [];
    if (order.length) {
      const pos = new Map(order.map((s, i) => [s, i]));
      picks.sort((a, b) => (pos.has(a.symbol) ? pos.get(a.symbol) : 99) - (pos.has(b.symbol) ? pos.get(b.symbol) : 99) || key(b) - key(a));
    }
    return { picks, watch, rows };
  }

  _afterRead() {
    const { picks } = this._ranked();
    this._share(picks.slice(0, 5));
    const why = this._aiNeed(picks);
    if (why) Promise.resolve(wantAi(this.ai, { key: "scanner-review", feature: "Live scanner — the AI's review", why: String(why), page: "screener" }, () => this.review(why))).catch(() => {});
  }

  /* -------------------------------------------------------------------------- AI */
  _aiNeed(picks) {
    const st = this.settings();
    if (st.aiMode !== "need" || !st.aiReady || st.aiToday >= st.aiDailyCap || !picks.length || this._aiBusy) return "";
    const top = picks.slice(0, 3).map((r) => r.symbol);
    const last = this.aiNote;
    const today = S.istDate(this.now());
    if (!last || S.istDate(Date.parse(last.at)) !== today) return "the first eligible list of the day";
    if (this.now() - Date.parse(last.at) < AI_GAP_MS) return "";
    const seen = new Set(last.symbols || []);
    const fresh = top.filter((s) => !seen.has(s));
    if (fresh.length) return `${fresh.join(", ")} came to the top`;
    return "";
  }

  _candidate(r) {
    const f = r.f;
    return {
      symbol: r.symbol,
      eligible: r.eligible,
      side: r.side || (r.next.dir === "up" ? "long" : r.next.dir === "down" ? "short" : null),
      score: r.score,
      agreePct: Math.round((r.agree || 0) * 100),
      next: { dir: r.next.dir, strength: r.next.strength, rangeLow: r.next.rangeLow, rangeHigh: r.next.rangeHigh },
      plan: r.plan,
      reasons: r.reasons.slice(0, 6).map((x) => x.text),
      against: r.against.slice(0, 4).map((x) => x.text),
      blocks: r.blocks,
      setups: (r.f.setups || []).map((su) => this._withEdge(su, this._edges())).map((su) => ({ setup: su.name, side: su.side, why: su.why, measured: su.edge ? `${su.edge.avgR}R a trade after costs over ${su.edge.n} trades (${su.edge.winPct}% won)` : "not yet measured" })),
      data: { last: f.last, chgPct: f.chgPct, vwap: f.vwap, vsVwapAtr: f.vsVwapAtr, rsi: f.rsi, adx: f.adx, macdHist: f.macdHist, supertrend: f.supertrend, orb: f.orb, relVol: f.relVol, rsNifty: f.rsNifty, bookBuyPct: f.bookBuyPct, atrPct: f.atrPct, pdh: f.pdh, pdl: f.pdl, dailyTrend: f.dailyTrend, turnoverCr: f.turnoverCr },
      // the knowledge base's checks on this stock now (market/situation.js): which rules agree, which argue against
      knowledge: f.knowledge && f.knowledge.notes.length ? { vote: f.knowledge.vote, checks: f.knowledge.notes.slice(0, 7).map((n) => `[${n.stance}${n.side === "both" ? "" : ` ${n.side}`}] ${n.text} (${n.title})`) } : null,
    };
  }

  /** The AI Engine's look at the desk's candidates. `why` says what asked for it. */
  async review(why = "you asked") {
    if (this._aiBusy) throw new ScannerError("The AI is already reviewing the list.", "busy", 409);
    if (!this.ai || !this.ai.scanAi || !this.ai.scanAi.ready()) throw new ScannerError("No AI company is set up: add a key on the AI page.", "not_configured", 409);
    const asked = why === "you asked";
    const st = this.settings();
    if (!asked && this.ai.guard && !this.ai.guard.autoAllowed()) return null; // AI credit protection: only a click asks the AI
    if (!asked && st.aiToday >= st.aiDailyCap) return null;
    const { picks, watch } = this._ranked();
    const cands = [...picks.slice(0, MAX_PICKS), ...watch.slice(0, 4)];
    if (!cands.length) throw new ScannerError("Nothing to review yet: no stock is eligible or close to it.", "no_data", 409);
    this._aiBusy = true;
    const at = this.now();
    try {
      const input = {
        timeIST: clock(at).slice(0, 5),
        market: this.lean ? { score: this.lean.score, dir: this.lean.dir, nifty: this.lean.nifty, breadth: this.lean.breadth } : null,
        record: S.recordSummary(this.rec || S.newRecord(S.istDate(at))),
        history: this._history().summary,
        candidates: cands.map((r) => this._candidate(r)),
        // the desk's knowledge base: only the rules that matter now (the set-ups in play, the time of day, risk, costs)
        playbook: KB.relevant({ setups: cands.flatMap((r) => (r.f.setups || []).map((su) => su.id)), minute: S.istMin(at), market: this.lean }, 3000),
      };
      const r = await this.ai.scanAi.review(input, { fresh: asked });
      if (!r) throw new Error("no answer");
      if (!r.cached) this._countAi();
      const known = new Map(cands.map((x) => [x.symbol, x]));
      const notes = {};
      const order = [];
      for (const o of r.picks) {
        const x = known.get(o.symbol);
        if (!x || notes[o.symbol]) continue; // only the desk's candidates, once each
        notes[o.symbol] = { keep: o.keep, thesis: o.thesis, risk: o.risk, confidence: o.confidence };
        if (o.keep && x.eligible) order.push(o.symbol);
      }
      this.aiNote = { at: new Date(this.now()).toISOString(), clock: clock(this.now()), by: r.by, why, summary: r.summary, marketView: r.marketView, notes, order, symbols: picks.slice(0, 3).map((x) => x.symbol) };
    } catch (err) {
      this.aiNote = { at: new Date(this.now()).toISOString(), clock: clock(this.now()), failed: true, why, error: String(err && err.message ? err.message : err).slice(0, 160), symbols: picks.slice(0, 3).map((x) => x.symbol), notes: (this.aiNote && this.aiNote.notes) || {} };
    } finally {
      this._aiBusy = false;
      this._view = null;
      this._push(true);
    }
    return this.aiNote;
  }

  _share(top) {
    if (!this.ai || !this.ai.shared || !top.length) return;
    const key = top.map((r) => `${r.symbol}:${r.side}`).join(",");
    if (key === this._shared && this.now() - (this._sharedAt || 0) < 10 * 60000) return;
    this._shared = key;
    this._sharedAt = this.now();
    top.forEach((r, i) => {
      try {
        const note = this.aiNote && !this.aiNote.failed && this.aiNote.notes ? this.aiNote.notes[r.symbol] : null;
        this.ai.shared.publish({
          feature: "scanner",
          symbol: r.symbol,
          by: note ? `Desk + ${this.aiNote.by}` : "Desk scanner",
          last: r.f.last,
          summary: `Live scanner #${i + 1}: ${String(r.side).toUpperCase()} eligible, score ${r.score} (${Math.round(r.agree * 100)}% agree). ${r.next.text} Plan: entry ${r.plan.entry}, stop ${r.plan.stop}, T1 ${r.plan.t1}.${note && note.thesis ? ` AI: ${note.thesis}` : ""}`,
          tags: { side: r.side, rank: i + 1, lean: r.next.dir, strength: r.next.strength },
          facts: { entry: r.plan.entry, stop: r.plan.stop, target: r.plan.t1, target2: r.plan.t2 },
          ttlMin: 15,
        });
      } catch (_) {
        /* sharing never fails the scan */
      }
    });
  }

  /* ---------------------------------------------------------------------- record */
  _loadDay(date) {
    const d = this.docs ? this.docs.read(dayDoc(date), null) : null;
    const rec = d && d.record && d.record.date === date ? d.record : S.newRecord(date);
    if (!Array.isArray(rec.leans)) rec.leans = [];
    return rec;
  }

  _save(force = false) {
    if (!this.docs || !this.rec) return;
    this.lastSaveAt = this.now();
    try {
      const light = { ...this.rec, leans: force ? [] : this.rec.leans.slice(-1500) };
      this.docs.write(dayDoc(this.rec.date), { date: this.rec.date, savedAt: new Date(this.now()).toISOString(), record: light, summary: S.recordSummary(this.rec), last: this._view ? { at: this._view.at, market: this._view.market, picks: this._view.picks.slice(0, 5) } : null });
      const h = this.docs.read(RECORD, null) || { sessions: [] };
      const sum = S.recordSummary(this.rec);
      h.sessions = [...h.sessions.filter((x) => x.date !== this.rec.date), sum].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-30);
      this.docs.write(RECORD, h);
      this._hist = null;
    } catch (err) {
      this.log.error(`[scanner] could not save the record: ${err.message}`);
    }
  }

  /** The last thirty sessions' record, added up. */
  _history() {
    if (this._hist && this.now() - this._hist.at < 60000) return this._hist.v;
    const h = (this.docs && this.docs.read(RECORD, null)) || { sessions: [] };
    const s = h.sessions || [];
    const add = (k) => s.reduce((a, x) => a + (x[k] || 0), 0);
    const tg = add("targets");
    const sp = add("stops");
    const lean = {};
    for (const x of s) {
      for (const [k, v] of Object.entries(x.lean || {})) {
        const t = lean[k] || (lean[k] = { n: 0, right: 0, wrong: 0 });
        t.n += v.n || 0;
        t.right += v.right || 0;
        t.wrong += v.wrong || 0;
      }
    }
    for (const v of Object.values(lean)) v.rightPct = v.right + v.wrong ? Math.round((v.right / (v.right + v.wrong)) * 100) : null;
    const v = { sessions: s.slice(-10), summary: { sessions: s.length, calls: add("calls"), targets: tg, stops: sp, timedOut: add("timedOut"), hitPct: tg + sp ? Math.round((tg / (tg + sp)) * 100) : null, lean } };
    this._hist = { at: this.now(), v };
    return v;
  }

  /* ------------------------------------------------------------------------ views */
  _row(r, rank = null) {
    const f = r.f;
    const note = this.aiNote && this.aiNote.notes ? this.aiNote.notes[r.symbol] || null : null;
    return {
      rank,
      symbol: r.symbol,
      eligible: r.eligible,
      side: r.side,
      score: r.score,
      agree: r.agree,
      next: r.next,
      plan: r.plan,
      reasons: r.reasons.slice(0, 5),
      against: r.against.slice(0, 3),
      blocks: r.blocks,
      setups: (f.setups || []).map((su) => this._withEdge(su, this._edges())),
      // the rows go out on every push: the first few checks only (the warnings come first); the detail has all
      knowledge: KC.brief(f.knowledge, { limit: 4 }),
      ai: note,
      f: { last: f.last, chgPct: f.chgPct, vwap: f.vwap, vsVwapPct: f.vsVwapPct, vsVwapAtr: f.vsVwapAtr, ema9: f.ema9, ema21: f.ema21, rsi: f.rsi, macdHist: f.macdHist, supertrend: f.supertrend, adx: f.adx, plusDI: f.plusDI, minusDI: f.minusDI, atr5: f.atr5, atrPct: f.atrPct, bbPctB: f.bbPctB, squeeze: f.squeeze, orb: f.orb, orh: f.orh, orl: f.orl, pdh: f.pdh, pdl: f.pdl, relVol: f.relVol, rsNifty: f.rsNifty, roc3: f.roc3, bookBuyPct: f.bookBuyPct, dayHigh: f.dayHigh, dayLow: f.dayLow, turnoverCr: f.turnoverCr, dailyTrend: f.dailyTrend },
    };
  }

  /** What the page shows: the market, the eligible picks, the near misses, the board, the record. */
  view() {
    if (this._view) return this._view;
    const now = this.now();
    const { picks, watch, rows } = this._ranked();
    const seeded = [...this.states.values()].filter((x) => x.seededAt && !x.seedError).length;
    const ticking = [...this.states.values()].filter((x) => x.tick && now - x.tick.at < 60000).length;
    this._view = {
      at: new Date(now).toISOString(),
      clock: clock(now),
      readAt: this.readAt ? new Date(this.readAt).toISOString() : null,
      state: this.state,
      reason: this.reason,
      universe: { name: "NIFTY 100", size: this.states.size || this.universe().length, seeded, ticking, ready: rows.length },
      market: this.lean,
      picks: picks.slice(0, MAX_PICKS).map((r, i) => this._row(r, i + 1)),
      watch: watch.slice(0, MAX_WATCH).map((r) => this._row(r)),
      eligibleCount: picks.length,
      board: [...this.rows.values()]
        .map((r) => (r.ready ? { s: r.symbol, last: r.f.last, chg: r.f.chgPct, sc: r.score, ag: r.agree, dir: r.next.dir, str: r.next.strength, el: r.eligible, side: r.side, vw: r.f.vsVwapPct, rsi: r.f.rsi, adx: r.f.adx, rv: r.f.relVol, rsn: r.f.rsNifty, orb: r.f.orb, st: r.f.supertrend, why: r.eligible ? (r.reasons[0] ? r.reasons[0].text : "") : r.blocks[0] || "", su: (r.f.setups || []).map((x) => `${x.id}:${x.side}`) } : { s: r.symbol, wait: r.reason }))
        .sort((a, b) => (b.el ? 1 : 0) - (a.el ? 1 : 0) || Math.abs(b.sc || 0) - Math.abs(a.sc || 0)),
      record: this.rec ? S.recordSummary(this.rec) : null,
      history: this._history().summary,
      ai: this.aiNote ? { at: this.aiNote.at, clock: this.aiNote.clock, by: this.aiNote.by || null, why: this.aiNote.why, summary: this.aiNote.summary || "", marketView: this.aiNote.marketView || "", failed: Boolean(this.aiNote.failed), error: this.aiNote.error || "" } : null,
      aiBusy: this._aiBusy,
      settings: this.settings(),
      rules: S.RULES,
    };
    return this._view;
  }

  /** The latest reading of one stock in short form (the paper robot reads it to see whether the call has flipped). */
  rowOf(symbol) {
    const r = this.rows.get(String(symbol || "").toUpperCase());
    return r && r.ready ? { symbol: r.symbol, eligible: r.eligible, side: r.side, score: r.score, agree: r.agree } : null;
  }

  /** The last price seen on the stream for one stock. */
  priceOf(symbol) {
    const st = this.states.get(String(symbol || "").toUpperCase());
    return st && st.tick && num(st.tick.last) ? st.tick.last : null;
  }

  /** Everything about one stock in the buffer. */
  detail(symbol) {
    const s = String(symbol || "").toUpperCase();
    const st = this.states.get(s);
    if (!st) throw new ScannerError(`${s || "That stock"} is not in the NIFTY 100 scanner.`, "not_found", 404);
    const r = this.rows.get(s) || S.read(st, { now: this.now(), nifty: this.niftyRow && this.niftyRow.ready ? this.niftyRow.f : null, market: this.lean });
    if (!r.ready) return { symbol: s, ready: false, reason: r.reason };
    return { ...this._row(r), knowledge: KC.brief(r.f.knowledge, { limit: 14 }), ready: true, f: r.f, votes: r.votes, reasons: r.reasons, against: r.against, calls: (this.rec ? this.rec.calls : []).filter((c) => c.symbol === s).slice(-10) };
  }

  /** A short form for TradeAI's agent. */
  brief() {
    const v = this.view();
    return {
      state: v.state,
      reason: v.reason,
      at: v.clock,
      market: v.market,
      eligible: v.picks.map((p) => ({ rank: p.rank, symbol: p.symbol, side: p.side, score: p.score, agreePct: Math.round(p.agree * 100), next: p.next.text, plan: p.plan, reasons: p.reasons.map((x) => x.text).slice(0, 3), ai: p.ai })),
      nearMisses: v.watch.map((p) => ({ symbol: p.symbol, lean: p.next.dir, score: p.score, blockedBy: p.blocks.slice(0, 2) })),
      record: v.record,
      history: v.history,
      ai: v.ai,
    };
  }

  /* ----------------------------------------------------------------------- push */
  _push(now = false) {
    if (!this.listenerCount("update")) return;
    if (now) {
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
      this.emit("update", this.view());
      return;
    }
    if (this._pushTimer) return;
    this._pushTimer = setTimeout(() => {
      this._pushTimer = null;
      this.emit("update", this.view());
    }, 200);
    if (this._pushTimer.unref) this._pushTimer.unref();
  }

  /** A page wants the scanner: `send(view)` now and on every change, until the returned function is called. */
  watch(send) {
    this.on("update", send);
    try {
      send(this.view());
    } catch (_) {
      /* the page went away */
    }
    return () => this.off("update", send);
  }
}

module.exports = { Scanner, ScannerError, NIFTY };
