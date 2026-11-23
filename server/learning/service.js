"use strict";
// Vinaypedia — Vinay's own learning (23 Nov 2026): one place for everything about intraday trading, kept by the desk itself.
//
//   THE LIBRARY       the desk's knowledge base (market/knowledge.js + market/kb/): 100+ pages in 20+ areas, written from
//                     exchange rules and widely published practice — the same pages every AI feature is handed. Each area
//                     carries its official reading (NSE, SEBI, Zerodha Varsity, Zerodha's own pages, RBI), checked to exist.
//   OFFICIAL UPDATES  read by the server itself every six hours from the publishers' own RSS feeds — NSE circulars, SEBI,
//                     Zerodha Z-Connect, Zerodha Varsity and RBI's press releases — and filed under the areas they touch by
//                     plain keyword rules (no AI). Only the headline, a short excerpt, the date and the link are kept.
//   AI LESSONS        the model writes a lesson for an area, grounded in that area's pages, its newest updates and the owner's
//                     notes, citing only the official reading (server/ai/learnai.js). On a click — or, when new NSE/SEBI
//                     circulars that matter arrive, an "Allow once" popup asks for a digest (server/ai/spend.js): AI credit is
//                     spent only when a person says so.
//   MY LEARNINGS      what an admin learnt, typed in: a lesson, a rule they follow, a mistake to avoid, an idea to test —
//                     filed under an area, searchable, pinned to the top when it matters. Each person edits their own; a
//                     superadmin can tidy any.
//
// Records: vinaypedia/notes.json, vinaypedia/updates.json, vinaypedia/lessons.json, vinaypedia/digest.json. No order, no
// account, no price is touched here.

const crypto = require("node:crypto");
const knowledgeModule = require("../market/knowledge");
const { readSource } = require("../social/feeds");
const { wantAi } = require("../ai/spend");

const NOTES = "vinaypedia/notes.json";
const UPDATES = "vinaypedia/updates.json";
const LESSONS = "vinaypedia/lessons.json";
const DIGEST = "vinaypedia/digest.json";
const MY_OWN = "My own";
const KINDS = ["lesson", "rule", "mistake", "idea"];
const MAX_NOTES = 2000;
const KEEP_UPDATES = 300;
const PER_SOURCE = 80;
const MAX_AGE_DAYS = 120;
const EVERY_MS = 6 * 3600000;
const MIN_GAP_MS = 60 * 1000;

/** The publishers' own feeds (checked 23 Nov 2026). SEBI's feed is often empty; it is kept for the days it is not. */
const SOURCES = [
  { id: "nse", name: "NSE circulars", by: "NSE", url: "https://nsearchives.nseindia.com/content/RSS/Circulars.xml", home: "https://www.nseindia.com/resources/exchange-communication-circulars", kind: "rules" },
  { id: "sebi", name: "SEBI", by: "SEBI", url: "https://www.sebi.gov.in/sebirss.xml", home: "https://www.sebi.gov.in/", kind: "rules" },
  { id: "zconnect", name: "Zerodha Z-Connect", by: "Zerodha", url: "https://zerodha.com/z-connect/feed", home: "https://zerodha.com/z-connect/", kind: "broker" },
  { id: "varsity", name: "Zerodha Varsity", by: "Zerodha", url: "https://zerodha.com/varsity/feed/", home: "https://zerodha.com/varsity/", kind: "lessons" },
  { id: "rbi", name: "RBI press releases", by: "RBI", url: "https://www.rbi.org.in/pressreleases_rss.xml", home: "https://www.rbi.org.in/", kind: "macro" },
];

/** Official reading, each address checked to exist (23 Nov 2026). The AI may cite only these, by id. */
const READING = [
  { id: "varsity-intro", name: "Zerodha Varsity — Introduction to Stock Markets", url: "https://zerodha.com/varsity/module/introduction-to-stock-markets/" },
  { id: "varsity-ta", name: "Zerodha Varsity — Technical Analysis", url: "https://zerodha.com/varsity/module/technical-analysis/" },
  { id: "varsity-fa", name: "Zerodha Varsity — Fundamental Analysis", url: "https://zerodha.com/varsity/module/fundamental-analysis/" },
  { id: "varsity-futures", name: "Zerodha Varsity — Futures Trading", url: "https://zerodha.com/varsity/module/futures-trading/" },
  { id: "varsity-options", name: "Zerodha Varsity — Option Theory", url: "https://zerodha.com/varsity/module/option-theory/" },
  { id: "varsity-option-strategies", name: "Zerodha Varsity — Option Strategies", url: "https://zerodha.com/varsity/module/option-strategies/" },
  { id: "varsity-risk", name: "Zerodha Varsity — Risk Management & Trading Psychology", url: "https://zerodha.com/varsity/module/risk-management/" },
  { id: "varsity-tax", name: "Zerodha Varsity — Markets and Taxation", url: "https://zerodha.com/varsity/module/markets-and-taxation/" },
  { id: "varsity-systems", name: "Zerodha Varsity — Trading Systems", url: "https://zerodha.com/varsity/module/trading-systems/" },
  { id: "varsity-innerworth", name: "Zerodha Varsity — Innerworth (trading psychology)", url: "https://zerodha.com/varsity/module/innerworth/" },
  { id: "zerodha-charges", name: "Zerodha — Brokerage & charges", url: "https://zerodha.com/charges/" },
  { id: "zerodha-margin", name: "Zerodha — Margin calculator", url: "https://zerodha.com/margin-calculator/" },
  { id: "zerodha-support", name: "Zerodha Support — Trading and markets", url: "https://support.zerodha.com/category/trading-and-markets" },
  { id: "nse-circulars", name: "NSE — Exchange circulars", url: "https://www.nseindia.com/resources/exchange-communication-circulars" },
  { id: "nse-holidays", name: "NSE — Trading holidays", url: "https://www.nseindia.com/resources/exchange-communication-holidays" },
  { id: "sebi-investor", name: "SEBI — Investor website", url: "https://investor.sebi.gov.in/" },
  { id: "rbi", name: "Reserve Bank of India", url: "https://www.rbi.org.in/" },
];
const READ_BY_ID = new Map(READING.map((r) => [r.id, r]));

/** Which official reading goes with each area of the knowledge base. */
const AREA_READING = {
  "The desk's essentials": ["varsity-intro", "varsity-risk", "zerodha-charges"],
  "India: market and rules": ["varsity-intro", "nse-circulars", "sebi-investor"],
  "Order types and execution": ["varsity-intro", "zerodha-support"],
  "Costs and taxes": ["zerodha-charges", "varsity-tax"],
  "Macro and sectors": ["rbi", "varsity-fa"],
  "Fundamentals for traders": ["varsity-fa"],
  Indicators: ["varsity-ta"],
  "Price action and patterns": ["varsity-ta"],
  "Volume, open interest and order flow": ["varsity-futures", "varsity-ta"],
  Strategies: ["varsity-systems", "varsity-ta"],
  "Risk and money": ["varsity-risk", "zerodha-margin"],
  Psychology: ["varsity-innerworth", "varsity-risk"],
  "Research and testing": ["varsity-systems"],
  "Masters' methods": ["varsity-systems"],
  "Options and derivatives": ["varsity-options", "varsity-option-strategies", "varsity-futures"],
  "Market microstructure": ["nse-circulars", "varsity-intro"],
  "Calendar and events": ["nse-holidays", "nse-circulars"],
  "Hacks and tricks": ["varsity-ta", "varsity-systems"],
  "Quant and systems": ["varsity-systems"],
  "Investing and portfolio": ["varsity-fa", "sebi-investor"],
  "Global links and India's lists": ["rbi", "nse-circulars"],
  "Other schools of analysis": ["varsity-ta"],
};

/**
 * Plain keyword rules that file an update under the areas it touches (no AI). An update that touches only "Investing and
 * portfolio" (or nothing) is kept but marked as not about intraday trading, and the page tucks it away.
 */
const AREA_RULES = [
  ["India: market and rules", /\b(circular|regulation|sebi|price band|circuit|trade for trade|t2t|asm|gsm|surveillance|listing|delist|ipo|ofs|rights issue|bonus|split|corporate action|insider|settlement|t\+1|t\+0|trading hours|market timing|segment)\b/i],
  ["Order types and execution", /\b(order types?|stop[- ]loss|sl-m|gtt|amo|iceberg|bracket order|cover order|market order|limit order|order cancellation|algo|api|execution)\b/i],
  ["Costs and taxes", /\b(stt|stamp duty|brokerage|charges?|gst|income tax|itr|capital gains?|turnover fee|transaction charges?|tds)\b/i],
  ["Options and derivatives", /\b(f&o|futures?|options?|expiry|expiries|lot sizes?|mwpl|ban period|open interest|strikes?|contracts?|derivatives?|weekly)\b/i],
  ["Risk and money", /\b(margins?|peak margin|leverage|mtf|pledge|collateral|risk management|square[- ]off)\b/i],
  ["Macro and sectors", /\b(repo|policy rate|inflation|cpi|gdp|monetary policy|liquidity|forex|rupee|bond|yields?|sector)\b/i],
  ["Market microstructure", /\b(closing auction|call auction|tick size|market maker|price discovery|pre-open|circuit breaker|index rebalanc\w*|auction session)\b/i],
  ["Calendar and events", /\b(holidays?|expiry day|results|dividend|record date|ex-date|muhurat|budget|calendar)\b/i],
  ["Fundamentals for traders", /\b(earnings|quarterly results|financial statements?|annual report|valuation|balance sheet)\b/i],
  ["Indicators", /\b(rsi|macd|moving averages?|vwap|bollinger|supertrend|indicators?|ema|sma|atr)\b/i],
  ["Price action and patterns", /\b(candlesticks?|support|resistance|breakouts?|chart patterns?|price action|trend ?lines?)\b/i],
  ["Strategies", /\b(strateg\w+|intraday|scalp\w*|swing trad\w*|momentum|day trad\w*)\b/i],
  ["Psychology", /\b(psycholog\w*|discipline|bias\w*|emotions?|fear|greed)\b/i],
  ["Investing and portfolio", /\b(mutual funds?|sip|etfs?|portfolio|nps|epf|fixed deposits?|fds?|insurance|retirement|pension|gold)\b/i],
];
const NOT_INTRADAY = new Set(["Investing and portfolio"]);
// RBI publishes many routine notices (government bond auctions, gold-bond redemptions, banking licences): only its policy and
// liquidity news moves the day's market, so only that counts as intraday news from it
const MACRO_MOVERS = /\b(repo|reverse repo|policy rate|monetary policy|mpc|inflation|cpi|crr|slr|rate cut|rate hike|liquidity|forex reserves?|rupee)\b/i;
const ROUTINE = /\b(sovereign gold bond|sgb|treasury bills?|dated securities|state government securities|sdl|auction result|yield\/price based auction)\b/i;

const NSE_ROUTINE = /\b(listing of (further issues|privately placed|commercial papers?|debt|non-convertible|units)|listing of equity shares of|debt market|commercial papers?|non-convertible debentures?|ncds?|mutual fund units?|buyback offer|tender offer)\b/i;

/** The areas an update touches, and whether it is about intraday trading at all. `kind` is the source's ("macro" for RBI). */
function classify(title, text = "", kind = "") {
  const hay = `${title || ""} ${text || ""}`;
  const areas = AREA_RULES.filter(([, re]) => re.test(hay)).map(([a]) => a);
  let intraday = areas.some((a) => !NOT_INTRADAY.has(a));
  if (kind === "macro") intraday = MACRO_MOVERS.test(hay) && !ROUTINE.test(title || "");
  // NSE's routine listings (debt, commercial paper, further issues, a company's buyback calendar) are not trading news
  if (kind === "rules" && NSE_ROUTINE.test(title || "")) intraday = false;
  return { areas, intraday };
}

const clean = (x, n) => String(x == null ? "" : x).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const cleanBody = (x, n) =>
  String(x == null ? "" : x)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, n);
const httpUrl = (x) => {
  const s = clean(x, 300);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch (_) {
    return "";
  }
};
const fail = (message, status = 400, code = "bad_request") => Object.assign(new Error(message), { status, code });

class LearningService {
  /**
   * @param docs       the record store
   * @param fetchImpl  how the feeds are read (null = never: tests and previews without network)
   * @param ai         the AI service (lessons and the digest), optional
   */
  constructor({ docs, fetchImpl = null, ai = null, knowledge = knowledgeModule, now = () => Date.now(), log = console, onChange = null } = {}) {
    this.docs = docs;
    this.fetch = fetchImpl;
    this.ai = ai;
    this.knowledge = knowledge;
    this.now = now;
    this.log = log;
    this.onChange = onChange;
    this._inflight = null;
    this._timer = null;
    this._writer = null;
    this._busy = new Set();
  }

  /* ------------------------------------------------------------------------------------------- records */
  _read(name, fallback) {
    const d = this.docs ? this.docs.read(name, null) : null;
    return d && typeof d === "object" ? d : fallback();
  }
  _write(name, value) {
    if (this.docs) this.docs.write(name, value);
    if (typeof this.onChange === "function") {
      try {
        this.onChange(name);
      } catch (_) {
        /* telling the pages is best effort */
      }
    }
  }
  _notes() {
    const d = this._read(NOTES, () => ({ items: [] }));
    return Array.isArray(d.items) ? d.items : [];
  }
  _updates() {
    const d = this._read(UPDATES, () => ({ items: [], sources: {} }));
    return { items: Array.isArray(d.items) ? d.items : [], sources: d.sources && typeof d.sources === "object" ? d.sources : {}, digestAskDay: d.digestAskDay || "" };
  }
  _lessons() {
    return this._read(LESSONS, () => ({}));
  }

  /* -------------------------------------------------------------------------------------------- areas */
  /** The knowledge base's areas, then "My own" for learnings that fit none. */
  areas() {
    return [...this.knowledge.AREAS, MY_OWN];
  }
  library() {
    return this.knowledge.ALL.map((t) => ({ id: t.id, area: t.area, title: t.title, rules: t.rules, keys: t.keys || "" }));
  }

  /* --------------------------------------------------------------------------------------- my learnings */
  _clean(input = {}, old = null) {
    const title = clean(input.title !== undefined ? input.title : old && old.title, 120);
    if (!title) throw fail("Give the learning a title.");
    const body = cleanBody(input.body !== undefined ? input.body : old && old.body, 4000);
    const areaIn = clean(input.area !== undefined ? input.area : old && old.area, 80) || MY_OWN;
    const area = this.areas().includes(areaIn) ? areaIn : MY_OWN;
    const kindIn = clean(input.kind !== undefined ? input.kind : old && old.kind, 20) || "lesson";
    if (!KINDS.includes(kindIn)) throw fail(`"kind" is one of ${KINDS.join(", ")}.`);
    const tagsIn = input.tags !== undefined ? input.tags : old ? old.tags : [];
    const tags = [...new Set((Array.isArray(tagsIn) ? tagsIn : String(tagsIn || "").split(","))
      .map((t) => clean(t, 24).toLowerCase().replace(/^#/, ""))
      .filter(Boolean))].slice(0, 8);
    const linkIn = input.link !== undefined ? input.link : old && old.link;
    const link = httpUrl(linkIn);
    if (clean(linkIn, 300) && !link) throw fail("The link must start with https:// or http://.");
    const pinned = input.pinned !== undefined ? Boolean(input.pinned) : Boolean(old && old.pinned);
    return { title, body, area, kind: kindIn, tags, link, pinned };
  }
  addNote(input, user = {}) {
    const items = this._notes();
    if (items.length >= MAX_NOTES) throw fail(`There are already ${MAX_NOTES} learnings; remove some first.`, 409, "full");
    const at = new Date(this.now()).toISOString();
    const rec = { id: crypto.randomBytes(6).toString("hex"), ...this._clean(input), by: clean(user.email, 120), name: clean(user.name, 80) || clean(user.email, 120).split("@")[0], createdAt: at, updatedAt: null };
    this._write(NOTES, { items: [rec, ...items] });
    return rec;
  }
  _mine(note, user) {
    return Boolean(note && user && (user.role === "superadmin" || (note.by && note.by === user.email)));
  }
  updateNote(id, input, user = {}) {
    const items = this._notes();
    const i = items.findIndex((n) => n.id === String(id));
    if (i < 0) throw fail("That learning is not here any more.", 404, "not_found");
    if (!this._mine(items[i], user)) throw fail("Only the person who wrote this learning (or a superadmin) can change it.", 403, "forbidden");
    const rec = { ...items[i], ...this._clean(input, items[i]), updatedAt: new Date(this.now()).toISOString() };
    const next = items.slice();
    next[i] = rec;
    this._write(NOTES, { items: next });
    return rec;
  }
  removeNote(id, user = {}) {
    const items = this._notes();
    const note = items.find((n) => n.id === String(id));
    if (!note) throw fail("That learning is not here any more.", 404, "not_found");
    if (!this._mine(note, user)) throw fail("Only the person who wrote this learning (or a superadmin) can remove it.", 403, "forbidden");
    this._write(NOTES, { items: items.filter((n) => n.id !== note.id) });
    return true;
  }

  /* ---------------------------------------------------------------------------------- official updates */
  /** Read every source now. Calls closer than a minute apart share the stored copy; simultaneous ones share one read. */
  refresh({ force = false } = {}) {
    if (this._inflight) return this._inflight;
    const u = this._updates();
    const last = Math.max(0, ...Object.values(u.sources).map((s) => (s && s.lastAttemptAt ? Date.parse(s.lastAttemptAt) : 0)));
    if (!force && this.now() - last < MIN_GAP_MS) return Promise.resolve({ ...this.status(), throttled: true });
    this._inflight = this._run().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  async _run() {
    const u = this._updates();
    const stamp = new Date(this.now()).toISOString();
    const known = new Map(u.items.map((x) => [x.key, x]));
    const fresh = [];
    for (const src of SOURCES) {
      const st = { ...(u.sources[src.id] || {}), lastAttemptAt: stamp };
      if (!this.fetch) {
        st.lastError = "Not read here (no network for this server).";
        u.sources[src.id] = st;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await readSource({ type: "rss", value: src.url, state: st.feed || {} }, { fetchImpl: this.fetch });
      st.feed = r.state || {};
      if (r.error) st.lastError = clean(r.error, 200);
      else {
        st.lastError = "";
        st.lastSuccessAt = stamp;
        let n = 0;
        for (const it of (r.items || []).slice(0, PER_SOURCE)) {
          const title = clean(it.title, 300);
          if (!title) continue;
          const link = httpUrl(it.link);
          const key = `${src.id}:${link || title}`.slice(0, 400);
          if (known.has(key)) continue;
          const text = clean(it.text, 300);
          const c = classify(title, text, src.kind);
          const rec = { key, source: src.id, by: src.by, kind: src.kind, title, link, at: it.at || stamp, seenAt: stamp, text, areas: c.areas, intraday: c.intraday };
          known.set(key, rec);
          fresh.push(rec);
          n += 1;
        }
        st.added = n;
        st.count = (r.items || []).length || st.count || 0;
      }
      u.sources[src.id] = st;
    }
    // the filing rules may have improved since an item was stored: file every item again
    for (const [k, x] of known) {
      const c = classify(x.title, x.text, x.kind);
      known.set(k, { ...x, areas: c.areas, intraday: c.intraday });
    }
    const cutoff = this.now() - MAX_AGE_DAYS * 86400000;
    const items = [...known.values()]
      .filter((x) => !x.at || Date.parse(x.at) >= cutoff)
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
      .slice(0, KEEP_UPDATES);
    const next = { items, sources: u.sources, digestAskDay: u.digestAskDay };
    // new circulars from NSE or SEBI that matter to an intraday trader: the AI could say what they mean — ask, once a day
    const rules = fresh.filter((x) => x.kind === "rules" && x.intraday);
    const today = new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const ask = rules.length > 0 && this.ai && next.digestAskDay !== today;
    if (ask) next.digestAskDay = today;
    this._write(UPDATES, next);
    if (fresh.length) this.log.log(`[vinaypedia] ${fresh.length} new update${fresh.length === 1 ? "" : "s"} from the official sources`);
    if (ask) {
      Promise.resolve(
        wantAi(
          this.ai,
          { key: "vinaypedia-digest", feature: "Vinaypedia — what the new NSE/SEBI circulars mean for intraday", why: `${rules.length} new circular${rules.length === 1 ? "" : "s"} from NSE/SEBI touch intraday trading: the AI would explain what changed.`, page: "learning" },
          () => this.writeDigest({ by: "auto" }),
          () => this.writeDigest({ by: "allowed" })
        )
      ).catch(() => {});
    }
    return this.status();
  }

  /** Read now, then every six hours. The timer never keeps the process alive. */
  start(everyMs = EVERY_MS) {
    this.refresh({ force: true }).catch(() => {});
    this._timer = setInterval(() => this.refresh({ force: true }).catch(() => {}), everyMs);
    if (this._timer.unref) this._timer.unref();
  }
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  /** For the supervisor: a reason when the sources have not been read for half a day. */
  due() {
    if (!this.fetch) return "";
    const u = this._updates();
    const ok = Math.max(0, ...Object.values(u.sources).map((s) => (s && s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : 0)));
    if (!ok) return "the official sources have not been read yet";
    const hours = (this.now() - ok) / 3600000;
    return hours >= 12 ? `the official sources were last read ${Math.round(hours)} hours ago` : "";
  }

  /* ------------------------------------------------------------------------------------------ the AI */
  _ai() {
    if (!this.ai) throw fail("The AI is not available on this server.", 409, "not_configured");
    if (typeof this.ai.configured === "function" && !this.ai.configured()) throw fail("Add an AI model on the AI page first.", 409, "not_configured");
    if (!this._writer) {
      const { LearnWriter } = require("../ai/learnai");
      this._writer = this.ai.learnAi || new LearnWriter(this.ai);
    }
    return this._writer;
  }
  readingFor(area) {
    return (AREA_READING[area] || ["varsity-intro"]).map((id) => READ_BY_ID.get(id)).filter(Boolean);
  }
  /** The AI writes (or rewrites) the lesson of one area. */
  async writeLesson(area, { by = "" } = {}) {
    if (!this.knowledge.AREAS.includes(area)) throw fail("Pick an area of the knowledge base.", 400, "bad_area");
    if (this._busy.has(area)) throw fail("The AI is already writing this lesson.", 409, "busy");
    const writer = this._ai();
    this._busy.add(area);
    try {
      const lesson = await writer.lesson({
        area,
        pages: this.knowledge.ALL.filter((t) => t.area === area),
        updates: this._updates().items.filter((x) => x.areas.includes(area)).slice(0, 10),
        notes: this._notes().filter((n) => n.area === area).slice(0, 12),
        reading: this.readingFor(area),
      });
      const all = this._lessons();
      const rec = { ...lesson, by: clean(by, 120) };
      this._write(LESSONS, { ...all, [area]: rec });
      return rec;
    } finally {
      this._busy.delete(area);
    }
  }
  /** The AI's digest of the newest official updates that touch intraday trading. */
  async writeDigest({ by = "" } = {}) {
    const writer = this._ai();
    const updates = this._updates().items.filter((x) => x.intraday).slice(0, 30);
    if (!updates.length) throw fail("There are no official updates to read yet: check the sources first.", 409, "nothing");
    const d = await writer.digest({ updates });
    const rec = { ...d, by: clean(by, 120) };
    this._write(DIGEST, rec);
    return rec;
  }

  /* --------------------------------------------------------------------------------------------- views */
  status() {
    const u = this._updates();
    return {
      sources: SOURCES.map((s) => {
        const st = u.sources[s.id] || {};
        return { id: s.id, name: s.name, by: s.by, home: s.home, kind: s.kind, lastAttemptAt: st.lastAttemptAt || null, lastSuccessAt: st.lastSuccessAt || null, lastError: st.lastError || "", count: st.count || 0 };
      }),
      updatesKept: u.items.length,
    };
  }
  fingerprint() {
    const u = this._updates();
    const notes = this._notes();
    const lessons = this._lessons();
    const digest = this._read(DIGEST, () => null);
    return [u.items.length, u.items[0] ? u.items[0].key : "", notes.length, notes[0] ? notes[0].updatedAt || notes[0].createdAt : "", Object.values(lessons).map((l) => l.at).join(","), digest ? digest.at : ""];
  }
  /** Everything the page shows. `user` decides which learnings show an edit button. */
  view(user = {}) {
    const notes = this._notes();
    const u = this._updates();
    const lessons = this._lessons();
    const library = this.library();
    const areas = this.areas().map((name) => ({
      name,
      pages: library.filter((t) => t.area === name).length,
      notes: notes.filter((n) => n.area === name).length,
      updates: u.items.filter((x) => x.areas.includes(name)).length,
      lesson: Boolean(lessons[name]),
      reading: this.readingFor(name).map((r) => r.id),
    }));
    return {
      at: new Date(this.now()).toISOString(),
      areas,
      library,
      notes: notes.map((n) => ({ ...n, mine: this._mine(n, user) })),
      kinds: KINDS,
      updates: u.items,
      lessons,
      digest: this._read(DIGEST, () => null),
      reading: READING,
      ...this.status(),
      ai: { configured: Boolean(this.ai && (typeof this.ai.configured !== "function" || this.ai.configured())), busy: [...this._busy] },
    };
  }
}

module.exports = { LearningService, SOURCES, READING, AREA_READING, AREA_RULES, classify, KINDS, MY_OWN };
