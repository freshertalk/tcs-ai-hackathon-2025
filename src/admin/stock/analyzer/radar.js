// A quick, live read of how a stock is behaving today against the index — worked out
// in the browser from the streamed quote, for every stock on the watchlist at once.
// It ranks where to look for a long or a short; the full call for a stock is still
// the desk verdict.

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const unit = (x) => Math.max(-1, Math.min(1, x));

/**
 * @param q      the stock's quote: { last, open, high, low, avgPrice }
 * @param nifty  the Nifty's quote: { last, open } — optional
 * @returns { score: −100…+100, relPct, vsVwapPct, posPct } or null before the stock has opened
 *   40 points: move since the open, minus the Nifty's move since its open
 *   35 points: distance from VWAP (the day's average traded price)
 *   25 points: place in the day's range
 */
export function radarScore(q, nifty) {
  if (!q || !isNum(q.last) || !isNum(q.open) || q.open <= 0 || q.last <= 0) return null;
  const fromOpen = ((q.last - q.open) / q.open) * 100;
  const index = nifty && isNum(nifty.last) && isNum(nifty.open) && nifty.open > 0 ? ((nifty.last - nifty.open) / nifty.open) * 100 : 0;
  const rel = fromOpen - index;
  const vwap = isNum(q.avgPrice) && q.avgPrice > 0 ? ((q.last - q.avgPrice) / q.avgPrice) * 100 : 0;
  const pos = isNum(q.high) && isNum(q.low) && q.high > q.low ? (q.last - q.low) / (q.high - q.low) : 0.5;
  return {
    score: Math.round(unit(rel / 1) * 40 + unit(vwap / 0.4) * 35 + (unit(pos * 2 - 1)) * 25),
    relPct: Math.round(rel * 100) / 100,
    vsVwapPct: Math.round(vwap * 100) / 100,
    posPct: Math.round(pos * 100),
  };
}

/** "strong" (a place to look for longs), "weak" (for shorts), or "" when it is neither. */
export const radarLabel = (r) => (!r ? "" : r.score >= 50 ? "strong" : r.score <= -50 ? "weak" : "");

/** Symbols ordered strongest-first or weakest-first; those without a reading go last. */
export function radarOrder(symbols, scores, order) {
  if (order !== "strong" && order !== "weak") return symbols;
  const val = (s) => (scores[s] ? scores[s].score : null);
  return [...symbols].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return order === "strong" ? y - x : x - y;
  });
}
