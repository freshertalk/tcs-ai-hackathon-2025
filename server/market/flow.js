"use strict";
// Order flow for the stock in focus: what the order book and the stream of trades
// say about the next few seconds.
//
// Three layers, each built on the one before:
//   1. bookStats   arithmetic on the five best bids and offers — spread, imbalance,
//                  the size-weighted "micro price", the average size of a resting bid
//                  or offer, and any single level much larger than the rest.
//   2. trade flow  each burst of volume is signed by where it traded (at the offer
//                  = buyers lifting, at the bid = sellers hitting), and summed over
//                  30 seconds, a minute and five minutes.
//   3. the lean    a small model (online logistic regression) that learns, on this
//                  stock, today, how those readings relate to where the mid price is
//                  thirty seconds later. Every prediction is scored BEFORE the model
//                  learns from that example, so its hit rate is honest — and when the
//                  hit rate is no better than a coin, it says there is no edge.
//
// What this cannot be: certain. Resting quantities can be placed to mislead and
// pulled before they trade, the stream is a few snapshots a second rather than
// every event, and a thirty-second lean is not a trade plan.

const TICK = 0.05;
const IST = 5.5 * 3600 * 1000;
const WEIGHTS = [1, 0.8, 0.6, 0.4, 0.2]; // nearer levels matter more
const FEATURES = 8;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (num(x) ? Math.round(x * 1000) / 1000 : null);
const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const dot = (w, x) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += w[i] * x[i];
  return s;
};
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);

/**
 * The order book in numbers.
 * @param tick  a streamed tick with depth: { b: [[price, quantity, count], …], a: […] } (best first)
 * @returns null when there is no depth at all
 */
function bookStats(tick) {
  const depth = tick && tick.depth;
  const bids = depth && Array.isArray(depth.b) ? depth.b.filter((l) => l[0] > 0) : [];
  const asks = depth && Array.isArray(depth.a) ? depth.a.filter((l) => l[0] > 0) : [];
  if (bids.length === 0 && asks.length === 0) return null;

  const sum = (rows, k) => rows.reduce((s, l) => s + (l[k] || 0), 0);
  const weighted = (rows) => rows.reduce((s, l, i) => s + (l[1] || 0) * (WEIGHTS[i] || 0.2), 0);
  const bidQty = sum(bids, 1);
  const askQty = sum(asks, 1);
  const wb = weighted(bids);
  const wa = weighted(asks);
  const bid = bids.length ? bids[0][0] : null;
  const ask = asks.length ? asks[0][0] : null;
  const both = num(bid) && num(ask);
  const spread = both ? Math.max(0, ask - bid) : null;
  const mid = both ? (bid + ask) / 2 : num(bid) ? bid : ask;

  // the micro price leans toward the side with LESS quantity at the touch: that side gives way first
  let microEdge = 0;
  let micro = mid;
  if (both) {
    const q = bids[0][1] + asks[0][1];
    if (q > 0) {
      micro = (bid * asks[0][1] + ask * bids[0][1]) / q;
      microEdge = spread > 0 ? clamp((micro - mid) / (spread / 2), -1, 1) : 0;
    }
  } else microEdge = num(bid) ? 1 : -1; // one side is empty: nothing stands in the way on that side

  const total = (a, b) => (a + b > 0 ? (a - b) / (a + b) : 0);
  const buyTotal = num(tick.buyQty) ? tick.buyQty : null;
  const sellTotal = num(tick.sellQty) ? tick.sellQty : null;
  const bidCount = sum(bids, 2);
  const askCount = sum(asks, 2);
  const avgBid = bidCount > 0 ? bidQty / bidCount : null;
  const avgAsk = askCount > 0 ? askQty / askCount : null;

  // one level far bigger than the others on its side
  let wall = null;
  for (const [side, rows] of [["bid", bids], ["ask", asks]]) {
    if (rows.length < 3) continue;
    const big = rows.reduce((m, l) => (l[1] > m[1] ? l : m), rows[0]);
    const rest = (sum(rows, 1) - big[1]) / (rows.length - 1);
    if (rest > 0 && big[1] >= 3 * rest && (!wall || big[1] > wall.qty)) wall = { side, price: big[0], qty: big[1], times: Math.round((big[1] / rest) * 10) / 10 };
  }

  return {
    bid,
    ask,
    spread,
    spreadTicks: both ? Math.round(spread / TICK) : null,
    spreadPct: both && mid > 0 ? (spread / mid) * 100 : null,
    mid,
    micro,
    microEdge,
    bidQty,
    askQty,
    imbalance: total(wb, wa), // −1 … +1, weighted toward the levels nearest the price
    imbalanceTotal: buyTotal !== null && sellTotal !== null ? total(buyTotal, sellTotal) : total(bidQty, askQty),
    buyTotal,
    sellTotal,
    avgBid,
    avgAsk,
    sizeSkew: avgBid !== null && avgAsk !== null ? total(avgBid, avgAsk) : 0,
    wall,
    oneSided: both ? null : num(bid) ? "no sellers" : "no buyers",
  };
}

class FlowEngine {
  /**
   * @param horizonMs  how far ahead the lean looks
   * @param sampleMs   at most one training example per this interval
   * @param minTrain   scored examples needed before a lean is offered
   */
  constructor({ horizonMs = 30000, sampleMs = 1000, minTrain = 60, rate = 0.05 } = {}) {
    this.horizonMs = horizonMs;
    this.sampleMs = sampleMs;
    this.minTrain = minTrain;
    this.rate = rate;
    this.state = new Map();
  }

  reset(token) {
    this.state.delete(token);
  }

  snapshot(token) {
    const st = this.state.get(token);
    return st ? st.snap : null;
  }

  _state(token, now) {
    const day = istDate(now);
    let st = this.state.get(token);
    // a new day is a new tape: yesterday's order flow says nothing about today's
    if (!st || st.day !== day) {
      st = { day, prev: null, sign: 0, trades: [], mids: [], pending: [], w: new Array(FEATURES).fill(0), samples: 0, flat: 0, calls: 0, hits: 0, recent: [], lastSampleAt: 0, snap: null };
      this.state.set(token, st);
    }
    return st;
  }

  /** Feed one tick; returns the new snapshot. */
  update(token, tick, now) {
    const st = this._state(token, now);

    /* ---- trades: sign each burst of volume by where it traded */
    const prev = st.prev;
    if (prev && num(tick.volume) && num(prev.volume) && tick.volume > prev.volume && num(tick.last)) {
      const dv = tick.volume - prev.volume;
      let sign;
      if (num(prev.ask) && tick.last >= prev.ask) sign = 1; // traded at the offer: a buyer crossed the spread
      else if (num(prev.bid) && tick.last <= prev.bid) sign = -1; // traded at the bid: a seller did
      else if (num(prev.last) && tick.last !== prev.last) sign = tick.last > prev.last ? 1 : -1;
      else sign = st.sign; // inside the spread at the same price: same side as the last one
      st.sign = sign;
      st.trades.push([now, sign * dv, dv]);
    }
    st.prev = { last: tick.last, volume: tick.volume, bid: tick.bid, ask: tick.ask };
    while (st.trades.length && now - st.trades[0][0] > 300000) st.trades.shift();
    const windowOf = (ms) => {
      let delta = 0;
      let volume = 0;
      for (const [t, s, q] of st.trades) {
        if (now - t <= ms) {
          delta += s;
          volume += q;
        }
      }
      return { delta, volume, ratio: volume > 0 ? delta / volume : 0 };
    };
    const f30 = windowOf(30000);
    const f60 = windowOf(60000);
    const f300 = windowOf(300000);

    const book = bookStats(tick);
    if (!book || !num(book.mid)) {
      st.snap = { available: false, reason: "No market depth on this tick." };
      return st.snap;
    }

    /* ---- pressure: one number from the book and the trades */
    const pressure = Math.round(100 * clamp(0.35 * book.imbalance + 0.25 * book.microEdge + 0.25 * f60.ratio + 0.15 * book.imbalanceTotal, -1, 1));

    /* ---- the lean */
    // examples whose thirty seconds are up: score each one first, then learn from it
    while (st.pending.length && now - st.pending[0].t >= this.horizonMs) {
      const s = st.pending.shift();
      const move = book.mid - s.mid;
      const need = Math.max(TICK, (s.spread || 0) * 0.5); // a move smaller than this is noise
      const y = move >= need ? 1 : move <= -need ? 0 : null;
      if (y === null) {
        st.flat += 1;
        continue;
      }
      if (s.trained && (s.p >= 0.55 || s.p <= 0.45)) {
        const hit = s.p >= 0.55 === (y === 1);
        st.calls += 1;
        if (hit) st.hits += 1;
        st.recent.push(hit ? 1 : 0);
        if (st.recent.length > 60) st.recent.shift();
      }
      const err = y - sigmoid(dot(st.w, s.x)); // one step of gradient descent, with a little shrinkage
      for (let i = 0; i < FEATURES; i += 1) st.w[i] += this.rate * (err * s.x[i] - 0.0005 * st.w[i]);
      st.samples += 1;
    }
    // …then read the present with everything learned so far (never with its own future)
    st.mids.push([now, book.mid]);
    while (st.mids.length && now - st.mids[0][0] > 60000) st.mids.shift();
    let then = st.mids[0][1];
    for (const [t, m] of st.mids) {
      if (now - t >= 30000) then = m;
      else break;
    }
    const momentum = clamp(((book.mid - then) / book.mid) * 500, -1, 1); // ±0.2% in 30 s saturates
    const x = [1, book.imbalance, book.microEdge, f30.ratio, f60.ratio, book.imbalanceTotal, momentum, book.sizeSkew];
    const p = sigmoid(dot(st.w, x));
    if (now - st.lastSampleAt >= this.sampleMs) {
      st.pending.push({ t: now, mid: book.mid, spread: book.spread, x, p, trained: st.samples >= this.minTrain });
      st.lastSampleAt = now;
      if (st.pending.length > 240) st.pending.shift();
    }

    const trained = st.samples >= this.minTrain;
    const recentRate = st.recent.length >= 20 ? st.recent.reduce((a, b) => a + b, 0) / st.recent.length : null;
    const reliable = trained && recentRate !== null && recentRate >= 0.55;
    const dir = !trained ? "learning" : p >= 0.55 ? "up" : p <= 0.45 ? "down" : "none";

    st.snap = {
      available: true,
      at: now,
      bid: r2(book.bid),
      ask: r2(book.ask),
      spread: r2(book.spread),
      spreadTicks: book.spreadTicks,
      spreadPct: r3(book.spreadPct),
      mid: r2(book.mid),
      micro: r2(book.micro),
      bidQty: book.bidQty,
      askQty: book.askQty,
      buyTotal: book.buyTotal,
      sellTotal: book.sellTotal,
      imbalancePct: Math.round(book.imbalance * 100),
      imbalanceTotalPct: Math.round(book.imbalanceTotal * 100),
      avgBid: book.avgBid === null ? null : Math.round(book.avgBid),
      avgAsk: book.avgAsk === null ? null : Math.round(book.avgAsk),
      wall: book.wall ? { ...book.wall, price: r2(book.wall.price) } : null,
      oneSided: book.oneSided,
      pressure,
      label: pressure >= 30 ? "Buyers pressing" : pressure <= -30 ? "Sellers pressing" : "Balanced",
      delta30: Math.round(f30.delta),
      delta60: Math.round(f60.delta),
      delta300: Math.round(f300.delta),
      volume60: Math.round(f60.volume),
      deltaRatio60Pct: Math.round(f60.ratio * 100),
      lean: {
        dir, // "learning" | "up" | "down" | "none"
        upPct: Math.round(p * 100),
        horizonSec: Math.round(this.horizonMs / 1000),
        trained,
        samples: st.samples,
        needed: this.minTrain,
        calls: st.calls,
        hits: st.hits,
        hitRatePct: st.calls > 0 ? Math.round((st.hits / st.calls) * 100) : null,
        recentRatePct: recentRate === null ? null : Math.round(recentRate * 100),
        reliable,
      },
    };
    return st.snap;
  }
}

module.exports = { FlowEngine, bookStats };
