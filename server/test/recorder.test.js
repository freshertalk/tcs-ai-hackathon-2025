"use strict";
// The market recorder: the readings (pure), recording a session by itself, carrying on after a restart, and learning what
// the order book and open interest add to the forecaster — out of sample, used only on proof.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const T = require("../market/tapeflow");
const { Recorder, MIN_EVIDENCE } = require("../recorder");
const { FileDocs } = require("../docs");

const quiet = { log() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vpt-rec-"));
const IST = 5.5 * 3600000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const STOCKS = Array.from({ length: 12 }, (_, i) => `STK${i}`);

/** A market stand-in: connected, one quote request answers for everything asked, with futures for every stock. */
function fakeMarket({ connected = true, book = () => [1000, 1000], oi = () => 5000 } = {}) {
  const m = {
    calls: 0,
    connected,
    mode: () => (m.connected ? "kite" : "none"),
    watchlist: () => ["STK0", "EXTRA"],
    derivatives: async () =>
      [...STOCKS, "EXTRA", "NIFTY", "BANKNIFTY"].flatMap((n) => [
        { s: `${n}26DECFUT`, n, e: "2026-12-29", y: "FUT" },
        { s: `${n}26NOVFUT`, n, e: "2026-11-26", y: "FUT" },
        { s: `${n}26NOV100CE`, n, e: "2026-11-26", y: "CE" },
      ]),
    _call: async (fn) =>
      fn({
        quotes: async (keys) => {
          m.calls += 1;
          m.lastKeys = keys;
          const out = {};
          for (const k of keys) {
            const sym = k.split(":")[1];
            if (k.startsWith("NFO:"))
              out[k] = {
                last: 101,
                volume: 900,
                oi: oi(sym.replace("26NOVFUT", ""), m.calls),
              };
            else {
              const [b, s] = book(sym, m.calls);
              out[k] = {
                last: 100 + m.calls * 0.1,
                volume: 1000 * m.calls,
                avgPrice: 100,
                buyQty: b,
                sellQty: s,
              };
            }
          }
          return out;
        },
      }),
  };
  return m;
}

test("the readings: imbalance, its change, the market's own, and the four open-interest quadrants", () => {
  const day = T.emptyDay("2026-11-19", ["AAA", ...STOCKS]);
  for (let slot = 0; slot <= 30; slot += 1) {
    const eq = {
      AAA: {
        last: 100 + slot * 0.2,
        volume: slot * 100,
        avgPrice: 100,
        buyQty: 3000,
        sellQty: 1000,
      },
    };
    for (const s of STOCKS)
      eq[s] = {
        last: 50,
        volume: 10,
        avgPrice: 50,
        buyQty: 1000,
        sellQty: 1000,
      };
    T.putSnapshot(day, slot, eq, { AAA: { last: 100.5 + slot * 0.2, volume: 5, oi: 10000 + slot * 20 } }, "x");
  }
  assert.equal(day.taken, 31);
  const mkt = T.marketImb(day);
  assert.ok(Math.abs(mkt[20] - 0.5 / 13) < 1e-9, "the market's imbalance is the average over the stocks read");
  const z = T.featuresAt(day, "AAA", 20, mkt);
  assert.equal(z[T.FLOW.indexOf("imb")], 0.5);
  assert.equal(z[T.FLOW.indexOf("dImb")], 0);
  assert.ok(z[T.FLOW.indexOf("imbRel")] > 0.4);
  assert.ok(z[T.FLOW.indexOf("oi15")] > 0, "open interest rose over fifteen minutes");
  assert.ok(z[T.FLOW.indexOf("build")] > 0 && z[T.FLOW.indexOf("cover")] === 0, "price up with open interest up is a long build-up");
  const d = T.describe(day, "AAA", 20, mkt);
  assert.equal(d.buyShare, 0.75);
  assert.equal(d.position, "long build-up");
  assert.equal(d.at, "09:35");
  // a stock whose book was not read has no readings; one with no future has neutral open-interest readings
  assert.equal(T.featuresAt(day, "NOPE", 20, mkt), null);
  assert.equal(T.featuresAt(day, "STK1", 20, mkt)[T.FLOW.indexOf("oi15")], 0);
  // packed and unpacked it is the same day; the spreadsheet has one line per stock per minute read
  const back = T.unpackDay(JSON.parse(JSON.stringify(T.packDay(day))));
  assert.deepEqual(back.cols.AAA.b.slice(0, 31), day.cols.AAA.b.slice(0, 31));
  assert.equal(back.taken, 31);
  const lines = T.dayCsv(day).trim().split("\n");
  assert.equal(lines.length, 1 + 13 * 31);
  assert.match(lines[1], /^2026-11-19,09:15,AAA,100,0,100,3000,1000,,100\.5,5,10000$/);
  assert.equal(T.slotOf(at("2026-11-19", "09:15")), 0);
  assert.equal(T.slotOf(at("2026-11-19", "15:30")), 375);
  assert.equal(T.slotOf(at("2026-11-19", "15:31")), -1);
});

test("it records by itself: one request a minute for every stock, future and index; saved, and carried on after a restart", async () => {
  const dir = tmp();
  const docs = new FileDocs(dir);
  const market = fakeMarket();
  let now = at("2026-11-19", "09:14");
  const mk = () =>
    new Recorder({
      market,
      docs,
      universe: () => STOCKS,
      now: () => now,
      log: quiet,
    });
  let rec = mk();
  await rec.tickOnce();
  assert.equal(market.calls, 0, "nothing is read before 9:15");
  assert.equal(rec.status().state, "closed");

  now = at("2026-11-19", "09:15") + 5000;
  await rec.tickOnce();
  await rec.tickOnce(); // the same minute is read once
  assert.equal(market.calls, 1);
  // 3 indices + 12 stocks + EXTRA from the watchlist, and a near-month future for all but India VIX
  assert.equal(market.lastKeys.filter((k) => k.startsWith("NSE:")).length, 16);
  assert.ok(market.lastKeys.includes("NFO:STK326NOVFUT") && market.lastKeys.includes("NFO:NIFTY26NOVFUT") && !market.lastKeys.some((k) => /DECFUT|CE$/.test(k)), "the nearest future, never a later one or an option");
  for (let i = 1; i <= 6; i += 1) {
    now = at("2026-11-19", "09:15") + i * 60000 + 5000;
    await rec.tickOnce();
  }
  const st = rec.status();
  assert.equal(st.state, "recording");
  assert.equal(st.today.taken, 7);
  assert.equal(st.today.stocks, 13);
  assert.equal(st.stored.sessions, 1, "saved to the shelf during the session");
  assert.equal((await docs.coldList("market_tape"))[0].id, "2026-11-19");

  // a restart in the middle of the session: the morning is read back, and recording carries on
  await rec.stop();
  rec = mk();
  now = at("2026-11-19", "09:25") + 5000;
  await rec.tickOnce();
  assert.equal(rec.status().today.taken, 8);
  assert.equal(rec.day.cols.STK0.p[0], 100.1, "the first minute is still there");
  assert.equal(rec.day.cols.STK0.oi[10], 5000);
  const flow = rec.tiltFor("STK0", at("2026-11-19", "09:25"));
  assert.equal(flow.read.buyShare, 0.5);
  assert.equal(flow.on, false, "nothing is used before it is proven");
  assert.equal(flow.tilts, null);

  // not connected during the session: it says so, and reads nothing
  market.connected = false;
  now = at("2026-11-19", "09:26") + 5000;
  const before = market.calls;
  await rec.tickOnce();
  assert.equal(market.calls, before);
  assert.equal(rec.status().state, "needs-zerodha");

  // after the close it stands by; the day is on the shelf and downloadable as a spreadsheet
  market.connected = true;
  now = at("2026-11-19", "15:40");
  await rec.tickOnce();
  assert.equal(rec.status().state, "closed");
  const csv = await rec.csv("2026-11-19");
  assert.match(csv.split("\n")[0], /^date,time,symbol,price,day_volume,avg_price,buy_qty_waiting,sell_qty_waiting,future,future_price,future_volume,open_interest$/);
  assert.ok(csv.includes("2026-11-19,09:15,STK0,100.1,1000,100,1000,1000,STK026NOVFUT,101,900,5000"));
  assert.equal(await rec.csv("2026-11-18"), null);

  // a weekend: nothing is read even when connected
  now = at("2026-11-21", "10:00");
  const c2 = market.calls;
  await rec.tickOnce();
  assert.equal(market.calls, c2);
  assert.equal(rec.day, null);
  // the index is rebuilt from the shelf when it is lost
  docs.remove("market/tape-index.json");
  const fresh = mk();
  assert.equal(await fresh.reindex(), 1);
  assert.equal(fresh.status().stored.sessions, 1);
});

/** Record whole sessions quickly: every stock's book leans one way in each half-hour, by a pattern the outcome will follow. */
async function recordDays(docs, dates, lean) {
  for (const date of dates) {
    const day = T.emptyDay(date, STOCKS);
    for (let slot = 0; slot < T.SLOTS; slot += 1) {
      const eq = {};
      STOCKS.forEach((s, i) => {
        const l = lean(date, i, slot);
        eq[s] = {
          last: 100,
          volume: slot,
          avgPrice: 100,
          buyQty: Math.round(1000 * (1 + l)),
          sellQty: Math.round(1000 * (1 - l)),
        };
      });
      T.putSnapshot(day, slot, eq, {}, new Date(at(date, "09:15") + slot * 60000).toISOString());
    }
    const packed = T.packDay(day);
    await docs.coldPut("market_tape", date, packed);
    const idx = docs.read("market/tape-index.json", null) || { days: {} };
    idx.days[date] = {
      date,
      symbols: STOCKS.length,
      futures: 0,
      taken: day.taken,
      bytes: packed.z.length,
      first: day.first,
      last: day.last,
    };
    docs.write("market/tape-index.json", idx);
  }
}

test("it learns what the order book adds — scored before it is learned, and used only once that is proven", async () => {
  const dir = tmp();
  const docs = new FileDocs(dir);
  const dates = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"];
  const lean = (date, i, slot) => Math.sin((Date.parse(date) / 86400000 + i * 7 + Math.floor(slot / 5)) * 1.7) * 0.6;
  await recordDays(docs, dates, lean);
  // the forecaster stand-in: its call is always 0, and what really happened follows the book's lean (plus noise it cannot know)
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const horizon = {
    to: "2026-11-13",
    storedTo() {
      return this.to;
    },
    async replay(ds, each) {
      let n = 0;
      for (const date of ds) {
        STOCKS.forEach((s, i) => {
          const rows = [];
          // many rows a bar, so the test reaches the evidence the recorder asks for without a hundred stocks
          for (let rep = 0; rep < 40; rep += 1) {
            for (let bar = 1; bar < 70; bar += 1) {
              const t = at(date, "09:15") + bar * 5 * 60000;
              const l = lean(date, i, bar * 5 + 5);
              const y = new Float64Array(11).fill(0);
              for (let k = 0; k < 5; k += 1) y[k] = 0.4 * l + rnd();
              rows.push({ t, s: bar, y, p: new Float64Array(11) });
            }
          }
          n += rows.length;
          each(s, date, rows);
        });
      }
      return n;
    },
  };
  const wrote = [];
  const rec = new Recorder({
    market: fakeMarket({ connected: false }),
    docs,
    universe: () => STOCKS,
    horizon,
    playbook: { setSection: (h, b) => wrote.push([h, b]) },
    now: () => at("2026-11-18", "18:00"),
    log: quiet,
  });
  assert.deepEqual(rec.pendingDates(), ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"], "only the sessions the price history covers");
  assert.equal(rec.behind(), 4);
  const r = await rec.learn({ trigger: "test" });
  assert.equal(r.days, 4);
  let st = rec.status().learner;
  assert.equal(st.days, 4);
  assert.equal(st.lastDate, "2026-11-13");
  assert.ok(st.evidence >= MIN_EVIDENCE, `enough forecasts were scored out of sample (${st.evidence})`);
  assert.ok(st.gain15 > 0.01, `the lean explained part of the miss on sessions the weights had not seen (${st.gain15})`);
  assert.equal(st.on, true);
  assert.ok(st.drivers.length && st.drivers.some((d) => /waiting to buy|leaned to buyers/.test(d.text)));
  assert.match(st.lessons.join(" "), /IN USE/);
  assert.equal(docs.items("tape_learning").length, 1);
  assert.match(wrote[0][0], /order book and open interest/);
  assert.equal(rec.behind(), 0);

  // live: the same lean now moves the forecast a little, the same way; nothing changes for a stock it did not read
  const m = rec.model();
  const up = T.tiltsOf(m.W, Float64Array.from([0.6, 0, 0.6, 0.6, 0, 0, 0, 0, 0, 0]));
  const down = T.tiltsOf(m.W, Float64Array.from([-0.6, 0, -0.6, -0.6, 0, 0, 0, 0, 0, 0]));
  assert.ok(up[2] > 0.05 && down[2] < -0.05 && up[2] <= 0.5, "a correction, held small");

  // the next sessions arrive, and this time the book says nothing about the outcome: the evidence fades and it goes out of use
  horizon.to = "2026-11-17";
  const noise = {
    ...horizon,
    replay: async (ds, each) =>
      horizon.replay(ds, (s, d, rows) =>
        each(
          s,
          d,
          rows.map((row) => ({ ...row, y: row.y.map(() => rnd() * 3) })),
        ),
      ),
  };
  rec.horizon = noise;
  // unrelated outcomes, several times the weight of what was learned, by learning those sessions again and again
  for (let i = 0; i < 3 && rec.model().on; i += 1) {
    const mm = rec.model();
    mm.lastDate = "2026-11-13";
    rec._saveModel(mm);
    await rec.learn({ trigger: "test" });
  }
  st = rec.status().learner;
  assert.ok(st.gain15 < 0.01, "the gain shrank once the readings stopped helping");
});

test("too little recorded, or no forecaster: nothing is learned and nothing is claimed", async () => {
  const docs = new FileDocs(tmp());
  const day = T.emptyDay("2026-11-12", STOCKS);
  T.putSnapshot(day, 3, Object.fromEntries(STOCKS.map((s) => [s, { last: 10, volume: 1, avgPrice: 10, buyQty: 5, sellQty: 5 }])), {}, "x");
  await docs.coldPut("market_tape", "2026-11-12", T.packDay(day));
  docs.write("market/tape-index.json", {
    days: {
      "2026-11-12": {
        date: "2026-11-12",
        symbols: 12,
        futures: 0,
        taken: 1,
        bytes: 10,
      },
    },
  });
  const none = new Recorder({
    market: fakeMarket(),
    docs,
    universe: () => STOCKS,
    now: () => at("2026-11-13", "18:00"),
    log: quiet,
  });
  assert.deepEqual(none.pendingDates(), []);
  assert.equal(none.status().learner.available, false);
  let asked = 0;
  const rec = new Recorder({
    market: fakeMarket(),
    docs,
    universe: () => STOCKS,
    horizon: {
      storedTo: () => "2026-11-12",
      replay: async () => {
        asked += 1;
        return 0;
      },
    },
    now: () => at("2026-11-13", "18:00"),
    log: quiet,
  });
  const r = await rec.learn();
  assert.equal(r.days, 0);
  assert.equal(asked, 0, "a session with one minute read is passed over without asking the forecaster");
  const l = rec.status().learner;
  assert.deepEqual(l.skipped, ["2026-11-12"]);
  assert.equal(l.on, false);
  assert.match(l.lessons.join(" "), /Too few recorded forecasts/);
  assert.equal(rec.behind(), 0, "and it is not tried again for ever");

  // the forecaster has no model just now (a first start, or it is retraining): recorded sessions WAIT — none is passed over
  const docs2 = new FileDocs(tmp());
  await recordDays(docs2, ["2026-11-12"], () => 0.2);
  let ready = false;
  const waits = new Recorder({
    market: fakeMarket(),
    docs: docs2,
    universe: () => STOCKS,
    horizon: {
      ready: () => ready,
      storedTo: () => "2026-11-12",
      replay: async () => assert.fail("not asked while it has no model"),
    },
    now: () => at("2026-11-13", "18:00"),
    log: quiet,
  });
  assert.deepEqual(waits.pendingDates(), []);
  assert.equal((await waits.learn()).days, 0);
  assert.equal(waits.model().lastDate, "", "nothing was marked as done");
  ready = true;
  assert.deepEqual(waits.pendingDates(), ["2026-11-12"], "it is learned as soon as the forecaster can make a call again");
});
