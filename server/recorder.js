"use strict";
// The market recorder: it reads every stock, every minute of every session, by itself — no page open, no stock selected —
// keeps what it read in the database, and every evening learns what those readings are worth.
//
//   READS    once a minute from 9:15 to 15:30 on a trading day, in ONE Zerodha quote request: every NIFTY 100 stock and
//            every stock on the watchlist (price, the day's volume, the average price, the quantity waiting to buy and to
//            sell), each one's near-month future (price, volume, OPEN INTEREST), and NIFTY 50, BANK NIFTY and India VIX.
//            One request a minute is far inside Zerodha's limit, so the desk is never slowed by it.
//   KEEPS    one record per session (server/market/tapeflow.js: columns, compressed, about a megabyte) in the store's
//            "cold" shelf (docs.coldPut): in the database, NOT in memory, so years of sessions cost nothing to hold.
//            A small index (market/tape-index.json) says which sessions are stored. A restart during the session reads
//            the morning back and carries on. Saved every five minutes and at the close.
//   LEARNS   each evening, for every recorded session the price history now covers: the 15-minute forecaster makes its
//            own call for every stock and every 5-minute bar (Horizon.replay); what it MISSED is set against the order
//            book and open interest recorded at that minute. Before a session is learned, the weights as they stood are
//            scored on it — so the gain shown is out of sample. Only while the readings really reduce the forecaster's
//            miss (by at least 0.2% of its squared error, over at least 20,000 forecasts) are they used in the live
//            forecast, as a small correction; otherwise they stay out and the screen says "not proven yet".
//   TEACHES  what was measured is saved per session (collection tape_learning) and written into the trading-skills file
//            every AI feature reads.
//
// It reads the market only: it cannot place an order, and it never asks an AI model.

const T = require("./market/tapeflow");

const IST = 5.5 * 3600 * 1000;
const COLD = "market_tape";
const INDEX = "market/tape-index.json";
const MODEL = "market/flow-model.json";
const LEARNING = "tape_learning";
const SECTION = "## What the recorded order book and open interest have measured (written by itself after every evening's learning)";
const INDEXES = ["NIFTY 50", "NIFTY BANK", "INDIA VIX"];
const FUT_NAME = { "NIFTY 50": "NIFTY", "NIFTY BANK": "BANKNIFTY" };
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const MAX_STOCKS = 240; // with their futures: under the 500 instruments one quote request may ask for
const CHUNK = 480;
const SAVE_MS = 5 * 60000;
const KEEP_SESSIONS = 500; // about two years
const MIN_TAKEN = 60; // a session with fewer minutes than this read is not learned from
const MIN_EVIDENCE = 20000; // forecasts scored out of sample before the readings may be used
const MIN_GAIN = 0.002;
const FADE = 0.97;
const HORIZONS = [1, 2, 3, 4, 6]; // 5-minute bars ahead: the forecaster's own horizons
const K3 = HORIZONS.indexOf(3);

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const iso = (ms) => new Date(ms).toISOString();
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const tick = () => new Promise((r) => setImmediate(r));

const WORDS = {
  imb: ["more quantity waiting to buy than to sell", "more quantity waiting to sell than to buy"],
  dImb: ["buyers' share of the book growing over five minutes", "sellers' share of the book growing over five minutes"],
  imbAvg: ["a book that has leaned to buyers for fifteen minutes", "a book that has leaned to sellers for fifteen minutes"],
  imbRel: ["a book bid more than the rest of the market's", "a book offered more than the rest of the market's"],
  mktImb: ["the whole market's book leaning to buyers", "the whole market's book leaning to sellers"],
  oi15: ["open interest rising over fifteen minutes", "open interest falling over fifteen minutes"],
  oiDay: ["open interest up on the day", "open interest down on the day"],
  build: ["long build-up (price and open interest rising)", "short build-up (price falling, open interest rising)"],
  cover: ["short covering (price rising, open interest falling)", "long unwinding (price and open interest falling)"],
  basis: ["the future's premium widening", "the future's premium narrowing"],
};

class Recorder {
  /**
   * @param market       the MarketService: mode(), _call(fn), derivatives(), watchlist() — reads only
   * @param docs         the record store (cold shelf, the index, the model, the learning list)
   * @param universe     () => the NIFTY 100's symbols
   * @param horizon      the 15-minute forecaster: replay(dates, each), storedTo() — optional (without it nothing is learned)
   * @param playbook     the trading-skills file (setSection), optional
   * @param isTradingDay (YYYY-MM-DD) => boolean; weekdays when not given
   */
  constructor({ market, docs, universe, horizon = null, playbook = null, isTradingDay = weekday, now = () => Date.now(), log = console }) {
    this.market = market;
    this.docs = docs;
    this.universe = universe;
    this.horizon = horizon;
    this.playbook = playbook;
    this.isTradingDay = isTradingDay;
    this.now = now;
    this.log = log;
    this.timer = null;
    this.day = null; // today's readings, in memory while the session runs
    this._mkt = null; // { slot, v }: the market's own imbalance, worked out once a minute
    this._slot = -1;
    this._dirty = false;
    this._savedAt = 0;
    this._busy = false;
    this._job = null;
    this._idx = null;
    this._model = null;
    this._rev = 0;
    this._futFor = null; // { date, map }
    this.lastError = "";
    this.stats = {
      snapshots: 0,
      failed: 0,
      lastAt: null,
      lastStocks: 0,
      lastMs: 0,
    };
  }

  /* --------------------------------------------------------------------------- the index and the model */
  _index() {
    if (!this._idx) this._idx = this.docs.read(INDEX, null) || { days: {} };
    return this._idx;
  }

  _saveIndex() {
    this._rev += 1;
    this.docs.write(INDEX, this._idx);
  }

  model() {
    if (!this._model)
      this._model = this.docs.read(MODEL, null) || {
        version: T.VERSION,
        features: T.FLOW,
        K: HORIZONS.length,
        sums: null,
        W: null,
        on: false,
        evidence: {
          n: 0,
          se0: HORIZONS.map(() => 0),
          se1: HORIZONS.map(() => 0),
        },
        lastDate: "",
        days: 0,
        rows: 0,
        skipped: [],
        history: [],
        at: null,
      };
    return this._model;
  }

  _saveModel(m) {
    this._rev += 1;
    this._model = m;
    this.docs.write(MODEL, m);
  }

  fingerprint() {
    const d = this.day;
    const j = this._job;
    return `${this._rev}|${d ? `${d.date}:${d.taken}` : ""}|${j ? `${j.phase}|${j.done}|${j.finishedAt || ""}` : ""}|${this._connected()}`;
  }

  _connected() {
    try {
      return typeof this.market.mode === "function" && this.market.mode() === "kite";
    } catch (_) {
      return false;
    }
  }

  /** The index is rebuilt from the shelf when it is missing (a restore, a first start on an existing database). */
  async reindex() {
    const list = typeof this.docs.coldList === "function" ? await this.docs.coldList(COLD) : [];
    const idx = this._index();
    let changed = false;
    for (const r of list) {
      if (idx.days[r.id]) continue;
      const rec = await this.docs.coldGet(COLD, r.id);
      if (!rec) continue;
      idx.days[r.id] = {
        date: r.id,
        symbols: (rec.symbols || []).length,
        futures: Object.keys(rec.fut || {}).length,
        taken: rec.taken || 0,
        bytes: r.bytes || (rec.z || "").length,
        first: rec.first || null,
        last: rec.last || null,
      };
      changed = true;
    }
    const have = new Set(list.map((r) => r.id));
    for (const d of Object.keys(idx.days)) {
      if (!have.has(d) && !(this.day && this.day.date === d)) {
        delete idx.days[d];
        changed = true;
      }
    }
    if (changed) this._saveIndex();
    return Object.keys(idx.days).length;
  }

  /* --------------------------------------------------------------------------- what is read */
  _symbols() {
    const set = new Set();
    try {
      for (const s of this.universe() || []) set.add(s);
    } catch (_) {
      /* no universe yet */
    }
    try {
      for (const s of this.market.watchlist ? this.market.watchlist() : []) set.add(s);
    } catch (_) {
      /* no watchlist */
    }
    const stocks = [...set].filter((s) => SYMBOL_RE.test(s) && !/^DEMO/.test(s)).slice(0, MAX_STOCKS);
    return [...INDEXES, ...stocks.filter((s) => !INDEXES.includes(s))];
  }

  /** The near-month future of each symbol that has one (the contract list is read once a day by the market service). */
  async _futures(date, symbols) {
    if (this._futFor && this._futFor.date === date && this._futFor.n >= symbols.length) return this._futFor.map;
    const map = {};
    try {
      const list = typeof this.market.derivatives === "function" ? await this.market.derivatives() : [];
      const best = new Map();
      for (const c of list) {
        if (c.y !== "FUT" || !c.e || c.e < date) continue;
        const cur = best.get(c.n);
        if (!cur || c.e < cur.e) best.set(c.n, c);
      }
      for (const s of symbols) {
        const c = best.get(FUT_NAME[s] || s);
        if (c) map[s] = c.s;
      }
    } catch (err) {
      this.lastError = `futures list: ${err && err.message ? err.message : err}`;
    }
    this._futFor = { date, map, n: symbols.length };
    return map;
  }

  async _open(date) {
    const symbols = this._symbols();
    let day = null;
    try {
      const rec = typeof this.docs.coldGet === "function" ? await this.docs.coldGet(COLD, date) : null;
      day = rec ? T.unpackDay(rec) : null; // a restart in the middle of the session: the morning is read back
    } catch (_) {
      day = null;
    }
    const fut = await this._futures(date, symbols);
    if (!day) day = T.emptyDay(date, symbols, fut);
    for (const s of symbols) T.addSymbol(day, s);
    day.fut = { ...day.fut, ...fut };
    this.day = day;
    this._mkt = null;
    this._slot = -1;
    this._dirty = false;
    return day;
  }

  /** One minute's reading of everything. @returns how many stocks answered */
  async snapshot(slot) {
    const day = this.day;
    if (!day) return 0;
    const started = this.now();
    const keys = [];
    const eqKey = new Map();
    const fuKey = new Map();
    for (const s of day.symbols) {
      keys.push(`NSE:${s}`);
      eqKey.set(`NSE:${s}`, s);
      if (day.fut[s]) {
        keys.push(`NFO:${day.fut[s]}`);
        fuKey.set(`NFO:${day.fut[s]}`, s);
      }
    }
    const eq = {};
    const fu = {};
    try {
      for (let i = 0; i < keys.length; i += CHUNK) {
        const raw = await this.market._call((k) => k.quotes(keys.slice(i, i + CHUNK)));
        for (const [key, q] of Object.entries(raw || {})) {
          if (eqKey.has(key)) eq[eqKey.get(key)] = q;
          else if (fuKey.has(key)) fu[fuKey.get(key)] = q;
        }
      }
    } catch (err) {
      this.stats.failed += 1;
      this.lastError = `${iso(this.now())} ${err && err.message ? err.message : err}`;
      return 0;
    }
    const n = T.putSnapshot(day, slot, eq, fu, iso(started));
    if (n) {
      this._dirty = true;
      this._mkt = null;
      this.stats.snapshots += 1;
      this.stats.lastAt = iso(started);
      this.stats.lastStocks = n;
      this.stats.lastMs = this.now() - started;
      this.lastError = "";
    } else this.stats.failed += 1;
    return n;
  }

  async _save() {
    const day = this.day;
    if (!day || !day.taken || typeof this.docs.coldPut !== "function") return;
    const rec = T.packDay(day);
    await this.docs.coldPut(COLD, day.date, rec);
    this._index().days[day.date] = {
      date: day.date,
      symbols: day.symbols.length,
      futures: Object.keys(day.fut).length,
      taken: day.taken,
      bytes: rec.z.length,
      first: day.first,
      last: day.last,
    };
    this._saveIndex();
    this._dirty = false;
    this._savedAt = this.now();
  }

  async _prune() {
    const idx = this._index();
    const dates = Object.keys(idx.days).sort();
    const old = dates.slice(0, Math.max(0, dates.length - KEEP_SESSIONS));
    if (!old.length) return;
    await this.docs.coldRemove(COLD, old);
    for (const d of old) delete idx.days[d];
    this._saveIndex();
  }

  /** A stored session (today's from memory), or null. */
  async dayOf(date) {
    if (this.day && this.day.date === date) return this.day;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || typeof this.docs.coldGet !== "function") return null;
    const rec = await this.docs.coldGet(COLD, date);
    return rec ? T.unpackDay(rec) : null;
  }

  async csv(date) {
    const day = await this.dayOf(date);
    return day ? T.dayCsv(day) : null;
  }

  /* --------------------------------------------------------------------------- the clock */
  async tickOnce() {
    if (this._busy) return;
    this._busy = true;
    try {
      const now = this.now();
      const date = istDate(now);
      const slot = T.slotOf(now);
      const open = this.isTradingDay(date) && slot >= 0;
      if (open && this._connected()) {
        if (!this.day || this.day.date !== date) await this._open(date);
        if (slot !== this._slot) {
          this._slot = slot;
          await this.snapshot(slot);
        }
        if (this._dirty && (now - this._savedAt >= SAVE_MS || slot >= T.SLOTS - 1)) await this._save();
      } else if (this.day) {
        if (this._dirty) await this._save();
        if (this.day.date !== date) {
          this.day = null;
          this._slot = -1;
          await this._prune();
        }
      }
    } finally {
      this._busy = false;
    }
  }

  start() {
    if (this.timer) return;
    this.reindex().catch(() => {});
    this.timer = setInterval(() => {
      this.tickOnce().catch((err) => {
        this.lastError = err.message;
        this.log.error(`[recorder] ${err.message}`);
      });
    }, 10000);
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop the clock and put what is in memory on the shelf (a restart must not lose the last minutes). */
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this._dirty) await this._save().catch(() => {});
  }

  /* --------------------------------------------------------------------------- the readings for now */
  _marketNow(slot) {
    if (!this.day) return null;
    if (!this._mkt || this._mkt.date !== this.day.date) this._mkt = { date: this.day.date, v: T.marketImb(this.day) };
    return this._mkt.v;
  }

  /**
   * The order book and open interest of a stock as of a 5-minute bar's close, and the correction they have earned.
   * @returns { read, on, tilts, gain } or null when the stock was not read around that minute
   */
  tiltFor(symbol, endMs) {
    const day = this.day;
    if (!day || day.date !== istDate(endMs)) return null;
    const slot = T.slotOf(endMs);
    if (slot < 0) return null;
    const mkt = this._marketNow(slot);
    const z = T.featuresAt(day, symbol, slot, mkt);
    if (!z) return null;
    const m = this.model();
    const on = Boolean(m.on && m.W);
    return {
      read: T.describe(day, symbol, slot, mkt),
      on,
      tilts: on ? T.tiltsOf(m.W, z) : null,
      gain: this._gain(m)[K3],
      evidence: m.evidence.n,
    };
  }

  /* --------------------------------------------------------------------------- the evening's learning */
  _gain(m) {
    return HORIZONS.map((_, k) => (m.evidence.se0[k] > 0 ? r4((m.evidence.se0[k] - m.evidence.se1[k]) / m.evidence.se0[k]) : null));
  }

  _ready() {
    try {
      return typeof this.horizon.ready !== "function" || Boolean(this.horizon.ready());
    } catch (_) {
      return false;
    }
  }

  _storedTo() {
    try {
      return this.horizon && typeof this.horizon.storedTo === "function" ? this.horizon.storedTo() || "" : "";
    } catch (_) {
      return "";
    }
  }

  /** The recorded sessions the price history now covers that have not been learned yet, oldest first. */
  pendingDates() {
    if (!this.horizon || !this._ready()) return []; // no forecaster, or it has no model just now: the sessions wait, none is passed over
    const m = this.model();
    const to = this._storedTo();
    if (!to) return [];
    const open = this.day && T.slotOf(this.now()) >= 0 ? this.day.date : ""; // a session still being recorded waits for its close
    return Object.values(this._index().days)
      .filter((d) => d.date > (m.lastDate || "") && d.date <= to && d.date !== open)
      .map((d) => d.date)
      .sort();
  }

  /** For the supervisor: how many recorded sessions wait to be learned (0 while a run is on). */
  behind() {
    if (this._job && !this._job.finishedAt) return 0;
    return this.pendingDates().length;
  }

  jobView() {
    return this._job ? { ...this._job } : null;
  }

  learn({ trigger = "itself" } = {}) {
    if (this._job && !this._job.finishedAt) return Promise.resolve({ busy: true });
    const dates = this.pendingDates();
    if (!dates.length) return Promise.resolve({ days: 0 });
    this._job = {
      trigger,
      phase: "reading the recorded sessions",
      total: dates.length,
      done: 0,
      rows: 0,
      startedAt: iso(this.now()),
      finishedAt: null,
      error: "",
    };
    this._rev += 1;
    return this._learn(dates)
      .catch((err) => {
        this._job.error = err.message || String(err);
        this.lastError = this._job.error;
        this.log.error(`[recorder] learning failed: ${this._job.error}`);
        throw err;
      })
      .finally(() => {
        this._job.finishedAt = iso(this.now());
        this._rev += 1;
      });
  }

  async _learn(dates) {
    const job = this._job;
    const m = JSON.parse(JSON.stringify(this.model()));
    const K = HORIZONS.length;
    const sums = T.Sums.from(m.sums, K);
    let W = m.W || null;
    let learned = 0;
    for (const date of dates) {
      if (!this._ready()) break; // the forecaster lost its model meanwhile (it is retraining): the rest waits
      job.phase = `learning ${date}`;
      const idx = this._index().days[date];
      const day = idx && idx.taken >= MIN_TAKEN ? await this.dayOf(date) : null;
      let rowsDay = 0;
      const se0 = HORIZONS.map(() => 0);
      const se1 = HORIZONS.map(() => 0);
      let scored = 0;
      const fresh = [];
      if (day) {
        const mkt = T.marketImb(day);
        await this.horizon.replay([date], (sym, d, rows) => {
          for (const row of rows) {
            if (!row.p || !row.y) continue;
            const z = T.featuresAt(day, sym, T.slotOf(row.t + 5 * 60000), mkt);
            if (!z) continue;
            const res = new Float64Array(K);
            let ok = true;
            for (let k = 0; k < K; k += 1) {
              res[k] = row.y[k] - row.p[k];
              if (!num(res[k])) ok = false;
            }
            if (!ok) continue;
            // first the test, with the weights as they stood before this session; then the lesson
            if (W) {
              const t = T.tiltsOf(W, z);
              for (let k = 0; k < K; k += 1) {
                se0[k] += res[k] * res[k];
                se1[k] += (res[k] - t[k]) ** 2;
              }
              scored += 1;
            }
            fresh.push([z, res]);
          }
        });
        await tick();
      }
      if (!fresh.length) {
        // nothing usable was recorded (too few minutes read, or the price history has no such session): it is passed over, and said so
        m.skipped = [...(m.skipped || []), date].slice(-30);
      } else {
        sums.scale(FADE);
        for (const [z, res] of fresh) sums.add(z, res);
        rowsDay = fresh.length;
        m.evidence.n = Math.round(m.evidence.n * FADE) + scored;
        m.evidence.se0 = m.evidence.se0.map((v, k) => v * FADE + se0[k]);
        m.evidence.se1 = m.evidence.se1.map((v, k) => v * FADE + se1[k]);
        W = T.fitSums(sums) || W;
        m.days = (m.days || 0) + 1;
        m.rows = (m.rows || 0) + rowsDay;
        learned += 1;
        const g = se0[K3] > 0 ? r4((se0[K3] - se1[K3]) / se0[K3]) : null;
        m.history = [...(m.history || []), { date, rows: rowsDay, scored, gain15: g }].slice(-40);
      }
      m.lastDate = date;
      job.done += 1;
      job.rows += rowsDay;
      this._rev += 1;
    }
    m.sums = sums.toJSON();
    m.W = W;
    const gain = this._gain(m);
    // in use only on proof: enough forecasts scored out of sample, and a real reduction of the miss at 15 minutes;
    // once in use it stays while it does no harm, so it does not flicker on one bad day
    const was = Boolean(m.on);
    m.on = Boolean(W) && m.evidence.n >= MIN_EVIDENCE && num(gain[K3]) && (was ? gain[K3] >= 0 : gain[K3] >= MIN_GAIN);
    m.changed = m.on !== was ? { at: iso(this.now()), to: m.on ? "in use" : "out of use" } : m.changed || null;
    m.at = iso(this.now());
    m.evidence.se0 = m.evidence.se0.map((v) => Math.round(v * 100) / 100);
    m.evidence.se1 = m.evidence.se1.map((v) => Math.round(v * 100) / 100);
    this._saveModel(m);
    if (learned) this._teach(m, dates);
    job.phase = "done";
    this.log.log(
      `[recorder] learned ${learned} recorded session(s) to ${m.lastDate}: order book and open interest ${m.on ? "IN USE" : "not in use"} (${m.evidence.n} forecasts scored, gain at 15 min ${gain[K3] === null ? "—" : `${(gain[K3] * 100).toFixed(2)}%`})`,
    );
    return { days: learned, to: m.lastDate, on: m.on };
  }

  /** The readings that carry the most weight at 15 minutes, in words. */
  _drivers(m) {
    if (!m.W || !m.W[K3]) return [];
    return T.FLOW.map((f, i) => ({ key: f, w: m.W[K3][i] }))
      .filter((x) => Math.abs(x.w) >= 0.002)
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
      .slice(0, 3)
      .map((x) => ({
        key: x.key,
        weight: r4(x.w),
        text: `${WORDS[x.key][0]} → the price ends ${x.w > 0 ? "higher" : "lower"} than the forecaster alone said`,
      }));
  }

  _lessons(m) {
    const g = this._gain(m)[K3];
    const out = [];
    out.push(`${m.days} recorded session${m.days === 1 ? "" : "s"} learned (${(m.rows || 0).toLocaleString("en-IN")} forecasts set against the order book and open interest of their minute), the last on ${m.lastDate || "—"}.`);
    if (!m.W) out.push("Too few recorded forecasts yet to fit any weight: nothing from the order book or open interest is used.");
    else if (m.evidence.n < MIN_EVIDENCE)
      out.push(`Weights are fitted but not proven: ${m.evidence.n.toLocaleString("en-IN")} forecasts have been scored out of sample and ${MIN_EVIDENCE.toLocaleString("en-IN")} are needed before they may be used.`);
    else if (m.on)
      out.push(`IN USE: on sessions the weights had not seen, adding the order book and open interest cut the forecaster's squared miss at 15 minutes by ${(g * 100).toFixed(2)}%. The live forecast now carries that correction.`);
    else
      out.push(
        `NOT IN USE: on sessions the weights had not seen, adding the order book and open interest changed the forecaster's squared miss at 15 minutes by ${g === null ? "nothing measurable" : `${(g * 100).toFixed(2)}%`} — under the ${(MIN_GAIN * 100).toFixed(1)}% needed, so the live forecast leaves them out.`,
      );
    const d = this._drivers(m);
    if (d.length) out.push(`Strongest readings so far${m.on ? "" : " (provisional: they count for nothing until the test above is passed)"}: ${d.map((x) => x.text).join("; ")}.`);
    return out;
  }

  _teach(m, dates) {
    const lessons = this._lessons(m);
    try {
      this.docs.putItems(LEARNING, [
        {
          id: `${m.lastDate}|${this.now().toString(36)}`,
          date: m.lastDate,
          at: m.at,
          sessions: dates,
          days: m.days,
          rows: m.rows,
          evidence: m.evidence.n,
          gain: this._gain(m),
          on: m.on,
          drivers: this._drivers(m),
          lessons,
        },
      ]);
      const old = this.docs
        .items(LEARNING)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(400)
        .map((r) => r.id);
      if (old.length) this.docs.removeItems(LEARNING, old);
    } catch (err) {
      this.log.error(`[recorder] could not save the lesson: ${err.message}`);
    }
    try {
      if (this.playbook && typeof this.playbook.setSection === "function") this.playbook.setSection(SECTION, lessons.map((l) => `- ${l}`).join("\n"));
    } catch (err) {
      this.log.error(`[recorder] could not write the skills file: ${err.message}`);
    }
  }

  /* --------------------------------------------------------------------------- for the screen */
  status() {
    const now = this.now();
    const date = istDate(now);
    const slot = T.slotOf(now);
    const trading = this.isTradingDay(date);
    const connected = this._connected();
    const min = minuteOfDay(now);
    const days = Object.values(this._index().days).sort((a, b) => (a.date < b.date ? -1 : 1));
    const m = this.model();
    const d = this.day && this.day.date === date ? this.day : null;
    let state = "closed";
    let detail = trading ? (min < T.OPEN_MIN ? "starts by itself at 9:15" : "the session is over; it starts again at 9:15 on the next trading day") : "the market is shut today";
    if (trading && slot >= 0) {
      state = connected ? "recording" : "needs-zerodha";
      detail = connected ? "reading every stock once a minute" : "waiting for today's Zerodha login — the minutes before it cannot be read afterwards";
    }
    const pending = this.pendingDates();
    return {
      state,
      detail,
      at: iso(now),
      what: "Every minute, 9:15 to 15:30: price, volume, average price, the quantity waiting to buy and to sell, and the near-month future's price, volume and open interest — for every NIFTY 100 stock, your watchlist, NIFTY 50, BANK NIFTY and India VIX.",
      today: d
        ? {
            date: d.date,
            taken: d.taken,
            expected: slot >= 0 ? slot + 1 : T.SLOTS,
            stocks: d.symbols.length - INDEXES.length,
            futures: Object.keys(d.fut).length,
            first: d.first,
            last: d.last,
            lastStocks: this.stats.lastStocks,
          }
        : null,
      stored: {
        sessions: days.length,
        from: days.length ? days[0].date : null,
        to: days.length ? days[days.length - 1].date : null,
        kb: Math.round(days.reduce((a, x) => a + (x.bytes || 0), 0) / 1024),
        minutes: days.reduce((a, x) => a + (x.taken || 0), 0),
      },
      days: days
        .slice(-30)
        .reverse()
        .map((x) => ({
          date: x.date,
          taken: x.taken,
          stocks: x.symbols,
          futures: x.futures,
          kb: Math.round((x.bytes || 0) / 1024),
        })),
      learner: {
        available: Boolean(this.horizon),
        on: Boolean(m.on && m.W),
        days: m.days || 0,
        rows: m.rows || 0,
        lastDate: m.lastDate || null,
        evidence: m.evidence.n,
        needed: MIN_EVIDENCE,
        gain15: this._gain(m)[K3],
        gains: HORIZONS.map((h, k) => ({
          minutes: h * 5,
          gain: this._gain(m)[k],
        })),
        waiting: pending.length,
        skipped: (m.skipped || []).slice(-5),
        drivers: this._drivers(m),
        lessons: this._lessons(m),
        history: (m.history || []).slice(-12).reverse(),
        changed: m.changed || null,
        at: m.at || null,
      },
      job: this.jobView(),
      error: this.lastError,
    };
  }
}

module.exports = {
  Recorder,
  COLD,
  INDEX,
  MODEL,
  LEARNING,
  SECTION,
  INDEXES,
  MIN_EVIDENCE,
  MIN_GAIN,
  KEEP_SESSIONS,
};
