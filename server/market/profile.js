"use strict";
// The behaviour profile: how ONE stock has actually behaved over the past year of daily bars.
// Not a forecast — a measured record of its habits, so a reading of today can be judged
// against them:
//   trend and regime history (with the 20/50/200-day averages), swing structure,
//   volatility now against its own normal, gaps and how often they fill the same day,
//   what tends to follow a big up or down day, how 20-day breakouts and breakdowns have
//   followed through, how it reacts at its 50-day average, its levels (clustered swing
//   pivots), weekday tendencies, volume on up versus down days, drawdowns —
// and a dated log of the notable days (gaps, breakouts, volume spikes, regime changes).
//
// Pure arithmetic on the bars it is given. Nothing here changes the desk's existing readings.

const I = require("./indicators");

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => {
  const m = mean(a);
  return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : null;
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MIN_BARS = 120;

/** The state of the trend on bar i: price against the 50-day average and that average's slope. */
function stateAt(c, e50, i) {
  if (!Number.isFinite(e50[i]) || !Number.isFinite(e50[i - 10])) return "unknown";
  const slope = pct(e50[i], e50[i - 10]);
  if (c[i] > e50[i] && slope > 0.5) return "uptrend";
  if (c[i] < e50[i] && slope < -0.5) return "downtrend";
  return "sideways";
}

/**
 * @param bars  daily candles { t: "YYYY-MM-DD", o, h, l, c, v }, oldest first (two years is
 *              plenty: one is measured, the year before only warms up the averages)
 * @returns     the profile, or { available: false, reason }
 */
function buildProfile(symbol, bars, { days = 252 } = {}) {
  const all = (bars || []).filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
  if (all.length < MIN_BARS) return { available: false, symbol, reason: `Only ${all.length} daily bars: a behaviour profile needs at least ${MIN_BARS}.` };
  const closesAll = all.map((b) => b.c);
  const e20a = I.ema(closesAll, 20);
  const e50a = I.ema(closesAll, 50);
  const e200a = I.ema(closesAll, 200);
  const atrA = I.atr(all, 14);
  const start = Math.max(1, all.length - days);
  const idx = [];
  for (let i = start; i < all.length; i += 1) idx.push(i);
  const B = all;
  const c = closesAll;
  const last = B.length - 1;
  const ret = (i) => pct(c[i], c[i - 1]);
  const rets = idx.map(ret);
  const volAvg = (i, n = 20) => mean(B.slice(Math.max(0, i - n), i).map((b) => b.v || 0));

  /* ---- price and position */
  const yr = idx.map((i) => B[i]);
  const hi52 = Math.max(...yr.map((b) => b.h));
  const lo52 = Math.min(...yr.map((b) => b.l));
  const back = (n) => (last - n >= 0 ? r2(pct(c[last], c[last - n])) : null);

  /* ---- trend and regimes */
  const states = idx.map((i) => ({ t: B[i].t, s: stateAt(c, e50a, i) }));
  const regimes = [];
  for (const x of states) {
    const cur = regimes[regimes.length - 1];
    if (cur && cur.state === x.s) {
      cur.to = x.t;
      cur.days += 1;
    } else regimes.push({ state: x.s, from: x.t, to: x.t, days: 1 });
  }
  // short flickers (under 5 days) are merged into what came before, so the history reads as phases
  const phases = [];
  for (const r of regimes) {
    const p = phases[phases.length - 1];
    if (p && (r.days < 5 || p.state === r.state)) {
      p.to = r.to;
      p.days += r.days;
    } else phases.push({ ...r });
  }
  const shareOf = (s) => r2((states.filter((x) => x.s === s).length / states.length) * 100);

  /* ---- swing structure */
  const sw = I.swings(yr, 3);
  const lastHighs = sw.highs.slice(-3).map((x) => x.price);
  const lastLows = sw.lows.slice(-3).map((x) => x.price);
  const rising = (a) => a.length >= 2 && a.every((x, k) => k === 0 || x > a[k - 1]);
  const falling = (a) => a.length >= 2 && a.every((x, k) => k === 0 || x < a[k - 1]);
  const structure = rising(lastHighs) && rising(lastLows) ? "higher highs and higher lows" : falling(lastHighs) && falling(lastLows) ? "lower highs and lower lows" : "mixed swings (range or transition)";

  /* ---- volatility */
  const atrPct = idx.map((i) => (Number.isFinite(atrA[i]) ? (atrA[i] / c[i]) * 100 : null)).filter(Number.isFinite);
  const atrNow = atrPct[atrPct.length - 1];
  const atrAvg = mean(atrPct);
  const dsd = sd(rets);
  const big = 2 * dsd;
  const ranges = yr.map((b) => ((b.h - b.l) / b.l) * 100);

  /* ---- gaps */
  const gaps = [];
  for (const i of idx) {
    const g = pct(B[i].o, c[i - 1]);
    if (Math.abs(g) >= 0.75) {
      const filled = g > 0 ? B[i].l <= c[i - 1] : B[i].h >= c[i - 1];
      gaps.push({ i, g, filled });
    }
  }
  const gapStats = (list) => ({ n: list.length, avgPct: r2(mean(list.map((x) => x.g))), fillRatePct: list.length ? r2((list.filter((x) => x.filled).length / list.length) * 100) : null });

  /* ---- what follows a big day */
  const after = (pick) => {
    const ix = idx.filter((i) => i + 1 <= last && pick(ret(i)));
    const n1 = ix.map((i) => ret(i + 1));
    const n5 = ix.filter((i) => i + 5 <= last).map((i) => pct(c[i + 5], c[i]));
    return { n: ix.length, next1AvgPct: r2(mean(n1)), next1UpPct: n1.length ? r2((n1.filter((x) => x > 0).length / n1.length) * 100) : null, next5AvgPct: r2(mean(n5)) };
  };
  // lag-1 autocorrelation of daily returns: positive = moves tend to continue, negative = to reverse
  const ac = (() => {
    const a = rets.slice(1);
    const b = rets.slice(0, -1);
    const ma = mean(a);
    const mb = mean(b);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let k = 0; k < a.length; k += 1) {
      num += (a[k] - ma) * (b[k] - mb);
      da += (a[k] - ma) ** 2;
      db += (b[k] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : null;
  })();
  let upRun = 0;
  let dnRun = 0;
  let maxUp = 0;
  let maxDn = 0;
  for (const r of rets) {
    if (r > 0) {
      upRun += 1;
      dnRun = 0;
    } else if (r < 0) {
      dnRun += 1;
      upRun = 0;
    }
    maxUp = Math.max(maxUp, upRun);
    maxDn = Math.max(maxDn, dnRun);
  }

  /* ---- breakouts and breakdowns of the 20-day range */
  const brk = (up) => {
    const ix = idx.filter((i) => i >= 21 && i + 5 <= last && (up ? c[i] > Math.max(...B.slice(i - 20, i).map((b) => b.h)) : c[i] < Math.min(...B.slice(i - 20, i).map((b) => b.l))));
    // count only the first day of a run: a breakout that keeps making highs is one event
    const firsts = ix.filter((i, k) => k === 0 || i - ix[k - 1] > 3);
    const f5 = firsts.map((i) => pct(c[i + 5], c[i]));
    return { n: firsts.length, followThroughPct: f5.length ? r2((f5.filter((x) => (up ? x > 0 : x < 0)).length / f5.length) * 100) : null, avg5dPct: r2(mean(f5)) };
  };

  /* ---- reactions at the 50-day average while in an uptrend */
  const tests = idx.filter((i) => i + 3 <= last && Number.isFinite(e50a[i]) && stateAt(c, e50a, i - 1) === "uptrend" && B[i].l <= e50a[i] && c[i - 1] > e50a[i - 1]);
  const held = tests.filter((i) => c[i + 1] > e50a[i + 1] || c[i + 2] > e50a[i + 2] || c[i + 3] > e50a[i + 3]);

  /* ---- levels */
  const sr = I.supportResistance(B, { span: 3, lookback: days, tolPct: 1.2, max: 5 });

  /* ---- weekdays */
  const wk = {};
  for (const i of idx) {
    const d = WEEKDAYS[new Date(`${B[i].t}T00:00:00Z`).getUTCDay()];
    (wk[d] = wk[d] || []).push(ret(i));
  }
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].filter((d) => wk[d]).map((d) => ({ day: d, n: wk[d].length, avgPct: r2(mean(wk[d])), upPct: r2((wk[d].filter((x) => x > 0).length / wk[d].length) * 100) }));

  /* ---- volume */
  const upV = idx.filter((i) => ret(i) > 0).map((i) => B[i].v || 0);
  const dnV = idx.filter((i) => ret(i) < 0).map((i) => B[i].v || 0);
  const v1y = mean(yr.map((b) => b.v || 0));
  const spikes = idx.filter((i) => volAvg(i) > 0 && (B[i].v || 0) >= 2 * volAvg(i)).map((i) => ({ t: B[i].t, x: r2((B[i].v || 0) / volAvg(i)), retPct: r2(ret(i)) }));

  /* ---- drawdown */
  let peak = 0;
  let maxDd = 0;
  for (const i of idx) {
    peak = Math.max(peak, c[i]);
    maxDd = Math.min(maxDd, pct(c[i], peak));
  }
  const curDd = pct(c[last], Math.max(...idx.map((i) => c[i])));

  /* ---- the log of notable days */
  const log = [];
  let prevState = null;
  for (const i of idx) {
    const ev = [];
    const g = pct(B[i].o, c[i - 1]);
    if (Math.abs(g) >= 1) ev.push(`gap ${g > 0 ? "up" : "down"} ${Math.abs(r2(g))}%${(g > 0 ? B[i].l <= c[i - 1] : B[i].h >= c[i - 1]) ? " (filled)" : ""}`);
    if (Math.abs(ret(i)) >= big) ev.push(`${ret(i) > 0 ? "big up" : "big down"} day ${r2(ret(i))}%`);
    if (i >= 21 && c[i] > Math.max(...B.slice(i - 20, i).map((b) => b.h))) ev.push("closed at a 20-day high");
    if (i >= 21 && c[i] < Math.min(...B.slice(i - 20, i).map((b) => b.l))) ev.push("closed at a 20-day low");
    const va = volAvg(i);
    if (va > 0 && (B[i].v || 0) >= 2 * va) ev.push(`volume ${r2((B[i].v || 0) / va)}× average`);
    const st = stateAt(c, e50a, i);
    if (prevState && st !== prevState && st !== "unknown") ev.push(`trend turned ${st}`);
    if (Number.isFinite(e200a[i]) && Number.isFinite(e200a[i - 1]) && (c[i] - e200a[i]) * (c[i - 1] - e200a[i - 1]) < 0) ev.push(`crossed ${c[i] > e200a[i] ? "above" : "below"} the 200-day average`);
    prevState = st;
    if (ev.length) log.push({ t: B[i].t, c: r2(c[i]), retPct: r2(ret(i)), events: ev });
  }

  /* ---- the habits, in plain words (only the ones with enough samples to say) */
  const g = { up: gapStats(gaps.filter((x) => x.g > 0)), down: gapStats(gaps.filter((x) => x.g < 0)) };
  const aU = after((r) => r >= big);
  const aD = after((r) => r <= -big);
  const bo = brk(true);
  const bd = brk(false);
  const trendNow = stateAt(c, e50a, last);
  const curPhase = phases[phases.length - 1];
  const facts = [];
  facts.push(`Trend now: ${trendNow} for about ${curPhase ? curPhase.days : 0} sessions; over the year it spent ${shareOf("uptrend")}% of days in an uptrend and ${shareOf("downtrend")}% in a downtrend.`);
  facts.push(`Swings: ${structure}.`);
  if (Number.isFinite(atrNow) && Number.isFinite(atrAvg)) facts.push(`Daily range (ATR) is ${r2(atrNow)}% of price against a 1-year normal of ${r2(atrAvg)}% — volatility is ${atrNow > atrAvg * 1.25 ? "above" : atrNow < atrAvg * 0.8 ? "below" : "near"} its usual.`);
  if (g.up.n >= 8) facts.push(`Gaps up of 0.75%+ (${g.up.n}) filled the same day ${g.up.fillRatePct}% of the time.`);
  if (g.down.n >= 8) facts.push(`Gaps down of 0.75%+ (${g.down.n}) filled the same day ${g.down.fillRatePct}% of the time.`);
  if (aU.n >= 6) facts.push(`After a big up day (${aU.n} of them, ≥ ${r2(big)}%), the next day averaged ${aU.next1AvgPct}% and was up ${aU.next1UpPct}% of the time.`);
  if (aD.n >= 6) facts.push(`After a big down day (${aD.n}), the next day averaged ${aD.next1AvgPct}% and was up ${aD.next1UpPct}% of the time.`);
  if (bo.n >= 5) facts.push(`20-day breakouts (${bo.n}) were higher 5 days later ${bo.followThroughPct}% of the time (average ${bo.avg5dPct}%).`);
  if (bd.n >= 5) facts.push(`20-day breakdowns (${bd.n}) were lower 5 days later ${bd.followThroughPct}% of the time (average ${bd.avg5dPct}%).`);
  if (tests.length >= 4) facts.push(`In uptrends it tested its 50-day average ${tests.length} times and closed back above within 3 days ${r2((held.length / tests.length) * 100)}% of the time.`);
  if (Number.isFinite(ac)) facts.push(`Day-to-day moves tend to ${ac > 0.08 ? "continue" : ac < -0.08 ? "reverse" : "neither continue nor reverse"} (lag-1 correlation ${r2(ac)}).`);
  if (upV.length && dnV.length) facts.push(`Volume on up days is ${r2(mean(upV) / mean(dnV))}× volume on down days${mean(upV) > mean(dnV) * 1.1 ? " — buying days are heavier" : mean(dnV) > mean(upV) * 1.1 ? " — selling days are heavier" : ""}.`);

  return {
    available: true,
    symbol,
    asOf: B[last].t,
    days: idx.length,
    from: B[start].t,
    price: { last: r2(c[last]), high52: r2(hi52), low52: r2(lo52), pos52Pct: r2(((c[last] - lo52) / (hi52 - lo52 || 1)) * 100), changePct: { d1: back(1), w1: back(5), m1: back(21), m3: back(63), m6: back(126), y1: back(Math.min(252, last)) } },
    trend: { now: trendNow, sessions: curPhase ? curPhase.days : 0, ema20: r2(e20a[last]), ema50: r2(e50a[last]), ema200: r2(e200a[last]), slope50Pct: r2(pct(e50a[last], e50a[last - 10])), shareUp: shareOf("uptrend"), shareDown: shareOf("downtrend"), shareSideways: shareOf("sideways"), phases: phases.slice(-10) },
    structure: { pattern: structure, swingHighs: sw.highs.slice(-4).map((x) => ({ t: x.t, price: r2(x.price) })), swingLows: sw.lows.slice(-4).map((x) => ({ t: x.t, price: r2(x.price) })) },
    volatility: { atrPct: r2(atrNow), atrAvgPct: r2(atrAvg), dailySdPct: r2(dsd), bigMovePct: r2(big), avgRangePct: r2(mean(ranges)), regime: atrNow > atrAvg * 1.25 ? "high" : atrNow < atrAvg * 0.8 ? "low" : "normal" },
    gaps: g,
    returns: { upDaysPct: r2((rets.filter((x) => x > 0).length / rets.length) * 100), avgUpPct: r2(mean(rets.filter((x) => x > 0))), avgDownPct: r2(mean(rets.filter((x) => x < 0))), autocorr1: r2(ac), longestUpRun: maxUp, longestDownRun: maxDn, afterBigUp: aU, afterBigDown: aD },
    breakouts: bo,
    breakdowns: bd,
    ema50Tests: { n: tests.length, heldPct: tests.length ? r2((held.length / tests.length) * 100) : null },
    levels: { supports: sr.supports.map((x) => ({ price: r2(x.price), touches: x.touches })), resistances: sr.resistances.map((x) => ({ price: r2(x.price), touches: x.touches })) },
    weekday,
    volume: { avg20: Math.round(volAvg(last + 1) || 0), avg1y: Math.round(v1y || 0), ratioNow: v1y ? r2((B[last].v || 0) / v1y) : null, upVsDown: upV.length && dnV.length ? r2(mean(upV) / mean(dnV)) : null, spikes: spikes.slice(-6) },
    drawdown: { maxPct: r2(maxDd), currentPct: r2(curDd) },
    facts,
    log: log.slice(-120),
  };
}

module.exports = { buildProfile, stateAt, MIN_BARS };
