"use strict";
// How the paper robot corrects itself, day by day — arithmetic on its own finished trades.
//
//   MISTAKES   each finished trade is classed by what became of its best moment (engine.js); the bad
//              classes are the robot's mistakes: a winner turned loser, a winner held until it gave part
//              back, a winner closed before the bigger move, a trade that never paid. On top of those the
//              habits of a bucket of trades — an hour, a side, the midday lull, a stock that keeps
//              stopping it out, thin scores, trades against the market — are found when they lose.
//   REGISTER   every mistake with how often, what it cost, when it last happened, whether a correction is
//              in place, and whether it came back after the correction.
//   CORRECT    a mistake that has happened often enough in the last sessions proposes ONE change to ONE
//              parameter of the rulebook, within its bounds, with the evidence: the stop to break-even
//              sooner, the give-back exit tighter, more booked at the first target, a higher score, an hour
//              or a stock switched off, a side held to a higher bar. At most two a day, none on a part that
//              was corrected in the last five sessions, and the evidence for opposite changes (selling too
//              early against holding too long) must lean one way.
//   CHECK      after five sessions each correction is measured against the sessions before it: if the
//              trades since average worse by more than 0.15R it is undone and marked so; if not, it stays.
//
// Pure: no AI, no network, no clock. The AI Engine may veto a proposed correction by id after the close
// (robotai.js); it cannot invent one or change a number.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const avg = (xs) => (xs.length ? sum(xs, (x) => x) / xs.length : null);

const WINDOW = 15; // sessions the proposals look at
const COOLDOWN = 5; // sessions before the same part may be corrected again
const CHECK_AFTER = 5;
const MIN_COUNT = 3;
const MIN_SHARE = 0.2;
const MAX_PER_DAY = 2;
const rs = (x) => (num(x) ? `₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");

const leftOf = (t) => Math.max(0, (t.peakPnl || 0) - (t.pnl || 0));
const ranOf = (t) => {
  if (!t.after || !t.after.best) return 0;
  const dir = t.side === "long" ? 1 : -1;
  return Math.max(0, dir * (t.after.best.price - t.exitAvg) * t.qty0);
};

/** The classes of mistake the robot counts, each with what it costs and the change it proposes. */
const PATTERNS = [
  { id: "winner-to-loser", title: "A winner turned into a loser", text: "The trade was up and closed at a loss.", match: (t) => t.outcome && t.outcome.id === "winner-to-loser", cost: leftOf, side: "hold" },
  { id: "gave-back", title: "A winner held until it gave part back", text: "The trade stayed past its best moment and kept under 60% of it.", match: (t) => t.outcome && t.outcome.id === "gave-back", cost: leftOf, side: "hold" },
  { id: "left-early", title: "A winner closed before the bigger move", text: "The price offered a bigger move within 45 minutes of the exit.", match: (t) => t.outcome && t.outcome.id === "left-early", cost: ranOf, side: "early" },
  { id: "never-paid", title: "A trade that never paid", text: "The price never moved meaningfully its way: the entry was not confirmed.", match: (t) => t.outcome && t.outcome.id === "never-paid", cost: (t) => Math.max(0, -(t.net || 0)), side: "entry" },
];

const datesOf = (trades) => [...new Set(trades.map((t) => t.date))].sort();

/** The register: every mistake with its count, cost, last day and the state of its correction. */
function register(trades, corrections = [], dates = []) {
  const days = [...new Set([...dates, ...datesOf(trades)])].sort();
  const recent = new Set(days.slice(-WINDOW));
  const out = [];
  const make = (id, title, text, hits, cost, extra = {}) => {
    const last = hits.length ? hits[hits.length - 1] : null;
    const cors = corrections.filter((c) => c.key === id || (c.key && id.startsWith(`${c.key}:`)));
    const live = cors.filter((c) => c.status === "active" || c.status === "kept").sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
    const after = live ? hits.filter((h) => h.date > live.date).length : 0;
    const since = last ? days.filter((d) => d > last.date).length : null;
    const recentN = hits.filter((h) => recent.has(h.date)).length;
    let state = "open";
    if (live) state = after >= 3 ? "relapse" : since !== null && since >= COOLDOWN ? "fixed" : "corrected";
    else if (cors.some((c) => c.status === "reverted")) state = "reverted";
    else if (recentN === 0) state = "quiet";
    out.push({ id, title, text, count: hits.length, recent: recentN, cost: r2(cost), firstSeen: hits.length ? hits[0].date : null, lastSeen: last ? last.date : null, daysSince: since, state, correction: live ? { id: live.id, date: live.date, summary: live.summary, status: live.status } : null, after, ...extra });
  };
  for (const p of PATTERNS) {
    const hits = trades.filter(p.match).sort((a, b) => (a.date === b.date ? a.entryAt - b.entryAt : a.date < b.date ? -1 : 1));
    if (hits.length) make(p.id, p.title, p.text, hits, sum(hits, p.cost));
  }
  for (const h of habits(trades)) make(h.id, h.title, h.text, h.hits, sum(h.hits, (t) => Math.max(0, -(t.net || 0))), { avgR: h.avgR });
  return out.sort((a, b) => (b.state === "relapse") - (a.state === "relapse") || (b.recent ? 1 : 0) - (a.recent ? 1 : 0) || (b.cost || 0) - (a.cost || 0));
}

/** The habits of a bucket of trades that lose: an hour, a side, the midday lull, thin scores, a stock, trades against the market. */
function habits(trades, { minScore = 45 } = {}) {
  const done = trades.filter((t) => num(t.netR));
  const out = [];
  const bucket = (id, title, text, list, { n = 4, bad = -0.25 } = {}) => {
    const a = avg(list.map((t) => t.netR));
    if (list.length >= n && a !== null && a <= bad) out.push({ id, title, text: `${text} ${list.length} trades averaged ${r2(a)}R.`, hits: list.slice().sort((x, y) => (x.date === y.date ? x.entryAt - y.entryAt : x.date < y.date ? -1 : 1)), avgR: r2(a) });
  };
  for (let h = 9; h <= 15; h += 1) bucket(`hour:${h}`, `Trades entered in the ${h > 12 ? h - 12 : h}${h >= 12 ? " PM" : " AM"} hour`, "This hour keeps losing.", done.filter((t) => t.hour === h));
  for (const s of ["long", "short"]) bucket(`side:${s}`, `${s === "long" ? "Longs" : "Shorts"}`, "This side keeps losing.", done.filter((t) => t.side === s), { n: 6, bad: -0.2 });
  bucket("midday", "Trades in the midday lull (11:30–1:30)", "The lull keeps costing.", done.filter((t) => t.midday), { n: 5, bad: -0.2 });
  bucket("thin", "Trades on a thin score", "Barely-enough scores keep losing.", done.filter((t) => t.score < minScore + 10), { n: 6, bad: -0.15 });
  bucket("against-market", "Trades against the market's lean", "Fighting the market keeps losing.", done.filter((t) => num(t.lean) && (t.side === "long" ? t.lean < -20 : t.lean > 20)), { n: 5, bad: -0.2 });
  const bySym = {};
  for (const t of done) (bySym[t.symbol] = bySym[t.symbol] || []).push(t);
  for (const [sym, list] of Object.entries(bySym)) {
    const stops = list.filter((t) => t.net < 0 && ["stop", "break-even", "trail"].includes(t.why));
    if (stops.length >= 2) out.push({ id: `symbol:${sym}`, title: `${sym} keeps stopping it out`, text: `${stops.length} losing trades in ${sym}.`, hits: stops.sort((x, y) => (x.date === y.date ? x.entryAt - y.entryAt : x.date < y.date ? -1 : 1)), avgR: r2(avg(stops.map((t) => t.netR))) });
  }
  return out;
}

const getPath = (rules, p) => p.split(".").reduce((o, k) => (o ? o[k] : undefined), rules);
function setPath(rules, p, v) {
  const keys = p.split(".");
  let o = rules;
  for (const k of keys.slice(0, -1)) o = o[k] = { ...(o[k] || {}) };
  o[keys[keys.length - 1]] = v;
}

/** Apply or undo a correction's changes on a copy of the rulebook (an undo only where the value is still the one it set). */
function applyChanges(rules, changes) {
  const out = JSON.parse(JSON.stringify(rules));
  for (const c of changes) {
    if (c.op === "add") out.blockHours = [...new Set([...(out.blockHours || []), c.to])];
    else setPath(out, c.param, c.to);
  }
  return out;
}
function revertChanges(rules, changes) {
  const out = JSON.parse(JSON.stringify(rules));
  for (const c of changes) {
    if (c.op === "add") out.blockHours = (out.blockHours || []).filter((h) => h !== c.to);
    else if (getPath(out, c.param) === c.to) {
      if (c.from === undefined) {
        const keys = c.param.split(".");
        let o = out;
        for (const k of keys.slice(0, -1)) o = o[k] || {};
        delete o[keys[keys.length - 1]];
      } else setPath(out, c.param, c.from);
    }
  }
  return out;
}

const step = (v, d, lo, hi) => Math.min(hi, Math.max(lo, r2(v + d)));
const plusDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The corrections the recent trades call for.
 * @param trades       finished trades (newest last is not required)
 * @param rules        the rulebook now
 * @param corrections  every correction so far ({ key, date, status })
 * @param today        "YYYY-MM-DD"
 * @param dates        the sessions on record (to count five of them since a correction)
 */
function propose({ trades, rules, corrections = [], today, dates = [] }) {
  const days = [...new Set([...dates, ...datesOf(trades)])].sort();
  const win = new Set(days.slice(-WINDOW));
  const recent = trades.filter((t) => win.has(t.date) && num(t.netR));
  if (!recent.length) return [];
  const since = (date) => days.filter((d) => d > date).length;
  const blocked = (key) => corrections.some((c) => (c.key === key || c.touch === key) && (c.status === "active" || c.status === "kept") && since(c.date) < COOLDOWN);
  const out = [];
  const add = (p) => out.push({ date: today, status: "proposed", ...p });
  const total = recent.length;
  const hits = (id) => recent.filter(PATTERNS.find((p) => p.id === id).match);
  const cost = (id) => sum(hits(id), PATTERNS.find((p) => p.id === id).cost);
  const enough = (id) => hits(id).length >= MIN_COUNT && hits(id).length / total >= MIN_SHARE;
  const hold = hits("winner-to-loser").length + hits("gave-back").length;
  const early = hits("left-early").length;

  if (enough("winner-to-loser") && !blocked("winner-to-loser") && hold >= early) {
    const to = step(rules.beR, -0.15, 0.5, 1.5);
    if (to !== rules.beR) add({ key: "winner-to-loser", touch: "beR", title: "Move the stop to the entry sooner", summary: `Stop to break-even at +${to}R (was +${rules.beR}R)`, changes: [{ param: "beR", from: rules.beR, to }], why: `${hits("winner-to-loser").length} of the last ${total} trades were up and closed at a loss (${rs(cost("winner-to-loser"))} of profit gone).`, evidence: { n: hits("winner-to-loser").length, of: total, cost: r2(cost("winner-to-loser")) }, cost: cost("winner-to-loser") });
  }
  if (enough("gave-back") && !blocked("gave-back") && hold >= early) {
    const to = step(rules.giveBackPct, -5, 25, 60);
    const t1 = step(rules.t1Share, 10, 25, 75);
    const changes = [];
    if (to !== rules.giveBackPct) changes.push({ param: "giveBackPct", from: rules.giveBackPct, to });
    if (t1 !== rules.t1Share) changes.push({ param: "t1Share", from: rules.t1Share, to: t1 });
    if (changes.length) add({ key: "gave-back", touch: "giveBackPct", title: "Take profit sooner on a winner", summary: changes.map((c) => `${c.param === "giveBackPct" ? "Give-back exit" : "Booked at the first target"} ${c.from}% → ${c.to}%`).join("; "), changes, why: `${hits("gave-back").length} of the last ${total} trades stayed past their best moment and gave part of it back (${rs(cost("gave-back"))} left).`, evidence: { n: hits("gave-back").length, of: total, cost: r2(cost("gave-back")) }, cost: cost("gave-back") });
  }
  if (enough("left-early") && !blocked("left-early") && early > hold) {
    const t1 = step(rules.t1Share, -10, 25, 75);
    const trail = step(rules.trailR, 0.1, 0.4, 1.5);
    const changes = [];
    if (t1 !== rules.t1Share) changes.push({ param: "t1Share", from: rules.t1Share, to: t1 });
    if (trail !== rules.trailR) changes.push({ param: "trailR", from: rules.trailR, to: trail });
    if (changes.length) add({ key: "left-early", touch: "t1Share", title: "Let a winner run a little more", summary: changes.map((c) => `${c.param === "t1Share" ? "Booked at the first target" : "Trailing distance"} ${c.from}${c.param === "t1Share" ? "%" : "R"} → ${c.to}${c.param === "t1Share" ? "%" : "R"}`).join("; "), changes, why: `${hits("left-early").length} of the last ${total} trades were closed before a bigger move that came within 45 minutes (${rs(cost("left-early"))} more was on offer).`, evidence: { n: hits("left-early").length, of: total, cost: r2(cost("left-early")) }, cost: cost("left-early") });
  }
  if (enough("never-paid") && !blocked("never-paid")) {
    const to = step(rules.minScore, 3, 35, 75);
    if (to !== rules.minScore) add({ key: "never-paid", touch: "minScore", title: "Ask for a higher score", summary: `Minimum score ${rules.minScore} → ${to}`, changes: [{ param: "minScore", from: rules.minScore, to }], why: `${hits("never-paid").length} of the last ${total} trades never went meaningfully its way (${rs(cost("never-paid"))} lost): the entries were not confirmed.`, evidence: { n: hits("never-paid").length, of: total, cost: r2(cost("never-paid")) }, cost: cost("never-paid") });
  }
  for (const h of habits(recent, { minScore: rules.minScore })) {
    if (blocked(h.id)) continue;
    const c = sum(h.hits, (t) => Math.max(0, -(t.net || 0)));
    if (h.id.startsWith("hour:")) {
      const hour = Number(h.id.slice(5));
      if (!(rules.blockHours || []).includes(hour)) add({ key: h.id, touch: h.id, title: `Stop entering in the ${hour > 12 ? hour - 12 : hour}${hour >= 12 ? " PM" : " AM"} hour`, summary: `No entries at ${hour}:00–${hour}:59`, changes: [{ op: "add", param: "blockHours", to: hour }], why: h.text, evidence: { n: h.hits.length, avgR: h.avgR, cost: r2(c) }, cost: c });
    } else if (h.id.startsWith("side:")) {
      const s = h.id.slice(5);
      const to = step((rules.sideBump || {})[s] || 0, 5, 0, 15);
      if (to !== ((rules.sideBump || {})[s] || 0)) add({ key: h.id, touch: h.id, title: `Hold ${s}s to a higher bar`, summary: `${s === "long" ? "Longs" : "Shorts"} need ${to} more points of score`, changes: [{ param: `sideBump.${s}`, from: (rules.sideBump || {})[s] || 0, to }], why: h.text, evidence: { n: h.hits.length, avgR: h.avgR, cost: r2(c) }, cost: c });
    } else if (h.id === "midday") {
      const to = step(rules.middayExtra, 5, 0, 25);
      if (to !== rules.middayExtra) add({ key: h.id, touch: h.id, title: "Ask more of a midday entry", summary: `Midday score bar +${rules.middayExtra} → +${to}`, changes: [{ param: "middayExtra", from: rules.middayExtra, to }], why: h.text, evidence: { n: h.hits.length, avgR: h.avgR, cost: r2(c) }, cost: c });
    } else if (h.id === "thin") {
      const to = step(rules.minScore, 3, 35, 75);
      if (to !== rules.minScore && !out.some((x) => x.touch === "minScore")) add({ key: h.id, touch: "minScore", title: "Ask for a higher score", summary: `Minimum score ${rules.minScore} → ${to}`, changes: [{ param: "minScore", from: rules.minScore, to }], why: h.text, evidence: { n: h.hits.length, avgR: h.avgR, cost: r2(c) }, cost: c });
    } else if (h.id === "against-market" && !rules.requireMarket) {
      add({ key: h.id, touch: h.id, title: "Stop trading against the market", summary: "Skip trades against the market's lean", changes: [{ param: "requireMarket", from: false, to: true }], why: h.text, evidence: { n: h.hits.length, avgR: h.avgR, cost: r2(c) }, cost: c });
    } else if (h.id.startsWith("symbol:")) {
      const sym = h.id.slice(7);
      const until = plusDays(today, 5);
      if (!rules.blockSymbols || !rules.blockSymbols[sym] || rules.blockSymbols[sym] < until) add({ key: h.id, touch: h.id, title: `Stay out of ${sym} for a few sessions`, summary: `No ${sym} until ${until}`, changes: [{ param: `blockSymbols.${sym}`, from: undefined, to: until }], why: h.text, evidence: { n: h.hits.length, avgR: h.avgR, cost: r2(c) }, cost: c });
    }
  }
  return out.sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, MAX_PER_DAY).map((p, i) => ({ ...p, id: `c:${today}:${p.key}:${i}`, baseline: { n: total, avgR: r2(avg(recent.map((t) => t.netR))) }, evalAfter: CHECK_AFTER }));
}

/**
 * Measure the active corrections: after CHECK_AFTER sessions, the trades since against the baseline taken when it was made.
 * @returns { corrections (updated copies), reverts: [correction] }
 */
function evaluate(corrections, trades, today, dates = []) {
  const days = [...new Set([...dates, ...datesOf(trades)])].sort();
  const reverts = [];
  const next = corrections.map((c) => {
    if (c.status !== "active") return c;
    const sessions = days.filter((d) => d > c.date).length;
    if (sessions < (c.evalAfter || CHECK_AFTER)) return c;
    const after = trades.filter((t) => t.date > c.date && num(t.netR));
    const a = avg(after.map((t) => t.netR));
    const b = c.baseline && num(c.baseline.avgR) ? c.baseline.avgR : null;
    if (after.length >= 6 && a !== null && b !== null && a < b - 0.15) {
      const u = { ...c, status: "reverted", checkedAt: today, result: { n: after.length, avgR: r2(a), baseline: b } };
      reverts.push(u);
      return u;
    }
    return { ...c, status: "kept", checkedAt: today, result: { n: after.length, avgR: r2(a), baseline: b, note: after.length < 6 ? "too few trades since to judge: kept" : "" } };
  });
  return { corrections: next, reverts };
}

/** The learning curve: one point per session, with a rolling five-session average of R and of mistakes. */
function progress(trades) {
  const dates = datesOf(trades);
  let cum = 0;
  const rows = dates.map((date) => {
    const day = trades.filter((t) => t.date === date);
    const bad = day.filter((t) => t.outcome && t.outcome.tone === "bad").length;
    const net = sum(day, (t) => t.net);
    cum += net;
    return { date, trades: day.length, net: r2(net), cum: r2(cum), winPct: day.length ? Math.round((day.filter((t) => t.net > 0).length / day.length) * 100) : null, avgR: r2(avg(day.filter((t) => num(t.netR)).map((t) => t.netR))), bad, badShare: day.length ? Math.round((bad / day.length) * 100) : null };
  });
  rows.forEach((r, i) => {
    const w = rows.slice(Math.max(0, i - 4), i + 1);
    const n = sum(w, (x) => x.trades);
    const days = dates.slice(Math.max(0, i - 4), i + 1);
    const ts = trades.filter((t) => days.includes(t.date) && num(t.netR));
    r.rollR = ts.length ? r2(avg(ts.map((t) => t.netR))) : null;
    r.rollBad = n ? Math.round((sum(w, (x) => x.bad) / n) * 100) : null;
  });
  return rows;
}

module.exports = { PATTERNS, WINDOW, COOLDOWN, CHECK_AFTER, register, habits, propose, evaluate, applyChanges, revertChanges, progress };
