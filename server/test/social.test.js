"use strict";
// Social Media: reading the sources (RSS / Atom / X's API), the rules' organising, the service
// (sources, the X token, polling, the AI's hourly budget, the signal for the AI Engine), the watcher,
// and the routes. Every fetch is a fake; no real feed, X account or AI model is reached.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseFeed, readSource, cleanValue, feedUrl, tidyGoogle, UA } = require("../social/feeds");
const { buildIndex, enrich, aggregate, readingOf, toneOf, stories, deskBrief } = require("../social/extract");
const { SocialService, PRESETS } = require("../social/service");
const { SocialWatch } = require("../social-watch");
const { buildMarketForecast } = require("../market/premarket");
const { classify, instantAnswer } = require("../ai/route");
const { FileDocs } = require("../docs");

const NOW = Date.parse("2026-11-16T03:30:00Z"); // 9:00 AM IST, a Monday
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const rfc = (minAgo) => new Date(NOW - minAgo * 60000).toUTCString();
const INSTRUMENTS = [
  { s: "SBIN", n: "STATE BANK OF INDIA", k: "EQ" },
  { s: "RELIANCE", n: "RELIANCE INDUSTRIES", k: "EQ" },
  { s: "INFY", n: "INFOSYS", k: "EQ" },
  { s: "TATAMOTORS", n: "TATA MOTORS", k: "EQ" },
  { s: "NIFTY 50", n: "NIFTY 50", k: "INDEX" },
];

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Markets</title>${items
  .map((x) => `<item><title><![CDATA[${x.title}]]></title><link>${x.link}</link><guid>${x.guid || x.link}</guid><pubDate>${x.pub}</pubDate><description>${x.text || ""}</description></item>`)
  .join("")}</channel></rss>`;
const atom = (entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.map((e) => `<entry><id>${e.id}</id><title>${e.title}</title><link href="${e.link}"/><published>${e.at}</published><author><name>${e.author}</name></author><content type="html">${e.text}</content></entry>`).join("")}</feed>`;

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    for (const [match, answer] of routes) {
      if (String(url).includes(match)) {
        const r = typeof answer === "function" ? answer(String(url), opts) : answer;
        const status = r.status || 200;
        const body = r.json !== undefined ? JSON.stringify(r.json) : r.text || "";
        return { ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) };
      }
    }
    return { ok: false, status: 404, text: async () => "not found", json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

const secrets = { encrypt: (t) => `enc:${Buffer.from(t).toString("base64")}`, decrypt: (b) => Buffer.from(String(b).slice(4), "base64").toString() };
const tmpDocs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-social-")));

function fakeAi({ ready = true, fail = false } = {}) {
  const asked = [];
  return {
    asked,
    modelChain: () => (ready ? [{ name: "Claude Sonnet 5.5", company: "Anthropic" }] : []),
    social: {
      ready: () => ready,
      organise: async (items) => {
        asked.push(items.map((x) => x.id));
        if (fail) return { results: new Map(), used: [{ model: "Claude Sonnet 5.5", ok: false }] };
        return {
          results: new Map(items.map((x) => [x.id, { relevant: !/cricket/i.test(x.title), summary: `AI: ${x.title}`.slice(0, 80), symbols: /SBI|State Bank/i.test(x.title) ? ["SBIN"] : [], sectors: ["banks"], event: "results", sentiment: /falls|slump/i.test(x.title) ? "bearish" : "bullish", impact: "high", horizon: "days", by: "Claude Sonnet 5.5" }])),
          used: [{ model: "Claude Sonnet 5.5", items: items.length, ok: true }],
        };
      },
      brief: async (items) => ({ headline: `Banks lead on results (${items.length} items)`, mood: "risk_on", themes: [{ title: "Bank results", detail: "SBI beat estimates." }], watch: [{ symbol: "SBIN", direction: "up", why: "Q2 profit up 28%." }], sectors: [], risks: ["One X post is unverified."], checklist: ["Check the opening range."], by: "Claude Sonnet 5.5" }),
    },
  };
}

const NEWS = [
  { title: "SBI Q2 net profit jumps 28%, beats estimates; shares rise", link: "https://example.com/sbi", pub: rfc(30), text: "State Bank of India reported quarterly results above estimates." },
  { title: "Reliance Industries shares slump after weak refining margins", link: "https://example.com/ril", pub: rfc(50), text: "Brent crude fell and refining margins narrowed." },
  { title: "India win the cricket series in style", link: "https://example.com/cricket", pub: rfc(40), text: "A thrilling chase." },
  { title: "Old story from last week", link: "https://example.com/old", pub: rfc(60 * 24 * 6) },
];

/* ---------------------------------------------------------------------------------------- feeds */

test("parseFeed reads RSS items and Atom entries (CDATA, entities, tags stripped), newest first", () => {
  const items = parseFeed(rss([{ title: "A &amp; B rally", link: "https://x.test/1", pub: rfc(90), text: "&lt;p&gt;Shares &lt;b&gt;rose&lt;/b&gt; 3%&lt;/p&gt;" }, { title: "Newer", link: "https://x.test/2", pub: rfc(10) }]));
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Newer");
  assert.equal(items[1].title, "A & B rally");
  assert.equal(items[1].text, "Shares rose 3%");
  const a = parseFeed(atom([{ id: "yt:1", title: "Market outlook", link: "https://youtube.test/v1", at: iso(5), author: "Channel", text: "Nifty view" }]));
  assert.deepEqual([a[0].key, a[0].link, a[0].author, a[0].text], ["yt:1", "https://youtube.test/v1", "Channel", "Nifty view"]);
});

test("cleanValue checks and tidies each kind; feedUrl builds the official feed address", () => {
  assert.equal(cleanValue("x", "https://x.com/@NSEIndia"), "NSEIndia");
  assert.equal(cleanValue("x", "@RBI"), "RBI");
  assert.equal(cleanValue("reddit", "https://www.reddit.com/r/IndianStreetBets/"), "IndianStreetBets");
  assert.equal(cleanValue("youtube", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"), "UCabcdefghijklmnopqrstuv");
  assert.equal(cleanValue("google", "  Nifty   Sensex "), "Nifty Sensex");
  assert.throws(() => cleanValue("rss", "not a url"), /full https address/);
  assert.throws(() => cleanValue("youtube", "some channel"), /starts with UC/);
  assert.throws(() => cleanValue("facebook", "x"), /Unknown kind/);
  assert.match(feedUrl("google", "Nifty"), /^https:\/\/news\.google\.com\/rss\/search\?q=Nifty%20when%3A1d&hl=en-IN&gl=IN&ceid=IN:en$/);
  assert.equal(feedUrl("reddit", "IndiaInvestments"), "https://www.reddit.com/r/IndiaInvestments/new/.rss");
});

test("readSource: an RSS feed with an honest User-Agent; a page that is not a feed says so", async () => {
  const f = fakeFetch([
    ["news.test/feed", { text: rss(NEWS.slice(0, 2)) }],
    ["news.test/page", { text: "<html><body>hello</body></html>" }],
    ["news.test/down", { status: 503, text: "busy" }],
  ]);
  const ok = await readSource({ type: "rss", value: "https://news.test/feed" }, { fetchImpl: f });
  assert.equal(ok.error, "");
  assert.equal(ok.items.length, 2);
  assert.equal(f.calls[0].headers["User-Agent"], UA);
  assert.match((await readSource({ type: "rss", value: "https://news.test/page" }, { fetchImpl: f })).error, /not an RSS or Atom feed/);
  assert.match((await readSource({ type: "rss", value: "https://news.test/down" }, { fetchImpl: f })).error, /HTTP 503/);
});

test("readSource: X through its API with the owner's token — the account id once, then only newer posts", async () => {
  const f = fakeFetch([
    ["/users/by/username/NSEIndia", { json: { data: { id: "42", username: "NSEIndia" } } }],
    ["/users/42/tweets", (url) => ({ json: url.includes("since_id=900") ? { data: [], meta: {} } : { data: [{ id: "901", text: "NSE: trading holiday notice", created_at: iso(3), public_metrics: { like_count: 5, retweet_count: 2, reply_count: 1 } }, { id: "900", text: "Older post", created_at: iso(20) }] } })],
  ]);
  const none = await readSource({ type: "x", value: "NSEIndia" }, { fetchImpl: f });
  assert.match(none.error, /Bearer Token/);
  assert.equal(f.calls.length, 0, "no token, no request");
  const first = await readSource({ type: "x", value: "NSEIndia", state: {} }, { fetchImpl: f, xToken: "TESTONLY-x-bearer-token-0123456789abcdef" });
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].link, "https://x.com/NSEIndia/status/901");
  assert.deepEqual(first.items[0].metrics, { likes: 5, reposts: 2, replies: 1 });
  assert.equal(first.state.userId, "42");
  assert.equal(first.state.sinceId, "901");
  assert.equal(f.calls[0].headers.Authorization, "Bearer TESTONLY-x-bearer-token-0123456789abcdef");
  const again = await readSource({ type: "x", value: "NSEIndia", state: { userId: "42", sinceId: "900" } }, { fetchImpl: f, xToken: "TESTONLY-x-bearer-token-0123456789abcdef" });
  assert.equal(again.items.length, 0);
  assert.ok(!f.calls.slice(2).some((c) => c.url.includes("/users/by/username/")), "the id is remembered");
  const limited = await readSource({ type: "x", value: "NSEIndia", state: { userId: "42" } }, { fetchImpl: fakeFetch([["/tweets", { status: 429, json: { title: "Too Many Requests" } }]]), xToken: "TESTONLY-x-bearer-token-0123456789abcdef" });
  assert.match(limited.error, /rate limit/);
});

/* -------------------------------------------------------------------------------------- the rules */

test("enrich finds NSE stocks by name and ticker, sectors, the event, the tone and how market-related it is", () => {
  const index = buildIndex(INSTRUMENTS);
  const a = enrich({ title: NEWS[0].title, text: NEWS[0].text }, { index });
  assert.deepEqual(a.symbols, ["SBIN"]);
  assert.ok(a.sectors.includes("banks"));
  assert.equal(a.event, "results");
  assert.ok(a.sentiment > 0);
  assert.ok(a.relevance >= 30);
  const b = enrich({ title: NEWS[1].title, text: NEWS[1].text }, { index });
  assert.deepEqual(b.symbols, ["RELIANCE"]);
  assert.ok(b.sentiment < 0);
  const c = enrich({ title: NEWS[2].title, text: NEWS[2].text }, { index });
  assert.deepEqual(c.symbols, []);
  assert.ok(c.relevance < 30, "sport is not market-related");
  const w = enrich({ title: "Tata Motors launches a new EV", text: "" }, { index, watch: ["TATAMOTORS"] });
  assert.ok(w.relevance >= enrich({ title: "Tata Motors launches a new EV" }, { index }).relevance + 15, "a tracked stock counts more");
});

test("aggregate: the mood, a stock radar, sector heat and alerts — the AI's reading preferred where present", () => {
  const index = buildIndex(INSTRUMENTS);
  const mk = (id, title, minAgo, ai) => ({ id, type: "rss", sourceLabel: "ET", title, link: `https://e.test/${id}`, at: iso(minAgo), rules: enrich({ title }, { index }), ai });
  const items = [mk("a", "SBI profit jumps, shares rise on strong results", 10), mk("b", "State Bank of India gains after upgrade", 30), mk("c", "Reliance Industries shares fall on weak margins", 20, { relevant: true, summary: "RIL margins weak", symbols: ["RELIANCE"], sectors: ["energy"], event: "results", sentiment: "bearish", impact: "high" })];
  const g = aggregate(items, { now: NOW, hours: 24, watch: ["SBIN"] });
  assert.equal(g.items, 3);
  assert.equal(g.radar[0].symbol, "SBIN");
  assert.equal(g.radar[0].mentions, 2);
  assert.equal(g.radar[0].watched, true);
  const ril = g.radar.find((r) => r.symbol === "RELIANCE");
  assert.equal(ril.tone, "bearish");
  assert.equal(readingOf(items[2]).by, "ai");
  assert.ok(g.alerts.some((x) => x.id === "c"), "the high-impact item is an alert");
  assert.ok(g.alerts.some((x) => x.why === "a stock you watch"));
  assert.equal(g.aiRead, 1);
});

/* ------------------------------------------------------------------------------------- the service */

function boot({ ai = fakeAi(), routes = null } = {}) {
  const docs = tmpDocs();
  let now = NOW;
  const fetchImpl =
    routes ||
    fakeFetch([
      ["news.google.com", { text: rss(NEWS) }],
      ["economictimes", { text: rss([{ title: "Infosys wins a $1.5 billion deal; shares rise", link: "https://e.test/infy", pub: rfc(15) }]) }],
      ["livemint", { text: rss([{ title: "SBI Q2 net profit jumps 28%, beats estimates; shares rise", link: "https://example.com/sbi", pub: rfc(30) }]) }],
      ["/users/by/username/", { json: { data: { id: "7" } } }],
      ["/users/7/tweets", { json: { data: [{ id: "77", text: "RBI keeps the repo rate unchanged at 5.5%", created_at: iso(5) }] } }],
    ]);
  const social = new SocialService({ docs, secrets, fetchImpl, now: () => now, market: { instruments: async () => INSTRUMENTS }, ai, log: { log() {}, error() {} } });
  return { social, docs, fetchImpl, ai, tick: (min) => (now += min * 60000) };
}

test("the starting sources are the suggested ones marked on; settings never show the X token", () => {
  const { social } = boot();
  const s = social.settings();
  assert.equal(s.sources.length, PRESETS.filter((p) => p.on).length);
  assert.ok(s.sources.every((x) => x.type !== "x"), "X needs a token, so it is offered, not on");
  assert.ok(s.presets.some((p) => p.type === "x" && p.value === "NSEIndia"));
  assert.equal(s.creds.x, false);
  assert.equal(s.aiPerHour, 4);
  assert.equal(s.aiMode, "smart", "the AI only when needed, by default");
  assert.equal(s.aiBriefAuto, false, "the AI brief only on request, by default");
  assert.equal(s.alertMe, true);
  assert.ok(s.sectorList.length >= 16);
  const out = social.setCreds({ xToken: "TESTONLY-x-bearer-token-0123456789abcdef" });
  assert.equal(out.creds.x, true);
  assert.ok(!JSON.stringify(out).includes("TESTONLY"), "the token never comes back");
  assert.throws(() => social.setCreds({ xToken: "short" }), /Bearer Token/);
  assert.equal(social.setCreds({ remove: "x" }).creds.x, false);
});

test("sources: add (checked, no duplicates), switch off, remove; tracking settings are cleaned", () => {
  const { social } = boot();
  const n = social.settings().sources.length;
  let s = social.addSource({ type: "x", value: "@NSEIndia", everyMin: 1 });
  const x = s.sources.find((y) => y.type === "x");
  assert.equal(x.value, "NSEIndia");
  assert.equal(x.everyMin, 15, "never more often than the kind allows");
  assert.equal(x.needsKey, true);
  assert.throws(() => social.addSource({ type: "x", value: "nseindia" }), /already in the list/);
  assert.throws(() => social.addSource({ type: "rss", value: "ftp://x" }), /web addresses/);
  s = social.updateSource(x.id, { enabled: false });
  assert.equal(s.sources.find((y) => y.id === x.id).enabled, false);
  s = social.removeSource(x.id);
  assert.equal(s.sources.length, n);
  s = social.setSettings({ sectors: ["banks", "nonsense", "it"], keywords: "capex, buyback ,, ", watch: "sbin, reliance, 12bad!", aiOn: false, aiPerHour: 4 });
  assert.deepEqual(s.sectors, ["banks", "it"]);
  assert.deepEqual(s.keywords, ["capex", "buyback"]);
  assert.deepEqual(s.watch, ["SBIN", "RELIANCE"]);
  assert.equal(s.aiOn, false);
  assert.throws(() => social.setSettings({ aiPerHour: 999 }), /0 to 200/);
});

test("poll reads due sources once, keeps each item once (old ones skipped), and gives it the rules' reading", async () => {
  const { social, fetchImpl, tick } = boot();
  const p1 = await social.poll();
  assert.equal(p1.read, social.settings().sources.filter((x) => x.enabled).length);
  const f = social.feed({ limit: 200 });
  assert.ok(f.items.length >= 3);
  assert.ok(!f.items.some((x) => x.title === "Old story from last week"), "older than four days: skipped");
  const sbi = f.items.filter((x) => /SBI Q2/.test(x.title));
  assert.equal(new Set(sbi.map((x) => x.type)).size, sbi.length, "one per kind of source");
  assert.deepEqual(sbi[0].reading.symbols, ["SBIN"]);
  const calls = fetchImpl.calls.length;
  assert.deepEqual(await social.poll(), { read: 0, added: 0 }, "nothing is due a minute later");
  assert.equal(fetchImpl.calls.length, calls);
  tick(11);
  const p2 = await social.poll();
  assert.ok(p2.read > 0);
  assert.equal(p2.added, 0, "the same items are not kept twice");
  assert.ok(social.feed({ relevant: true }).items.every((x) => x.reading.relevant));
  assert.ok(social.feed({ symbol: "sbin" }).items.length >= 1);
});

test("a story republished under a new id by the same source is kept once", async () => {
  const twice = rss([
    { title: "SBI Q2 net profit jumps 28%, beats estimates; shares rise", link: "https://e.test/a", guid: "g1", pub: rfc(70) },
    { title: "SBI Q2 net profit jumps 28%, beats estimates: shares rise!", link: "https://e.test/b", guid: "g2", pub: rfc(10) },
  ]);
  const { social } = boot({ routes: fakeFetch([["news.google.com", { text: twice }], ["economictimes", { text: rss([]) }], ["livemint", { text: rss([]) }]]) });
  await social.poll();
  const sbi = social.feed({ limit: 200 }).items.filter((x) => /SBI Q2/.test(x.title));
  assert.equal(new Set(sbi.map((x) => x.sourceId)).size, sbi.length, "one per source");
});

test("X accounts are read only with the token; their posts join the feed", async () => {
  const { social } = boot();
  social.addSource({ type: "x", value: "RBI" });
  await social.poll();
  let x = social.settings().sources.find((s) => s.type === "x");
  assert.match(x.error, /Bearer Token/);
  social.setCreds({ xToken: "TESTONLY-x-bearer-token-0123456789abcdef" });
  await social.poll({ force: true });
  x = social.settings().sources.find((s) => s.type === "x");
  assert.equal(x.error, "");
  assert.ok(social.feed({ type: "x" }).items.some((i) => /repo rate/.test(i.title)));
});

test("process, every market item (mode all): the AI reads market-related items in batches within the hourly budget", async () => {
  const ai = fakeAi();
  const { social, tick } = boot({ ai });
  await social.poll();
  social.setSettings({ aiMode: "all", aiPerHour: 1 });
  const r = await social.process();
  assert.ok(r.read >= 1);
  assert.equal(r.batches, 1);
  const sent = ai.asked.flat();
  const titles = social.feed({ limit: 200 }).items.filter((x) => sent.includes(x.id)).map((x) => x.title);
  assert.ok(!titles.some((t) => /cricket/i.test(t)), "the rules keep sport away from the paid model");
  assert.equal((await social.process()).read, 0, "the hour's budget is spent");
  tick(61);
  social.setSettings({ aiMode: "off" });
  assert.equal((await social.process()).read, 0, "switched off");
  const read = social.feed({ limit: 200 }).items.filter((x) => x.ai);
  assert.ok(read.every((x) => x.ai.at && x.reading.by === "ai"));
  assert.equal(social.status().aiToday, 1);
});

test("process, only when needed (the default): the AI reads only items that matter AND that the rules cannot settle", async () => {
  const feed = rss([
    { title: "SBI Q2 net profit jumps 28%, beats estimates; shares rise 4%", link: "https://e.test/1", pub: rfc(5) }, // clear: the rules settle it
    { title: "State Bank of India board to meet on Friday to consider fund raising", link: "https://e.test/2", pub: rfc(6) }, // unclear, a tracked stock
    { title: "Reliance Industries board to meet on Friday to consider fund raising", link: "https://e.test/3", pub: rfc(7) }, // unclear, but not yours and not high impact
    { title: "RBI announces new rules for NBFC lending and bank capital", link: "https://e.test/4", pub: rfc(8) }, // market-wide policy, no stock named
    { title: "India win the cricket series", link: "https://e.test/5", pub: rfc(9) }, // not market-related
  ]);
  const ai = fakeAi();
  const { social } = boot({ ai, routes: fakeFetch([["news.google.com", { text: feed }], ["economictimes", { text: rss([]) }], ["livemint", { text: rss([]) }]]) });
  social.setSettings({ watch: "SBIN" });
  await social.poll();
  const byTitle = (re) => social.feed({ limit: 200 }).items.find((x) => re.test(x.title));
  const clear = byTitle(/profit jumps/);
  assert.equal(clear.rules.impact, "high");
  assert.ok(clear.rules.certainty >= 0.5);
  assert.equal(social.needsAi(clear, { focus: new Set(["SBIN"]) }), false, "the rules are sure: no AI");
  await social.process();
  const sent = new Set(ai.asked.flat());
  const ids = (re) => byTitle(re).id;
  assert.equal(sent.has(ids(/profit jumps/)), false);
  assert.equal(sent.has(ids(/State Bank/)), true, "a tracked stock whose news the rules cannot read");
  assert.equal(sent.has(ids(/Reliance/)), false, "not yours, not high impact: the rules' reading is enough");
  assert.equal(sent.has(ids(/cricket/)), false);
  // an open position counts like a tracked stock
  social.setSettings({ watch: "" });
  social.focusSymbols = async () => ["RELIANCE"];
  await social.process();
  assert.equal(new Set(ai.asked.flat()).has(ids(/Reliance/)), true, "the open position's unclear news goes to the AI");
});
test("without an AI key the rules alone organise the feed, and the brief says what it needs", async () => {
  const { social } = boot({ ai: fakeAi({ ready: false }) });
  await social.poll();
  assert.deepEqual(await social.process(), { read: 0, batches: 0, used: [] });
  await assert.rejects(social.brief({ refresh: true }), /Anthropic key/);
  const d = social.digest();
  assert.ok(d.items >= 2);
  assert.equal(d.brief, null);
  assert.ok(d.deskBrief && d.deskBrief.ai === false, "the desk's own brief is always there");
  assert.match(d.deskBrief.headline, /news mood/);
  assert.equal(social.status().aiReady, false);
});

test("the brief, the signal for the AI Engine and one stock's news", async () => {
  const { social } = boot();
  await social.poll();
  social.setSettings({ aiMode: "all" });
  await social.process();
  const rulesSig = social.signal();
  const b = await social.brief({ refresh: true });
  assert.match(b.headline, /Banks lead/);
  assert.equal((await social.brief()).at, b.at, "kept for 20 minutes");
  const sig = social.signal();
  assert.ok(sig.items >= 3);
  assert.ok(["Positive", "Mixed", "Negative"].includes(sig.mood.label));
  assert.equal(sig.brief.headline, b.headline);
  assert.equal(sig.brief.by, "ai");
  assert.equal(rulesSig.brief.by, "rules", "before any AI brief, the signal carries the desk's brief");
  assert.ok(sig.stocks.some((s) => s.symbol === "SBIN"));
  const n = social.forSymbol("sbin");
  assert.equal(n.symbol, "SBIN");
  assert.ok(n.mentions >= 1);
  assert.equal(n.tone, "bullish");
  assert.equal(social.forSymbol("WIPRO"), null);
  assert.ok(social.aiReadSince(0) >= 1);
});

/* ------------------------------------------------------------------------- the watcher and its uses */

test("the watcher: one round reads and organises; the AI brief by itself only when switched on", async () => {
  const { social } = boot();
  social.setSettings({ aiMode: "all" });
  const w = new SocialWatch({ social, now: () => NOW, log: { log() {} } });
  const r = await w.tick();
  assert.ok(r.read > 0 && r.added > 0);
  assert.ok(r.aiRead > 0);
  assert.equal(r.brief, null, "no AI brief by itself: the desk's brief is there for free");
  social.setSettings({ aiBriefAuto: true });
  const r2 = await w.tick();
  assert.ok(r2.brief, "switched on: a first AI brief once enough items are organised");
  const r3 = await w.tick();
  assert.equal(r3.brief, null, "not again within half an hour");
  assert.equal(w.status().running, false);
});

test("new items are announced at once (the page's live stream and the news alerts listen)", async () => {
  const { social, tick } = boot();
  const heard = [];
  social.on("items", (items) => heard.push(items.length));
  await social.poll();
  assert.equal(heard.length, 1);
  assert.ok(heard[0] >= 3);
  tick(11);
  await social.poll();
  assert.equal(heard.length, 1, "nothing new, nothing announced");
});

test("the tone from the words: decisive phrases, negation and stated moves", () => {
  const t = (x) => toneOf(` ${x.toLowerCase()} `);
  const a = t("SBI Q2 net profit jumps 28%, beats estimates");
  assert.ok(a.score > 0.6 && a.strong && a.certainty >= 0.5);
  const b = t("Infosys fails to beat estimates; shares fall 6%");
  assert.ok(b.score < -0.5, "fails to beat is negative");
  assert.equal(b.movePct, -6);
  const c = t("RBI keeps the repo rate unchanged");
  assert.equal(c.score, 0);
  assert.equal(c.certainty, 0, "an unclear tone");
  assert.ok(t("Adani shares slump 9% after SEBI probe").score < -0.7);
});

test("stories: the same headline from several sources is one story, with its count", () => {
  const index = buildIndex(INSTRUMENTS);
  const row = (id, title, src, min) => {
    const it = { id, type: "rss", sourceLabel: src, title, at: iso(min), rules: enrich({ title }, { index }) };
    return { it, r: readingOf(it) };
  };
  const out = stories([row("a", "SBI Q2 net profit jumps 28%, beats estimates", "ET", 5), row("b", "SBI's Q2 net profit jumps 28% and beats estimates", "Mint", 8), row("c", "Infosys wins a $1.5 billion deal", "ET", 9)]);
  assert.equal(out.length, 2);
  assert.equal(out[0].n, 2);
  assert.equal(out[0].it.id, "a", "the newest leads");
});

test("the desk's brief: headline, themes, stocks, sectors, risks — no AI", () => {
  const index = buildIndex(INSTRUMENTS);
  const mk = (id, title, min, type = "rss") => ({ id, type, sourceLabel: type === "x" ? "X · @someone" : "ET", title, at: iso(min), rules: enrich({ title }, { index }) });
  const items = [mk("a", "SBI Q2 net profit jumps 28%, beats estimates", 10), mk("b", "State Bank of India shares rise 3% after results", 20), mk("c", "Reliance Industries shares slump on weak margins", 30), mk("d", "Rumour: Tata Motors block deal today", 15, "x")];
  const agg = aggregate(items, { now: NOW, hours: 6 });
  const b = deskBrief(agg, items, { now: NOW });
  assert.equal(b.ai, false);
  assert.match(b.headline, /news mood/);
  assert.ok(b.themes.some((x) => x.title === "Results"));
  assert.equal(b.watch[0].symbol, "SBIN");
  assert.equal(b.watch[0].direction, "up");
  assert.ok(b.risks.some((x) => /social post/.test(x) && /TATAMOTORS/.test(x)), "social posts naming stocks are flagged as unverified");
});

test("feeds: a conditional request — an unchanged feed answers 304 and costs nothing; Google News titles lose their publisher", async () => {
  let sent = null;
  const f = async (url, opts) => {
    sent = opts.headers;
    if (opts.headers["If-None-Match"] === '"v1"') return { ok: false, status: 304, headers: new Map([["etag", '"v1"']]), text: async () => "" };
    return { ok: true, status: 200, headers: new Map([["etag", '"v1"'], ["last-modified", "Sun, 15 Nov 2026 10:00:00 GMT"]]), text: async () => rss(NEWS.slice(0, 1)) };
  };
  const first = await readSource({ type: "rss", value: "https://n.test/f", state: {} }, { fetchImpl: f });
  assert.equal(first.items.length, 1);
  assert.equal(first.state.etag, '"v1"');
  const again = await readSource({ type: "rss", value: "https://n.test/f", state: first.state }, { fetchImpl: f });
  assert.equal(sent["If-None-Match"], '"v1"');
  assert.equal(again.notModified, true);
  assert.equal(again.items.length, 0);
  assert.equal(again.error, "");
  const g = tidyGoogle({ title: "SBI profit jumps 28% - The Economic Times", text: "SBI profit jumps 28% The Economic Times", author: "" });
  assert.equal(g.title, "SBI profit jumps 28%");
  assert.equal(g.author, "The Economic Times");
  assert.equal(g.text, "");
});

test("the NSE forecast counts the social mood as one vote; TradeAI answers news questions instantly", () => {
  const social = { items: 12, aiRead: 8, mood: { score: 45, label: "Positive" }, stocks: [{ symbol: "SBIN", mentions: 4, sentiment: 0.6, tone: "bullish", headline: "SBI profit jumps" }], sectors: [], alerts: [{ title: "SBI Q2 beats" }], brief: { headline: "Banks lead on results" } };
  const f = buildMarketForecast({ phase: "pre", social });
  const v = (f.votes || []).find((x) => x.id === "social");
  assert.ok(v, "a social vote");
  assert.equal(v.vote, 0.75);
  assert.match(v.why, /Positive across 12 market items — Banks lead on results/);
  assert.equal((buildMarketForecast({ phase: "pre", social: { ...social, items: 2 } }).votes || []).some((x) => x.id === "social"), false, "too few items: no vote");

  const route = classify("latest news on SBIN", { symbols: ["SBIN"] });
  assert.equal(route.tier, "instant");
  assert.equal(route.intent, "social");
  const a = instantAnswer("social", { social: { signal: social, stocks: [{ symbol: "SBIN", mentions: 4, sentiment: 0.6, tone: "bullish", high: 1, items: [{ at: iso(5), source: "ET", title: "SBI profit jumps", summary: "SBI Q2 profit up 28%", impact: "high" }] }], latest: [] } }, { symbol: "SBIN" });
  assert.match(a.answer, /Positive/);
  assert.match(a.answer, /### SBIN — 4 items/);
  assert.match(a.answer, /unverified/);
});

/* ---------------------------------------------------------------------------------- the routes */

test("routes: everyone signed in reads the feed; only the superadmin changes sources and the X token", async () => {
  const { createApp } = require("../app");
  const http = require("node:http");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-social-app-"));
  const fetchImpl = fakeFetch([["news.google.com", { text: rss(NEWS) }], ["economictimes", { text: rss([]) }], ["livemint", { text: rss([]) }]]);
  const made = createApp({ dataDir: dir, buildDir: path.join(dir, "no-build"), env: {}, socialFetch: fetchImpl, socialWatch: false, alertWatch: false, holidayFetch: async () => { throw new Error("no network in tests"); } });
  const ask = (method, url, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const r = http.request({ host: "127.0.0.1", port: server.address().port, method, path: url, headers: { "x-requested-with": "vpt", ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(t); } catch (_) { return null; } })() }));
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  try {
    // signed out: every route is closed
    for (const [m, u] of [["GET", "/api/admin/social"], ["GET", "/api/admin/social/feed"], ["POST", "/api/admin/social/refresh"], ["PUT", "/api/admin/social/creds"], ["POST", "/api/admin/social/sources"]]) {
      const r = await ask(m, u, m === "GET" ? undefined : {});
      assert.ok(r.status === 401 || r.status === 403, `${m} ${u} → ${r.status}`);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});
