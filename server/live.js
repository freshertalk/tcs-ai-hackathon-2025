"use strict";
// The live hub: one push channel that tells every open page, in every tab, the moment something changed, so nothing waits
// for a poll or a refresh.
//
//   WHAT     A page keeps one Server-Sent Events connection (GET /api/admin/live). The hub sends small "change" events —
//            { topic, at } — never data: the page re-reads what it shows through its normal, permission-checked API, so no
//            private figure ever travels on this channel and every page sees exactly what its owner may see.
//   WHO PUBLISHES
//            · every successful state-changing request under /api/admin (a button pressed anywhere: the trading switch, a
//              setting, a proposal, a research run…) publishes the topics its route belongs to — see ROUTE_TOPICS
//            · WATCHERS: cheap checks of the server's own state every few seconds (the Zerodha session, the trading
//              book's structure, the paper robot, the forecasters, the autopilot, alerts, AI credit, messaging…): when
//              one's fingerprint changes, its topic is published. This catches what no request caused: a forecast scored by
//              the clock, a position closed by the exit coach, a session that expired.
//   RESILIENCE
//            · every event has a number; a page that reconnects says the last number it saw and is sent what it missed (the
//              last 300 are kept); if it missed more, or the server restarted (a new boot id), it is told to RESYNC and
//              re-reads everything it shows
//            · a heartbeat every 15 seconds keeps proxies from closing an idle connection and lets a page notice a dead one
//            · the pages also keep their own slow polling as a safety net: this channel makes things instant, it is not the
//              only thing keeping them right
//
//   EVERY SAVE (23 Nov 2026)
//            · the app also hooks the record store: whenever any record is saved — by a request, a timer, the clock, a
//              learner — its topic is published (DOC_TOPICS below; bursts are gathered for 400 ms). So a change made by
//              ANY part of the server reaches the open pages at once, not on their next poll.
//
// It reads, never writes, and has no way to reach the broker, an order or an AI model.

const crypto = require("node:crypto");

const KEEP = 300; // events kept for a page that reconnects
const BEAT_MS = 15000;
const WATCH_MS = 2500;
const MAX_CLIENTS = 300;

/** Which topics a state-changing request belongs to, by the start of its path. The first match wins; "misc" otherwise. */
const ROUTE_TOPICS = [
  ["/api/admin/stock/holidays", ["holidays"]],
  ["/api/admin/loans", ["loans"]],
  ["/api/admin/market/horizon", ["horizon"]],
  ["/api/admin/market/ahead", ["ahead", "horizon"]],
  ["/api/admin/market/evidence", ["evidence"]],
  ["/api/admin/market/now", ["evidence"]],
  ["/api/admin/market/expiries", ["expiry"]],
  ["/api/admin/market/open-forecast", ["open"]],
  ["/api/admin/market/alerts", ["alerts", "market"]],
  ["/api/admin/market", ["market"]],
  ["/api/admin/trading", ["trading", "market", "health"]],
  ["/api/admin/autopilot", ["autopilot"]],
  ["/api/admin/automation", ["automation", "health"]],
  ["/api/admin/vault", ["data", "automation", "health"]],
  ["/api/admin/accounts", ["accounts", "trading", "system"]],
  ["/api/admin/prefs", ["prefs"]],
  ["/api/admin/recorder", ["data", "automation", "horizon"]],
  ["/api/admin/robot", ["robot", "paper"]],
  ["/api/admin/paper", ["paper"]],
  ["/api/admin/research", ["research", "health"]],
  ["/api/admin/ai/research", ["research", "ai"]],
  ["/api/admin/ai", ["ai", "health"]],
  ["/api/admin/scanner", ["scanner"]],
  ["/api/admin/picks", ["scanner", "research"]],
  ["/api/admin/setups", ["scanner", "research"]],
  ["/api/admin/flight", ["trading", "robot"]],
  ["/api/admin/analysis", ["analysis"]],
  ["/api/admin/indices", ["indices"]],
  ["/api/admin/social", ["social"]],
  ["/api/admin/whatsapp", ["system", "health"]],
  ["/api/admin/notify", ["system", "health"]],
  ["/api/admin/temple", ["system"]],
  ["/api/admin/settings", ["system", "health"]],
  ["/api/admin/admins", ["system"]],
  ["/api/admin/google", ["system", "health"]],
  ["/api/admin/email", ["system", "health"]],
  ["/api/admin/account", ["system"]],
  ["/api/admin/expenses", ["expenses"]],
  ["/api/admin/kundali", ["kundali"]],
  ["/api/admin/tradeai", ["tradeai"]],
  ["/api/admin/learning", ["learning"]],
];

function topicsForRoute(path) {
  const p = String(path || "").split("?")[0];
  for (const [prefix, topics] of ROUTE_TOPICS) if (p === prefix || p.startsWith(`${prefix}/`)) return topics;
  return ["misc"];
}

class LiveHub {
  constructor({ now = () => Date.now(), log = console, watchMs = WATCH_MS, beatMs = BEAT_MS } = {}) {
    this.now = now;
    this.log = log;
    this.watchMs = watchMs;
    this.beatMs = beatMs;
    this.boot = crypto.randomBytes(5).toString("hex");
    this.seq = 0;
    this.ring = [];
    this.clients = new Set();
    this.watchers = new Map(); // topic → { fn, last }
    this.timer = null;
    this.beat = null;
    this.stats = { published: 0, connected: 0, replayed: 0, resyncs: 0 };
  }

  /* --------------------------------------------------------------------------- publishing */
  /** Tell every page that `topic` changed. `via` says why ("api", "watch", …). */
  publish(topic, via = "api") {
    const ev = { id: ++this.seq, topic, at: this.now(), via };
    this.ring.push(ev);
    if (this.ring.length > KEEP) this.ring.splice(0, this.ring.length - KEEP);
    this.stats.published += 1;
    for (const c of this.clients) this._send(c, ev);
    return ev;
  }

  _send(c, ev) {
    try {
      c.res.write(`id: ${ev.id}\nevent: change\ndata: ${JSON.stringify({ topic: ev.topic, at: ev.at, via: ev.via })}\n\n`);
    } catch (_) {
      this.clients.delete(c);
    }
  }

  /* --------------------------------------------------------------------------- the watchers */
  /** `fn()` returns anything cheap that changes when the topic's state does; its fingerprint is compared every tick. */
  watch(topic, fn) {
    this.watchers.set(topic, { fn, last: undefined });
  }

  _fp(fn) {
    let v;
    try {
      v = fn();
    } catch (_) {
      return "error";
    }
    return typeof v === "string" ? v : crypto.createHash("sha1").update(JSON.stringify(v === undefined ? null : v)).digest("hex");
  }

  /** One look at every watcher: the first look only sets the baseline; later ones publish what changed. */
  tick() {
    let changed = 0;
    for (const [topic, w] of this.watchers) {
      const fp = this._fp(w.fn);
      if (w.last !== undefined && fp !== w.last) {
        changed += 1;
        this.publish(topic, "watch");
      }
      w.last = fp;
    }
    return changed;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.watchMs);
    this.beat = setInterval(() => {
      for (const c of this.clients) {
        try {
          c.res.write(`: ping ${this.now()}\n\n`);
        } catch (_) {
          this.clients.delete(c);
        }
      }
    }, this.beatMs);
    for (const t of [this.timer, this.beat]) if (t.unref) t.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.beat) clearInterval(this.beat);
    this.timer = this.beat = null;
    for (const c of this.clients) {
      try {
        c.res.end();
      } catch (_) {
        /* gone */
      }
    }
    this.clients.clear();
  }

  /* --------------------------------------------------------------------------- the connection */
  /** The SSE route. Mount it behind the sign-in check. */
  handler() {
    return (req, res) => {
      if (this.clients.size >= MAX_CLIENTS) return res.status(503).json({ error: "busy", message: "Too many live connections." });
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 3000\n\n");
      const client = { res, at: this.now() };
      const lastRaw = req.headers["last-event-id"] || req.query.last;
      const last = Number.parseInt(lastRaw, 10);
      const sameBoot = !req.query.boot || req.query.boot === this.boot;
      res.write(`event: hello\ndata: ${JSON.stringify({ boot: this.boot, seq: this.seq, now: this.now() })}\n\n`);
      if (Number.isFinite(last) && last > 0) {
        const oldest = this.ring.length ? this.ring[0].id : this.seq + 1;
        if (!sameBoot || last > this.seq || last + 1 < oldest) {
          // restarted, or more was missed than is kept: the page re-reads everything
          this.stats.resyncs += 1;
          res.write(`event: resync\ndata: ${JSON.stringify({ reason: sameBoot ? "missed" : "restarted" })}\n\n`);
        } else {
          const missed = this.ring.filter((e) => e.id > last);
          this.stats.replayed += missed.length;
          for (const ev of missed) this._send(client, ev);
        }
      } else if (req.query.boot && !sameBoot) {
        this.stats.resyncs += 1;
        res.write(`event: resync\ndata: ${JSON.stringify({ reason: "restarted" })}\n\n`);
      }
      this.clients.add(client);
      this.stats.connected += 1;
      req.on("close", () => this.clients.delete(client));
    };
  }

  /** Publish the topics of every successful state-changing request under /api/admin. */
  middleware() {
    return (req, res, next) => {
      if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        const path = `${req.baseUrl || ""}${req.path || ""}`;
        for (const t of topicsForRoute(path)) this.publish(t, "api");
      });
      next();
    };
  }

  status() {
    return { boot: this.boot, seq: this.seq, clients: this.clients.size, watchers: [...this.watchers.keys()], ...this.stats };
  }
}

/**
 * Which topics a saved record belongs to, by its name (a document such as "paper/state.json", or a collection such as
 * "consensus_calls"). The first match wins; records not listed (caches, keys, the per-minute tape, the AI's answer cache, the
 * credit guard's refusal counter) publish nothing — they change too often to mean anything to a page, or are not shown.
 */
const DOC_TOPICS = [
  [/^paper\//, ["paper"]],
  [/^market\/(consensus|vol-model)|^consensus_calls$/, ["consensus"]],
  [/^analysis\/|^analysis_|^journal_fills$|^trading\/journal/, ["analysis", "trading"]],
  [/^picks\/|^research\/|^ai\/shared-research|^setups\/|^learn\//, ["research"]],
  [/^scanner\//, ["scanner"]],
  [/^indices\//, ["indices"]],
  [/^market\/(trade-setup|setup-)/, ["setup"]],
  [/^expenses$/, ["expenses"]],
  [/^kundali\//, ["kundali"]],
  [/^vinaypedia\//, ["learning"]],
  [/^robot\/|^robot_/, ["robot"]],
  [/^autopilot\/|^autopilot_/, ["autopilot"]],
  [/^market\/open-|^open_forecasts$/, ["open"]],
  [/^market\/horizon|^horizon_/, ["horizon"]],
  [/^market\/ahead|^ahead_/, ["ahead"]],
  [/^market\/evidence|^evidence_|^market\/flow-model/, ["evidence"]],
  [/^market\/alerts/, ["alerts"]],
  [/^market\/(signals|edge)/, ["research"]],
  [/^market\/expiry/, ["expiry"]],
  [/^flight\//, ["flight"]],
  [/^social\//, ["social"]],
  [/^(notify|whatsapp|temple)\//, ["system"]],
  [/^accounts\//, ["accounts"]],
  [/^loans(\/|$)/, ["loans"]],
  [/^automation\//, ["automation"]],
  [/^tradeai\/|^ai\/tradeai(?!-activity)/, ["tradeai"]],
  [/^ai\/(brains|decisions|reviews|ensemble\.json|trading-skills)/, ["ai"]],
];
function topicsForDoc(name) {
  const n = String(name || "");
  for (const [re, topics] of DOC_TOPICS) if (re.test(n)) return topics;
  return null;
}

/**
 * Hook a record store so every save publishes its topics on `hub` (gathered for `gap` ms). Returns a function that undoes it.
 * The store's own behaviour is untouched: the original method runs first, and a failure to publish can never fail a save.
 */
function watchDocs(docs, hub, { gap = 400 } = {}) {
  if (!docs || !hub || docs.__liveWatched) return () => {};
  const pending = new Set();
  let timer = null;
  const flush = () => {
    timer = null;
    const list = [...pending];
    pending.clear();
    for (const t of list) {
      try {
        hub.publish(t, "data");
      } catch (_) {
        /* telling the pages is best effort */
      }
    }
  };
  const touch = (name) => {
    const topics = topicsForDoc(name);
    if (!topics) return;
    for (const t of topics) pending.add(t);
    if (!timer) {
      timer = setTimeout(flush, gap);
      if (timer.unref) timer.unref();
    }
  };
  const originals = {};
  for (const m of ["write", "putItems", "removeItems", "append"]) {
    if (typeof docs[m] !== "function") continue;
    const orig = docs[m];
    originals[m] = orig;
    docs[m] = function liveWrite(name, ...rest) {
      const out = orig.call(this, name, ...rest);
      try {
        touch(name);
      } catch (_) {
        /* never fail a save */
      }
      return out;
    };
  }
  docs.__liveWatched = true;
  return () => {
    for (const [m, f] of Object.entries(originals)) docs[m] = f;
    delete docs.__liveWatched;
    if (timer) clearTimeout(timer);
  };
}

module.exports = { LiveHub, topicsForRoute, ROUTE_TOPICS, DOC_TOPICS, topicsForDoc, watchDocs };
