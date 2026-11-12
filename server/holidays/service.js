"use strict";
// Keeps the exchange holiday data in step with the exchange's own publication.
//
//   fetch the official page  →  parse strictly  →  validate  →  compare with the
//   copy on disk  →  replace it only if the new one is good.
//
// A failed or nonsensical fetch NEVER overwrites good data: the last good copy
// stays, and the failure is recorded so the page can say so. The first refresh
// runs at start-up and then every few hours, so a change at the source shows up
// here without anyone touching anything.

const fs = require("fs");
const path = require("path");
const { parseNasdaqTrader } = require("./nasdaq");

const NASDAQ_URL = "https://www.nasdaqtrader.com/trader.aspx?id=Calendar";
const USER_AGENT = "vinaytiwari.org-holiday-sync/1.0 (+https://vinaytiwari.org)";
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_GAP_MS = 60 * 1000; // a "check now" spree must not hammer the exchange

const empty = () => ({
  nasdaq: {
    sourceName: "Nasdaq Trader",
    sourceUrl: NASDAQ_URL,
    years: {}, // "2026" -> { entries, fetchedAt, changedAt }
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: "",
  },
});

class HolidayService {
  constructor({ dir, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console } = {}) {
    this.file = path.join(dir, "holidays.json");
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.state = this._load();
    this._inflight = null;
    this._timer = null;
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const base = empty();
      return { nasdaq: { ...base.nasdaq, ...(raw.nasdaq || {}), years: { ...((raw.nasdaq || {}).years || {}) } } };
    } catch (_) {
      return empty();
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** What the API returns: official copies and when they were last checked. */
  snapshot() {
    const n = this.state.nasdaq;
    return {
      nasdaq: {
        sourceName: n.sourceName,
        sourceUrl: n.sourceUrl,
        years: n.years,
        lastAttemptAt: n.lastAttemptAt,
        lastSuccessAt: n.lastSuccessAt,
        lastError: n.lastError,
      },
    };
  }

  async _download(url) {
    const res = await this.fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`the source answered HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("the source page is unexpectedly large");
    return text;
  }

  /**
   * Check the official source now. Concurrent calls share one fetch; calls closer
   * than a minute to the last attempt are answered from the stored copy.
   */
  refresh({ force = false } = {}) {
    if (this._inflight) return this._inflight;
    const last = this.state.nasdaq.lastAttemptAt ? Date.parse(this.state.nasdaq.lastAttemptAt) : 0;
    if (!force && this.now() - last < MIN_GAP_MS) {
      return Promise.resolve({ ...this.snapshot(), throttled: true });
    }
    this._inflight = this._run().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  async _run() {
    const s = this.state.nasdaq;
    const stamp = new Date(this.now()).toISOString();
    s.lastAttemptAt = stamp;
    try {
      const { year, entries } = parseNasdaqTrader(await this._download(NASDAQ_URL));
      const prev = s.years[year];
      const same = prev && JSON.stringify(prev.entries) === JSON.stringify(entries);
      s.years[year] = {
        entries,
        fetchedAt: stamp,
        changedAt: same ? prev.changedAt : stamp,
      };
      s.lastSuccessAt = stamp;
      s.lastError = "";
      if (!same) this.log.log(`[holidays] Nasdaq Trader ${year}: ${prev ? "CHANGED at the source — " + describe(prev.entries, entries) : "first copy stored"}`);
    } catch (err) {
      s.lastError = String(err.message || err).slice(0, 200);
      this.log.warn(`[holidays] could not refresh from Nasdaq Trader: ${s.lastError} (keeping the last good copy)`);
    }
    this._save();
    return this.snapshot();
  }

  /** Refresh now, then every `everyMs`. The timer never keeps the process alive. */
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

/** "added 2026-12-31; removed 2026-07-03" — for the log line. */
function describe(before, after) {
  const key = (e) => `${e.date} ${e.name} ${e.kind}`;
  const a = new Set(before.map(key));
  const b = new Set(after.map(key));
  const added = after.filter((e) => !a.has(key(e))).map((e) => `${e.date} ${e.name}`);
  const removed = before.filter((e) => !b.has(key(e))).map((e) => `${e.date} ${e.name}`);
  return [added.length && `added ${added.join(", ")}`, removed.length && `removed ${removed.join(", ")}`].filter(Boolean).join("; ") || "details changed";
}

module.exports = { HolidayService, NASDAQ_URL };
