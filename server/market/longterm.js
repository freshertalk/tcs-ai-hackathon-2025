"use strict";
// The long-term view (months to years): is the primary trend up, down or
// undecided, where are the levels a long-term holder watches, and what has the
// stock actually returned.
//
// This is trend and price history ONLY. It knows nothing about earnings, debt,
// valuation or the business — and long-term investing needs those.

const I = require("./indicators");

const num = I.isNum;
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const fx = (x) => (num(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

/** Monday (UTC) of the week a date falls in — the key for weekly bars. */
function weekStart(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

/** Daily bars → weekly bars (open of the first day, close of the last, high/low extremes). */
function toWeekly(candles) {
  const out = [];
  let key = null;
  for (const c of candles) {
    const k = weekStart(c.t);
    if (k !== key) {
      out.push({ t: k, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
      key = k;
    } else {
      const w = out[out.length - 1];
      if (c.h > w.h) w.h = c.h;
      if (c.l < w.l) w.l = c.l;
      w.c = c.c;
      w.v += c.v;
    }
  }
  return out;
}

/** Compound annual growth over the last `years`, or null when the history is shorter. */
function cagr(candles, years) {
  const n = candles.length;
  const end = candles[n - 1];
  const endMs = Date.parse(`${end.t}T00:00:00Z`);
  const wantMs = endMs - years * 365.25 * 86400000;
  if (Date.parse(`${candles[0].t}T00:00:00Z`) > wantMs + 20 * 86400000) return null;
  let base = candles[0];
  for (const c of candles) {
    if (Date.parse(`${c.t}T00:00:00Z`) > wantMs) break;
    base = c;
  }
  if (!(base.c > 0)) return null;
  return (Math.pow(end.c / base.c, 1 / years) - 1) * 100;
}

/**
 * @param candles  daily bars, oldest first
 * @param a        analyze() output for the same bars (returns, drawdown, 52-week range, relative strength)
 * @param last     the price to measure from (the live price when there is one)
 */
function longTermView(candles, a, last) {
  const n = candles.length;
  if (n < 260) return { available: false, reason: `Only ${n} daily bars — about a year (260) is needed before a long-term trend can be read.` };

  const closes = candles.map((c) => c.c);
  const px = num(last) && last > 0 ? last : closes[n - 1];
  const ema50 = I.ema(closes, 50);
  const ema200 = I.ema(closes, 200);
  const i = n - 1;
  const e50 = ema50[i];
  const e200 = ema200[i];
  const e200Then = ema200[i - 63];

  const wk = toWeekly(candles);
  const wCloses = wk.map((w) => w.c);
  const w = wk.length - 1;
  const w10 = I.ema(wCloses, 10)[w];
  const w30 = I.ema(wCloses, 30)[w];
  const w40 = wk.length >= 40 ? I.sma(wCloses, 40)[w] : null;

  const wk52 = a.levels.week52;
  const y1 = a.returns ? a.returns.y1 : null;
  const rel = a.relative && num(a.relative.y1) ? a.relative : null;

  const checks = [];
  const check = (name, ok, reading) => checks.push({ name, ok: Boolean(ok), reading });
  check("Price above its 200-day average", px > e200, `₹${fx(px)} vs ₹${fx(e200)} (${(pct(px, e200) || 0).toFixed(1)}%)`);
  check("50-day average above the 200-day", e50 > e200, `₹${fx(e50)} vs ₹${fx(e200)}`);
  if (num(e200Then)) check("200-day average rising", e200 > e200Then, `${(pct(e200, e200Then) || 0).toFixed(1)}% over 3 months`);
  if (num(w10) && num(w30)) check("10-week average above the 30-week", w10 > w30, `₹${fx(w10)} vs ₹${fx(w30)}`);
  if (num(wk52.high)) check("Within 25% of its 52-week high", px >= wk52.high * 0.75, `${(pct(px, wk52.high) || 0).toFixed(1)}% from ₹${fx(wk52.high)}`);
  if (num(y1)) check("Higher than a year ago", y1 > 0, `${y1 > 0 ? "+" : ""}${y1.toFixed(1)}% in 12 months`);
  if (rel) check(`Ahead of ${rel.name} over 12 months`, rel.y1 > 0, `${rel.y1 > 0 ? "+" : ""}${rel.y1.toFixed(1)} percentage points`);

  const met = checks.filter((c) => c.ok).length;
  const share = met / checks.length;
  const trend = px > e200 && share >= 0.7 ? "up" : px < e200 && share <= 0.3 ? "down" : "mixed";

  // the line a long-term holder watches: the 40-week (≈200-day) average on weekly closes
  const line = num(w40) ? w40 : e200;
  const lineName = num(w40) ? "40-week average" : "200-day average";
  const zoneLow = Math.min(num(w30) ? w30 : e200, e200);
  const zoneHigh = Math.max(num(w30) ? w30 : e200, e200);
  const stretchPct = pct(px, e200);

  const notes = [];
  let stance;
  let rule;
  if (trend === "up") {
    stance = "Long-term uptrend";
    rule = `By trend rules the long-term case holds while the weekly close stays above the ${lineName} (₹${fx(line)}).`;
    if (px > zoneHigh) notes.push(`Earlier in this trend, pullbacks were tested around the 30-week and 200-day averages (₹${fx(zoneLow)} – ₹${fx(zoneHigh)}), ${(pct(px, zoneHigh) || 0).toFixed(1)}% below the price now.`);
  } else if (trend === "down") {
    stance = "Long-term downtrend";
    rule = `By trend rules this is not a long-term hold until a weekly close back above the ${lineName} (₹${fx(line)}).`;
    notes.push("Cheap can get cheaper: a stock below a falling 200-day average has no trend support, whatever it used to trade at.");
  } else {
    stance = "No clear long-term trend";
    rule = `The long-term picture is undecided. A weekly close above ₹${fx(Math.max(line, zoneHigh))} with the averages turning up would make it an uptrend; below ₹${fx(Math.min(line, zoneLow))}, a downtrend.`;
  }
  if (num(stretchPct) && stretchPct > 40) notes.push(`Price is ${stretchPct.toFixed(0)}% above its 200-day average. Stretches this large have usually been followed by a long pause or a deep pullback.`);
  const dd = a.drawdown || {};
  if (num(dd.maxPct) && dd.maxPct >= 40) notes.push(`In this history it has fallen as much as ${dd.maxPct.toFixed(0)}% from a peak (${dd.maxFrom} → ${dd.maxTo}). A long-term holder has to be able to sit through that.`);

  const first = candles[0].t;
  const years = (Date.parse(`${candles[n - 1].t}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (365.25 * 86400000);

  return {
    available: true,
    trend,
    stance,
    met,
    total: checks.length,
    checks,
    rule,
    notes,
    levels: {
      ema200: r2(e200),
      ema50: r2(e50),
      week30: r2(w30),
      week40: r2(w40),
      line: r2(line),
      lineName,
      zoneLow: r2(zoneLow),
      zoneHigh: r2(zoneHigh),
      week52High: r2(wk52.high),
      week52Low: r2(wk52.low),
      peak: r2(dd.peak),
      peakDate: dd.peakDate || null,
      fromPeakPct: num(dd.peak) ? r2(pct(px, dd.peak)) : null,
      stretchPct: r1(stretchPct),
    },
    returns: {
      y1: r1(y1),
      cagr3: r1(cagr(candles, 3)),
      cagr5: r1(cagr(candles, 5)),
      cagrAll: years >= 1.5 ? r1((Math.pow(closes[n - 1] / closes[0], 1 / years) - 1) * 100) : null,
      years: r1(years),
      since: first,
      vsIndex1y: rel ? r1(rel.y1) : null,
      indexName: rel ? rel.name : null,
    },
    risk: {
      maxDrawdownPct: r1(dd.maxPct),
      currentDrawdownPct: r1(dd.currentPct),
      volatilityPct: r1(a.volatilityPct),
    },
    caveat: "Trend and price history only. Earnings, debt, valuation, management and the business itself are not in this reading — and for holding years, those matter more than any chart.",
  };
}

module.exports = { longTermView, toWeekly, weekStart, cagr };
