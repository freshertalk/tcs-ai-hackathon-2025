"use strict";
// The AI strategist: plan checks, outcome scoring, the skills file, and the whole
// round trip against a FAKE Anthropic API (no network, no real key, no cost).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const { createApp } = require("../app");
const { SUPERADMIN_EMAIL } = require("../config");
const { checkPlan, AiService } = require("../ai/service");
const { scorePlan, summarize } = require("../ai/journal");
const { Playbook, SEED, MAX_LESSONS, LESSONS_HEAD } = require("../ai/playbook");
const { analyze } = require("../market/analyze");
const { buildVerdict } = require("../market/verdict");
const { buildTape, fastRead } = require("../market/intraday");
const { replayDay, combine } = require("../market/replay");

const KEY = "sk-ant-api03-TESTONLYtestonlyTESTONLY1234567890abcd"; // not a real key
const at = (hhmm, date = "2026-11-12") => Date.parse(`${date}T${hhmm}:00+05:30`);

/* --------------------------------------------------------- outcome scoring */

const bar = (t, o, h, l, c) => ({ t, o, h, l, c });
const longPlan = { side: "long", entry: 100, stop: 98, target: 104, entryType: "breakout" };

test("scoring: target first, stop first, and the unflattering tie-break", () => {
  assert.deepEqual(
    (({ status, r }) => ({ status, r }))(scorePlan(longPlan, [bar("a", 99, 100.5, 99, 100.2), bar("b", 100.2, 104.2, 100, 104)])),
    { status: "target", r: 2 }
  );
  assert.equal(scorePlan(longPlan, [bar("a", 99, 100.5, 99, 100.2), bar("b", 100, 100.4, 97.9, 98.2)]).r, -1);
  // one bar touches both the stop and the target → the stop is counted
  const both = scorePlan(longPlan, [bar("a", 99, 100.5, 99, 100.2), bar("b", 100, 104.5, 97.5, 103)]);
  assert.equal(both.status, "stop");
  assert.match(both.note, /both touched/);
  // the bar that triggers the entry can also stop it out
  assert.equal(scorePlan(longPlan, [bar("a", 99.5, 100.2, 97.8, 98)]).status, "stop");
});

test("scoring: a gap through the stop loses more than 1R", () => {
  const r = scorePlan(longPlan, [bar("a", 99, 100.5, 99.5, 100.2), bar("b", 96, 96.5, 95, 95.5)]);
  assert.equal(r.status, "stop");
  assert.equal(r.r, -2, "filled at the open, 4 below the entry, with a planned risk of 2");
  assert.match(r.note, /Gapped/);
});

test("scoring: never entered, still waiting, still open, and expired", () => {
  const quiet = [bar("a", 99, 99.8, 98.5, 99.2), bar("b", 99.2, 99.9, 99, 99.5)];
  assert.equal(scorePlan(longPlan, quiet).status, "pending");
  assert.equal(scorePlan(longPlan, quiet, { expire: true }).status, "not-triggered");
  assert.equal(scorePlan(longPlan, quiet, { expire: true }).r, null, "a plan that never traded has no result");
  const drifting = [bar("a", 99, 100.5, 99.5, 100.4), bar("b", 100.4, 101.5, 100, 101)];
  assert.deepEqual((({ status, r }) => ({ status, r }))(scorePlan(longPlan, drifting)), { status: "open", r: 0.5 });
  assert.deepEqual((({ status, r }) => ({ status, r }))(scorePlan(longPlan, drifting, { expire: true })), { status: "expired", r: 0.5 });
});

test("scoring: shorts are mirrored, pullbacks enter on the way back, at-market enters at once", () => {
  const short = { side: "short", entry: 100, stop: 102, target: 96, entryType: "breakout" };
  assert.equal(scorePlan(short, [bar("a", 101, 101.2, 99.8, 100), bar("b", 100, 100.5, 95.9, 96.2)]).status, "target");
  assert.equal(scorePlan(short, [bar("a", 101, 101.2, 99.8, 100), bar("b", 100, 102.1, 99.5, 101.8)]).r, -1);
  // a long pullback (buy lower): entered only when price comes DOWN to the entry
  const pull = { side: "long", entry: 100, stop: 98, target: 104, entryType: "pullback" };
  assert.equal(scorePlan(pull, [bar("a", 102, 103, 101, 102.5)], { expire: true }).status, "not-triggered");
  assert.equal(scorePlan(pull, [bar("a", 102, 102.5, 99.9, 100.5), bar("b", 100.5, 104.1, 100.2, 104)]).status, "target");
  // at-market: already in, so the first bar can resolve it
  assert.equal(scorePlan({ ...longPlan, entryType: "at_market" }, [bar("a", 100, 104.2, 99.5, 104)]).status, "target");
  assert.equal(scorePlan({ side: "long", entry: 100, stop: 100, target: 104 }, []).status, "invalid");
});

test("the track record counts only plans that passed the checks and actually resolved", () => {
  const plan = (status, r, extra = {}) => ({ action: "long", checkStatus: "passed", outcome: status ? { status, r } : null, ...extra });
  const s = summarize([{ plans: [plan("target", 2), plan("stop", -1), plan("expired", 0.4), plan("not-triggered", null), plan(null), plan("target", 3, { checkStatus: "rejected" }), { action: "no_trade" }] }]);
  assert.equal(s.total, 6);
  assert.equal(s.resolved, 3);
  assert.equal(s.rejected, 1);
  assert.equal(s.notTriggered, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.avgR, 0.47);
  assert.equal(s.winRatePct, 67, "target + an expiry in profit, out of three");
  assert.equal(summarize([]).avgR, null);
});

/* -------------------------------------------------------------- plan checks */

const ctx = { last: 100, atr: 4, circuit: { upper: 110, lower: 90 }, session: { open: true, entries: true, label: "Morning session" } };
const good = { horizon: "intraday", action: "long", entry_type: "breakout", entry: 100.52, stop: 98.5, targets: [103, 105], rationale: "r", invalidation: "i" };

test("a coherent plan passes, and prices are rounded to the 0.05 tick", () => {
  const c = checkPlan(good, ctx);
  assert.equal(c.status, "passed", JSON.stringify(c.checks.filter((x) => !x.ok)));
  assert.equal(c.plan.entry, 100.5);
  assert.equal(c.plan.side, "long");
  assert.equal(c.plan.target, 103);
  assert.equal(c.plan.riskPerShare, 2);
  assert.equal(c.plan.rewardToRisk, 1.25);
  assert.ok(c.checks.length >= 7);
});

test("incoherent or unsafe plans are rejected, each for a stated reason", () => {
  const failed = (p, c = ctx) => {
    const r = checkPlan({ ...good, ...p }, c);
    assert.equal(r.status, "rejected", JSON.stringify(p));
    return r.checks.filter((x) => !x.ok).map((x) => x.name).join(" | ");
  };
  assert.match(failed({ stop: 101 }), /losing side/);
  assert.match(failed({ targets: [99] }), /beyond the entry/);
  assert.match(failed({ targets: [104, 103] }), /in order/);
  assert.match(failed({ targets: [112] }), /circuit/);
  assert.match(failed({ stop: 91 }), /Stop distance/);
  assert.match(failed({ stop: 100.4 }), /Stop distance/);
  assert.match(failed({ targets: [101] }), /at least as far as the stop/);
  assert.match(failed({ entry: 108, stop: 106, targets: [109.5] }), /within reach/);
  assert.match(failed({ entry_type: "at_market", entry: 102, stop: 100, targets: [105] }), /At market/);
  assert.match(failed({ entry_type: "pullback", entry: 102, stop: 100, targets: [105] }), /Pullback/);
  assert.match(failed({ entry: null }), /are given/);
  assert.match(failed({ targets: [] }), /are given/);
  assert.match(failed({ horizon: "swing", action: "short", entry: 99, stop: 102, targets: [94] }), /long-only/);
  assert.match(failed({}, { ...ctx, session: { open: true, entries: false, label: "Last hour — no fresh entries" } }), /entry window/);
});

test("no_trade is a valid answer; a closed market turns an intraday plan into a next-session note", () => {
  const n = checkPlan({ horizon: "swing", action: "no_trade", entry_type: "none", entry: null, stop: null, targets: [], rationale: "mixed", invalidation: "x" }, ctx);
  assert.equal(n.status, "no-trade");
  assert.equal(n.plan.entry, null);
  const closed = checkPlan(good, { ...ctx, session: { open: false, entries: false, label: "Market closed" } });
  assert.equal(closed.status, "passed");
  assert.match(closed.notes.join(" "), /next session/);
  // shorts intraday are fine
  assert.equal(checkPlan({ horizon: "intraday", action: "short", entry_type: "breakout", entry: 99.5, stop: 101.5, targets: [96.5], rationale: "", invalidation: "" }, ctx).status, "passed");
});

/* ------------------------------------------------------------ skills file */

test("the skills file: seeded, editable, capped, and lessons never overwrite the rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-pb-"));
  const pb = new Playbook({ dir });
  assert.equal(pb.read(), SEED);
  assert.match(pb.read(), /No method wins every trade/);
  assert.deepEqual(pb.lessons(), []);

  pb.appendLessons(["Wait for the 5-minute close.  ", "", "Skip midday breakouts."], "2026-11-12");
  assert.deepEqual(pb.lessons(), ["2026-11-12: Wait for the 5-minute close.", "2026-11-12: Skip midday breakouts."]);
  assert.match(pb.read(), /No method wins every trade/, "the rules are still there");
  assert.ok(!/None yet/.test(pb.read()));

  for (let i = 0; i < MAX_LESSONS + 10; i += 1) pb.appendLessons([`lesson ${i}`], "2026-11-13");
  assert.equal(pb.lessons().length, MAX_LESSONS, "only the newest lessons are kept");
  assert.match(pb.lessons()[MAX_LESSONS - 1], /lesson 69$/);

  pb.write(`# My rules\n- one\n\n${LESSONS_HEAD}\n- kept`);
  assert.deepEqual(pb.lessons(), ["kept"]);
  assert.throws(() => pb.write("  "), /cannot be empty/);
  assert.throws(() => pb.write("x".repeat(30000)), /limited to/);
  assert.equal(pb.reset(), SEED);
});

/* ------------------------------------------------- fakes for the round trip */

const dayN = (i) => new Date(Date.UTC(2023, 0, 2) + i * 86400000).toISOString().slice(0, 10);
function history(n, lastDate) {
  let s = 99;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  const out = [];
  let p = 80;
  for (let i = 0; i < n; i += 1) {
    const o = p;
    p = p * (1 + (0.08 + (rnd() - 0.5) * 1.6) / 100);
    out.push({ t: dayN(i), o, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996, c: p, v: 400000 });
  }
  // end exactly on lastDate so "today" lines up with the injected clock
  const shift = (Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${out[n - 1].t}T00:00:00Z`)) / 86400000;
  return out.map((c, i) => ({ ...c, t: new Date(Date.UTC(2023, 0, 2) + (i + shift) * 86400000).toISOString().slice(0, 10) }));
}
function tape(prices, date = "2026-11-12", from = 0) {
  return prices.map((p, i) => {
    const m = 9 * 60 + 15 + (from + i) * 5;
    const o = i === 0 ? p : prices[i - 1];
    return { t: `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+0530`, o, h: Math.max(o, p) + 0.2, l: Math.min(o, p) - 0.2, c: p, v: 5000 };
  });
}

/** A market service that answers from fixed data, using the real engines so the shapes are real. */
function stubMarket(clock) {
  const m = { calls: [], after: [], dailyAfter: [] };
  const candles = history(700, "2026-11-11");
  const pc = candles[candles.length - 1].c;
  const bars = tape(Array.from({ length: 16 }, (_, i) => pc * (1.001 + 0.0009 * i)));
  m.last = Math.round(pc * 1.0155 * 20) / 20;
  m.atr = analyze(candles, { chartBars: 1 }).levels.atr.value;
  const quote = { last: m.last, open: pc * 1.001, high: m.last + 0.3, low: pc * 0.999, prevClose: pc, volume: 300000, upperCircuit: Math.round(pc * 1.1), lowerCircuit: Math.round(pc * 0.9) };
  m.mode = () => "kite";
  m.verdict = async (symbol) => {
    m.calls.push(`verdict ${symbol}`);
    return { symbol, source: "kite", stale: false, staleReason: "", at: new Date(clock.ms).toISOString(), quoteLive: true, quoteNote: "", tape: { ...buildTape(bars, { prevClose: pc }), today: true }, ...buildVerdict({ analysis: analyze(candles, { chartBars: 1 }), candles, quote, intradayBars: bars, nowMs: clock.ms }) };
  };
  m.analysis = async (symbol) => ({ symbol, source: "kite", barInProgress: false, ...analyze(candles, { chartBars: 60 }) });
  m.backtestAll = async () => ({ rows: [] });
  m.daily = async () => ({ candles: [...candles, ...m.dailyAfter] });
  // the newer parts of the market service the co-pilot, the news check and the debrief use
  m.pc = pc;
  m.candles = candles;
  m.card = null; // set to a scorecard to give the debrief a day to read
  m.scorecard = async (opts = {}) => {
    m.calls.push(`scorecard ${opts.costPct === undefined ? "default" : opts.costPct}`);
    return m.card || { available: false, reason: "The watchlist is empty. Add the stocks you follow and their day is replayed here." };
  };
  m.context = async () => ({ available: true, tide: { score: 40, label: "Rising", summary: "Nifty is up 0.4% and above its open." }, nifty: { changePct: 0.4, fromOpenPct: 0.2 }, vix: { last: 13.2, changePct: -1.1 }, items: [], sectors: [], notes: [] });
  m.minute = null; // set to 1-minute bars to give the co-pilot a tape
  m.tape = async (symbol, interval) => {
    m.calls.push(`tape ${symbol} ${interval}`);
    if (!m.minute) return { available: false, reason: "none" };
    const tp = buildTape(m.minute, { prevClose: pc });
    tp.today = true;
    tp.step = 1;
    return { available: true, step: 1, tape: tp, fast: fastRead(m.minute, { last: m.last }) };
  };
  m.flow = null;
  m.flowSnapshot = () => m.flow;
  m.nameOf = async () => "STATE BANK OF INDIA";
  m.quotes = async (symbols) => {
    m.calls.push(`quotes ${symbols.join(",")}`);
    return { quotes: Object.fromEntries(symbols.map((s) => [s, { ...quote, changePct: ((quote.last - pc) / pc) * 100 }])), live: true };
  };
  m.intradayOn = async (symbol, date) => {
    m.calls.push(`intradayOn ${symbol} ${date}`);
    return [...bars, ...m.after];
  };
  return m;
}

/** Anthropic's Messages API, faked: records what was sent, answers with whatever is queued. */
function fakeAnthropic() {
  const f = { requests: [], queue: [], fail: null, gate: null };
  f.fetch = async (url, init) => {
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    f.requests.push({ url: String(url), key: headers.get("x-api-key") || String(headers.get("authorization") || "").replace(/^Bearer /, ""), beta: headers.get("anthropic-beta"), body });
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
    if (f.gate) await f.gate; // lets a test hold an answer back, as a slow model would
    if (f.fail) return json(f.fail.status, { type: "error", error: { type: f.fail.type, message: f.fail.message } });
    const next = f.queue.length ? f.queue.shift() : { text: "ok" };
    return json(200, {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      content: next.content || [{ type: "text", text: next.text !== undefined ? next.text : JSON.stringify(next.json) }],
      stop_reason: next.stop || "end_turn",
      stop_sequence: null,
      usage: next.usage || { input_tokens: 4200, output_tokens: 650 },
    });
  };
  return f;
}

const strategyJson = (plans, extra = {}) => ({
  stance: "bullish",
  confidence: "medium",
  summary: "Above VWAP and the opening range; trend frames agree.",
  evidence: ["Price above VWAP", "Opening range cleared"],
  plans,
  risks: ["No view of news or results."],
  would_change_my_mind: ["A 5-minute close back under VWAP."],
  skills_used: ["VWAP is the day's fair price"],
  ...extra,
});

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ai-"));
  const clock = { ms: at("10:32") };
  const market = stubMarket(clock);
  const claude = fakeAnthropic();
  let nonce = "";
  const made = createApp({
    dataDir: dir,
    buildDir: path.join(dir, "no-build"),
    env: { SETUP_TOKEN: "tok" },
    google: () => ({
      authUrl: ({ state, nonce: n }) => ((nonce = n), `https://accounts.google.com/fake?state=${state}`),
      exchange: async (code) => ({ email: code, emailVerified: true, name: "T", picture: "", nonce }),
    }),
    holidayFetch: async () => {
      throw new Error("no network");
    },
    market,
    aiFetch: claude.fetch,
    now: () => clock.ms,
  });
  made.ai.log = { log() {} };
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;
  const request = (method, url, { cookie, body } = {}) =>
    new Promise((resolve, reject) => {
      const h = {};
      if (cookie) h.cookie = cookie;
      if (method !== "GET") h["x-requested-with"] = "vpt";
      let payload;
      if (body !== undefined) {
        payload = JSON.stringify(body);
        h["content-type"] = "application/json";
        h["content-length"] = Buffer.byteLength(payload);
      }
      const r = http.request({ host: "127.0.0.1", port, method, path: url, headers: h }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text, jar: (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ") });
        });
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });
  await request("POST", "/api/setup", { body: { token: "tok", googleClientId: "1234567890-abcdefgh.apps.googleusercontent.com", googleClientSecret: "GOCSPX-secret-secret" } });
  const start = await request("GET", "/api/auth/google/start");
  const state = new URL(start.headers.location).searchParams.get("state");
  const cb = await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(SUPERADMIN_EMAIL)}`, { cookie: start.jar });
  return { dir, clock, market, claude, made, request, admin: cb.jar, close: () => new Promise((r) => server.close(r)) };
}

/* ---------------------------------------------------------- the round trip */

test("without a key the desk still works: the AI says it is off and spends nothing", async (t) => {
  const s = await boot();
  t.after(s.close);
  const st = (await s.request("GET", "/api/admin/ai/status", { cookie: s.admin })).json;
  assert.equal(st.configured, false);
  assert.equal(st.keyHint, "");
  assert.equal(st.model, "claude-opus-5-5");

  const r = await s.request("POST", "/api/admin/ai/strategy/SBIN", { cookie: s.admin, body: { horizon: "both" } });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "not_configured");
  assert.equal(s.claude.requests.length, 0, "no call to Anthropic");
  assert.equal(s.market.calls.length, 0, "and no market data fetched for a request that cannot be answered");

  // the skills file and an (empty) journal are readable without a key; scoring runs without one too
  assert.match((await s.request("GET", "/api/admin/ai/skills", { cookie: s.admin })).json.text, /Risk first/);
  const rev = (await s.request("POST", "/api/admin/ai/review", { cookie: s.admin })).json;
  assert.equal(rev.learned, false);
  assert.equal(s.claude.requests.length, 0);
});

test("every AI route needs a signed-in admin", async (t) => {
  const s = await boot();
  t.after(s.close);
  for (const [m, p] of [["GET", "/api/admin/ai/status"], ["PUT", "/api/admin/ai/settings"], ["POST", "/api/admin/ai/test"], ["POST", "/api/admin/ai/strategy/SBIN"], ["GET", "/api/admin/ai/journal"], ["POST", "/api/admin/ai/review"], ["GET", "/api/admin/ai/skills"], ["PUT", "/api/admin/ai/skills"], ["POST", "/api/admin/ai/skills/reset"]]) {
    assert.equal((await s.request(m, p, { body: m === "GET" ? undefined : {} })).status, 401, `${m} ${p}`);
  }
});

test("the API key is write-only: validated, stored encrypted, never sent back", async (t) => {
  const s = await boot();
  t.after(s.close);
  const put = (body) => s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body });
  assert.equal((await put({ apiKey: "not-a-key" })).status, 400);
  assert.match((await put({ apiKey: "sk-ant-admin01-AAAAAAAAAAAAAAAAAAAAAAAA" })).json.message, /Admin API key/);
  assert.equal((await put({ model: "gpt-4" })).status, 400);

  const ok = await put({ apiKey: KEY, model: "claude-sonnet-5-5" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.configured, true);
  assert.equal(ok.json.model, "claude-sonnet-5-5");
  assert.equal(ok.json.keyHint, `${KEY.slice(0, 10)}…${KEY.slice(-4)}`);
  for (const p of ["/api/admin/ai/status", "/api/admin/settings", "/api/admin/ai/journal", "/api/admin/ai/skills"]) {
    assert.ok(!(await s.request("GET", p, { cookie: s.admin })).text.includes(KEY), `${p} must not contain the key`);
  }
  assert.ok(!ok.text.includes(KEY));
  assert.ok(!fs.readFileSync(path.join(s.dir, "db.json"), "utf8").includes(KEY), "not in the database file in clear text");

  // "Test": a tiny request with the stored key; a rejected key is reported, not thrown
  let tested = (await s.request("POST", "/api/admin/ai/test", { cookie: s.admin })).json;
  assert.equal(tested.test.ok, true);
  assert.equal(s.claude.requests[0].key, KEY);
  assert.equal(s.claude.requests[0].body.max_tokens, 16);
  s.claude.fail = { status: 401, type: "authentication_error", message: "invalid x-api-key" };
  tested = (await s.request("POST", "/api/admin/ai/test", { cookie: s.admin })).json;
  assert.equal(tested.test.ok, false);
  assert.match(tested.test.message, /rejected the API key/);
  assert.equal(tested.lastTest.ok, false);

  const gone = await put({ clear: true });
  assert.equal(gone.json.configured, false);
  assert.equal(gone.json.model, "claude-sonnet-5-5", "the model choice survives removing the key");
});

test("a strategy: the brief sent, the request shape, the checks applied, the journal entry", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  const L = s.market.last;
  const A = s.market.atr;
  const r5 = (x) => Math.round(x * 20) / 20;
  s.claude.queue.push({
    json: strategyJson([
      { horizon: "intraday", action: "long", entry_type: "at_market", entry: L, stop: r5(L - 0.5 * A), targets: [r5(L + 0.6 * A), r5(L + 1.1 * A)], rationale: "Trend day.", invalidation: "Back under VWAP." },
      // a nonsense swing plan: the stop is above the entry
      { horizon: "swing", action: "long", entry_type: "breakout", entry: r5(L + 0.2 * A), stop: r5(L + 1.5 * A), targets: [r5(L + 3 * A)], rationale: "x", invalidation: "y" },
    ]),
  });
  const r = await s.request("POST", "/api/admin/ai/strategy/SBIN", { cookie: s.admin, body: { horizon: "both" } });
  assert.equal(r.status, 200, r.text);
  const out = r.json;
  assert.equal(out.symbol, "SBIN");
  assert.equal(out.stance, "bullish");
  assert.equal(out.model, "claude-opus-5-5");
  assert.equal(out.plans.length, 2);
  assert.equal(out.plans[0].checkStatus, "passed", JSON.stringify(out.plans[0].checks.filter((c) => !c.ok)));
  assert.equal(out.plans[1].checkStatus, "rejected");
  assert.ok(out.plans[1].checks.some((c) => !c.ok && /losing side/.test(c.name)));
  assert.deepEqual(out.usage, { inputTokens: 4200, outputTokens: 650, cacheReadTokens: 0 });
  assert.ok(!r.text.includes(KEY));

  // what went to Anthropic
  const q = s.claude.requests[0];
  assert.match(q.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(q.key, KEY);
  assert.equal(q.body.model, "claude-opus-5-5");
  assert.equal(q.body.output_config.format.type, "json_schema");
  assert.equal(q.body.output_config.effort, "high");
  assert.equal(q.body.fallbacks, "default");
  assert.match(q.beta, /server-side-fallback-2026-07-01/);
  assert.equal(q.body.temperature, undefined, "sampling parameters are rejected by current models");
  assert.equal(q.body.thinking, undefined, "thinking is adaptive by default; no budget is sent");
  assert.equal(q.body.tool_choice, undefined);
  assert.match(q.body.system, /never place orders/);
  const user = q.body.messages[0].content;
  assert.match(user, /Trading-skills file/);
  assert.match(user, /No method wins every trade/);
  const brief = JSON.parse(user.split("Brief for SBIN:\n\n")[1].split("\n\n---")[0]);
  assert.equal(brief.symbol, "SBIN");
  assert.equal(brief.dataSource, "Zerodha Kite");
  assert.equal(brief.price.last, L);
  assert.equal(brief.session.phase, "morning");
  assert.ok(brief.ruleEngine.intraday.call && brief.ruleEngine.swing.stance && brief.ruleEngine.longTerm.stance);
  assert.equal(brief.last30DailyBars.rows.length, 30);
  assert.equal(brief.todayTape5min.rows.length, 16);
  assert.ok(brief.circuit.upper > L);
  assert.ok(!/@|gmail|Vinay/i.test(user), "nothing personal is sent");

  // the same request again within a minute is not paid for twice
  const again = await s.request("POST", "/api/admin/ai/strategy/SBIN", { cookie: s.admin, body: { horizon: "both" } });
  assert.equal(again.json.repeated, true);
  assert.equal(s.claude.requests.length, 1);

  const j = (await s.request("GET", "/api/admin/ai/journal?symbol=SBIN", { cookie: s.admin })).json;
  assert.equal(j.entries.length, 1);
  assert.equal(j.entries[0].id, out.id);
  assert.equal(j.stats.rejected, 1);
  assert.equal(j.stats.pending, 1);
});

test("failures are explained and nothing is journaled: refusal, bad key, cut-off, garbage", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  const go = (sym) => s.request("POST", `/api/admin/ai/strategy/${sym}`, { cookie: s.admin, body: { horizon: "intraday" } });

  s.claude.queue.push({ text: "", stop: "refusal" });
  let r = await go("AAA");
  assert.equal(r.status, 422);
  assert.match(r.json.message, /declined/);

  s.claude.queue.push({ text: '{"stance":"bull', stop: "max_tokens" });
  r = await go("BBB");
  assert.equal(r.json.error, "truncated");

  s.claude.queue.push({ text: "this is not json" });
  r = await go("CCC");
  assert.equal(r.json.error, "bad_output", r.text);

  s.claude.fail = { status: 401, type: "authentication_error", message: "invalid x-api-key" };
  r = await go("DDD");
  assert.equal(r.status, 401);
  assert.match(r.json.message, /rejected the API key/);
  s.claude.fail = { status: 429, type: "rate_limit_error", message: "slow down" };
  r = await go("EEE");
  assert.equal(r.status, 429);
  assert.ok(!r.text.includes(KEY));

  assert.equal((await s.request("GET", "/api/admin/ai/journal", { cookie: s.admin })).json.entries.length, 0);
  assert.equal((await s.request("POST", "/api/admin/ai/strategy/%3Cb%3E", { cookie: s.admin, body: {} })).status, 400);
});

test("score and learn: outcomes come from prices, lessons need three results, and are written to the skills file", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  const L = s.market.last;
  const A = s.market.atr;
  const r5 = (x) => Math.round(x * 20) / 20;
  const stop = r5(L - 0.5 * A);
  const target = r5(L + 0.6 * A);
  const plan = { horizon: "intraday", action: "long", entry_type: "at_market", entry: L, stop, targets: [target], rationale: "Trend day.", invalidation: "Under VWAP." };
  for (const sym of ["AAA", "BBB", "CCC"]) {
    s.claude.queue.push({ json: strategyJson([plan]) });
    const r = await s.request("POST", `/api/admin/ai/strategy/${sym}`, { cookie: s.admin, body: { horizon: "intraday" } });
    assert.equal(r.json.plans[0].checkStatus, "passed", JSON.stringify(r.json.plans[0].checks.filter((c) => !c.ok)));
  }
  assert.equal(s.claude.requests.length, 3);

  // later the same morning: price runs to the target (bars that begin after 10:32)
  s.market.after = tape([L + 0.2 * A, L + 0.45 * A, target + 0.3], "2026-11-12", 16);
  s.clock.ms = at("11:10");
  // nothing has been learned yet and the model has not been asked
  s.claude.queue.push({ json: { observation: "Three trend-day longs taken above VWAP all reached target; three trades prove little.", lessons: ["Keep taking at-market longs only while price holds above VWAP (3 of 3 here)."] } });
  const rev = (await s.request("POST", "/api/admin/ai/review", { cookie: s.admin })).json;
  assert.equal(rev.scored, 3);
  assert.equal(rev.newOutcomes, 3);
  assert.equal(rev.learned, true);
  assert.equal(rev.stats.target, 3);
  assert.equal(rev.stats.winRatePct, 100);
  assert.ok(rev.stats.avgR > 1);
  assert.equal(rev.lessonsAdded.length, 1);
  assert.match(rev.observation, /prove little/);

  // the learning request carried the scored outcomes, not prices to predict
  const q = s.claude.requests[3];
  assert.match(q.body.system, /scoring was done by arithmetic/);
  assert.match(q.body.messages[0].content, /"result":"target"/);
  assert.equal(q.body.output_config.effort, "medium");

  const skills = (await s.request("GET", "/api/admin/ai/skills", { cookie: s.admin })).json;
  assert.equal(skills.lessons, 1);
  assert.match(skills.text, /2026-11-12: Keep taking at-market longs only while price holds above VWAP/);
  assert.match(skills.text, /Risk first/, "the rules above the lessons are untouched");

  // the lesson is part of the next strategy request
  s.clock.ms = at("11:20");
  s.claude.queue.push({ json: strategyJson([{ ...plan, action: "no_trade", entry_type: "none", entry: null, stop: null, targets: [] }], { stance: "neutral" }) });
  await s.request("POST", "/api/admin/ai/strategy/DDD", { cookie: s.admin, body: { horizon: "intraday" } });
  assert.match(s.claude.requests[4].body.messages[0].content, /Keep taking at-market longs only while price holds above VWAP/);

  // a second review finds nothing new and does not call the model again
  const before = s.claude.requests.length;
  const rev2 = (await s.request("POST", "/api/admin/ai/review", { cookie: s.admin })).json;
  assert.equal(rev2.learned, false);
  assert.equal(rev2.newOutcomes, 0);
  assert.match(rev2.why, /at least 3/);
  assert.equal(s.claude.requests.length, before);

  // editing and resetting the skills file
  const put = await s.request("PUT", "/api/admin/ai/skills", { cookie: s.admin, body: { text: "# Mine\n- only trade the first hour" } });
  assert.match(put.json.text, /only trade the first hour/);
  assert.equal((await s.request("PUT", "/api/admin/ai/skills", { cookie: s.admin, body: { text: "" } })).status, 400);
  assert.match((await s.request("POST", "/api/admin/ai/skills/reset", { cookie: s.admin })).json.text, /No method wins every trade/);
});

test("a losing plan is scored as a loss, and a stop-out is what the model is told", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  const L = s.market.last;
  const A = s.market.atr;
  const r5 = (x) => Math.round(x * 20) / 20;
  s.claude.queue.push({ json: strategyJson([{ horizon: "intraday", action: "long", entry_type: "at_market", entry: L, stop: r5(L - 0.5 * A), targets: [r5(L + 0.6 * A)], rationale: "r", invalidation: "i" }]) });
  await s.request("POST", "/api/admin/ai/strategy/AAA", { cookie: s.admin, body: { horizon: "intraday" } });
  s.market.after = tape([L - 0.2 * A, L - 0.7 * A], "2026-11-12", 16);
  s.clock.ms = at("11:00");
  const rev = (await s.request("POST", "/api/admin/ai/review", { cookie: s.admin })).json;
  assert.equal(rev.stats.stop, 1);
  assert.equal(rev.stats.avgR, -1);
  assert.equal(rev.stats.winRatePct, 0);
  assert.equal(rev.learned, false, "one result is not enough to learn from");
  const e = (await s.request("GET", "/api/admin/ai/journal", { cookie: s.admin })).json.entries[0];
  assert.equal(e.plans[0].outcome.status, "stop");
  assert.equal(e.plans[0].outcome.r, -1);
});

test("the AI folder cannot trade: no broker, order or portfolio code, and it never runs on a timer", () => {
  const dir = path.join(__dirname, "..", "ai");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/kite\.trade|\/orders|place_order|placeOrder|\/gtt|\/portfolio|\/margins/i.test(src), `${f} must not touch a broker`);
    assert.ok(!/setInterval|setTimeout|cron/i.test(src), `${f} must only run on request`);
  }
});

test("AiService can be built without a market connection and reports honestly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ai2-"));
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${x}`, decrypt: (x) => x.slice(4) }, market: {} });
  assert.equal(ai.configured(), false);
  ai.setSettings({ apiKey: KEY });
  assert.equal(ai.configured(), true);
  assert.ok(!JSON.stringify(ai.status()).includes(KEY));
  assert.equal(ai.status().stats.total, 0);
});

/* -------------------------------------------------------------- world brief */

const worldJson = {
  mood: "risk_on",
  headline: "US closed higher; crude steady.",
  cues: [
    { name: "S&P 500", value: "not found", change: "+0.6%", as_of: "11 Nov close", read: "positive" },
    { name: "Brent crude", value: "$71", change: "", as_of: "12 Nov morning", read: "neutral" },
  ],
  india_read: "Overseas cues lean supportive for the open.",
  sectors: [{ sector: "IT", bias: "tailwind", why: "Nasdaq strength" }],
  events: ["US CPI at 7:00 PM IST"],
  caveats: ["Asian indices were not found"],
};
const searchBlocks = [
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "S&P 500 close" } },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: [
      { type: "web_search_result", url: "https://example.com/other", title: "Other page", encrypted_content: "y", page_age: null },
      { type: "web_search_result", url: "https://example.com/us-close", title: "Wall Street closes higher", encrypted_content: "x", page_age: "3 hours ago" },
    ],
  },
  { type: "text", text: "US stocks closed higher: the S&P 500 rose 0.6%. ", citations: [{ type: "web_search_result_location", url: "https://example.com/us-close", title: "Wall Street closes higher", cited_text: "rose 0.6%", encrypted_index: "e1" }] },
  { type: "text", text: "Brent crude was near $71." },
];

test("world brief: a web search, then a fixed shape — stored, reused, shown to the strategist, and only 'today' for a day", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  assert.equal((await s.request("GET", "/api/admin/ai/world", { cookie: s.admin })).json.brief, null);

  // the search turn pauses once, then finishes; a third request puts the text into shape
  s.claude.queue.push({ content: [searchBlocks[0]], stop: "pause_turn", usage: { input_tokens: 900, output_tokens: 40, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } });
  s.claude.queue.push({ content: searchBlocks.slice(1), usage: { input_tokens: 15000, output_tokens: 420, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } } });
  s.claude.queue.push({ json: worldJson });
  const r = await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: {} });
  assert.equal(r.status, 200, r.text);
  const b = r.json.brief;
  assert.equal(b.mood, "risk_on");
  assert.equal(b.headline, "US closed higher; crude steady.");
  assert.equal(b.indiaRead, "Overseas cues lean supportive for the open.");
  assert.deepEqual(b.cues[0], { name: "S&P 500", value: "not found", change: "+0.6%", asOf: "11 Nov close", read: "positive" });
  assert.match(b.text, /S&P 500 rose 0\.6%\. Brent crude was near \$71\./);
  assert.deepEqual(b.sources.map((x) => [x.url, x.cited]), [["https://example.com/us-close", true], ["https://example.com/other", false]], "pages the text cites come first");
  assert.deepEqual(b.usage, { inputTokens: 900 + 15000 + 4200, outputTokens: 40 + 420 + 650, searches: 3 });
  assert.ok(!r.text.includes(KEY));

  const [q1, q2, q3] = s.claude.requests;
  // 1: the web search tool, located in India, free text (structured output cannot carry citations)
  assert.deepEqual(q1.body.tools, [{ type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" } }]);
  assert.equal(q1.body.output_config.format, undefined);
  assert.equal(q1.body.tool_choice, undefined);
  assert.match(q1.body.messages[0].content, /It is Thursday 2026-11-12 10:32 India time/);
  assert.match(q1.body.system, /do not recommend trades/);
  // 2: the paused turn is resumed by sending the assistant turn back — nothing is added
  assert.equal(q2.body.messages.length, 2);
  assert.equal(q2.body.messages[1].role, "assistant");
  assert.equal(q2.body.messages[1].content[0].type, "server_tool_use");
  // 3: shaping only — no tools, a schema, and only the text that was found
  assert.equal(q3.body.tools, undefined);
  assert.equal(q3.body.output_config.format.type, "json_schema");
  assert.match(q3.body.messages[0].content, /S&P 500 rose 0\.6%/);
  assert.match(q3.body.system, /never add or correct a number/);

  // reading it is free; asking again within half an hour does not search again
  const got = (await s.request("GET", "/api/admin/ai/world", { cookie: s.admin })).json;
  assert.equal(got.fresh, true);
  assert.equal(got.brief.headline, b.headline);
  const again = (await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: {} })).json;
  assert.equal(again.brief.repeated, true);
  assert.equal(s.claude.requests.length, 3);
  assert.deepEqual((await s.request("GET", "/api/admin/ai/status", { cookie: s.admin })).json.world, { mood: "risk_on", headline: b.headline, at: b.at, time: "10:32" });

  // the strategist is shown it, labelled as web-search material
  s.claude.queue.push({ json: strategyJson([{ horizon: "intraday", action: "no_trade", entry_type: "none", entry: null, stop: null, targets: [], rationale: "r", invalidation: "i" }]) });
  await s.request("POST", "/api/admin/ai/strategy/SBIN", { cookie: s.admin, body: { horizon: "intraday" } });
  const sent = JSON.parse(s.claude.requests[3].body.messages[0].content.split("Brief for SBIN:\n\n")[1].split("\n\n---")[0]);
  assert.equal(sent.worldBrief.mood, "risk_on");
  assert.match(sent.worldBrief.source, /web search — figures can be stale or wrong/);
  assert.match(s.claude.requests[3].body.system, /world-markets brief that was gathered by web search/);

  // "refresh" forces a new search
  s.claude.queue.push({ content: searchBlocks.slice(1), usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } });
  s.claude.queue.push({ json: { ...worldJson, mood: "risk_off", headline: "Turned lower." } });
  const fresh = (await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: { refresh: true } })).json;
  assert.equal(fresh.brief.mood, "risk_off");
  assert.equal(s.claude.requests.length, 6);

  // tomorrow it is still readable, but it no longer counts as today's brief
  s.clock.ms += 24 * 3600 * 1000;
  const next = (await s.request("GET", "/api/admin/ai/world", { cookie: s.admin })).json;
  assert.equal(next.fresh, false);
  assert.equal(next.brief.mood, "risk_off");
  assert.equal((await s.request("GET", "/api/admin/ai/status", { cookie: s.admin })).json.world, null);
});

test("world brief failures: no key, search switched off, a made-up mood — and the basic search tool on Haiku", async (t) => {
  const s = await boot();
  t.after(s.close);
  let r = await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: {} });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "not_configured");
  assert.equal(s.claude.requests.length, 0);
  assert.equal((await s.request("POST", "/api/admin/ai/world", { body: {} })).status, 401);

  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY, model: "claude-haiku-5-5" } });
  // a search that failed arrives as a normal response with an error object and no text
  s.claude.queue.push({ content: [searchBlocks[0], { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }] });
  r = await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: {} });
  assert.equal(r.status, 502);
  assert.equal(r.json.error, "search_failed");
  assert.match(r.json.message, /Web search failed \(unavailable\)/);
  assert.equal(s.claude.requests[0].body.tools[0].type, "web_search_20250305", "Haiku uses the basic search tool");
  assert.equal((await s.request("GET", "/api/admin/ai/world", { cookie: s.admin })).json.brief, null, "nothing is stored from a failed search");

  // whatever the model says, only the three allowed moods are ever stored
  s.claude.queue.push({ content: searchBlocks.slice(1) });
  s.claude.queue.push({ json: { ...worldJson, mood: "to the moon", cues: "nope", sectors: [{ sector: "IT", bias: "buy", why: "x" }] } });
  r = await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.brief.mood, "mixed");
  assert.deepEqual(r.json.brief.cues, []);
  assert.equal(r.json.brief.sectors[0].bias, "watch");

  // a search turn that never finishes is reported, not looped on forever
  s.clock.ms += 31 * 60000;
  for (let i = 0; i < 4; i += 1) s.claude.queue.push({ content: [searchBlocks[0]], stop: "pause_turn" });
  const calls = s.claude.requests.length;
  r = await s.request("POST", "/api/admin/ai/world", { cookie: s.admin, body: { refresh: true } });
  assert.equal(r.status, 504);
  assert.equal(s.claude.requests.length, calls + 4);
});

/* ------------------------------------------------------------ live co-pilot */

const liveJson = (extra = {}) => ({
  headline: "Holding above VWAP; buyers still in control.",
  bias: "up",
  confidence: "medium",
  agrees_with_engine: "yes",
  reading: "Price is above VWAP and the 1-minute tape is making higher lows.",
  what_changed: "",
  watch: ["VWAP — a 1-minute close under it weakens this."],
  caution: "No view of news.",
  ...extra,
});
/** 1-minute bars from 09:15, each opening a little higher than the one before. */
function minuteTape(n, last) {
  return Array.from({ length: n }, (_, i) => {
    const mins = 9 * 60 + 15 + i;
    const o = last * (0.994 + 0.0001 * i);
    return { t: `2026-11-12T${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00+0530`, o, h: o * 1.0003, l: o * 0.9998, c: o * 1.0001, v: 2000 };
  });
}
const flowStub = {
  available: true, at: 0, bid: 100, ask: 100.05, spread: 0.05, spreadTicks: 1, spreadPct: 0.05, mid: 100.03, micro: 100.04, bidQty: 5200, askQty: 2100,
  buyTotal: 410000, sellTotal: 260000, imbalancePct: 43, imbalanceTotalPct: 22, avgBid: 310, avgAsk: 140, wall: null, oneSided: null, pressure: 41,
  label: "Buyers pressing", delta30: 1200, delta60: 2600, delta300: 9100, volume60: 7400, deltaRatio60Pct: 35,
  lean: { dir: "up", upPct: 61, horizonSec: 30, trained: true, samples: 420, needed: 60, calls: 88, hits: 51, hitRatePct: 58, recentRatePct: 60, reliable: true },
};
const snapshotOf = (req) => JSON.parse(req.body.messages[0].content.split("\n\n")[1]);

test("live co-pilot: off without a key; a reading is built from the live snapshot, bounded by a gap and a daily limit, and scored ten minutes on", async (t) => {
  const s = await boot();
  t.after(s.close);
  const live = (body) => s.request("POST", "/api/admin/ai/live/SBIN", { cookie: s.admin, body });
  const view = async () => (await s.request("GET", "/api/admin/ai/live/SBIN", { cookie: s.admin })).json;
  assert.equal((await s.request("GET", "/api/admin/ai/live/SBIN")).status, 401);
  assert.equal((await s.request("POST", "/api/admin/ai/live/SBIN", { body: {} })).status, 401);

  // no key: nothing fetched, nothing spent, and the page is told plainly
  let r = await live({ reason: "switched-on" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "not_configured");
  assert.equal(s.market.calls.length, 0);
  let v = await view();
  assert.equal(v.configured, false);
  assert.deepEqual(v.reads, []);
  assert.deepEqual(v.settings, { minGapSec: 120, dailyCap: 80, refreshMin: 10, model: "" });
  assert.deepEqual(v.usage, { day: "2026-11-12", used: 0, cap: 80, left: 80, inputTokens: 0, outputTokens: 0 });

  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  s.market.minute = minuteTape(78, s.market.last); // 09:15 … 10:32
  s.market.flow = flowStub;
  const engine = (await s.market.verdict("SBIN")).day;
  assert.equal(engine.available, true);

  /* ---- the first reading */
  s.claude.queue.push({ json: liveJson(), usage: { input_tokens: 2600, output_tokens: 180 } });
  r = await live({ reason: "call-change", event: "WAIT · long side → LONG in play" });
  assert.equal(r.status, 200, r.text);
  const first = r.json.read;
  assert.equal(first.bias, "up");
  assert.equal(first.confidence, "medium");
  assert.equal(first.agrees, "yes");
  assert.equal(first.time, "10:32");
  assert.equal(first.price, s.market.last);
  assert.equal(first.reason, "call-change");
  assert.deepEqual(first.engine, { state: engine.state, side: engine.side, score: engine.score, call: engine.headline });
  assert.equal(first.sawOrderBook, true);
  assert.equal(first.sawOneMinute, true);
  assert.equal(first.outcome, null);
  assert.deepEqual(r.json.usage, { day: "2026-11-12", used: 1, cap: 80, left: 79, inputTokens: 2600, outputTokens: 180 });
  assert.equal(r.json.reads.length, 1);
  assert.ok(!r.text.includes(KEY));

  // the request: the co-pilot's own instructions, a schema, low effort, and only market data
  const q = s.claude.requests[0];
  assert.equal(q.body.model, "claude-opus-5-5");
  assert.equal(q.body.max_tokens, 4000);
  assert.equal(q.body.output_config.effort, "low");
  assert.equal(q.body.output_config.format.type, "json_schema");
  assert.deepEqual(q.body.output_config.format.schema.properties.bias.enum, ["up", "down", "unclear"]);
  assert.match(q.body.system, /you never give prices to trade at/);
  assert.match(q.body.system, /Never promise or imply a profit/);
  assert.equal(q.body.tools, undefined);
  assert.equal(q.body.temperature, undefined);
  const snap = snapshotOf(q);
  assert.equal(snap.symbol, "SBIN");
  assert.equal(snap.timeIST, "10:32");
  assert.equal(snap.price.last, s.market.last);
  assert.equal(snap.engine.state, engine.state);
  assert.equal(snap.engine.factors.length, engine.factors.length);
  assert.deepEqual(snap.engine.triggers, { longAbove: engine.triggers.long, shortBelow: engine.triggers.short });
  assert.deepEqual(snap.trigger, { why: "the rule engine's call changed", detail: "WAIT · long side → LONG in play" });
  assert.equal(snap.orderBook.pressure, 41);
  assert.deepEqual(snap.orderBook.thirtySecondLean, { direction: "up", upPct: 61, callsScored: 88, hitRatePct: 58, reliable: true });
  assert.match(snap.oneMinuteTape.trend, /^up/);
  assert.equal(snap.lastOneMinuteBars.rows.length, 12);
  assert.equal(snap.lastOneMinuteBars.rows[11][0], "10:32");
  assert.equal(snap.yourPreviousReading, null);
  assert.equal(snap.companyNews, null);
  assert.ok(!q.body.messages[0].content.includes(SUPERADMIN_EMAIL), "nothing personal is sent");

  /* ---- too soon: nothing is spent, and the page is told how long to wait */
  s.clock.ms += 30000;
  r = await live({ reason: "tripwire", event: "Crossed below VWAP" });
  assert.equal(r.status, 200);
  assert.equal(r.json.skipped, "too-soon");
  assert.equal(r.json.waitSec, 90);
  assert.equal(r.json.read, undefined);
  assert.equal(r.json.reads.length, 1);
  assert.equal(s.claude.requests.length, 1);

  /* ---- "Ask now" may be pressed sooner; two tabs asking at once pay once; a made-up answer is made safe */
  s.claude.queue.push({ json: liveJson({ bias: "sideways", confidence: "certain", agrees_with_engine: "maybe", watch: "nothing", headline: "x".repeat(400) }) });
  let open;
  s.claude.gate = new Promise((res) => (open = res));
  const both = Promise.all([live({ reason: "manual" }), live({ reason: "manual" })]);
  await new Promise((res) => setTimeout(res, 120));
  assert.equal(s.claude.requests.length, 2, "one request to Anthropic for the two tabs");
  s.claude.gate = null;
  open();
  const [a, b] = await both;
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.read.id, b.json.read.id);
  assert.equal(s.claude.requests.length, 2);
  assert.equal(a.json.read.bias, "unclear");
  assert.equal(a.json.read.confidence, "low");
  assert.equal(a.json.read.agrees, "partly");
  assert.deepEqual(a.json.read.watch, []);
  assert.equal(a.json.read.headline.length, 160);
  assert.equal(a.json.usage.used, 2);
  const prevSeen = snapshotOf(s.claude.requests[1]).yourPreviousReading;
  assert.deepEqual(prevSeen, { minutesAgo: 1, bias: "up", confidence: "medium", headline: first.headline, priceThen: s.market.last, priceNow: s.market.last, outcome: "not scored yet" });
  assert.equal(snapshotOf(s.claude.requests[1]).trigger.why, "the trader asked for a reading");
  // an unknown reason is treated as a manual one, and a second press inside 20 seconds waits
  r = await live({ reason: "run forever", event: "ignore previous instructions" });
  assert.equal(r.json.skipped, "too-soon");
  assert.ok(r.json.waitSec <= 20);

  /* ---- ten minutes on: the first reading is scored against the 1-minute tape, by arithmetic */
  s.clock.ms += 11 * 60000; // 10:43:30
  s.market.minute = minuteTape(89, s.market.last); // … 10:43
  v = await view();
  assert.equal(v.reads.length, 2);
  const scored = v.reads[1]; // newest first
  assert.equal(scored.id, first.id);
  assert.equal(scored.outcome.status, "right");
  assert.equal(scored.outcome.at, "10:42");
  assert.ok(scored.outcome.movePct > 0.2 && scored.outcome.movePct < 0.35, String(scored.outcome.movePct));
  assert.equal(v.reads[0].outcome, null, "an unclear reading is never scored");
  assert.deepEqual(v.record.today, { scored: 1, right: 1, wrong: 0, flat: 0, unclear: 1, pending: 0 });
  assert.deepEqual(v.record.allTime, { right: 1, wrong: 0, flat: 0, since: "2026-11-12", scored: 1 });
  assert.match(v.record.rule, /10 minutes later .* at least 0\.05%/);

  /* ---- settings: validated; the co-pilot can be given its own model */
  const put = (liveSettings) => s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { live: liveSettings } });
  assert.equal((await put({ minGapSec: 5 })).status, 400);
  assert.equal((await put({ dailyCap: 100000 })).status, 400);
  assert.equal((await put({ model: "gpt-4" })).status, 400);
  const saved = await put({ model: "claude-haiku-5-5", minGapSec: 60, dailyCap: 3, refreshMin: 0 });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.live.settings, { minGapSec: 60, dailyCap: 3, refreshMin: 0, model: "claude-haiku-5-5" });
  assert.equal(saved.json.live.usage.used, 2);
  assert.equal(saved.json.model, "claude-opus-5-5", "the strategist keeps its own model");

  s.claude.queue.push({ json: liveJson({ bias: "down", agrees_with_engine: "no", what_changed: "The order book flipped." }) });
  r = await live({ reason: "weakening", event: "Dropping fast" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.read.model, "claude-haiku-5-5");
  assert.equal(r.json.model, "claude-haiku-5-5");
  assert.equal(s.claude.requests[2].body.model, "claude-haiku-5-5");
  const third = snapshotOf(s.claude.requests[2]);
  assert.equal(third.yourPreviousReading.bias, "unclear");
  assert.deepEqual(third.yourRecordToday, { scored: 1, right: 1, wrong: 0, flat: 0, unclear: 1, pending: 0 });
  assert.equal(third.trigger.why, "an early warning appeared against the trade in play");

  /* ---- the daily limit stops it, without a request */
  s.clock.ms += 2 * 60000;
  r = await live({ reason: "refresh" });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, "cap_reached");
  assert.match(r.json.message, /all 3 of today's readings/);
  assert.equal(s.claude.requests.length, 3);

  /* ---- after the close there is no live call to read; the "down" at 10:43 is scored as wrong */
  await put({ dailyCap: 10 });
  s.clock.ms = at("18:00");
  s.market.minute = minuteTape(120, s.market.last);
  r = await live({ reason: "manual" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "live_only");
  assert.equal(s.claude.requests.length, 3);
  v = await view();
  assert.equal(v.reads[0].outcome.status, "wrong");
  assert.deepEqual(v.record.allTime, { right: 1, wrong: 1, flat: 0, since: "2026-11-12", scored: 2 });

  /* ---- a new day starts a new count; the running record stays */
  s.clock.ms += 24 * 3600 * 1000;
  v = await view();
  assert.deepEqual(v.reads, []);
  assert.equal(v.usage.used, 0);
  assert.equal(v.usage.day, "2026-11-13");
  assert.deepEqual(v.record.allTime, { right: 1, wrong: 1, flat: 0, since: "2026-11-12", scored: 2 });
  const st = (await s.request("GET", "/api/admin/ai/status", { cookie: s.admin })).json;
  assert.equal(st.live.usage.used, 0);
  assert.equal(st.live.record.allTime.scored, 2);
});

test("live co-pilot: it still reads when the 1-minute tape and the order book are missing, and says what it was not shown", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  s.market.tape = async () => {
    throw new Error("Zerodha is down");
  };
  s.claude.queue.push({ json: liveJson({ bias: "down" }) });
  const r = await s.request("POST", "/api/admin/ai/live/SBIN", { cookie: s.admin, body: { reason: "switched-on" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.read.sawOrderBook, false);
  assert.equal(r.json.read.sawOneMinute, false);
  const snap = snapshotOf(s.claude.requests[0]);
  assert.equal(snap.orderBook, null);
  assert.equal(snap.oneMinuteTape, null);
  assert.equal(snap.lastOneMinuteBars, null);
  // a refusal or a cut-off answer is reported and nothing is recorded or counted
  s.clock.ms += 5 * 60000;
  s.claude.queue.push({ text: "", stop: "refusal" });
  const bad = await s.request("POST", "/api/admin/ai/live/SBIN", { cookie: s.admin, body: { reason: "manual" } });
  assert.equal(bad.status, 422);
  const v = (await s.request("GET", "/api/admin/ai/live/SBIN", { cookie: s.admin })).json;
  assert.equal(v.reads.length, 1);
  assert.equal(v.usage.used, 1);
  // with no tape, a reading that has come due simply stays pending
  s.clock.ms += 20 * 60000;
  const later = (await s.request("GET", "/api/admin/ai/live/SBIN", { cookie: s.admin })).json;
  assert.equal(later.reads[0].outcome, null);
  assert.equal(later.record.today.pending, 1);
});

/* ------------------------------------------------------------ company news */

const newsJson = {
  tone: "positive",
  headline: "Won a large order on 11 Nov; results are due on 14 Nov.",
  explains_move: "partly",
  items: [{ date: "11 Nov 2026", what: "Order win reported in an exchange filing", read: "positive" }],
  upcoming: ["Q2 results on 14 Nov 2026"],
  caveats: ["The size of the order was not confirmed"],
};

test("company news: a web search on one company — shaped, stored, reused for half an hour, and shown to the strategist and the co-pilot", async (t) => {
  const s = await boot();
  t.after(s.close);
  const post = (body = {}) => s.request("POST", "/api/admin/ai/news/SBIN", { cookie: s.admin, body });
  const get = async () => (await s.request("GET", "/api/admin/ai/news/SBIN", { cookie: s.admin })).json;
  assert.equal((await s.request("GET", "/api/admin/ai/news/SBIN")).status, 401);
  assert.equal((await s.request("POST", "/api/admin/ai/news/SBIN", { body: {} })).status, 401);
  assert.deepEqual(await get(), { news: null, fresh: false, configured: false });
  let r = await post();
  assert.equal(r.status, 409);
  assert.equal(s.claude.requests.length, 0);
  assert.equal((await s.request("POST", "/api/admin/ai/news/bad%20symbol!", { cookie: s.admin, body: {} })).status, 400);

  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  s.claude.queue.push({ content: searchBlocks.slice(1), usage: { input_tokens: 9000, output_tokens: 300, server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } } });
  s.claude.queue.push({ json: newsJson });
  r = await post();
  assert.equal(r.status, 200, r.text);
  const n = r.json.news;
  assert.equal(n.symbol, "SBIN");
  assert.equal(n.name, "STATE BANK OF INDIA");
  assert.equal(n.tone, "positive");
  assert.equal(n.explainsMove, "partly");
  assert.deepEqual(n.items, [{ date: "11 Nov 2026", what: "Order win reported in an exchange filing", read: "positive" }]);
  assert.deepEqual(n.upcoming, ["Q2 results on 14 Nov 2026"]);
  assert.equal(n.sources[0].url, "https://example.com/us-close");
  assert.deepEqual(n.usage, { inputTokens: 9000 + 4200, outputTokens: 300 + 650, searches: 3 });
  assert.ok(n.move.changePct > 1.5 && n.move.changePct < 1.6);

  const [q1, q2] = s.claude.requests;
  assert.equal(q1.body.tools[0].type, "web_search_20260209");
  assert.equal(q1.body.tools[0].max_uses, 5);
  assert.match(q1.body.messages[0].content, /^Company: STATE BANK OF INDIA \(NSE symbol SBIN\)\. It is Thursday 2026-11-12 10:32 India time\. The share is at [\d.]+, up 1\.5\d% against the previous close\. Check the news\.$/);
  assert.match(q1.body.system, /Do not predict the price and do not recommend a trade/);
  assert.ok(!q1.body.messages[0].content.includes(SUPERADMIN_EMAIL));
  assert.equal(q2.body.tools, undefined);
  assert.equal(q2.body.output_config.format.type, "json_schema");
  assert.match(q2.body.system, /never add one/);

  // free to read; asking again within half an hour does not search again
  assert.equal((await get()).fresh, true);
  assert.equal((await post()).json.news.repeated, true);
  assert.equal(s.claude.requests.length, 2);

  // the strategist is shown it, labelled as web-search material…
  s.claude.queue.push({ json: strategyJson([{ horizon: "intraday", action: "no_trade", entry_type: "none", entry: null, stop: null, targets: [], rationale: "r", invalidation: "i" }]) });
  await s.request("POST", "/api/admin/ai/strategy/SBIN", { cookie: s.admin, body: { horizon: "intraday" } });
  const brief = JSON.parse(s.claude.requests[2].body.messages[0].content.split("Brief for SBIN:\n\n")[1].split("\n\n---")[0]);
  assert.equal(brief.companyNews.tone, "positive");
  assert.deepEqual(brief.companyNews.scheduled, ["Q2 results on 14 Nov 2026"]);
  assert.match(brief.companyNews.source, /web search — can be stale, incomplete or wrong/);
  assert.match(s.claude.requests[2].body.system, /company-news check gathered by web search/);
  // …and so is the co-pilot, in one line
  s.claude.queue.push({ json: liveJson() });
  await s.request("POST", "/api/admin/ai/live/SBIN", { cookie: s.admin, body: { reason: "manual" } });
  assert.deepEqual(snapshotOf(s.claude.requests[3]).companyNews, { tone: "positive", headline: newsJson.headline, explainsTodaysMove: "partly", gatheredAt: "10:32", source: "web search — can be stale or wrong" });

  // whatever the model says, only the allowed values are stored
  s.claude.queue.push({ content: searchBlocks.slice(1) });
  s.claude.queue.push({ json: { ...newsJson, tone: "to the moon", explains_move: "definitely", items: [{ date: 5, what: "x", read: "buy" }, null], upcoming: "soon" } });
  r = await post({ refresh: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.news.tone, "neutral");
  assert.equal(r.json.news.explainsMove, "unknown");
  assert.deepEqual(r.json.news.items, [{ date: "5", what: "x", read: "neutral" }, { date: "", what: "", read: "neutral" }]);
  assert.deepEqual(r.json.news.upcoming, []);

  // a failed search stores nothing new
  s.clock.ms += 31 * 60000;
  s.claude.queue.push({ content: [searchBlocks[0], { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }] });
  r = await post();
  assert.equal(r.status, 502);
  assert.equal((await get()).news.tone, "neutral");

  // seven hours on it is still readable, but no longer passed to the model as current
  s.clock.ms += 7 * 3600 * 1000;
  const old = await get();
  assert.equal(old.fresh, false);
  assert.equal(old.news.tone, "neutral");
});

/* ------------------------------------------------------------- day debrief */

/** A scorecard for one real replay (the engine run over a made-up full session) and one stock with no bars. */
function cardFor(market) {
  const a = analyze(market.candles, { chartBars: 1 });
  const atr = a.levels.atr.value;
  const prices = [];
  for (let i = 0; i < 75; i += 1) {
    const trend = i < 6 ? 0.1 * Math.sin(i) : i < 30 ? 0.035 * (i - 6) : i < 42 ? 0.84 - 0.06 * (i - 30) : 0.12 + 0.03 * (i - 42);
    prices.push(market.pc * (1.002 + (trend * atr) / market.pc));
  }
  const rep = replayDay({ analysis: a, candles: market.candles, bars: tape(prices), prior: [] });
  const rows = [{ symbol: "SBIN", source: "kite", stale: false, today: true, ...rep }, { symbol: "DEAD", available: false, reason: "Zerodha returned no 5-minute bars for this symbol." }];
  return { available: true, at: "2026-11-12T10:15:00.000Z", date: "2026-11-12", today: true, complete: true, costPct: 0.1, rows, ...combine(rows) };
}
const debriefJson = (extra = {}) => ({
  headline: "Three calls on one stock; costs took most of a small gross gain.",
  summary: "The replayed engine made three calls on SBIN. Before costs they added up to a small gain; after the assumed 0.1% a round trip, to a loss.",
  what_worked: ["The 10:10 long reached its 1R target within half an hour."],
  what_did_not: ["The 9:45 short against the daily trend was stopped within fifteen minutes."],
  by_stock: [{ symbol: "sbin", note: "Three calls; the tight stops made costs a large share of the risk." }, { symbol: "TSLA", note: "Not on the desk." }],
  copilot_note: "One reading, not yet scored.",
  lessons: ["Skip a call whose stop is closer than three times the assumed cost.", "Do not short in the first half hour against the daily trend.", "Third.", "Fourth — one too many."],
  watch_tomorrow: ["SBIN: today's high and the VWAP at the close."],
  caveat: "A replay at 5-minute closes is not what was seen live, and one day proves nothing.",
  ...extra,
});

test("day debrief: the scorecard is read back by the model — only arithmetic goes in, lessons are saved only when accepted", async (t) => {
  const s = await boot();
  t.after(s.close);
  const post = (body = {}) => s.request("POST", "/api/admin/ai/debrief", { cookie: s.admin, body });
  for (const [m, p] of [["GET", "/api/admin/ai/debrief"], ["POST", "/api/admin/ai/debrief"], ["POST", "/api/admin/ai/debrief/abc/lesson"]]) {
    assert.equal((await s.request(m, p, { body: m === "GET" ? undefined : {} })).status, 401, `${m} ${p}`);
  }
  // no key: stored debriefs can be listed (none yet), nothing is replayed, nothing is spent
  assert.deepEqual((await s.request("GET", "/api/admin/ai/debrief", { cookie: s.admin })).json, { configured: false, debriefs: [] });
  let r = await post();
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "not_configured");
  assert.equal(s.market.calls.length, 0);

  await s.request("PUT", "/api/admin/ai/settings", { cookie: s.admin, body: { apiKey: KEY } });
  // nothing to debrief: said plainly, and no request is made
  r = await post();
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "no_data");
  assert.match(r.json.message, /watchlist is empty/);
  assert.equal(s.claude.requests.length, 0);

  // a session with a co-pilot reading and a strategist plan in it
  s.market.card = cardFor(s.market);
  const rep = s.market.card.rows[0];
  assert.ok(rep.summary.calls >= 2, "the made-up session produces calls");
  s.claude.queue.push({ json: liveJson() });
  await s.request("POST", "/api/admin/ai/live/SBIN", { cookie: s.admin, body: { reason: "manual" } });
  s.claude.queue.push({ json: strategyJson([{ horizon: "intraday", action: "no_trade", entry_type: "none", entry: null, stop: null, targets: [], rationale: "r", invalidation: "i" }]) });
  await s.request("POST", "/api/admin/ai/strategy/SBIN", { cookie: s.admin, body: { horizon: "intraday" } });
  assert.equal(s.claude.requests.length, 2);

  s.claude.queue.push({ json: debriefJson(), usage: { input_tokens: 5200, output_tokens: 700 } });
  r = await post();
  assert.equal(r.status, 200, r.text);
  const d = r.json.debrief;
  assert.equal(d.day, "2026-11-12");
  assert.equal(d.complete, true);
  assert.equal(d.headline, debriefJson().headline);
  assert.deepEqual(d.worked, debriefJson().what_worked);
  assert.deepEqual(d.didNot, debriefJson().what_did_not);
  assert.deepEqual(d.byStock, [{ symbol: "SBIN", note: "Three calls; the tight stops made costs a large share of the risk." }], "a note on a stock that was not in the facts is dropped");
  assert.deepEqual(d.lessons.map((x) => x.added), [false, false, false], "at most three lessons, none saved yet");
  assert.equal(d.lessons[2].text, "Third.");
  assert.deepEqual(d.totals, s.market.card.totals);
  assert.equal(d.stocks, 1);
  assert.equal(d.sawCopilot, true);
  assert.equal(d.sawPlans, 1);
  assert.deepEqual(d.usage, { inputTokens: 5200, outputTokens: 700, cacheReadTokens: 0 });
  assert.equal(r.json.debriefs.length, 1);
  assert.equal(r.json.configured, true);
  assert.ok(!r.text.includes(KEY));
  assert.ok(!/No lesson|Fourth/.test(JSON.stringify(d.lessons)));
  assert.ok(!s.made.ai.playbook.read().includes("Skip a call"), "nothing is written to the skills file by the debrief itself");

  // the request: its own instructions, a schema, medium effort — and only the facts
  const q = s.claude.requests[2];
  assert.equal(q.body.output_config.effort, "medium");
  assert.equal(q.body.output_config.format.type, "json_schema");
  assert.equal(q.body.max_tokens, 8000);
  assert.equal(q.body.tools, undefined);
  assert.match(q.body.system, /The replay is not a record of what the trader did/);
  assert.match(q.body.system, /Never promise or imply a profit/);
  assert.match(q.body.messages[0].content, /^Facts for the session of 2026-11-12:/);
  const facts = JSON.parse(q.body.messages[0].content.split("\n\n")[1]);
  assert.equal(facts.session, "2026-11-12");
  assert.equal(facts.sessionComplete, true);
  assert.equal(facts.assumedCostPctPerRoundTrip, 0.1);
  assert.deepEqual(facts.totals, s.market.card.totals);
  assert.equal(facts.stocks.length, 1);
  assert.equal(facts.stocks[0].symbol, "SBIN");
  assert.equal(facts.stocks[0].calls.length, rep.trades.length);
  assert.deepEqual(Object.keys(facts.stocks[0].calls[0]), ["side", "at", "sessionPhase", "engineScore", "dailyTrend", "entry", "stop", "target", "riskPct", "endedAt", "exit", "how", "r", "costR", "netR"]);
  assert.equal(facts.stocks[0].result.netR, rep.summary.netR);
  assert.equal(facts.stocks[0].callChanges, rep.changes.length);
  assert.equal(facts.everyFinishedCallInOrder.length, s.market.card.curve.length);
  assert.deepEqual(facts.notReplayed, [{ symbol: "DEAD", why: "Zerodha returned no 5-minute bars for this symbol." }]);
  assert.equal(facts.copilot.readings, 1);
  assert.equal(facts.copilot.list[0].symbol, "SBIN");
  assert.equal(facts.copilot.list[0].bias, "up");
  assert.equal(facts.strategistPlans.length, 1);
  assert.deepEqual([facts.strategistPlans[0].symbol, facts.strategistPlans[0].action, facts.strategistPlans[0].madeAt], ["SBIN", "no_trade", "10:32"]);
  assert.equal(facts.marketAtTheTimeOfWriting.tide.score, 40);
  assert.match(facts.howTheReplayWorks, /stop is checked first/);
  assert.ok(!q.body.messages[0].content.includes(SUPERADMIN_EMAIL), "nothing personal is sent");

  // pressed again within ten minutes: the stored debrief, no request; "refresh" writes a new one in its place
  r = await post();
  assert.equal(r.json.debrief.repeated, true);
  assert.equal(r.json.debrief.id, d.id);
  assert.equal(s.claude.requests.length, 3);
  s.claude.queue.push({ json: debriefJson({ headline: "Second look.", lessons: "none", by_stock: "nope", what_worked: null }) });
  r = await post({ refresh: true });
  assert.equal(r.status, 200, r.text);
  const d2 = r.json.debrief;
  assert.equal(d2.headline, "Second look.");
  assert.deepEqual([d2.lessons, d2.byStock, d2.worked], [[], [], []], "a malformed list becomes an empty one");
  assert.notEqual(d2.id, d.id);
  assert.equal(r.json.debriefs.length, 1, "one debrief per session");
  assert.equal(s.claude.requests.length, 4);

  // the cost assumption chosen on the page is the one the scorecard is asked for
  assert.equal(s.market.calls.filter((c) => c.startsWith("scorecard")).pop(), "scorecard default");
  await post({ cost: 0.2 });
  assert.equal(s.market.calls.filter((c) => c.startsWith("scorecard")).pop(), "scorecard 0.2");
  assert.equal(s.claude.requests.length, 4, "the stored debrief is reused: the stub's card did not change its cost");

  // a refusal is reported and the stored debrief stays
  s.claude.queue.push({ text: "", stop: "refusal" });
  assert.equal((await post({ refresh: true })).status, 422);
  assert.equal((await s.request("GET", "/api/admin/ai/debrief", { cookie: s.admin })).json.debriefs[0].id, d2.id);

  // lessons: accepted one at a time, written once, dated with the session
  s.claude.queue.push({ json: debriefJson() });
  const d3 = (await post({ refresh: true })).json.debrief;
  const lesson = (id, index) => s.request("POST", `/api/admin/ai/debrief/${id}/lesson`, { cookie: s.admin, body: { index } });
  assert.equal((await lesson("nope", 0)).status, 404);
  assert.equal((await lesson(d3.id, 7)).status, 400);
  assert.equal((await lesson(d3.id, "x")).status, 400);
  r = await lesson(d3.id, 1);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.debrief.lessons.map((x) => x.added), [false, true, false]);
  assert.equal(r.json.lessons, 1);
  assert.deepEqual(s.made.ai.playbook.lessons(), ["2026-11-12: Do not short in the first half hour against the daily trend."]);
  r = await lesson(d3.id, 1);
  assert.equal(r.json.lessons, 1, "pressing twice does not write it twice");
  assert.equal((await s.request("GET", "/api/admin/ai/debrief", { cookie: s.admin })).json.debriefs[0].lessons[1].added, true);

  // the next morning, before the open: yesterday's session can still be debriefed, co-pilot readings included
  s.clock.ms += 20 * 3600 * 1000;
  s.market.card = { ...s.market.card, today: false };
  s.claude.queue.push({ json: debriefJson({ headline: "Morning after." }) });
  r = await post({ refresh: true });
  assert.equal(r.status, 200, r.text);
  const late = JSON.parse(s.claude.requests[s.claude.requests.length - 1].body.messages[0].content.split("\n\n")[1]);
  assert.equal(late.session, "2026-11-12");
  assert.equal(late.copilot.readings, 1, "the last day's readings are kept for exactly this");
  assert.equal(late.marketAtTheTimeOfWriting, null, "the market's direction now says nothing about yesterday");
  assert.equal(r.json.debriefs.length, 1);
});
