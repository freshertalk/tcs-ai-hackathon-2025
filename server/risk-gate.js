"use strict";
// The risk gate: the questions a risk manager asks before any trade is allowed to exist — and the size that is left once
// they have been asked. Every proposal the autonomous desk makes passes through it, and so does anything it shows as
// "how much could I take?".
//
//   RULES (blocks)   the day is locked by the risk guard · no capital set · the setup pays less than the minimum reward-to-risk
//                    · a results/announcement window · the day's quota of proposals is used · you already hold it that way
//                    · the open-positions cap is reached
//   SIZE (cuts)      risk per trade = capital × risk % × the size factor (events, regime, lean, the setup's own record)
//                    · a position is never more than a set share of capital · a sector never more than a set share
//                    · a stock that moves with one you hold (correlation ≥ 0.8, same side) gets half
//   WARNINGS         the account is already losing today, opposite positions in correlated stocks, a thin cushion to the loss limit
//
// The gate only reads and computes. It places nothing, and it can only ever reduce a size or refuse — never raise one.
// Pure functions: the service supplies the account, the positions and the prices.

const { sectorOf: defaultSector } = require("./market/sectors");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const rs = (x) => `₹${Math.round(x).toLocaleString("en-IN")}`;

const DEFAULTS = { capital: 0, riskPct: 0.5, maxPositionPct: 25, maxSectorPct: 35, maxGrossPct: 150, minRR: 1.5, maxProposals: 6 };

/** Clean the owner's settings: numbers inside sane limits, never looser than the hard caps. */
function cleanSettings(input = {}, cur = DEFAULTS) {
  const pick = (v, lo, hi, d) => {
    const x = Number(v);
    return Number.isFinite(x) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, x)) : d;
  };
  return {
    capital: Math.round(pick(input.capital, 0, 1e10, cur.capital)),
    riskPct: r2(pick(input.riskPct, 0.05, 2, cur.riskPct)),
    maxPositionPct: Math.round(pick(input.maxPositionPct, 1, 100, cur.maxPositionPct)),
    maxSectorPct: Math.round(pick(input.maxSectorPct, 5, 100, cur.maxSectorPct)),
    maxGrossPct: Math.round(pick(input.maxGrossPct, 10, 500, cur.maxGrossPct)),
    minRR: r2(pick(input.minRR, 1, 5, cur.minRR)),
    maxProposals: Math.round(pick(input.maxProposals, 1, 30, cur.maxProposals)),
  };
}

/** Pearson correlation of two return series (the last n of each), or null with fewer than 20 pairs. */
function correlation(closesA, closesB, n = 60) {
  const ret = (c) => c.slice(1).map((x, i) => (c[i] > 0 ? x / c[i] - 1 : 0));
  const a = ret(closesA.slice(-(n + 1)));
  const b = ret(closesB.slice(-(n + 1)));
  const m = Math.min(a.length, b.length);
  if (m < 20) return null;
  const x = a.slice(-m);
  const y = b.slice(-m);
  const mx = x.reduce((s, v) => s + v, 0) / m;
  const my = y.reduce((s, v) => s + v, 0) / m;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < m; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? r2(sxy / Math.sqrt(sxx * syy)) : null;
}

/**
 * Would this trade be allowed, and how big?
 * @param a { symbol, side: "long"|"short", entry, stop, targets: [t1, t2], sizeFactor (0..1),
 *            settings, positions: [{ symbol, side, qty, avg, last }], standing (the risk guard's), events: { avoidNew },
 *            proposalsToday, corr: (symbol, otherSymbol) => number|null, sectorOf }
 * @returns { allowed, qty, riskRs, riskOfCapitalPct, valueRs, capitalPct, rr, sizeFactor, reasons: [{ level: "block"|"cut"|"warn"|"ok", text }], exposure }
 */
function gate({ symbol, side, entry, stop, targets = [], sizeFactor = 1, settings = DEFAULTS, positions = [], standing = null, events = null, proposalsToday = 0, corr = () => null, sectorOf = defaultSector }) {
  const S = { ...DEFAULTS, ...settings };
  const reasons = [];
  const block = (text) => reasons.push({ level: "block", text });
  const cut = (text) => reasons.push({ level: "cut", text });
  const warn = (text) => reasons.push({ level: "warn", text });
  const long = side === "long";
  const risk = long ? entry - stop : stop - entry;
  const t1 = targets[0];
  const rr = num(t1) && risk > 0 ? r2((long ? t1 - entry : entry - t1) / risk) : null;

  const open = (positions || []).filter((p) => p && p.qty);
  const val = (p) => Math.abs(p.qty) * (num(p.last) ? p.last : p.avg || 0);
  const sector = sectorOf(symbol);
  const exposure = { grossRs: Math.round(open.reduce((s, p) => s + val(p), 0)), sector, sectorRs: Math.round(open.filter((p) => sectorOf(p.symbol) === sector).reduce((s, p) => s + val(p), 0)), open: open.length };

  if (!(entry > 0) || !(risk > 0)) block("The entry and stop do not make a valid trade (the stop must be on the losing side of the entry).");
  if (!(S.capital > 0)) block("Set your trading capital in the autopilot settings: without it a safe size cannot be worked out.");
  if (standing && standing.locked) block(`The risk guard has locked the day${standing.lock && standing.lock.reason ? `: ${standing.lock.reason}` : ""}. Nothing that adds risk is proposed.`);
  if (events && events.avoidNew) block("An announcement window: no new trades around it.");
  if (num(rr) && rr < S.minRR) block(`The first target pays ${rr}× the risk; the minimum is ${S.minRR}×.`);
  if (proposalsToday >= S.maxProposals) block(`${proposalsToday} proposals today already (the limit is ${S.maxProposals}): the quota keeps the day selective.`);
  const same = open.find((p) => p.symbol === symbol);
  if (same && (same.qty > 0) === long) block(`You already hold ${symbol} on that side.`);
  if (standing && standing.room && standing.room.open === 0 && !same) block("The open-positions limit of the risk guard is reached.");
  if (reasons.some((r) => r.level === "block")) return { allowed: false, qty: 0, riskRs: 0, riskOfCapitalPct: 0, valueRs: 0, capitalPct: 0, rr, sizeFactor: 0, reasons, exposure };

  // size from the risk budget
  const f = Math.min(1, Math.max(0, sizeFactor));
  const budget = (S.capital * S.riskPct) / 100 * f;
  let qty = Math.floor(budget / risk);
  const base = qty;
  if (f < 1) cut(`Size ×${r2(f)} (events, regime, lean or the setup's own record): a risk budget of ${rs(budget)} instead of ${rs((S.capital * S.riskPct) / 100)}.`);
  const maxValue = (S.capital * S.maxPositionPct) / 100;
  if (qty * entry > maxValue) {
    qty = Math.floor(maxValue / entry);
    cut(`A position is limited to ${S.maxPositionPct}% of capital (${rs(maxValue)}): ${qty} shares.`);
  }
  // sector concentration
  const sectorRoom = (S.capital * S.maxSectorPct) / 100 - exposure.sectorRs;
  if (sector !== "Other" && qty * entry > sectorRoom) {
    qty = Math.max(0, Math.floor(sectorRoom / entry));
    cut(`${sector} would pass ${S.maxSectorPct}% of capital (${rs(exposure.sectorRs)} already): ${qty} shares fit.`);
  }
  // gross exposure
  const grossRoom = (S.capital * S.maxGrossPct) / 100 - exposure.grossRs;
  if (qty * entry > grossRoom) {
    qty = Math.max(0, Math.floor(grossRoom / entry));
    cut(`Total exposure would pass ${S.maxGrossPct}% of capital: ${qty} shares fit.`);
  }
  // stocks that move together are one bet
  for (const p of open) {
    if (p.symbol === symbol) continue;
    const c = corr(symbol, p.symbol);
    if (num(c) && c >= 0.8) {
      const sameSide = (p.qty > 0) === long;
      if (sameSide) {
        qty = Math.floor(qty / 2);
        cut(`${symbol} has moved with ${p.symbol} (correlation ${c}) and you hold it on the same side: it is nearly the same bet, so half the size.`);
        break;
      }
      warn(`${p.symbol} (correlation ${c}) is held on the other side: this partly hedges it.`);
    }
  }
  if (standing && standing.room && num(standing.room.loss) && standing.dayPnl < 0) warn(`The account is down ${rs(-standing.dayPnl)} today; ${rs(standing.room.loss)} is left before the daily loss limit.`);
  if (qty < 1) {
    block(base < 1 ? `One share risks ${rs(risk)}, more than the whole budget for this trade (${rs(budget)}).` : "After the limits above, not even one share fits.");
    return { allowed: false, qty: 0, riskRs: 0, riskOfCapitalPct: 0, valueRs: 0, capitalPct: 0, rr, sizeFactor: r2(f), reasons, exposure };
  }
  const riskRs = Math.round(qty * risk);
  if (!reasons.length) reasons.push({ level: "ok", text: "Inside every limit." });
  return { allowed: true, qty, riskRs, riskOfCapitalPct: r2((riskRs / S.capital) * 100), valueRs: Math.round(qty * entry), capitalPct: r2(((qty * entry) / S.capital) * 100), rr, sizeFactor: r2(f), reasons, exposure };
}

module.exports = { gate, cleanSettings, correlation, DEFAULTS };
