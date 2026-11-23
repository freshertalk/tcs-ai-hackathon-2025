"use strict";
// NSE's own trading-holiday list (23 Nov 2026): the strict parser, the service that keeps it in step and hands it to the
// trading-day rules, and the next-session answer the /me strip shows. No network: the NSE answer is a REAL capture
// (test/fixtures/nse-holiday-master.json, read 23 Nov 2026) and fetch is faked.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseNseHolidayMaster, parseNseDate, cleanName } = require("../holidays/nse");
const { NseHolidayService, NSE_API_URL } = require("../holidays/nse-service");
const cal = require("../market/nse-holidays");
const { nextSession } = require("../market/next-session");

const BODY = fs.readFileSync(path.join(__dirname, "fixtures", "nse-holiday-master.json"), "utf8");
const DATA = JSON.parse(BODY);
const quiet = { log() {}, warn() {} };
const IST = 5.5 * 3600 * 1000;
const ist = (s) => Date.parse(`${s}:00Z`) - IST; // "2026-11-23T19:35" IST → ms

test.afterEach(() => cal.setOfficial(null));

/* --------------------------------------------------------------- parser */

test("reads NSE's real 2026 equity list: 20 days, in order, with NSE's names", () => {
  const { years, segment, derivatives } = parseNseHolidayMaster(BODY);
  assert.equal(segment, "CM");
  assert.deepEqual(Object.keys(years), ["2026"]);
  const list = years["2026"];
  assert.equal(list.length, 20);
  assert.equal(list[0].date, "2026-01-15");
  const gurpurb = list.find((e) => e.date === "2026-11-24");
  assert.deepEqual(gurpurb, { date: "2026-11-24", weekday: "Tuesday", name: "Prakash Gurpurb Sri Guru Nanak Dev", kind: "closed", note: "" });
  const diwali = list.find((e) => e.date === "2026-11-08");
  assert.equal(diwali.kind, "muhurat", "NSE's asterisk marks the Muhurat day");
  assert.equal(diwali.name, "Diwali Laxmi Pujan");
  assert.match(diwali.note, /Muhurat/);
  assert.deepEqual(derivatives, { same: true, onlyEquity: [], onlyDerivatives: [] }, "F&O closes on the same days");
});

test("NSE's list and the built-in table agree date for date (verified 23 Nov 2026)", () => {
  const nse = parseNseHolidayMaster(DATA).years["2026"].map((e) => e.date);
  assert.deepEqual(nse, Object.keys(cal.localClosed(2026)).sort());
});

test("refuses anything that is not NSE's list, with a reason", () => {
  assert.throws(() => parseNseHolidayMaster(""), /empty/);
  assert.throws(() => parseNseHolidayMaster("<html><body>Access Denied</body></html>"), /web page/);
  assert.throws(() => parseNseHolidayMaster("{not json"), /not valid JSON/);
  assert.throws(() => parseNseHolidayMaster({}), /CM list is missing/);
  assert.throws(() => parseNseHolidayMaster({ CM: DATA.CM.slice(0, 3) }), /broken list/);

  const wrongDay = JSON.parse(BODY);
  wrongDay.CM[18].weekDay = "Monday"; // 24 Nov 2026 is a Tuesday
  assert.throws(() => parseNseHolidayMaster(wrongDay), /NSE says Monday but 2026-11-24 is a Tuesday/);

  const unordered = JSON.parse(BODY);
  [unordered.CM[3], unordered.CM[4]] = [unordered.CM[4], unordered.CM[3]];
  assert.throws(() => parseNseHolidayMaster(unordered), /ascending/);

  const badDate = JSON.parse(BODY);
  badDate.CM[0].tradingDate = "31-Feb-2026";
  assert.throws(() => parseNseHolidayMaster(badDate), /no readable date/);
});

test("a differing derivatives list is reported, never fatal", () => {
  const d = JSON.parse(BODY);
  d.FO = d.FO.filter((e) => e.tradingDate !== "25-Dec-2026");
  const { derivatives } = parseNseHolidayMaster(d);
  assert.equal(derivatives.same, false);
  assert.deepEqual(derivatives.onlyEquity, ["2026-12-25"]);
});

test("dates and names", () => {
  assert.equal(parseNseDate("24-Nov-2026"), "2026-11-24");
  assert.equal(parseNseDate(" 1-jan-2027 "), "2027-01-01");
  assert.equal(parseNseDate("30-Feb-2026"), null);
  assert.equal(parseNseDate("2026-11-24"), null);
  assert.deepEqual(cleanName("Diwali Laxmi Pujan*"), { name: "Diwali Laxmi Pujan", muhurat: true });
  assert.deepEqual(cleanName("  Holi "), { name: "Holi", muhurat: false });
});

/* -------------------------------------------------------- the rules use it */

test("setOfficial: a year NSE published is read from NSE's list; the table stays the fallback", () => {
  assert.equal(cal.sourceOf(2026), "table");
  assert.equal(cal.holidayName("2026-11-10"), "Diwali — Balipratipada");
  cal.setOfficial(parseNseHolidayMaster(DATA).years);
  assert.equal(cal.sourceOf(2026), "nse");
  assert.equal(cal.isOfficial("2026-05-01"), true);
  assert.equal(cal.holidayName("2026-11-10"), "Diwali-Balipratipada", "NSE's own name");
  assert.equal(cal.holidayName("2026-11-08"), "Diwali Laxmi Pujan (Muhurat trading only)");
  assert.equal(cal.isTradingDay("2026-11-24"), false);
  assert.equal(cal.nextTradingDay("2026-11-23"), "2026-11-25");
  assert.equal(cal.isTradingDay("2026-02-01"), true, "the Budget Sunday special session is kept");

  // a holiday NSE adds later is in force at once
  const added = parseNseHolidayMaster(DATA).years;
  added["2026"] = [...added["2026"], { date: "2026-12-31", weekday: "Thursday", name: "Test closure", kind: "closed", note: "" }];
  cal.setOfficial(added);
  assert.equal(cal.isTradingDay("2026-12-31"), false);
  assert.equal(cal.sourceOf(2027), "none");

  cal.setOfficial(null);
  assert.equal(cal.sourceOf(2026), "table");
  assert.equal(cal.isTradingDay("2026-12-31"), true);
});

/* -------------------------------------------------------------- service */

function rig(answers, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-nse-"));
  let clock = Date.parse("2026-11-23T10:00:00Z");
  let calls = 0;
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    const next = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (next instanceof Error) throw next;
    return { ok: next.ok !== false, status: next.status || 200, text: async () => next.body };
  };
  const changes = [];
  const make = () => new NseHolidayService({ dir, fetchImpl, now: () => clock, log: quiet, onChange: (s) => changes.push(s), ...opts });
  return { dir, make, svc: make(), calls: () => calls, seen, changes, advance: (ms) => (clock += ms) };
}

test("first check stores NSE's list, hands it to the rules, and survives a restart", async () => {
  const r = rig([{ body: BODY }]);
  const snap = await r.svc.refresh({ force: true });
  assert.equal(snap.years["2026"].entries.length, 20);
  assert.equal(snap.lastError, "");
  assert.ok(snap.lastSuccessAt);
  assert.equal(cal.sourceOf(2026), "nse", "the trading-day rules read it at once");
  assert.deepEqual(snap.verify, [{ year: 2026, holidays: 20, status: "match", onlyNse: [], onlyTable: [] }]);
  assert.equal(r.changes.length, 1, "the first copy is a change (the live channel is told)");

  cal.setOfficial(null);
  const again = r.make(); // a restart: the copy on disk is applied before any network
  assert.equal(again.snapshot().years["2026"].entries.length, 20);
  assert.equal(cal.sourceOf(2026), "nse");
});

test("asks NSE's one public URL, as a browser with NSE's page as the referrer", async () => {
  const r = rig([{ body: BODY }]);
  await r.svc.refresh({ force: true });
  assert.deepEqual(r.seen.map((s) => s.url), [NSE_API_URL]);
  assert.match(r.seen[0].init.headers["User-Agent"], /Mozilla/);
  assert.match(r.seen[0].init.headers.Accept, /application\/json/);
  assert.equal(r.seen[0].init.headers.Referer, "https://www.nseindia.com/resources/exchange-communication-holidays");
});

test("an outage or a garbage answer keeps the last good copy and says so", async () => {
  const r = rig([{ body: BODY }, new Error("The operation was aborted due to timeout"), { body: "<html>Access Denied</html>" }, { ok: false, status: 403, body: "" }]);
  await r.svc.refresh({ force: true });
  const okAt = r.svc.snapshot().lastSuccessAt;
  for (const why of [/timeout/, /web page/, /HTTP 403/]) {
    r.advance(7 * 3600 * 1000);
    const snap = await r.svc.refresh({ force: true });
    assert.match(snap.lastError, why);
    assert.equal(snap.years["2026"].entries.length, 20, "good data untouched");
    assert.equal(snap.lastSuccessAt, okAt);
    assert.equal(cal.sourceOf(2026), "nse", "the rules keep NSE's list");
  }
  assert.equal(r.changes.length, 1, "failures are not changes");
});

test("a change at NSE is picked up, logged, and differs from the table", async () => {
  const changed = JSON.parse(BODY);
  changed.CM.push({ tradingDate: "31-Dec-2026", weekDay: "Thursday", description: "Test closure" });
  const r = rig([{ body: BODY }, { body: JSON.stringify(changed) }]);
  await r.svc.refresh({ force: true });
  r.advance(6 * 3600 * 1000);
  const snap = await r.svc.refresh({ force: true });
  assert.equal(snap.years["2026"].entries.length, 21);
  assert.match(snap.changes[0].text, /NSE changed its 2026 list: added 2026-12-31 Test closure/);
  assert.equal(snap.verify[0].status, "differs");
  assert.deepEqual(snap.verify[0].onlyNse, [{ date: "2026-12-31", name: "Test closure" }]);
  assert.equal(cal.isTradingDay("2026-12-31"), false, "NSE's list is the one in force");
  assert.equal(r.changes.length, 2);
});

test("an unchanged list keeps changedAt; checks closer than a minute use the copy; simultaneous checks share one request", async () => {
  const r = rig([{ body: BODY }]);
  const a = (await r.svc.refresh()).years["2026"];
  assert.equal(r.calls(), 1);
  assert.equal((await r.svc.refresh()).throttled, true);
  assert.equal(r.calls(), 1);
  r.advance(3600 * 1000);
  const b = (await r.svc.refresh()).years["2026"];
  assert.equal(b.changedAt, a.changedAt);
  assert.notEqual(b.fetchedAt, a.fetchedAt);
  await Promise.all([r.svc.refresh({ force: true }), r.svc.refresh({ force: true })]);
  assert.equal(r.calls(), 3);
  assert.notDeepEqual(r.svc.fingerprint(), [], "a fingerprint for the live channel");
});

/* --------------------------------------------------------- next session */

const officialSnap = async () => {
  const r = rig([{ body: BODY }]);
  return r.svc.refresh({ force: true });
};

test("Monday 23 Nov after the close: tomorrow is Guru Nanak Jayanti, so the next trading day is Wednesday 25 Nov", async () => {
  const official = await officialSnap();
  const r = nextSession({ now: ist("2026-11-23T19:35"), official });
  assert.equal(r.today.status, "closed-for-day");
  assert.equal(r.next.date, "2026-11-25");
  assert.equal(r.next.label, "Wednesday, 25 November 2026");
  assert.equal(r.next.daysAway, 2);
  assert.equal(r.next.preOpenClock, "9:00 AM");
  assert.equal(r.next.openClock, "9:15 AM");
  assert.equal(r.next.closeClock, "3:30 PM");
  assert.equal(r.next.opensAt, ist("2026-11-25T09:15"));
  assert.match(r.next.closingAuction.text, /F&O stocks: continuous trading till 3:15 PM, closing auction 3:15 PM–3:35 PM/);
  assert.deepEqual(r.skipped, [{ date: "2026-11-24", weekday: "Tuesday", short: "Tue 24 Nov", reason: "holiday", name: "Prakash Gurpurb Sri Guru Nanak Dev" }]);
  assert.equal(r.calendar.source, "nse");
  assert.equal(r.verify.status, "match");
  assert.match(r.verify.text, /Matches NSE's official calendar/);
  assert.equal(r.upcoming[0].date, "2026-11-24");
  assert.equal(r.upcoming[1].name, "Christmas");
  assert.equal(r.session.date, "2026-11-25");
  assert.equal(r.refreshAt, ist("2026-11-24T00:00"), "the page re-reads at midnight");
});

test("Friday evening → Monday, with the weekend skipped; Christmas Friday → Monday 28 Dec", () => {
  const fri = nextSession({ now: ist("2026-11-27T18:00") });
  assert.equal(fri.next.date, "2026-11-30");
  assert.deepEqual(fri.skipped.map((s) => s.reason), ["weekend", "weekend"]);
  const xmasEve = nextSession({ now: ist("2026-12-24T16:00") });
  assert.equal(xmasEve.next.date, "2026-12-28");
  assert.deepEqual(xmasEve.skipped.map((s) => `${s.date}:${s.reason}`), ["2026-12-25:holiday", "2026-12-26:weekend", "2026-12-27:weekend"]);
  assert.equal(xmasEve.calendar.source, "table", "no NSE copy in this test: the built-in table, and it says so");
  assert.equal(xmasEve.verify.status, "unverified");
});

test("today's state: before the open, pre-open, open, and on a holiday", () => {
  const early = nextSession({ now: ist("2026-11-25T08:10") });
  assert.equal(early.today.status, "before-open");
  assert.equal(early.next.date, "2026-11-26", "the next trading day is after today");
  assert.equal(early.session.date, "2026-11-25", "…while today's session is the next one to run");
  assert.equal(early.refreshAt, ist("2026-11-25T09:00"));
  assert.equal(nextSession({ now: ist("2026-11-25T09:05") }).today.status, "pre-open");
  const open = nextSession({ now: ist("2026-11-25T11:00") });
  assert.equal(open.today.status, "open");
  assert.equal(open.session.phase, "open");
  assert.equal(open.today.closesAt, ist("2026-11-25T15:30"));
  const hol = nextSession({ now: ist("2026-11-24T10:00") });
  assert.equal(hol.today.status, "holiday");
  assert.equal(hol.today.holiday, "Prakash Gurpurb Sri Guru Nanak Dev");
  assert.equal(hol.next.date, "2026-11-25");
  assert.equal(hol.next.daysAway, 1);
});

test("the Budget Sunday special session counts as a trading day; Saturday before it points at it", () => {
  const sat = nextSession({ now: ist("2026-01-31T12:00") });
  assert.equal(sat.next.date, "2026-02-01");
  assert.match(sat.next.special, /Union Budget/);
  const sun = nextSession({ now: ist("2026-02-01T10:00") });
  assert.equal(sun.today.status, "open");
});

test("a year with no list says so instead of guessing", () => {
  const r = nextSession({ now: ist("2026-12-31T16:00") });
  assert.equal(r.next.date, "2027-01-01", "weekdays are assumed open in an unpublished year");
  assert.equal(r.calendar.known, false);
});

/* ------------------------------------------- the daily check (owner's rule, 23 Nov 2026) */

test("NSE is read once a weekday after the 3:30 PM close — never on Saturday or Sunday, never twice a day", async () => {
  const r = rig([{ body: BODY }]);
  const at = (s) => ist(s);
  assert.equal(r.svc.dailyDue(at("2026-11-23T15:29")), false, "before the close");
  assert.equal(r.svc.dailyDue(at("2026-11-23T15:30")), true, "Monday after the close");
  await r.svc.tickDaily(at("2026-11-23T15:30"));
  assert.equal(r.calls(), 1);
  assert.equal(r.svc.dailyDue(at("2026-11-23T19:54")), false, "done for the day");
  assert.equal(r.svc.tickDaily(at("2026-11-23T23:59")), null);
  assert.equal(r.svc.dailyDue(at("2026-11-28T16:00")), false, "Saturday");
  assert.equal(r.svc.dailyDue(at("2026-11-29T16:00")), false, "Sunday");
  assert.equal(r.svc.dailyDue(at("2026-11-24T16:00")), true, "the next weekday (even a holiday) checks once");
  assert.equal(r.calls(), 1);
  // the day's record survives a restart: no second read that day
  const again = r.make();
  assert.equal(again.dailyDue(at("2026-11-23T20:30")), false);
});

test("a failed daily check is tried again an hour later, three times at most", async () => {
  const r = rig([new Error("NSE did not answer")]);
  await r.svc.tickDaily(ist("2026-11-25T15:31"));
  assert.equal(r.svc.dailyDue(ist("2026-11-25T16:00")), false, "not before an hour");
  assert.equal(r.svc.dailyDue(ist("2026-11-25T16:31")), true);
  await r.svc.tickDaily(ist("2026-11-25T16:31"));
  await r.svc.tickDaily(ist("2026-11-25T17:31"));
  assert.equal(r.calls(), 3);
  assert.equal(r.svc.dailyDue(ist("2026-11-25T18:31")), false, "three tries a day at most");
});

test("start(): no read at start-up when a copy exists; one read when there is none", async () => {
  const r = rig([{ body: BODY }]);
  r.svc.start(); // no copy yet: reads once
  await new Promise((res) => setImmediate(res));
  r.svc.stop();
  assert.ok(r.calls() >= 1);
  const before = r.calls();
  const second = r.make(); // the copy is on disk now
  second.start();
  await new Promise((res) => setImmediate(res));
  second.stop();
  // only the daily rule may read now (and the test clock is Monday 3:30 PM IST: once at most)
  assert.ok(r.calls() - before <= 1);
});
