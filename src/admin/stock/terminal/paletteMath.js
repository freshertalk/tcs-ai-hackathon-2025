// The command palette's thinking, kept apart from its page so it can be tested:
// reading a typed command ("buy sbin 10", "alert infy below 1450") and ranking what matches.

const CMD = /^\s*(buy|sell|b|s)\s+([a-z0-9][a-z0-9&._-]{0,24})(?:\s+(\d{1,7}))?(?:\s*(?:@|at)\s*(\d+(?:\.\d+)?))?\s*$/i;
const ALERT = /^\s*(?:alert|al)\s+([a-z0-9][a-z0-9&._-]{0,24})\s+(?:(above|below|over|under|>|<)\s*)?(\d+(?:\.\d+)?)\s*$/i;

/**
 * "buy sbin 10", "b sbin", "sell infy 5 @ 1500", "s tcs 2 at 3900.5"
 * @returns null, or { side: "BUY" | "SELL", symbol, quantity | null, price | null }
 */
export function parseCommand(q) {
  const m = CMD.exec(String(q || ""));
  if (!m) return null;
  const quantity = m[3] ? Number(m[3]) : null;
  if (quantity !== null && !(quantity >= 1)) return null;
  const price = m[4] ? Number(m[4]) : null;
  if (price !== null && !(price > 0)) return null;
  return { side: /^b/i.test(m[1]) ? "BUY" : "SELL", symbol: m[2].toUpperCase(), quantity, price };
}

/**
 * "alert sbin 800", "alert sbin below 780", "al tcs > 4000"
 * @returns null, or { symbol, price, dir: "above" | "below" | "" } — "" lets the server pick the side from the price now
 */
export function parseAlert(q) {
  const m = ALERT.exec(String(q || ""));
  if (!m) return null;
  const price = Number(m[3]);
  if (!(price > 0)) return null;
  const w = (m[2] || "").toLowerCase();
  const dir = w === "above" || w === "over" || w === ">" ? "above" : w === "below" || w === "under" || w === "<" ? "below" : "";
  return { symbol: m[1].toUpperCase(), price, dir };
}

/** How well a label answers what was typed: 0 is no match. */
export function matchScore(text, q) {
  const t = String(text || "").toLowerCase();
  const s = String(q || "").trim().toLowerCase();
  if (!s) return 1;
  if (!t) return 0;
  if (t === s) return 100;
  if (t.startsWith(s)) return 80;
  if (t.split(/[^a-z0-9]+/).some((w) => w.startsWith(s))) return 60;
  if (t.includes(s)) return 40;
  let i = 0;
  for (const ch of t) if (ch === s[i]) i += 1;
  return i === s.length ? 10 : 0; // the letters appear in order
}

/**
 * The items that match, best first; ties keep their given order. `keywords` count for half,
 * and only when a word matches: scattered letters in a long description would match anything.
 */
export function rank(items, q, limit = 12) {
  const kw = (it) => {
    const s = matchScore(it.keywords, q);
    return s >= 40 ? Math.floor(s / 2) : 0;
  };
  return (items || [])
    .map((it, i) => ({ it, i, score: Math.max(matchScore(it.label, q), kw(it)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it);
}
