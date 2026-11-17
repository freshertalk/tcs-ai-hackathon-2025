"use strict";
// Social Media for DrishtiAI: an aggregator of the owner's chosen sources — news sites, Google News
// searches, X accounts, YouTube channels, Reddit communities, NSE's announcements — turned into
// organised information for the trading desk and handed to the AI Engine.
//
//   collect   each source is read on its own interval (feeds.js), new items are kept once (by their
//             id or link), and the last four days are kept (at most 800 items)
//   organise  every item gets the rules' reading (extract.js): stocks, sectors, event, tone, impact,
//             relevance — software only, instant and free. The default AI model (ai/social.js) is
//             asked only when it is needed: an item that matters (your open positions, tracked stocks,
//             or high impact) whose meaning the rules cannot settle (an unclear tone, no stock named
//             for a market-wide event, an unverified social post about a stock) — within an hourly
//             budget. The brief is written by the rules; the AI brief only on request (or by itself,
//             when that is switched on)
//   use       the organised picture (mood, stock radar, sectors, events, alerts, the AI brief) is on
//             the Social Media page, and its signal goes to the NSE forecast, the Intraday plans and
//             TradeAI
//
// Access is by official means only: RSS feeds and X's API with the owner's own token (kept encrypted,
// never shown again). It never logs in to a platform with a password. Read-only: no order, no post.
// New items are announced as an "items" event (app.js: the page's live stream and the news alerts).

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { readSource, cleanValue, KINDS } = require("./feeds");
const { SECTORS, buildIndex, enrich, aggregate, readingOf, deskBrief } = require("./extract");

const SETTINGS = "social/settings.json";
const FEED = "social/feed.json";
const BRIEF = "social/brief.json";
const KEEP_ITEMS = 800;
const KEEP_MS = 4 * 86400000;
// minutes between two reads of one source (feeds are read with conditional requests, so an unchanged
// feed costs almost nothing; X's API has its own rate limits)
const MIN_EVERY = { rss: 3, google: 5, youtube: 10, reddit: 5, x: 15 };
const AI_MODES = ["smart", "all", "off"];
const NEEDS_EVENT = ["policy", "regulatory", "macro", "results", "corporate", "order", "rating"];

/** Suggested sources, one click to add. Only the first ones are on at the start; the rest are offers. */
const PRESETS = [
  { type: "google", value: "Nifty Sensex stock market", label: "Google News · Nifty & Sensex", on: true },
  { type: "google", value: "NSE BSE shares results", label: "Google News · results & shares", on: true },
  { type: "google", value: "RBI SEBI policy India markets", label: "Google News · RBI & SEBI", on: true },
  { type: "google", value: "FII DII flows Indian equities", label: "Google News · FII / DII flows" },
  { type: "rss", value: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", label: "Economic Times · Markets", on: true },
  { type: "rss", value: "https://www.livemint.com/rss/markets", label: "Mint · Markets", on: true },
  { type: "rss", value: "https://www.business-standard.com/rss/markets-106.rss", label: "Business Standard · Markets" },
  { type: "rss", value: "https://www.moneycontrol.com/rss/latestnews.xml", label: "Moneycontrol · Latest" },
  { type: "rss", value: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml", label: "CNBC-TV18 · Market" },
  { type: "rss", value: "https://www.thehindubusinessline.com/markets/feeder/default.rss", label: "BusinessLine · Markets" },
  { type: "rss", value: "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml", label: "NSE · corporate announcements" },
  { type: "reddit", value: "IndianStreetBets", label: "Reddit · r/IndianStreetBets" },
  { type: "reddit", value: "IndiaInvestments", label: "Reddit · r/IndiaInvestments" },
  { type: "x", value: "NSEIndia", label: "X · @NSEIndia" },
  { type: "x", value: "BSEIndia", label: "X · @BSEIndia" },
  { type: "x", value: "RBI", label: "X · @RBI" },
  { type: "x", value: "SEBI_India", label: "X · @SEBI_India" },
  { type: "x", value: "FinMinIndia", label: "X · @FinMinIndia" },
  { type: "x", value: "CNBCTV18Live", label: "X · @CNBCTV18Live" },
  { type: "x", value: "ETMarkets", label: "X · @ETMarkets" },
];
const DEFAULT_SECTORS = Object.keys(SECTORS);
const id8 = () => crypto.randomBytes(5).toString("hex");
// a headline as compared for repeats: letters and digits only
const normTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 140);
const hash = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

class SocialService extends EventEmitter {
  constructor({ docs, secrets, fetchImpl = globalThis.fetch, now = () => Date.now(), market = null, ai = null, log = console }) {
    super();
    this.focusSymbols = null; // set by app.js: async () => the symbols of the open positions
    this.docs = docs;
    this.secrets = secrets;
    this.fetch = fetchImpl;
    this.now = now;
    this.market = market;
    this.ai = ai;
    this.log = log;
    this._index = null;
    this._busy = null;
  }

  /* ---------------------------------------------------------------------------- settings */
  _raw() {
    let s = this.docs.read(SETTINGS, null);
    if (!s) {
      s = { sources: PRESETS.filter((p) => p.on).map((p) => ({ id: id8(), type: p.type, value: p.value, label: p.label, enabled: true, everyMin: MIN_EVERY[p.type], state: {} })), sectors: DEFAULT_SECTORS, keywords: [], watch: [], creds: {}, aiMode: "smart", aiPerHour: 4, aiBriefAuto: false, alertMe: true };
      this.docs.write(SETTINGS, s);
    }
    return s;
  }
  _save(s) {
    this.docs.write(SETTINGS, s);
  }
  _xToken() {
    const c = this._raw().creds || {};
    if (!c.x) return "";
    try {
      return this.secrets.decrypt(c.x);
    } catch (_) {
      return "";
    }
  }

  /** What the page shows: everything but the secrets. */
  settings() {
    const s = this._raw();
    const xSet = Boolean(s.creds && s.creds.x);
    return {
      sources: s.sources.map((x) => ({ id: x.id, type: x.type, value: x.value, label: x.label, enabled: x.enabled !== false, everyMin: x.everyMin, lastAt: x.state.lastAt || null, lastOk: x.state.lastOk || null, error: x.state.error || "", count: x.state.count || 0, needsKey: x.type === "x" && !xSet })),
      sectors: s.sectors,
      keywords: s.keywords,
      watch: s.watch,
      aiOn: this._aiMode(s) !== "off",
      aiMode: this._aiMode(s),
      aiPerHour: s.aiPerHour,
      aiBriefAuto: s.aiBriefAuto === true,
      alertMe: s.alertMe !== false,
      creds: { x: xSet },
      kinds: KINDS,
      sectorList: Object.entries(SECTORS).map(([id, x]) => ({ id, name: x.name })),
      presets: PRESETS.filter((p) => !s.sources.some((x) => x.type === p.type && x.value.toLowerCase() === p.value.toLowerCase())).map(({ on, ...p }) => p),
      aiReady: Boolean(this.ai && this.ai.social && this.ai.social.ready()),
    };
  }

  /** How the AI is used here: "smart" (only when needed — the default), "all" market items, or "off". */
  _aiMode(s) {
    if (AI_MODES.includes(s.aiMode)) return s.aiMode;
    return s.aiOn === false ? "off" : "smart";
  }

  setSettings({ sectors, keywords, watch, aiOn, aiMode, aiPerHour, aiBriefAuto, alertMe } = {}) {
    const s = this._raw();
    if (sectors !== undefined) s.sectors = (Array.isArray(sectors) ? sectors : []).filter((x) => SECTORS[x]);
    if (keywords !== undefined) s.keywords = (Array.isArray(keywords) ? keywords : String(keywords).split(",")).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 40);
    if (watch !== undefined) s.watch = (Array.isArray(watch) ? watch : String(watch).split(/[\s,]+/)).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9&-]{1,19}$/.test(x)).slice(0, 60);
    if (aiOn !== undefined) s.aiMode = aiOn ? (this._aiMode(s) === "off" ? "smart" : this._aiMode(s)) : "off";
    if (aiMode !== undefined) {
      if (!AI_MODES.includes(aiMode)) throw Object.assign(new Error("The AI mode is smart, all or off."), { status: 400 });
      s.aiMode = aiMode;
    }
    if (aiBriefAuto !== undefined) s.aiBriefAuto = Boolean(aiBriefAuto);
    if (alertMe !== undefined) s.alertMe = Boolean(alertMe);
    if (aiPerHour !== undefined) {
      const n = Math.round(Number(aiPerHour));
      if (!(n >= 0 && n <= 200)) throw Object.assign(new Error("AI batches an hour: 0 to 200."), { status: 400 });
      s.aiPerHour = n;
    }
    this._save(s);
    return this.settings();
  }

  /** The owner's X API Bearer Token (or its removal). Never returned. */
  setCreds({ xToken, remove } = {}) {
    const s = this._raw();
    s.creds = s.creds || {};
    if (remove === "x") delete s.creds.x;
    else if (xToken !== undefined) {
      const t = String(xToken || "").trim();
      if (!/^[A-Za-z0-9%._~+/=-]{30,400}$/.test(t)) throw Object.assign(new Error("That does not look like an X API Bearer Token (it is long — copy it whole from developer.x.com)."), { status: 400 });
      s.creds.x = this.secrets.encrypt(t);
      for (const src of s.sources) if (src.type === "x") src.state = { ...src.state, error: "" };
    }
    this._save(s);
    return this.settings();
  }

  addSource({ type, value, label, everyMin } = {}) {
    const s = this._raw();
    const v = cleanValue(type, value);
    if (s.sources.some((x) => x.type === type && x.value.toLowerCase() === v.toLowerCase())) throw Object.assign(new Error("That source is already in the list."), { status: 400 });
    if (s.sources.length >= 80) throw Object.assign(new Error("At most 80 sources."), { status: 400 });
    const every = Math.max(MIN_EVERY[type], Math.min(240, Math.round(Number(everyMin) || MIN_EVERY[type])));
    s.sources.push({ id: id8(), type, value: v, label: String(label || "").trim().slice(0, 80) || `${KINDS[type].name} · ${v}`.slice(0, 80), enabled: true, everyMin: every, state: {} });
    this._save(s);
    return this.settings();
  }

  updateSource(id, { enabled, label, everyMin } = {}) {
    const s = this._raw();
    const src = s.sources.find((x) => x.id === id);
    if (!src) throw Object.assign(new Error("That source is not in the list."), { status: 404 });
    if (enabled !== undefined) src.enabled = Boolean(enabled);
    if (label !== undefined) src.label = String(label).trim().slice(0, 80) || src.label;
    if (everyMin !== undefined) src.everyMin = Math.max(MIN_EVERY[src.type], Math.min(240, Math.round(Number(everyMin) || src.everyMin)));
    this._save(s);
    return this.settings();
  }

  removeSource(id) {
    const s = this._raw();
    if (!s.sources.some((x) => x.id === id)) throw Object.assign(new Error("That source is not in the list."), { status: 404 });
    s.sources = s.sources.filter((x) => x.id !== id);
    this._save(s);
    return this.settings();
  }

  /* ---------------------------------------------------------------------------- collecting */
  _feed() {
    const f = this.docs.read(FEED, null) || {};
    return { items: Array.isArray(f.items) ? f.items : [], polledAt: f.polledAt || null, aiAt: f.aiAt || null, ai: f.ai || { hour: "", batches: 0 } };
  }

  async _indexNow() {
    if (this._index && this.now() - this._index.at < 6 * 3600000) return this._index.idx;
    let list = [];
    try {
      list = this.market && this.market.instruments ? await this.market.instruments() : [];
    } catch (_) {
      list = [];
    }
    const idx = buildIndex(list.filter((x) => x.k !== "INDEX"));
    this._index = { at: this.now(), idx };
    return idx;
  }

  /**
   * Read every source that is due (or all, with force), keep the new items once, give each the rules'
   * reading. One read at a time; a second call meanwhile shares it.
   */
  poll({ force = false } = {}) {
    if (this._busy) return this._busy;
    this._busy = this._poll(force).finally(() => {
      this._busy = null;
    });
    return this._busy;
  }

  async _poll(force) {
    const s = this._raw();
    const now = this.now();
    const due = s.sources.filter((x) => x.enabled !== false && (force || !x.state.lastAt || now - Date.parse(x.state.lastAt) >= x.everyMin * 60000));
    if (!due.length) return { read: 0, added: 0 };
    const xToken = this._xToken();
    const index = await this._indexNow();
    const feed = this._feed();
    const seen = new Set(feed.items.map((x) => x.id));
    // a story republished under a new id by the same source within a day is kept once
    const titles = new Set(feed.items.filter((x) => now - Date.parse(x.at || x.seenAt) < 86400000).map((x) => `${x.sourceId}|${normTitle(x.title)}`));
    const fresh = [];
    // three sources at a time
    for (let i = 0; i < due.length; i += 3) {
      const part = due.slice(i, i + 3);
      const res = await Promise.all(part.map((src) => readSource(src, { fetchImpl: this.fetch, xToken })));
      part.forEach((src, j) => {
        const r = res[j];
        src.state = { ...r.state, lastAt: new Date(now).toISOString(), lastOk: r.error ? src.state.lastOk || null : new Date(now).toISOString(), error: r.error, count: (src.state.count || 0) };
        for (const it of r.items) {
          const id = hash(`${src.type}|${it.key || it.link || it.title}`);
          if (seen.has(id)) continue;
          // an item older than the four days kept is skipped (a feed's back catalogue)
          if (it.at && now - Date.parse(it.at) > KEEP_MS) continue;
          const tk = `${src.id}|${normTitle(it.title)}`;
          if (titles.has(tk)) continue;
          titles.add(tk);
          seen.add(id);
          src.state.count += 1;
          const item = { id, type: src.type, sourceId: src.id, sourceLabel: src.label, title: it.title, link: it.link, text: it.text, author: it.author, at: it.at || new Date(now).toISOString(), seenAt: new Date(now).toISOString(), metrics: it.metrics || null };
          item.rules = enrich(item, { index, watch: s.watch, sectors: s.sectors, keywords: s.keywords });
          fresh.push(item);
        }
      });
    }
    const cur = this._raw(); // keep any change made while reading
    for (const src of due) {
      const c = cur.sources.find((x) => x.id === src.id);
      if (c) c.state = src.state;
    }
    this._save(cur);
    const items = [...fresh, ...feed.items].filter((x) => now - Date.parse(x.at || x.seenAt) <= KEEP_MS).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, KEEP_ITEMS);
    this.docs.write(FEED, { ...feed, items, polledAt: new Date(now).toISOString() });
    if (fresh.length) this.emit("items", fresh);
    return { read: due.length, added: fresh.length };
  }

  /**
   * Whether an item needs the AI model, or the rules' reading is enough (mode "smart"): it must matter
   * (it names one of your open positions or tracked stocks, or the rules rate it high impact) AND be
   * something the rules cannot settle — an unclear tone, a market-wide policy / results / regulatory
   * event with no stock named, or a social post about a stock (is it a rumour?).
   */
  needsAi(it, { mode = "smart", focus = new Set() } = {}) {
    const r = it.rules;
    if (!r || it.ai || mode === "off") return false;
    if (mode === "all") return r.relevance >= 30;
    const yours = r.symbols.some((x) => focus.has(x));
    if (r.relevance < (yours ? 25 : 45)) return false; // any item naming a stock you hold or track counts
    const matters = yours || r.impact === "high";
    if (!matters) return false;
    const unclear = (r.certainty !== undefined ? r.certainty < 0.5 : Math.abs(r.sentiment) < 0.34) || (!r.symbols.length && NEEDS_EVENT.includes(r.event)) || ((it.type === "x" || it.type === "reddit") && r.symbols.length > 0);
    return unclear;
  }

  /**
   * The default AI model reads the items that need it (needsAi), within the hourly budget (batches of
   * eight items an hour; each batch is one paid request). Everything else keeps the rules' reading.
   * @returns { read, batches, used, waiting } — 0 when AI is off, not set up, nothing needs it, or the budget is spent
   */
  async process({ max = 40 } = {}) {
    const s = this._raw();
    const mode = this._aiMode(s);
    if (mode === "off" || !this.ai || !this.ai.social || !this.ai.social.ready()) return { read: 0, batches: 0, used: [] };
    // the rules read every item for free; the AI reads some only when the owner lifted AI credit protection (or presses Digest now)
    if (this.ai.guard && !this.ai.guard.autoAllowed() && !this.ai.guard.clicked()) return { read: 0, batches: 0, used: [], held: true };
    const feed = this._feed();
    const hour = new Date(this.now()).toISOString().slice(0, 13);
    const spent = feed.ai.hour === hour ? feed.ai.batches : 0;
    const left = Math.max(0, (s.aiPerHour || 0) - spent);
    if (!left) return { read: 0, batches: 0, used: [] };
    let focus = new Set(s.watch);
    if (typeof this.focusSymbols === "function") {
      try {
        for (const x of (await this.focusSymbols()) || []) focus.add(x);
      } catch (_) {
        /* positions unavailable: the tracked stocks alone */
      }
    }
    // newest first, and only from the last day: old items are not worth a paid read
    const fresh = feed.items.filter((x) => this.now() - Date.parse(x.at || x.seenAt) < 86400000);
    const todo = fresh.filter((x) => this.needsAi(x, { mode, focus })).slice(0, Math.min(max, left * 8));
    if (!todo.length) return { read: 0, batches: 0, used: [] };
    const { results, used } = await this.ai.social.organise(todo.map((x) => ({ id: x.id, title: x.title, text: x.text, source: x.sourceLabel, at: x.at })));
    const after = this._feed();
    const at = new Date(this.now()).toISOString();
    for (const it of after.items) if (results.has(it.id)) it.ai = { ...results.get(it.id), at };
    const batches = Math.ceil(todo.length / 8);
    this.docs.write(FEED, { ...after, aiAt: new Date(this.now()).toISOString(), ai: { hour, batches: spent + batches, day: this._aiDay(after.ai, batches) } });
    if (results.size) this.emit("organised", { count: results.size });
    return { read: results.size, batches, used };
  }

  /** Today's AI batches (IST day), kept beside the hourly count. */
  _aiDay(ai, add) {
    const day = new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const d = ai && ai.day && ai.day.date === day ? ai.day : { date: day, batches: 0 };
    return { date: day, batches: d.batches + add };
  }
  _aiToday(ai) {
    const day = new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    return ai && ai.day && ai.day.date === day ? ai.day.batches : 0;
  }

  /** The stored AI brief (any age), or null. */
  lastBrief() {
    return this.docs.read(BRIEF, null);
  }

  /** How many market-related items the AI has organised since `ms`. */
  aiReadSince(ms) {
    return this._feed().items.filter((it) => it.ai && it.ai.relevant && Date.parse(it.ai.at || 0) >= ms).length;
  }

  /* ---------------------------------------------------------------------------- reading */
  /** The live feed, newest first. */
  feed({ since = "", limit = 80, type = "", sector = "", relevant = false, symbol = "", q = "" } = {}) {
    const f = this._feed();
    const lim = Math.max(1, Math.min(200, Number(limit) || 80));
    const needle = String(q || "").toLowerCase().trim();
    const out = f.items.filter((it) => {
      if (since && (it.seenAt || "") <= since) return false;
      if (type && it.type !== type) return false;
      const r = readingOf(it);
      if (relevant && !r.relevant) return false;
      if (sector && !r.sectors.includes(sector)) return false;
      if (symbol && !r.symbols.includes(String(symbol).toUpperCase())) return false;
      if (needle && !`${it.title} ${it.text}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return { items: out.slice(0, lim).map((it) => ({ ...it, reading: readingOf(it) })), total: out.length, polledAt: f.polledAt, aiAt: f.aiAt, at: new Date(this.now()).toISOString() };
  }

  /** The organised picture for the last `hours`, with the AI brief when one is fresh. */
  digest({ hours = 24 } = {}) {
    const s = this._raw();
    const f = this._feed();
    const agg = aggregate(f.items, { now: this.now(), hours: Math.max(1, Math.min(96, Number(hours) || 24)), watch: s.watch });
    const b = this.docs.read(BRIEF, null);
    const six = aggregate(f.items, { now: this.now(), hours: 6, watch: s.watch });
    return { ...agg, brief: b && b.at && this.now() - Date.parse(b.at) < 6 * 3600000 ? b : null, deskBrief: deskBrief(six, f.items, { now: this.now(), hours: 6 }), polledAt: f.polledAt, aiAt: f.aiAt, aiToday: this._aiToday(f.ai), sources: s.sources.filter((x) => x.enabled !== false).length, at: new Date(this.now()).toISOString() };
  }

  /** The AI brief over the last six hours' organised items (kept 20 minutes unless refreshed). */
  async brief({ refresh = false } = {}) {
    const have = this.docs.read(BRIEF, null);
    if (have && !refresh && this.now() - Date.parse(have.at) < 20 * 60000) return have;
    if (!this.ai || !this.ai.social || !this.ai.social.ready()) throw Object.assign(new Error("The brief needs the AI model: save the Anthropic key (the default model is Claude Sonnet 5.5) on the AI page."), { status: 409 });
    const s = this._raw();
    const f = this._feed();
    const agg = aggregate(f.items, { now: this.now(), hours: 6, watch: s.watch });
    const items = f.items
      .filter((it) => Date.parse(it.at || it.seenAt) >= this.now() - 6 * 3600000)
      .map((it) => ({ it, r: readingOf(it) }))
      .filter((x) => x.r.relevant)
      .slice(0, 60)
      .map(({ it, r }) => ({ at: it.at, source: it.sourceLabel, kind: it.type, title: it.title, summary: r.summary, stocks: r.symbols, sectors: r.sectors, event: r.event, sentiment: r.sentiment, impact: r.impact }));
    if (!items.length) throw Object.assign(new Error("No market-related items in the last six hours yet."), { status: 409 });
    const out = await this.ai.social.brief(items, { mood: agg.mood, stocks: agg.radar.slice(0, 12).map((x) => ({ symbol: x.symbol, mentions: x.mentions, sentiment: x.sentiment })), sectors: agg.sectors.slice(0, 8).map((x) => ({ sector: x.name, mentions: x.mentions, sentiment: x.sentiment })) }, { fresh: refresh });
    if (!out) throw Object.assign(new Error("The AI model did not answer just now. Try again in a minute."), { status: 502 });
    const saved = { ...out, at: new Date(this.now()).toISOString(), items: items.length };
    this.docs.write(BRIEF, saved);
    return saved;
  }

  /**
   * The signal the AI Engine reads (NSE forecast, TradeAI): the last six hours' mood from the news and
   * posts, the stocks most talked about, the sectors, the high-impact alerts. Null with nothing fresh.
   */
  signal() {
    const s = this._raw();
    const f = this._feed();
    const agg = aggregate(f.items, { now: this.now(), hours: 6, watch: s.watch });
    if (agg.items < 3) return null;
    const b = this.docs.read(BRIEF, null);
    return {
      at: f.polledAt,
      items: agg.items,
      aiRead: agg.aiRead,
      mood: agg.mood,
      stocks: agg.radar.slice(0, 10).map((x) => ({ symbol: x.symbol, mentions: x.mentions, sentiment: x.sentiment, tone: x.tone, headline: x.top && x.top.title })),
      sectors: agg.sectors.slice(0, 8).map((x) => ({ id: x.id, name: x.name, mentions: x.mentions, sentiment: x.sentiment, tone: x.tone })),
      alerts: agg.alerts.slice(0, 6).map((x) => ({ title: x.title, source: x.source, at: x.at, impact: x.impact, sentiment: x.sentiment, symbols: x.symbols, summary: x.summary })),
      brief: b && b.at && this.now() - Date.parse(b.at) < 3 * 3600000 ? { headline: b.headline, mood: b.mood, at: b.at, by: "ai" } : (() => {
        const d = deskBrief(agg, f.items, { now: this.now(), hours: 6 });
        return d ? { headline: d.headline, mood: d.mood, at: d.at, by: "rules" } : null;
      })(),
    };
  }

  /** What the news and posts of the last day say about one stock (for its Intraday plan and TradeAI). */
  forSymbol(symbol, { hours = 24 } = {}) {
    const sym = String(symbol || "").toUpperCase();
    const f = this._feed();
    const since = this.now() - hours * 3600000;
    const rows = f.items
      .filter((it) => Date.parse(it.at || it.seenAt) >= since)
      .map((it) => ({ it, r: readingOf(it) }))
      .filter((x) => x.r.relevant && x.r.symbols.includes(sym));
    if (!rows.length) return null;
    const net = rows.reduce((a, x) => a + x.r.sentiment, 0) / rows.length;
    return {
      symbol: sym,
      mentions: rows.length,
      sentiment: Math.round(net * 100) / 100,
      tone: net >= 0.2 ? "bullish" : net <= -0.2 ? "bearish" : "mixed",
      high: rows.filter((x) => x.r.impact === "high").length,
      items: rows.slice(0, 5).map(({ it, r }) => ({ title: it.title, source: it.sourceLabel, at: it.at, link: it.link, sentiment: r.sentiment, impact: r.impact, summary: r.summary })),
    };
  }

  status() {
    const s = this._raw();
    const f = this._feed();
    return { sources: s.sources.length, on: s.sources.filter((x) => x.enabled !== false).length, failing: s.sources.filter((x) => x.enabled !== false && x.state.error).length, items: f.items.length, polledAt: f.polledAt, aiAt: f.aiAt, aiOn: this._aiMode(s) !== "off", aiMode: this._aiMode(s), aiBriefAuto: s.aiBriefAuto === true, aiToday: this._aiToday(f.ai), aiReady: Boolean(this.ai && this.ai.social && this.ai.social.ready()), model: this._modelName() };
  }

  /** The AI model that organises the items (the default model, or the fallback standing in). */
  _modelName() {
    try {
      const m = this.ai && typeof this.ai.modelChain === "function" ? this.ai.modelChain()[0] : null;
      return m ? `${m.name} (${m.company})` : null;
    } catch (_) {
      return null;
    }
  }
}

module.exports = { SocialService, PRESETS };
