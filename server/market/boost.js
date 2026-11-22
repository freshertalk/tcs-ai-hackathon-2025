"use strict";
// Gradient-boosted decision trees (22 Nov 2026): the forecaster's NONLINEAR stage. Every other model on the desk is linear
// (ridge regression): it can say "a stretch from VWAP pulls the price back", but not "…only in the first hour, and only when
// volume is drying up". Trees can. They are the method that wins most tabular forecasting contests (Friedman, "Greedy
// function approximation: a gradient boosting machine", Annals of Statistics 2001; Chen & Guestrin, XGBoost 2016; Ke et al.,
// LightGBM 2017 — the histogram method used here), and the strongest machine-learning results on stock returns use them
// (Gu, Kelly & Xiu, "Empirical asset pricing via machine learning", RFS 2020).
//
//   WHAT     a RESIDUAL booster: the trees learn what the ridge forecaster still MISSES (y − ŷ) for each target (the move
//            at 5, 10, 15, 20, 30 minutes and how far the high and low reach), from the same inputs plus the time of day and
//            the volatility regime. So with no trees the forecaster is unchanged, and the trees only add.
//   HOW      LightGBM-style: each input cut into at most 32 bins by its quantiles; a tree of depth 3 grown greedily on the
//            histogram of the misses (squared loss, L2-shrunk leaves, at least MIN_LEAF rows per leaf); each tree sees half
//            the rows and ~70% of the inputs (stochastic boosting, Friedman 2002); a small learning rate (0.05).
//   HONEST   the number of trees for each target is chosen on unseen sessions (early stopping on the "choosing" half); the
//            trees are switched on for a target only if they cut the miss there by MIN_GAIN, and the cut is confirmed on the
//            other half, which chose nothing. The numbers shown come from that second half.
//
// Pure arithmetic: no clock, no network, no records. Deterministic (seeded).

const N_BINS = 32;
const DEPTH = 3;
const NODES = 2 ** (DEPTH + 1) - 1; // a complete tree of depth 3: 7 splits, 8 leaves (stored in one array, children 2i+1, 2i+2)
const MIN_LEAF = 150;
const L2 = 20;
const LR = 0.05;
const MAX_TREES = 150;
const ROW_FRAC = 0.5;
const COL_FRAC = 0.7;
const CLIP = 3; // a miss beyond 3 usual moves is clipped: the trees are not taught by a handful of shocks
const MIN_GAIN = 0.01;
const SAMPLE = 30000; // training rows kept for the trees (memory: the VPS process is capped)

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r4 = (x) => Math.round(x * 10000) / 10000;

/** A small seeded generator (Park–Miller), so a training run is the same every time. */
function rng(seed = 12345) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The inputs a tree sees for a row: the forecaster's inputs (without the constant), the time of day and the regime. */
function featuresOf(row) {
  const x = row.x;
  const out = new Float64Array(x.length + 1);
  for (let i = 1; i < x.length; i += 1) out[i - 1] = num(x[i]) ? x[i] : 0;
  out[x.length - 1] = num(row.s) ? row.s : 0;
  out[x.length] = num(row.bucket) ? row.bucket : 0;
  return out;
}

/** Reservoir sampling: keeps a fair sample of at most `cap` items from a stream (Vitter 1985). */
class Reservoir {
  constructor(cap = SAMPLE, seed = 7) {
    this.cap = cap;
    this.items = [];
    this.seen = 0;
    this.rand = rng(seed);
  }
  add(item) {
    this.seen += 1;
    if (this.items.length < this.cap) this.items.push(item);
    else {
      const j = Math.floor(this.rand() * this.seen);
      if (j < this.cap) this.items[j] = item;
    }
  }
}

/** Bin edges per input, from the quantiles of a sample of rows. */
function edgesOf(F, n, f, nBins = N_BINS) {
  const edges = [];
  for (let j = 0; j < f; j += 1) {
    const step = Math.max(1, Math.floor(n / 4000));
    const vals = [];
    for (let i = 0; i < n; i += step) vals.push(F[i * f + j]);
    vals.sort((a, b) => a - b);
    const e = [];
    for (let b = 1; b < nBins; b += 1) {
      const v = vals[Math.floor((b / nBins) * vals.length)];
      if (num(v) && (!e.length || v > e[e.length - 1])) e.push(v);
    }
    edges.push(e);
  }
  return edges;
}
/** The bin of a value: the number of edges it is above. */
function binOf(e, v) {
  let lo = 0;
  let hi = e.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v > e[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One tree's prediction for an input vector. */
function treeAt(t, x) {
  let i = 0;
  for (let d = 0; d < DEPTH; d += 1) {
    const f = t.f[i];
    if (f < 0) break;
    i = x[f] <= t.t[i] ? 2 * i + 1 : 2 * i + 2;
  }
  return t.v[i];
}

/** The same, for a row stored at offset `o` of a flat array (no copy). */
function treeAtFlat(t, F, o) {
  let i = 0;
  for (let d = 0; d < DEPTH; d += 1) {
    const f = t.f[i];
    if (f < 0) break;
    i = F[o + f] <= t.t[i] ? 2 * i + 1 : 2 * i + 2;
  }
  return t.v[i];
}

/**
 * Grow one tree on the misses `g` of the rows `idx` (squared loss: the best leaf value is the shrunk mean of its misses).
 * Bins: `Bn` (n×f, Uint8). Returns { f, t, v } with real-valued thresholds (so a live row needs no binning).
 */
function growTree(Bn, f, edges, g, idx, cols) {
  const tree = { f: new Array(NODES).fill(-1), t: new Array(NODES).fill(0), v: new Array(NODES).fill(0) };
  const nodes = [{ i: 0, rows: idx, depth: 0 }];
  const sumG = new Float64Array(N_BINS + 1);
  const cnt = new Float64Array(N_BINS + 1);
  while (nodes.length) {
    const node = nodes.shift();
    let G = 0;
    for (const r of node.rows) G += g[r];
    const n = node.rows.length;
    tree.v[node.i] = r4((LR * G) / (n + L2));
    if (node.depth >= DEPTH || n < 2 * MIN_LEAF) continue;
    const parent = (G * G) / (n + L2);
    let best = { gain: 1e-9, f: -1, b: -1 };
    for (const j of cols) {
      const nb = edges[j].length + 1;
      if (nb < 2) continue;
      sumG.fill(0, 0, nb);
      cnt.fill(0, 0, nb);
      for (const r of node.rows) {
        const b = Bn[r * f + j];
        sumG[b] += g[r];
        cnt[b] += 1;
      }
      let gl = 0;
      let nl = 0;
      for (let b = 0; b < nb - 1; b += 1) {
        gl += sumG[b];
        nl += cnt[b];
        const nr = n - nl;
        if (nl < MIN_LEAF) continue;
        if (nr < MIN_LEAF) break;
        const gr = G - gl;
        const gain = (gl * gl) / (nl + L2) + (gr * gr) / (nr + L2) - parent;
        if (gain > best.gain) best = { gain, f: j, b };
      }
    }
    if (best.f < 0) continue;
    tree.f[node.i] = best.f;
    tree.t[node.i] = edges[best.f][best.b];
    const left = [];
    const right = [];
    for (const r of node.rows) (Bn[r * f + best.f] <= best.b ? left : right).push(r);
    nodes.push({ i: 2 * node.i + 1, rows: left, depth: node.depth + 1 }, { i: 2 * node.i + 2, rows: right, depth: node.depth + 1 });
  }
  return tree;
}

/**
 * Train the residual booster.
 * @param trainRows rows the ridge forecaster was fitted on (a sample): { x, y, s, bucket, sym }
 * @param pickRows  unseen rows that CHOOSE (how many trees, which targets)
 * @param judgeRows unseen rows that only MEASURE
 * @param predict   (row) → the forecaster's prediction for every target (σ units), as it is used
 * @param targets   how many targets
 * @param pause     an async pause between trees (so the server stays responsive)
 * @returns { on, trees, record, features, trainedRows }
 */
async function trainBooster({ trainRows, pickRows, judgeRows, predict, targets, pause = async () => {}, maxTrees = MAX_TREES, seed = 2026 }) {
  const n = trainRows.length;
  if (n < 4 * MIN_LEAF || !pickRows.length || !judgeRows.length) return { on: new Array(targets).fill(false), trees: new Array(targets).fill([]), record: null, trainedRows: n, reason: "too few rows" };
  const f = featuresOf(trainRows[0]).length;
  const F = new Float64Array(n * f);
  trainRows.forEach((row, i) => F.set(featuresOf(row), i * f));
  const edges = edgesOf(F, n, f);
  const Bn = new Uint8Array(n * f);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < f; j += 1) Bn[i * f + j] = binOf(edges[j], F[i * f + j]);
  const feats = (rows) => rows.map((row) => featuresOf(row));
  const Fp = feats(pickRows);
  const Fj = feats(judgeRows);
  const base = (rows) => rows.map((row) => predict(row));
  const Pt = base(trainRows);
  const Pp = base(pickRows);
  const Pj = base(judgeRows);
  const rand = rng(seed);
  const trees = [];
  const on = [];
  const record = [];
  for (let k = 0; k < targets; k += 1) {
    // the misses the trees learn from, clipped
    const res = new Float64Array(n);
    for (let i = 0; i < n; i += 1) res[i] = Math.max(-CLIP, Math.min(CLIP, trainRows[i].y[k] - Pt[i][k]));
    const g = Float64Array.from(res);
    const addP = new Float64Array(pickRows.length);
    let se0 = 0;
    pickRows.forEach((row, i) => {
      se0 += (row.y[k] - Pp[i][k]) ** 2;
    });
    let bestSe = se0;
    let bestN = 0;
    const list = [];
    for (let t = 0; t < maxTrees; t += 1) {
      const idx = [];
      for (let i = 0; i < n; i += 1) if (rand() < ROW_FRAC) idx.push(i);
      const cols = [];
      for (let j = 0; j < f; j += 1) if (rand() < COL_FRAC) cols.push(j);
      const tree = growTree(Bn, f, edges, g, idx, cols);
      list.push(tree);
      for (let i = 0; i < n; i += 1) g[i] -= treeAtFlat(tree, F, i * f);
      let se = 0;
      for (let i = 0; i < pickRows.length; i += 1) {
        addP[i] += treeAt(tree, Fp[i]);
        se += (pickRows[i].y[k] - Pp[i][k] - addP[i]) ** 2;
      }
      if (se < bestSe) {
        bestSe = se;
        bestN = t + 1;
      }
      if (t - bestN >= 30) break; // early stopping: thirty trees without a better choosing-half score
      await pause();
    }
    const kept = list.slice(0, bestN);
    // the measure: on the half that chose nothing
    let sj0 = 0;
    let sj1 = 0;
    judgeRows.forEach((row, i) => {
      const e0 = row.y[k] - Pj[i][k];
      let add = 0;
      for (const tr of kept) add += treeAt(tr, Fj[i]);
      sj0 += e0 * e0;
      sj1 += (e0 - add) ** 2;
    });
    const gainPick = se0 > 0 ? (se0 - bestSe) / se0 : 0;
    const gainJudge = sj0 > 0 ? (sj0 - sj1) / sj0 : 0;
    const use = kept.length > 0 && gainPick >= MIN_GAIN && gainJudge > 0;
    on.push(use);
    trees.push(use ? kept : []);
    record.push({ trees: kept.length, gainPick: r4(gainPick), gainJudge: r4(gainJudge), judged: judgeRows.length, on: use });
  }
  return { on, trees, record, trainedRows: n, features: f };
}

/** Add the booster's correction to a prediction (σ units), for the targets where it is switched on. Mutates `p`. */
function addTo(p, boost, row) {
  if (!boost || !Array.isArray(boost.trees) || !boost.on || !boost.on.some(Boolean)) return p;
  const x = featuresOf(row);
  if (boost.features && x.length !== boost.features) return p; // trained on another list of inputs
  for (let k = 0; k < p.length && k < boost.trees.length; k += 1) {
    if (!boost.on[k]) continue;
    let add = 0;
    for (const t of boost.trees[k]) add += treeAt(t, x);
    p[k] += add;
  }
  return p;
}

/** The booster, for the screen: in use for which targets, and by how much it cut the miss on sessions it had not seen. */
function summaryOf(boost, names) {
  if (!boost || !boost.record) return null;
  return {
    trainedAt: boost.trainedAt || null,
    rows: boost.trainedRows,
    targets: boost.record.map((r, k) => ({ target: names ? names[k] : k, on: r.on, trees: r.trees, cutPct: r4(r.gainJudge * 100) })),
    inUse: boost.on.filter(Boolean).length,
  };
}

module.exports = { N_BINS, DEPTH, NODES, MIN_LEAF, LR, MAX_TREES, SAMPLE, MIN_GAIN, rng, featuresOf, Reservoir, edgesOf, binOf, treeAt, growTree, trainBooster, addTo, summaryOf };
