"use strict";
// Vinaypedia (server/learning/service.js): the library by area, official updates read from the publishers' own feeds and filed
// by keyword (no AI), lessons and a digest the AI writes only when asked, and the admins' own learnings. No network: fetch is faked.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LearningService, SOURCES, READING, AREA_READING, classify, MY_OWN } = require("../learning/service");
const { LearnWriter } = require("../ai/learnai");
const knowledge = require("../market/knowledge");
const { FileDocs } = require("../docs");

const quiet = { log() {}, warn() {}, error() {} };
const owner = { email: "owner@example.com", name: "Owner", role: "superadmin" };
const admin = { email: "admin@example.com", name: "Admin", role: "admin" };
const other = { email: "other@example.com", name: "Other", role: "admin" };

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date || "Mon, 23 Nov 2026 10:00:00 +0530"}</pubDate><description>${i.text || ""}</description></item>`).join("")}</channel></rss>`;
const FEEDS = {
  nse: rss([
    { title: "Revision in lot sizes of derivative contracts", link: "https://nsearchives.nseindia.com/c/1.pdf", text: "Lot sizes of F&amp;O contracts revised" },
    { title: "Closing auction session — changes to the timings", link: "https://nsearchives.nseindia.com/c/2.pdf" },
  ]),
  sebi: rss([]),
  zconnect: rss([{ title: "Changes to peak margin and MIS leverage", link: "https://zerodha.com/z-connect/a" }]),
  varsity: rss([{ title: "How to check your EPF balance on WhatsApp", link: "https://zerodha.com/varsity/b" }, { title: "Supertrend and VWAP for intraday", link: "https://zerodha.com/varsity/c" }]),
  rbi: rss([{ title: "Monetary Policy Statement: repo rate unchanged", link: "https://www.rbi.org.in/d" }]),
};

function rig({ ai = null, feeds = FEEDS, start = "2026-11-23T05:00:00Z" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-vp-"));
  let clock = Date.parse(start);
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const src = SOURCES.find((s) => s.url === url);
    const body = src ? feeds[src.id] : null;
    if (body instanceof Error) throw body;
    return { ok: body !== null && body !== undefined, status: body ? 200 : 404, headers: { get: () => null }, text: async () => body || "" };
  };
  const make = (extra = {}) => new LearningService({ docs: new FileDocs(dir), fetchImpl, ai, now: () => clock, log: quiet, ...extra });
  return { svc: make(), make, asked, advance: (ms) => (clock += ms) };
}

/* ------------------------------------------------------------------------------------------- the library */

test("the library is the desk's knowledge base by area, each area with official reading that exists in the list", () => {
  const { svc } = rig();
  const v = svc.view(owner);
  assert.equal(v.library.length, knowledge.ALL.length);
  assert.deepEqual(v.areas.map((a) => a.name), [...knowledge.AREAS, MY_OWN]);
  for (const a of knowledge.AREAS) {
    assert.ok(AREA_READING[a] && AREA_READING[a].length, `reading for ${a}`);
    for (const id of AREA_READING[a]) assert.ok(READING.some((r) => r.id === id), `${id} is in the reading list`);
  }
  for (const r of READING) assert.match(r.url, /^https:\/\/(zerodha\.com|support\.zerodha\.com|www\.nseindia\.com|investor\.sebi\.gov\.in|www\.rbi\.org\.in)\//, "official addresses only");
  const ind = v.areas.find((a) => a.name === "Indicators");
  assert.ok(ind.pages > 5);
});

/* ------------------------------------------------------------------------------------------- my learnings */

test("my learnings: added, filed, edited by their author, tidied by a superadmin, refused to others; bad input said plainly", () => {
  const { svc } = rig();
  const n = svc.addNote({ title: "  No trade in the first 15 minutes  ", body: "The opening range fakes out.\r\nWait for 9:30.", area: "Strategies", kind: "rule", tags: "orb, #Discipline, orb", link: "https://zerodha.com/varsity/" }, admin);
  assert.equal(n.title, "No trade in the first 15 minutes");
  assert.equal(n.body, "The opening range fakes out.\nWait for 9:30.");
  assert.deepEqual(n.tags, ["orb", "discipline"]);
  assert.equal(n.by, "admin@example.com");
  assert.equal(n.name, "Admin");
  assert.match(n.id, /^[0-9a-f]{12}$/);
  // an unknown area goes to "My own"
  assert.equal(svc.addNote({ title: "Odd one", area: "Astrology" }, admin).area, MY_OWN);
  // the author edits; another admin cannot; a superadmin can
  assert.equal(svc.updateNote(n.id, { pinned: true }, admin).pinned, true);
  assert.throws(() => svc.updateNote(n.id, { title: "x" }, other), (e) => e.status === 403);
  assert.throws(() => svc.removeNote(n.id, other), (e) => e.status === 403);
  assert.equal(svc.updateNote(n.id, { title: "Wait for 9:30" }, owner).title, "Wait for 9:30");
  // the page knows which are the viewer's own
  assert.equal(svc.view(other).notes.find((x) => x.id === n.id).mine, false);
  assert.equal(svc.view(admin).notes.find((x) => x.id === n.id).mine, true);
  // refusals
  assert.throws(() => svc.addNote({ title: "" }, admin), /title/);
  assert.throws(() => svc.addNote({ title: "x", kind: "poem" }, admin), /kind/);
  assert.throws(() => svc.addNote({ title: "x", link: "javascript:alert(1)" }, admin), /https/);
  assert.throws(() => svc.updateNote("nope", {}, owner), (e) => e.status === 404);
  // removed by its author; kept across a restart
  assert.equal(svc.removeNote(n.id, admin), true);
  assert.equal(rig().svc.view(owner).notes.length, 0, "a different store is empty");
});

/* ------------------------------------------------------------------------------------- official updates */

test("keyword filing: an update goes under the areas it touches; personal-finance items are not intraday", () => {
  assert.deepEqual(classify("Revision in lot sizes of derivative contracts").areas, ["Options and derivatives"]);
  assert.ok(classify("Changes to peak margin and MIS leverage").areas.includes("Risk and money"));
  assert.ok(classify("Monetary Policy Statement: repo rate unchanged").areas.includes("Macro and sectors"));
  const epf = classify("How to check your EPF balance on WhatsApp");
  assert.deepEqual([epf.areas, epf.intraday], [["Investing and portfolio"], false]);
  assert.equal(classify("A note about nothing in particular").intraday, false);
  assert.ok(classify("Closing auction session — changes to the timings").areas.includes("Market microstructure"));
});

test("the sources are read from their own feeds, filed, kept across a restart, and a failing source keeps the rest", async () => {
  const r = rig({ feeds: { ...FEEDS, rbi: new Error("getaddrinfo ENOTFOUND www.rbi.org.in") } });
  const st = await r.svc.refresh({ force: true });
  assert.deepEqual(r.asked.sort(), SOURCES.map((s) => s.url).sort(), "only the publishers' own feeds");
  const v = r.svc.view(owner);
  assert.equal(v.updates.length, 5, "2 from NSE, 1 from Z-Connect, 2 from Varsity; RBI failed");
  const lot = v.updates.find((u) => /lot sizes/.test(u.title));
  assert.deepEqual([lot.by, lot.kind, lot.areas, lot.intraday], ["NSE", "rules", ["Options and derivatives"], true]);
  assert.equal(lot.text, "Lot sizes of F&O contracts revised");
  assert.match(st.sources.find((s) => s.id === "rbi").lastError, /ENOTFOUND/);
  assert.ok(st.sources.find((s) => s.id === "nse").lastSuccessAt);
  assert.equal(r.make().view(owner).updates.length, 5, "kept on disk");
  // read again: nothing doubles
  r.advance(7 * 3600000);
  await r.svc.refresh({ force: true });
  assert.equal(r.svc.view(owner).updates.length, 5);
  // closer than a minute: answered from the copy
  const n = r.asked.length;
  assert.equal((await r.svc.refresh()).throttled, true);
  assert.equal(r.asked.length, n);
});

test("without network nothing is fetched and the page says why", async () => {
  const { svc } = rig();
  const none = new LearningService({ docs: svc.docs, fetchImpl: null, log: quiet });
  const st = await none.refresh({ force: true });
  assert.match(st.sources[0].lastError, /no network/);
  assert.equal(none.due(), "");
});

test("the supervisor's question: due when the sources have not been read for half a day", async () => {
  const r = rig();
  assert.match(r.svc.due(), /not been read yet/);
  await r.svc.refresh({ force: true });
  assert.equal(r.svc.due(), "");
  r.advance(13 * 3600000);
  assert.match(r.svc.due(), /13 hours ago/);
});

/* ------------------------------------------------------------------------------------------------ the AI */

function fakeAi({ allowed = false } = {}) {
  const calls = [];
  const asks = [];
  const ai = {
    now: () => Date.parse("2026-11-23T05:00:00Z"),
    configured: () => true,
    _provider: () => "anthropic",
    guard: {
      wants: async (desc, run, later) => {
        if (allowed) return run();
        asks.push({ desc, later });
        return null;
      },
    },
    _client: () => ({
      ask: async ({ system, user, schema }) => {
        calls.push({ system, user, schema });
        if (schema.required.includes("summary")) {
          return { model: "test-model", data: { summary: "VWAP is the day's average price weighted by volume.", key_points: ["Above VWAP buyers lead."], rules: ["Trade with VWAP's side."], mistakes: ["Chasing far from VWAP."], example: "Illustration: bought at ₹500 on a VWAP pullback.", checklist: ["Which side of VWAP?"], read: ["varsity-ta", "made-up-link"], caveat: "Confirm on the chart." } };
        }
        const key = JSON.parse(user.slice(user.indexOf("["))).map((u) => u.key)[0];
        return { model: "test-model", data: { headline: "Lot sizes revised", items: [{ key, what_changed: "Lot sizes changed.", what_it_means: "Recheck position sizes." }, { key: "invented", what_changed: "x", what_it_means: "y" }], left_out: 2, caveat: "Read the circular." } };
      },
    }),
  };
  return { ai, calls, asks };
}

test("an AI lesson is grounded in the area's pages, updates and notes, cites only the official list, and is kept", async () => {
  const f = fakeAi();
  const r = rig({ ai: f.ai });
  await r.svc.refresh({ force: true });
  r.svc.addNote({ title: "VWAP is my anchor", area: "Indicators", kind: "rule", body: "Only longs above VWAP." }, admin);
  const lesson = await r.svc.writeLesson("Indicators", { by: "admin@example.com" });
  assert.equal(lesson.summary, "VWAP is the day's average price weighted by volume.");
  assert.deepEqual(lesson.read, ["varsity-ta"], "an invented reading id is dropped");
  assert.ok(lesson.grounded.pages > 5);
  assert.equal(lesson.grounded.notes, 1);
  const sent = JSON.parse(f.calls[0].user.slice(f.calls[0].user.indexOf("{")));
  assert.equal(sent.area, "Indicators");
  assert.ok(sent.knowledgePages.some((p) => /VWAP|RSI|MACD|moving/i.test(p.title)));
  assert.equal(sent.tradersOwnNotes[0].title, "VWAP is my anchor");
  assert.deepEqual(sent.officialReading.map((x) => x.id), ["varsity-ta"]);
  assert.equal(r.make().view(owner).lessons.Indicators.summary, lesson.summary, "kept");
  await assert.rejects(r.svc.writeLesson("Astrology"), /Pick an area/);
});

test("new circulars that matter become ONE 'Allow once' ask a day; allowed, the digest keeps only updates it was given", async () => {
  const f = fakeAi();
  const r = rig({ ai: f.ai });
  await r.svc.refresh({ force: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(f.asks.length, 1, "asked, not run: AI credit only on the owner's word");
  assert.equal(f.asks[0].desc.key, "vinaypedia-digest");
  assert.equal(f.asks[0].desc.page, "learning");
  assert.equal(f.calls.length, 0);
  // the owner allows it
  const d = await f.asks[0].later();
  assert.equal(d.items.length, 1, "an invented update is dropped");
  assert.match(d.items[0].title, /lot sizes|Closing auction/i);
  assert.equal(d.leftOut, 2);
  assert.equal(r.svc.view(owner).digest.headline, "Lot sizes revised");
  // new circulars again the same day: no second ask
  r.advance(7 * 3600000);
  r.svc.docs.write("vinaypedia/updates.json", { ...r.svc.docs.read("vinaypedia/updates.json"), items: [] });
  await r.svc.refresh({ force: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(f.asks.length, 1);
});

test("without an AI model the buttons say so plainly", async () => {
  const r = rig({ ai: { configured: () => false } });
  await assert.rejects(r.svc.writeLesson("Indicators"), (e) => e.status === 409 && /AI model/.test(e.message));
  const none = rig();
  await assert.rejects(none.svc.writeDigest(), (e) => e.status === 409);
});

test("the AI writer drops reading it was not given (unit)", async () => {
  const f = fakeAi();
  const w = new LearnWriter(f.ai);
  const l = await w.lesson({ area: "Indicators", pages: [{ title: "VWAP", rules: ["a"] }], reading: [{ id: "varsity-ta", name: "TA", url: "https://zerodha.com/varsity/module/technical-analysis/" }] });
  assert.deepEqual(l.read, ["varsity-ta"]);
});

test("RBI counts as intraday news only for policy and liquidity, not its routine bond notices", () => {
  assert.equal(classify("Monetary Policy Statement: repo rate unchanged", "", "macro").intraday, true);
  assert.equal(classify("RBI to conduct Overnight Variable Rate Repo (VRR) auction", "", "macro").intraday, true);
  assert.equal(classify("Auction of Government of India Dated Securities", "", "macro").intraday, false);
  assert.equal(classify("Premature redemption under Sovereign Gold Bond (SGB) Scheme", "", "macro").intraday, false);
  assert.equal(classify("Result of Yield/Price Based Auction of State Government Securities", "", "macro").intraday, false);
  // other sources are unchanged
  assert.equal(classify("Revision in lot sizes of derivative contracts", "", "rules").intraday, true);
});

test("NSE's routine listings are kept but not counted as trading news; trade-for-trade and F&O changes are", () => {
  assert.equal(classify("Listing of further issues of securities", "", "rules").intraday, false);
  assert.equal(classify("Listing of privately placed securities on the debt market segment", "", "rules").intraday, false);
  assert.equal(classify("Settlement Calendar for Buyback Offer under Tender Offer scheme", "", "rules").intraday, false);
  assert.equal(classify("Trade for Trade", "", "rules").intraday, true);
  assert.equal(classify("Applicable MWPL, TM, FII/FPI & MF limits for Introduction of Two Individual Securities", "", "rules").intraday, true);
});
