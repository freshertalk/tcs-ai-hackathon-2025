"use strict";
// The autopilot: the research desk that works by itself, from the evening before to the close.
//
//   PREPARES     from 8:45 every trading morning: for each stock being followed — the regime, the day's script, the events that
//                apply and every scenario (market/scenarios.js), each with its trigger, entry, stop, targets and size
//   WATCHES      from 9:30 to 2:45 PM, every 30 seconds: live prices and the 1-minute bars against every scenario's trigger.
//                A scenario passes through four states — armed, breaking, held (triggered), or spoiled/late/expired
//   PROPOSES     when a scenario fires it runs through the risk gate (risk-gate.js: the risk guard, capital, reward-to-risk,
//                sector and correlation limits, event windows) and becomes an ORDER PROPOSAL: the trade, the size, the stop, the
//                reasons — or a recorded refusal with its reason. You press Review and the order ticket opens ready-filled; the
//                autopilot itself never sends an order
//   GRADES       every proposal is followed on the 1-minute bars to its stop, its first target or 3:15 PM, in R after costs,
//                whether or not you took it. The record is kept per scenario; a setup whose last proposals lost money is paused
//   CALIBRATES   after the close, the outlook is graded against a year of history (market/calibrate.js): how reliable has the
//                lean been, and which of its voices has paid
//   TELLS YOU    a Telegram message for each new proposal (when the notifier is set up)
//
// It reads the market and the account. It cannot place, change or cancel an order.

const { regimeOf, scriptFor, buildScenarios, evaluate, openingRange } = require("./market/scenarios");
const { autoEvents, cleanCustom, fromCustom, eventsOn, upcoming, expiriesFrom } = require("./market/events");
const { calibrate, sentenceFor } = require("./market/calibrate");
const { gate, cleanSettings, correlation, DEFAULTS } = require("./risk-gate");
const nse = require("./market/nse-holidays");
const { sectorOf } = require("./market/sectors");
const { randomToken } = require("./crypto");

const IST = 5.5 * 3600 * 1000;
const SETTINGS = "autopilot/settings.json";
const EVENTS = "autopilot/events.json";
const STATE = "autopilot/state.json";
const CALIB = "autopilot/calibration.json";
const LEARN = "autopilot/learn.json";
const COLLECTION = "autopilot_proposals";
const SECTION = "## What the autopilot has measured (written by itself after every close)";
const MAX_UNIVERSE = 20;
const PAUSE_AFTER = 12; // settled proposals before a setup can be paused
const KEEP_DAYS = 200;
const COST_PCT = 0.1; // round-trip cost counted in every graded proposal
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const dayStart = (date) => Date.parse(`${date}T00:00:00Z`) - IST;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;

class AutopilotError extends Error {
  constructor(message, code = "autopilot", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class Autopilot {
  /**
   * @param market   the MarketService (intraday plan, quotes, bars, daily bars, the NFO list, the watchlist)
   * @param docs     the record store
   * @param trading  the TradingService (positions and the risk guard), optional
   * @param notifier the Telegram notifier, optional
   * @param playbook the trading-skills file, optional
   */
  constructor({ market, docs, trading = null, notifier = null, playbook = null, now = () => Date.now(), log = console }) {
    this.market = market;
    this.docs = docs;
    this.trading = trading;
    this.notifier = notifier;
    this.playbookFile = playbook;
    this.now = now;
    this.log = log;
    this.timer = null;
    this._map = null;
    this._prep = new Map(); // symbol -> { date, at, plan, regime, scenarios, events }
    this._live = new Map(); // symbol -> { at, price, states: { id: {state, note} } }
    this._bars = new Map(); // symbol -> { at, bars }
    this._busy = null;
    this._prepAt = 0;
    this._calibAt = 0;
    this._lastTick = null;
    this._lastError = "";
    this._cal = null;
    this._learn = null;
    this._nfo = null;
  }

  /* ----------------------------------------------------------------------------------------- settings */
  settings() {
    const s = this.docs.read(SETTINGS, null) || {};
    return { ...DEFAULTS, on: true, notify: true, exclude: [], ...s };
  }
  setSettings(patch = {}, by = "") {
    const cur = this.settings();
    const risk = cleanSettings(patch, cur);
    const next = {
      ...risk,
      on: patch.on === undefined ? cur.on : Boolean(patch.on),
      notify: patch.notify === undefined ? cur.notify : Boolean(patch.notify),
      exclude: Array.isArray(patch.exclude) ? [...new Set(patch.exclude.map((s) => String(s).toUpperCase().trim()).filter((s) => SYMBOL_RE.test(s)))].slice(0, 40) : cur.exclude,
      by,
      at: new Date(this.now()).toISOString(),
    };
    this.docs.write(SETTINGS, next);
    this._prep.clear(); // sizes and gates are worked out again
    return this.settings();
  }

  /* ------------------------------------------------------------------------------------------ events */
  customEvents() {
    return ((this.docs.read(EVENTS, null) || {}).items || []).filter((e) => e && e.date);
  }
  addEvent(input, by = "") {
    const c = cleanCustom(input);
    if (c.error) throw new AutopilotError(c.error, "invalid");
    const items = this.customEvents();
    if (items.length >= 200) throw new AutopilotError("Too many events: delete the old ones first.", "full");
    const rec = { ...c, id: `c-${randomToken(6)}`, by, addedAt: new Date(this.now()).toISOString() };
    this.docs.write(EVENTS, { items: [...items, rec] });
    this._prep.clear();
    return rec;
  }
  removeEvent(id) {
    const items = this.customEvents();
    if (!items.some((e) => e.id === id)) throw new AutopilotError("No such event.", "not_found", 404);
    this.docs.write(EVENTS, { items: items.filter((e) => e.id !== id) });
    this._prep.clear();
  }

  async _expiries(today, symbols) {
    try {
      const list = typeof this.market.derivatives === "function" ? await this.market.derivatives() : [];
      return expiriesFrom(list, { today, days: 45, symbols });
    } catch (_) {
      return [];
    }
  }

  /** Every event from today for `days` days: the automatic ones and the owner's. */
  async events({ days = 30, symbols = [] } = {}) {
    const today = istDate(this.now());
    const auto = autoEvents({ today, days, expiries: await this._expiries(today, symbols) });
    const mine = this.customEvents().filter((c) => c.date >= today).map((c) => fromCustom(c, today));
    return [...auto, ...mine];
  }

  /* ---------------------------------------------------------------------------------------- the universe */
  universe() {
    const s = this.settings();
    let list = [];
    try {
      list = this.market.watchlist ? this.market.watchlist() : [];
    } catch (_) {
      list = [];
    }
    return [...new Set(list)].filter((x) => SYMBOL_RE.test(x) && !/^DEMO/.test(x) && !s.exclude.includes(x)).slice(0, MAX_UNIVERSE);
  }

  /* ------------------------------------------------------------------------------------------- proposals */
  _recs() {
    if (!this._map) this._map = new Map(this.docs.items(COLLECTION).map((r) => [r.id, r]));
    return this._map;
  }
  _save(r) {
    this._rev = (this._rev || 0) + 1;
    this._recs().set(r.id, r);
    this.docs.putItems(COLLECTION, [r]);
  }
  /** Changes whenever a proposal or the day's state is written (the live hub compares it). */
  fingerprint() {
    return `${this._rev || 0}|${this.settings().on}`;
  }
  _state() {
    const s = this.docs.read(STATE, null) || {};
    const today = istDate(this.now());
    return s.date === today ? s : { date: today, fired: {}, orb: {} };
  }
  _saveState(s) {
    this._rev = (this._rev || 0) + 1;
    this.docs.write(STATE, s);
  }

  proposals({ days = 7 } = {}) {
    const since = istDate(this.now() - days * 86400000);
    return [...this._recs().values()].filter((r) => r.date >= since).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** The user's answer to a proposal: "opened" (pressed Review), "ignored". The autopilot never sends anything. */
  decide(id, action, by = "") {
    const r = this._recs().get(id);
    if (!r) throw new AutopilotError("That proposal is no longer there.", "not_found", 404);
    if (!["opened", "ignored"].includes(action)) throw new AutopilotError("Unknown action.", "invalid");
    if (r.status === "blocked") throw new AutopilotError("A refused proposal cannot be acted on.", "invalid");
    this._save({ ...r, response: { action, by, at: new Date(this.now()).toISOString() } });
    return this._recs().get(id);
  }

  /* ----------------------------------------------------------------------------------------- the account */
  async _account() {
    const out = { positions: [], standing: null };
    if (!this.trading) return out;
    try {
      const p = await this.trading.positions();
      out.positions = ((p && p.net) || []).filter((x) => Number(x.quantity) !== 0).map((x) => ({ symbol: x.symbol, side: Number(x.quantity) > 0 ? "long" : "short", qty: Number(x.quantity), avg: x.average_price ?? x.avg, last: x.last_price ?? x.last }));
    } catch (_) {
      /* the gate works with what it has */
    }
    try {
      const s = typeof this.trading.riskStatus === "function" ? await this.trading.riskStatus() : null;
      out.standing = s && s.standing ? s.standing : s || null;
    } catch (_) {
      /* no standing known */
    }
    return out;
  }

  async _closes(symbol) {
    try {
      const d = await this.market.daily(symbol);
      return (d.candles || []).map((c) => c.c);
    } catch (_) {
      return [];
    }
  }

  /** A correlation function over the symbols the gate asks about, from daily closes read ahead of time. */
  async _corrFor(symbol, others) {
    const cache = new Map();
    cache.set(symbol, await this._closes(symbol));
    for (const o of others) if (!cache.has(o)) cache.set(o, await this._closes(o));
    return (a, b) => (cache.has(a) && cache.has(b) ? correlation(cache.get(a), cache.get(b)) : null);
  }

  /* ----------------------------------------------------------------------------------------- the playbook */
  async _prepare(symbol, force = false) {
    const now = this.now();
    const today = istDate(now);
    const hit = this._prep.get(symbol);
    if (hit && hit.date === today && !force && now - hit.at < 10 * 60000) return hit;
    const plan = await this.market.intradayPlan(symbol);
    if (!plan || !plan.available) {
      const rec = { date: today, at: now, plan: plan || null, regime: null, scenarios: [], events: null, script: [] };
      this._prep.set(symbol, rec);
      return rec;
    }
    const d = await this.market.daily(symbol);
    const done = (d.candles || []).filter((c) => String(c.t).slice(0, 10) < plan.nextSession);
    const regime = regimeOf(done);
    const date = plan.nextSession || today;
    const evs = await this.events({ days: 20, symbols: [symbol] });
    const ev = eventsOn(evs, date, symbol);
    const dayRs = plan.dayRangePct && plan.last ? (plan.dayRangePct / 100) * plan.last : null;
    const scenarios = buildScenarios({ symbol, plan, regime, events: ev, dayRs });
    const rec = { date, at: now, plan, regime, scenarios, events: ev, script: scriptFor({ open: plan.open, habits: plan.habits, plan, events: ev }), upcoming: upcoming(evs, today, { symbol, days: 14 }) };
    if (this._prep.size > 60) this._prep.clear();
    this._prep.set(symbol, rec);
    return rec;
  }

  /** The playbook of one stock for the page: regime, script, scenarios with where each stands now, events, and the size. */
  async playbook(symbol, { withAccount = false } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new AutopilotError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const prep = await this._prepare(symbol);
    if (!prep.plan || !prep.plan.available) return { available: false, symbol, reason: (prep.plan && prep.plan.reason) || "Too little history for a playbook." };
    const live = this._live.get(symbol);
    const state = this._state();
    const minute = minuteOf(now);
    const open = istDate(now) === prep.date && minute >= 9 * 60 + 15 && minute < 15 * 60 + 30;
    const learn = this.learned();
    const cal = this.calibration();
    const lean = prep.plan.lean || {};
    const scenarios = prep.scenarios.map((sc) => {
      const st = sc.kind === "entry" ? (live && live.states[sc.id]) || (state.fired[`${symbol}|${sc.id}`] ? { state: "triggered", note: "It fired today." } : { state: open ? "armed" : "waiting", note: open ? "Watching." : "Not before 9:30." }) : null;
      const rec = learn.byScenario[sc.id];
      return { ...sc, status: st, learned: rec ? { n: rec.n, avgR: rec.avgR, winRate: rec.winRate, paused: Boolean(rec.paused) } : null };
    });
    let sizing = null;
    if (withAccount) {
      const entry = scenarios.find((s) => s.kind === "entry" && s.id.startsWith("break-") && (lean.call === "short-bias" ? s.side === "short" : s.side === "long"));
      if (entry && entry.plan) {
        const acct = await this._account();
        const corr = await this._corrFor(symbol, acct.positions.map((p) => p.symbol));
        sizing = { scenario: entry.id, label: entry.label, ...gate({ symbol, side: entry.side, entry: entry.plan.entry, stop: entry.plan.stop, targets: entry.plan.targets, sizeFactor: entry.sizeFactor, settings: this.settings(), positions: acct.positions, standing: acct.standing, events: prep.events, proposalsToday: this.proposals({ days: 0 }).filter((p) => p.status === "new").length, corr }) };
      }
    }
    return {
      available: true,
      symbol,
      date: prep.date,
      open,
      at: new Date(prep.at).toISOString(),
      last: prep.plan.last,
      lean: { call: lean.call, score: lean.score, agreement: lean.agreement, reliability: sentenceFor(cal, lean.score) },
      regime: prep.regime,
      script: prep.script,
      scenarios,
      events: { today: prep.events, upcoming: prep.upcoming },
      sizing,
      proposals: this.proposals({ days: 0 }).filter((p) => p.symbol === symbol),
      watching: Boolean(this.timer),
      rule: "A playbook is what a disciplined trader writes before the open: the kind of day, what usually happens when, and for every situation a trigger, an action, a size, a stop and a way out. Probabilities are shown only where they were measured (the plan's replayed record on this stock's past sessions, its opening-range habits, the outlook's graded history). Nothing here places an order.",
    };
  }

  /* ------------------------------------------------------------------------------------------ the watch */
  async _bars1(symbol, now) {
    const hit = this._bars.get(symbol);
    if (hit && now - hit.at < 45000) return hit.bars;
    const today = istDate(now);
    let bars = [];
    try {
      bars = await this.market.minuteBarsBetween(symbol, dayStart(today) + 9 * 3600000, now);
    } catch (_) {
      bars = hit ? hit.bars : [];
    }
    // the minute still forming is left out: a hold is judged on closed minutes
    bars = bars.filter((b) => b.t + 60000 <= now);
    if (this._bars.size > 60) this._bars.clear();
    this._bars.set(symbol, { at: now, bars });
    return bars;
  }

  /** One pass: prices against every armed scenario; fired ones become proposals. */
  async watch() {
    const now = this.now();
    const today = istDate(now);
    const minute = minuteOf(now);
    const s = this.settings();
    if (!s.on || !nse.isTradingDay(today) || minute < 9 * 60 + 30 || minute >= 15 * 60 + 20) return { watched: 0 };
    if (typeof this.market.mode === "function" && this.market.mode() !== "kite") return { watched: 0 };
    const symbols = this.universe();
    if (!symbols.length) return { watched: 0 };
    const q = ((await this.market.quotes(symbols)).quotes) || {};
    const state = this._state();
    let created = 0;
    for (const symbol of symbols) {
      const prep = this._prep.get(symbol);
      const price = q[symbol] && num(q[symbol].last) ? q[symbol].last : null;
      if (!prep || prep.date !== today || !prep.scenarios.length || !num(price)) continue;
      const entries = prep.scenarios.filter((sc) => sc.kind === "entry");
      // the 1-minute bars are fetched only when something is close enough to matter
      const near = entries.some((sc) => {
        const lvl = sc.trigger.type === "break" ? sc.trigger.level : null;
        return lvl === null || Math.abs(price / lvl - 1) < 0.012;
      });
      const bars1 = near || minute === 9 * 60 + 30 ? await this._bars1(symbol, now) : (this._bars.get(symbol) || { bars: [] }).bars;
      let orb = state.orb[symbol] || null;
      if (!orb && minute >= 9 * 60 + 30) {
        orb = openingRange(bars1, dayStart(today));
        if (orb) state.orb[symbol] = orb;
      }
      const states = {};
      for (const sc of entries) {
        const key = `${symbol}|${sc.id}`;
        const fired = state.fired[key] || null;
        const res = evaluate(sc, { minute, price, bars1, orb, fired: Boolean(fired), firedPlan: fired && fired.plan });
        states[sc.id] = { state: res.state, note: res.note, distancePct: res.distancePct };
        if (res.state === "triggered" && !fired) {
          state.fired[key] = { at: now, plan: res.plan };
          this._saveState(state);
          if (await this._propose(symbol, sc, res.plan, price, prep)) created += 1;
        }
      }
      this._live.set(symbol, { at: now, price, states });
    }
    this._saveState(state);
    return { watched: symbols.length, created };
  }

  async _propose(symbol, sc, plan, price, prep) {
    const now = this.now();
    const learn = this.learned().byScenario[sc.id];
    const acct = await this._account();
    const corr = await this._corrFor(symbol, acct.positions.map((p) => p.symbol));
    const today = this.proposals({ days: 0 });
    let g = gate({ symbol, side: sc.side, entry: plan.entry, stop: plan.stop, targets: plan.targets, sizeFactor: sc.sizeFactor, settings: this.settings(), positions: acct.positions, standing: acct.standing, events: prep.events, proposalsToday: today.filter((p) => p.status === "new").length, corr });
    if (g.allowed && learn && learn.paused) g = { ...g, allowed: false, qty: 0, reasons: [{ level: "block", text: `Paused: this setup's last ${learn.n} proposals averaged ${learn.avgR}R after costs.` }, ...g.reasons] };
    if (g.allowed && sc.sizeFactor <= 0) g = { ...g, allowed: false, qty: 0, reasons: [{ level: "block", text: (sc.sizeNotes || []).join("; ") || "Its size is zero today." }, ...g.reasons] };
    const rec = {
      id: `${istDate(now)}|${symbol}|${sc.id}`,
      date: istDate(now),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 60000).toISOString(),
      symbol,
      scenario: sc.id,
      label: sc.label,
      side: sc.side,
      status: g.allowed ? "new" : "blocked",
      price,
      entry: plan.entry,
      stop: plan.stop,
      targets: plan.targets,
      riskPerShare: plan.riskPerShare,
      qty: g.qty,
      riskRs: g.riskRs,
      valueRs: g.valueRs,
      rr: g.rr,
      sizeFactor: g.sizeFactor,
      reasons: g.reasons,
      why: sc.why,
      measured: sc.measured,
      edge: sc.edge,
      sizeNotes: sc.sizeNotes || [],
      regime: prep.regime ? prep.regime.kind : null,
      ticket: g.allowed ? { symbol, exchange: "NSE", side: sc.side === "long" ? "BUY" : "SELL", product: "MIS", quantity: g.qty, price, plan: { stop: plan.stop, target: plan.targets[0], risk: g.riskRs, source: `Autopilot · ${sc.label}` } } : null,
      outcome: null,
    };
    this._save(rec);
    if (g.allowed && this.notifier && this.settings().notify) {
      const text = `Autopilot proposal: ${sc.side === "long" ? "BUY" : "SELL"} ${g.qty} ${symbol} near ₹${price} — ${sc.label}. Stop ₹${plan.stop}, target ₹${plan.targets[0]} (${g.rr}×), risk ₹${g.riskRs}. Open the terminal and press Review; nothing is sent until you place it.`;
      this.notifier.send(text, "alerts").catch(() => {});
    }
    return g.allowed;
  }

  /* ----------------------------------------------------------------------------------------- the grading */
  /** Follow every open proposal on the 1-minute bars to its stop, its first target or 3:15 PM. */
  async grade() {
    const now = this.now();
    const today = istDate(now);
    const open = [...this._recs().values()].filter((r) => r.status !== "blocked" && !r.outcome);
    let n = 0;
    for (const r of open) {
      let bars = [];
      try {
        bars = await this.market.minuteBarsBetween(r.symbol, Date.parse(r.createdAt), Math.min(now, dayStart(r.date) + 15.25 * 3600000));
      } catch (_) {
        continue;
      }
      const long = r.side === "long";
      const risk = r.riskPerShare;
      const cost = (COST_PCT / 100) * r.entry;
      const after = bars.filter((b) => b.t >= Date.parse(r.createdAt));
      let how = null;
      let px = null;
      for (const b of after) {
        const hitStop = long ? b.l <= r.stop : b.h >= r.stop;
        const hitT = long ? b.h >= r.targets[0] : b.l <= r.targets[0];
        if (hitStop) {
          how = "stop"; // a minute that touches both counts as a loss
          px = r.stop;
          break;
        }
        if (hitT) {
          how = "target";
          px = r.targets[0];
          break;
        }
      }
      const past = r.date < today || minuteOf(now) >= 15 * 60 + 15;
      if (!how && past && after.length) {
        how = "time";
        const lastBar = after[after.length - 1];
        px = lastBar.c;
      }
      if (!how) continue;
      const gross = long ? px - r.entry : r.entry - px;
      const rr = Math.round(((gross - cost) / risk) * 100) / 100;
      this._save({ ...r, outcome: { how, price: px, r: rr, at: new Date(now).toISOString() } });
      n += 1;
    }
    if (n) this.relearn();
    return n;
  }

  /** The record per scenario, and the pause rule. */
  relearn() {
    const done = [...this._recs().values()].filter((r) => r.outcome && r.status !== "blocked");
    const by = {};
    for (const r of done) (by[r.scenario] = by[r.scenario] || []).push(r);
    const out = { byScenario: {}, overall: null, updatedAt: new Date(this.now()).toISOString() };
    const stats = (list) => {
      const rs = list.map((x) => x.outcome.r);
      const wins = rs.filter((x) => x > 0).length;
      const gain = rs.filter((x) => x > 0).reduce((a, b) => a + b, 0);
      const loss = -rs.filter((x) => x < 0).reduce((a, b) => a + b, 0);
      return { n: list.length, wins, winRate: Math.round((wins / list.length) * 100), avgR: r2(rs.reduce((a, b) => a + b, 0) / list.length), totalR: r2(rs.reduce((a, b) => a + b, 0)), profitFactor: loss > 0 ? r2(gain / loss) : null, how: { target: list.filter((x) => x.outcome.how === "target").length, stop: list.filter((x) => x.outcome.how === "stop").length, time: list.filter((x) => x.outcome.how === "time").length } };
    };
    for (const [id, list] of Object.entries(by)) {
      const s = stats(list);
      // a setup that has lost money over its last proposals is paused until its record recovers
      const recent = stats(list.slice(-PAUSE_AFTER));
      out.byScenario[id] = { ...s, paused: list.length >= PAUSE_AFTER && recent.avgR < -0.15 };
    }
    if (done.length) out.overall = stats(done);
    this.docs.write(LEARN, out);
    this._learn = out;
    const lines = this._lessons(out);
    if (this.playbookFile && lines.length) {
      try {
        this.playbookFile.setSection(SECTION, lines.map((l) => `- ${l}`).join("\n"));
      } catch (err) {
        this.log.error(`[autopilot] the skills file was not updated: ${err.message}`);
      }
    }
    return out;
  }

  _lessons(L) {
    const lines = [];
    if (!L.overall || L.overall.n < 8) return lines;
    const o = L.overall;
    lines.push(`Autopilot proposals graded so far: ${o.n}; ${o.winRate}% reached target 1 or finished in profit, average ${o.avgR}R after costs${o.profitFactor ? `, profit factor ${o.profitFactor}` : ""} (counted whether or not the trader took them).`);
    for (const [id, s] of Object.entries(L.byScenario).filter(([, s]) => s.n >= 5).sort((a, b) => b[1].n - a[1].n).slice(0, 6)) lines.push(`${id}: ${s.n} proposals, ${s.winRate}% won, average ${s.avgR}R${s.paused ? " — paused until its record recovers" : ""}.`);
    const cal = this.calibration();
    if (cal && cal.available && cal.overall.hitPct !== null) lines.push(`The next-session outlook, graded on ${cal.overall.n} past sessions across ${cal.overall.stocks} stocks: its call (lean ±22 or more) pointed the right way ${cal.overall.hitPct}% of ${cal.overall.called} times, against ${cal.overall.baseUpPct}% for any next session closing higher.`);
    return lines;
  }

  learned() {
    if (!this._learn) this._learn = this.docs.read(LEARN, null) || { byScenario: {}, overall: null, updatedAt: null };
    return this._learn;
  }

  /* ------------------------------------------------------------------------------------ the calibration */
  calibration() {
    if (!this._cal) this._cal = this.docs.read(CALIB, null);
    return this._cal;
  }

  /** Grade the outlook on a year of the followed stocks' history (arithmetic only; a second or two). */
  async recalibrate() {
    const symbols = [...new Set([...this.universe(), "NIFTY 50"])].slice(0, 30);
    const series = [];
    for (const symbol of symbols) {
      try {
        const d = await this.market.daily(symbol);
        if (d && d.candles) series.push({ symbol, daily: d.candles });
      } catch (_) {
        /* one stock's failure does not stop the rest */
      }
    }
    const cal = { ...calibrate(series), at: new Date(this.now()).toISOString() };
    this._cal = cal;
    this.docs.write(CALIB, cal);
    this.relearn();
    return cal;
  }

  /* ------------------------------------------------------------------------------------------ the board */
  async board({ withAccount = false } = {}) {
    const now = this.now();
    const all = this.proposals({ days: 7 });
    const today = istDate(now);
    const symbols = this.universe();
    const s = this.settings();
    const evs = await this.events({ days: 21, symbols });
    return {
      on: s.on,
      watching: Boolean(this.timer),
      lastTick: this._lastTick,
      error: this._lastError,
      universe: symbols,
      settings: withAccount ? { capital: s.capital, riskPct: s.riskPct, maxPositionPct: s.maxPositionPct, maxSectorPct: s.maxSectorPct, maxGrossPct: s.maxGrossPct, minRR: s.minRR, maxProposals: s.maxProposals, on: s.on, notify: s.notify, exclude: s.exclude } : { on: s.on },
      proposals: withAccount ? all : [],
      today: { date: today, tradingDay: nse.isTradingDay(today), holiday: nse.holidayName(today), known: nse.known(today) },
      learned: this.learned(),
      calibration: this.calibration(),
      events: upcoming(evs, today, { days: 21 }),
      custom: this.customEvents(),
      lessons: this._lessons(this.learned()),
    };
  }

  /* ------------------------------------------------------------------------------------------ the clock */
  async tick() {
    const now = this.now();
    const today = istDate(now);
    const minute = minuteOf(now);
    const live = typeof this.market.mode !== "function" || this.market.mode() === "kite";
    this._lastTick = new Date(now).toISOString();
    const trading = nse.isTradingDay(today);
    if (!this.settings().on) return;
    if (trading && live) {
      // the morning: every ten minutes from 8:45, so levels follow the gap forecast as it settles
      if (minute >= 8 * 60 + 45 && minute < 15 * 60 && now - this._prepAt >= 10 * 60000) {
        this._prepAt = now;
        for (const sym of this.universe()) {
          try {
            await this._prepare(sym, true);
          } catch (_) {
            /* the stock simply has no playbook today */
          }
        }
      }
      if (minute >= 9 * 60 + 30 && minute < 15 * 60 + 20) {
        await this.watch();
        await this.grade();
      }
      if (minute >= 15 * 60 + 15 && minute < 17 * 60) await this.grade();
    }
    // after the close, once a day: how good has the research been?
    if ((minute >= 15 * 60 + 45 || !trading) && now - this._calibAt >= 12 * 3600000 && live) {
      this._calibAt = now;
      await this.recalibrate();
    }
    // old records go
    if (minute === 20 * 60) {
      const cut = istDate(now - KEEP_DAYS * 86400000);
      const old = [...this._recs().values()].filter((r) => r.date < cut).map((r) => r.id);
      if (old.length) {
        old.forEach((id) => this._recs().delete(id));
        this.docs.removeItems(COLLECTION, old);
      }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this._busy) return;
      this._busy = this.tick()
        .catch((err) => {
          this._lastError = err.message;
          this.log.error(`[autopilot] ${err.message}`);
        })
        .finally(() => {
          this._busy = null;
        });
    }, 30000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Autopilot, AutopilotError, SECTION, COLLECTION, sectorOf };
