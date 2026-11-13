"use strict";
// The strategist's journal: every plan it produced, and — once price has had
// time to decide — what actually happened to it.
//
// Outcomes are scored by arithmetic on real bars, never by the model. That is
// what makes the track record honest, and it is the only material the model is
// later allowed to learn from.


const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const MAX_ENTRIES = 400;
const SWING_MAX_BARS = 20; // a swing plan that has not resolved in 20 sessions is closed at the market

/**
 * What happened to one plan, given the bars that came after it.
 *
 * @param plan   { side: "long"|"short", entry, stop, target, entryType: "at_market"|"on_trigger" }
 * @param bars   bars AFTER the plan was made, oldest first: { t, o, h, l, c }
 * @param opts   { expire: true when no more bars will ever come (the day is over / the window has passed) }
 * @returns { status, r, entryAt, exitAt, exitPrice, note }
 *   status: "pending" (not entered, still time) | "not-triggered" | "open" | "target" | "stop" | "expired"
 *   r: result in multiples of the planned risk (target +, stop −), or null when never entered
 *
 * Rules, chosen to be unflattering:
 *   • when a bar touches both the stop and the target, the stop is counted
 *   • a gap through the stop is filled at the open, so the loss can exceed −1R
 *   • the bar that triggers the entry can also stop it out
 */
function scorePlan(plan, bars, { expire = false } = {}) {
  const long = plan.side === "long";
  const risk = Math.abs(plan.entry - plan.stop);
  if (!(risk > 0) || !Number.isFinite(plan.target)) return { status: "invalid", r: null, note: "The plan has no usable entry, stop or target." };
  const rOf = (px) => r2(((long ? px - plan.entry : plan.entry - px) / risk));
  let entered = plan.entryType === "at_market";
  let entryAt = entered ? "at the time of the plan" : null;

  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    let justEntered = false;
    if (!entered) {
      // a breakout long and a pullback short are entered on the way UP; the other two on the way down
      const upward = long ? plan.entryType !== "pullback" : plan.entryType === "pullback";
      const hit = upward ? b.h >= plan.entry : b.l <= plan.entry;
      if (!hit) continue;
      entered = true;
      justEntered = true;
      entryAt = b.t;
    }
    // a gap beyond the stop: out at the open (only on bars after the entry bar)
    if (!justEntered && (long ? b.o <= plan.stop : b.o >= plan.stop)) {
      return { status: "stop", r: rOf(b.o), entryAt, exitAt: b.t, exitPrice: r2(b.o), note: "Gapped through the stop; filled at the open." };
    }
    const stopHit = long ? b.l <= plan.stop : b.h >= plan.stop;
    const targetHit = long ? b.h >= plan.target : b.l <= plan.target;
    if (stopHit) return { status: "stop", r: -1, entryAt, exitAt: b.t, exitPrice: r2(plan.stop), note: targetHit ? "Stop and target were both touched in the same bar; the stop is counted." : "Stopped out." };
    if (targetHit) return { status: "target", r: rOf(plan.target), entryAt, exitAt: b.t, exitPrice: r2(plan.target), note: "First target reached." };
  }

  const last = bars[bars.length - 1];
  if (!entered) return expire ? { status: "not-triggered", r: null, note: "Price never reached the entry." } : { status: "pending", r: null, note: "Waiting for the entry." };
  if (!last) return { status: "open", r: 0, entryAt, note: "Entered; no bars since." };
  if (expire) return { status: "expired", r: rOf(last.c), entryAt, exitAt: last.t, exitPrice: r2(last.c), note: "Neither stop nor target was reached in time; closed at the last price." };
  return { status: "open", r: rOf(last.c), entryAt, note: "Still open; result so far." };
}

/** Wins, losses and average R over resolved plans. Small numbers prove little, and the caller says so. */
function summarize(entries) {
  const out = { total: 0, resolved: 0, target: 0, stop: 0, expired: 0, notTriggered: 0, pending: 0, rejected: 0, sumR: 0, avgR: null, winRatePct: null };
  for (const e of entries) {
    for (const p of e.plans || []) {
      if (p.action === "no_trade") continue;
      out.total += 1;
      if (p.checkStatus === "rejected") {
        out.rejected += 1;
        continue;
      }
      const s = p.outcome ? p.outcome.status : "pending";
      if (s === "target" || s === "stop" || s === "expired") {
        out.resolved += 1;
        out[s] += 1;
        out.sumR += p.outcome.r || 0;
      } else if (s === "not-triggered") out.notTriggered += 1;
      else out.pending += 1;
    }
  }
  if (out.resolved > 0) {
    out.avgR = r2(out.sumR / out.resolved);
    out.winRatePct = Math.round(((out.target + entriesWon(entries)) / out.resolved) * 100);
  }
  out.sumR = r2(out.sumR);
  return out;
}
// an expired plan closed in profit counts as a win
function entriesWon(entries) {
  let n = 0;
  for (const e of entries) for (const p of e.plans || []) if (p.checkStatus !== "rejected" && p.outcome && p.outcome.status === "expired" && p.outcome.r > 0) n += 1;
  return n;
}

class Journal {
  /** @param docs  the record store (server/docs.js); the journal is "ai/journal.json" */
  constructor({ docs }) {
    this.docs = docs;
    const raw = docs.read("ai/journal.json", []);
    this.entries = Array.isArray(raw) ? raw : [];
  }

  _save() {
    this.docs.write("ai/journal.json", this.entries);
  }

  add(entry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
    this._save();
    return entry;
  }

  save() {
    this._save();
  }

  list({ symbol = null, limit = 30 } = {}) {
    const rows = symbol ? this.entries.filter((e) => e.symbol === symbol) : this.entries;
    return rows.slice(-limit).reverse();
  }

  all() {
    return this.entries;
  }
}

module.exports = { Journal, scorePlan, summarize, SWING_MAX_BARS };
