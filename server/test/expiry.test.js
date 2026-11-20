"use strict";
// The expiry calendar (server/market/expiry.js, server/expiry.js): the dates are the exchange's own where it has listed
// the contract, the rule's elsewhere — and the rule itself is read from the list; a date that changes is noticed and kept;
// nothing here needs a login or an AI.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const X = require("../market/expiry");
const nse = require("../market/nse-holidays");
const { ExpiryCalendar, NAME } = require("../expiry");
const { FileDocs } = require("../docs");

const cal = { isTradingDay: nse.isTradingDay, holidayName: nse.holidayName, known: nse.known };
const quiet = { log() {}, error() {} };
const HEAD = "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange";
/** A contract file as the exchange publishes it: { NAME: { o: [option dates], f: [future dates] } } → CSV. */
function csv(book, exchange = "NFO") {
  const rows = [HEAD];
  let n = 1;
  for (const [name, u] of Object.entries(book)) {
    for (const d of u.f || []) rows.push(`${n++},${n},${name}FUT,"${name}",0,${d},0,0.05,50,FUT,${exchange}-FUT,${exchange}`);
    for (const d of u.o || []) for (const t of ["CE", "PE"]) rows.push(`${n++},${n},${name}${t},"${name}",0,${d},24000,0.05,50,${t},${exchange}-OPT,${exchange}`);
  }
  return rows.join("\n");
}
// what NSE and BSE really listed on 20 November 2026 (the months and weeks near that day)
const MONTHLY = ["2026-11-23", "2026-12-29", "2027-01-25"];
const NFO = () => ({
  NIFTY: { f: MONTHLY, o: [...MONTHLY, "2026-12-01", "2026-12-08", "2026-12-15", "2026-12-22", "2027-03-30"] },
  BANKNIFTY: { f: MONTHLY, o: MONTHLY },
  RELIANCE: { f: MONTHLY, o: MONTHLY },
  "M&M": { f: MONTHLY, o: MONTHLY },
});
const BFO = () => ({
  SENSEX: { f: ["2026-11-26", "2026-12-31", "2027-01-28"], o: ["2026-11-26", "2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31", "2027-01-07", "2027-01-28"] },
  BANKEX: { f: ["2026-11-26", "2026-12-31", "2027-01-28"], o: ["2026-11-26", "2026-12-31", "2027-01-28"] },
});
const TODAY = "2026-11-20";
const row = (b, date) => b.rows.find((r) => r.date === date);

test("the exchange's contract file is read for what matters: each underlying's option dates and future dates", () => {
  const p = X.parseList(csv(NFO()));
  assert.deepEqual(Object.keys(p).sort(), ["BANKNIFTY", "M&M", "NIFTY", "RELIANCE"]);
  assert.deepEqual(p.NIFTY.f, MONTHLY);
  assert.deepEqual(p.NIFTY.o, ["2026-11-23", "2026-12-01", "2026-12-08", "2026-12-15", "2026-12-22", "2026-12-29", "2027-01-25", "2027-03-30"], "each date once, oldest first");
  // a name with a comma inside quotes is one field
  assert.deepEqual(X.splitCsv('1,2,X,"MAHINDRA & MAHINDRA, LTD",0,2026-12-29'), ["1", "2", "X", "MAHINDRA & MAHINDRA, LTD", "0", "2026-12-29"]);
  // anything that is not the list — an error page, a half download, a file with other columns — is refused, not half-read
  assert.equal(X.parseList("<html><body>Too many requests</body></html>"), null);
  assert.equal(X.parseList(""), null);
  assert.equal(X.parseList("a,b,c\n1,2,3"), null);
  assert.equal(X.parseList(`${HEAD}\n1,2,NIFTYFUT,"NIFTY",0,2026-12-29,0,0.05,50,FUT,NFO-FUT,NFO`), null, "one underlying is not an exchange's list");
  // an underlying's monthly dates: its futures', and the last option date of a month that has no future yet
  assert.deepEqual(X.monthlyOf(p.NIFTY), ["2026-11-23", "2026-12-29", "2027-01-25", "2027-03-30"]);
});

test("NSE: the listed dates are the exchange's own, the holiday shift included; the rest of the year follows the weekday read from the list", () => {
  const b = X.build({ exchange: "NSE", parsed: X.parseList(csv(NFO())), today: TODAY, from: "2026-01-01", until: "2026-12-31", cal });
  assert.deepEqual([b.weekday, b.fromList, b.main, b.listedTo], ["Tuesday", true, "NIFTY 50", "2026-12-29"]);
  // what is still to come this year is all listed: the November monthly, four weeklies, the December monthly
  assert.deepEqual(b.rows.filter((r) => !r.past).map((r) => [r.date, r.kind, r.status]), [
    ["2026-11-23", "monthly", "listed"],
    ["2026-12-01", "weekly", "listed"],
    ["2026-12-08", "weekly", "listed"],
    ["2026-12-15", "weekly", "listed"],
    ["2026-12-22", "weekly", "listed"],
    ["2026-12-29", "monthly", "listed"],
  ]);
  // the November monthly is on Monday: Tuesday the 24th is a holiday, and the exchange's list says so itself
  const nov = row(b, "2026-11-23");
  assert.deepEqual([nov.day, nov.nominal, nov.moved, nov.uncertain], ["Monday", "2026-11-24", true, false]);
  assert.match(nov.why, /Tuesday 2026-11-24 is a market holiday \(Prakash Gurpurb Sri Guru Nanak Dev\), so it expires on the trading day before/);
  // who expires with the monthly: every index and every stock the list holds on that date
  assert.equal(nov.what, "Monthly: NIFTY 50, NIFTY Bank and 2 stocks");
  assert.deepEqual([nov.indices, nov.stocks], [["NIFTY 50", "NIFTY Bank"], 2]);
  assert.equal(row(b, "2026-12-08").what, "NIFTY 50 weekly");
  assert.equal(row(b, "2026-12-08").moved, false);
  // one row for every week of the year: 52 Tuesdays, each a weekly or (the last of its month) a monthly
  assert.equal(b.rows.length, 52);
  assert.equal(b.rows.filter((r) => r.kind === "monthly").length, 12);
  // the weeks that have passed are worked out by the same rule, holidays and all: 10 November was a holiday
  const passed = row(b, "2026-11-09");
  assert.deepEqual([passed.status, passed.past, passed.day, passed.nominal, passed.moved], ["passed", true, "Monday", "2026-11-10", true]);
  assert.deepEqual([row(b, "2026-01-27").kind, row(b, "2026-03-30").kind], ["monthly", "monthly"], "31 March 2026 was a holiday: the monthly was the 30th");
  assert.equal(row(b, "2026-03-30").nominal, "2026-03-31");
});

test("the rule is not assumed: it is the weekday the listed contracts fall on, so a change by the exchange changes every date", () => {
  // the same list, had NSE moved its expiries to Wednesday
  const wed = { NIFTY: { f: ["2026-11-25", "2026-12-30"], o: ["2026-11-25", "2026-12-02", "2026-12-09", "2026-12-16", "2026-12-23", "2026-12-30"] }, RELIANCE: { f: ["2026-11-25", "2026-12-30"], o: ["2026-11-25", "2026-12-30"] } };
  const b = X.build({ exchange: "NSE", parsed: X.parseList(csv(wed)), today: TODAY, from: "2026-11-20", until: "2027-01-31", cal });
  assert.equal(b.weekday, "Wednesday");
  assert.deepEqual(b.rows.map((r) => [r.date, r.kind, r.status]).slice(0, 8), [
    ["2026-11-25", "monthly", "listed"],
    ["2026-12-02", "weekly", "listed"],
    ["2026-12-09", "weekly", "listed"],
    ["2026-12-16", "weekly", "listed"],
    ["2026-12-23", "weekly", "listed"],
    ["2026-12-30", "monthly", "listed"],
    ["2027-01-06", "weekly", "scheduled"],
    ["2027-01-13", "weekly", "scheduled"],
  ]);
  // one holiday week does not make a new rule: four Tuesdays and a Monday are still Tuesdays
  assert.equal(X.readList(X.parseList(csv(NFO())), "NSE").dow, 2);
});

test("with no list at all the calendar is the rule's: Tuesday on NSE, Thursday on BSE, moved back for a holiday, and marked as such", () => {
  const n = X.build({ exchange: "NSE", parsed: null, today: TODAY, from: "2026-11-20", until: "2026-12-31", cal });
  assert.deepEqual([n.weekday, n.fromList, n.listedTo], ["Tuesday", false, null]);
  assert.deepEqual(n.rows.map((r) => [r.date, r.kind, r.status]), [
    ["2026-11-23", "monthly", "scheduled"],
    ["2026-12-01", "weekly", "scheduled"],
    ["2026-12-08", "weekly", "scheduled"],
    ["2026-12-15", "weekly", "scheduled"],
    ["2026-12-22", "weekly", "scheduled"],
    ["2026-12-29", "monthly", "scheduled"],
  ], "the rule and the holiday table alone give the dates the exchange lists");
  assert.match(n.rows[0].what, /^Monthly: NIFTY 50, NIFTY Bank, NIFTY Financial Services/);
  // BSE: Thursdays; the March 2026 monthly fell on Ram Navami and moved to Wednesday
  const s = X.build({ exchange: "BSE", parsed: null, today: TODAY, from: "2026-01-01", until: "2026-12-31", cal });
  assert.equal(s.weekday, "Thursday");
  const mar = row(s, "2026-03-25");
  assert.deepEqual([mar.kind, mar.day, mar.nominal, mar.moved], ["monthly", "Wednesday", "2026-03-26", true]);
  assert.match(mar.why, /Thursday 2026-03-26 is a market holiday \(Shri Ram Navami\)/);
  assert.equal(row(s, "2026-12-31").what, "Monthly: SENSEX, BANKEX, SENSEX 50 and FOCIT");
  // with the list, BSE's own dates
  const listed = X.build({ exchange: "BSE", parsed: X.parseList(csv(BFO(), "BFO")), today: TODAY, from: TODAY, until: "2026-12-31", cal });
  assert.deepEqual(listed.rows.map((r) => r.date), ["2026-11-26", "2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
  assert.ok(listed.rows.every((r) => r.status === "listed") && listed.rows[5].what === "Monthly: SENSEX and BANKEX");
});

test("to the end of the year — and from 24 December to the end of the next, by itself", () => {
  assert.deepEqual(X.horizon("2026-11-20"), { from: "2026-01-01", until: "2026-12-31", nextYear: false });
  assert.deepEqual(X.horizon("2026-12-23"), { from: "2026-01-01", until: "2026-12-31", nextYear: false });
  assert.deepEqual(X.horizon("2026-12-24"), { from: "2026-01-01", until: "2027-12-31", nextYear: true });
  assert.deepEqual(X.horizon("2027-01-02"), { from: "2027-01-01", until: "2027-12-31", nextYear: false });
  // in the last week of December next year is there: what the exchange has listed as listed, the rest by the rule
  const h = X.horizon("2026-12-24");
  const b = X.build({ exchange: "NSE", parsed: X.parseList(csv(NFO())), today: "2026-12-24", from: h.from, until: h.until, cal });
  const next = b.rows.filter((r) => r.date >= "2027-01-01");
  assert.equal(next.length, 52);
  assert.equal(next.filter((r) => r.kind === "monthly").length, 12);
  // the January monthly is already the exchange's own date: Monday the 25th (Tuesday is Republic Day), though the desk holds no 2027 holiday list
  const jan = next.find((r) => r.kind === "monthly");
  assert.deepEqual([jan.date, jan.day, jan.status, jan.moved, jan.uncertain], ["2027-01-25", "Monday", "listed", true, false]);
  assert.match(jan.why, /the exchange lists this contract for Monday, not the usual Tuesday/);
  // a date the exchange has not listed yet, in a year whose holidays the desk does not hold, says it may move
  const feb = next.find((r) => r.date === "2027-02-23");
  assert.deepEqual([feb.kind, feb.status, feb.uncertain], ["monthly", "scheduled", true]);
  assert.deepEqual(next.find((r) => r.date === "2027-03-30").status, "listed", "a quarterly contract the exchange lists far ahead is that month's own date");
  // before the last week, what the exchange already lists for next year is offered as a line, not a calendar
  assert.deepEqual(X.beyond(X.parseList(csv(NFO())), "NSE", "2026-12-31"), [{ exchange: "NSE", date: "2027-01-25", day: "Monday", kind: "monthly" }]);
  assert.deepEqual(X.beyond(X.parseList(csv(BFO(), "BFO")), "BSE", "2026-12-31").map((x) => [x.date, x.kind]), [["2027-01-07", "weekly"], ["2027-01-28", "monthly"]]);
  assert.deepEqual(X.beyond(null, "NSE", "2026-12-31"), []);
});

test("a change is a week whose date is no longer what it was — not a week that is new, nor one long past", () => {
  const before = { "NSE|2026-12-22": "2026-12-22", "NSE|2026-12-29": "2026-12-29", "NSE|2026-03-31": "2026-03-30" };
  const after = { "NSE|2026-12-22": "2026-12-21", "NSE|2026-12-29": "2026-12-29", "NSE|2026-03-31": "2026-03-31", "NSE|2027-01-05": "2027-01-05" };
  assert.deepEqual(X.changes(before, after, TODAY), [{ key: "NSE|2026-12-22", exchange: "NSE", nominal: "2026-12-22", was: "2026-12-22", now: "2026-12-21" }]);
});

/* ------------------------------------------------------------------------------------------------ the service */

function setup({ nfo = NFO(), bfo = BFO(), at = "2026-11-20T03:30:00Z" } = {}) {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-expiry-")));
  const clock = { ms: Date.parse(at) };
  const net = { nfo, bfo, calls: [], fail: "" };
  const fetchImpl = async (url, init) => {
    net.calls.push({ url, method: init.method, headers: init.headers });
    if (net.fail === "down") throw new Error("getaddrinfo ENOTFOUND api.kite.trade");
    if (net.fail === "429") return { ok: false, status: 429, text: async () => "Too many requests" };
    if (net.fail === "html") return { ok: true, status: 200, text: async () => "<html>maintenance</html>" };
    return { ok: true, status: 200, text: async () => (url.endsWith("/BFO") ? csv(net.bfo, "BFO") : csv(net.nfo)) };
  };
  const service = new ExpiryCalendar({ docs, cal, fetchImpl, now: () => clock.ms, log: quiet });
  return { docs, clock, net, service };
}

test("the service reads the two public lists by itself, shows the calendar, and asks for no login and no AI", async () => {
  const { service, net, docs } = setup();
  // before the first read the calendar is already there, by the rule, and says where it comes from
  const first = service.view();
  assert.deepEqual([first.source.checkedAt, first.source.on, first.exchanges.map((x) => x.fromList)], [null, true, [false, false]]);
  assert.equal(first.exchanges[0].next.date, "2026-11-23");
  assert.deepEqual(service.status().due, true, "never read: a read is due");

  assert.deepEqual(await service.refresh({ trigger: "test" }), { ok: true, changed: 0, error: "" });
  // two plain GETs of the public file: no key, no token, no cookie
  assert.deepEqual(net.calls.map((c) => [c.url, c.method, Object.keys(c.headers)]), [["https://api.kite.trade/instruments/NFO", "GET", ["Accept"]], ["https://api.kite.trade/instruments/BFO", "GET", ["Accept"]]]);
  const v = service.view();
  assert.deepEqual([v.today, v.from, v.until, v.nextYear], ["2026-11-20", "2026-01-01", "2026-12-31", false]);
  assert.ok(v.source.checkedAt && !v.source.error);
  const [n, s] = v.exchanges;
  assert.deepEqual([n.id, n.weekday, n.fromList, s.id, s.weekday], ["NSE", "Tuesday", true, "BSE", "Thursday"]);
  assert.deepEqual([n.next.date, n.next.daysLeft, n.next.kind, n.nextMonthly.date], ["2026-11-23", 3, "monthly", "2026-11-23"]);
  assert.deepEqual([s.next.date, s.next.daysLeft], ["2026-11-26", 6]);
  assert.ok(n.rows.every((r) => Number.isInteger(r.daysLeft) && r.past === r.daysLeft < 0));
  assert.deepEqual(v.ahead.map((a) => `${a.exchange} ${a.date}`), ["NSE 2027-01-25", "BSE 2027-01-07", "BSE 2027-01-28"]);
  assert.deepEqual(v.changes, []);
  assert.equal(v.holidaysKnown, true);
  assert.match(v.note, /added by themselves on 24 December/);
  assert.match(v.rule, /LISTED is read from the exchange's own contract list/);
  // what is kept is small: the dates, not the file
  assert.ok(JSON.stringify(docs.read(NAME)).length < 20000);
  assert.equal(service.view(), v, "the same calendar is not worked out twice");
});

test("when the exchange moves a date, or the day of the week itself, the calendar follows and keeps what it was", async () => {
  const { service, net, clock } = setup();
  await service.refresh();
  const fp = service.fingerprint();
  // the exchange brings the 22 December weekly forward to Monday the 21st
  net.nfo = NFO();
  net.nfo.NIFTY.o = net.nfo.NIFTY.o.map((d) => (d === "2026-12-22" ? "2026-12-21" : d));
  clock.ms += 13 * 3600000;
  const r = await service.refresh();
  assert.deepEqual([r.ok, r.changed], [true, 1]);
  assert.notEqual(service.fingerprint(), fp, "every open page is told");
  const v = service.view();
  const moved = v.exchanges[0].rows.find((x) => x.nominal === "2026-12-22");
  assert.deepEqual([moved.date, moved.day, moved.status, moved.moved], ["2026-12-21", "Monday", "listed", true]);
  assert.match(moved.why, /the exchange lists this contract for Monday, not the usual Tuesday/);
  assert.equal(v.changes.length, 1);
  assert.deepEqual([v.changes[0].exchange, v.changes[0].kind, v.changes[0].was, v.changes[0].now], ["NSE", "date", "2026-12-22", "2026-12-21"]);
  assert.equal(v.changes[0].text, "NSE: the expiry of the week of 2026-12-22 is now 2026-12-21 (it was 2026-12-22).");
  // reading the same list again changes nothing more
  clock.ms += 13 * 3600000;
  assert.equal((await service.refresh()).changed, 0);
  assert.equal(service.view().changes.length, 1);

  // BSE moves all its expiries from Thursday to Friday: the weekday is read from the list, and the change is said in words
  net.bfo = { SENSEX: { f: ["2026-11-27", "2026-12-24"], o: ["2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-24"] }, BANKEX: { f: ["2026-11-27", "2026-12-24"], o: ["2026-11-27", "2026-12-24"] } };
  clock.ms += 13 * 3600000;
  const w = await service.refresh();
  assert.equal(w.changed, 1, "one change: the day itself (every week has a new date, so they are not listed one by one)");
  const v2 = service.view();
  assert.equal(v2.exchanges[1].weekday, "Friday");
  assert.equal(v2.changes[0].text, "BSE expiries moved from Thursday to Friday: every date below follows the exchange's new day.");
  assert.deepEqual(v2.exchanges[1].rows.filter((x) => !x.past).map((x) => x.date), ["2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-24"], "25 December is a holiday: the last Friday's monthly is the 24th, as listed");
});

test("a failed read changes nothing but what the page says about the last check; the last good list is kept", async () => {
  const { service, net, clock } = setup();
  await service.refresh();
  const good = service.view();
  for (const [how, said] of [["down", /ENOTFOUND/], ["429", /HTTP 429/], ["html", /not in the expected form/]]) {
    net.fail = how;
    clock.ms += 13 * 3600000;
    const r = await service.refresh();
    assert.equal(r.ok, false);
    assert.match(r.error, said);
    const v = service.view();
    assert.equal(v.source.checkedAt, good.source.checkedAt, "the last good read is still the one shown");
    assert.match(v.source.error, said);
    assert.deepEqual(v.exchanges[0].rows.filter((x) => x.status === "listed").map((x) => x.date), good.exchanges[0].rows.filter((x) => x.status === "listed").map((x) => x.date));
    assert.deepEqual(v.changes, []);
  }
  // where the network must not be touched (a test, an air-gapped server) nothing is fetched and the rule's calendar is shown
  const none = new ExpiryCalendar({ docs: new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-expiry-"))), cal, fetchImpl: null, now: () => clock.ms, log: quiet });
  assert.deepEqual(await none.refresh(), { ok: false, skipped: "no network here", changed: 0 });
  assert.deepEqual([none.view().source.on, none.status().due, none.view().exchanges[0].weekday], [false, false, "Tuesday"]);
});

test("it listens by itself: at once, every morning, every twelve hours, half an hour after a failure — and a passed week keeps its real date", async () => {
  const { service, net, clock } = setup({ at: "2026-11-20T03:30:00Z" }); // 9:00 AM IST
  assert.equal((await service.tickOnce()).ok, true, "never read: read at the first tick");
  assert.equal(net.calls.length, 2);
  clock.ms += 3 * 3600000;
  assert.equal(await service.tickOnce(), null, "three hours on nothing is due");
  clock.ms += 10 * 3600000; // 10 PM: twelve hours since the read
  assert.equal((await service.tickOnce()).ok, true);
  // next morning before 8:00 AM nothing; from 8:00 AM the day's list
  clock.ms = Date.parse("2026-11-23T01:30:00Z"); // Monday 7:00 AM IST… but twelve hours have long passed
  assert.equal((await service.tickOnce()).ok, true);
  clock.ms = Date.parse("2026-11-24T01:00:00Z"); // Tuesday 6:30 AM IST, five and a half hours after… the last read was yesterday 7:00 AM: due by age
  await service.tickOnce();
  clock.ms = Date.parse("2026-11-24T20:00:00Z"); // 1:30 AM IST on the 25th
  await service.tickOnce();
  const n0 = net.calls.length;
  clock.ms = Date.parse("2026-11-25T01:30:00Z"); // 7:00 AM IST the same day: before the morning's list
  assert.equal(await service.tickOnce(), null);
  clock.ms = Date.parse("2026-11-25T02:35:00Z"); // 8:05 AM IST: the morning's list, though only six hours have passed
  assert.equal((await service.tickOnce()).ok, true);
  assert.equal(net.calls.length, n0 + 2);
  // a failure is tried again in half an hour, not sooner
  net.fail = "down";
  clock.ms += 13 * 3600000;
  assert.equal((await service.tickOnce()).ok, false);
  clock.ms += 10 * 60000;
  assert.equal(await service.tickOnce(), null);
  clock.ms += 25 * 60000;
  net.fail = "";
  // by now the November contract has expired and left the exchange's list — the week keeps the date that was read
  net.nfo = NFO();
  for (const u of Object.values(net.nfo)) {
    u.f = u.f.filter((d) => d !== "2026-11-23");
    u.o = u.o.filter((d) => d !== "2026-11-23");
  }
  assert.equal((await service.tickOnce()).ok, true);
  const gone = service.view().exchanges[0].rows.find((x) => x.nominal === "2026-11-24");
  assert.deepEqual([gone.date, gone.past, gone.status, gone.moved], ["2026-11-23", true, "passed", true]);
  assert.equal(service.view().changes.length, 0, "a contract that expired is not a change");
  assert.equal(service.view().exchanges[0].next.date, "2026-12-01");
});

test("in the last week of December the next year is there by itself", async () => {
  const { service, clock } = setup({ at: "2026-12-23T04:00:00Z" });
  await service.refresh();
  assert.equal(service.view().until, "2026-12-31");
  clock.ms = Date.parse("2026-12-24T04:00:00Z");
  await service.tickOnce(); // a new day: the calendar is worked out again though no read is due
  const v = service.view();
  assert.deepEqual([v.until, v.nextYear, v.holidaysKnown], ["2027-12-31", true, false]);
  assert.match(v.note, /the calendar now runs to the end of 2027/);
  assert.deepEqual(v.ahead, []);
  const next = v.exchanges[0].rows.filter((r) => r.date >= "2027-01-01");
  assert.equal(next.length, 52);
  assert.deepEqual([next[0].date, next[0].status, next[0].uncertain], ["2027-01-05", "scheduled", true]);
  assert.equal(next.find((r) => r.kind === "monthly").date, "2027-01-25");
  assert.equal(v.exchanges[1].rows.filter((r) => r.date >= "2027-01-01").length, 52);
});
