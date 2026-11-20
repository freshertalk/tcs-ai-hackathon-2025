"use strict";
// The expiry calendar, as a service: it reads the exchanges' contract lists by itself, keeps the calendar, and notices
// when a date changes. The arithmetic is in market/expiry.js.
//
//   THE SOURCE   The contract list of NSE's derivatives segment (NFO) and of BSE's (BFO), as Zerodha publishes them for
//                everyone: https://api.kite.trade/instruments/NFO and …/BFO. A plain file — no login, no API key, no AI.
//                Each row is a contract the exchange has listed, with its expiry date.
//   LISTENING    Read once after the server starts, again every morning before the market opens, and every twelve hours
//                besides; after a failed read, again in half an hour. The last good list is kept, so a failed read
//                changes nothing on the page except the time it says it was last checked.
//   CHANGES      After each read the whole calendar is worked out again and compared with the one before. A week whose
//                date is no longer what it was (the exchange moved an expiry, a holiday was declared, the expiry weekday
//                itself changed) is kept in a short list with what it was and what it is now, and every open page is told
//                at once through the live channel.
//   NEXT YEAR    From 24 December the calendar runs to the end of the following year, by itself.
//
// It reads two public files and writes one small record. It cannot reach an account, an order or an AI model.

const X = require("./market/expiry");

const IST = 5.5 * 3600 * 1000;
const NAME = "market/expiry.json";
const BASE = "https://api.kite.trade/instruments";
const FRESH_MS = 12 * 3600000;
const RETRY_MS = 30 * 60000;
const MORNING = 8 * 60; // the day's list is out well before the 9:15 AM open
const KEEP_CHANGES = 40;
const TIMEOUT_MS = 90000;

const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

class ExpiryCalendar {
  /**
   * @param docs       the record store
   * @param cal        { isTradingDay(date), holidayName(date), known(date) } — the trading-holiday calendar
   * @param fetchImpl  fetch, or null where the network must not be touched (the calendar is then the rule's alone)
   */
  constructor({ docs, cal, fetchImpl = null, now = () => Date.now(), log = console, base = BASE }) {
    this.docs = docs;
    this.cal = cal;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.base = base;
    this.timer = null;
    this._rec = null;
    this._rev = 0;
    this._busy = null;
    this._view = null;
  }

  _load() {
    if (!this._rec) {
      const d = this.docs.read(NAME, null) || {};
      this._rec = { fetchedAt: d.fetchedAt || null, triedAt: d.triedAt || null, error: d.error || "", lists: d.lists || {}, seen: d.seen || {}, dates: d.dates || {}, weekday: d.weekday || {}, changes: Array.isArray(d.changes) ? d.changes : [] };
    }
    return this._rec;
  }
  _save() {
    this._rev += 1;
    this._view = null;
    this.docs.write(NAME, this._rec);
  }
  /** Changes whenever the calendar, the list or the last check does (the live hub compares it). */
  fingerprint() {
    const r = this._load();
    return `${this._rev}|${r.fetchedAt || ""}|${r.error ? 1 : 0}|${istDate(this.now())}`;
  }

  /* --------------------------------------------------------------------------- reading the exchanges' lists */
  async _download(file) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await this.fetch(`${this.base}/${file}`, { method: "GET", headers: { Accept: "text/csv" }, signal: ctl ? ctl.signal : undefined });
      if (!res || !res.ok) throw new Error(`the list of ${file} contracts answered HTTP ${res ? res.status : "nothing"}`);
      const parsed = X.parseList(await res.text());
      if (!parsed) throw new Error(`the list of ${file} contracts was not in the expected form`);
      return parsed;
    } finally {
      if (t) clearTimeout(t);
    }
  }

  /** Read both lists now, work the calendar out again and keep what changed. One read at a time. @returns { ok, changed, error } */
  refresh({ trigger = "itself" } = {}) {
    if (this._busy) return this._busy;
    if (!this.fetch) return Promise.resolve({ ok: false, skipped: "no network here", changed: 0 });
    this._busy = this._refresh(trigger).finally(() => {
      this._busy = null;
    });
    return this._busy;
  }

  async _refresh(trigger) {
    const r = this._load();
    const now = this.now();
    r.triedAt = iso(now);
    const failed = [];
    let got = 0;
    for (const ex of X.EXCHANGES) {
      try {
        r.lists[ex] = await this._download(X.DEFAULTS[ex].file);
        got += 1;
      } catch (err) {
        failed.push(`${ex}: ${err && err.name === "AbortError" ? "the read timed out" : err.message || err}`);
      }
    }
    r.error = failed.join("; ");
    if (got) r.fetchedAt = iso(now);
    const changed = this._recalc();
    this._save();
    if (failed.length) this.log.error(`[expiry] ${failed.join("; ")} (the last good list is kept)`);
    else this.log.log(`[expiry] the exchanges' contract lists were read (${trigger}); ${changed ? `${changed} expiry date${changed === 1 ? "" : "s"} changed` : "no date changed"}`);
    return { ok: !failed.length, changed, error: r.error };
  }

  /** The whole calendar again, compared with the one before. Remembers each week's listed date. @returns how many changed */
  _recalc() {
    const r = this._load();
    const today = istDate(this.now());
    const h = X.horizon(today);
    const after = {};
    const found = [];
    for (const ex of X.EXCHANGES) {
      const seen = r.seen[ex] || (r.seen[ex] = {});
      const b = X.build({ exchange: ex, parsed: r.lists[ex] || null, today, from: h.from, until: h.until, cal: this.cal, seen });
      for (const row of b.rows) {
        after[`${ex}|${row.nominal}`] = row.date;
        if (row.status === "listed") seen[row.nominal] = row.date; // so a week keeps its real date after its contract has expired
      }
      // the weekday itself: read from the list, so a change of rule shows as one
      if (b.fromList) {
        if (r.weekday[ex] !== undefined && r.weekday[ex] !== b.dow) found.push({ at: iso(this.now()), exchange: ex, kind: "weekday", was: X.DOW[r.weekday[ex]], now: X.DOW[b.dow], text: `${ex} expiries moved from ${X.DOW[r.weekday[ex]]} to ${X.DOW[b.dow]}: every date below follows the exchange's new day.` });
        r.weekday[ex] = b.dow;
      }
      for (const key of Object.keys(seen)) if (key < `${Number(today.slice(0, 4)) - 1}-01-01`) delete seen[key];
    }
    for (const c of X.changes(r.dates, after, today)) found.push({ at: iso(this.now()), exchange: c.exchange, kind: "date", nominal: c.nominal, was: c.was, now: c.now, text: `${c.exchange}: the expiry of the week of ${c.nominal} is now ${c.now} (it was ${c.was}).` });
    r.dates = after;
    if (found.length) {
      r.changes = [...found, ...r.changes].slice(0, KEEP_CHANGES);
      for (const c of found) this.log.log(`[expiry] CHANGED — ${c.text}`);
    }
    return found.length;
  }

  /* --------------------------------------------------------------------------- the calendar, for the page */
  view() {
    const today = istDate(this.now());
    if (this._view && this._view.today === today && this._view.rev === this._rev) return this._view.v;
    const r = this._load();
    const h = X.horizon(today);
    const exchanges = X.EXCHANGES.map((ex) => {
      const b = X.build({ exchange: ex, parsed: r.lists[ex] || null, today, from: h.from, until: h.until, cal: this.cal, seen: r.seen[ex] || {} });
      const rows = b.rows.map((row) => ({ ...row, daysLeft: daysBetween(today, row.date) }));
      const next = rows.find((x) => !x.past) || null;
      const nextMonthly = rows.find((x) => !x.past && x.kind === "monthly") || null;
      return { id: ex, main: b.main, weekday: b.weekday, fromList: b.fromList, listedTo: b.listedTo, next, nextMonthly, rows };
    });
    const ahead = h.nextYear ? [] : X.EXCHANGES.flatMap((ex) => X.beyond(r.lists[ex] || null, ex, h.until));
    const year = Number(h.until.slice(0, 4));
    const v = {
      today,
      from: h.from,
      until: h.until,
      nextYear: h.nextYear,
      source: {
        name: "The exchanges' own contract lists (NSE derivatives and BSE derivatives), as published in Zerodha's public instrument file",
        url: `${this.base}/NFO`,
        on: Boolean(this.fetch),
        checkedAt: r.fetchedAt,
        triedAt: r.triedAt,
        error: r.error,
        busy: Boolean(this._busy),
      },
      exchanges,
      ahead,
      changes: r.changes.slice(0, 12),
      holidaysKnown: this.cal.known(`${year}-06-15`),
      note: h.nextYear ? `It is the last week of December: the calendar now runs to the end of ${year}.` : `Next year's expiries are added by themselves on 24 December.`,
      rule: "A date marked LISTED is read from the exchange's own contract list: it is the exchange's date, with every holiday already taken into account. A date marked SCHEDULED is beyond what the exchange has listed so far (weekly contracts appear about five weeks ahead, monthly ones three months ahead); it is worked out from the weekday the listed contracts fall on — the last such weekday of the month for the monthly — moved back to the previous trading day when that day is a market holiday. It becomes LISTED by itself when the exchange lists the contract, and if the exchange's date differs, the row and the list of changes say so.",
    };
    this._view = { today, rev: this._rev, v };
    return v;
  }

  /** For the automation page: is a read due, and when was the last one? */
  status() {
    const r = this._load();
    const now = this.now();
    const age = r.fetchedAt ? now - Date.parse(r.fetchedAt) : Infinity;
    return { on: Boolean(this.fetch), checkedAt: r.fetchedAt, error: r.error, due: Boolean(this.fetch) && this._due(now), ageHours: Number.isFinite(age) ? Math.round(age / 360000) / 10 : null, changes: r.changes.length };
  }
  _due(now) {
    const r = this._load();
    const tried = r.triedAt ? now - Date.parse(r.triedAt) : Infinity;
    if (tried < RETRY_MS) return false;
    if (!r.fetchedAt) return true;
    if (now - Date.parse(r.fetchedAt) >= FRESH_MS) return true;
    // the morning's list (new weekly contracts are added, the expired ones are gone): one read after 8:00 AM every day,
    // however recently the night's read was
    const morning = Date.parse(`${istDate(now)}T00:00:00Z`) - IST + MORNING * 60000;
    return now >= morning && Date.parse(r.fetchedAt) < morning;
  }

  /* --------------------------------------------------------------------------- timers */
  async tickOnce() {
    const now = this.now();
    if (this.fetch && this._due(now)) return this.refresh({ trigger: "itself" });
    // with no read due, a new day still moves "today": yesterday's expiry becomes a passed one
    const today = istDate(now);
    if (this._day !== today) {
      this._day = today;
      this._rev += 1;
      this._view = null;
    }
    return null;
  }
  start() {
    if (this.timer) return;
    const run = () => this.tickOnce().catch((err) => this.log.error(`[expiry] ${err.message}`));
    this.first = setTimeout(run, 20000);
    if (this.first.unref) this.first.unref();
    this.timer = setInterval(run, 10 * 60000);
    if (this.timer.unref) this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    this.timer = null;
  }
}

module.exports = { ExpiryCalendar, NAME, BASE };
