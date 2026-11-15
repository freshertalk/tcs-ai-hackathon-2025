"use strict";
// Trade Analysis: one record per trading day, kept in the database, read back to the trader.
//
//   • At 3:45 PM IST on trading days (after the 3:30 PM close and the square-off) the day is captured
//     by itself: the day's closed round trips from the journal, the margin that is left, what is still
//     open, and the Nifty's move — built into the report in day.js. With an AI model switched on, one
//     more call writes the "why" in words (dayreview.js); without one, the report is the same arithmetic.
//   • Any day can be built again from the journal ("Save this day"), and given a note, a rating, lessons
//     and a mood. The figures themselves are never typed in: they come only from Zerodha's fills (the
//     journal reads them from Kite every day, and from Console tradebooks for the history). Figures
//     entered by hand in an earlier version are kept on the record ("formerOverrides") but not used.
//   • The records live in their own document, "analysis/days" (a collection of its own in MongoDB, a
//     file otherwise), apart from the journal, so a report survives whatever happens to the journal.
//
// It reads the trader's own figures through a narrow `source` the app hands in. It cannot place,
// change or cancel an order, and it holds the only timer (once a minute, started by the app).

const { buildDay, analytics } = require("./day");

const NAME = "analysis/days";
const IST = 5.5 * 3600 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AUTO_AT = 15 * 60 + 45; // 3:45 PM IST
const AUTO_UNTIL = 23 * 60 + 30;
const RETRY_MS = 10 * 60000;
const MAX_ATTEMPTS = 4;
const MAX_NOTE = 4000;

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
    return { auto: Boolean(s.auto), withAi: Boolean(s.withAi), at: "15:45", aiReady: Boolean(this.ai && this.ai.configured()) };
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

  /** Called every minute: capture today once, after 3:45 PM IST on a weekday, with a few tries. */
  async tick() {
    const doc = this._doc();
    if (!doc.settings.auto) return null;
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
