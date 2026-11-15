"use strict";
// The daily goal and profit protection (server/trading/discipline.js): target, stop, the guard
// against giving profits back, and the reminders it raises. No network, no clock.

const test = require("node:test");
const assert = require("node:assert/strict");

const { assess, cleanDiscipline, baseOf, DISCIPLINE_DEFAULTS } = require("../trading/discipline");

const at = (hhmm) => Date.parse(`2026-11-16T${hhmm}:00+05:30`);
const funds = (opening = 100000, collateral = 0) => ({ equity: { net: 90000, available: { opening, collateral } } });
const pos = (symbol, quantity, average, pnl, m2m = pnl) => ({ exchange: "NSE", symbol, product: "MIS", quantity, average, pnl, m2m, multiplier: 1 });
const cfg = cleanDiscipline({});

/** Run the day through a list of (time, positions) steps; returns every standing and every reminder. */
function day(steps, c = cfg) {
  let rec = null;
  const all = [];
  for (const [t, net, f] of steps) {
    const out = assess({ cfg: c, day: rec, now: at(t), funds: f === undefined ? funds() : f, positions: { net } });
    rec = out.day;
    all.push(out);
  }
  return all;
}

test("the target is 3% and the stop 1.5% of the morning's available margin, and they do not move during the day", () => {
  const [a, b] = day([
    ["09:20", [pos("SBIN", 100, 800, 0)], funds(100000, 20000)],
    ["11:00", [pos("SBIN", 100, 800, 500)], funds(5000, 0)], // margin used up later: the base stays
  ]);
  assert.equal(a.standing.base, 120000);
  assert.equal(a.standing.target, 3600);
  assert.equal(a.standing.stop, 1800);
  assert.equal(b.standing.base, 120000, "the target is fixed for the day");
  assert.equal(b.standing.state, "ok");
  assert.equal(baseOf({ equity: { net: 50000, available: {} } }), 50000, "without an opening balance, the live margin");
  assert.equal(DISCIPLINE_DEFAULTS.targetPct, 3);
});

test("target reached: a success reminder to stop, told once when flat and repeated while positions stay open", () => {
  const steps = day([
    ["10:00", [pos("SBIN", 100, 800, 3100)]],
    ["10:01", [pos("SBIN", 0, 800, 3100)]],
    ["10:30", [pos("SBIN", 0, 800, 3100)]],
  ]);
  assert.equal(steps[0].standing.state, "target-hit");
  assert.equal(steps[0].standing.level, "success");
  assert.match(steps[0].standing.action, /Book what is open now and stop/);
  assert.equal(steps[0].fresh.length, 1);
  assert.equal(steps[2].fresh.length, 0, "flat after the target: not repeated");
  const open = day([
    ["10:00", [pos("SBIN", 100, 800, 3100)]],
    ["10:11", [pos("SBIN", 100, 800, 3200)]],
  ]);
  assert.equal(open[1].fresh.length, 1, "still holding after the target: repeated after ten minutes");
  assert.equal(open[1].fresh[0].repeat, true);
});

test("the daily stop: a danger reminder", () => {
  const [s] = day([["11:00", [pos("RELIANCE", -50, 1300, -1900)]]]);
  assert.equal(s.standing.state, "stop-hit");
  assert.equal(s.standing.level, "danger");
  assert.match(s.standing.action, /Close what is open/);
});

test("giving profits back: once the day was up 1%, falling below half of the best raises a reminder, repeated while it holds", () => {
  const steps = day([
    ["09:40", [pos("SBIN", 100, 800, 1500)]], // up 1.5%: protection starts
    ["10:00", [pos("SBIN", 100, 800, 2400)]], // the day's best
    ["10:20", [pos("SBIN", 100, 800, 1500)]], // kept 62%: protect mode, no reminder
    ["10:40", [pos("SBIN", 100, 800, 1000)]], // kept 42%: giveback
    ["10:45", [pos("SBIN", 100, 800, 900)]], // still: no repeat yet
    ["10:51", [pos("SBIN", 100, 800, 900)]], // ten minutes later: repeated
  ]);
  assert.equal(steps[1].standing.peak, 2400);
  assert.equal(steps[2].standing.state, "protect");
  assert.equal(steps[2].standing.floor, 1200);
  assert.equal(steps[3].standing.state, "giveback");
  assert.equal(steps[3].standing.gaveBackPct, 58);
  assert.match(steps[3].fresh[0].text, /Keep at least ₹1,200/);
  assert.equal(steps[4].fresh.filter((e) => e.kind === "giveback").length, 0);
  assert.equal(steps[5].fresh.filter((e) => e.kind === "giveback").length, 1);
});

test("a green day turning red is called out — the habit the owner named", () => {
  const steps = day([
    ["10:00", [pos("SBIN", 100, 800, 2000)]],
    ["13:00", [pos("SBIN", 100, 800, -300)]],
  ]);
  assert.equal(steps[1].standing.state, "red-after-green");
  assert.match(steps[1].standing.text, /You were up ₹2,000 today and are now −₹300/);
  assert.match(steps[1].standing.action, /Do not try to win it back/);
});

test("close to the target: a reminder to trail and book, not to add", () => {
  const [s] = day([["10:00", [pos("SBIN", 100, 800, 2500)]]]);
  assert.equal(s.standing.state, "near-target");
  assert.match(s.standing.action, /Do not add new trades/);
});

test("a position that gave back half its best gain: a reminder with the price that keeps the other half", () => {
  const steps = day([
    ["10:00", [pos("TATASTEEL", 1000, 150, 1200), pos("SBIN", 100, 800, 0)]],
    ["10:30", [pos("TATASTEEL", 1000, 150, 500), pos("SBIN", 100, 800, 0)]],
  ]);
  const a = steps[1].standing.positions;
  assert.equal(a.length, 1);
  assert.equal(a[0].symbol, "TATASTEEL");
  assert.equal(a[0].peak, 1200);
  assert.equal(a[0].keepPrice, 150.6, "average 150 + half of ₹1,200 over 1,000 shares");
  assert.ok(steps[1].fresh.some((e) => e.kind === "position-giveback" && e.symbol === "TATASTEEL"));
  const short = day([
    ["10:00", [pos("RELIANCE", -100, 1300, 1000)]],
    ["10:30", [pos("RELIANCE", -100, 1300, 300)]],
  ])[1].standing.positions[0];
  assert.equal(short.keepPrice, 1295, "a short keeps half below its average");
});

test("a new day starts fresh; switched off, nothing is raised; settings are held within limits", () => {
  const off = cleanDiscipline({ enabled: false });
  const [s] = day([["10:00", [pos("SBIN", 100, 800, -2000)]]], off);
  assert.equal(s.standing.state, "stop-hit");
  assert.equal(s.fresh.length, 0);
  const odd = cleanDiscipline({ targetPct: 90, stopPct: -3, keepPct: 200 });
  assert.equal(odd.targetPct, 20);
  assert.equal(odd.stopPct, 0.25);
  assert.equal(odd.keepPct, 95);
  const first = assess({ cfg, day: null, now: at("10:00"), funds: funds(), positions: { net: [pos("SBIN", 100, 800, 2000)] } });
  const next = assess({ cfg, day: first.day, now: Date.parse("2026-11-17T09:20:00+05:30"), funds: funds(200000), positions: { net: [] } });
  assert.equal(next.standing.peak, 0);
  assert.equal(next.standing.base, 200000);
  const none = assess({ cfg, day: null, now: at("10:00"), funds: null, positions: { net: [] } });
  assert.equal(none.standing.available, false);
});

test("the watcher looks only in NSE hours while Zerodha is connected, and never trades", async () => {
  const { DisciplineWatch } = require("../discipline-watch");
  let asked = 0;
  const trading = { status: () => ({ connected: true }), _discipline: () => ({ enabled: true }), disciplineStatus: async () => (asked += 1, { state: "ok" }) };
  const night = new DisciplineWatch({ trading, now: () => Date.parse("2026-11-16T20:00:00+05:30") });
  assert.equal(await night.tick(), null);
  const day = new DisciplineWatch({ trading, now: () => Date.parse("2026-11-16T11:00:00+05:30") });
  assert.deepEqual(await day.tick(), { state: "ok" });
  assert.equal(asked, 1);
  const off = new DisciplineWatch({ trading: { ...trading, status: () => ({ connected: false }) }, now: () => Date.parse("2026-11-16T11:00:00+05:30") });
  assert.equal(await off.tick(), null);
  assert.equal(Object.keys(trading).some((k) => /place|order|exit/i.test(k)), false, "it is handed no way to trade");
});
