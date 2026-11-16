"use strict";
// The Journal's Day book: one record per trading day, kept in the database, read back to the trader.
//
//   • At 3:45 PM IST on trading days (after the 3:30 PM close and the square-off) the day is captured
//     by itself: the day's closed round trips from the journal, the margin that is left, what is still
//     open, and the Nifty's move — built into the report in day.js. With an AI model switched on, one
//     more call writes the "why" in words (dayreview.js); without one, the report is the same arithmetic.
//   • Nothing is saved by hand: a day the server missed (it was down at 3:45, or the trades came later
//     from a Console tradebook) is saved by itself on the next hourly sweep — every day with closed
//     trades in the journal and no record yet, newest first. Each day can be given a note, a rating,
//     lessons and a mood. The figures themselves are never typed in: they come only from Zerodha's fills (the
//     journal reads them from Kite every day, and from Console tradebooks for the history). Figures
//     entered by hand in an earlier version are kept on the record ("formerOverrides") but not used.
//   • The records live in their own document, "analysis/days" (a collection of its own in MongoDB, a
//     file otherwise), apart from the journal, so a report survives whatever happens to the journal.
//
// It reads the trader's own figures through a narrow `source` the app hands in. It cannot place,
// change or cancel an order, and it holds the only timer (once a minute, started by the app).

const { buildDay, analytics } = require("./day");
const { labDay, labRange } = require("./lab");
const { compareDay } = require("./compare");
const SNAP = require("./snapshot");

const NAME = "analysis/days";
// three tables of their own (a collection each in MongoDB, one file each otherwise), apart from the day reports
const SNAPS = "analysis_snapshots"; // one record per day: the timeline of the day with its timestamps
const OUTS = "analysis_outcomes"; // one record per trade: what became of its peak
const LEARN = "analysis_learnings"; // the trader's status and notes on each learning, and their own lessons
const SNAP_KEEP = 800; // snapshots kept (about three years of trading days); the outcomes stay
const LAB = "analysis/lab"; // the Execution Lab, one replay per day (computed by itself on the sweep)
const LAB_DAYS = 60; // Zerodha keeps about 60 days of 1-minute bars
const LAB_VER = 2; // 2: the best exit with its time, the timing of each exit, the exit coach replayed
const IST = 5.5 * 3600 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AUTO_AT = 15 * 60 + 45; // 3:45 PM IST
const AUTO_UNTIL = 23 * 60 + 30;
const RETRY_MS = 10 * 60000;
const MAX_ATTEMPTS = 4;
const MAX_NOTE = 4000;
const SWEEP_MS = 60 * 60000; // the sweep for missed days: once an hour
const SWEEP_DAYS = 400; // how far back it looks
const SWEEP_MAX = 20; // days saved per sweep (a long imported history fills in over a few hours)

const num = (x) => typeof x === "number" && Number.isFinite(x);
const istParts = (ms) => {
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);

class AnalysisError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class DayAnalysis {
  /**
   * @param source  { closedTrips(date), funds(), positions(), market() } — each may reject; the report says what it could not read
   * @param ai      the AiService (optional): ai.dayReview.write(day), ai.configured()
   */
  constructor({ docs, source, ai = null, now = () => Date.now(), log = console, isHoliday = () => false }) {
    this.docs = docs;
    this.source = source;
    this.ai = ai;
    this.now = now;
    this.log = log;
    this.isHoliday = isHoliday;
    this.timer = null;
    this._busy = new Map();
  }

  /* --------------------------------------------------------------------- storage */

  _doc() {
    const d = this.docs.read(NAME, null);
    return { days: (d && d.days && typeof d.days === "object" ? d.days : {}) || {}, settings: { auto: true, withAi: true, ...((d && d.settings) || {}) }, auto: (d && d.auto) || {} };
  }

  _save(doc) {
    this.docs.write(NAME, doc);
  }

  settings() {
    const s = this._doc().settings;
    return { auto: true, withAi: Boolean(s.withAi), at: "15:45", aiReady: Boolean(this.ai && this.ai.configured()) };
  }

  setSettings(patch = {}) {
    const doc = this._doc();
    if (typeof patch.auto === "boolean") doc.settings.auto = patch.auto;
    if (typeof patch.withAi === "boolean") doc.settings.withAi = patch.withAi;
    this._save(doc);
    return this.settings();
  }

  _check(date) {
    if (!DATE_RE.test(String(date)) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new AnalysisError("That is not a valid date (use YYYY-MM-DD).");
    if (date > istParts(this.now()).date) throw new AnalysisError("That day has not happened yet.");
    return date;
  }

  /** The stored reports, newest first, light enough for a table. */
  list({ from = null, to = null } = {}) {
    const days = Object.values(this._doc().days).filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
    return days
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((d) => ({ date: d.date, weekday: d.weekday, source: d.source, capturedAt: d.capturedAt, editedAt: d.editedAt || null, edited: Boolean(d.edited), summary: d.summary, margin: d.margin, market: d.market, score: d.score, good: d.practices ? d.practices.good.length : 0, bad: d.practices ? d.practices.bad.length : 0, hasAi: Boolean(d.ai), rating: d.notes ? d.notes.rating : null, hasNote: Boolean(d.notes && (d.notes.text || (d.notes.lessons || []).length)) }));
  }

  get(date) {
    const d = this._doc().days[this._check(date)];
    if (!d) throw new AnalysisError("No report is saved for that day yet.", "not_found", 404);
    return d;
  }

  analytics({ from = null, to = null } = {}) {
    const doc = this._doc();
    return { ...analytics(Object.values(doc.days), { from, to }), count: Object.keys(doc.days).length, first: Object.keys(doc.days).sort()[0] || null };
  }

  /* ----------------------------------------------------------------------- capture */

  /**
   * Read the day and save its report. Notes, hand-entered figures and an earlier AI write-up on the
   * same day are kept. Reads only.
   * @param opts { by: "auto" | "manual", withAi: bool (write the AI analysis now) }
   */
  capture(date, opts = {}) {
    this._check(date);
    if (this._busy.has(date)) return this._busy.get(date);
    const p = this._capture(date, opts).finally(() => this._busy.delete(date));
    this._busy.set(date, p);
    return p;
  }

  async _read(fn, what, notes) {
    try {
      return await fn();
    } catch (err) {
      notes.push(`${what} could not be read (${err && err.message ? err.message : "failed"}).`);
      return null;
    }
  }

  async _capture(date, { by = "manual", withAi = false } = {}) {
    const notes = [];
    const doc0 = this._doc();
    const old = doc0.days[date] || null;
    const isToday = date === istParts(this.now()).date;
    const trips = (await this._read(() => this.source.closedTrips(date), "The trades", notes)) || [];
    // funds and open positions are only meaningful for a day that has just closed
    const funds = isToday ? await this._read(() => this.source.funds(), "The margin", notes) : null;
    const positions = isToday ? await this._read(() => this.source.positions(), "The open positions", notes) : null;
    const market = isToday ? await this._read(() => this.source.market(), "The Nifty's move", notes) : null;
    const history = Object.values(doc0.days).map((d) => ({ date: d.date, summary: d.summary }));
    const day = buildDay({ date, trips, funds, market, history, openPositions: positions });
    const at = new Date(this.now()).toISOString();
    const rec = {
      ...day,
      source: by === "auto" ? "auto" : old && old.source === "auto" ? "auto" : "manual",
      capturedAt: at,
      editedAt: old ? old.editedAt || null : null,
      overrides: null,
      formerOverrides: old ? old.formerOverrides || old.overrides || null : null,
      // a margin read earlier the same day is kept when the broker cannot be read again
      margin: day.margin || (old ? old.margin : null),
      notes: old && old.notes ? old.notes : { text: "", rating: null, lessons: [], mood: "" },
      ai: old ? old.ai || null : null,
      readNotes: notes,
    };
    if (!trips.length && !old && by === "auto") return { skipped: "no trades", date, notes };
    if (withAi || (by === "auto" && this.settings().withAi)) await this._writeAi(rec);
    const doc = this._doc();
    doc.days[date] = rec;
    this._save(doc);
    this.log.log(`[analysis] ${date} saved (${by}): ${rec.summary.trades} trades, net ${rec.summary.net}${rec.ai ? ", with AI analysis" : ""}`);
    return rec;
  }

  async _writeAi(rec) {
    if (!this.ai || !this.ai.dayReview) {
      rec.aiError = "AI analysis is not available.";
      return;
    }
    if (!this.ai.configured()) {
      rec.aiError = "No AI key is saved, so the analysis below is the desk's own arithmetic.";
      return;
    }
    if (!rec.summary.trades) {
      rec.aiError = "There were no trades to analyse.";
      return;
    }
    try {
      rec.ai = await this.ai.dayReview.write(rec);
      rec.aiError = "";
    } catch (err) {
      rec.aiError = err && err.message ? err.message : "The AI analysis failed.";
    }
  }

  /** The AI's write-up for a stored day, on demand. */
  async writeAi(date) {
    const rec = this.get(date);
    await this._writeAi(rec);
    const doc = this._doc();
    doc.days[date] = rec;
    this._save(doc);
    return rec;
  }

  /* -------------------------------------------------------------------------- notes */

  /**
   * Your notes on a day: a note, a rating, lessons and a mood. They change no figure. The figures
   * are never edited by hand — they come only from Zerodha's fills.
   */
  async edit(date, { notes, overrides } = {}) {
    this._check(date);
    if (overrides && typeof overrides === "object" && Object.keys(overrides).length) throw new AnalysisError("The figures come only from Zerodha's trades and cannot be edited by hand. Add the day's trades to the journal (Kite reads them each day; Console tradebooks for the history) and press Save this day.", "read_only", 400);
    if (!notes || typeof notes !== "object") throw new AnalysisError("Nothing to save: write a note, a rating, a lesson or a mood.");
    if (!this._doc().days[date]) {
      // a note on a day with nothing saved: build the day from the journal first so there is something to annotate
      const r = await this.capture(date, { by: "manual" });
      if (r && r.skipped) throw new AnalysisError("No closed trades are on record for that day, so there is no report to add a note to.", "no_trades", 404);
    }
    const lessons = (Array.isArray(notes.lessons) ? notes.lessons : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 8);
    const doc = this._doc();
    const rec = { ...doc.days[date], notes: { text: str(notes.text, MAX_NOTE), rating: [1, 2, 3, 4, 5].includes(Number(notes.rating)) ? Number(notes.rating) : null, lessons, mood: str(notes.mood, 40) }, editedAt: new Date(this.now()).toISOString() };
    doc.days[date] = rec;
    this._save(doc);
    return rec;
  }

  /**
   * Days whose figures were entered by hand in an earlier version are rebuilt from the journal once:
   * the hand-entered figures are kept as "formerOverrides" (a record), notes and the AI write-up stay.
   * @returns the dates rebuilt
   */
  async dropHandFigures() {
    const dates = Object.values(this._doc().days).filter((d) => d.overrides && Object.keys(d.overrides).length).map((d) => d.date);
    for (const date of dates) {
      const doc = this._doc();
      const old = doc.days[date];
      const trips = (await this._read(() => this.source.closedTrips(date), "The trades", [])) || [];
      const history = Object.values(doc.days).filter((d) => d.date !== date).map((d) => ({ date: d.date, summary: d.summary }));
      const day = buildDay({ date, trips, funds: null, market: null, history, openPositions: null });
      const d2 = this._doc();
      d2.days[date] = { ...old, ...day, margin: old.margin && old.margin.source === "kite" ? old.margin : day.margin, market: old.market || day.market, overrides: null, formerOverrides: old.overrides, edited: false, source: old.source === "auto" ? "auto" : "manual", notes: old.notes, ai: old.ai || null };
      this._save(d2);
    }
    if (dates.length) this.log.log(`[analysis] rebuilt ${dates.length} day${dates.length === 1 ? "" : "s"} from the journal (hand-entered figures are no longer used): ${dates.join(", ")}`);
    return dates;
  }

  remove(date) {
    this._check(date);
    const doc = this._doc();
    if (!doc.days[date]) throw new AnalysisError("No report is saved for that day.", "not_found", 404);
    delete doc.days[date];
    this._save(doc);
    return { removed: date };
  }

  /* ---------------------------------------------------------------------- the clock */

  /**
   * The days with closed trades in the journal but no record — saved by themselves, newest first, at
   * most SWEEP_MAX per call, without the AI write-up (it can be asked for on any day). Today is left to
   * the 3:45 PM capture. Returns the dates saved.
   */
  async backfill({ max = SWEEP_MAX } = {}) {
    if (!this.source || typeof this.source.daysWithTrips !== "function") return [];
    const today = istParts(this.now()).date;
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - SWEEP_DAYS * 86400000).toISOString().slice(0, 10);
    let dates;
    try {
      dates = await this.source.daysWithTrips(from, today);
    } catch (_) {
      return [];
    }
    const have = this._doc().days;
    const missing = (dates || []).filter((d) => d < today && !have[d]).sort().reverse().slice(0, max);
    const saved = [];
    for (const d of missing) {
      try {
        const r = await this.capture(d, { by: "auto" });
        if (r && r.summary) saved.push(d);
      } catch (err) {
        this.log.log(`[analysis] could not save ${d}: ${err.message}`);
      }
    }
    if (saved.length) this.log.log(`[analysis] saved ${saved.length} missed day(s) by itself: ${saved.join(", ")}`);
    return saved;
  }

  /* ------------------------------------------------------------- the Execution Lab */

  _labDoc() {
    const d = this.docs.read(LAB, null);
    return { days: (d && d.days && typeof d.days === "object" ? d.days : {}) || {} };
  }

  /** The day's limits in ₹ from the daily-goal percentages and that morning's margin (when the Day book has it). */
  _limits(date, net) {
    if (!this.source || typeof this.source.discipline !== "function") return null;
    let cfg;
    try {
      cfg = this.source.discipline();
    } catch (_) {
      return null;
    }
    const rec = this._doc().days[date];
    const m = rec && rec.margin;
    const closeEquity = m ? (typeof m.net === "number" ? m.net : typeof m.available === "number" ? m.available + (m.used || 0) : null) : null;
    if (!cfg || !num(closeEquity)) return null;
    const base = closeEquity - (net || 0);
    if (!(base > 0)) return null;
    return { stop: (base * (cfg.stopPct || 0)) / 100, target: (base * (cfg.targetPct || 0)) / 100 };
  }

  /**
   * The lab for one day: its closed trades replayed on that day's 1-minute bars. Kept once worked out;
   * worked out again only when the day's trades change (or on refresh). Reads only.
   */
  async lab(date, { refresh = false } = {}) {
    this._check(date);
    const trips = (await this.source.closedTrips(date)) || [];
    if (!trips.length) return { available: false, date, reason: "No closed trades in the journal for that day." };
    const sig = trips.map((t) => `${t.key || t.symbol}:${t.exitAt}:${t.net}`).sort().join("|");
    const have = this._labDoc().days[date];
    if (!refresh && have && have.sig === sig && have.ver === LAB_VER && !(have.lab.notes || []).some((n) => /could not be read/.test(n))) return { available: true, ...have.lab, cachedAt: have.at };
    const bars = await this._bars(date, trips);
    const net = trips.reduce((a, t) => a + (num(t.net) ? t.net : 0), 0);
    const lab = labDay({ date, trips, bars, limits: this._limits(date, net) });
    const doc = this._labDoc();
    doc.days[date] = { ver: LAB_VER, sig, at: new Date(this.now()).toISOString(), lab };
    // only the last LAB_DAYS * 2 days are kept
    const keep = Object.keys(doc.days).sort().slice(-LAB_DAYS * 2);
    for (const k of Object.keys(doc.days)) if (!keep.includes(k)) delete doc.days[k];
    this.docs.write(LAB, doc);
    // the day's snapshot, its outcomes and the learnings are written from the same replay (the bars are in hand)
    await this._storeSnapshot(date, lab, bars, sig);
    return { available: true, ...lab, cachedAt: doc.days[date].at };
  }

  /** That day's 1-minute bars of every stock traded ({ SYMBOL: [bars] }); a stock whose bars cannot be read is left out. */
  async _bars(date, trips) {
    const bars = {};
    const open = Date.parse(`${date}T03:45:00Z`);
    const close = Date.parse(`${date}T10:00:00Z`);
    if (typeof this.source.minuteBars === "function") {
      for (const sym of [...new Set(trips.map((t) => t.symbol))]) {
        try {
          bars[sym] = await this.source.minuteBars(sym, open, close);
        } catch (_) {
          /* that stock is counted without the replay */
        }
      }
    }
    return bars;
  }

  /* ------------------------------------------- snapshots, outcomes and learnings (snapshot.js) */

  _tbl(name) {
    return typeof this.docs.items === "function" ? this.docs.items(name) : [];
  }

  _put(name, list) {
    if (list.length && typeof this.docs.putItems === "function") this.docs.putItems(name, list);
  }

  _drop(name, ids) {
    if (ids.length && typeof this.docs.removeItems === "function") this.docs.removeItems(name, ids);
  }

  /** The recorded flights of a day (the live board's CCTV), when the app gave the door; never an error. */
  async _flights(date) {
    if (!this.source || typeof this.source.flightDay !== "function") return [];
    try {
      const d = await this.source.flightDay(date);
      return d && d.available && Array.isArray(d.flights) ? d.flights : [];
    } catch (_) {
      return [];
    }
  }

  /** Build the day's snapshot and keep it, with one outcome row per trade (the day's old rows are replaced). A failure never breaks the lab. */
  async _storeSnapshot(date, lab, bars, sig) {
    try {
      const snap = SNAP.buildSnapshot({ date, lab, bars, flights: await this._flights(date) });
      this._put(SNAPS, [{ id: date, ver: SNAP.VER, sig, at: new Date(this.now()).toISOString(), snap }]);
      const rows = SNAP.outcomeRows(snap);
      const fresh = new Set(rows.map((r) => r.id));
      this._drop(OUTS, this._tbl(OUTS).filter((r) => r.date === date && !fresh.has(r.id)).map((r) => r.id));
      this._put(OUTS, rows);
      const old = this._tbl(SNAPS).map((x) => x.id).sort();
      if (old.length > SNAP_KEEP) this._drop(SNAPS, old.slice(0, old.length - SNAP_KEEP));
      return snap;
    } catch (err) {
      this.log.log(`[analysis] could not record the snapshot of ${date}: ${err && err.message ? err.message : err}`);
      return null;
    }
  }

  /**
   * The snapshot of a day: its timeline with timestamps, the day's profit curve, and what became of each trade's
   * peak. Kept for good once worked out (the 1-minute bars it needs are gone from Zerodha after about 60 days).
   */
  async snapshot(date, { refresh = false } = {}) {
    this._check(date);
    const lab = await this.lab(date, { refresh });
    if (!lab.available) return { available: false, date, reason: lab.reason };
    const labRec = this._labDoc().days[date];
    let rec = this._tbl(SNAPS).find((x) => x.id === date) || null;
    if (!rec || rec.ver !== SNAP.VER || (labRec && rec.sig !== labRec.sig)) {
      const trips = (await this.source.closedTrips(date)) || [];
      await this._storeSnapshot(date, lab, await this._bars(date, trips), labRec ? labRec.sig : "");
      rec = this._tbl(SNAPS).find((x) => x.id === date) || null;
    }
    if (!rec) return { available: false, date, reason: "The snapshot could not be built for that day." };
    return { available: true, ...rec.snap, cachedAt: rec.at };
  }

  /** The recorded days, newest first, light enough for a list. */
  snapshots({ from = null, to = null } = {}) {
    return this._tbl(SNAPS)
      .filter((x) => (!from || x.id >= from) && (!to || x.id <= to))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .map((x) => ({ date: x.id, at: x.at, headline: x.snap.headline, summary: x.snap.summary }));
  }

  /** The outcomes table: one row per trade, newest first, with what the outcomes add up to. */
  outcomes({ from = null, to = null, outcome = null, symbol = null, limit = 1500 } = {}) {
    const all = this._tbl(OUTS)
      .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!symbol || r.symbol === symbol))
      .sort((a, b) => (a.date === b.date ? b.entryAt - a.entryAt : a.date < b.date ? 1 : -1));
    const shown = outcome ? all.filter((r) => r.outcome === outcome) : all;
    return { rows: shown.slice(0, limit), total: shown.length, summary: SNAP.outcomeSummary(all), outcomes: Object.keys(SNAP.OUTCOMES).map((id) => ({ id, name: SNAP.OUTCOMES[id].name, tone: SNAP.OUTCOMES[id].tone })), days: new Set(all.map((r) => r.date)).size, from, to };
  }

  /** The register of learnings: what not to repeat (and what to keep), counted from every outcome, with the trader's own status on each. */
  learnings() {
    const rows = this._tbl(OUTS);
    const dates = this._tbl(SNAPS).map((x) => x.id);
    const list = SNAP.learnings(rows, this._tbl(LEARN), dates);
    return { learnings: list, days: new Set(rows.map((r) => r.date)).size, trades: rows.length, statuses: SNAP.STATUSES };
  }

  /** The trader's own lesson, written in words ("I will not …"). */
  addLearning({ text, rule = "", title = "" } = {}) {
    const t = str(text, 600);
    if (t.length < 4) throw new AnalysisError("Write the lesson in a few words (at least four characters).");
    if (this._tbl(LEARN).filter((m) => m.kind === "own").length >= 100) throw new AnalysisError("You have 100 lessons of your own already: remove one before adding another.", "too_many", 400);
    const id = `own:${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const rec = { id, kind: "own", title: str(title, 120) || str(t, 80), text: t, rule: str(rule, 600), status: "open", note: "", masteredAt: null, createdAt: new Date(this.now()).toISOString() };
    this._put(LEARN, [rec]);
    return this.learnings();
  }

  /** Your status and note on a learning (measured or your own); marking one "mastered" dates it, so a later repeat is flagged. */
  setLearning(id, patch = {}) {
    const key = String(id || "");
    const pattern = SNAP.PATTERNS.find((p) => p.id === key);
    const own = this._tbl(LEARN).find((m) => m.id === key);
    if (!pattern && !(own && own.kind === "own")) throw new AnalysisError("There is no such learning.", "not_found", 404);
    const cur = own || { id: key, kind: "pattern", status: "open", note: "", masteredAt: null };
    const next = { ...cur };
    if (patch.status !== undefined) {
      if (!SNAP.STATUSES.includes(patch.status)) throw new AnalysisError(`The status is one of: ${SNAP.STATUSES.join(", ")}.`);
      next.status = patch.status;
      next.masteredAt = patch.status === "mastered" ? (cur.status === "mastered" && cur.masteredAt) || istParts(this.now()).date : null;
    }
    if (patch.note !== undefined) next.note = str(patch.note, 600);
    if (own && own.kind === "own") {
      if (patch.text !== undefined) {
        const t = str(patch.text, 600);
        if (t.length < 4) throw new AnalysisError("Write the lesson in a few words (at least four characters).");
        next.text = t;
        next.title = str(patch.title, 120) || str(t, 80);
      }
      if (patch.rule !== undefined) next.rule = str(patch.rule, 600);
    }
    next.updatedAt = new Date(this.now()).toISOString();
    this._put(LEARN, [next]);
    return this.learnings();
  }

  /** Remove a lesson of your own. The measured ones come from your trades and stay: mark them "ignored" to set them aside. */
  removeLearning(id) {
    const key = String(id || "");
    const own = this._tbl(LEARN).find((m) => m.id === key);
    if (!own || own.kind !== "own") {
      if (SNAP.PATTERNS.some((p) => p.id === key)) throw new AnalysisError("A measured learning comes from your own trades and cannot be deleted: mark it ignored to set it aside.", "read_only", 400);
      throw new AnalysisError("There is no such lesson.", "not_found", 404);
    }
    this._drop(LEARN, [key]);
    return this.learnings();
  }

  /** The days with a replay but no snapshot yet (or an old one): snapshots built by themselves, a few per sweep. */
  async snapshotBackfill({ max = 5 } = {}) {
    const have = new Map(this._tbl(SNAPS).map((x) => [x.id, x]));
    const todo = Object.keys(this._labDoc().days)
      .filter((d) => d <= istParts(this.now()).date && (!have.has(d) || have.get(d).ver !== SNAP.VER))
      .sort()
      .reverse()
      .slice(0, max);
    const done = [];
    for (const d of todo) {
      try {
        const r = await this.snapshot(d);
        if (r && r.available) done.push(d);
      } catch (_) {
        /* the next sweep tries again */
      }
    }
    return done;
  }

  /**
   * One day set against the trader's own earlier days (the last LAB_DAYS on record): today against
   * the usual, the habits to prevent, what to keep, the days and the trades most like it.
   */
  async compare(date) {
    const today = await this.lab(date);
    if (!today.available) return { available: false, date, reason: today.reason };
    const from = new Date(Date.parse(`${date}T00:00:00Z`) - LAB_DAYS * 86400000).toISOString().slice(0, 10);
    const history = Object.values(this._labDoc().days)
      .filter((x) => x.ver === LAB_VER)
      .map((x) => x.lab)
      .filter((l) => l && l.date < date && l.date >= from);
    return { available: true, ...compareDay(today, history) };
  }

  /** The lab added up over the days already worked out between `from` and `to`. */
  labRange({ from = null, to = null } = {}) {
    const doc = this._labDoc();
    const labs = Object.values(doc.days)
      .map((x) => x.lab)
      .filter((l) => l && (!from || l.date >= from) && (!to || l.date <= to));
    return { ...labRange(labs), from, to, worked: labs.length };
  }

  /** The days in the last LAB_DAYS with closed trades whose lab is missing: worked out by themselves (a few per sweep). */
  async labBackfill({ max = 5 } = {}) {
    if (!this.source || typeof this.source.daysWithTrips !== "function") return [];
    const today = istParts(this.now()).date;
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - LAB_DAYS * 86400000).toISOString().slice(0, 10);
    let dates;
    try {
      dates = await this.source.daysWithTrips(from, today);
    } catch (_) {
      return [];
    }
    const have = this._labDoc().days;
    const todo = (dates || []).filter((d) => !have[d] || (d === today && istParts(this.now()).mins >= AUTO_AT)).sort().reverse().slice(0, max);
    const done = [];
    for (const d of todo) {
      try {
        const r = await this.lab(d);
        if (r && r.available) done.push(d);
      } catch (_) {
        /* the next sweep tries again */
      }
    }
    return done;
  }

  /** Called every minute: capture today once, after 3:45 PM IST on a weekday, with a few tries; and once an hour, the missed days. */
  async tick() {
    const doc = this._doc();
    // every day is saved by itself now (the Journal's Day book has no manual save): the old switch is ignored
    if (this.now() - (this._sweptAt || 0) >= SWEEP_MS) {
      this._sweptAt = this.now();
      await this.backfill();
      await this.labBackfill();
      await this.snapshotBackfill();
    }
    const t = istParts(this.now());
    if (t.dow === 0 || t.dow === 6 || t.mins < AUTO_AT || t.mins > AUTO_UNTIL) return null;
    if (this.isHoliday(t.date)) return null;
    const a = doc.auto;
    if (a.done === t.date) return null;
    if (a.date === t.date && (a.attempts >= MAX_ATTEMPTS || this.now() - (a.lastTry || 0) < RETRY_MS)) return null;
    const attempts = a.date === t.date ? a.attempts + 1 : 1;
    doc.auto = { ...a, date: t.date, attempts, lastTry: this.now() };
    this._save(doc);
    let out;
    try {
      out = await this.capture(t.date, { by: "auto" });
    } catch (err) {
      this.log.log(`[analysis] automatic capture failed: ${err.message}`);
      return null;
    }
    // done for the day when a report was saved, or when there simply were no trades to report
    const after = this._doc();
    const noTrades = out && out.skipped === "no trades";
    const notRead = noTrades && (out.notes || []).some((n) => /trades could not be read/i.test(n));
    if (!notRead) {
      after.auto = { ...after.auto, done: t.date };
      this._save(after);
    }
    // the saved report, to the owner's phone when notifications are set up (server/notify.js)
    if (out && out.summary && typeof this.onReport === "function") Promise.resolve().then(() => this.onReport(out)).catch(() => {});
    return out;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.log(`[analysis] ${err.message}`));
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { DayAnalysis, AnalysisError, NAME };
