"use strict";
// Self-healing helpers (23 Nov 2026): a background job that hangs (a network call that never answers) must not stop its service
// for ever. `deadline` races a job against a clock: past it, the caller is freed and the job is reported as timed out (it may
// still finish later; its result is then ignored). `guardedTick` wraps a service's "one at a time" tick so a stuck run is let go
// after `ms` and the next tick runs normally — and counts how often that happened, for the health page.

class DeadlineError extends Error {
  constructor(label, ms) {
    super(`${label} took longer than ${Math.round(ms / 1000)} s and was let go (it will be tried again on the next round)`);
    this.code = "deadline";
  }
}

/** Resolve or reject with `job`, or reject with a DeadlineError after `ms`. */
function deadline(job, ms, label = "a job") {
  let timer;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms); // cleared as soon as the job settles
    // the clock never keeps the process alive by itself (a stop, or a test that leaves a job open, ends on time)
    if (timer.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(job), clock]).finally(() => clearTimeout(timer));
}

/**
 * One-at-a-time ticks that heal: `run()` is the tick body. While one run is in flight a second call returns it; a run older than
 * `ms` is abandoned (logged once) so the service carries on. @returns { tick(), status() }
 */
function guardedTick(name, run, { ms = 4 * 60000, log = console, now = () => Date.now() } = {}) {
  let inFlight = null;
  let startedAt = 0;
  let abandoned = 0;
  let lastError = "";
  let lastAbandonAt = null;
  const tick = () => {
    if (inFlight && now() - startedAt < ms) return inFlight;
    if (inFlight) {
      abandoned += 1;
      lastAbandonAt = new Date(now()).toISOString();
      log.error(`[${name}] a run started ${Math.round((now() - startedAt) / 1000)} s ago never finished: let go, starting afresh`);
    }
    startedAt = now();
    const mine = deadline(Promise.resolve().then(run), ms, `${name}'s run`)
      .catch((err) => {
        lastError = (err && err.message) || String(err);
        if (!err || err.code !== "deadline") log.error(`[${name}] ${lastError}`);
      })
      .finally(() => {
        if (inFlight === mine) inFlight = null;
      });
    inFlight = mine;
    return mine;
  };
  return { tick, status: () => ({ busy: Boolean(inFlight), abandoned, lastAbandonAt, lastError }) };
}

module.exports = { deadline, guardedTick, DeadlineError };
