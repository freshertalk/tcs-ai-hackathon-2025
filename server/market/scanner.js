"use strict";
// The custom scanner: conditions the trader puts together (like Chartink or Streak scans), checked
// on every Nifty 500 stock's daily closes with today's live price as the newest bar. All conditions
// must hold. Pure functions: no network, no clock, no orders.

const MAX_CONDITIONS = 6;
const TYPES = ["rsi", "ma", "cross", "change", "high52", "low52", "streak", "today"];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x) => (x === "" || x === null || x === undefined ? NaN : Number(x));

function sma(c, n, end = c.length) {
  if (end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i += 1) s += c[i];
  return s / n;
}
function ema(c, n, end = c.length) {
  if (end < n) return null;
  let e = sma(c, n, n);
  const k = 2 / (n + 1);
  for (let i = n; i < end; i += 1) e = c[i] * k + e * (1 - k);
  return e;
}
const ma = (kind, c, n, end) => (kind === "ema" ? ema(c, n, end) : sma(c, n, end));
function rsi(c, n) {
  if (c.length < n + 1) return null;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = c[i] - c[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  for (let i = n + 1; i < c.length; i += 1) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}

/** Cleans a list of conditions from the page; throws a plain message when one makes no sense. */
function validate(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("Add at least one condition.");
  if (list.length > MAX_CONDITIONS) throw new Error(`At most ${MAX_CONDITIONS} conditions.`);
  return list.map((c) => {
    const type = String((c && c.type) || "");
    if (!TYPES.includes(type)) throw new Error("Unknown condition.");
    const op = c.op === "below" ? "below" : c.op === "between" ? "between" : "above";
    const kind = c.kind === "ema" ? "ema" : "sma";
    if (type === "rsi") {
      const a = num(c.a);
      const b = num(c.b);
      if (!Number.isFinite(a) || a < 0 || a > 100) throw new Error("RSI is a number from 0 to 100.");
      if (op === "between" && (!Number.isFinite(b) || b < 0 || b > 100)) throw new Error("Give both RSI values.");
      return { type, period: clamp(Math.round(num(c.period) || 14), 2, 50), op, a, b: op === "between" ? b : null };
    }
    if (type === "ma") return { type, kind, period: clamp(Math.round(num(c.period) || 50), 5, 200), op: op === "below" ? "below" : "above" };
    if (type === "cross") {
      const fast = clamp(Math.round(num(c.fast) || 50), 5, 199);
      const slow = clamp(Math.round(num(c.slow) || 200), fast + 1, 200);
      return { type, kind, fast, slow, dir: c.dir === "below" ? "below" : "above", within: clamp(Math.round(num(c.within) || 5), 1, 20) };
    }
    if (type === "change") {
      const v = num(c.value);
      if (!Number.isFinite(v) || Math.abs(v) > 500) throw new Error("The change is a percentage.");
      return { type, days: clamp(Math.round(num(c.days) || 20), 1, 250), op: op === "below" ? "below" : "above", value: v };
    }
    if (type === "high52" || type === "low52") {
      const v = num(c.within);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error("“Within” is a percentage.");
      return { type, within: v };
    }
    if (type === "streak") return { type, dir: c.dir === "down" ? "down" : "up", days: clamp(Math.round(num(c.days) || 3), 2, 10) };
    const v = num(c.value);
    if (!Number.isFinite(v) || Math.abs(v) > 30) throw new Error("Today's change is a percentage.");
    return { type: "today", op: op === "below" ? "below" : "above", value: v };
  });
}

/**
 * Does one stock pass every condition?
 * @param c closes, oldest first, the newest being today's live price when the market is open
 * @param todayPct today's change from the previous close, in percent
 */
function passes(c, todayPct, conds) {
  const last = c[c.length - 1];
  for (const k of conds) {
    if (k.type === "rsi") {
      const r = rsi(c, k.period);
      if (r === null) return false;
      if (k.op === "above" && !(r >= k.a)) return false;
      if (k.op === "below" && !(r <= k.a)) return false;
      if (k.op === "between" && !(r >= Math.min(k.a, k.b) && r <= Math.max(k.a, k.b))) return false;
    } else if (k.type === "ma") {
      const m = ma(k.kind, c, k.period);
      if (m === null) return false;
      if (k.op === "above" ? !(last > m) : !(last < m)) return false;
    } else if (k.type === "cross") {
      // the fast average crossed the slow one within the last N sessions, and is still on that side
      let hit = false;
      for (let back = 0; back < k.within && !hit; back += 1) {
        const end = c.length - back;
        const f1 = ma(k.kind, c, k.fast, end);
        const s1 = ma(k.kind, c, k.slow, end);
        const f0 = ma(k.kind, c, k.fast, end - 1);
        const s0 = ma(k.kind, c, k.slow, end - 1);
        if ([f1, s1, f0, s0].some((x) => x === null)) return false;
        hit = k.dir === "above" ? f0 <= s0 && f1 > s1 : f0 >= s0 && f1 < s1;
      }
      const fn = ma(k.kind, c, k.fast);
      const sn = ma(k.kind, c, k.slow);
      if (!hit || (k.dir === "above" ? !(fn > sn) : !(fn < sn))) return false;
    } else if (k.type === "change") {
      if (c.length <= k.days) return false;
      const ch = ((last - c[c.length - 1 - k.days]) / c[c.length - 1 - k.days]) * 100;
      if (k.op === "above" ? !(ch >= k.value) : !(ch <= k.value)) return false;
    } else if (k.type === "high52" || k.type === "low52") {
      const w = c.slice(-250);
      if (w.length < 120) return false;
      if (k.type === "high52") {
        const hi = Math.max(...w);
        if (!(((hi - last) / hi) * 100 <= k.within)) return false;
      } else {
        const lo = Math.min(...w);
        if (!(((last - lo) / lo) * 100 <= k.within)) return false;
      }
    } else if (k.type === "streak") {
      if (c.length <= k.days) return false;
      for (let i = 0; i < k.days; i += 1) {
        const a = c[c.length - 1 - i];
        const b = c[c.length - 2 - i];
        if (k.dir === "up" ? !(a > b) : !(a < b)) return false;
      }
    } else if (k.type === "today") {
      if (!Number.isFinite(todayPct)) return false;
      if (k.op === "above" ? !(todayPct >= k.value) : !(todayPct <= k.value)) return false;
    }
  }
  return true;
}

/** A plain-English line for one condition (for the results header and saved scans). */
function describe(k) {
  if (k.type === "rsi") return `RSI(${k.period}) ${k.op === "between" ? `between ${k.a} and ${k.b}` : `${k.op === "above" ? "at least" : "at most"} ${k.a}`}`;
  if (k.type === "ma") return `price ${k.op} its ${k.period}-day ${k.kind.toUpperCase()}`;
  if (k.type === "cross") return `${k.fast}-day ${k.kind.toUpperCase()} crossed ${k.dir} the ${k.slow}-day in the last ${k.within} session${k.within === 1 ? "" : "s"}`;
  if (k.type === "change") return `${k.days}-day change ${k.op === "above" ? "at least" : "at most"} ${k.value}%`;
  if (k.type === "high52") return `within ${k.within}% of the 52-week high`;
  if (k.type === "low52") return `within ${k.within}% of the 52-week low`;
  if (k.type === "streak") return `closed ${k.dir} ${k.days} days in a row`;
  return `today's change ${k.op === "above" ? "at least" : "at most"} ${k.value}%`;
}

module.exports = { validate, passes, describe, rsi, sma, ema, MAX_CONDITIONS, TYPES };
