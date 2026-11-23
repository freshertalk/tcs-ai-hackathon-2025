"use strict";
// AI credit protection: a request to an AI company — the only thing that costs money — leaves this server only when a person
// asked for it.
//
//   A CLICK   an admin pressing an AI button reaches the server as a signed-in, state-changing request (POST/PUT) with the
//             site's own header. The route runs inside a "click" context (AsyncLocalStorage), and everything that request starts —
//             an AI run that carries on for a minute after the page got its answer, the analysts it asks in turn — keeps it.
//   NOT A CLICK  anything else: a timer (the morning research, the news digest, the after-close reviews, the timed WhatsApp advice,
//             the index forecast, the paper robot's review, the Top 10's AI check…), a page that is only being read (GET), the
//             co-pilot's automatic readings (its Go live mode: only "Ask now" is a click), a stranger.
//
// The check sits where a request leaves for the AI company — the fetch function every model client is built with (AiService
// gives every client the guarded one) — so no feature, old or new, can reach a model around it. Only POST requests count:
// listing a company's models (a GET) costs nothing. Answers already held (the AI Engine's 10-minute cache, the shared research)
// cost nothing and are still served.
//
// A refused request throws AiError code "not_asked" with a plain sentence; features already treat a failed AI call as "the AI
// is not available" and carry on with their own arithmetic. Every refusal is counted and listed on the AI page, so the owner can
// see what tried to run and did not.
//
// ONE NARROW EXCEPTION, by the owner's instruction of 2026-11-20: when a person OPENS a stock on the Desk, the evidence desk
// (server/evidence.js) may ask the AI once to weigh that stock's board — only when its own test says the AI is needed, within
// its own daily limit and its own gap per stock, and only while its switch on the AI page is on. Such a request runs in an
// "opened" context; nothing on a timer can create one.
//
// ASKING INSTEAD OF FAILING (23 Nov 2026, the owner's request: "whenever you need AI … display a popup requesting"): an automatic
// feature that would like the AI calls wants({ key, feature, why }, run). When the rule allows it, run() goes at once; otherwise
// the wish is kept as an ASK — the private area shows it in a popup ("DrishtiAI would like to use the AI for …: Allow once / Not
// now"). Allow runs it as a click (the owner's own press, so it spends credit only then); Not now snoozes that ask for two hours.
// Asks are deduplicated by key, at most twelve are kept, and each expires after three hours.
//
// The owner can lift the rule (AI page → AI credit protection → "Let the AI run on its own"): off by default, and when it is on
// each automatic feature still obeys its own switch and daily limit. Tests and tools that call the AI service directly are not
// guarded (enforce is false until the app turns it on).

const { AsyncLocalStorage } = require("node:async_hooks");
const { AiError } = require("./client");

const NAME = "ai/spend.json";
const KEEP = 60; // refusals listed

class SpendGuard {
  constructor({ docs = null, now = () => Date.now(), log = console, enforce = false } = {}) {
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.enforce = enforce;
    this.als = new AsyncLocalStorage();
    this._rec = null;
    this.openAllowed = null; // () => boolean: is the AI read on opening a stock switched on? (set by the app, server/evidence.js)
    this._asks = new Map(); // key → { key, feature, why, page, first, last, n, run }
    this._snooze = new Map(); // key → until (ms)
    this.onAsk = null; // () => void: a new or changed ask (the app tells every open page)
  }

  /* ------------------------------------------------------------------------------------- asking */
  /**
   * An automatic feature would like the AI. Runs `run` now when allowed; otherwise keeps an ask that the owner may allow (then
   * `later` — by default `run` — is called as a click). @returns run()'s result, or null when it became an ask
   */
  async wants({ key, feature, why = "", page = "" }, run, later = run) {
    if (this.allowed().ok) return run();
    this.ask({ key, feature, why, page, run: later });
    return null;
  }
  ask({ key, feature, why = "", page = "", run }) {
    if (!key || typeof run !== "function") return false;
    const now = this.now();
    const until = this._snooze.get(key);
    if (until && until > now) return false;
    const old = this._asks.get(key);
    const at = new Date(now).toISOString();
    this._asks.set(key, { key: String(key).slice(0, 80), feature: String(feature || key).slice(0, 120), why: String(why || "").slice(0, 300), page: String(page || "").slice(0, 40), first: old ? old.first : at, last: at, n: old ? old.n + 1 : 1, run });
    while (this._asks.size > 12) this._asks.delete(this._asks.keys().next().value);
    if (!old && typeof this.onAsk === "function") {
      try {
        this.onAsk();
      } catch (_) {
        /* telling the pages is best effort */
      }
    }
    return true;
  }
  /** The open asks (oldest first), without their functions. */
  asks() {
    const now = this.now();
    for (const [k, a] of this._asks) if (now - Date.parse(a.last) > 3 * 3600000) this._asks.delete(k);
    return [...this._asks.values()].map(({ run, ...rest }) => rest);
  }
  /** The owner allowed one: it leaves the list and its work starts (inside the caller's click). @returns the promise, or null */
  allowAsk(key) {
    const a = this._asks.get(key);
    if (!a) return null;
    this._asks.delete(key);
    if (typeof this.onAsk === "function") this.onAsk();
    return Promise.resolve().then(() => a.run());
  }
  /** Not now: the ask leaves and the same one is not shown again for `ms`. */
  dismissAsk(key, ms = 2 * 3600000) {
    const had = this._asks.delete(key);
    this._snooze.set(key, this.now() + ms);
    if (this._snooze.size > 100) this._snooze.delete(this._snooze.keys().next().value);
    if (had && typeof this.onAsk === "function") this.onAsk();
    return had;
  }

  /* ----------------------------------------------------------------------------------- the context */
  /** Run `fn` as a click (or as not-a-click): everything it starts keeps the answer. */
  run(ctx, fn) {
    return this.als.run({ click: false, ...ctx }, fn);
  }
  context() {
    return this.als.getStore() || null;
  }
  /** Was the work being done now begun by a person pressing a button? */
  clicked() {
    const c = this.context();
    return Boolean(c && c.click);
  }

  /* ------------------------------------------------------------------------------------- the rule */
  _load() {
    if (!this._rec) this._rec = (this.docs && this.docs.read(NAME, null)) || { auto: false, blocked: { date: "", count: 0, items: [] } };
    return this._rec;
  }
  _save() {
    if (this.docs) this.docs.write(NAME, this._rec);
  }
  /** The owner's choice: may the AI run without a click? Off unless they turned it on. */
  autoAllowed() {
    return !this.enforce || Boolean(this._load().auto);
  }
  setAuto(on, by = "") {
    const r = this._load();
    r.auto = Boolean(on);
    r.by = by;
    r.at = new Date(this.now()).toISOString();
    this._save();
    this.log.log(`[ai] credit protection: running without a click is now ${r.auto ? "ALLOWED" : "off"} (${by || "unknown"})`);
    return this.status();
  }

  /** Would a paid request be allowed here and now? @returns { ok, why } */
  allowed() {
    if (!this.enforce) return { ok: true, why: "not enforced" };
    if (this.clicked()) return { ok: true, why: "a click" };
    const c = this.context();
    if (c && c.opened && typeof this.openAllowed === "function" && this.openAllowed()) return { ok: true, why: "a stock was opened, and the owner allowed one AI read of it" };
    if (this._load().auto) return { ok: true, why: "the owner allowed the AI to run on its own" };
    return { ok: false, why: "no click" };
  }

  /** Throws unless a paid request may go out now; remembers the refusal. @param label what was trying (a feature, a host) */
  check(label = "a model request") {
    const a = this.allowed();
    if (a.ok) return;
    this._note(label);
    const c = this.context();
    throw new AiError(`The AI was not asked for this: it runs only when you press an AI button, so no credit was used${c && c.route ? ` (${c.route})` : ""}. ${label ? `It was trying to do: ${label}.` : ""}`.trim(), "not_asked", 409);
  }

  _note(label) {
    const r = this._load();
    const day = new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    if (r.blocked.date !== day) r.blocked = { date: day, count: 0, items: [] };
    r.blocked.count += 1;
    const hit = r.blocked.items.find((x) => x.what === label);
    const at = new Date(this.now()).toISOString();
    if (hit) {
      hit.n += 1;
      hit.last = at;
    } else r.blocked.items.unshift({ what: label, n: 1, first: at, last: at });
    r.blocked.items = r.blocked.items.slice(0, KEEP);
    this._save();
  }

  /** The guarded fetch every model client is built with: only POSTs (the paid requests) are checked. */
  wrapFetch(inner) {
    const self = this;
    return async function guardedFetch(url, init) {
      const method = String((init && init.method) || (url && url.method) || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        let host = "";
        try {
          host = new URL(String(url && url.url ? url.url : url)).host;
        } catch (_) {
          host = "an AI company";
        }
        self.check(`a request to ${host}`);
      }
      return (inner || globalThis.fetch)(url, init);
    };
  }

  status() {
    const r = this._load();
    const day = new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const b = r.blocked.date === day ? r.blocked : { date: day, count: 0, items: [] };
    return { enforced: this.enforce, auto: Boolean(r.auto), by: r.by || "", at: r.at || null, blockedToday: b.count, blocked: b.items.slice(0, 12) };
  }
}

/** For a feature that holds the AI service: ask through its guard when there is one, otherwise just run. */
function wantAi(ai, desc, run, later = run) {
  const g = ai && ai.guard;
  if (g && typeof g.wants === "function") return g.wants(desc, run, later);
  return run();
}

module.exports = { SpendGuard, wantAi };
