"use strict";
// Delivery: how much of each day's traded quantity was actually taken (or given) for delivery — the one daily reading the
// broker's feed does not carry.
//
//   THE SOURCE   NSE's own daily file "sec_bhavdata_full_DDMMYYYY.csv" (nsearchives.nseindia.com/products/content/),
//                public, no login, no API key: every security's close, traded quantity and DELIVERABLE quantity with the
//                delivery percentage. Published in the evening, after the session.
//   KEPT         the last 20 sessions, one small file per day under data/market/delivery/ (a cache that can be read
//                again; never a record, never in a backup), equity series only.
//   READ         for one stock: the sessions one by one, the 20-day average delivery and volume, how the last session
//                compares, and what the pair price-move × delivery usually means (accumulation, distribution,
//                speculative churn) — a reading with its rule, not a promise.
//   LISTENING    once a while after the server starts, then every two hours; it reads only a day it does not have, at
//                most six files a run and two seconds apart, so NSE is never hammered. A failed read changes nothing.
//
// It reads a public file and writes cache files. It cannot reach an account, an order or an AI model.

const fs = require("node:fs");
const path = require("node:path");

const IST = 5.5 * 3600 * 1000;
const BASE = "https://nsearchives.nseindia.com/products/content";
const KEEP = 20; // sessions kept
const PER_RUN = 6; // files read at most per run
const GAP_MS = 2000;
const EVERY_MS = 2 * 3600000;
const FIRST_MS = 3 * 60000;
const TIMEOUT_MS = 30000;
const SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekdayOf = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "19-Nov-2026" → "2026-11-19" (or null). */
function isoOf(d) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(d || "").trim());
  if (!m || !MONTHS[m[2].toUpperCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toUpperCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * The file's text → { date, rows: { SYMBOL: [prevClose, close, volume, delivQty, delivPct, turnoverLacs, trades] } }.
 * Only the equity series; a row whose delivery is "-" keeps null there. Throws when the text is not that file.
 */
function parse(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/);
  const head = (lines[0] || "").split(",").map((s) => s.trim().toUpperCase());
  const ix = (n) => head.indexOf(n);
  const need = ["SYMBOL", "SERIES", "DATE1", "PREV_CLOSE", "CLOSE_PRICE", "TTL_TRD_QNTY", "DELIV_QTY", "DELIV_PER"];
  if (need.some((n) => ix(n) < 0)) throw new Error("That is not NSE's delivery file (its columns are missing).");
  const c = Object.fromEntries([...need, "TURNOVER_LACS", "NO_OF_TRADES"].map((n) => [n, ix(n)]));
  const rows = {};
  let date = null;
  const f = (cells, n) => {
    if (c[n] < 0) return null;
    const v = Number(String(cells[c[n]] || "").trim());
    return Number.isFinite(v) ? v : null;
  };
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",");
    if (cells.length < head.length - 1) continue;
    const series = String(cells[c.SERIES] || "").trim().toUpperCase();
    if (!SERIES.has(series)) continue;
    const sym = String(cells[c.SYMBOL] || "").trim().toUpperCase();
    if (!sym) continue;
    if (!date) date = isoOf(cells[c.DATE1]);
    // EQ wins over the other series of the same name
    if (rows[sym] && series !== "EQ") continue;
    rows[sym] = [f(cells, "PREV_CLOSE"), f(cells, "CLOSE_PRICE"), f(cells, "TTL_TRD_QNTY"), f(cells, "DELIV_QTY"), f(cells, "DELIV_PER"), f(cells, "TURNOVER_LACS"), f(cells, "NO_OF_TRADES")];
  }
  if (!date || !Object.keys(rows).length) throw new Error("NSE's delivery file had no equity rows.");
  return { date, rows };
}

/** What a session's price move and delivery say together (the usual reading; with the rule it rests on). */
function readingOf({ changePct, delivPct, avgDelivPct, volume, avgVolume }) {
  if (!num(changePct) || !num(delivPct)) return null;
  const highDel = num(avgDelivPct) && avgDelivPct > 0 ? delivPct >= avgDelivPct * 1.2 : delivPct >= 55;
  const lowDel = num(avgDelivPct) && avgDelivPct > 0 ? delivPct <= avgDelivPct * 0.8 : delivPct <= 30;
  const heavy = num(volume) && num(avgVolume) && avgVolume > 0 ? volume >= avgVolume * 1.5 : false;
  const up = changePct >= 0.5;
  const down = changePct <= -0.5;
  if (up && highDel) return { tone: "up", word: "accumulation", text: `It rose ${r2(changePct)}% with delivery at ${r2(delivPct)}%, above its usual${num(avgDelivPct) ? ` ${r2(avgDelivPct)}%` : ""}${heavy ? " on heavy volume" : ""}: buyers took the shares home — the usual mark of genuine buying.` };
  if (down && highDel) return { tone: "down", word: "distribution", text: `It fell ${r2(-changePct)}% with delivery at ${r2(delivPct)}%, above its usual${num(avgDelivPct) ? ` ${r2(avgDelivPct)}%` : ""}${heavy ? " on heavy volume" : ""}: holders delivered real stock into the fall — the usual mark of genuine selling.` };
  if (up && lowDel) return { tone: "warn", word: "speculative rise", text: `It rose ${r2(changePct)}%, but delivery was only ${r2(delivPct)}% (usual${num(avgDelivPct) ? ` ${r2(avgDelivPct)}%` : " higher"}): mostly intraday churn — such rises fade more easily.` };
  if (down && lowDel) return { tone: "warn", word: "speculative fall", text: `It fell ${r2(-changePct)}%, with delivery only ${r2(delivPct)}%: mostly intraday selling and short covering to come — such falls often find buyers sooner.` };
  if (highDel) return { tone: "none", word: "quiet accumulation", text: `Little price change, but delivery ${r2(delivPct)}% is above its usual: positions are being built or moved without the price showing it yet.` };
  return { tone: "none", word: "ordinary", text: `A ${up ? "rise" : down ? "fall" : "flat day"} with ordinary delivery (${r2(delivPct)}%).` };
}

class DeliveryStore {
  /**
   * @param dir          the data folder (files go to dir/market/delivery/)
   * @param fetchImpl    fetch, or null where the network must not be touched
   * @param isTradingDay (YYYY-MM-DD) → boolean; weekdays when not given
   */
  constructor({ dir, fetchImpl = null, now = () => Date.now(), log = console, isTradingDay = weekdayOf, base = BASE, gapMs = GAP_MS }) {
    this.dir = path.join(dir, "market", "delivery");
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.isTradingDay = isTradingDay;
    this.base = base;
    this.gapMs = gapMs;
    this._days = new Map(); // date → rows (read from disk on first use)
    this._busy = null;
    this.lastError = "";
    this.checkedAt = null;
    this.timer = null;
    this.first = null;
  }

  _file(date) {
    return path.join(this.dir, `${date}.json`);
  }

  /** The sessions that should be in the file set: the last KEEP trading days that are over (today's after 7:30 PM IST). */
  wanted(now = this.now()) {
    const out = [];
    let t = now;
    // NSE publishes the day's file in the evening: before 7:30 PM today's is not expected yet
    if (minuteOfDay(t) < 19 * 60 + 30) t -= 86400000;
    for (let i = 0; i < 45 && out.length < KEEP; i += 1, t -= 86400000) {
      const d = istDate(t);
      if (this.isTradingDay(d)) out.push(d);
    }
    return out;
  }

  /** The dates kept on disk, newest first. */
  have() {
    try {
      return fs
        .readdirSync(this.dir)
        .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f))
        .filter(Boolean)
        .map((m) => m[1])
        .sort()
        .reverse();
    } catch (_) {
      return [];
    }
  }

  _rows(date) {
    if (this._days.has(date)) return this._days.get(date);
    let rows = null;
    try {
      rows = JSON.parse(fs.readFileSync(this._file(date), "utf8")).rows || null;
    } catch (_) {
      rows = null;
    }
    this._days.set(date, rows);
    if (this._days.size > KEEP + 5) this._days.delete(this._days.keys().next().value);
    return rows;
  }

  /** Put one day's parsed file in place (and drop the days beyond the newest KEEP). */
  put(day) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this._file(day.date)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ date: day.date, rows: day.rows }));
    fs.renameSync(tmp, this._file(day.date));
    this._days.set(day.date, day.rows);
    for (const old of this.have().slice(KEEP)) {
      try {
        fs.unlinkSync(this._file(old));
      } catch (_) {
        /* gone already */
      }
      this._days.delete(old);
    }
  }

  /** Read the days that are missing (at most PER_RUN). @returns how many were read */
  async refresh({ trigger = "itself" } = {}) {
    if (!this.fetch) return 0;
    if (this._busy) return this._busy;
    this._busy = (async () => {
      const have = new Set(this.have());
      const missing = this.wanted().filter((d) => !have.has(d)).slice(0, PER_RUN);
      let got = 0;
      for (const date of missing) {
        const [y, m, d] = date.split("-");
        const url = `${this.base}/sec_bhavdata_full_${d}${m}${y}.csv`;
        try {
          const ctl = typeof AbortController === "function" ? new AbortController() : null;
          const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
          let res;
          let text;
          try {
            res = await this.fetch(url, { method: "GET", headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, signal: ctl ? ctl.signal : undefined });
            // the body is read inside the same time limit (the timer used to be cleared before it, leaving the read unbounded)
            text = res.ok ? await res.text() : "";
          } finally {
            if (t) clearTimeout(t);
          }
          if (res.status === 404) continue; // a holiday the calendar did not know, or not published yet
          if (!res.ok) throw new Error(`NSE answered ${res.status}`);
          const day = parse(text);
          this.put(day);
          got += 1;
          this.lastError = "";
        } catch (err) {
          this.lastError = `${date}: ${err.message || err}`;
          break; // try again on the next run
        }
        if (this.gapMs) await sleep(this.gapMs);
      }
      this.checkedAt = new Date(this.now()).toISOString();
      if (got) this.log.log(`[delivery] NSE's delivery files read (${trigger}): ${got} day(s)`);
      return got;
    })().finally(() => {
      this._busy = null;
    });
    return this._busy;
  }

  /** One stock's delivery picture, or { available: false, reason }. */
  forSymbol(symbol, { days = 10 } = {}) {
    const sym = String(symbol || "").trim().toUpperCase();
    const dates = this.have().slice(0, KEEP);
    if (!dates.length) return { available: false, reason: "NSE's delivery files have not been read yet." };
    const rows = [];
    for (const date of dates) {
      const r = this._rows(date);
      const x = r && r[sym];
      if (!x) continue;
      const [prev, close, volume, delivQty, delivPct, turnoverLacs, trades] = x;
      rows.push({ date, close, changePct: num(prev) && prev > 0 && num(close) ? r2(((close - prev) / prev) * 100) : null, volume, delivQty, delivPct: r2(delivPct), turnoverCr: num(turnoverLacs) ? r2(turnoverLacs / 100) : null, trades });
    }
    if (!rows.length) return { available: false, reason: `${sym} is not in NSE's equity delivery files.` };
    const avg = (k) => {
      const v = rows.map((r) => r[k]).filter(num);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const avgDelivPct = r2(avg("delivPct"));
    const avgVolume = avg("volume");
    const last = rows[0];
    const recent = rows.slice(0, 5).map((r) => r.delivPct).filter(num);
    const older = rows.slice(5, 20).map((r) => r.delivPct).filter(num);
    const mean = (a) => (a.length ? a.reduce((s, b) => s + b, 0) / a.length : null);
    const trend = recent.length >= 3 && older.length >= 3 ? (mean(recent) >= mean(older) * 1.1 ? "rising" : mean(recent) <= mean(older) * 0.9 ? "falling" : "steady") : null;
    // the last five sessions: rising days' delivery against falling days'
    const up = rows.slice(0, 10).filter((r) => num(r.changePct) && r.changePct > 0 && num(r.delivQty));
    const dn = rows.slice(0, 10).filter((r) => num(r.changePct) && r.changePct < 0 && num(r.delivQty));
    const sum = (a) => a.reduce((s, r) => s + r.delivQty, 0);
    const balance = up.length && dn.length ? r2(sum(up) / (sum(up) + sum(dn))) : null;
    return {
      available: true,
      symbol: sym,
      asOf: last.date,
      last: { ...last, vsAvgDelivery: num(last.delivPct) && num(avgDelivPct) && avgDelivPct > 0 ? r2(last.delivPct / avgDelivPct) : null, vsAvgVolume: num(last.volume) && num(avgVolume) && avgVolume > 0 ? r2(last.volume / avgVolume) : null },
      avgDelivPct,
      avgVolume: num(avgVolume) ? Math.round(avgVolume) : null,
      trend,
      upDayShare: balance,
      reading: readingOf({ changePct: last.changePct, delivPct: last.delivPct, avgDelivPct, volume: last.volume, avgVolume }),
      sessions: rows.slice(0, days),
      note: "Delivery is published by NSE after the close: the newest session shown is the last one that is over, never today's.",
      rule: "High delivery with a rise is read as accumulation, with a fall as distribution; a big move on low delivery as speculative churn that fades more easily. The share of delivered quantity on up days (last 10 sessions) shows which side has been taking stock home.",
    };
  }

  /**
   * The trade setup's "high delivery trades": in the newest session, the stocks (of `symbols`, e.g. the F&O list) whose delivered
   * share of the volume was at least 1.3× their own average over the stored sessions — with a turnover above ₹5 crore, so a thin
   * day does not count. Strongest first.
   */
  highDelivery({ symbols = null, limit = 15, minRatio = 1.3, minTurnoverCr = 5 } = {}) {
    const dates = this.have().slice(0, KEEP);
    if (!dates.length) return null;
    const newest = this._rows(dates[0]);
    if (!newest) return null;
    const want = Array.isArray(symbols) && symbols.length ? new Set(symbols.map((s) => String(s).toUpperCase())) : null;
    const older = dates.slice(1).map((d) => this._rows(d)).filter(Boolean);
    const list = [];
    for (const [sym, x] of Object.entries(newest)) {
      if (want && !want.has(sym)) continue;
      const [prev, close, volume, , delivPct, turnoverLacs] = x;
      if (!num(delivPct) || !num(turnoverLacs) || turnoverLacs / 100 < minTurnoverCr) continue;
      const past = older.map((r) => r[sym] && r[sym][4]).filter(num);
      if (past.length < 5) continue;
      const avg = past.reduce((a, b) => a + b, 0) / past.length;
      if (!(avg > 0) || delivPct / avg < minRatio) continue;
      list.push({ symbol: sym, delivPct: r2(delivPct), avgDelivPct: r2(avg), vsAvg: r2(delivPct / avg), changePct: num(prev) && prev > 0 && num(close) ? r2(((close - prev) / prev) * 100) : null, close, volume, turnoverCr: r2(turnoverLacs / 100) });
    }
    list.sort((a, b) => b.vsAvg - a.vsAvg);
    return { asOf: dates[0], list: list.slice(0, limit), rule: `Delivered share of the session's volume at least ${minRatio}× the stock's average over the stored sessions, turnover above ₹${minTurnoverCr} crore.` };
  }

  status() {
    const have = this.have();
    return { days: have.length, newest: have[0] || null, oldest: have[have.length - 1] || null, checkedAt: this.checkedAt, error: this.lastError, running: Boolean(this._busy) };
  }

  start() {
    if (this.timer) return;
    const run = () => this.refresh().catch((err) => this.log.error(`[delivery] ${err.message}`));
    this.first = setTimeout(run, FIRST_MS);
    if (this.first.unref) this.first.unref();
    this.timer = setInterval(run, EVERY_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }
}

module.exports = { DeliveryStore, parse, readingOf, isoOf, KEEP };
