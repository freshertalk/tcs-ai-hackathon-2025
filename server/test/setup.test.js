"use strict";
// The trade setup: the fifteen readings worked out from Zerodha and NSE by the desk itself — pivots, option writing, PCR, VIX,
// flows, build-ups, delivery, the F&O ban — the lean made from them, recorded and scored; kept fresh by its own schedule.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("../market/setup");
const { TradeSetup, SECTION, BAN_URL, FLOW_URL } = require("../setup");
const { FileDocs } = require("../docs");

const quiet = { log() {}, error() {} };
const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00Z`) - IST;

test("pivots and key levels: the floor-trader formulas, the nearest supports and resistances, the option walls", () => {
  const p = S.pivots({ h: 110, l: 90, c: 100 });
  assert.deepEqual([p.pivot, p.r1, p.s1, p.r2, p.s2, p.r3, p.s3], [100, 110, 90, 120, 80, 130, 70]);
  assert.equal(S.pivots({ h: 1, l: 2, c: 1 }), null, "a high below the low is not a session");
  const k = S.keyLevels({ name: "NIFTY 50", prev: { h: 110, l: 90, c: 100 }, spot: 104, chain: { available: true, support: { strike: 95 }, resistance: { strike: 115 }, maxPain: 100 } });
  assert.equal(k.side, "above");
  assert.deepEqual(k.supports.map((x) => x.name), ["Pivot", "S1", "S2"]);
  assert.deepEqual(k.resistances.map((x) => x.name), ["R1", "R2", "R3"]);
  assert.deepEqual(k.walls, { put: 95, call: 115, maxPain: 100 });
  assert.match(k.read, /NIFTY 50 above its pivot ₹100: support ₹100 \(Pivot\), ₹90 \(S1\); resistance ₹110 \(R1\), ₹120 \(R2\); option walls: puts at 95, calls at 115\./);
});

test("options data: most OI, most added and most shed, for calls and for puts", () => {
  const chain = {
    available: true,
    expiry: "2026-11-25",
    lot: 75,
    rows: [
      { strike: 26000, ce: { oi: 900000, oiChange: 300000 }, pe: { oi: 2000000, oiChange: 500000 } },
      { strike: 26100, ce: { oi: 1500000, oiChange: -200000 }, pe: { oi: 800000, oiChange: -100000 } },
      { strike: 26200, ce: { oi: 2500000, oiChange: 700000 }, pe: { oi: 300000, oiChange: 20000 } },
    ],
  };
  const c = S.optionSide(chain, "ce");
  assert.deepEqual(c.maxOi.map((x) => x.strike), [26200, 26100, 26000]);
  assert.equal(c.maxOi[0].lots, 33333);
  assert.deepEqual(c.maxAdded.map((x) => x.strike), [26200, 26000]);
  assert.deepEqual(c.maxShed.map((x) => x.strike), [26100]);
  assert.match(c.read, /Most call OI at 26200, 26100, 26000; most call writing \(OI added\) at 26200, 26000; most call unwinding at 26100 — calls written are a ceiling above\./);
  const p = S.optionSide(chain, "pe");
  assert.equal(p.maxOi[0].strike, 26000);
  assert.match(p.read, /puts written are a floor below/);
  assert.equal(S.optionSide({ available: false }, "ce"), null);
});

test("build-ups: price against open interest for every future, the four lists strongest first, and the breadth", () => {
  const rows = [
    { symbol: "AAA", last: 105, prevClose: 100, oi: 1200, prevOi: 1000 }, // long build-up, OI +20%
    { symbol: "BBB", last: 102, prevClose: 100, oi: 1050, prevOi: 1000 }, // long build-up, OI +5%
    { symbol: "CCC", last: 95, prevClose: 100, oi: 1300, prevOi: 1000 }, // short build-up
    { symbol: "DDD", last: 101, prevClose: 100, oi: 900, prevOi: 1000 }, // short covering
    { symbol: "EEE", last: 99, prevClose: 100, oi: 950, prevOi: 1000 }, // long unwinding
    { symbol: "FFF", last: 100, prevClose: 100, oi: 1000, prevOi: 1000 }, // no change: no build-up
    { symbol: "GGG", last: 100, prevClose: 100, oi: 1000, prevOi: null }, // no earlier OI: not known
  ];
  const b = S.buildups(rows);
  assert.equal(b.known, 6);
  assert.deepEqual(b.counts, { "long build-up": 2, "long unwinding": 1, "short build-up": 1, "short covering": 1 });
  assert.deepEqual(b.lists["long build-up"].map((x) => x.symbol), ["AAA", "BBB"], "the biggest OI change first");
  assert.equal(b.lists["long build-up"][0].oiChangePct, 20);
  assert.equal(b.breadth, 0.25, "(2 + 0.5 − 1 − 0.5) ÷ (2 + 0.5 + 1 + 0.5)");
  assert.equal(b.all.CCC.kind, "short build-up");
});

test("NSE's files: the FII/DII report and the ban list", () => {
  const f = S.flowsOf([{ buyValue: "18,492.63", category: "DII", date: "20-Nov-2026", netValue: "-4859.8", sellValue: "23352.43" }, { buyValue: "23596.4", category: "FII/FPI", date: "20-Nov-2026", netValue: "10308.42", sellValue: "13287.98" }]);
  assert.deepEqual(f, { date: "20-Nov-2026", fii: { buy: 23596.4, sell: 13287.98, net: 10308.42 }, dii: { buy: 18492.63, sell: 23352.43, net: -4859.8 } });
  assert.equal(S.flowsOf({}), null);
  assert.deepEqual(S.banOf("Securities in Ban For Trade Date 23-NOV-2026:\n1,MANAPPURAM\n2,SAIL\n"), { date: "2026-11-23", symbols: ["MANAPPURAM", "SAIL"] });
  assert.deepEqual(S.banOf("Securities in Ban For Trade Date 03-DEC-2026:\n"), { date: "2026-12-03", symbols: [] });
  assert.equal(S.banOf("<html>blocked</html>"), null);
});

test("the setup lean: every reading votes, the reasons are given; a stock's tags carry its build-up and the ban", () => {
  const nifty = S.keyLevels({ name: "NIFTY 50", prev: { h: 110, l: 90, c: 100 }, spot: 108 });
  const build = S.buildups(Array.from({ length: 30 }, (_, i) => ({ symbol: `S${i}`, last: 103, prevClose: 100, oi: 1100, prevOi: 1000 })));
  const up = S.setupLean({ nifty, chain: { available: true, pcr: 1.3, bias: { score: 40, label: "Bullish", votes: [] } }, vix: { last: 13, changePct: -4 }, flows: { date: "x", fii: { net: 3000 }, dii: { net: 1000 } }, build });
  assert.equal(up.label, "Bullish");
  assert.ok(up.score >= 30 && up.agreement === 1, JSON.stringify(up));
  assert.deepEqual(up.votes.map((v) => v.id), ["pivot", "options", "vix", "flows", "breadth"]);
  const down = S.setupLean({ nifty: S.keyLevels({ name: "NIFTY 50", prev: { h: 110, l: 90, c: 100 }, spot: 92 }), vix: { last: 22, changePct: 9 }, flows: { fii: { net: -5000 }, dii: { net: 0 } } });
  assert.ok(down.score <= -30, JSON.stringify(down));
  assert.match(down.votes.find((v) => v.id === "vix").why, /high: expect wide swings/);
  assert.equal(S.setupLean({}).label, "Too few readings yet");
  // one reading alone cannot make a strong lean
  const one = S.setupLean({ flows: { date: "x", fii: { net: 10000 }, dii: { net: 0 } } });
  assert.equal(one.label, "Too few readings yet");
  assert.ok(one.score <= 25 && one.readings === 1, JSON.stringify(one));
  const t = S.stockTags("s3", { build, ban: { symbols: ["S3"] }, delivery: [{ symbol: "S3", delivPct: 70 }] });
  assert.equal(t.live.kind, "long build-up");
  assert.equal(t.banned, true);
  assert.equal(t.highDelivery.delivPct, 70);
  assert.equal(t.score, 1, "a 10% OI build-up is a full unit");
  assert.equal(S.stockTags("ZZZ", {}).score, 0);
});

/** A fake market and NSE: everything the service reads. */
function world() {
  let now = at("2026-11-23", "10:00");
  const reads = { daily: 0, chain: 0, board: 0, futDaily: 0, nse: [] };
  const day = (t, h, l, c) => ({ t, o: c, h, l, c });
  const market = {
    mode: () => "kite",
    async daily(sym) {
      reads.daily += 1;
      const base = sym === "NIFTY 50" ? 26000 : 58000;
      return { candles: [day("2026-11-19", base * 1.01, base * 0.99, base), day("2026-11-20", base * 1.02, base * 0.99, base * 1.01), day("2026-11-23", base * 1.03, base, base * 1.02)] };
    },
    async optionChain(name) {
      reads.chain += 1;
      const spot = name === "NIFTY" ? 26300 : 59000;
      const step = name === "NIFTY" ? 50 : 100;
      return { available: true, expiry: "2026-11-25", daysToExpiry: 2, spot, lot: 75, pcr: 1.24, pcrVol: 1.1, maxPain: spot, support: { strike: spot - 2 * step }, resistance: { strike: spot + 2 * step }, bias: { score: 30, label: "Bullish", votes: [] }, rows: [-2, -1, 0, 1, 2].map((i) => ({ strike: spot + i * step, ce: { oi: 100000 * (3 + i), oiChange: 10000 * i, last: 50 }, pe: { oi: 100000 * (3 - i), oiChange: -10000 * i, last: 50 } })) };
    },
    async context() {
      return { items: [{ id: "nifty", available: true, last: 26300 }, { id: "bank", available: true, last: 59000 }, { id: "vix", available: true, last: 13.2, changePct: -3.5 }] };
    },
    async futuresBoard() {
      reads.board += 1;
      return { available: true, at: new Date(now).toISOString(), expiry: "2026-11-25", rows: ["AAA", "BBB", "CCC", "DDD"].map((s, i) => ({ symbol: s, future: `${s}26NOVFUT`, token: 100 + i, last: [105, 98, 101, 97][i], prevClose: 100, oi: [1300, 1300, 800, 900][i] })) };
    },
    async futureDaily(token) {
      reads.futDaily += 1;
      // the last two finished sessions of each future, with open interest
      return [{ t: "2026-11-19", c: 99, oi: 900 }, { t: "2026-11-20", c: 100, oi: 1000 + (token % 2) * 50 }, { t: "2026-11-23", c: 104, oi: 1200 }];
    },
  };
  const fetchImpl = async (url) => {
    reads.nse.push(url);
    if (url === BAN_URL) return { ok: true, status: 200, text: async () => "Securities in Ban For Trade Date 23-NOV-2026:\n1,CCC\n" };
    if (url === FLOW_URL) return { ok: true, status: 200, json: async () => [{ category: "FII/FPI", date: "20-Nov-2026", netValue: "2500", buyValue: "9000", sellValue: "6500" }, { category: "DII", date: "20-Nov-2026", netValue: "800", buyValue: "7000", sellValue: "6200" }] };
    return { ok: false, status: 404 };
  };
  const delivery = { highDelivery: ({ symbols }) => ({ asOf: "2026-11-20", list: symbols && symbols.includes("BBB") ? [{ symbol: "BBB", delivPct: 68.2, avgDelivPct: 40, vsAvg: 1.71, changePct: 1.2 }] : [] }) };
  return { market, fetchImpl, delivery, reads, setNow: (t) => (now = t), get now() { return now; } };
}

test("the service gathers every reading by itself, shows the fifteen points, and keeps them current on its own schedule", async () => {
  const w = world();
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-setup-")));
  const written = {};
  const svc = new TradeSetup({ market: w.market, delivery: w.delivery, docs, playbook: { setSection: (h, b) => (written[h] = b) }, fetchImpl: w.fetchImpl, now: () => w.now, log: quiet, isTradingDay: () => true });
  await svc.tickOnce();
  const v = svc.view();
  assert.equal(v.available, true);
  assert.equal(v.sessionOn, true);
  // 1–2 key levels from the last FINISHED session (the 20th: today's candle is still forming)
  assert.equal(v.nifty.basedOn, "2026-11-20");
  assert.equal(v.nifty.prevClose, 26260);
  assert.equal(v.nifty.spot, 26300);
  assert.equal(v.bank.name, "NIFTY BANK");
  // 3–6 options
  assert.equal(v.options.niftyCalls.maxOi[0].strike, 26400);
  assert.equal(v.options.niftyPuts.maxOi[0].strike, 26200);
  assert.equal(v.options.bankCalls.maxAdded[0].strike, 59200);
  // 7–9
  assert.equal(v.flows.fii.net, 2500);
  assert.equal(v.pcr.nifty, 1.24);
  assert.equal(v.vix.last, 13.2);
  // 10–13: now, against each future's open interest at the last close (from Kite's daily history)
  assert.ok(v.build, "build-ups now");
  assert.equal(v.build.all.AAA.kind, "long build-up");
  assert.equal(v.build.all.BBB.kind, "short build-up");
  assert.equal(v.build.all.CCC.kind, "short covering");
  assert.equal(v.build.all.DDD.kind, "long unwinding");
  assert.ok(v.prevBuild && v.prevBuild.known === 4, "and the last session's own (the 20th against the 19th)");
  assert.equal(w.reads.futDaily, 4, "once per future");
  // 14–15
  assert.equal(v.delivery[0].symbol, "BBB");
  assert.deepEqual(v.ban, { date: "2026-11-23", symbols: ["CCC"] });
  // the lean, with its reasons
  assert.ok(["Bullish", "Mildly bullish", "Neutral", "Mildly bearish", "Bearish"].includes(v.lean.label));
  assert.ok(v.lean.votes.length >= 4);
  // a stock's tags and the brief for the AI
  const t = svc.forStock("CCC");
  assert.equal(t.banned, true);
  assert.equal(t.live.kind, "short covering");
  const b = svc.brief();
  assert.deepEqual(b.fnoBan, ["CCC"]);
  assert.match(b.highDelivery[0], /^BBB 68.2% \(1.71× avg, \+1.2%\)$/);
  assert.ok(b.buildNow.top["long build-up"][0].startsWith("AAA +5%"));
  // its own schedule: nothing is read again before it is due; the futures' daily OI is read once a day
  const before = { ...w.reads, nse: w.reads.nse.length };
  w.setNow(w.now + 30000);
  await svc.tickOnce();
  assert.equal(w.reads.board, before.board, "the board waits its two minutes");
  w.setNow(w.now + 2 * 60000);
  await svc.tickOnce();
  assert.equal(w.reads.board, before.board + 1, "…then reads again by itself");
  assert.equal(w.reads.futDaily, 4, "the daily OI is not read again the same day");
  assert.equal(w.reads.nse.filter((u) => u === BAN_URL).length, 1, "today's ban list is read once");
  // the skills file is taught
  assert.match(written[SECTION], /Setup lean: /);
  assert.match(written[SECTION], /F&O ban today: CCC/);
  // a restart shows the last readings at once (they are saved)
  const again = new TradeSetup({ market: w.market, docs, now: () => w.now, log: quiet, isTradingDay: () => true });
  assert.equal(again.view().nifty.basedOn, "2026-11-20");
});

test("the lean is written down at 9:14 and scored after the close against NIFTY's day; a failed read keeps the last good one", async () => {
  const w = world();
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-setup-")));
  const svc = new TradeSetup({ market: w.market, delivery: w.delivery, docs, fetchImpl: w.fetchImpl, now: () => w.now, log: quiet, isTradingDay: () => true });
  w.setNow(at("2026-11-23", "09:14"));
  await svc.tickOnce();
  const day = svc.record().last[0];
  assert.equal(day.date, "2026-11-23");
  assert.ok(typeof day.score === "number");
  w.setNow(at("2026-11-23", "15:40"));
  await svc.tickOnce();
  const r = svc.record();
  const d = r.last[0];
  assert.equal(d.changePct, 0.99, "NIFTY closed 26,520 against 26,260");
  if (Math.abs(d.score) >= 12) {
    assert.equal(r.called, 1);
    assert.equal(d.right, d.score > 0);
  } else assert.equal(d.right, null, "a neutral lean is not called");
  // NSE refuses: the last good flows stay, and the failure is reported
  const flows = svc.view().flows;
  svc.fetch = async () => ({ ok: false, status: 403 });
  svc.due.flows = 0;
  w.setNow(w.now + 31 * 60000);
  await svc.tickOnce();
  assert.deepEqual(svc.view().flows, flows);
  assert.match(svc.view().errors.flows, /HTTP 403/);
});
