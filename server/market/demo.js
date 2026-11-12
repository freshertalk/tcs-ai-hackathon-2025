"use strict";
// DEMO DATA — synthetic, not real prices.
//
// Lets the Analyzer be explored before a market-data connection exists. The
// symbols are deliberately not real tickers ("DEMO-UPTREND" …) so a made-up
// price can never be mistaken for a real one. Series are deterministic: the same
// symbol always produces the same history, growing by one bar per weekday.

const PROFILES = {
  "DEMO-UPTREND": { name: "Demo · steady uptrend", start: 240, drift: 0.06, noise: 1.5, wave: 0.03 },
  "DEMO-RANGE": { name: "Demo · sideways range", start: 510, drift: 0.0, noise: 1.3, wave: 0.05 },
  "DEMO-DOWNTREND": { name: "Demo · downtrend", start: 1450, drift: -0.04, noise: 1.5, wave: 0.03 },
  "DEMO-VOLATILE": { name: "Demo · volatile mover", start: 95, drift: 0.04, noise: 3.0, wave: 0.06 },
  "DEMO-CYCLES": { name: "Demo · boom and bust cycles", start: 780, drift: 0.025, noise: 1.6, wave: 0.09 },
};
const INDEX = { symbol: "DEMO-INDEX", name: "Demo index", start: 11000, drift: 0.035, noise: 0.8, wave: 0.04 };

const START = Date.UTC(2019, 0, 1);

function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function generate(symbol, profile, todayIso) {
  let s = seedOf(symbol);
  const rnd = () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const end = Date.parse(`${todayIso}T00:00:00Z`);
  const out = [];
  let p = profile.start;
  let k = 0;
  for (let t = START; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    // slow regime wave so trends strengthen, stall and resume like real charts
    const regime = Math.sin(k / 55) * profile.wave + Math.sin(k / 190) * profile.wave * 0.8;
    const shock = (rnd() + rnd() + rnd() - 1.5) * 1.6 * profile.noise; // roughly bell-shaped
    const o = p * (1 + (rnd() - 0.5) * 0.004 * profile.noise);
    p = Math.max(1, p * (1 + (profile.drift + regime + shock) / 100));
    const h = Math.max(o, p) * (1 + rnd() * 0.006 * profile.noise);
    const l = Math.min(o, p) * (1 - rnd() * 0.006 * profile.noise);
    const move = Math.abs(p - o) / o;
    const v = Math.round((600000 + rnd() * 500000) * (1 + move * 30));
    const r = (x) => Math.round(x * 100) / 100;
    out.push({ t: new Date(t).toISOString().slice(0, 10), o: r(o), h: r(h), l: r(l), c: r(p), v });
    k += 1;
  }
  return out;
}

const isDemoSymbol = (symbol) => Object.prototype.hasOwnProperty.call(PROFILES, symbol);

function demoCandles(symbol, todayIso) {
  return isDemoSymbol(symbol) ? generate(symbol, PROFILES[symbol], todayIso) : null;
}

const demoIndex = (todayIso) => ({ name: INDEX.name, candles: generate(INDEX.symbol, INDEX, todayIso) });

const demoInstruments = () => Object.entries(PROFILES).map(([s, p]) => ({ s, n: p.name, t: 0, k: "EQ" }));

module.exports = { demoCandles, demoIndex, demoInstruments, isDemoSymbol, DEMO_SYMBOLS: Object.keys(PROFILES) };
