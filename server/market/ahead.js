"use strict";
// Early calls: what the price is about to do in the next 5 to 20 minutes, said BEFORE it happens —
//
//   REVERSAL   a move is on (the last 15 minutes went one way): will it TURN — give back at least half a usual move?
//   FOLLOW     …or will it CARRY ON — add at least half a usual move the same way?
//   MOMENTUM   is a LARGE move coming (a full usual move or more, either way), or is the price about to go QUIET?
//
// (The TREND itself — up, down or sideways, 5 and 15 minutes ahead — is the 15-minute forecaster's call, server/market/
// horizon.js. These calls stand beside it and are made from the same inputs.)
//
//   HOW      Every finished 5-minute bar is described by the forecaster's inputs, turned to face the way the price has
//            just been going ("aligned"): stretched from VWAP in the move's direction, RSI gone with it, the last bar
//            closing against it, volume drying up, the day's extreme just ahead… plus a few of their own (bars in a row,
//            the move slowing, how quiet or wide the last bars were, the midday lull). One pooled model over every
//            NIFTY 100 stock, in each stock's own units, as the forecaster is.
//   FIT      ridge regression on yes/no outcomes by sufficient statistics (sums that ADD, so a new day is added and old
//            days fade); the raw score is then CALIBRATED against what really happened on sessions the weights had not
//            seen: "when the score was this high, it happened this often". The number shown is that measured frequency.
//   HONEST   each call is shown beside its USUAL rate (how often it happens anyway). A call is used on the screen only
//            while it has beaten "always say the usual rate" on unseen sessions (Brier skill); otherwise it says so.
//            A reversal is never a certainty: most warnings are "more likely than usual", and the screen shows how often
//            the move really turned after such a warning.
//
// Pure arithmetic: no AI, no network, no clock, no orders.

const H = require("./horizon");

const BAR = H.BAR;
const AHEAD = [1, 2, 3, 4]; // bars of five minutes: 5, 10, 15, 20 minutes
const TURN_MIN = 0.5; // "it turned": against the move by at least half a usual move for that time
const GO_MIN = 0.5; // "it carried on": with the move by at least half a usual move
const BIG_MIN = 1.0; // "a large move": a whole usual move or more, either way
const CALM_MAX = 0.4; // "quiet": less than 0.4 of a usual move
const RUN_MIN = 0.8; // "a move is on": the last 15 minutes covered at least 0.8 of a usual 15-minute move
const RUN_BARS = 3;
/** Two families of calls: about the move that is on (only where there is one), and about how much movement is coming (always). */
const SETS = [
  { id: "run", kinds: ["turn", "go"] },
  { id: "all", kinds: ["big", "calm"] },
];
const targetsOf = (set) => AHEAD.flatMap((h) => set.kinds.map((k) => `${k}${h}`));
const tIndex = (set, kind, h) => AHEAD.indexOf(h) * set.kinds.length + set.kinds.indexOf(kind);
const setOf = (id) => SETS.find((s) => s.id === id);

const MODEL_VERSION = 1; // tied to the list of inputs below and to the forecaster's own (H.MODEL_VERSION)
const LAMBDA = 4e-3;
const MIN_ROWS = 15000;
const NB = 25; // calibration bins over the raw score, 0 … 1
const CAL_PRIOR = 25; // a bin is pulled to the usual rate until it holds many more examples than this
const MIN_CAL = 1500;
const MIN_PROOF = 5000; // unseen examples before a call may be called proven
const MIN_SKILL = 0.004; // …and it must miss at least 0.4% less (Brier) than "always say the usual rate"
const DECAY_DAY = H.DECAY_DAY;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const fx = (name) => H.FEATURES.indexOf(name);

/* ============================================================================ the inputs */

/** The forecaster's inputs that have a direction: each is turned to face the move (multiplied by its direction). */
const SIGNED = ["r1", "r3", "r6", "r12", "fromOpen", "gap", "vwap", "pos", "rsi", "volDir", "m3", "m6", "prevDay", "trend", "clv", "clv3", "wick", "z20", "orb", "r1sq", "rsiX", "orb5", "noise", "mom30", "tod1", "tod3", "rs", "ema", "er", "pivot", "pdx", "cpr", "gapGo", "vwSide", "sqz"];
/** Those that have none: taken as they are. */
const PLAIN = ["vol", "vnow", "tOpen", "tClose"];
/** Their own: room to the day's extreme ahead of the move and behind it, and the shape of the move itself. */
const OWN = ["roomAhead", "roomBehind", "absR1", "absVwap", "absZ", "lunch", "runLen", "decel", "stretchX", "nearX", "effort", "quiet", "wide", "absM3"];
const FEATURES = ["bias", ...SIGNED.map((f) => `a_${f}`), ...PLAIN, ...OWN];
const D = FEATURES.length;
const IX = Object.fromEntries(FEATURES.map((f, i) => [f, i]));
const SRC = { signed: SIGNED.map(fx), plain: PLAIN.map(fx), r1: fx("r1"), r3: fx("r3"), fromOpen: fx("fromOpen"), vwap: fx("vwap"), z20: fx("z20"), vol: fx("vol"), vnow: fx("vnow"), m3: fx("m3"), dHigh: fx("dHigh"), dLow: fx("dLow") };

/** Which way the price has just been going: the last 15 minutes; failing that the last bar, then the day. */
function dirOf(x) {
  return Math.sign(x[SRC.r3]) || Math.sign(x[SRC.r1]) || Math.sign(x[SRC.fromOpen]) || 1;
}

/** Is a move on? The last 15 minutes covered at least RUN_MIN of a usual 15-minute move. */
function hasRun(x) {
  return Math.abs(x[SRC.r3]) >= RUN_MIN * Math.sqrt(RUN_BARS);
}

/**
 * One finished bar as the early calls see it. @param x the forecaster's inputs for the bar (H.dayRows) @param d its
 * direction (+1 / −1) @param run how many bars in a row have closed that way (0 when the last one did not)
 */
function inputsOf(x, d, run) {
  const z = new Float64Array(D);
  let k = 0;
  z[k++] = 1;
  for (const i of SRC.signed) z[k++] = d * x[i];
  for (const i of SRC.plain) z[k++] = x[i];
  const ahead = d > 0 ? x[SRC.dHigh] : x[SRC.dLow];
  const behind = d > 0 ? x[SRC.dLow] : x[SRC.dHigh];
  z[k++] = ahead;
  z[k++] = behind;
  z[k++] = Math.abs(x[SRC.r1]);
  z[k++] = Math.abs(x[SRC.vwap]);
  z[k++] = Math.abs(x[SRC.z20]);
  z[k++] = 0; // lunch: filled by the caller, who knows the time
  z[k++] = Math.min(run, 6) / 6;
  z[k++] = clip(d * (x[SRC.r1] - x[SRC.r3] / 3), 4); // the last bar against the pace of the last three: + faster, − slowing
  z[k++] = Math.max(0, d * x[SRC.z20] - 1.5); // stretched beyond 1½ deviations of its 20-bar mean, the move's way
  z[k++] = Math.max(0, 1 - ahead); // the day's extreme is just ahead (within a usual hour's move)
  z[k++] = clip(Math.max(0, x[SRC.vol]) * Math.abs(x[SRC.r1]), 6); // a big bar on heavy volume
  z[k++] = Math.max(0, -x[SRC.vnow]);
  z[k++] = Math.max(0, x[SRC.vnow]);
  z[k++] = Math.abs(x[SRC.m3]);
  return z;
}

/**
 * A session's rows (from H.dayRows, every bar, in order) as the early calls see them, with — when asked — what happened
 * next. A row whose outcome the session does not hold is left out when `labels` is on.
 * @returns [{ s, t, price, sigma, d, run, z, y: { run: Float64Array|null, all: Float64Array } | null }]
 */
function aheadRows(rows, { labels = true } = {}) {
  const out = [];
  const n = rows.length;
  let streak = 0;
  let streakDir = 0;
  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    const x = row.x;
    const s1 = Math.sign(x[SRC.r1]);
    const joined = i > 0 && rows[i - 1].s === row.s - 1;
    if (s1 !== 0 && s1 === streakDir && joined) streak += 1;
    else {
      streakDir = s1;
      streak = s1 === 0 ? 0 : 1;
    }
    const d = dirOf(x);
    const run = hasRun(x);
    let y = null;
    if (labels) {
      const yr = run ? new Float64Array(AHEAD.length * 2) : null;
      const ya = new Float64Array(AHEAD.length * 2);
      let ok = true;
      for (let a = 0; a < AHEAD.length; a += 1) {
        const h = AHEAD[a];
        const j = i + h;
        if (j >= n || rows[j].s - row.s !== h) {
          ok = false;
          break;
        }
        const ret = (rows[j].price - row.price) / row.price / row.sigma / Math.sqrt(h); // in usual moves for that time
        if (yr) {
          yr[a * 2] = d * ret <= -TURN_MIN ? 1 : 0;
          yr[a * 2 + 1] = d * ret >= GO_MIN ? 1 : 0;
        }
        ya[a * 2] = Math.abs(ret) >= BIG_MIN ? 1 : 0;
        ya[a * 2 + 1] = Math.abs(ret) <= CALM_MAX ? 1 : 0;
      }
      if (!ok) continue;
      y = { run: yr, all: ya };
    }
    const z = inputsOf(x, d, streakDir === d ? streak : 0);
    z[IX.lunch] = row.s >= 33 && row.s < 51 ? 1 : 0; // 12:00 to 1:30 PM
    out.push({ s: row.s, t: row.t, price: row.price, sigma: row.sigma, d, run, streak: streakDir === d ? streak : 0, r3: x[SRC.r3], z, y });
  }
  return out;
}

/* ============================================================================ sums that add, and the fit */

class Sums {
  constructor(T) {
    this.T = T;
    this.w = 0;
    this.n = 0;
    this.xtx = new Float64Array(D * D);
    this.xty = new Float64Array(T * D);
  }

  add(z, y, w = 1) {
    this.n += 1;
    this.w += w;
    const xtx = this.xtx;
    for (let a = 0; a < D; a += 1) {
      const za = z[a] * w;
      if (za === 0) continue;
      const base = a * D;
      for (let b = a; b < D; b += 1) xtx[base + b] += za * z[b];
    }
    for (let k = 0; k < this.T; k += 1) {
      if (!y[k]) continue; // outcomes are 0 or 1
      const base = k * D;
      for (let a = 0; a < D; a += 1) this.xty[base + a] += w * z[a];
    }
  }

  scale(f) {
    this.w *= f;
    for (let i = 0; i < this.xtx.length; i += 1) this.xtx[i] *= f;
    for (let i = 0; i < this.xty.length; i += 1) this.xty[i] *= f;
  }

  merge(o) {
    this.w += o.w;
    this.n += o.n;
    for (let i = 0; i < this.xtx.length; i += 1) this.xtx[i] += o.xtx[i];
    for (let i = 0; i < this.xty.length; i += 1) this.xty[i] += o.xty[i];
    return this;
  }

  /** How often each outcome happened, over everything added (the "usual rate"). */
  base() {
    return Array.from({ length: this.T }, (_, k) => (this.w > 0 ? this.xty[k * D] / this.w : 0));
  }

  toJSON() {
    const rnd = (a) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5);
    return { T: this.T, w: this.w, n: this.n, xtx: rnd(this.xtx), xty: rnd(this.xty) };
  }

  static from(o, T) {
    const s = new Sums(T);
    if (!o || o.T !== T || !Array.isArray(o.xtx) || o.xtx.length !== D * D || !Array.isArray(o.xty) || o.xty.length !== T * D) return s;
    s.w = o.w;
    s.n = o.n;
    s.xtx.set(o.xtx);
    s.xty.set(o.xty);
    return s;
  }
}

/** The weights of every outcome from the sums: T arrays of D numbers, or null when there are too few rows. */
function fit(sums, lambda = LAMBDA, minRows = MIN_ROWS) {
  if (!sums || sums.n < minRows) return null;
  const A = new Float64Array(D * D);
  for (let a = 0; a < D; a += 1) for (let b = a; b < D; b += 1) A[a * D + b] = A[b * D + a] = sums.xtx[a * D + b];
  for (let a = 1; a < D; a += 1) A[a * D + a] += lambda * sums.w; // the intercept is not shrunk
  const W = [];
  for (let k = 0; k < sums.T; k += 1) {
    const w = H.solve(A, sums.xty.subarray(k * D, (k + 1) * D), D);
    if (!w) return null;
    W.push(Array.from(w, (v) => Math.round(v * 1e6) / 1e6));
  }
  return W;
}

const rawOf = (w, z) => {
  let s = 0;
  for (let a = 0; a < D; a += 1) s += w[a] * z[a];
  return s;
};
const binOf = (raw) => Math.max(0, Math.min(NB - 1, Math.floor(raw * NB)));

/* ============================================================================ calibration: the score against what happened */

const emptyCal = (T) => ({ n: Array.from({ length: T }, () => new Array(NB).fill(0)), hit: Array.from({ length: T }, () => new Array(NB).fill(0)) });

/** Add unseen rows to the calibration counts. @param W the weights as they stood when the rows were unseen */
function calAdd(cal, W, items, pick, w = 1) {
  for (const it of items) {
    const y = pick(it);
    if (!y) continue;
    for (let k = 0; k < W.length; k += 1) {
      const b = binOf(rawOf(W[k], it.z));
      cal.n[k][b] += w;
      if (y[k]) cal.hit[k][b] += w;
    }
  }
  return cal;
}

function calScale(cal, f) {
  for (const row of cal.n) for (let b = 0; b < NB; b += 1) row[b] *= f;
  for (const row of cal.hit) for (let b = 0; b < NB; b += 1) row[b] *= f;
  return cal;
}

/**
 * The measured frequency for each score bin: the bin's own rate, pulled to the usual rate while it holds few examples,
 * and pooled with its neighbours wherever a higher score had happened LESS often (so the curve never falls as the score
 * rises). A bin nothing has landed in takes the value of the nearest one below it.
 * @returns Float64Array(NB), or null when too little has been counted
 */
function calCurve(n, hit, base) {
  let total = 0;
  for (let b = 0; b < NB; b += 1) total += n[b];
  if (total < MIN_CAL) return null;
  const blocks = [];
  for (let b = 0; b < NB; b += 1) {
    if (n[b] <= 0) continue;
    blocks.push({ w: n[b] + CAL_PRIOR, v: (hit[b] + base * CAL_PRIOR) / (n[b] + CAL_PRIOR), from: b });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const hi = blocks.pop();
      const lo = blocks[blocks.length - 1];
      lo.v = (lo.v * lo.w + hi.v * hi.w) / (lo.w + hi.w);
      lo.w += hi.w;
    }
  }
  if (!blocks.length) return null;
  const out = new Float64Array(NB);
  let bi = 0;
  for (let b = 0; b < NB; b += 1) {
    while (bi + 1 < blocks.length && blocks[bi + 1].from <= b) bi += 1;
    out[b] = blocks[bi].v;
  }
  return out;
}

/** The probability shown for a raw score: the measured frequency of its bin; without enough counts, the score itself, kept modest. */
function probOf(raw, curve, base) {
  if (curve) return curve[binOf(raw)];
  return Math.max(0.03, Math.min(0.9, 0.5 * Math.max(0, Math.min(1, raw)) + 0.5 * base));
}

/* ============================================================================ what a probability is called */

/**
 * likely   more likely than not (50% or more)
 * raised   clearly more likely than usual (a quarter more, and at least 5 points)
 * low      clearly less likely than usual
 * usual    neither
 */
function tierOf(p, base) {
  if (!num(p) || !num(base)) return "usual";
  if (p >= 0.5) return "likely";
  if (p >= Math.max(base * 1.25, base + 0.05)) return "raised";
  if (p <= Math.min(base * 0.75, base - 0.05)) return "low";
  return "usual";
}

/* ============================================================================ the evidence: unseen rows, scored */

const emptyEv = (T) => ({ n: new Array(T).fill(0), y: new Array(T).fill(0), se: new Array(T).fill(0), se0: new Array(T).fill(0), saidN: new Array(T).fill(0), saidY: new Array(T).fill(0), lowN: new Array(T).fill(0), lowY: new Array(T).fill(0) });

/**
 * Score unseen rows with the model as it stood. For each outcome: how often it happened, the squared miss of the
 * probability shown and of "always the usual rate", and what followed the times it was called (raised or likely) and the
 * times it was called unlikely.
 * @param model { W, base, curves }
 */
function evAdd(ev, model, items, pick) {
  const { W, base, curves } = model;
  for (const it of items) {
    const y = pick(it);
    if (!y) continue;
    for (let k = 0; k < W.length; k += 1) {
      const p = probOf(rawOf(W[k], it.z), curves ? curves[k] : null, base[k]);
      const yk = y[k] ? 1 : 0;
      ev.n[k] += 1;
      ev.y[k] += yk;
      ev.se[k] += (p - yk) ** 2;
      ev.se0[k] += (base[k] - yk) ** 2;
      const tier = tierOf(p, base[k]);
      if (tier === "likely" || tier === "raised") {
        ev.saidN[k] += 1;
        ev.saidY[k] += yk;
      } else if (tier === "low") {
        ev.lowN[k] += 1;
        ev.lowY[k] += yk;
      }
    }
  }
  return ev;
}

function evScale(ev, f) {
  for (const key of Object.keys(ev)) for (let k = 0; k < ev[key].length; k += 1) ev[key][k] *= f;
  return ev;
}

function evMerge(a, b) {
  for (const key of Object.keys(a)) for (let k = 0; k < a[key].length; k += 1) a[key][k] += b[key][k] || 0;
  return a;
}

/** Proven: enough unseen examples, and a smaller miss than "always the usual rate". */
function provenOf(ev, k) {
  return ev.n[k] >= MIN_PROOF && ev.se0[k] > 0 && 1 - ev.se[k] / ev.se0[k] >= MIN_SKILL;
}

/** The evidence in words-ready numbers, one entry per outcome of a family. */
function summarise(set, ev) {
  return targetsOf(set).map((name, k) => {
    const h = AHEAD[Math.floor(k / set.kinds.length)];
    const kind = set.kinds[k % set.kinds.length];
    const n = ev.n[k];
    return {
      target: name,
      kind,
      h,
      minutes: h * 5,
      n: Math.round(n),
      usual: n ? r4(ev.y[k] / n) : null,
      skill: ev.se0[k] > 0 ? r4(1 - ev.se[k] / ev.se0[k]) : null,
      said: Math.round(ev.saidN[k]),
      saidRate: ev.saidN[k] >= 1 ? r4(ev.saidY[k] / ev.saidN[k]) : null,
      low: Math.round(ev.lowN[k]),
      lowRate: ev.lowN[k] >= 1 ? r4(ev.lowY[k] / ev.lowN[k]) : null,
      proven: provenOf(ev, k),
    };
  });
}

/* ============================================================================ why: which inputs pushed a call */

/** Each input in words: [when it is positive, when it is negative]. "The move" is the way the price has just been going. */
const WHY = {
  a_r1: ["the last 5 minutes went with the move", "the last 5 minutes went against the move"],
  a_r3: ["the last 15 minutes moved a long way", ""],
  a_r6: ["the last half hour goes the same way", "the last half hour went the other way"],
  a_r12: ["the last hour goes the same way", "the last hour went the other way"],
  a_fromOpen: ["the day is going the same way", "the day has gone the other way"],
  a_gap: ["the gap was the same way", "the gap was the other way"],
  a_vwap: ["the price is stretched from VWAP the move's way", "the price is still on the other side of VWAP"],
  a_pos: ["the price is at the move's end of the day's range", "the price is at the far end of the day's range"],
  a_rsi: ["RSI has gone with the move", "RSI has not followed the move"],
  a_rsiX: ["RSI is at an extreme the move's way", "RSI is at the opposite extreme"],
  a_volDir: ["heavy volume is behind the move", "heavy volume came against the move"],
  a_m3: ["the market is moving the same way", "the market is moving the other way"],
  a_m6: ["the market has gone the same way for half an hour", "the market has gone the other way for half an hour"],
  a_clv: ["the last bar closed at the move's end of its range", "the last bar closed against the move"],
  a_clv3: ["the last three bars closed the move's way", "the last three bars closed against the move"],
  a_wick: ["the last bar was rejected at the move's end", "the last bar was pushed back from the other end"],
  a_z20: ["the price is stretched from its 20-bar mean", "the price is on the other side of its 20-bar mean"],
  a_orb: ["the price is beyond the opening range the move's way", "the price is on the other side of the opening range"],
  a_ema: ["EMA 9 is on the move's side of EMA 21", "EMA 9 is still against the move"],
  a_er: ["the last hour went in a straight line", "the last hour went the other way in a straight line"],
  a_rs: ["it is moving more than the market explains", "it is lagging the market"],
  a_vwSide: ["the last closes held the move's side of VWAP", "the last closes held the other side of VWAP"],
  a_pdx: ["it is beyond yesterday's range the move's way", "it is beyond yesterday's range the other way"],
  a_noise: ["it is outside its usual range for this time of day", "it is outside its usual range the other way"],
  vol: ["volume is heavier than usual", "volume is lighter than usual"],
  vnow: ["recent bars are wider than usual", "recent bars are narrower than usual"],
  tOpen: ["it is the opening rush", "it is the opening rush"],
  tClose: ["it is the closing rush", "it is the closing rush"],
  lunch: ["it is the midday lull", "it is the midday lull"],
  roomAhead: ["the day's extreme ahead is some way off", ""],
  nearX: ["the price is at the day's extreme", ""],
  absR1: ["the last bar was a big one", ""],
  absVwap: ["the price is far from VWAP", ""],
  absZ: ["the price is far from its 20-bar mean", ""],
  runLen: ["several bars in a row went the same way", ""],
  decel: ["the last bar was faster than the ones before", "the move is slowing"],
  stretchX: ["the move is stretched past 1½ deviations", ""],
  effort: ["a big bar on heavy volume", ""],
  quiet: ["the last bars were unusually quiet", ""],
  wide: ["the last bars were unusually wide", ""],
  absM3: ["the market itself is moving", ""],
};

/** The inputs that moved a call most, in words: `side` "for" raised it, "against" lowered it. */
function whyOf(w, z, limit = 3) {
  const out = [];
  for (let a = 1; a < D; a += 1) {
    const c = w[a] * z[a];
    if (!num(c) || Math.abs(c) < 0.008) continue;
    const words = WHY[FEATURES[a]];
    if (!words) continue;
    const text = z[a] > 0 ? words[0] : words[1];
    if (!text) continue;
    out.push({ key: FEATURES[a], push: r4(c), side: c > 0 ? "for" : "against", text });
  }
  return out.sort((x, y) => Math.abs(y.push) - Math.abs(x.push)).slice(0, limit);
}

/* ============================================================================ a kept call, settled */

/**
 * What happened after a kept call. @param rec { anchorEnd, price, sigma (a fraction), d } @param rawBars the session's bars
 * @returns { [h]: { price, pct, ret (in usual moves for that time), turn, go, big, calm } } for the horizons whose bar exists
 */
function settle(rec, rawBars) {
  const bars = H.cleanBars(rawBars);
  const out = {};
  for (const h of AHEAD) {
    const start = rec.anchorEnd - BAR + h * BAR; // the bar that ends h bars after the call
    const b = bars.find((x) => x.t === start);
    if (!b) continue;
    const ret = (b.c - rec.price) / rec.price / rec.sigma / Math.sqrt(h);
    out[h] = { price: b.c, pct: r4(((b.c - rec.price) / rec.price) * 100), ret: r4(ret), turn: rec.d * ret <= -TURN_MIN, go: rec.d * ret >= GO_MIN, big: Math.abs(ret) >= BIG_MIN, calm: Math.abs(ret) <= CALM_MAX };
  }
  return out;
}

module.exports = {
  BAR, AHEAD, SETS, FEATURES, D, IX, NB, MODEL_VERSION, LAMBDA, MIN_ROWS, MIN_CAL, MIN_PROOF, MIN_SKILL, DECAY_DAY, TURN_MIN, GO_MIN, BIG_MIN, CALM_MAX, RUN_MIN,
  targetsOf, tIndex, setOf, dirOf, hasRun, inputsOf, aheadRows,
  Sums, fit, rawOf, binOf,
  emptyCal, calAdd, calScale, calCurve, probOf, tierOf,
  emptyEv, evAdd, evScale, evMerge, provenOf, summarise,
  whyOf, settle,
};
