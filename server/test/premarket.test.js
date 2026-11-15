"use strict";
// The NSE forecast from the world (server/market/premarket.js) and the overseas feed (server/market/global.js)
// — on SYNTHETIC numbers and a FAKE provider (no network, no real key).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildMarketForecast, measureFollow, idOfCue, pctOf, crore } = require("../market/premarket");
const { GlobalFeed, MARKETS, sessionOf } = require("../market/global");
const { FileDocs } = require("../docs");

const KEY = "TESTONLYfmpkey1234567890";

function niftyDaily(n = 260, follow = 0.4, us = null) {
  // a Nifty whose opens follow the US session before them by `follow`
  const out = [];
  let c = 24000;
  const start = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const t = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const usRet = us ? us[i] : 0;
    const o = c * (1 + (follow * usRet) / 100);
    const cl = o * (1 + (((i * 37) % 11) - 5) / 1000);
    out.push({ t, o, h: Math.max(o, cl) * 1.004, l: Math.min(o, cl) * 0.996, c: cl, v: 1e6 });
    c = cl;
  }
  return out;
}

test("before the open: GIFT Nifty sets the expected gap, and the overseas cues vote on the day", () => {
  const f = buildMarketForecast({
    phase: "pre",
    nifty: { prevClose: 24000, last: 24000, changePct: 0, daily: niftyDaily() },
    kite: { gift: { available: true, last: 24150, changePct: 0.6 }, usdinr: { available: true, last: 88, changePct: -0.15 }, crude: { available: true, last: 5600, changePct: -1.2 }, vix: { available: true, last: 13, changePct: -4 } },
    global: [
      { id: "spx", name: "S&P 500", region: "US", available: true, last: 6000, changePct: 0.9, session: "closed" },
      { id: "ixic", name: "Nasdaq Composite", region: "US", available: true, last: 20000, changePct: 1.3, session: "closed" },
      { id: "n225", name: "Nikkei 225", region: "Japan", available: true, last: 40000, changePct: 0.8, session: "live" },
      { id: "sti", name: "Straits Times (STI)", region: "Singapore", available: true, last: 3900, changePct: 0.4, session: "live" },
      { id: "dax", name: "DAX", region: "Europe", available: true, last: 19000, changePct: 0.5, session: "pre" },
    ],
    nextSession: "2026-11-17",
  });
  assert.equal(f.available, true);
  assert.equal(f.open.gapPct, 0.6);
  assert.equal(f.open.expected, 24144);
  assert.match(f.open.label, /gap-up/);
  assert.equal(f.lean.word, "up");
  assert.equal(f.lean.firm, true);
  assert.ok(f.votes[0].id === "gift", "GIFT Nifty weighs most before the open");
  assert.ok(f.markets.some((m) => m.region === "Singapore") && f.markets.some((m) => m.region === "Japan"));
  assert.ok(f.sectors.some((s) => s.sector === "IT" && s.bias === "tailwind"), "a strong Nasdaq helps Indian IT");
  assert.match(f.for, /2026-11-17/);
  assert.ok(f.range.low < f.open.expected && f.range.high > f.open.expected);
});

test("in the session GIFT Nifty is left out; the Nifty's own tide leads", () => {
  const f = buildMarketForecast({
    phase: "open",
    nifty: { prevClose: 24000, last: 23880, changePct: -0.5, daily: niftyDaily() },
    kite: { gift: { available: true, last: 23900, changePct: -0.4 } },
    tide: { score: -55, summary: "Falling tide" },
    global: [{ id: "dax", name: "DAX", region: "Europe", available: true, last: 19000, changePct: -0.9, session: "live" }],
  });
  assert.ok(!f.votes.some((v) => v.id === "gift"));
  assert.equal(f.votes[0].id, "tide");
  assert.equal(f.open, null);
  assert.equal(f.lean.word, "down");
  assert.match(f.for, /rest of today/);
});

test("without GIFT Nifty the expected gap is the S&P 500 times the Nifty's measured sensitivity", () => {
  const us = Array.from({ length: 260 }, (_, i) => ((i * 53) % 21) / 10 - 1);
  // the Nifty's open on day i follows the US session dated the day before it, which is us[i] below
  const nd = niftyDaily(260, 0.4, us);
  const spx = [];
  let c = 5000;
  us.forEach((r, i) => {
    c *= 1 + r / 100;
    spx.push({ d: new Date(Date.UTC(2025, 0, 1) + i * 86400000 - 3600000).toISOString().slice(0, 10), c });
  });
  const m = measureFollow(nd, spx);
  assert.ok(m && Math.abs(m.beta - 0.4) < 0.08, `measured beta ${m && m.beta}`);
  assert.ok(m.r2 > 0.5);
  const f = buildMarketForecast({ phase: "pre", nifty: { prevClose: 24000, last: 24000, daily: nd }, global: [{ id: "spx", name: "S&P 500", region: "US", available: true, last: 6000, changePct: -2, session: "closed" }], history: { spx } });
  assert.ok(f.open.gapPct < -0.6 && f.open.gapPct > -1, `gap ${f.open.gapPct}`);
  assert.match(f.open.basis, /No GIFT Nifty reading/);
  assert.ok(f.cautions.some((c) => /No GIFT Nifty/.test(c)));
});

test("the world brief fills in what the feed lacks: futures, FII flows, mood and events", () => {
  assert.equal(idOfCue("S&P 500 futures"), "usfut");
  assert.equal(idOfCue("SGX Nifty"), "gift");
  assert.equal(idOfCue("Straits Times Index"), "sti");
  assert.equal(idOfCue("FII net"), "fii");
  assert.equal(pctOf("−0.8%"), -0.8);
  assert.equal(crore("net sold ₹2,300 crore"), -2300);
  const world = { at: new Date().toISOString(), mood: "risk_off", headline: "Wall Street fell on rate fears", cues: [{ name: "S&P 500 futures", value: "5,900", change: "-0.7%", asOf: "now" }, { name: "FII net", value: "₹-3,100 crore", change: "", asOf: "yesterday" }], events: ["RBI policy at 10 AM"], sectors: [], caveats: [] };
  const f = buildMarketForecast({ phase: "pre", nifty: { prevClose: 24000, last: 24000, daily: niftyDaily() }, world });
  assert.ok(f.votes.some((v) => v.id === "usfut" && v.vote < 0));
  assert.ok(f.votes.some((v) => v.id === "fii" && v.vote < 0));
  assert.ok(f.votes.some((v) => v.id === "mood" && v.vote < 0));
  assert.equal(f.lean.word, "down");
  assert.ok(f.cautions.some((c) => /RBI policy/.test(c)));
  assert.equal(f.news.headline, "Wall Street fell on rate fears");
  const none = buildMarketForecast({ phase: "pre" });
  assert.equal(none.available, false);
  assert.ok(none.cautions[0].includes("No overseas cue"));
});

test("exchange hours: live, before the open and closed, in each exchange's own time zone", () => {
  const spx = MARKETS.find((m) => m.id === "spx");
  const n225 = MARKETS.find((m) => m.id === "n225");
  assert.equal(sessionOf(n225, Date.parse("2026-11-16T06:00:00+05:30")), "live", "Tokyo at 9:30 local");
  assert.equal(sessionOf(spx, Date.parse("2026-11-16T08:00:00+05:30")), "closed", "New York at 9:30 PM the night before");
  assert.equal(sessionOf(spx, Date.parse("2026-11-16T21:00:00+05:30")), "live");
  assert.equal(sessionOf(n225, Date.parse("2026-11-15T06:00:00+05:30")), "closed", "a Sunday");
});

test("the overseas feed: the owner's key is kept encrypted and never returned; quotes are shaped; a refusal is reported in FMP's words", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-global-"));
  const docs = new FileDocs(dir);
  let calls = 0;
  let refuse = false;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.ok(String(url).includes(`apikey=${KEY}`));
    if (refuse) return new Response(JSON.stringify({ "Error Message": "Special Endpoint : this endpoint is not available under your current subscription" }), { status: 402 });
    if (String(url).includes("historical-price-eod")) return new Response(JSON.stringify([{ symbol: "^GSPC", date: "2026-11-13", price: 6000 }, { symbol: "^GSPC", date: "2026-11-12", price: 5950 }]), { status: 200 });
    return new Response(JSON.stringify([{ symbol: "^GSPC", price: 6000, change: 30, volume: 2e9 }, { symbol: "^N225", price: 40000, changePercentage: 0.8, previousClose: 39682, timestamp: 1763270000 }]), { status: 200 });
  };
  const secrets = { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() };
  const feed = new GlobalFeed({ docs, secrets, fetchImpl, now: () => Date.parse("2026-11-16T07:00:00+05:30") });
  assert.equal((await feed.quotes()).available, false, "no key yet");
  assert.throws(() => feed.setKey({ key: "short" }), /does not look like/);
  const st = feed.setKey({ key: KEY });
  assert.equal(st.configured, true);
  assert.ok(!JSON.stringify(st).includes(KEY), "the key is never returned");
  assert.ok(!JSON.stringify(docs.read("market/global-feed.json")).includes(KEY), "stored encrypted");
  const q = await feed.quotes();
  assert.equal(q.available, true);
  const spx = q.markets.find((m) => m.id === "spx");
  assert.equal(spx.prevClose, 5970);
  assert.equal(spx.changePct, 0.5, "computed from the change when the provider gives none");
  assert.equal(q.markets.find((m) => m.id === "n225").changePct, 0.8);
  assert.equal(q.markets.find((m) => m.id === "dax").available, false);
  const before = calls;
  await feed.quotes();
  assert.equal(calls, before, "kept for a while: no second call");
  const h = await feed.history();
  assert.equal(h.spx[0].d, "2026-11-12", "oldest first");
  refuse = true;
  const r = await feed.quotes({ refresh: true });
  assert.equal(r.stale, true, "the last good reading, marked stale");
  assert.match(r.error, /FMP refused: Special Endpoint/);
  assert.match(feed.status().lastError, /not available under your current subscription/);
  feed.setKey({ remove: true });
  assert.equal(feed.status().configured, false);
});
