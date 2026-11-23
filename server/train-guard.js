"use strict";
// Automatic training that can never put the site in a restart loop.
//
//   WHY      On 21 Nov 2026 the site answered "502 Bad Gateway" once a minute. A change of the forecaster's model version
//            (20 Nov) made it retrain itself 30 seconds after every start. Training on the whole stored year, inside the
//            web server, took the process past pm2's memory limit; pm2 restarted it at its next check (59 s); the training
//            never finished, so no model was saved — and because "tried a moment ago" lived only in memory, the new process
//            started the same training again. Every minute, for ever, with a 502 each time.
//   HOW      This guard keeps, in the record store, when each automatic training (or evening learning) began and whether it
//            ended. It says "wait":
//              - in the first minutes after the server starts, so the start-up work settles before any heavy job;
//              - after an attempt that began and never ended (the server stopped during it — most likely for memory): for
//                30 minutes after the first such stop, then 1 h, 2 h, 4 h … up to a day, so a job that cannot fit is tried
//                now and then, never in a loop.
//            A training the owner starts by hand is never refused (he asked), but it is recorded the same way.
//   RECORD   automation/train-guard.json: { [id]: { startedAt, endedAt, trigger, ok, error, died } } — `died` counts the
//            attempts in a row that never ended. Shown on the site health check.
//
// It decides nothing else: the services keep their own rules for when to train; this only adds "not now".

const NAME = "automation/train-guard.json";
const GRACE_MS = 5 * 60000;
const BASE_MS = 30 * 60000;
const MAX_MS = 24 * 3600000;
const MANUAL = new Set(["you asked", "manual"]);

const iso = (ms) => new Date(ms).toISOString();
const ended = (r) => Boolean(r && r.endedAt && (!r.startedAt || Date.parse(r.endedAt) >= Date.parse(r.startedAt)));

class TrainGuard {
  /**
   * @param docs       the record store (read / write)
   * @param startedAt  when this server process started (ms); the grace counts from it
   * @param graceMs    how long after a start automatic training waits (5 minutes)
   */
  constructor({ docs, now = () => Date.now(), startedAt = null, graceMs = GRACE_MS, baseMs = BASE_MS, maxMs = MAX_MS, log = console } = {}) {
    this.docs = docs;
    this.now = now;
    this.startedAt = Number.isFinite(startedAt) ? startedAt : now();
    this.graceMs = graceMs;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.log = log;
    this._live = new Set(); // ids running in THIS process (an unended record of one of these did not die)
    this._told = new Set(); // ids whose "never finished" has been logged by this process
  }

  _all() {
    const v = this.docs && typeof this.docs.read === "function" ? this.docs.read(NAME, null) : null;
    return v && typeof v === "object" ? v : {};
  }
  _put(id, rec) {
    if (!this.docs || typeof this.docs.write !== "function") return;
    const all = this._all();
    all[id] = rec;
    this.docs.write(NAME, all);
  }

  /** The record of one job, or null. */
  record(id) {
    return this._all()[id] || null;
  }

  /** How long the pause is after `n` attempts in a row that never ended. */
  pauseAfter(n) {
    return Math.min(this.maxMs, this.baseMs * 2 ** Math.max(0, n - 1));
  }

  /**
   * "" when `id` may start now; otherwise why not, in plain words.
   * @param trigger  who asks: "you asked" (the owner, by hand) is never refused
   */
  wait(id, trigger = "itself") {
    if (MANUAL.has(String(trigger))) return "";
    const now = this.now();
    const up = now - this.startedAt;
    // memory is tight (server/memory.js): a heavy job now would push the process into pm2's limit
    if (this.memory && typeof this.memory.pressure === "function" && this.memory.pressure()) return "memory is tight right now (the server is dropping its caches); automatic training waits until it is back to normal";
    if (up < this.graceMs) return `the server started ${Math.max(0, Math.round(up / 1000))} s ago, and automatic training waits ${Math.round(this.graceMs / 60000)} minutes after a start`;
    const r = this.record(id);
    if (!r || !r.startedAt || ended(r) || this._live.has(id)) return "";
    // it began and never ended, and it is not running here: the server stopped while it ran
    const n = (Number(r.died) || 0) + 1;
    const until = Date.parse(r.startedAt) + this.pauseAfter(n);
    if (!Number.isFinite(until) || now >= until) return "";
    if (!this._told.has(id)) {
      this._told.add(id);
      this.log.error(`[train-guard] ${id}: the automatic run that began ${r.startedAt} never finished — the server stopped during it (most likely out of memory). Not tried again before ${iso(until)}.`);
    }
    return `its last automatic run (${r.startedAt}) never finished — the server stopped during it, most likely for lack of memory — so it is not tried again before ${iso(until)}`;
  }

  /** Record that `id` begins now. */
  begin(id, trigger = "itself") {
    const prev = this.record(id);
    // the one before began and never ended (and is not running here): one more stop in a row
    const died = prev && prev.startedAt && !ended(prev) && !this._live.has(id) ? (Number(prev.died) || 0) + 1 : 0;
    this._live.add(id);
    this._put(id, { startedAt: iso(this.now()), endedAt: null, trigger: String(trigger), ok: null, error: "", died });
  }

  /** Record that `id` ended (well or with an error: either way the process lived through it). */
  end(id, { ok = true, error = "" } = {}) {
    this._live.delete(id);
    const prev = this.record(id) || {};
    this._put(id, { ...prev, endedAt: iso(this.now()), ok: Boolean(ok), error: String(error || "").slice(0, 200), died: 0 });
  }

  /** Wrap a running job: begun now, ended when the promise settles. Returns the same promise. */
  track(id, trigger, promise) {
    this.begin(id, trigger);
    return Promise.resolve(promise).then(
      (v) => {
        this.end(id, { ok: true });
        return v;
      },
      (err) => {
        this.end(id, { ok: false, error: err && err.message ? err.message : String(err) });
        throw err;
      }
    );
  }

  /** The jobs whose last run never ended (for the health check): [{ id, startedAt, died, until }]. */
  troubles() {
    const now = this.now();
    return Object.entries(this._all())
      .filter(([id, r]) => r && r.startedAt && !ended(r) && !this._live.has(id))
      .map(([id, r]) => {
        const died = (Number(r.died) || 0) + 1;
        const until = Date.parse(r.startedAt) + this.pauseAfter(died);
        return { id, startedAt: r.startedAt, died, until: Number.isFinite(until) ? iso(until) : null, waiting: Number.isFinite(until) && now < until };
      });
  }
}

module.exports = { TrainGuard, NAME, GRACE_MS, BASE_MS, MAX_MS };
