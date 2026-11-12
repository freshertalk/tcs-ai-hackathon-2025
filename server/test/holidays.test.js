"use strict";
// Official-source sync for exchange holidays. No network: the Nasdaq Trader page is
// a REAL capture (test/fixtures/nasdaqtrader-2026.html) and fetch is faked.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseNasdaqTrader, parseUsDate } = require("../holidays/nasdaq");
const { HolidayService } = require("../holidays/service");

const PAGE = fs.readFileSync(path.join(__dirname, "fixtures", "nasdaqtrader-2026.html"), "utf8");
const quiet = { log() {}, warn() {} };

/* --------------------------------------------------------------- parser */

test("parses the real Nasdaq Trader 2026 schedule", () => {
  const { year, entries } = parseNasdaqTrader(PAGE);
  assert.equal(year, 2026);
  assert.equal(entries.length, 12);

  assert.deepEqual(
    entries.filter((e) => e.kind === "closed").map((e) => e.date),
    ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]
  );
  assert.deepEqual(entries.filter((e) => e.kind === "early").map((e) => e.date), ["2026-11-27", "2026-12-24"]);
});

test("cleans names and explains observed holidays and early closes", () => {
  const by = Object.fromEntries(parseNasdaqTrader(PAGE).entries.map((e) => [e.date, e]));
  assert.equal(by["2026-01-19"].name, "Martin Luther King, Jr. Day");
  assert.equal(by["2026-07-03"].name, "Independence Day");
  assert.equal(by["2026-07-03"].note, "Observed holiday");
  assert.equal(by["2026-06-19"].note, "Observed holiday");
  assert.equal(by["2026-11-27"].kind, "early");
  assert.equal(by["2026-11-27"].tag, "Early close");
  assert.match(by["2026-11-27"].note, /1:00 p\.m\. ET/);
  assert.equal(by["2026-11-27"].name, "Early Close", "the footnote asterisk is dropped");
});

test("rejects a page that is not the schedule, rather than guessing", () => {
  assert.throws(() => parseNasdaqTrader(""), /empty/);
  assert.throws(() => parseNasdaqTrader("<html>" + "x".repeat(400) + "</html>"), /heading/);

  // layout drift: heading present but the rows are gone / renamed
  const drifted = PAGE.replace(/<tr><td>/g, "<tr><th>").replace(/<\/td><\/tr>/g, "</th></tr>");
  assert.throws(() => parseNasdaqTrader(drifted), /only 0 rows/);
});

test("rejects data that is internally inconsistent", () => {
  const wrongYear = PAGE.replace("Holiday Schedule 2026", "Holiday Schedule 2027");
  assert.throws(() => parseNasdaqTrader(wrongYear), /not in 2027/);

  const unordered = PAGE.replace("January 19, 2026", "March 19, 2026");
  assert.throws(() => parseNasdaqTrader(unordered), /ascending/);

  const mystery = PAGE.replace(">Closed<", ">Maybe<");
  assert.throws(() => parseNasdaqTrader(mystery), /unrecognised status/);
});

test("date parsing accepts real dates only", () => {
  assert.equal(parseUsDate("November 27, 2026"), "2026-11-27");
  assert.equal(parseUsDate("  January 1, 2026 "), "2026-01-01");
  assert.equal(parseUsDate("February 30, 2026"), null);
  assert.equal(parseUsDate("Smarch 3, 2026"), null);
  assert.equal(parseUsDate("2026-11-27"), null);
});

/* -------------------------------------------------------------- service */

function rig(pages) {
  // pages: array of responses, consumed in order; the last one repeats
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-hol-"));
  let clock = Date.parse("2026-11-12T10:00:00Z");
  let calls = 0;
  const fetchImpl = async () => {
    const next = pages[Math.min(calls, pages.length - 1)];
    calls += 1;
    if (next instanceof Error) throw next;
    return { ok: next.ok !== false, status: next.status || 200, text: async () => next.body };
  };
  const make = () => new HolidayService({ dir, fetchImpl, now: () => clock, log: quiet });
  return {
    dir,
    make,
    svc: make(),
    calls: () => calls,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const withExtraClosure = PAGE.replace(
  "</table>",
  "<tr><td>December 31, 2026</td><td>Test Closure - U.S.</td><td>Closed</td></tr></table>"
);

test("first refresh stores the official copy and survives a restart", async () => {
  const r = rig([{ body: PAGE }]);
  const snap = await r.svc.refresh({ force: true });
  assert.equal(snap.nasdaq.years["2026"].entries.length, 12);
  assert.equal(snap.nasdaq.lastError, "");
  assert.ok(snap.nasdaq.lastSuccessAt);

  const reloaded = r.make().snapshot();
  assert.equal(reloaded.nasdaq.years["2026"].entries.length, 12, "persisted to disk");
});

test("a change at the source is picked up automatically on the next check", async () => {
  const r = rig([{ body: PAGE }, { body: withExtraClosure }]);
  const first = await r.svc.refresh({ force: true });
  const firstChanged = first.nasdaq.years["2026"].changedAt;

  r.advance(6 * 60 * 60 * 1000);
  const second = await r.svc.refresh({ force: true });
  const y = second.nasdaq.years["2026"];
  assert.equal(y.entries.length, 13);
  assert.equal(y.entries[12].name, "Test Closure");
  assert.notEqual(y.changedAt, firstChanged, "changedAt moves when the data changes");
});

test("an unchanged page does not move changedAt", async () => {
  const r = rig([{ body: PAGE }]);
  const a = (await r.svc.refresh({ force: true })).nasdaq.years["2026"];
  r.advance(3600 * 1000);
  const b = (await r.svc.refresh({ force: true })).nasdaq.years["2026"];
  assert.equal(b.changedAt, a.changedAt);
  assert.notEqual(b.fetchedAt, a.fetchedAt, "but fetchedAt records the fresh check");
});

test("an outage keeps the last good copy and says so", async () => {
  const r = rig([{ body: PAGE }, new Error("getaddrinfo ENOTFOUND www.nasdaqtrader.com"), { ok: false, status: 503, body: "" }]);
  await r.svc.refresh({ force: true });
  const okAt = r.svc.snapshot().nasdaq.lastSuccessAt;

  r.advance(7 * 3600 * 1000);
  let snap = await r.svc.refresh({ force: true });
  assert.match(snap.nasdaq.lastError, /ENOTFOUND/);
  assert.equal(snap.nasdaq.years["2026"].entries.length, 12, "good data is untouched");
  assert.equal(snap.nasdaq.lastSuccessAt, okAt);

  r.advance(7 * 3600 * 1000);
  snap = await r.svc.refresh({ force: true });
  assert.match(snap.nasdaq.lastError, /HTTP 503/);
});

test("a garbage page is rejected and never overwrites good data", async () => {
  const r = rig([{ body: PAGE }, { body: "<html><body>Access denied. " + "x".repeat(500) + "</body></html>" }]);
  await r.svc.refresh({ force: true });
  r.advance(7 * 3600 * 1000);
  const snap = await r.svc.refresh({ force: true });
  assert.match(snap.nasdaq.lastError, /heading not found/);
  assert.equal(snap.nasdaq.years["2026"].entries.length, 12);
});

test("recovers by itself once the source is healthy again", async () => {
  const r = rig([{ body: PAGE }, new Error("boom"), { body: withExtraClosure }]);
  await r.svc.refresh({ force: true });
  r.advance(7 * 3600 * 1000);
  await r.svc.refresh({ force: true });
  r.advance(7 * 3600 * 1000);
  const snap = await r.svc.refresh({ force: true });
  assert.equal(snap.nasdaq.lastError, "");
  assert.equal(snap.nasdaq.years["2026"].entries.length, 13);
});

test("does not hammer the exchange: checks closer than a minute are answered from the copy", async () => {
  const r = rig([{ body: PAGE }]);
  await r.svc.refresh(); // first ever check goes out
  assert.equal(r.calls(), 1);
  const again = await r.svc.refresh(); // 0 ms later
  assert.equal(again.throttled, true);
  assert.equal(r.calls(), 1, "no second request");
  r.advance(61 * 1000);
  await r.svc.refresh();
  assert.equal(r.calls(), 2);
});

test("simultaneous checks share one request", async () => {
  const r = rig([{ body: PAGE }]);
  await Promise.all([r.svc.refresh({ force: true }), r.svc.refresh({ force: true }), r.svc.refresh({ force: true })]);
  assert.equal(r.calls(), 1);
});

test("asks politely: identifies itself and only ever requests the one official URL", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-hol-"));
  const seen = [];
  const svc = new HolidayService({
    dir,
    log: quiet,
    fetchImpl: async (url, init) => {
      seen.push({ url, ua: init.headers["User-Agent"] });
      return { ok: true, status: 200, text: async () => PAGE };
    },
  });
  await svc.refresh({ force: true });
  assert.deepEqual(seen.map((s) => s.url), ["https://www.nasdaqtrader.com/trader.aspx?id=Calendar"]);
  assert.match(seen[0].ua, /vinaytiwari\.org-holiday-sync/);
});

test("a corrupt data file does not stop the service from starting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-hol-"));
  fs.writeFileSync(path.join(dir, "holidays.json"), "{ not json");
  const svc = new HolidayService({ dir, fetchImpl: async () => ({}), log: quiet });
  assert.deepEqual(svc.snapshot().nasdaq.years, {});
});
