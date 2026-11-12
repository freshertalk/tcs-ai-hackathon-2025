"use strict";
// Rule-based trade setups for DAILY bars, long side only.
//
// Why long only: in the NSE cash segment a short position cannot be carried
// overnight, so for delivery/swing trading a bearish reading means "exit" or
// "stay out", not "sell short".
//
// Every setup is a list of explicit conditions. A setup "triggers" on a bar only
// when ALL its conditions are true on that bar's close — the same rule is used
// for today's reading and for the backtest, so what is tested is what is shown.
// None of this is a prediction: each rule is a well-known, published method, and
// the backtest shows how it actually behaved on this particular stock.

const I = require("./indicators");

const num = I.isNum;

/** Everything the rules need, computed once per symbol. */
function buildContext(candles) {
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const vols = candles.map((c) => c.v);
  const bb = I.bollinger(closes, 20, 2);
  const dmi = I.adx(candles, 14);
  const st = I.supertrend(candles, 10, 3);
  const m = I.macd(closes);
  return {
    candles,
    closes,
    highs,
    lows,
    vols,
    ema20: I.ema(closes, 20),
    ema50: I.ema(closes, 50),
    ema200: I.ema(closes, 200),
    sma5: I.sma(closes, 5),
    sma50: I.sma(closes, 50),
    sma200: I.sma(closes, 200),
    rsi14: I.rsi(closes, 14),
    rsi2: I.rsi(closes, 2),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    bb,
    bbWidthLow120: I.lowest(bb.width.map((w) => (num(w) ? w : Infinity)), 120),
    atr14: I.atr(candles, 14),
    adx: dmi.adx,
    plusDI: dmi.plusDI,
    minusDI: dmi.minusDI,
    stLine: st.line,
    stDir: st.dir,
    obv: I.obv(candles),
    volAvg20: I.sma(vols, 20),
    hh20: I.highest(highs, 20),
    ll20: I.lowest(lows, 20),
    hh55: I.highest(highs, 55),
    ll10: I.lowest(lows, 10),
    stoch: I.stochastic(candles, 14, 3),
    roc20: I.roc(closes, 20),
  };
}

const f2 = (x) => (num(x) ? x.toFixed(2) : "—");
const cond = (label, ok, detail = "") => ({ label, ok: Boolean(ok), detail });

/**
 * A strategy:
 *   conditions(ctx, i)  → [{ label, ok, detail }]   entry rules on bar i
 *   stop(ctx, i)        → initial stop-loss price if entered after bar i
 *   exit(ctx, i, pos)   → reason string when the position should be closed on bar i, else null
 *   maxHold             → optional time stop, in bars
 */
const STRATEGIES = [
  {
    id: "trend_pullback",
    exitText: "Exit when a day closes below the 50 EMA, or at the stop.",
    name: "Trend pullback to the 20 EMA",
    style: "Swing · trend following",
    idea: "Buy a healthy uptrend when it dips to its 20-day average and turns back up, instead of chasing it when extended.",
    conditions(ctx, i) {
      const c = ctx.candles[i];
      const p = ctx.candles[i - 1];
      const e20 = ctx.ema20[i];
      const dipped = [0, 1, 2].some((k) => i - k >= 0 && num(ctx.ema20[i - k]) && ctx.candles[i - k].l <= ctx.ema20[i - k] * 1.005);
      return [
        cond("Price above the 200 EMA (long-term uptrend)", num(ctx.ema200[i]) && c.c > ctx.ema200[i], `close ${f2(c.c)} vs ${f2(ctx.ema200[i])}`),
        cond("50 EMA above the 200 EMA", num(ctx.ema200[i]) && ctx.ema50[i] > ctx.ema200[i], `${f2(ctx.ema50[i])} vs ${f2(ctx.ema200[i])}`),
        cond("Dipped to the 20 EMA in the last 3 bars", num(e20) && dipped, `20 EMA ${f2(e20)}`),
        cond("Closed back above the 20 EMA", num(e20) && c.c > e20, `close ${f2(c.c)}`),
        cond("Closed above yesterday's high (buyers back in control)", p && c.c > p.h, p ? `yesterday's high ${f2(p.h)}` : ""),
        cond("RSI not overbought (below 70)", num(ctx.rsi14[i]) && ctx.rsi14[i] < 70, `RSI ${f2(ctx.rsi14[i])}`),
      ];
    },
    stop(ctx, i) {
      const low3 = Math.min(ctx.candles[i].l, ctx.candles[i - 1].l, ctx.candles[i - 2].l);
      return low3 - 0.5 * ctx.atr14[i];
    },
    exit(ctx, i) {
      return num(ctx.ema50[i]) && ctx.candles[i].c < ctx.ema50[i] ? "Closed below the 50 EMA" : null;
    },
  },
  {
    id: "breakout_55",
    exitText: "Exit when a day closes below the lowest low of the previous 20 days, or at the stop.",
    name: "55-day breakout with volume",
    style: "Swing · breakout (Turtle / Donchian)",
    idea: "Buy when price closes at its highest level in 55 trading days on clearly above-average volume; leave when it makes a 20-day low.",
    conditions(ctx, i) {
      const c = ctx.candles[i];
      const prevHigh = ctx.hh55[i - 1];
      const va = ctx.volAvg20[i - 1];
      return [
        cond("Close above the highest high of the previous 55 bars", num(prevHigh) && c.c > prevHigh, `close ${f2(c.c)} vs ${f2(prevHigh)}`),
        cond("Volume at least 1.5× its 20-day average", num(va) && va > 0 && c.v >= 1.5 * va, num(va) && va > 0 ? `${(c.v / va).toFixed(2)}× average` : ""),
        cond("Price above the 200 EMA", num(ctx.ema200[i]) && c.c > ctx.ema200[i], `200 EMA ${f2(ctx.ema200[i])}`),
        cond("Closed in the top half of the day's range", c.h > c.l && (c.c - c.l) / (c.h - c.l) >= 0.5, ""),
      ];
    },
    stop(ctx, i) {
      return ctx.candles[i].c - 2 * ctx.atr14[i];
    },
    exit(ctx, i) {
      const prevLow = ctx.ll20[i - 1];
      return num(prevLow) && ctx.candles[i].c < prevLow ? "Closed below the 20-day low" : null;
    },
  },
  {
    id: "momentum_macd",
    exitText: "Exit when MACD is below its signal and price closes below the 20 EMA, or at the stop.",
    name: "MACD turn-up in an uptrend",
    style: "Swing · momentum",
    idea: "Buy when momentum turns up (MACD crosses above its signal) while the trend and RSI already favour buyers.",
    conditions(ctx, i) {
      const c = ctx.candles[i];
      const h = ctx.macdHist[i];
      const hp = ctx.macdHist[i - 1];
      return [
        cond("MACD crossed above its signal line today", num(h) && num(hp) && hp <= 0 && h > 0, `histogram ${f2(hp)} → ${f2(h)}`),
        cond("RSI above 50", num(ctx.rsi14[i]) && ctx.rsi14[i] > 50, `RSI ${f2(ctx.rsi14[i])}`),
        cond("Price above the 50 EMA", num(ctx.ema50[i]) && c.c > ctx.ema50[i], `50 EMA ${f2(ctx.ema50[i])}`),
        cond("50 EMA above the 200 EMA", num(ctx.ema200[i]) && ctx.ema50[i] > ctx.ema200[i], ""),
      ];
    },
    stop(ctx, i) {
      return ctx.candles[i].c - 2 * ctx.atr14[i];
    },
    exit(ctx, i) {
      const h = ctx.macdHist[i];
      return num(h) && h < 0 && ctx.candles[i].c < ctx.ema20[i] ? "MACD turned down and price is below the 20 EMA" : null;
    },
  },
  {
    id: "supertrend_flip",
    exitText: "Exit when the Supertrend flips bearish, or at the stop.",
    name: "Supertrend turns bullish",
    style: "Swing · trend following",
    idea: "Follow the Supertrend (10, 3): buy when it flips from red to green, exit when it flips back.",
    conditions(ctx, i) {
      return [
        cond("Supertrend flipped from bearish to bullish today", ctx.stDir[i] === 1 && ctx.stDir[i - 1] === -1, `line ${f2(ctx.stLine[i])}`),
        cond("Price above the 200 EMA", num(ctx.ema200[i]) && ctx.candles[i].c > ctx.ema200[i], `200 EMA ${f2(ctx.ema200[i])}`),
      ];
    },
    stop(ctx, i) {
      return Math.min(ctx.stLine[i], ctx.candles[i].c - 1.5 * ctx.atr14[i]);
    },
    exit(ctx, i) {
      return ctx.stDir[i] === -1 ? "Supertrend flipped bearish" : null;
    },
  },
  {
    id: "golden_cross",
    exitText: "Exit on a death cross (50 DMA below 200 DMA), or at the stop.",
    name: "Golden cross (50 over 200 DMA)",
    style: "Positional · long-term trend",
    idea: "A slow, long-term signal: hold while the 50-day average is above the 200-day average.",
    conditions(ctx, i) {
      const a = ctx.sma50[i];
      const b = ctx.sma200[i];
      const ap = ctx.sma50[i - 1];
      const bp = ctx.sma200[i - 1];
      return [
        cond("50 DMA crossed above the 200 DMA today", num(b) && num(bp) && ap <= bp && a > b, `${f2(a)} vs ${f2(b)}`),
        cond("Price above the 200 DMA", num(b) && ctx.candles[i].c > b, ""),
      ];
    },
    stop(ctx, i) {
      return ctx.candles[i].c - 3 * ctx.atr14[i];
    },
    exit(ctx, i) {
      return num(ctx.sma200[i]) && ctx.sma50[i] < ctx.sma200[i] ? "Death cross (50 DMA below 200 DMA)" : null;
    },
  },
  {
    id: "rsi2_dip",
    exitText: "Exit on the first close above the 5 DMA, after 10 bars, or at the stop.",
    name: "Short-term dip in an uptrend (RSI-2)",
    style: "Swing · mean reversion",
    idea: "In a long-term uptrend, buy a sharp 2–3 day sell-off (2-period RSI below 10) and sell the bounce above the 5-day average.",
    maxHold: 10,
    conditions(ctx, i) {
      const c = ctx.candles[i];
      return [
        cond("Price above the 200 DMA (only buy dips in an uptrend)", num(ctx.sma200[i]) && c.c > ctx.sma200[i], `200 DMA ${f2(ctx.sma200[i])}`),
        cond("2-period RSI below 10 (sharply oversold)", num(ctx.rsi2[i]) && ctx.rsi2[i] < 10, `RSI(2) ${f2(ctx.rsi2[i])}`),
        cond("Price below the 5 DMA", num(ctx.sma5[i]) && c.c < ctx.sma5[i], `5 DMA ${f2(ctx.sma5[i])}`),
      ];
    },
    stop(ctx, i) {
      return ctx.candles[i].c - 3 * ctx.atr14[i];
    },
    exit(ctx, i) {
      return num(ctx.sma5[i]) && ctx.candles[i].c > ctx.sma5[i] ? "Closed back above the 5 DMA" : null;
    },
  },
  {
    id: "squeeze_breakout",
    exitText: "Exit when a day closes below the 20-day average, or at the stop.",
    name: "Volatility squeeze breakout",
    style: "Swing · breakout (Bollinger)",
    idea: "After an unusually quiet period (Bollinger Bands at their narrowest in ~6 months), buy the first strong close above the upper band.",
    conditions(ctx, i) {
      const c = ctx.candles[i];
      const squeezed = [1, 2, 3, 4, 5].some(
        (k) => i - k >= 0 && num(ctx.bb.width[i - k]) && Number.isFinite(ctx.bbWidthLow120[i - k]) && num(ctx.bbWidthLow120[i - k]) && ctx.bb.width[i - k] <= ctx.bbWidthLow120[i - k] * 1.1
      );
      const va = ctx.volAvg20[i - 1];
      return [
        cond("Bands were at a ~6-month narrow within the last 5 bars", squeezed, `width ${num(ctx.bb.width[i]) ? (ctx.bb.width[i] * 100).toFixed(1) + "%" : "—"}`),
        cond("Close above the upper Bollinger Band", num(ctx.bb.upper[i]) && c.c > ctx.bb.upper[i], `upper band ${f2(ctx.bb.upper[i])}`),
        cond("Volume above its 20-day average", num(va) && c.v > va, num(va) && va > 0 ? `${(c.v / va).toFixed(2)}× average` : ""),
        cond("Price above the 50 EMA", num(ctx.ema50[i]) && c.c > ctx.ema50[i], ""),
      ];
    },
    stop(ctx, i) {
      return Math.min(ctx.bb.mid[i], ctx.candles[i].c - 1.5 * ctx.atr14[i]);
    },
    exit(ctx, i) {
      return num(ctx.bb.mid[i]) && ctx.candles[i].c < ctx.bb.mid[i] ? "Closed below the 20-day average (middle band)" : null;
    },
  },
];

const byId = (id) => STRATEGIES.find((s) => s.id === id) || null;

/** First bar on which every indicator a strategy might read is available. */
const WARMUP = 200;

/** Is the setup triggered on bar i? (false during warm-up) */
function triggered(strategy, ctx, i) {
  if (i < WARMUP || i >= ctx.candles.length) return false;
  if (!num(ctx.atr14[i])) return false;
  return strategy.conditions(ctx, i).every((c) => c.ok);
}

/**
 * Bearish events on bar i — reasons to exit, tighten stops or stay out.
 * These are shown as warnings; they are not short-sale signals.
 */
function bearishEvents(ctx, i) {
  const out = [];
  if (i < 1) return out;
  const c = ctx.candles[i];
  const p = ctx.candles[i - 1];
  const add = (name, detail) => out.push({ name, detail });

  if (num(ctx.ema200[i]) && num(ctx.ema200[i - 1]) && p.c >= ctx.ema200[i - 1] && c.c < ctx.ema200[i]) {
    add("Closed below the 200 EMA", `close ${f2(c.c)} vs ${f2(ctx.ema200[i])} — the long-term trend line gave way today`);
  }
  if (num(ctx.sma200[i]) && num(ctx.sma200[i - 1]) && ctx.sma50[i - 1] >= ctx.sma200[i - 1] && ctx.sma50[i] < ctx.sma200[i]) {
    add("Death cross", "the 50 DMA crossed below the 200 DMA today");
  }
  if (ctx.stDir[i] === -1 && ctx.stDir[i - 1] === 1) add("Supertrend flipped bearish", `line now ${f2(ctx.stLine[i])}`);
  if (num(ctx.macdHist[i]) && num(ctx.macdHist[i - 1]) && ctx.macdHist[i - 1] >= 0 && ctx.macdHist[i] < 0) {
    add("MACD crossed below its signal line", "momentum turned down today");
  }
  const prevLow = ctx.ll20[i - 1];
  const va = ctx.volAvg20[i - 1];
  if (num(prevLow) && c.c < prevLow) {
    add("20-day low breakdown", `close ${f2(c.c)} below ${f2(prevLow)}${num(va) && va > 0 ? ` on ${(c.v / va).toFixed(2)}× average volume` : ""}`);
  }
  if (num(ctx.rsi14[i]) && num(ctx.rsi14[i - 1]) && ctx.rsi14[i - 1] >= 70 && ctx.rsi14[i] < 70) {
    add("RSI fell out of overbought", `RSI ${f2(ctx.rsi14[i - 1])} → ${f2(ctx.rsi14[i])}`);
  }
  if (num(va) && va > 0 && c.c < p.c && c.v >= 2 * va && (p.c - c.c) / p.c >= 0.03) {
    add("Heavy-volume sell-off", `down ${(((p.c - c.c) / p.c) * 100).toFixed(1)}% on ${(c.v / va).toFixed(2)}× average volume`);
  }
  return out;
}

module.exports = { STRATEGIES, WARMUP, buildContext, triggered, bearishEvents, byId };
