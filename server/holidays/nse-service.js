"use strict";
// Keeps the NSE trading calendar in step with NSE's own publication (23 Nov 2026).
//
//   fetch NSE's holiday list  →  parse strictly (holidays/nse.js)  →  compare with the copy on disk  →  replace it only
//   if the new one is good  →  hand it to the server's trading-day rules (market/nse-holidays.js setOfficial).
//
// So every part of the site that asks "is the market open on this day?" — the /me next-session strip, the Calendar
// page, the desk, the forecasters, the learners — reads ONE calendar, and that calendar is NSE's own list.
//
// A failed or nonsensical fetch NEVER overwrites good data: the last good copy stays (on disk, so it survives a restart)
// and the failure is recorded so the pages can say so. With no copy at all, the rules fall back to the built-in table.
// The first check runs at start-up and then every six hours; a change at NSE is logged and noticed by itself.
//
// NSE's edge answers ordinary browsers only (a request that names itself as a bot is left hanging), so the request
// looks like a browser's. It asks for one public URL, at most once a minute and normally four times a day.

const fs = require("fs");
const path = require("path");
const { parseNseHolidayMaster } = require("./nse");
const calendarModule = require("../market/nse-holidays");

const NSE_API_URL = "https://www.nseindia.com/api/holiday-master?type=trading";
const NSE_PAGE_URL = "https://www.nseindia.com/resources/exchange-communication-holidays";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_GAP_MS = 60 * 1000;

const empty = () => ({
  sourceName: "NSE",
  sourceUrl: NSE_PAGE_URL,
  apiUrl: NSE_API_URL,
  segment: "CM",
  years: {}, // "2026" -> { entries, fetchedAt, changedAt }
  derivatives: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: "",
  changes: [], // newest first: { at, year, text }
});

class NseHolidayService {
  constructor({ dir, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, calendar = calendarModule, onChange = null } = {}) {
    this.file = path.join(dir, "nse-holidays.json");
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.calendar = calendar;
    this.onChange = onChange;
    this.state = this._load();
    this._inflight = null;
    this._timer = null;
    this._apply();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const base = empty();
      return { ...base, ...raw, sourceUrl: NSE_PAGE_URL, apiUrl: NSE_API_URL, years: { ...(raw.years || {}) }, changes: Array.isArray(raw.changes) ? raw.changes.slice(0, 20) : [] };
    } catch (_) {
      return empty();
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log.warn(`[holidays] could not save NSE's list: ${err.message}`);
    }
  }

  /** Hand the stored official list to the trading-day rules. */
  _apply() {
    if (!this.calendar || typeof this.calendar.setOfficial !== "function") return;
    const years = {};
    for (const [y, v] of Object.entries(this.state.years || {})) if (v && Array.isArray(v.entries)) years[y] = v.entries;
    this.calendar.setOfficial(years);
  }

  /**
   * NSE's list against the built-in table, year by year: does the table say the same? (It is the fallback; a difference
   * means NSE changed its list after the table was written — NSE's list is the one in force.)
   */
  verify() {
    const out = [];
    for (const [y, v] of Object.entries(this.state.years || {}).sort()) {
      const table = this.calendar && typeof this.calendar.localClosed === "function" ? this.calendar.localClosed(Number(y)) : {};
      const nse = new Set((v.entries || []).map((e) => e.date));
      const local = new Set(Object.keys(table));
      const onlyNse = [...nse].filter((d) => !local.has(d)).sort();
      const onlyTable = [...local].filter((d) => !nse.has(d)).sort();
      out.push({
        year: Number(y),
        holidays: nse.size,
        status: !local.size ? "nse-only" : onlyNse.length || onlyTable.length ? "differs" : "match",
        onlyNse: onlyNse.map((d) => ({ date: d, name: (v.entries.find((e) => e.date === d) || {}).name || "" })),
        onlyTable: onlyTable.map((d) => ({ date: d, name: table[d] })),
      });
    }
    return out;
  }

  /** What the API returns. */
  snapshot() {
    const s = this.state;
    return {
      sourceName: s.sourceName,
      sourceUrl: s.sourceUrl,
      apiUrl: s.apiUrl,
      segment: s.segment,
      years: s.years,
      derivatives: s.derivatives,
      lastAttemptAt: s.lastAttemptAt,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      changes: s.changes.slice(0, 10),
      verify: this.verify(),
    };
  }

  /** Cheap, changes when anything a page shows does (the live channel compares it). */
  fingerprint() {
    const s = this.state;
    return [s.lastSuccessAt ? Object.entries(s.years).map(([y, v]) => `${y}:${v.changedAt}`).join(",") : "", s.lastError, s.lastSuccessAt ? "ok" : "none"];
  }

  async _download() {
    const res = await this.fetch(NSE_API_URL, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-IN,en;q=0.9", Referer: NSE_PAGE_URL },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`NSE answered HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("NSE's answer is unexpectedly large");
    return text;
  }

  /** Check NSE now. Concurrent calls share one request; calls closer than a minute to the last one use the copy. */
  refresh({ force = false } = {}) {
    if (this._inflight) return this._inflight;
    const last = this.state.lastAttemptAt ? Date.parse(this.state.lastAttemptAt) : 0;
    if (!force && this.now() - last < MIN_GAP_MS) return Promise.resolve({ ...this.snapshot(), throttled: true });
    this._inflight = this._run().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  async _run() {
    const s = this.state;
    const stamp = new Date(this.now()).toISOString();
    s.lastAttemptAt = stamp;
    let changed = false;
    try {
      const { years, derivatives } = parseNseHolidayMaster(await this._download());
      for (const [y, entries] of Object.entries(years)) {
        const prev = s.years[y];
        const same = prev && JSON.stringify(prev.entries) === JSON.stringify(entries);
        s.years[y] = { entries, fetchedAt: stamp, changedAt: same ? prev.changedAt : stamp };
        if (!same) {
          changed = true;
          const text = prev ? `NSE changed its ${y} list: ${describe(prev.entries, entries)}` : `NSE's ${y} list stored (${entries.length} holidays)`;
          s.changes.unshift({ at: stamp, year: Number(y), text });
          if (s.changes.length > 20) s.changes.length = 20;
          this.log.log(`[holidays] ${text}`);
        }
      }
      s.derivatives = derivatives;
      s.lastSuccessAt = stamp;
      s.lastError = "";
      this._apply();
    } catch (err) {
      s.lastError = String((err && err.message) || err).slice(0, 200);
      this.log.warn(`[holidays] could not refresh from NSE: ${s.lastError} (keeping the last good copy)`);
    }
    this._save();
    if (changed && typeof this.onChange === "function") {
      try {
        this.onChange(this.snapshot());
      } catch (_) {
        /* a listener's trouble is not the calendar's */
      }
    }
    return this.snapshot();
  }

  /** Check now, then every `everyMs`. The timer never keeps the process alive. */
  start(everyMs = 6 * 60 * 60 * 1000) {
    this.refresh({ force: true }).catch(() => {});
    this._timer = setInterval(() => this.refresh({ force: true }).catch(() => {}), everyMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

/** "added 2026-12-31 X; removed 2026-07-03 Y; renamed 2026-11-10" — for the log line and the change list. */
function describe(before, after) {
  const a = new Map(before.map((e) => [e.date, e]));
  const b = new Map(after.map((e) => [e.date, e]));
  const added = after.filter((e) => !a.has(e.date)).map((e) => `${e.date} ${e.name}`);
  const removed = before.filter((e) => !b.has(e.date)).map((e) => `${e.date} ${e.name}`);
  const renamed = after.filter((e) => a.has(e.date) && (a.get(e.date).name !== e.name || a.get(e.date).kind !== e.kind)).map((e) => `${e.date} now "${e.name}"`);
  return [added.length && `added ${added.join(", ")}`, removed.length && `removed ${removed.join(", ")}`, renamed.length && `renamed ${renamed.join(", ")}`].filter(Boolean).join("; ") || "details changed";
}

module.exports = { NseHolidayService, NSE_API_URL, NSE_PAGE_URL };
