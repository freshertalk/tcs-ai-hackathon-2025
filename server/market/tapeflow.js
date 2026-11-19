"use strict";
// The recorded tape: what the market recorder (server/recorder.js) keeps for every stock, minute by minute, and what can
// be learned from it. Pure arithmetic: no network, no clock, no database.
//
//   A DAY     one session of one-minute readings, 9:15 to 15:30 (376 of them), for every stock recorded:
//               p   last price                 v   the day's volume so far        a   the day's average price (VWAP)
//               b   quantity waiting to buy    s   quantity waiting to sell       (the whole order book, both sides)
//               fp  the near-month future      fv  its volume                     oi  its open interest (contracts)
//             A reading that was missed is null; nothing is invented or filled in.
//   WHY       the 15-minute forecaster learns from a year of 5-minute price bars. Bars do not say who is waiting to buy
//             and to sell, nor what the futures' open interest is doing, and no archive of those exists: they can only be
//             learned from once they have been recorded. This is where they are recorded.
//   WHAT IS LEARNED
//             For every 5-minute bar of a recorded session the forecaster's own call is made first; what it MISSED
//             (outcome − call, in the stock's own units) is then set against the order book and open interest at that
//             minute. If those readings explain some of the miss — on sessions the weights had not seen — they earn a
//             place in the live forecast as a correction. If they do not, they stay out and the screen says so.
//
// The ten readings (each kept in a small, clipped range so one wild minute cannot dominate):
//   imb      (buy − sell) ÷ (buy + sell) quantity waiting, now: +1 all buyers, −1 all sellers
//   dImb     its change over five minutes
//   imbAvg   its average over fifteen minutes
//   imbRel   against the whole market's at that minute (is this stock bid more than the rest?)
//   mktImb   the market's own
//   oi15     the future's open interest: % change over fifteen minutes
//   oiDay    its % change since the first reading of the day (÷3)
//   build    open interest RISING, signed by the 15-minute price move: + long build-up, − short build-up
//   cover    open interest FALLING, signed by the price move: + short covering, − long unwinding
//   basis    the change in the future's premium over the stock in fifteen minutes (in steps of 0.05%)

const zlib = require("zlib");

const IST = 5.5 * 3600 * 1000;
const OPEN_MIN = 9 * 60 + 15;
const SLOTS = 376; // 9:15 … 15:30, one a minute
const FIELDS = ["p", "v", "a", "b", "s", "fp", "fv", "oi"];
const FLOW = ["imb", "dImb", "imbAvg", "imbRel", "mktImb", "oi15", "oiDay", "build", "cover", "basis"];
const F = FLOW.length;
const VERSION = 1;
const LAMBDA = 0.01; // ridge strength per row: these are small effects, so the weights are held close to zero
const MIN_ROWS = 3000; // fewer rows than this and no weights are fitted at all

const num = (x) => typeof x === "number" && Number.isFinite(x);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** The minute slot of a time: 0 at 9:15 … 375 at 15:30; −1 outside the session. */
const slotOf = (ms) => {
  const s = minOf(ms) - OPEN_MIN;
  return s >= 0 && s < SLOTS ? s : -1;
};
const clockOf = (slot) => {
  const m = OPEN_MIN + slot;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/* ============================================================================ a day */

function emptyDay(date, symbols, fut = {}) {
  const cols = {};
  for (const s of symbols) cols[s] = Object.fromEntries(FIELDS.map((f) => [f, new Array(SLOTS).fill(null)]));
  return {
    date,
    symbols: [...symbols],
    fut: { ...fut },
    cols,
    taken: 0,
    first: null,
    last: null,
    slotsTaken: new Array(SLOTS).fill(0),
  };
}

/** A stock that joins during the day (the watchlist changed, a future appeared) gets empty columns. */
function addSymbol(day, symbol) {
  if (day.cols[symbol]) return;
  day.symbols.push(symbol);
  day.cols[symbol] = Object.fromEntries(FIELDS.map((f) => [f, new Array(SLOTS).fill(null)]));
}

/**
 * Write one minute's readings. @param eq { SYM: { last, volume, avgPrice, buyQty, sellQty } }  @param fu { SYM: { last, volume, oi } }
 * @returns how many stocks had a price
 */
function putSnapshot(day, slot, eq, fu = {}, atIso = null) {
  if (slot < 0 || slot >= SLOTS) return 0;
  let n = 0;
  const pos = (x) => (num(x) && x > 0 ? x : null);
  for (const sym of day.symbols) {
    const c = day.cols[sym];
    const q = eq[sym];
    if (q && pos(q.last)) {
      c.p[slot] = r2(q.last);
      c.v[slot] = num(q.volume) ? Math.round(q.volume) : null;
      c.a[slot] = pos(q.avgPrice) ? r2(q.avgPrice) : null;
      c.b[slot] = num(q.buyQty) ? Math.round(q.buyQty) : null;
      c.s[slot] = num(q.sellQty) ? Math.round(q.sellQty) : null;
      n += 1;
    }
    const f = fu[sym];
    if (f && pos(f.last)) {
      c.fp[slot] = r2(f.last);
      c.fv[slot] = num(f.volume) ? Math.round(f.volume) : null;
      c.oi[slot] = pos(f.oi) ? Math.round(f.oi) : null;
    }
  }
  if (n) {
    if (!day.slotsTaken[slot]) day.taken += 1;
    day.slotsTaken[slot] = 1;
    if (atIso) {
      if (!day.first) day.first = atIso;
      day.last = atIso;
    }
  }
  return n;
}

/** A day → the record that is stored: its columns compressed (about a megabyte for a hundred stocks). */
function packDay(day) {
  const body = { cols: day.cols, slotsTaken: day.slotsTaken };
  return {
    id: day.date,
    date: day.date,
    version: VERSION,
    slots: SLOTS,
    symbols: day.symbols,
    fut: day.fut,
    taken: day.taken,
    first: day.first,
    last: day.last,
    z: zlib.gzipSync(Buffer.from(JSON.stringify(body))).toString("base64"),
  };
}

function unpackDay(rec) {
  if (!rec || !rec.z) return null;
  const body = JSON.parse(zlib.gunzipSync(Buffer.from(rec.z, "base64")).toString("utf8"));
  return {
    date: rec.date,
    symbols: rec.symbols || Object.keys(body.cols),
    fut: rec.fut || {},
    cols: body.cols,
    taken: rec.taken || 0,
    first: rec.first || null,
    last: rec.last || null,
    slotsTaken: body.slotsTaken || new Array(SLOTS).fill(0),
  };
}

/** The day as rows of a spreadsheet: one line per stock per minute that was read. */
function dayCsv(day) {
  const out = ["date,time,symbol,price,day_volume,avg_price,buy_qty_waiting,sell_qty_waiting,future,future_price,future_volume,open_interest"];
  const cell = (x) => (x === null || x === undefined ? "" : String(x));
  for (const sym of day.symbols) {
    const c = day.cols[sym];
    for (let i = 0; i < SLOTS; i += 1) {
      if (c.p[i] === null && c.fp[i] === null) continue;
      out.push(
        [day.date, clockOf(i), /[",\n]/.test(sym) ? `"${sym.replace(/"/g, '""')}"` : sym, cell(c.p[i]), cell(c.v[i]), cell(c.a[i]), cell(c.b[i]), cell(c.s[i]), day.fut[sym] || "", cell(c.fp[i]), cell(c.fv[i]), cell(c.oi[i])].join(","),
      );
    }
  }
  return `${out.join("\n")}\n`;
}

/* ============================================================================ the readings */

/** The last value at or just before a slot (a missed minute borrows the one before it, up to `back` minutes). */
function at(arr, slot, back = 2) {
  for (let i = slot; i >= 0 && i >= slot - back; i -= 1) if (num(arr[i])) return arr[i];
  return null;
}

/** (buy − sell) ÷ (buy + sell) of the quantity waiting at a slot, or null. */
function imbAt(col, slot, back = 2) {
  for (let i = slot; i >= 0 && i >= slot - back; i -= 1) {
    const b = col.b[i];
    const s = col.s[i];
    if (num(b) && num(s) && b + s > 0) return (b - s) / (b + s);
  }
  return null;
}

/** The market's own imbalance at each minute: the average over the stocks read (at least ten), NaN otherwise. */
function marketImb(day) {
  const out = new Float64Array(SLOTS).fill(NaN);
  for (let i = 0; i < SLOTS; i += 1) {
    let sum = 0;
    let n = 0;
    for (const sym of day.symbols) {
      const v = imbAt(day.cols[sym], i, 0);
      if (v !== null) {
        sum += v;
        n += 1;
      }
    }
    if (n >= 10) out[i] = sum / n;
  }
  return out;
}

/**
 * The ten readings for a stock at a minute, or null when its order book was not read then.
 * Open-interest readings are 0 (they say nothing) for a stock with no future or no reading.
 */
function featuresAt(day, symbol, slot, mkt = null) {
  const col = day && day.cols ? day.cols[symbol] : null;
  if (!col || slot < 0 || slot >= SLOTS) return null;
  const imb = imbAt(col, slot);
  if (imb === null) return null;
  const z = new Float64Array(F);
  z[0] = imb;
  const was = slot >= 5 ? imbAt(col, slot - 5) : null;
  z[1] = was === null ? 0 : clip(imb - was, 1);
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, slot - 14); i <= slot; i += 1) {
    const v = imbAt(col, i, 0);
    if (v !== null) {
      sum += v;
      n += 1;
    }
  }
  z[2] = n ? sum / n : imb;
  const m = mkt && num(mkt[slot]) ? mkt[slot] : mkt && slot > 0 && num(mkt[slot - 1]) ? mkt[slot - 1] : null;
  z[3] = m === null ? 0 : clip(imb - m, 1);
  z[4] = m === null ? 0 : m;
  const oi = at(col.oi, slot);
  const p = at(col.p, slot);
  if (oi !== null && slot >= 15) {
    const oi0 = at(col.oi, slot - 15);
    const p0 = at(col.p, slot - 15);
    if (oi0) {
      const ch = clip(((oi - oi0) / oi0) * 100, 3);
      z[5] = ch;
      const dir = p !== null && p0 ? Math.sign(p - p0) : 0;
      z[7] = Math.max(ch, 0) * dir;
      z[8] = Math.max(-ch, 0) * dir;
    }
    const fp = at(col.fp, slot);
    const fp0 = at(col.fp, slot - 15);
    if (fp !== null && fp0 !== null && p && p0) z[9] = clip((((fp - p) / p - (fp0 - p0) / p0) * 100) / 0.05, 4);
  }
  if (oi !== null) {
    let first = null;
    for (let i = 0; i <= slot && first === null; i += 1) if (num(col.oi[i])) first = col.oi[i];
    if (first) z[6] = clip((((oi - first) / first) * 100) / 3, 3);
  }
  return z;
}

/** The readings in plain numbers and words, for the screen. */
function describe(day, symbol, slot, mkt = null) {
  const col = day && day.cols ? day.cols[symbol] : null;
  const z = featuresAt(day, symbol, slot, mkt);
  if (!col || !z) return null;
  const b = at(col.b, slot);
  const s = at(col.s, slot);
  const oi = at(col.oi, slot);
  const hasOi = oi !== null;
  const oi15 = hasOi ? r2(z[5]) : null;
  let position = "";
  if (hasOi && Math.abs(z[5]) >= 0.2) position = z[7] > 0 ? "long build-up" : z[7] < 0 ? "short build-up" : z[8] > 0 ? "short covering" : z[8] < 0 ? "long unwinding" : "";
  return {
    at: clockOf(slot),
    buyQty: b,
    sellQty: s,
    buyShare: b !== null && s !== null && b + s > 0 ? r4(b / (b + s)) : null,
    imb: r4(z[0]),
    imbChange5: r4(z[1]),
    marketImb: mkt && num(mkt[slot]) ? r4(mkt[slot]) : null,
    oi: oi,
    oi15Pct: oi15,
    oiDayPct: hasOi ? r2(z[6] * 3) : null,
    position,
    future: day.fut[symbol] || "",
  };
}

/* ============================================================================ learning what the readings are worth */

/** Sums that add (and fade): readings × readings, and readings × what the forecaster missed, for K horizons. */
class Sums {
  constructor(K) {
    this.K = K;
    this.n = 0;
    this.w = 0;
    this.ztz = new Float64Array(F * F);
    this.zty = new Float64Array(K * F);
  }

  add(z, res, weight = 1) {
    this.n += 1;
    this.w += weight;
    for (let a = 0; a < F; a += 1) {
      const za = z[a] * weight;
      if (za === 0) continue;
      for (let b = a; b < F; b += 1) this.ztz[a * F + b] += za * z[b];
      for (let k = 0; k < this.K; k += 1) this.zty[k * F + a] += za * res[k];
    }
  }

  scale(f) {
    this.w *= f;
    for (let i = 0; i < this.ztz.length; i += 1) this.ztz[i] *= f;
    for (let i = 0; i < this.zty.length; i += 1) this.zty[i] *= f;
  }

  toJSON() {
    return {
      K: this.K,
      n: this.n,
      w: r4(this.w),
      ztz: Array.from(this.ztz, (v) => Math.round(v * 1e6) / 1e6),
      zty: Array.from(this.zty, (v) => Math.round(v * 1e6) / 1e6),
    };
  }

  static from(o, K) {
    const s = new Sums(K);
    if (!o || o.K !== K || !Array.isArray(o.ztz) || o.ztz.length !== F * F || o.zty.length !== K * F) return s;
    s.n = o.n || 0;
    s.w = o.w || 0;
    s.ztz.set(o.ztz);
    s.zty.set(o.zty);
    return s;
  }
}

/** Gauss–Jordan with partial pivoting on a small dense system. */
function solve(A, b, n) {
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) M[i * (n + 1) + j] = A[i * n + j];
    M[i * (n + 1) + n] = b[i];
  }
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r * (n + 1) + c]) > Math.abs(M[p * (n + 1) + c])) p = r;
    if (Math.abs(M[p * (n + 1) + c]) < 1e-12) return null;
    if (p !== c) for (let j = c; j <= n; j += 1) [M[c * (n + 1) + j], M[p * (n + 1) + j]] = [M[p * (n + 1) + j], M[c * (n + 1) + j]];
    const piv = M[c * (n + 1) + c];
    for (let j = c; j <= n; j += 1) M[c * (n + 1) + j] /= piv;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r * (n + 1) + c];
      if (f === 0) continue;
      for (let j = c; j <= n; j += 1) M[r * (n + 1) + j] -= f * M[c * (n + 1) + j];
    }
  }
  return Array.from({ length: n }, (_, i) => M[i * (n + 1) + n]);
}

/** The weights for each horizon: K arrays of F numbers, or null when there are too few rows to say anything. */
function fitSums(sums, { lambda = LAMBDA, minRows = MIN_ROWS } = {}) {
  if (!sums || sums.n < minRows) return null;
  const A = new Float64Array(F * F);
  for (let a = 0; a < F; a += 1) for (let b = a; b < F; b += 1) A[a * F + b] = A[b * F + a] = sums.ztz[a * F + b];
  for (let a = 0; a < F; a += 1) A[a * F + a] += lambda * sums.w + 1e-9;
  const W = [];
  for (let k = 0; k < sums.K; k += 1) {
    const w = solve(A, sums.zty.subarray(k * F, k * F + F), F);
    if (!w) return null;
    W.push(w.map((v) => Math.round(v * 1e6) / 1e6));
  }
  return W;
}

/** The correction the weights make of a set of readings, one per horizon (in the stock's own units), held to ±cap. */
function tiltsOf(W, z, cap = 0.5) {
  if (!W || !z) return null;
  return W.map((w) => {
    let s = 0;
    for (let a = 0; a < F; a += 1) s += w[a] * z[a];
    return clip(s, cap);
  });
}

module.exports = {
  SLOTS,
  FIELDS,
  FLOW,
  F,
  VERSION,
  LAMBDA,
  MIN_ROWS,
  OPEN_MIN,
  slotOf,
  clockOf,
  dateOf,
  minOf,
  emptyDay,
  addSymbol,
  putSnapshot,
  packDay,
  unpackDay,
  dayCsv,
  at,
  imbAt,
  marketImb,
  featuresAt,
  describe,
  Sums,
  fitSums,
  tiltsOf,
};
