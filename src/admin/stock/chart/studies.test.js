import { aggregate, applyTick, atr, bollinger, ema, heikinAshi, macd, patterns, pivots, rsi, sma, stochastic, supertrend, technicalSummary, toBar, toBars, vwap, IST_SEC } from "./studies";

const bar = (time, o, h, l, c, v = 100) => ({ time, open: o, high: h, low: l, close: c, volume: v });

test("Kite's candles become bars on the IST wall clock", () => {
  expect(toBar({ t: "2026-11-12", o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }).time).toBe(Date.parse("2026-11-12T00:00:00Z") / 1000);
  // 09:15 IST is 03:45 UTC; on the chart's axis it must read 09:15
  const b = toBar({ t: "2026-11-12T09:15:00+0530", o: 1, h: 2, l: 0.5, c: 1.5, v: 9 });
  expect(new Date(b.time * 1000).toISOString()).toBe("2026-11-12T09:15:00.000Z");
  expect(toBars([{ t: "2026-11-13", o: 1, h: 1, l: 1, c: 1 }, { t: "2026-11-12", o: 1, h: 1, l: 1, c: 1 }]).map((x) => x.time)[0]).toBeLessThan(Date.parse("2026-11-13T00:00:00Z") / 1000);
});

test("daily bars roll up into weeks (from Monday) and months", () => {
  const day = (d) => Date.parse(`2026-11-${d}T00:00:00Z`) / 1000;
  const days = [bar(day("09"), 10, 12, 9, 11), bar(day("13"), 11, 15, 10, 14, 50), bar(day("16"), 14, 14, 8, 9)];
  const w = aggregate(days, "week");
  expect(w).toHaveLength(2);
  expect(w[0]).toMatchObject({ open: 10, high: 15, low: 9, close: 14, volume: 150 });
  expect(aggregate(days, "month")).toHaveLength(1);
});

test("moving averages, Bollinger, RSI and MACD agree with hand-worked values", () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(sma(v, 3)[2]).toBe(2);
  expect(sma(v, 3)[9]).toBe(9);
  expect(ema(v, 3)[2]).toBe(2);
  expect(ema(v, 3)[3]).toBeCloseTo(3, 10);
  const bb = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  expect(bb.mid[7]).toBe(5);
  expect(bb.up[7]).toBe(9); // standard deviation 2
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  expect(rsi(up, 14)[29]).toBe(100);
  const longer = Array.from({ length: 40 }, (_, i) => 100 + i);
  expect(macd(longer).hist[33]).not.toBeNull(); // 26 bars for the slow average, then 9 for the signal
  expect(macd(longer).hist[32]).toBeNull();
});

test("ATR, stochastic, supertrend and VWAP behave on a simple series", () => {
  const bars = Array.from({ length: 40 }, (_, i) => bar(i * 300, 100 + i, 101 + i, 99 + i, 100.5 + i, 10));
  expect(atr(bars, 14)[39]).toBeCloseTo(2, 1);
  expect(stochastic(bars).k[39]).toBeGreaterThan(80);
  expect(supertrend(bars).dir[39]).toBe(1);
  const vw = vwap([bar(0, 10, 12, 8, 10, 1), bar(300, 10, 12, 8, 13, 3)]);
  expect(vw[1]).toBeCloseTo((10 * 1 + 11 * 3) / 4, 6);
});

test("Heikin-Ashi, pivots and candlestick patterns", () => {
  const ha = heikinAshi([bar(0, 10, 12, 9, 11), bar(1, 11, 13, 10, 12)]);
  expect(ha[1].close).toBe(11.5);
  expect(pivots(bar(0, 10, 12, 8, 10))).toMatchObject({ p: 10, r1: 12, s1: 8 });
  const engulf = patterns([bar(0, 10, 10.5, 9, 9.5), bar(1, 10, 10.2, 9, 9.2), bar(2, 9.1, 10.6, 9, 10.5)]);
  expect(engulf[0]).toMatchObject({ text: "Bullish engulfing", kind: "bull" });
});

test("the technical summary tallies moving averages and oscillators", () => {
  const up = Array.from({ length: 220 }, (_, i) => bar(i, 100 + i, 101 + i, 99 + i, 100.6 + i));
  const s = technicalSummary(up);
  expect(s.mas.label).toBe("Strong buy");
  expect(s.mas.buy).toBe(12);
  expect(["Buy", "Strong buy", "Neutral"]).toContain(s.overall.label);
  expect(technicalSummary(up.slice(0, 10))).toBeNull();
});

test("a live tick updates the last bar or opens the next one", () => {
  const t0 = Date.parse("2026-11-12T03:45:00Z"); // 09:15 IST
  const first = Math.floor(t0 / 1000) + IST_SEC;
  const bars = [bar(first, 100, 101, 99, 100)];
  const same = applyTick(bars, { price: 102, tickMs: t0 + 120000 }, 300);
  expect(same).toHaveLength(1);
  expect(same[0]).toMatchObject({ close: 102, high: 102 });
  const next = applyTick(bars, { price: 98, tickMs: t0 + 310000 }, 300);
  expect(next).toHaveLength(2);
  expect(next[1]).toMatchObject({ time: first + 300, open: 98 });
  const daily = applyTick([bar(0, 10, 11, 9, 10)], { price: 8 }, 86400);
  expect(daily[0]).toMatchObject({ low: 8, close: 8 });
});
