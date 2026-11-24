"use strict";
// Returns on the trader's principal — the journal's percentage figures.
//
//   PRINCIPAL   the money the trader put in: a ledger of dated entries (the first capital, each addition, each
//               withdrawal). The principal on a day is the ledger added up to that day. Profit is not
//               added to it (Zerodha's API does not say what was deposited or withdrawn, so the trader
//               records it; everything else comes from Zerodha's own fills).
//   MONTH       a month's return is its net profit or loss (after charges) over its principal: the principal
//               on the first trading day of the month — and when money is added or taken out during the month,
//               from that day on, so the base is the principal averaged over the month's weekdays, each
//               day at the principal it had that day.
//   PERIOD      the total over any period is the sum of its months' returns, each on its own base (profit is
//               not compounded into the principal), and the average a month.
//   DAY         a day's return is its net over the principal that day.
//   RISK        from the daily returns of every weekday in the period (a day without trades is a day of 0):
//               volatility, Sharpe and Sortino (annualised over 250 trading days, no risk-free rate), the
//               deepest fall of the running total in percentage points of principal, and Calmar.
//
// Pure arithmetic on closed trades and the ledger: no clock, no network, no orders.

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const dayOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const isWeekday = (day) => {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const TRADING_DAYS = 250;

/** Every weekday from `from` to `to`, inclusive. */
function weekdays(from, to) {
  const out = [];
  for (let d = from, n = 0; d <= to && n < 20000; d = addDays(d, 1), n += 1) if (isWeekday(d)) out.push(d);
  return out;
}

/** The ledger as a list sorted by date, ready for lookups. @param entries [{ date, amount }] */
function ledger(entries) {
  return (entries || [])
    .filter((e) => e && DAY_RE.test(e.date) && num(e.amount) && e.amount !== 0)
    .map((e) => ({ id: e.id, date: e.date, amount: e.amount, note: e.note || "" }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
}

/** The principal on a day: every entry dated on or before it, added up (never below zero). */
function principalOn(entries, day) {
  let p = 0;
  for (const e of entries) {
    if (e.date > day) break;
    p += e.amount;
  }
  return Math.max(0, p);
}

/** Whether the ledger would ever go below zero (a withdrawal of money that was not there). */
function overdrawn(entries) {
  let p = 0;
  for (const e of ledger(entries)) {
    p += e.amount;
    if (p < -0.005) return e;
  }
  return null;
}

const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const sd = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * The returns of a period.
 * @param trips     closed trades { exitAt, net, pnl } inside the period (filters already applied)
 * @param entries   the capital ledger
 * @param fromDay   first day of the period; toDay the last
 */
function compute({ trips = [], entries = [], fromDay, toDay }) {
  const led = ledger(entries);
  if (!DAY_RE.test(fromDay || "") || !DAY_RE.test(toDay || "") || fromDay > toDay) return empty(led, "The period is not valid.");
  const byDay = new Map();
  for (const t of trips) {
    const d = dayOf(t.exitAt);
    const x = byDay.get(d) || { net: 0, gross: 0, trades: 0 };
    x.net += (t.net || 0) + (t.other || 0);
    x.gross += t.pnl || 0;
    x.trades += 1;
    byDay.set(d, x);
  }
  const days = weekdays(fromDay, toDay);
  // trades closed on a weekend (a special session) still count, on their own day
  for (const d of byDay.keys()) if (!days.includes(d) && d >= fromDay && d <= toDay) days.push(d);
  days.sort();
  const hasCapital = led.length > 0 && led[0].date <= toDay;
  // month by month
  const months = [];
  const monthKeys = [...new Set(days.map((d) => d.slice(0, 7)))];
  for (const m of monthKeys) {
    const ds = days.filter((d) => d.startsWith(m));
    const withP = ds.map((d) => ({ d, p: principalOn(led, d) })).filter((x) => x.p > 0);
    const base = withP.length ? mean(withP.map((x) => x.p)) : null;
    const net = ds.reduce((a, d) => a + (byDay.get(d) ? byDay.get(d).net : 0), 0);
    const gross = ds.reduce((a, d) => a + (byDay.get(d) ? byDay.get(d).gross : 0), 0);
    const added = led.filter((e) => e.date > ds[0] && e.date <= ds[ds.length - 1]); // after the first trading day: that one is the starting principal
    const trades = ds.reduce((a, d) => a + (byDay.get(d) ? byDay.get(d).trades : 0), 0);
    months.push({ month: m, from: ds[0], to: ds[ds.length - 1], startPrincipal: withP.length ? r2(withP[0].p) : null, endPrincipal: r2(principalOn(led, ds[ds.length - 1])), base: base === null ? null : r2(base), additions: added.map((e) => ({ date: e.date, amount: e.amount, note: e.note })), net: r2(net), gross: r2(gross), trades, tradingDays: ds.filter((d) => byDay.has(d)).length, pct: base ? r2((net / base) * 100) : null, grossPct: base ? r2((gross / base) * 100) : null });
  }
  let cum = 0;
  for (const m of months) {
    if (num(m.pct)) cum += m.pct;
    m.cumPct = num(m.pct) ? r2(cum) : null;
  }
  // day by day
  const daily = [];
  let run = 0;
  const all = [];
  for (const d of days) {
    const p = principalOn(led, d);
    const x = byDay.get(d);
    const pct = p > 0 ? ((x ? x.net : 0) / p) * 100 : null;
    if (pct !== null) {
      run += pct;
      all.push({ d, pct, cum: run });
    }
    if (x) daily.push({ date: d, net: r2(x.net), trades: x.trades, principal: r2(p), pct: pct === null ? null : r2(pct), cumPct: pct === null ? null : r2(run) });
  }
  const pcts = all.map((x) => x.pct);
  const m = mean(pcts);
  const s = sd(pcts);
  const down = pcts.filter((x) => x < 0);
  const dd = down.length ? Math.sqrt(down.reduce((a, x) => a + x * x, 0) / pcts.length) : null;
  let peak = 0;
  let maxDd = 0;
  for (const x of all) {
    peak = Math.max(peak, x.cum);
    maxDd = Math.max(maxDd, peak - x.cum);
  }
  const scored = months.filter((x) => num(x.pct));
  const total = scored.length ? scored.reduce((a, x) => a + x.pct, 0) : null;
  const enough = pcts.length >= 20;
  const annual = enough && m !== null ? m * TRADING_DAYS : null;
  const best = scored.reduce((a, x) => (!a || x.pct > a.pct ? x : a), null);
  const worst = scored.reduce((a, x) => (!a || x.pct < a.pct ? x : a), null);
  const dayRows = daily.filter((x) => num(x.pct));
  const bestDay = dayRows.reduce((a, x) => (!a || x.pct > a.pct ? x : a), null);
  const worstDay = dayRows.reduce((a, x) => (!a || x.pct < a.pct ? x : a), null);
  return {
    hasCapital,
    needsCapital: !hasCapital,
    fromDay,
    toDay,
    principal: { start: r2(principalOn(led, fromDay)), now: r2(principalOn(led, toDay)), added: r2(led.filter((e) => e.date >= fromDay && e.date <= toDay && e.amount > 0).reduce((a, e) => a + e.amount, 0)), withdrawn: r2(-led.filter((e) => e.date >= fromDay && e.date <= toDay && e.amount < 0).reduce((a, e) => a + e.amount, 0)) },
    totalPct: total === null ? null : r2(total),
    avgMonthPct: scored.length ? r2(total / scored.length) : null,
    months,
    daily,
    bestMonth: best ? { month: best.month, pct: best.pct, net: best.net } : null,
    worstMonth: worst ? { month: worst.month, pct: worst.pct, net: worst.net } : null,
    greenMonths: scored.filter((x) => x.pct > 0).length,
    bestDay: bestDay ? { date: bestDay.date, pct: bestDay.pct, net: bestDay.net } : null,
    worstDay: worstDay ? { date: worstDay.date, pct: worstDay.pct, net: worstDay.net } : null,
    risk: {
      days: pcts.length,
      enough,
      volPct: s === null ? null : r2(s),
      annualVolPct: s === null || !enough ? null : r2(s * Math.sqrt(TRADING_DAYS)),
      sharpe: enough && s > 0 ? r2((m / s) * Math.sqrt(TRADING_DAYS)) : null,
      sortino: enough && dd > 0 ? r2((m / dd) * Math.sqrt(TRADING_DAYS)) : null,
      maxDrawdownPct: all.length ? r2(maxDd) : null,
      annualPct: annual === null ? null : r2(annual),
      calmar: annual !== null && maxDd > 0 ? r2(annual / maxDd) : null,
      note: enough ? "" : "Fewer than 20 days: the risk ratios need more days to mean anything.",
    },
    curve: all.map((x) => ({ date: x.d, cumPct: r2(x.cum) })),
    method: "Return = net profit after charges over the principal: the principal on the month's first trading day, and from the day money was added or taken out. Profit is not added to the principal; a period's total is the sum of its months.",
  };
}

function empty(led, why) {
  return { hasCapital: led.length > 0, needsCapital: led.length === 0, error: why, months: [], daily: [], curve: [], principal: { start: null, now: null, added: null, withdrawn: null }, totalPct: null, avgMonthPct: null, risk: { days: 0, enough: false, note: why } };
}

/** The percentage of a set of trades over the principal for the period, or null (used by the period table). */
function periodPct(trips, entries, fromDay, toDay) {
  const r = compute({ trips, entries, fromDay, toDay });
  return { pct: r.totalPct, base: r.months.length ? r.months[r.months.length - 1].base : null };
}

module.exports = { compute, periodPct, ledger, principalOn, overdrawn, weekdays, DAY_RE };
