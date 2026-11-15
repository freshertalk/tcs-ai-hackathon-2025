"use strict";
// Trade Analysis: one record per trading day, kept in the database, read back to the trader.
//
//   • At 3:45 PM IST on trading days (after the 3:30 PM close and the square-off) the day is captured
//     by itself: the day's closed round trips from the journal, the margin that is left, what is still
//     open, and the Nifty's move — built into the report in day.js. With an AI model switched on, one
//     more call writes the "why" in words (dayreview.js); without one, the report is the same arithmetic.
//   • Any day can be captured again by hand, and edited: a note, a rating, lessons, and — for a day the
//     journal does not hold, or a figure it got wrong — the figures themselves (profit, loss, trades,
//     charges, margin). A hand-entered figure is marked as such everywhere it shows.
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
    const day = buildDay({ date, trips, funds, market, history, openPositions: positions, overrides: old && old.overrides ? old.overrides : null });
    const at = new Date(this.now()).toISOString();
    const rec = {
      ...day,
      source: old && old.source === "manual" && !trips.length ? "manual" : by === "auto" ? "auto" : old && old.source === "auto" ? "auto" : "manual",
      capturedAt: at,
      editedAt: old ? old.editedAt || null : null,
      overrides: old && old.overrides ? old.overrides : null,
      // a margin read earlier the same day is kept when the broker cannot be read again
      margin: day.margin || (old ? old.margin : null),
      notes: old && old.notes ? old.notes : { text: "", rating: null, lessons: [], mood: "" },
      ai: old ? old.ai || null : null,
      readNotes: notes,
    };
    if (!trips.length && !(rec.overrides && Object.keys(rec.overrides).length) && !old && by === "auto") return { skipped: "no trades", date, notes };
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

  /* -------------------------------------------------------------------------- edit */

  /**
   * A hand edit: the trader's own notes, and figures that replace the computed ones. Saved as given
   * (bounded), and the report is rebuilt so every total, percentage and chart follows.
   */
  async edit(date, { notes, overrides, clearOverrides } = {}) {
    this._check(date);
    const doc = this._doc();
    const old = doc.days[date];
    if (!old && !(overrides && Object.keys(overrides).length)) {
      // a note on a day with nothing saved: capture the day first so there is something to annotate
      await this.capture(date, { by: "manual" });
    }
    const cur = this._doc().days[date] || null;
    const next = {};
    if (notes && typeof notes === "object") {
      const lessons = (Array.isArray(notes.lessons) ? notes.lessons : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 8);
      next.notes = { text: str(notes.text, MAX_NOTE), rating: [1, 2, 3, 4, 5].includes(Number(notes.rating)) ? Number(notes.rating) : null, lessons, mood: str(notes.mood, 40) };
    }
    if (overrides && typeof overrides === "object") {
      const o = {};
      for (const k of ["trades", "wins", "losses"]) if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== "") {
        const v = Math.round(Number(overrides[k]));
        if (!Number.isFinite(v) || v < 0 || v > 5000) throw new AnalysisError(`"${k}" must be a whole number from 0 to 5000.`);
        o[k] = v;
      }
      for (const k of ["grossProfit", "grossLoss", "chargesTotal", "marginAvailable"]) if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== "") {
        const v = Number(overrides[k]);
        if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new AnalysisError(`"${k}" must be an amount from 0 to 1,00,00,00,000 (losses and charges are entered as positive numbers).`);
        o[k] = Math.round(v * 100) / 100;
      }
      next.overrides = Object.keys(o).length ? o : null;
    }
    if (clearOverrides) next.overrides = null;
    const rec = { ...(cur || {}), ...next, editedAt: new Date(this.now()).toISOString() };
    if (!cur) rec.date = date;
    // rebuild so the totals follow the overrides (or return to the journal's own figures)
    const trips = (await this._read(() => this.source.closedTrips(date), "The trades", [])) || [];
    const history = Object.values(doc.days).map((d) => ({ date: d.date, summary: d.summary }));
    const day = buildDay({ date, trips, funds: null, market: null, history, openPositions: null, overrides: rec.overrides });
    const merged = { ...rec, ...day, margin: day.margin && rec.overrides && num(rec.overrides.marginAvailable) ? day.margin : (cur && cur.margin) || day.margin, market: (cur && cur.market) || day.market, source: cur ? cur.source : "manual", capturedAt: cur ? cur.capturedAt : new Date(this.now()).toISOString(), practices: day.practices, notes: rec.notes || (cur && cur.notes) || { text: "", rating: null, lessons: [], mood: "" }, ai: cur ? cur.ai || null : null };
    if (merged.overrides) merged.edited = true;
    const d2 = this._doc();
    d2.days[date] = merged;
    this._save(d2);
    return merged;
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
