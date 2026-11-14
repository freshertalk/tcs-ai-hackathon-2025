"use strict";
// The NSE indices the screener can show, and which stocks are in each — as NSE itself publishes
// them. Index membership changes (most lists twice a year, some quarterly), so each list is read
// again from NSE's own published file once a week, only when it is used; if that cannot be reached
// the last copy is kept, and before the first successful read a copy taken on 14 Nov 2026 is used
// (index-snapshots.json).
//
// Source: https://nsearchives.nseindia.com/content/indices/ind_<name>list.csv — public download
// files NSE publishes for exactly this. Each is asked for at most once a week, with an honest
// User-Agent naming this site; nothing pretends to be a browser.
//
// The RSI search and the stored daily history cover the Nifty 500 (RSI_INDEX); the market board
// can show any index in the catalogue.

const fs = require("fs");
const path = require("path");
const SNAP = require("./index-snapshots.json");

const BASE = "https://nsearchives.nseindia.com/content/indices/";
const AGENT = "vinaytiwari.org personal terminal (non-commercial; weekly index-list check)";
const WEEK = 7 * 86400000;
const RETRY = 6 * 3600000;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._-]{0,24}$/;
const RSI_INDEX = "nifty500";

// kite: the index's own quote, by the names Zerodha may list it under (the first that answers is used)
const CATALOG = [
  { id: "nifty50", name: "NIFTY 50", group: "Indices eligible in derivatives", file: "ind_nifty50list.csv", kite: ["NIFTY 50"] },
  { id: "niftybank", name: "NIFTY BANK", group: "Indices eligible in derivatives", file: "ind_niftybanklist.csv", kite: ["NIFTY BANK"] },
  { id: "niftyfinance", name: "NIFTY FINANCIAL SERVICES", group: "Indices eligible in derivatives", file: "ind_niftyfinancelist.csv", kite: ["NIFTY FIN SERVICE", "NIFTY FINANCIAL SERVICES"] },
  { id: "niftymidcapselect", name: "NIFTY MIDCAP SELECT", group: "Indices eligible in derivatives", file: "ind_niftymidcapselect_list.csv", kite: ["NIFTY MID SELECT", "NIFTY MIDCAP SELECT"] },
  { id: "niftynext50", name: "NIFTY NEXT 50", group: "Indices eligible in derivatives", file: "ind_niftynext50list.csv", kite: ["NIFTY NEXT 50"] },
  { id: "nifty100", name: "NIFTY 100", group: "Broad market indices", file: "ind_nifty100list.csv", kite: ["NIFTY 100"] },
  { id: "nifty200", name: "NIFTY 200", group: "Broad market indices", file: "ind_nifty200list.csv", kite: ["NIFTY 200"] },
  { id: "nifty500", name: "NIFTY 500", group: "Broad market indices", file: "ind_nifty500list.csv", kite: ["NIFTY 500"] },
  { id: "niftymidcap100", name: "NIFTY MIDCAP 100", group: "Broad market indices", file: "ind_niftymidcap100list.csv", kite: ["NIFTY MIDCAP 100"] },
  { id: "niftymidcap150", name: "NIFTY MIDCAP 150", group: "Broad market indices", file: "ind_niftymidcap150list.csv", kite: ["NIFTY MIDCAP 150"] },
  { id: "niftysmallcap100", name: "NIFTY SMALLCAP 100", group: "Broad market indices", file: "ind_niftysmallcap100list.csv", kite: ["NIFTY SMLCAP 100", "NIFTY SMALLCAP 100"] },
  { id: "niftysmallcap250", name: "NIFTY SMALLCAP 250", group: "Broad market indices", file: "ind_niftysmallcap250list.csv", kite: ["NIFTY SMLCAP 250", "NIFTY SMALLCAP 250"] },
  { id: "niftyauto", name: "NIFTY AUTO", group: "Sectoral indices", file: "ind_niftyautolist.csv", kite: ["NIFTY AUTO"] },
  { id: "niftyconsumerdurables", name: "NIFTY CONSUMER DURABLES", group: "Sectoral indices", file: "ind_niftyconsumerdurableslist.csv", kite: ["NIFTY CONSR DURBL", "NIFTY CONSUMER DURABLES"] },
  { id: "niftyenergy", name: "NIFTY ENERGY", group: "Sectoral indices", file: "ind_niftyenergylist.csv", kite: ["NIFTY ENERGY"] },
  { id: "niftyfmcg", name: "NIFTY FMCG", group: "Sectoral indices", file: "ind_niftyfmcglist.csv", kite: ["NIFTY FMCG"] },
  { id: "niftyhealthcare", name: "NIFTY HEALTHCARE", group: "Sectoral indices", file: "ind_niftyhealthcarelist.csv", kite: ["NIFTY HEALTHCARE", "NIFTY HEALTHCARE INDEX"] },
  { id: "niftyit", name: "NIFTY IT", group: "Sectoral indices", file: "ind_niftyitlist.csv", kite: ["NIFTY IT"] },
  { id: "niftymedia", name: "NIFTY MEDIA", group: "Sectoral indices", file: "ind_niftymedialist.csv", kite: ["NIFTY MEDIA"] },
  { id: "niftymetal", name: "NIFTY METAL", group: "Sectoral indices", file: "ind_niftymetallist.csv", kite: ["NIFTY METAL"] },
  { id: "niftyoilgas", name: "NIFTY OIL & GAS", group: "Sectoral indices", file: "ind_niftyoilgaslist.csv", kite: ["NIFTY OIL AND GAS", "NIFTY OIL & GAS"] },
  { id: "niftypharma", name: "NIFTY PHARMA", group: "Sectoral indices", file: "ind_niftypharmalist.csv", kite: ["NIFTY PHARMA"] },
  { id: "niftyprivatebank", name: "NIFTY PRIVATE BANK", group: "Sectoral indices", file: "ind_nifty_privatebanklist.csv", kite: ["NIFTY PVT BANK", "NIFTY PRIVATE BANK"] },
  { id: "niftypsubank", name: "NIFTY PSU BANK", group: "Sectoral indices", file: "ind_niftypsubanklist.csv", kite: ["NIFTY PSU BANK"] },
  { id: "niftyrealty", name: "NIFTY REALTY", group: "Sectoral indices", file: "ind_niftyrealtylist.csv", kite: ["NIFTY REALTY"] },
];
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

/**
 * The symbols column of an NSE index CSV (EQ series only). Throws when the file does not look
 * like the list it should be: an empty page, an error page, or a count far from the last known.
 * @param expected  the size of the last known list, for the sanity check (optional)
 */
function parseIndexCsv(text, expected = null) {
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
  const list = [...new Set(out)];
  if (list.length < 5) throw new Error(`${list.length} symbols: not an index list`);
  if (expected && (list.length < expected * 0.8 || list.length > expected * 1.2 + 2)) throw new Error(`${list.length} symbols where about ${expected} were expected`);
  return list;
}

class IndexList {
  /** @param fetchImpl  null: never read from NSE (tests, simulators) — the copies are used */
  constructor({ dir, fetchImpl = null, now = () => Date.now(), log = console }) {
    this.dir = path.join(dir, "indices");
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this._busy = new Map();
    this._triedAt = new Map();
  }

  _file(id) {
    return path.join(this.dir, `${id}.json`);
  }

  _read(id) {
    try {
      const d = JSON.parse(fs.readFileSync(this._file(id), "utf8"));
      if (d && Array.isArray(d.symbols) && d.symbols.length >= 5) return d;
    } catch (_) {
      /* not yet read from NSE */
    }
    return null;
  }

  /** The indices on offer, grouped as NSE groups them. */
  catalog() {
    return CATALOG.map((c) => ({ id: c.id, name: c.name, group: c.group, count: this.list(c.id).length }));
  }

  has(id) {
    return BY_ID.has(id);
  }

  meta(id) {
    return BY_ID.get(id) || null;
  }

  /** One index's members (array). Starts a weekly re-read in the background when one is due. */
  list(id = RSI_INDEX) {
    if (!BY_ID.has(id)) return [];
    const d = this._read(id);
    const age = d ? this.now() - Date.parse(d.fetchedAt) : Infinity;
    if (age > WEEK) this.refresh(id).catch(() => {});
    return d ? d.symbols : SNAP.indices[id] || [];
  }

  /** The stocks the RSI search covers (the Nifty 500), as a Set. */
  symbols(id = RSI_INDEX) {
    return new Set(this.list(id));
  }

  /** Every stock in any index of the catalogue: what the daily-history download covers. */
  allSymbols() {
    const all = new Set();
    for (const c of CATALOG) for (const s of this.list(c.id)) all.add(s);
    return all;
  }

  status(id = RSI_INDEX) {
    const c = BY_ID.get(id);
    const d = this._read(id);
    return d ? { index: c.name, id, count: d.symbols.length, source: "NSE", fetchedAt: d.fetchedAt } : { index: c.name, id, count: (SNAP.indices[id] || []).length, source: "snapshot", fetchedAt: null, asOf: SNAP.asOf };
  }

  /** Read one list from NSE now (at most one attempt every six hours per list). */
  refresh(id = RSI_INDEX) {
    const c = BY_ID.get(id);
    if (!c || !this.fetch) return Promise.resolve(c ? this.status(id) : null);
    if (this._busy.has(id)) return this._busy.get(id);
    if (this.now() - (this._triedAt.get(id) || 0) < RETRY) return Promise.resolve(this.status(id));
    this._triedAt.set(id, this.now());
    const job = (async () => {
      try {
        const url = BASE + c.file;
        const res = await this.fetch(url, { headers: { "User-Agent": AGENT, Accept: "text/csv" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`NSE answered ${res.status}`);
        const known = (this._read(id) || { symbols: SNAP.indices[id] || [] }).symbols.length || null;
        const symbols = parseIndexCsv(await res.text(), known);
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = `${this._file(id)}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: new Date(this.now()).toISOString(), source: url, symbols }));
        fs.renameSync(tmp, this._file(id));
      } catch (err) {
        this.log.log(`[market] the ${c.name} list could not be read from NSE (${err.message}); keeping the last copy`);
      }
      return this.status(id);
    })().finally(() => this._busy.delete(id));
    this._busy.set(id, job);
    return job;
  }
}

module.exports = { IndexList, parseIndexCsv, CATALOG, RSI_INDEX, BASE, SNAP };
