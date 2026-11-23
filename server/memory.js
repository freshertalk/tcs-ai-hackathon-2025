"use strict";
// The memory governor (23 Nov 2026): the server watching its own memory, so pm2's hard limit is the last resort, not the plan.
//
//   WHY      On 21 Nov 2026 the site restarted in a loop because a job grew past pm2's 1 GB limit; pm2 kills at its own moment —
//            mid-session, mid-save, with every open page and the live price stream dropped. A process that sees the pressure
//            coming can do better.
//   HOW      every 15 seconds it reads the heap (against V8's own limit, --max-old-space-size) and the resident size (against
//            pm2's limit) and takes the higher share:
//              NORMAL   below 72 %: nothing.
//              TIGHT    72 % and more: every registered cache is dropped (they refill from their sources on the next read), the
//                       garbage collector is asked to run when it is exposed, and heavy jobs are told "not now" (the train
//                       guard consults pressure()). At most once every two minutes.
//              CRITICAL 88 % and more, twice in a row: caches dropped again, and — outside market hours — a PLANNED restart:
//                       the process stops itself cleanly (the same path as a deploy: requests finish, records are saved, the
//                       live streams close) and pm2 starts a fresh one at once. During the session it does not restart (a
//                       trader is watching); it keeps shedding and refusing heavy work, and pm2's limit stays the backstop.
//   RECORD   the last readings, the sheds and the planned restarts are kept for the health page.
//
// It never touches an order, an account or an AI model.

const v8 = require("node:v8");

const TIGHT = 0.72;
const CRITICAL = 0.88;
const SHED_GAP_MS = 2 * 60000;
const CHECK_MS = 15000;
const KEEP = 20;

class MemoryGovernor {
  /**
   * @param rssLimitMB  pm2's max_memory_restart (default 1024)
   * @param heapLimitMB V8's heap limit (read from V8 when not given)
   * @param inSession   () => boolean: is the market open (no planned restart then)
   * @param restart     (why) => void: stop cleanly so pm2 starts a fresh process (default: SIGTERM to itself)
   * @param read        () => { heapUsed, rss } (tests give a fake)
   */
  constructor({ rssLimitMB = Number(process.env.MEMORY_LIMIT_MB) || 1024, heapLimitMB = null, inSession = () => false, restart = null, read = () => process.memoryUsage(), now = () => Date.now(), log = console } = {}) {
    this.rssLimit = rssLimitMB * 1048576;
    this.heapLimit = (heapLimitMB ? heapLimitMB * 1048576 : v8.getHeapStatistics().heap_size_limit) || 800 * 1048576;
    this.inSession = inSession;
    this.restart = restart || ((why) => {
      this.log.warn(`[memory] planned restart: ${why}`);
      process.kill(process.pid, "SIGTERM");
    });
    this.read = read;
    this.now = now;
    this.log = log;
    this.caches = new Map(); // name → () => void
    this.level = "normal";
    this.share = 0;
    this.criticalRun = 0;
    this.lastShed = null; // never yet
    this.events = [];
    this.timer = null;
    this.restarting = false;
  }

  /** A cache that can be dropped under pressure: `drop()` empties it (it must refill by itself from its source). */
  register(name, drop) {
    if (typeof drop === "function") this.caches.set(name, drop);
    return this;
  }

  /** Is memory tight? Heavy jobs (training, backfills) should wait while it is. */
  pressure() {
    return this.level !== "normal";
  }

  _event(kind, text) {
    this.events.unshift({ at: new Date(this.now()).toISOString(), kind, text });
    if (this.events.length > KEEP) this.events.length = KEEP;
  }

  /** Drop every registered cache (and ask the collector to run, when it is exposed). @returns the names dropped */
  shed(why = "") {
    const dropped = [];
    for (const [name, drop] of this.caches) {
      try {
        drop();
        dropped.push(name);
      } catch (_) {
        /* one cache that cannot be dropped does not stop the others */
      }
    }
    if (typeof global.gc === "function") {
      try {
        global.gc();
      } catch (_) {
        /* not exposed */
      }
    }
    this.lastShed = this.now();
    this._event("shed", `caches dropped (${dropped.length})${why ? `: ${why}` : ""}`);
    return dropped;
  }

  /** One look. @returns the level */
  check() {
    const m = this.read() || {};
    const heap = Number(m.heapUsed) || 0;
    const rss = Number(m.rss) || 0;
    this.heapMB = Math.round(heap / 1048576);
    this.rssMB = Math.round(rss / 1048576);
    this.share = Math.max(heap / this.heapLimit, rss / this.rssLimit);
    const before = this.level;
    this.level = this.share >= CRITICAL ? "critical" : this.share >= TIGHT ? "tight" : "normal";
    const pct = Math.round(this.share * 100);
    if (this.level !== before) this._event("level", `${before} → ${this.level} (${pct}% of the limit; heap ${this.heapMB} MB, resident ${this.rssMB} MB)`);
    if (this.level === "normal") {
      this.criticalRun = 0;
      return this.level;
    }
    if (this.lastShed === null || this.now() - this.lastShed >= SHED_GAP_MS || (this.level === "critical" && before !== "critical")) this.shed(`${pct}% of the limit`);
    if (this.level === "critical") {
      this.criticalRun += 1;
      if (this.criticalRun >= 2 && !this.restarting) {
        if (this.inSession()) {
          if (this.criticalRun === 2) this._event("hold", `${pct}% of the limit during the session: no restart while the market is open; shedding and holding heavy work back`);
        } else {
          this.restarting = true;
          const why = `memory at ${pct}% of the limit (heap ${this.heapMB} MB, resident ${this.rssMB} MB) outside market hours`;
          this._event("restart", why);
          try {
            this.restart(why);
          } catch (_) {
            this.restarting = false;
          }
        }
      }
    } else this.criticalRun = 0;
    return this.level;
  }

  status() {
    return {
      level: this.level,
      share: Math.round(this.share * 1000) / 1000,
      heapMB: this.heapMB ?? null,
      rssMB: this.rssMB ?? null,
      heapLimitMB: Math.round(this.heapLimit / 1048576),
      rssLimitMB: Math.round(this.rssLimit / 1048576),
      caches: [...this.caches.keys()],
      lastShed: this.lastShed !== null ? new Date(this.lastShed).toISOString() : null,
      events: this.events.slice(0, 10),
      rule: `Tight at ${Math.round(TIGHT * 100)}% of the limit: caches are dropped and heavy jobs wait. Critical at ${Math.round(CRITICAL * 100)}% twice in a row: outside market hours the server restarts itself cleanly; during the session it keeps shedding.`,
    };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.check();
      } catch (err) {
        this.log.error(`[memory] ${err.message}`);
      }
    }, CHECK_MS);
    if (this.timer.unref) this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { MemoryGovernor, TIGHT, CRITICAL };
