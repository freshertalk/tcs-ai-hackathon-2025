"use strict";
// Delivery: NSE's public daily file is read (only the days missing, a few a run), kept as small cache files, and turned
// into one stock's delivery picture with its reading.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DeliveryStore, parse, readingOf, isoOf } = require("../market/delivery");

const quiet = { log() {}, error() {} };
const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00Z`) - IST;
const HEAD = "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER";
const mon = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };
const fileFor = (date, rows) => {
  const [y, m, d] = date.split("-");
  const d1 = `${d}-${mon[m]}-${y}`;
  return [HEAD, ...rows.map((r) => `${r.sym}, ${r.series || "EQ"}, ${d1}, ${r.prev}, ${r.prev}, ${r.close}, ${r.prev}, ${r.close}, ${r.close}, ${r.close}, ${r.vol}, ${(r.vol * r.close) / 1e5}, 1000, ${r.dq}, ${r.dp}`)].join("\n");
};

test("the file is parsed: equity series only, EQ preferred, delivery as numbers, the date from the file", () => {
  const text = fileFor("2026-11-19", [
    { sym: "SBIN", prev: 800, close: 812, vol: 1000000, dq: 600000, dp: 60 },
    { sym: "SBIN", series: "BE", prev: 1, close: 1, vol: 1, dq: 1, dp: 1 },
    { sym: "XYZ", series: "N1", prev: 100, close: 101, vol: 10, dq: 5, dp: 50 },
  ]);
  const day = parse(text);
  assert.equal(day.date, "2026-11-19");
  assert.deepEqual(Object.keys(day.rows), ["SBIN"]);
  assert.deepEqual(day.rows.SBIN.slice(0, 5), [800, 812, 1000000, 600000, 60]);
  assert.equal(isoOf("5-Jan-2027"), "2027-01-05");
  assert.throws(() => parse("a,b,c\n1,2,3"), /not NSE's delivery file/);
});

test("what a session's move and delivery say together", () => {
  assert.equal(readingOf({ changePct: 2, delivPct: 70, avgDelivPct: 50, volume: 2e6, avgVolume: 1e6 }).word, "accumulation");
  assert.match(readingOf({ changePct: 2, delivPct: 70, avgDelivPct: 50, volume: 2e6, avgVolume: 1e6 }).text, /heavy volume/);
  assert.equal(readingOf({ changePct: -1.5, delivPct: 65, avgDelivPct: 50 }).word, "distribution");
  assert.equal(readingOf({ changePct: 3, delivPct: 20, avgDelivPct: 50 }).word, "speculative rise");
  assert.equal(readingOf({ changePct: -3, delivPct: 20, avgDelivPct: 50 }).word, "speculative fall");
  assert.equal(readingOf({ changePct: 0.1, delivPct: 70, avgDelivPct: 50 }).word, "quiet accumulation");
  assert.equal(readingOf({ changePct: null, delivPct: 50 }), null);
});

test("only the missing days are read (a few a run), kept as files, and read back as one stock's picture", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-deliv-"));
  const now = at("2026-11-21", "10:00"); // a Saturday: the newest session is Friday the 20th
  const asked = [];
  const days = ["2026-11-20", "2026-11-19", "2026-11-18", "2026-11-17", "2026-11-16", "2026-11-13", "2026-11-12"];
  const fetchImpl = async (url) => {
    asked.push(url);
    const m = /sec_bhavdata_full_(\d{2})(\d{2})(\d{4})\.csv$/.exec(url);
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    const i = days.indexOf(date);
    if (i < 0) return { ok: false, status: 404, text: async () => "" };
    // SBIN: rising on the newest day with delivery well above its usual
    const close = 800 + (days.length - i) * 2;
    const dp = i === 0 ? 72 : 48;
    return { ok: true, status: 200, text: async () => fileFor(date, [{ sym: "SBIN", prev: close - 2 - (i === 0 ? 10 : 0), close, vol: i === 0 ? 2000000 : 1000000, dq: Math.round(((i === 0 ? 2000000 : 1000000) * dp) / 100), dp }]) };
  };
  const st = new DeliveryStore({ dir, fetchImpl, now: () => now, log: quiet, gapMs: 0, isTradingDay: (d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) });
  assert.deepEqual(st.forSymbol("SBIN"), { available: false, reason: "NSE's delivery files have not been read yet." });
  assert.equal(st.wanted()[0], "2026-11-20");
  assert.equal(await st.refresh(), 6, "at most six files a run");
  assert.match(asked[0], /sec_bhavdata_full_20112026\.csv$/);
  assert.equal(st.have().length, 6);
  // the next run reads only what is still missing (one more real day; the rest are 404 — not published, a holiday)
  asked.length = 0;
  await st.refresh();
  assert.ok(asked.length >= 1 && !asked.some((u) => /20112026/.test(u)), "a day already kept is never read again");
  const d = st.forSymbol("sbin");
  assert.equal(d.available, true);
  assert.equal(d.asOf, "2026-11-20");
  assert.equal(d.last.delivPct, 72);
  assert.equal(d.reading.word, "accumulation");
  assert.ok(d.avgDelivPct > 48 && d.avgDelivPct < 72);
  assert.ok(d.last.vsAvgVolume > 1.5);
  assert.match(d.note, /never today's/);
  assert.equal(st.forSymbol("NOPE").available, false);
  assert.equal(st.status().newest, "2026-11-20");
});

test("with no network the store reads nothing and says so", async () => {
  const st = new DeliveryStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "vpt-deliv-")), fetchImpl: null, log: quiet });
  assert.equal(await st.refresh(), 0);
  assert.equal(st.status().days, 0);
});
