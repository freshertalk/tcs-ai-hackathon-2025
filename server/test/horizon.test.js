"use strict";
// The 15-minute forecaster: the arithmetic learns a planted pattern and is honest about it, the service trains on a
// stored history, forecasts at least 15 minutes ahead, scores its own forecasts and learns each new day.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const H = require("../market/horizon");
const { Horizon } = require("../horizon");
const { FileDocs } = require("../docs");
const { pack } = require("../robot/history");

const IST = 5.5 * 3600 * 1000;
const quiet = { log() {}, error() {} };
const mkdocs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-horizon-")));

// a small seeded random generator and normal draws
function rng(seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}
const weekdays = (from, n) => {
  const out = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  while (out.length < n) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
};
const openMs = (date) => Date.parse(`${date}T09:15:00Z`) - IST;

/**
 * Sessions with a planted pattern: each 5-minute return follows the one before it (momentum, phi), plus a market
 * factor shared by all stocks, plus noise. Returns Map date → market factor array too.
 */
function world(dates, nStocks, { phi = 0.35, seed = 7, phiOf = null } = {}) {
  const R = rng(seed);
  const mkt = new Map();
  for (const d of dates) mkt.set(d, Array.from({ length: 75 }, () => 0.0006 * R.n()));
  const stocks = [];
  for (let s = 0; s < nStocks; s += 1) {
    const beta = 0.6 + 0.8 * R.u();
    const base = 100 + s * 37;
    let close = base;
    const days = [];
    for (const d of dates) {
      const gap = 0.003 * R.n();
      let price = close * (1 + gap);
      let prev = 0;
      const bars = [];
      for (let i = 0; i < 75; i += 1) {
        const r = (phiOf ? phiOf(i) : phi) * prev + beta * mkt.get(d)[i] + 0.0011 * R.n();
        prev = r;
        const o = price;
        price *= 1 + r;
        const hi = Math.max(o, price) * (1 + Math.abs(0.0004 * R.n()));
        const lo = Math.min(o, price) * (1 - Math.abs(0.0004 * R.n()));
        bars.push({ t: openMs(d) + i * 300000, o, h: hi, l: lo, c: price, v: Math.round(100000 * Math.exp(0.4 * R.n())) });
      }
      days.push([d, bars]);
      close = price;
    }
    stocks.push({ symbol: `T${String(s).padStart(2, "0")}`, days });
  }
  return { stocks, mkt };
}
const flat = (days) => days.flatMap(([, bars]) => bars);

function fakeHistory(stocks) {
  const by = new Map(stocks.map((s) => [s.symbol, flat(s.days)]));
  return {
    record: (s) => (by.has(s) ? { id: s } : null),
    bars: (s) => by.get(s) || [],
    status: () => ({ stocks: by.size, expected: by.size, sessions: Math.max(...stocks.map((s) => s.days.length)), to: stocks[0].days[stocks[0].days.length - 1][0] }),
    needs: () => [],
    sync: async () => ({}),
    append: (s, bars) => by.set(s, by.get(s).concat(bars)),
  };
}

test("ridge sums add: fitting two halves together equals fitting all at once; the model finds a planted momentum", () => {
  const dates = weekdays("2026-01-05", 90);
  const w = world(dates, 12);
  const mk = H.marketFromStocks(w.stocks.map((s) => s.days));
  const all = new H.Stats();
  const a = new H.Stats();
  const b = new H.Stats();
  for (const s of w.stocks) {
    const prof = H.buildProfile(s.days, mk);
    assert.ok(prof && prof.sigma > 0.0008 && prof.sigma < 0.003, "its usual 5-minute move is measured");
    for (let d = 1; d < s.days.length; d += 1) {
      const ctx = { sigma: prof.sigma, day: prof.day, beta: prof.beta, vol: prof.vol, prevClose: H.cleanBars(s.days[d - 1][1]).pop().c, prevDayRet: 0, trend: 0, mkt: mk.get(s.days[d][0]) };
      for (const row of H.dayRows(s.days[d][1], ctx, { stride: 2 })) {
        all.add(row.x, row.y, 1);
        (d % 2 ? a : b).add(row.x, row.y, 1);
      }
    }
  }
  const merged = new H.Stats().merge(a).merge(b);
  const Wa = H.fit(all);
  const Wm = H.fit(merged);
  assert.ok(Wa && Wm);
  for (let k = 0; k < H.T; k += 1) for (let j = 0; j < H.D; j += 1) assert.ok(Math.abs(Wa[k][j] - Wm[k][j]) < 1e-4, `the sums add up (${k},${j})`);
  const k3 = H.tIndex("r3");
  // momentum: the last bar's move (r1) pushes the next 15 minutes the same way
  assert.ok(Wa[k3][H.FEATURES.indexOf("r1")] > 0.2, `r1 weight ${Wa[k3][1]}`);
  // the sums survive saving and loading
  const back = H.Stats.from(JSON.parse(JSON.stringify(all.toJSON())));
  const Wb = H.fit(back);
  assert.ok(Math.abs(Wb[k3][1] - Wa[k3][1]) < 1e-4);
});

test("a model fitted on the older sessions beats 'no move' on newer ones, and its stated probabilities hold", () => {
  const dates = weekdays("2026-01-05", 130);
  const w = world(dates, 20);
  const mk = H.marketFromStocks(w.stocks.map((s) => s.days));
  const cut = dates[95];
  const train = new H.Stats();
  const val = [];
  for (const s of w.stocks) {
    const prof = H.buildProfile(s.days, mk);
    for (let d = 1; d < s.days.length; d += 1) {
      const date = s.days[d][0];
      const ctx = { sigma: prof.sigma, day: prof.day, beta: prof.beta, vol: prof.vol, prevClose: H.cleanBars(s.days[d - 1][1]).pop().c, prevDayRet: 0, trend: 0, mkt: mk.get(date) };
      for (const row of H.dayRows(s.days[d][1], ctx, { stride: 2 })) (date <= cut ? train.add(row.x, row.y, 1) : val.push(row));
    }
  }
  const W = H.fit(train);
  assert.ok(W, "enough examples");
  let ev = H.scoreRows(H.emptyEval(), W, val, { keepZ: false });
  const resSd = H.resSdOf(ev);
  ev = H.scoreRows(H.emptyEval(), W, val, { resSd, keepZ: true });
  const z70 = H.z70Of(ev);
  const fin = H.scoreRows(H.emptyEval(), W, val, { resSd, z70, keepZ: false });
  const sum = H.summariseEval(fin);
  const h3 = sum.find((x) => x.h === 3);
  assert.ok(h3.dirAcc > 0.56, `direction ${h3.dirAcc}`);
  assert.ok(h3.skill > 0.01, `skill ${h3.skill}`);
  assert.ok(h3.missPct < h3.naivePct, "closer than 'no move'");
  assert.ok(h3.coverage > 0.62 && h3.coverage < 0.78, `the 70% band held ${h3.coverage}`);
  // the stronger the stated lean, the more often it was right
  const bins = h3.bins.filter((b) => b.calls >= 200);
  assert.ok(bins.length >= 2);
  assert.ok(bins[bins.length - 1].acc >= bins[0].acc - 0.01, "stronger calls are not less accurate");
  for (const b of bins) assert.ok(b.acc >= b.lo - 0.06, `a ${b.lo}+ call was right ${b.acc}`);
});

test("the service trains on the stored history, forecasts 15+ minutes ahead, scores itself and learns the next day", async () => {
  const dates = weekdays("2026-01-05", 120);
  const w = world(dates, 24, { seed: 11 });
  const history = fakeHistory(w.stocks);
  const docs = mkdocs();
  const todayDate = weekdays("2026-01-05", 124)[121]; // a session after the history
  const extra = world(weekdays("2026-01-05", 124), 24, { seed: 11 }); // same seed: the first 120 days repeat, then new ones
  const dayOf = (s, i) => extra.stocks.find((x) => x.symbol === s).days[i];
  let nowMs = openMs(todayDate) + (11 * 60 + 3 - (9 * 60 + 15)) * 60000 + 10000; // 11:03:10 on todayDate
  const today = new Map();
  const market = {
    mode: () => "kite",
    watchlist: () => ["T00", "T01"],
    daily: async (s) => ({ candles: extra.stocks.find((x) => x.symbol === s).days.slice(0, 121).map(([d, bars]) => ({ t: d, o: bars[0].o, h: Math.max(...bars.map((b) => b.h)), l: Math.min(...bars.map((b) => b.l)), c: bars[bars.length - 1].c })) }),
    _recentBars: async (s) => {
      const days = s === "NIFTY 50" ? null : extra.stocks.find((x) => x.symbol === s).days;
      if (!days) {
        // the index: the average of the stocks' bars
        const d = extra.stocks.map((x) => x.days[121][1]);
        const bars = d[0].map((b, i) => ({ t: b.t, o: d.reduce((a, x) => a + x[i].o, 0) / d.length, h: d.reduce((a, x) => a + x[i].h, 0) / d.length, l: d.reduce((a, x) => a + x[i].l, 0) / d.length, c: d.reduce((a, x) => a + x[i].c, 0) / d.length, v: 1 }));
        return { today: bars.filter((b) => b.t + 300000 <= nowMs + 300000), prior: [] };
      }
      const bars = days[121][1];
      return { today: bars.filter((b) => b.t <= nowMs), prior: days[120][1] };
    },
  };
  const svc = new Horizon({ market, docs, history: () => history, universe: () => w.stocks.map((s) => s.symbol), now: () => nowMs, log: quiet });
  assert.equal((await svc.view("T00")).available, false, "untrained: it says so");
  const out = await svc.train({ trigger: "test" });
  assert.ok(out.rows > 20000 && out.stocks === 24);
  const v = out.validation.horizons.find((x) => x.h === 3);
  assert.ok(v.dirAcc > 0.55 && v.skill > 0);

  const view = await svc.view("T00");
  assert.equal(view.available, true, view.reason);
  assert.ok(view.headline.minutesAhead >= 15, `${view.headline.minutesAhead} minutes ahead`);
  assert.ok(view.headline.low < view.headline.price && view.headline.price < view.headline.high);
  assert.ok(["UP", "DOWN", "LEANS UP", "LEANS DOWN", "NO CLEAR LEAN"].includes(view.headline.call.word));
  assert.ok(view.reach.length >= 2 && view.reach[0].up.price >= view.anchor.price - 1e-9 && view.reach[0].down.price <= view.anchor.price + 1e-9, "the forecast high and low bracket the price");
  assert.ok(view.levels.some((l) => l.name === "VWAP") && view.levels.every((l) => l.p15 === undefined || (l.p15 >= 0 && l.p15 <= 1)));
  assert.ok(view.why.length > 0 && view.why.every((x) => x.text));
  assert.ok(view.learning.trained && view.learning.examples > 20000);

  // later: the forecast is scored against what really happened
  nowMs += 60 * 60000;
  const scored = await svc.score();
  assert.ok(scored >= 1, "a forecast was scored");
  const again = await svc.view("T00");
  assert.ok(again.live.n >= 1 && again.history.length >= 1);
  assert.ok(again.history[0].actual != null && again.history[0].forecast != null);

  // the evening: a new session in the history is forecast with the old model, scored, then learned
  const before = svc.model();
  const lastBefore = before.lastDate;
  for (const s of w.stocks) history.append(s.symbol, dayOf(s.symbol, 120)[1]);
  const learned = await svc.learnDays({ trigger: "test" });
  assert.equal(learned.days, 1);
  const after = svc.model();
  assert.ok(after.lastDate > lastBefore && after.rows > before.rows - 1 && after.learned.days === 1);
  const board = svc.board();
  assert.equal(board.days.length, 1);
  assert.ok(board.days[0].h15.n > 500 && board.days[0].h15.dirAcc > 0.5, `the day was tested out of sample on every stock: ${JSON.stringify(board.days[0].h15)}`);
  assert.equal((await svc.learnDays({ trigger: "test" })).days, 0, "nothing new: nothing to learn");
});

test("the 15-minute headline always looks at least 15 minutes ahead, whatever the age of the last bar", () => {
  const model = { W: Array.from({ length: H.T }, () => new Array(H.D).fill(0)), resSd: Array.from({ length: H.T }, () => [1, 1, 1]), z70: new Array(H.T).fill(1.04) };
  const days = weekdays("2026-02-02", 1);
  const bars = Array.from({ length: 30 }, (_, i) => ({ t: openMs(days[0]) + i * 300000, o: 100, h: 100.2, l: 99.8, c: 100, v: 1000 }));
  const fc = H.forecastFrom(bars, { sigma: 0.001, day: 0.015, beta: 1, vol: null, prevClose: 100, prevDayRet: 0, trend: 0, mkt: null }, model);
  assert.ok(fc);
  const end = fc.anchor.end;
  for (const lag of [0, 60000, 120000, 240000, 299000]) {
    const h = H.headline(fc, end + lag);
    assert.ok(h && h.at - (end + lag) >= 15 * 60000 - 1000, `lag ${lag}: ${h && (h.at - end - lag) / 60000} minutes`);
  }
});

test("the time-of-day experts are adopted only when the parts of the day really differ — and then they beat the pooled model on unseen sessions", () => {
  const dates = weekdays("2026-01-05", 130);
  const run = (opts) => {
    const w = world(dates, 24, opts);
    const mk = H.marketFromStocks(w.stocks.map((s) => s.days));
    const cut = dates[95];
    const train = new H.Stats();
    const seg = H.SEGMENTS.map(() => new H.Stats());
    const val = [];
    for (const s of w.stocks) {
      const prof = H.buildProfile(s.days, mk);
      for (let d = 1; d < s.days.length; d += 1) {
        const date = s.days[d][0];
        const ctx = { sigma: prof.sigma, day: prof.day, beta: prof.beta, vol: prof.vol, prevClose: H.cleanBars(s.days[d - 1][1]).pop().c, prevDayRet: 0, trend: 0, mkt: mk.get(date) };
        for (const row of H.dayRows(s.days[d][1], ctx, { stride: 2 })) {
          if (date <= cut) {
            train.add(row.x, row.y, 1);
            seg[H.segOf(row.s)].add(row.x, row.y, 1);
          } else val.push(row);
        }
      }
    }
    const W = H.fit(train);
    const Wseg = seg.map((st) => H.fit(st, H.LAMBDA, H.SEG_MIN_ROWS));
    const alpha = H.chooseAlpha(H.alphaEvidence(null, W, Wseg, val.filter((_, i) => i % 2 === 0)));
    // judged on the other half of the unseen rows, so the choice of alpha is not marking its own homework
    const judge = val.filter((_, i) => i % 2 === 1);
    const k3 = H.HORIZONS.indexOf(3);
    const pooled = H.summariseEval(H.scoreRows(H.emptyEval(), W, judge, { keepZ: false }))[k3];
    const blended = H.summariseEval(H.scoreRows(H.emptyEval(), W, judge, { keepZ: false, segs: { W: Wseg, alpha } }))[k3];
    return { alpha, pooled, blended, ready: Wseg.map(Boolean) };
  };
  // the open and the close trend, the middle of the day reverses: one pooled model cannot be right about all three
  const differs = run({ seed: 5, phiOf: (i) => (i < 12 || i >= 57 ? 0.45 : -0.35) });
  assert.ok(differs.ready.every(Boolean), "each part of the day had enough examples for its own model");
  assert.ok(differs.alpha[H.tIndex("r1")] > 0, `the experts were adopted for the next bar (alpha ${differs.alpha[H.tIndex("r1")]})`);
  assert.ok(differs.blended.skill > differs.pooled.skill + 0.002, `blended ${differs.blended.skill} beats pooled ${differs.pooled.skill}`);
  // the same behaviour all day: the experts have nothing to add and are not used where they do not clearly help
  const same = run({ seed: 5, phi: 0.3 });
  assert.ok(same.blended.skill >= same.pooled.skill - 0.002, "never clearly worse than the pooled model");
  assert.ok(same.alpha.filter((a) => a > 0).length <= 2, `mostly left unused when the day is uniform (${same.alpha.join(",")})`);
});

test("the contest keeps its champion unless another model is clearly ahead; a smaller model is a corner of the larger one's sums", () => {
  const Ws = H.CANDIDATES.map(() => [[]]);
  const acc = (a, b, c) => ({ n: 5000, se: [[a], [b], [c]] });
  assert.equal(H.chooseChampion(acc(100, 90, 95), Ws), 1, "the least error wins when there is no champion yet");
  assert.equal(H.chooseChampion(acc(100, 99.9, 101), Ws, 0), 0, "0.1% ahead is not enough to unseat the champion");
  assert.equal(H.chooseChampion(acc(100, 99, 101), Ws, 0), 1, "1% ahead is");
  assert.equal(H.chooseChampion(acc(100, 90, 95), [Ws[0], null, Ws[2]], 0), 2, "a candidate that could not be fitted is never chosen");
  // fitting with fewer inputs leaves the rest at exactly zero, and predicts like a model that never had them
  const dates = weekdays("2026-01-05", 60);
  const w = world(dates, 10);
  const mk = H.marketFromStocks(w.stocks.map((s) => s.days));
  const st = new H.Stats();
  const rows = [];
  for (const s of w.stocks) {
    const prof = H.buildProfile(s.days, mk);
    for (let d = 1; d < s.days.length; d += 1) {
      const ctx = { sigma: prof.sigma, day: prof.day, beta: prof.beta, vol: prof.vol, prevClose: H.cleanBars(s.days[d - 1][1]).pop().c, prevDayRet: 0, trend: 0, mkt: mk.get(s.days[d][0]) };
      for (const row of H.dayRows(s.days[d][1], ctx, { stride: 2 })) {
        st.add(row.x, row.y, 1);
        rows.push(row);
      }
    }
  }
  const [base, full] = H.fitCandidates(st, 1000);
  assert.ok(base && full);
  assert.ok(base[0].slice(H.BASE_D).every((v) => v === 0), "the added inputs carry no weight in the base model");
  assert.ok(full[0].slice(H.BASE_D).some((v) => v !== 0), "and do in the full one");
  assert.ok(rows[0].x.slice(H.BASE_D).some((v) => v !== 0), "the added inputs are computed");
  assert.ok(rows.every((r) => Array.from(r.x).every(Number.isFinite)), "every input is a finite number");
  // a stock's scale: pulled towards 1 until its record is long, and never extreme
  assert.equal(H.stockScaleOf(null), 1);
  assert.ok(Math.abs(H.stockScaleOf({ pp: 0.5, pa: 1.5 }) - 1.18) < 0.02, "a short record moves it only a little");
  assert.equal(H.stockScaleOf({ pp: 100, pa: 400 }), 1.6);
  assert.equal(H.stockScaleOf({ pp: 100, pa: -50 }), 0.4);
});

test("training and every evening leave a record in the database and write the findings into the AI's skills file; an old model retrains itself", async () => {
  const dates = weekdays("2026-01-05", 110);
  const all = world(weekdays("2026-01-05", 112), 24, { seed: 21 });
  const stocks = all.stocks.map((s) => ({ symbol: s.symbol, days: s.days.slice(0, 110) }));
  const history = fakeHistory(stocks);
  const docs = mkdocs();
  const written = [];
  const playbook = { setSection: (title, text) => written.push({ title, text }) };
  const nowMs = openMs(dates[109]) + 8 * 3600000;
  const market = { mode: () => "kite", watchlist: () => [] };
  const svc = new Horizon({ market, docs, history: () => history, universe: () => stocks.map((s) => s.symbol), playbook, now: () => nowMs, log: quiet });
  await svc.train({ trigger: "test" });
  const m = svc.model();
  assert.equal(m.version, H.MODEL_VERSION);
  assert.ok(H.CANDIDATES.some((c) => c.id === m.champion), `a champion was chosen (${m.champion})`);
  assert.equal(m.Wall.length, H.CANDIDATES.length);
  assert.ok(m.arena.n > 1000 && m.stockCal && typeof m.stockCal.on === "boolean" && Object.keys(m.stockCal.recs).length === 24);
  // the findings: on the board, in the database, in the skills file
  const board = svc.board();
  assert.ok(board.learning.lessons.length >= 4);
  assert.match(board.learning.lessons[0], /Tested on [\d,]+ examples from sessions it had not seen/);
  assert.ok(board.learning.lessons.some((l) => /^Model in use:/.test(l)));
  assert.ok(board.learning.lessons.some((l) => /What moved the next 15 minutes most/.test(l) && /the last 5 minutes rose/.test(l)), "the planted momentum is named as a driver");
  assert.ok(board.learning.contest.candidates.filter((c) => c.inUse).length === 1);
  const { LEARNING, SECTION } = require("../horizon");
  assert.equal(docs.items(LEARNING).length, 1);
  assert.equal(docs.items(LEARNING)[0].kind, "training");
  assert.equal(written.length, 1);
  assert.equal(written[0].title, SECTION);
  assert.match(written[0].text, /^- Tested on/);
  assert.match(written[0].text, /not promises/);
  // the evening: the new session is learned, the contest and the scales are judged again, and a second record is kept
  for (const s of all.stocks) history.append(s.symbol, s.days[110][1]);
  const out = await svc.learnDays({ trigger: "test" });
  assert.equal(out.days, 1);
  const m2 = svc.model();
  assert.ok(m2.arena.n > m.arena.n * 0.97, "the evidence grew with the day");
  assert.ok(m2.slope.every((v) => v >= 0.3 && v <= 1.5));
  assert.equal(docs.items(LEARNING).length, 2);
  assert.ok(docs.items(LEARNING).some((r) => r.kind === "evening" && r.days.length === 1 && r.lessons.length >= 4));
  assert.equal(written.length, 2);
  // a model made from another list of inputs is not used: the screen says it is learning again
  svc._model = { ...m2, version: 1 };
  svc._cache.clear();
  const view = await svc.view("T00");
  assert.equal(view.available, false);
  assert.match(view.reason, /learning again with its new inputs/);
});
