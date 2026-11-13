"use strict";
// The stocks the screener covers: the Nifty 100 — the 100 largest companies listed on NSE,
// as NSE itself publishes them. The list changes twice a year (March and September), so it is
// read again from NSE's own published file once a week; if that cannot be reached the last
// copy is kept, and before the first successful read a copy taken on 13 Nov 2026 is used.
//
// Source: https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv — a public
// download file NSE publishes for exactly this. It is asked for at most once a week, with an
// honest User-Agent naming this site; nothing pretends to be a browser.

const fs = require("fs");
const path = require("path");

const URL_N100 = "https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv";
const AGENT = "vinaytiwari.org personal terminal (non-commercial; weekly index-list check)";
const WEEK = 7 * 86400000;
const RETRY = 6 * 3600000;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._-]{0,24}$/;

/** As published by NSE on 13 Nov 2026. */
const SNAPSHOT = { asOf: "2026-11-13", symbols: ["ABB", "ADANIENSOL", "ADANIENT", "ADANIGREEN", "ADANIPORTS", "ADANIPOWER", "AMBUJACEM", "APOLLOHOSP", "ASIANPAINT", "DMART", "AXISBANK", "BSE", "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BAJAJHLDNG", "BANKBARODA", "BEL", "BPCL", "BHARTIARTL", "BOSCHLTD", "BRITANNIA", "CGPOWER", "CANBK", "CHOLAFIN", "CIPLA", "COALINDIA", "CUMMINSIND", "DLF", "DIVISLAB", "DRREDDY", "EICHERMOT", "ETERNAL", "GAIL", "GODREJCP", "GRASIM", "HCLTECH", "HDFCAMC", "HDFCBANK", "HDFCLIFE", "HINDALCO", "HAL", "HINDUNILVR", "HINDZINC", "POWERINDIA", "HYUNDAI", "ICICIBANK", "ITC", "IOC", "IRFC", "INFY", "INDIGO", "JSWSTEEL", "JINDALSTEL", "JIOFIN", "KOTAKBANK", "LTM", "LT", "M&M", "MARUTI", "MAXHEALTH", "MAZDOCK", "MUTHOOTFIN", "NTPC", "NESTLEIND", "ONGC", "PIDILITIND", "POLYCAB", "PFC", "POWERGRID", "PNB", "RELIANCE", "SBILIFE", "MOTHERSON", "SHRIRAMFIN", "ENRIN", "SIEMENS", "SOLARINDS", "SBIN", "SUNPHARMA", "TVSMOTOR", "TATACAP", "TCS", "TATACONSUM", "TMCV", "TMPV", "TATAPOWER", "TATASTEEL", "TECHM", "TITAN", "TORNTPHARM", "TRENT", "ULTRACEMCO", "UNIONBANK", "VBL", "VAML", "VEDL", "IDEA", "WIPRO", "ZYDUSLIFE"] };

/** The symbols column of NSE's index CSV. Throws when the file does not look like one. */
function parseIndexCsv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) throw new Error("empty file");
  const head = lines[0].split(",").map((x) => x.trim().toLowerCase());
  const col = head.indexOf("symbol");
  const ser = head.indexOf("series");
  if (col < 0) throw new Error("no Symbol column");
  const out = [];
  for (const l of lines.slice(1)) {
    const cells = l.split(",");
    const s = String(cells[col] || "").trim().toUpperCase();
    if (ser >= 0 && String(cells[ser] || "").trim().toUpperCase() !== "EQ") continue;
    if (SYMBOL_RE.test(s)) out.push(s);
  }
  // a sanity check: the Nifty 100 has about 100 names; anything far off is not that list
  if (out.length < 90 || out.length > 110) throw new Error(`${out.length} symbols: not the Nifty 100`);
  return [...new Set(out)];
}

class IndexList {
  constructor({ dir, fetchImpl = null, now = () => Date.now(), log = console }) {
    this.file = path.join(dir, "nifty100.json");
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this._busy = null;
    this._triedAt = 0;
  }

  _read() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (d && Array.isArray(d.symbols) && d.symbols.length >= 90) return d;
    } catch (_) {
      /* not yet read from NSE */
    }
    return null;
  }

  /** The current list as a Set. Starts a weekly re-read in the background when one is due. */
  symbols() {
    const d = this._read();
    const age = d ? this.now() - Date.parse(d.fetchedAt) : Infinity;
    if (age > WEEK) this.refresh().catch(() => {});
    return new Set(d ? d.symbols : SNAPSHOT.symbols);
  }

  status() {
    const d = this._read();
    return d ? { index: "NIFTY 100", count: d.symbols.length, source: "NSE", fetchedAt: d.fetchedAt } : { index: "NIFTY 100", count: SNAPSHOT.symbols.length, source: "snapshot", fetchedAt: null, asOf: SNAPSHOT.asOf };
  }

  /** Read the list from NSE now (at most one attempt every six hours). */
  refresh() {
    if (!this.fetch) return Promise.resolve(this.status());
    if (this._busy) return this._busy;
    if (this.now() - this._triedAt < RETRY) return Promise.resolve(this.status());
    this._triedAt = this.now();
    this._busy = (async () => {
      try {
        const res = await this.fetch(URL_N100, { headers: { "User-Agent": AGENT, Accept: "text/csv" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`NSE answered ${res.status}`);
        const symbols = parseIndexCsv(await res.text());
        const tmp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: new Date(this.now()).toISOString(), source: URL_N100, symbols }));
        fs.renameSync(tmp, this.file);
      } catch (err) {
        this.log.log(`[market] the Nifty 100 list could not be read from NSE (${err.message}); keeping the last copy`);
      }
      return this.status();
    })().finally(() => {
      this._busy = null;
    });
    return this._busy;
  }
}

module.exports = { IndexList, parseIndexCsv, SNAPSHOT, URL_N100 };
