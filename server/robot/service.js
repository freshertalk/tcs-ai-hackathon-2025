"use strict";
// The paper robot (Trade Analysis → Robot): a mock trader that takes the advisor's calls with play money,
// records everything it does like a flight recorder, is compared with the trader's real day after the
// close, corrects its own mistakes, and studies the whole NIFTY 100 every evening to learn which levels
// to suggest.
//
//   TRADE     while Zerodha is connected, every few seconds in NSE hours, the live scanner's eligible picks
//             (the advisor's calls on the NIFTY 100, with their entry, stop and targets) are passed through
//             the robot's gate (engine.js); one that passes is entered at the price seen with a little
//             slippage, sized from the paper capital and the risk to the stop, and run by the rulebook:
//             half at the first target, the stop to the entry, a trailing stop, out on the give-back, a flip
//             of the advisor's call, too long in it, or the 3:15 PM square-off.
//   RECORD    the flight recorder: a frame of every open position every 15 seconds (price, P&L, the
//             scanner's score), every event (entry, stop moved, target, exit) and every decision —
//             including each call it skipped and the first reason why — kept one record per day
//             (robot/day-DATE.json); every finished trade also joins the robot_trades table. After the exit
//             each trade's stock is followed for 45 minutes to see what the price did next.
//   COMPARE   from 3:50 PM the day is set against the trader's actual trades (compare.js): the stocks both
//             traded, the advisor's calls the trader skipped, the trader's trades the robot did not take and
//             why, the trader's habits and the rule that answers each. Kept in the robot_days table.
//   IMPROVE   after the comparison its mistakes are counted (improve.js) and, where one has happened often
//             enough, ONE change to its rulebook is made with the evidence; each change is measured five
//             sessions later and undone if the trades since average worse. With an AI model saved, the AI
//             Engine reads the day once and may veto a proposed change by id (robotai.js); it cannot invent
//             one or move a number.
//   STUDY     from 4 PM it reads the NIFTY 100's 5-minute bars, trades every level's first test of every
//             session two ways (levels.js), and adds them to the Level Book (robot_study table). The book's
//             best levels for the next session are the robot's suggestions; its skill is counted out of
//             sample, session by session, and reaches "graduated" only after 15 sessions studied and the
//             suggestions beating the average level.
//
// It reads the scanner and the market and the trader's own records. It never places, changes or cancels an
// order, never reads or changes the real trading switch, and loads neither the broker nor the trading
// service. It holds its own timer, outside server/ai. Paper results leave out queue position and partial
// fills: it is not advice and it promises nothing.

const E = require("./engine");
const L = require("./levels");
const I = require("./improve");
const C = require("./compare");
const SNAP = require("../market/index-snapshots.json");

const IST = 5.5 * 3600 * 1000;
const STATE = "robot/state.json";
const dayName = (d) => `robot/day-${d}.json`;
const INDEX = "robot/index.json";
const TRADES = "robot_trades"; // one record per finished paper trade
const DAYS = "robot_days"; // one record per session: the comparison, the corrections, the AI's note
const STUDY = "robot_study"; // one record per studied session: the Level Book's rows
const SECTION_ROBOT = "## The paper robot (written by itself)";
const SECTION_LEVELS = "## Entry levels measured on the NIFTY 100 (written by itself)";
const FRAME_MS = 15000;
const SAVE_MS = 30000;
const MAX_FRAMES = 2400;
const MAX_DECISIONS = 400;
const KEEP_DAYS = 90;
const STUDY_DAYS_FIRST = 45; // calendar days of 5-minute history on the first run: about 30 sessions
const STUDY_DAYS_DAILY = 9;
const SESSIONS_TARGET = 15;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istParts = (ms) => {
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msOf = (t) => {
  if (num(t)) return t;
  const x = String(t || "").replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(/[+-]\d{2}:\d{2}$|Z$/.test(x) ? x : `${x}+05:30`);
};

class RobotError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class PaperRobot {
  /**
   * @param feed    the scanner's door: { live(): bool, picks(): [row], rowOf(sym), priceOf(sym), detail(sym), lean(): number|null }
   * @param market  the MarketService (the NIFTY 100 list and the 5-minute history), optional
   * @param actual  async (date) → the trader's trades of that day (the Trade Analysis snapshot's trades)
   * @param ai      the AiService (ai.robotCoach, ai.configured(), ai.playbook), optional
   */
  constructor({ docs, feed, market = null, actual = null, ai = null, now = () => Date.now(), log = console, isHoliday = () => false, gapMs = 400 }) {
    this.docs = docs;
    this.feed = feed;
    this.market = market;
    this.actual = actual;
    this.ai = ai;
    this.now = now;
    this.log = log;
    this.isHoliday = isHoliday;
    this.gapMs = gapMs;
    this.timer = null;
    this.job = null;
    this.rec = null;
    this.s = this._load();
    this._frameAt = 0;
    this._saveAt = 0;
    this._dirty = false;
    this._afterBusy = false;
    this._bookCache = null;
    this._lastClosed = {};
  }

  /* ------------------------------------------------------------------------------- storage */

  _load() {
    const d = this.docs.read(STATE, null) || {};
    return {
      on: "on" in d ? Boolean(d.on) : true,
      since: d.since || null,
      withAi: "withAi" in d ? Boolean(d.withAi) : true,
      rules: E.clampRules(d.rules || {}),
      corrections: Array.isArray(d.corrections) ? d.corrections : [],
      open: Array.isArray(d.open) ? d.open : [],
      finished: d.finished && typeof d.finished === "object" ? d.finished : {},
      backfilled: Boolean(d.backfilled),
      notes: Array.isArray(d.notes) ? d.notes : [],
      log: Array.isArray(d.log) ? d.log : [],
    };
  }

  _save(force = true) {
    if (!force && this.now() - this._saveAt < SAVE_MS) return;
    this._saveAt = this.now();
    this._dirty = false;
    this.docs.write(STATE, this.s);
    if (this.rec) this.docs.write(dayName(this.rec.date), this.rec);
  }

  _tbl(name) {
    return typeof this.docs.items === "function" ? this.docs.items(name) : [];
  }

  _put(name, list) {
    if (list.length && typeof this.docs.putItems === "function") this.docs.putItems(name, list);
  }

  _note(text) {
    this.s.log = [{ at: new Date(this.now()).toISOString(), text }, ...this.s.log].slice(0, 60);
    this._dirty = true;
  }

  /** Today's flight record, from memory or from the database (a restart in the session keeps it). */
  _rec(date) {
    if (this.rec && this.rec.date === date) return this.rec;
    if (this.rec) this.docs.write(dayName(this.rec.date), this.rec);
    const d = this.docs.read(dayName(date), null);
    this.rec = d && d.date === date ? d : { date, trades: {}, decisions: [], frames: {}, openedAt: null };
    const ix = this.docs.read(INDEX, null) || { days: [] };
    if (!ix.days.includes(date)) {
      ix.days = [...ix.days, date].sort().slice(-KEEP_DAYS);
      this.docs.write(INDEX, ix);
    }
    return this.rec;
  }

  /* ----------------------------------------------------------------------------- settings */

  settings() {
    return { on: this.s.on, withAi: this.s.withAi, aiReady: Boolean(this.ai && typeof this.ai.configured === "function" && this.ai.configured() && this.ai.robotCoach), capital: this.s.rules.capital, riskPct: this.s.rules.riskPct, since: this.s.since };
  }

  setSettings(p = {}) {
    if (typeof p.on === "boolean") {
      this.s.on = p.on;
      if (p.on && !this.s.since) this.s.since = new Date(this.now()).toISOString();
      this._note(p.on ? "The robot is on." : "The robot is off: open positions are still managed to their exit.");
    }
    if (typeof p.withAi === "boolean") this.s.withAi = p.withAi;
    if (p.capital !== undefined || p.riskPct !== undefined) {
      const next = { ...this.s.rules };
      if (p.capital !== undefined) {
        const v = Number(p.capital);
        if (!(v >= 10000 && v <= 1e9)) throw new RobotError("The paper capital must be between ₹10,000 and ₹100 crore.");
        next.capital = Math.round(v);
      }
      if (p.riskPct !== undefined) {
        const v = Number(p.riskPct);
        if (!(v >= 0.1 && v <= 1)) throw new RobotError("The risk per trade must be between 0.1% and 1% of the capital.");
        next.riskPct = v;
      }
      this.s.rules = E.clampRules(next);
    }
    this._save();
    return this.settings();
  }

  /** The rulebook now, against the defaults it started from. */
  rules() {
    const rows = [];
    const cur = this.s.rules;
    const flat = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
    const base = Object.fromEntries(flat(E.DEFAULTS));
    for (const [k, v] of flat(cur)) rows.push({ param: k, value: v, start: base[k] === undefined ? null : base[k], changed: JSON.stringify(v) !== JSON.stringify(base[k]) });
    return { rules: cur, rows, bounds: E.BOUNDS };
  }

  resetRules() {
    this.s.rules = E.clampRules({ capital: this.s.rules.capital, riskPct: DEFAULT_RISK(this.s.rules) });
    for (const c of this.s.corrections) if (c.status === "active") c.status = "reverted";
    this._note("The rulebook was set back to its starting values.");
    this._save();
    return this.rules();
  }

  /* --------------------------------------------------------------------------- the session */

  _live() {
    try {
      return Boolean(this.feed && this.feed.live());
    } catch (_) {
      return false;
    }
  }

  /** Called every few seconds by the timer (and directly by tests). */
  tick() {
    const now = this.now();
    const t = istParts(now);
    if (t.dow === 0 || t.dow === 6 || this.isHoliday(t.date)) return null;
    if (t.mins >= 9 * 60 + 15 && t.mins <= 15 * 60 + 31) {
      if (!this._live()) return null;
      if (!this.s.on && !this.s.open.length) return null;
      this._session(now);
      return "session";
    }
    if (t.mins > 15 * 60 + 31) {
      // the scanner stops at 3:40 PM: what happens after the close (the comparison, the corrections, the study) does not need it
      this._closeOut(now);
      this._watch(now);
      this._after(now).catch((err) => this.log.log(`[robot] ${err.message}`));
      return "after";
    }
    return null;
  }

  _ctx(now, rec) {
    const rules = this.s.rules;
    const openSymbols = new Set(this.s.open.map((p) => p.symbol));
    const today = Object.keys(rec.trades).length + this.s.open.length;
    const net = Object.values(rec.trades).reduce((a, t) => a + (t.net || 0), 0) + this.s.open.reduce((a, p) => a + this._unreal(p), 0);
    return { now, openSymbols, open: this.s.open.length, today, dayNetPct: (net / rules.capital) * 100, lastClosed: this._lastClosed, date: istParts(now).date, lean: this._lean(), levelEdge: null };
  }

  _unreal(p) {
    const dir = p.side === "long" ? 1 : -1;
    return num(p.last) ? p.realised + dir * (p.last - p.entryAvg) * p.qty : p.realised;
  }

  _lean() {
    try {
      const v = this.feed.lean ? this.feed.lean() : null;
      return num(v) ? v : null;
    } catch (_) {
      return null;
    }
  }

  _decide(rec, now, d) {
    const key = `${d.symbol}|${d.action}|${d.why}`;
    const last = [...rec.decisions].reverse().find((x) => `${x.symbol}|${x.action}|${x.why}` === key);
    if (last && now - last.at < 10 * 60000) return;
    rec.decisions.push({ at: now, clock: E.clockOf(now), ...d });
    if (rec.decisions.length > MAX_DECISIONS) rec.decisions.splice(0, rec.decisions.length - MAX_DECISIONS);
    this._dirty = true;
  }

  _session(now) {
    const rules = this.s.rules;
    const rec = this._rec(istParts(now).date);
    if (!rec.openedAt) rec.openedAt = new Date(now).toISOString();
    // run what is open
    for (const pos of [...this.s.open]) {
      const price = this.feed.priceOf(pos.symbol);
      if (num(price)) pos.last = price;
      const row = this.feed.rowOf ? this.feed.rowOf(pos.symbol) : null;
      const flip = Boolean(row && row.eligible && row.side && row.side !== pos.side && Math.abs(row.score || 0) >= rules.minScore);
      E.step(pos, num(price) ? price : null, now, rules, { flip, reason: "The scanner now has an eligible call on the other side" });
      if (pos.status === "closed") this._land(pos, now);
      else if (now - (pos.frameAt || 0) >= FRAME_MS && num(pos.last)) {
        pos.frameAt = now;
        const f = rec.frames[pos.id] || (rec.frames[pos.id] = []);
        if (f.length < MAX_FRAMES) f.push([now, pos.last, r2(this._unreal(pos)), row ? Math.round(row.score || 0) : null]);
      }
    }
    // take the advisor's calls
    if (this.s.on) {
      let picks = [];
      try {
        picks = this.feed.picks() || [];
      } catch (_) {
        picks = [];
      }
      let taken = 0;
      const book = this._book();
      for (const pick of picks) {
        if (taken >= 1) break;
        const ctx = this._ctx(now, rec);
        let g = E.gate(pick, rules, ctx);
        if (!g.ok) {
          if (pick && pick.eligible) this._decide(rec, now, { symbol: pick.symbol, side: pick.side, action: "skip", why: g.why, score: Math.round(Math.abs(pick.score || 0)) });
          continue;
        }
        // the Level Book's word on the kind of level it is entering at
        let level = null;
        try {
          const d = this.feed.detail ? this.feed.detail(pick.symbol) : null;
          const f = d && d.f ? d.f : null;
          const price = this.feed.priceOf(pick.symbol);
          const near = f ? L.nearestLevel(f, num(price) ? price : pick.plan.entry, f.atr5) : null;
          if (near) {
            const play = (pick.side === "long") === near.below ? "bounce" : "break";
            const e = book ? L.edge(book, pick.symbol, near.kind, play, pick.side) : null;
            level = { kind: near.kind, name: L.KINDS[near.kind], play, level: near.level, ev: e ? e.ev : null, hit: e ? e.hit : null, n: e ? e.pooledN : null };
            ctx.levelEdge = e;
          }
        } catch (_) {
          /* the Level Book is only an extra check */
        }
        g = E.gate(pick, rules, ctx);
        if (!g.ok) {
          this._decide(rec, now, { symbol: pick.symbol, side: pick.side, action: "skip", why: g.why, score: Math.round(Math.abs(pick.score || 0)) });
          continue;
        }
        const id = `${rec.date}:${pick.symbol}:${Object.keys(rec.trades).length + this.s.open.length + 1}`;
        const pos = E.openPosition(pick, rules, { now, id, level, lean: ctx.lean });
        if (!pos) {
          this._decide(rec, now, { symbol: pick.symbol, side: pick.side, action: "skip", why: "could not be sized inside the risk and position limits", score: Math.round(Math.abs(pick.score || 0)) });
          continue;
        }
        pos.last = pos.entryAvg;
        pos.events.push({ at: now, clock: E.clockOf(now), kind: "entry", text: `${pos.side === "long" ? "Bought" : "Sold short"} ${pos.qty} ${pos.symbol} at ₹${pos.entryAvg.toFixed(2)}: score ${pos.score}, ${pos.agree}% of the engines agree. Stop ₹${pos.stop.toFixed(2)}, targets ₹${pos.t1.toFixed(2)} and ₹${pos.t2.toFixed(2)}${level ? `; at ${level.name}${level.ev !== null ? ` (the book: ${level.ev > 0 ? "+" : ""}${level.ev}R, ${level.hit}% won)` : ""}` : ""}.`, price: pos.entryAvg });
        this.s.open.push(pos);
        this._decide(rec, now, { symbol: pos.symbol, side: pos.side, action: "enter", why: pos.why[0] || "an eligible call", score: pos.score });
        this._frame(rec, pos, now);
        taken += 1;
        this._save();
      }
    }
    this._watch(now);
    if (this._dirty) this._save(false);
  }

  _frame(rec, pos, now) {
    pos.frameAt = now;
    (rec.frames[pos.id] || (rec.frames[pos.id] = [])).push([now, pos.last, r2(this._unreal(pos)), pos.score]);
  }

  /** A finished position: its figures, the table, the cooldown. */
  _land(pos, now) {
    const rec = this._rec(pos.date);
    const t = E.finish(pos);
    t.after = { until: t.exitAt + 45 * 60000, best: null, worst: null };
    this.s.open = this.s.open.filter((p) => p.id !== pos.id);
    rec.trades[t.id] = t;
    this._lastClosed[t.symbol] = t.exitAt;
    this._put(TRADES, [this._flat(t)]);
    this._note(`${t.symbol} ${t.side}: ${t.why}, ${t.net >= 0 ? "+" : "−"}₹${Math.abs(Math.round(t.net))} (${t.netR}R) — ${t.outcome.name}.`);
    this._save();
    return t;
  }

  _flat(t) {
    return { ...t, events: (t.events || []).slice(0, 60), id: t.id };
  }

  /** Follow the stocks of trades closed in the last 45 minutes; then settle each trade's class. */
  _watch(now) {
    const rec = this.rec;
    if (!rec) return;
    for (const t of Object.values(rec.trades)) {
      if (!t.after || t.after.done) continue;
      const price = this.feed.priceOf(t.symbol);
      if (num(price)) E.watchAfter(t, price, Math.min(now, t.after.until));
      if (now >= t.after.until || istParts(now).mins > 15 * 60 + 30) {
        t.after.done = true;
        t.outcome = E.outcomeOf(t);
        this._put(TRADES, [this._flat(t)]);
        this._dirty = true;
      }
    }
  }

  /** After 3:31 PM anything still open is out at the last price seen. */
  _closeOut(now) {
    for (const pos of [...this.s.open]) {
      const price = num(pos.last) ? pos.last : pos.entryAvg;
      E.step(pos, price, Math.max(now, Date.parse(`${pos.date}T09:45:00Z`)), this.s.rules, {});
      if (pos.status === "closed") this._land(pos, now);
    }
  }

  /* ----------------------------------------------------------------------------- the book */

  _book() {
    const rows = this._tbl(STUDY);
    const key = `${rows.length}|${rows.reduce((a, r) => (r.date > a ? r.date : a), "")}`;
    if (this._bookCache && this._bookCache.key === key) return this._bookCache.book;
    const built = rows.length ? L.buildBook(rows) : null;
    const book = built && built.sessions >= L.MIN_SESSIONS ? built : null; // too few sessions: the gate does not consult it
    this._bookCache = { key, book };
    return book;
  }

  /* -------------------------------------------------------------------------- after close */

  async _after(now) {
    if (this._afterBusy) return;
    const t = istParts(now);
    const date = t.date;
    const f = (this.s.finished[date] = this.s.finished[date] || {});
    if (f.close && f.compare && f.improve && (f.study || !this.market)) return;
    this._afterBusy = true;
    try {
      if (!f.close) {
        this._rec(date);
        this._save();
        f.close = true;
      }
      if (!f.compare && t.mins >= 15 * 60 + 50 && (f.compareTry || 0) < 4 && now - (f.compareAt || 0) > 10 * 60000) {
        f.compareTry = (f.compareTry || 0) + 1;
        f.compareAt = now;
        try {
          await this.compare(date);
          f.compare = true;
        } catch (err) {
          this.log.log(`[robot] comparison: ${err.message}`);
          if (f.compareTry >= 4) f.compare = true;
        }
        this._save();
      }
      if (f.compare && !f.improve && t.mins >= 15 * 60 + 55) {
        await this.improveDay(date, { by: "itself" });
        f.improve = true;
        this._save();
      }
      if (f.improve && !f.study && this.market && t.mins >= 16 * 60 && t.mins < 22 * 60 && (f.studyTry || 0) < 3 && now - (f.studyAt || 0) > 10 * 60000) {
        f.studyTry = (f.studyTry || 0) + 1;
        f.studyAt = now;
        this._save();
        try {
          await this.study({ trigger: "itself" });
          f.study = true;
        } catch (err) {
          this.log.log(`[robot] study: ${err.message}`);
        }
        this._save();
      }
    } finally {
      this._afterBusy = false;
    }
  }

  /** The robot's day against the trader's, kept in the robot_days table. */
  async compare(date) {
    const trades = this._tbl(TRADES).filter((t) => t.date === date);
    const rec = this.docs.read(dayName(date), null);
    let actual = [];
    if (typeof this.actual === "function") actual = (await this.actual(date)) || [];
    const c = C.compareDay({ date, robot: trades, actual, skips: rec ? rec.decisions : [] });
    const row = this._tbl(DAYS).find((x) => x.id === date) || { id: date, date };
    this._put(DAYS, [{ ...row, compare: c, comparedAt: new Date(this.now()).toISOString() }]);
    return c;
  }

  /**
   * Count the robot's mistakes and correct the rulebook where the evidence calls for it; ask the AI to
   * review the day and veto a change if it finds a reason in the data.
   */
  async improveDay(date, { by = "manual" } = {}) {
    const trades = this._tbl(TRADES);
    const dates = this._tbl(DAYS).map((x) => x.id);
    const today = date;
    // first, the corrections that are due for their check
    const ev = I.evaluate(this.s.corrections, trades, today, dates);
    let rules = this.s.rules;
    const reverted = [];
    for (const u of ev.reverts) {
      rules = E.clampRules(I.revertChanges(rules, u.changes));
      reverted.push(u);
    }
    this.s.corrections = ev.corrections;
    // then the new ones
    let proposals = I.propose({ trades, rules, corrections: this.s.corrections, today, dates });
    let aiNote = null;
    if (this.s.withAi && this.ai && this.ai.robotCoach && typeof this.ai.configured === "function" && this.ai.configured() && (proposals.length || trades.some((t) => t.date === date))) {
      try {
        aiNote = await this.ai.robotCoach.review(this._coachInput(date, trades, proposals));
      } catch (err) {
        aiNote = { failed: true, error: err && err.message ? err.message : "The AI review failed." };
      }
    }
    const vetoes = aiNote && !aiNote.failed ? aiNote.vetoes || [] : [];
    const vetoed = proposals.filter((p) => vetoes.some((v) => v.id === p.id)).map((p) => ({ ...p, status: "vetoed", vetoWhy: (vetoes.find((v) => v.id === p.id) || {}).why || "" }));
    const applied = [];
    for (const p of proposals) {
      if (vetoed.some((v) => v.id === p.id)) continue;
      rules = E.clampRules(I.applyChanges(rules, p.changes));
      const c = { ...p, status: "active", appliedAt: new Date(this.now()).toISOString() };
      this.s.corrections.push(c);
      applied.push(c);
    }
    this.s.corrections.push(...vetoed);
    this.s.corrections = this.s.corrections.slice(-300);
    this.s.rules = rules;
    const mine = trades.filter((t) => t.date === date);
    const row = this._tbl(DAYS).find((x) => x.id === date) || { id: date, date };
    this._put(DAYS, [{ ...row, improved: { at: new Date(this.now()).toISOString(), by, applied: applied.map((c) => ({ id: c.id, title: c.title, summary: c.summary, why: c.why })), vetoed: vetoed.map((c) => ({ id: c.id, title: c.title, why: c.vetoWhy })), reverted: reverted.map((c) => ({ id: c.id, title: c.title, result: c.result })), ai: aiNote }, summary: { trades: mine.length, net: r2(mine.reduce((a, t) => a + (t.net || 0), 0)), bad: mine.filter((t) => t.outcome && t.outcome.tone === "bad").length } }]);
    if (aiNote && !aiNote.failed) {
      this.s.notes = [{ date, at: new Date(this.now()).toISOString(), ...aiNote }, ...this.s.notes].slice(0, 30);
    }
    for (const c of applied) this._note(`Correction: ${c.summary}. ${c.why}`);
    for (const c of reverted) this._note(`Undone: ${c.summary} — the trades since averaged ${c.result.avgR}R against ${c.result.baseline}R before.`);
    this._save();
    this._lessons();
    return { applied, vetoed, reverted, proposals, ai: aiNote };
  }

  _coachInput(date, trades, proposals) {
    const mine = trades.filter((t) => t.date === date);
    const reg = I.register(trades, this.s.corrections, this._tbl(DAYS).map((x) => x.id));
    const cmp = (this._tbl(DAYS).find((x) => x.id === date) || {}).compare || null;
    return {
      date,
      rules: this.s.rules,
      today: mine.map((t) => ({ symbol: t.symbol, side: t.side, score: t.score, entry: t.entryClock, exit: t.exitClock, why: t.why, netR: t.netR, net: t.net, peakR: t.peakR, outcome: t.outcome && t.outcome.id, hour: t.hour })),
      recent: { trades: trades.filter((t) => t.date <= date).slice(-80).length, avgR: r2(trades.slice(-80).filter((t) => num(t.netR)).reduce((a, t, _, xs) => a + t.netR / xs.length, 0)) },
      mistakes: reg.slice(0, 8).map((m) => ({ id: m.id, title: m.title, count: m.count, recent: m.recent, cost: m.cost, state: m.state })),
      proposals: proposals.map((p) => ({ id: p.id, title: p.title, change: p.summary, why: p.why, evidence: p.evidence })),
      activeCorrections: this.s.corrections.filter((c) => c.status === "active").map((c) => ({ id: c.id, summary: c.summary, since: c.date })),
      comparison: cmp ? { you: cmp.you, robot: cmp.robot, lessons: cmp.lessons } : null,
    };
  }

  /** What the robot has found, in plain words, for the trading-skills file every AI feature reads. */
  _lessons() {
    const pb = this.ai && this.ai.playbook;
    if (!pb || typeof pb.setSection !== "function") return;
    const trades = this._tbl(TRADES).filter((t) => num(t.netR));
    const active = this.s.corrections.filter((c) => c.status === "active" || c.status === "kept").slice(-6);
    const lines = [];
    lines.push(`Paper trades the advisor's calls with play money: ${trades.length} finished, ${trades.length ? r2(trades.reduce((a, t) => a + t.netR, 0) / trades.length) : 0}R a trade after costs.`);
    for (const c of active) lines.push(`- Corrected ${c.date}: ${c.summary} (${c.why})${c.status === "kept" ? " — measured, kept" : ""}.`);
    const rejected = this.s.corrections.filter((c) => c.status === "reverted").slice(-3);
    for (const c of rejected) lines.push(`- Tried and undone ${c.date}: ${c.summary} — it did not help.`);
    try {
      pb.setSection(SECTION_ROBOT, lines.join("\n"));
    } catch (_) {
      /* the file is only a convenience */
    }
  }

  /* ------------------------------------------------------------------------------ the study */

  universe() {
    let list = null;
    try {
      list = this.market && this.market.indexList ? this.market.indexList.list("nifty100") : null;
    } catch (_) {
      list = null;
    }
    return (list && list.length ? list : SNAP.indices.nifty100 || []).slice(0, 100);
  }

  /**
   * Read the NIFTY 100's 5-minute bars, trade every level's first test of every whole session not yet studied,
   * and add the sessions to the Level Book. The first run goes back about 30 sessions.
   */
  study({ trigger = "manual", days = null, universe = null } = {}) {
    if (!this.market) return Promise.reject(new RobotError("The study needs the market connection.", "no_market", 409));
    if (this.job && !this.job.finishedAt) return Promise.reject(new RobotError("The study is already running.", "busy", 409));
    const uni = universe || this.universe();
    const first = this._tbl(STUDY).length < 10;
    this.job = { trigger, total: uni.length, done: 0, current: "", error: "", startedAt: new Date(this.now()).toISOString(), finishedAt: null, sessions: 0, backfill: first };
    return this._study(uni, days || (first ? STUDY_DAYS_FIRST : STUDY_DAYS_DAILY))
      .catch((err) => {
        this.job.error = err && err.message ? err.message : String(err);
        this.log.log(`[robot] study: ${this.job.error}`);
        throw err;
      })
      .finally(() => {
        this.job.finishedAt = new Date(this.now()).toISOString();
      });
  }

  async _study(uni, days) {
    if (typeof this.market.instruments === "function") await this.market.instruments();
    const now = this.now();
    const have = new Set(this._tbl(STUDY).map((r) => r.id));
    const todayDone = istParts(now).mins >= 15 * 60 + 35;
    const today = istParts(now).date;
    const bySession = new Map(); // date → { trials: {SYM: [..]}, lasts: {}, own: {} }
    const failed = [];
    let bars5 = 0;
    for (const symbol of uni) {
      this.job.current = symbol;
      try {
        const it = await this.market._instrument(symbol);
        const raw = await this.market._call((k) => k.historical(it.t, "5minute", new Date(now - days * 86400000), new Date(now)));
        const bars = (raw || []).map((b) => ({ t: msOf(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).filter((b) => num(b.t));
        bars5 += bars.length;
        const byDate = new Map();
        for (const b of bars) {
          const d = istParts(b.t).date;
          (byDate.get(d) || byDate.set(d, []).get(d)).push(b);
        }
        const dates = [...byDate.keys()].sort().filter((d) => d < today || todayDone);
        dates.forEach((d, i) => {
          const day = byDate.get(d);
          if (!i || day.length < 60) return;
          const pd = byDate.get(dates[i - 1]);
          if (pd.length < 60 || have.has(d)) return;
          const prev = { h: Math.max(...pd.map((b) => b.h)), l: Math.min(...pd.map((b) => b.l)), c: pd[pd.length - 1].c };
          const atrPrev = L.meanRange(pd);
          const r = L.studySession(day, prev, { costPct: 0.1, atr5: atrPrev });
          const slot = bySession.get(d) || bySession.set(d, { trials: {}, lasts: {}, own: {} }).get(d);
          slot.trials[symbol] = r.trials;
          slot.lasts[symbol] = { h: prev.h, l: prev.l, c: prev.c, atr5: r2(atrPrev) };
          slot.own[symbol] = { h: Math.max(...day.map((b) => b.h)), l: Math.min(...day.map((b) => b.l)), c: day[day.length - 1].c, atr5: r2(L.meanRange(day)) };
        });
      } catch (err) {
        failed.push({ symbol, error: String(err && err.message ? err.message : err).slice(0, 80) });
      }
      this.job.done += 1;
      if (this.gapMs) await sleep(this.gapMs);
    }
    const rows = [];
    for (const [date, slot] of bySession) {
      if (Object.keys(slot.trials).length < Math.min(10, Math.ceil(uni.length / 2))) continue; // a day most stocks lack is not a session
      const agg = L.aggregate(slot.trials);
      rows.push({ id: date, date, source: date === today ? "live" : "backfill", at: new Date(now).toISOString(), stocks: Object.keys(slot.trials).length, tests: Object.values(slot.trials).reduce((a, t) => a + t.length, 0), pooled: agg.pooled, stock: agg.stock, lasts: slot.lasts, own: slot.own });
    }
    this._put(STUDY, rows);
    this._bookCache = null;
    this.job.sessions = rows.length;
    this.job.failed = failed.length;
    this.s.backfilled = true;
    this._note(`Studied ${rows.length} session${rows.length === 1 ? "" : "s"} of the NIFTY 100 (${bars5} five-minute bars, ${failed.length} stocks failed).`);
    this._save();
    this._levelLessons();
    return { sessions: rows.length, failed };
  }

  /** The Level Book's findings in plain words, for the trading-skills file. */
  _levelLessons() {
    const pb = this.ai && this.ai.playbook;
    const book = this._book();
    if (!pb || typeof pb.setSection !== "function" || !book || book.sessions < 5) return;
    const rows = Object.entries(book.pooled)
      .filter(([, v]) => v[0] >= L.MIN_POOLED)
      .map(([k, v]) => ({ k, n: v[0], hit: Math.round((v[1] / v[0]) * 100), avg: v[2] / v[0] }));
    const name = (k) => {
      const [kind, play, side] = k.split("|");
      return `${L.KINDS[kind]} ${play === "bounce" ? "holds" : "breaks"} (${side})`;
    };
    const best = rows.filter((r) => r.avg > 0.03).sort((a, b) => b.avg - a.avg).slice(0, 5);
    const worst = rows.filter((r) => r.avg < -0.03).sort((a, b) => a.avg - b.avg).slice(0, 4);
    const sk = this.learning().skill;
    const body = [
      `Measured on the NIFTY 100's last ${book.sessions} sessions (${book.from} to ${book.to}), the first test of each level traded on 5-minute bars after costs (stop 0.6 ATR, target 1.5R).`,
      best.length ? "Has paid:" : "No kind of level has paid after costs over this period.",
      ...best.map((r) => `- ${name(r.k)}: ${r.n} tests, ${r.hit}% won, ${r.avg > 0 ? "+" : ""}${r2(r.avg)}R a test`),
      ...(worst.length ? ["Has lost money:", ...worst.map((r) => `- ${name(r.k)}: ${r.n} tests, ${r.hit}% won, ${r2(r.avg)}R a test`)] : []),
      `Its own suggestions: ${sk.graduation.text}`,
    ].join("\n");
    try {
      pb.setSection(SECTION_LEVELS, body);
    } catch (_) {
      /* the file is only a convenience */
    }
  }

  /* --------------------------------------------------------------------------- the views */

  _row(p) {
    const dir = p.side === "long" ? 1 : -1;
    const last = num(p.last) ? p.last : p.entryAvg;
    const pnl = r2(this._unreal(p));
    return { id: p.id, symbol: p.symbol, side: p.side, qty: p.qty, qty0: p.qty0, entryAt: p.entryAt, entryClock: p.entryClock, entryAvg: p.entryAvg, last, stop: p.stop, stop0: p.stop0, t1: p.t1, t2: p.t2, risk: p.risk, pnl, r: p.riskRs ? r2(pnl / p.riskRs) : null, peak: p.peak, trough: p.trough, peakR: r2((dir * (p.peak.price - p.entryAvg)) / p.risk), score: p.score, agree: p.agree, why: p.why, level: p.level, t1Hit: p.t1Hit, events: p.events.slice(-12) };
  }

  /** The live board: what is open, what finished today, what was skipped, the rulebook and the day. */
  board() {
    const now = this.now();
    const date = istParts(now).date;
    const rec = this.rec && this.rec.date === date ? this.rec : this.docs.read(dayName(date), null) || { date, trades: {}, decisions: [], frames: {} };
    const closed = Object.values(rec.trades).sort((a, b) => b.exitAt - a.exitAt);
    const open = this.s.open.map((p) => this._row(p));
    const net = closed.reduce((a, t) => a + (t.net || 0), 0) + open.reduce((a, p) => a + p.pnl, 0);
    const wins = closed.filter((t) => t.net > 0).length;
    return {
      at: new Date(now).toISOString(),
      date,
      paperOnly: true,
      settings: this.settings(),
      live: this._live(),
      open,
      closed: closed.map((t) => ({ id: t.id, symbol: t.symbol, side: t.side, qty: t.qty0, entryClock: t.entryClock, exitClock: t.exitClock, entryAvg: t.entryAvg, exitAvg: t.exitAvg, net: t.net, netR: t.netR, why: t.why, peakClock: t.peak.clock, peakPnl: t.peakPnl, outcome: t.outcome, score: t.score })),
      decisions: rec.decisions.slice(-40).reverse(),
      day: { trades: closed.length + open.length, net: r2(net), wins, winPct: closed.length ? Math.round((wins / closed.length) * 100) : null, netPct: r2((net / this.s.rules.capital) * 100) },
      log: this.s.log.slice(0, 12),
    };
  }

  /** One day's flight record: every trade with its frames and events, and every decision. */
  day(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new RobotError("That is not a valid date (use YYYY-MM-DD).");
    const d = this.rec && this.rec.date === date ? this.rec : this.docs.read(dayName(date), null);
    if (!d) return { available: false, date, reason: "The robot recorded nothing on that day (it records while Zerodha is connected in market hours)." };
    const trades = Object.values(d.trades).concat(this.s.open.filter((p) => p.date === date)).sort((a, b) => a.entryAt - b.entryAt);
    return { available: true, date, trades: trades.map((t) => ({ ...t, frames: (d.frames || {})[t.id] || [] })), decisions: d.decisions || [] };
  }

  days() {
    const ix = this.docs.read(INDEX, null) || { days: [] };
    const rows = new Map(this._tbl(DAYS).map((r) => [r.id, r]));
    const trades = this._tbl(TRADES);
    return ix.days
      .slice()
      .reverse()
      .map((date) => {
        const mine = trades.filter((t) => t.date === date);
        const r = rows.get(date) || {};
        const open = this.s.open.filter((p) => p.date === date).length;
        return { date, trades: mine.length, open, net: r2(mine.reduce((a, t) => a + (t.net || 0), 0)), compared: Boolean(r.compare), you: r.compare ? r.compare.you.net : null, gap: r.compare ? r.compare.gap : null, corrected: r.improved ? r.improved.applied.length : 0 };
      });
  }

  /** The comparison of a day, worked out if it has not been (or when asked again). */
  async comparison(date, { refresh = false } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new RobotError("That is not a valid date (use YYYY-MM-DD).");
    const row = this._tbl(DAYS).find((x) => x.id === date);
    if (row && row.compare && !refresh) return { ...row.compare, comparedAt: row.comparedAt };
    const c = await this.compare(date);
    return { ...c, comparedAt: new Date(this.now()).toISOString() };
  }

  comparisons() {
    const list = this._tbl(DAYS).map((r) => r.compare).filter(Boolean);
    return C.compareRange(list);
  }

  /** What the robot has learned: its mistakes, its corrections, its rulebook, its curve and the Level Book's skill. */
  learning() {
    const trades = this._tbl(TRADES).filter((t) => t.outcome);
    const dates = this._tbl(DAYS).map((x) => x.id);
    const study = this._tbl(STUDY).sort((a, b) => (a.date < b.date ? -1 : 1));
    const series = L.skillSeries(study);
    const grad = L.graduation(series, study.length, { sessions: SESSIONS_TARGET });
    return {
      trades: trades.length,
      sessions: dates.length,
      curve: I.progress(trades),
      mistakes: I.register(trades, this.s.corrections, dates),
      corrections: this.s.corrections.slice().reverse().slice(0, 40),
      rules: this.rules(),
      notes: this.s.notes.slice(0, 5),
      skill: { series, graduation: grad, studied: study.length, live: study.filter((r) => r.source === "live").length, backfilled: study.filter((r) => r.source !== "live").length, from: study.length ? study[0].date : null, to: study.length ? study[study.length - 1].date : null },
      job: this.job ? { ...this.job } : null,
    };
  }

  /** The Level Book: the best levels for the next session, one stock's levels, and the record by kind of level. */
  levels({ symbol = null, limit = 40 } = {}) {
    const study = this._tbl(STUDY).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!study.length) return { available: false, reason: "Not studied yet: the robot reads the NIFTY 100's 5-minute bars each weekday evening from 4 PM while Zerodha is connected, or press Study now.", job: this.job ? { ...this.job } : null };
    const book = L.buildBook(study);
    const latest = study[study.length - 1];
    const sym = symbol ? String(symbol).toUpperCase() : null;
    const grad = L.graduation(L.skillSeries(study), study.length, { sessions: SESSIONS_TARGET });
    const gated = book.sessions < L.MIN_SESSIONS;
    const rows = gated ? [] : sym ? L.suggestFor(book, sym, latest.own[sym] || {}, { top: 6 }) : L.suggestAll(book, latest.own, { top: 2, limit });
    const kinds = Object.entries(book.pooled)
      .map(([k, v]) => {
        const [kind, play, side] = k.split("|");
        return { key: k, kind, name: L.KINDS[kind], play, side, n: v[0], hitPct: Math.round((v[1] / v[0]) * 100), avgR: r2(v[2] / v[0]) };
      })
      .filter((r) => r.n >= L.MIN_POOLED)
      .sort((a, b) => b.avgR - a.avgR);
    return { available: true, gated, minSessions: L.MIN_SESSIONS, provisional: grad.state !== "graduated", basedOn: latest.date, sessions: book.sessions, from: book.from, to: book.to, graduation: grad, forSession: "the next session", rows, kinds, symbol: sym, stock: sym ? { own: latest.own[sym] || null, records: Object.entries(book.stock[sym] || {}).map(([k, v]) => ({ key: k, n: v[0], hitPct: v[0] ? Math.round((v[1] / v[0]) * 100) : null, avgR: v[0] ? r2(v[2] / v[0]) : null })).sort((a, b) => b.avgR - a.avgR) } : null, symbols: Object.keys(latest.own).sort(), job: this.job ? { ...this.job } : null };
  }

  /** A short form for the AI features. */
  brief() {
    const l = this.learning();
    return { on: this.s.on, trades: l.trades, sessions: l.sessions, mistakes: l.mistakes.slice(0, 5).map((m) => ({ title: m.title, count: m.count, state: m.state })), corrections: this.s.corrections.filter((c) => c.status === "active").map((c) => c.summary), levelSkill: l.skill.graduation.text };
  }

  /* --------------------------------------------------------------------------------- timer */

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log.log(`[robot] ${err.message}`);
      }
    }, 5000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

const DEFAULT_RISK = () => E.DEFAULTS.riskPct;

module.exports = { PaperRobot, RobotError, SECTION_ROBOT, SECTION_LEVELS, SESSIONS_TARGET };
