"use strict";
// The Top 10: which stocks to trade in this session or the next, and why — scored the way a prop desk
// shortlists its morning list, and re-ranked through the session.
//
//   FIRST PASS  every stock in the universe (NIFTY 100, the watchlist, the stocks in the news), from its
//               daily candles and one batch of quotes:
//                 trend        above or below the 20-, 50- and 200-day averages, the 20-day average's slope
//                 strength     the last 20 sessions against the NIFTY's (relative strength)
//                 set-up       at or near a 20-day high or low, on volume; near the 52-week high or low;
//                              a narrow range (NR7, inside day) that tends to expand
//                 tradability  a daily range (ATR) wide enough to trade and not wild; enough money traded
//                 stretch      RSI 75 or more (25 or less) holds a long (short) back
//                 live         the move against the NIFTY, VWAP, where it sits in the day's range, the
//                              volume so far against its usual, a gap that holds or fades
//                 context      the NSE forecast from the world (GIFT Nifty, the US, Asia), the market's tide,
//                              its sector against the NIFTY, the news about it
//   SECOND PASS the best twenty again with the desk's own engines: the live call and the daily verdict, the
//               measured odds of today's set-ups (graded on the stock's own history), the intraday plan for
//               the session (its entry, stop and target, with the record of those exact rules) and the Live
//               Pulse for the next 15–30 minutes.
//
// Each item adds points to the long or the short side with the reason in words and the number behind it;
// the side with more points is the trade, and the margin between the two sides says how clear it is. A
// stock whose two sides are close, that is too quiet or too thin to trade, or whose plan says avoid, is
// left out. At most three from one sector.
//
// Pure arithmetic: no AI, no network, no timer, no order. A ranking of evidence with its reasons — not a
// promise, and not advice.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 || 0 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 || 0 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const sgn = (x) => (num(x) ? `${x > 0 ? "+" : ""}${x.toFixed(2)}%` : "—");
const KC = require("./situation");
const MAX_PER_SECTOR = 3;
const MIN_MARGIN = 8; // points between the two sides for a stock to have a side at all

function ema(closes, n) {
  if (closes.length < n) return null;
  let e = closes.slice(0, n).reduce((a, x) => a + x, 0) / n;
  const k = 2 / (n + 1);
  for (let i = n; i < closes.length; i += 1) e = closes[i] * k + e * (1 - k);
  return e;
}
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let up = 0;
  let dn = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) up += d;
    else dn -= d;
  }
  up /= n;
  dn /= n;
  for (let i = n + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    up = (up * (n - 1) + Math.max(0, d)) / n;
    dn = (dn * (n - 1) + Math.max(0, -d)) / n;
  }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}

/**
 * What the completed daily candles say. @param candles [{ t|d, o, h, l, c, v }], oldest first (completed sessions only)
 */
function dailyFeatures(candles) {
  const d = (candles || []).filter((c) => c && num(c.c) && c.c > 0);
  if (d.length < 60) return null;
  const closes = d.map((c) => c.c);
  const last = d[d.length - 1];
  const prev = d[d.length - 2];
  const back = (n) => (d.length > n ? pct(last.c, d[d.length - 1 - n].c) : null);
  const e20 = ema(closes, 20);
  const e20b = ema(closes.slice(0, -5), 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const trs = [];
  for (let i = Math.max(1, d.length - 14); i < d.length; i += 1) trs.push(Math.max(d[i].h - d[i].l, Math.abs(d[i].h - d[i - 1].c), Math.abs(d[i].l - d[i - 1].c)));
  const atr = trs.reduce((a, x) => a + x, 0) / trs.length;
  const w20 = d.slice(-21, -1); // the twenty sessions before the last
  const hi20 = Math.max(...w20.map((c) => c.h));
  const lo20 = Math.min(...w20.map((c) => c.l));
  const w52 = d.slice(-250);
  const hi52 = Math.max(...w52.map((c) => c.h));
  const lo52 = Math.min(...w52.map((c) => c.l));
  const vols = d.slice(-21, -1).map((c) => (num(c.v) ? c.v : 0));
  const avgVol = vols.reduce((a, x) => a + x, 0) / Math.max(1, vols.length);
  const turnover = d.slice(-20).reduce((a, c) => a + c.c * (num(c.v) ? c.v : 0), 0) / 20 / 1e7;
  const ranges = d.slice(-7).map((c) => c.h - c.l);
  const range = last.h - last.l;
  return {
    asOf: String(last.t || last.d).slice(0, 10),
    close: r2(last.c),
    prevClose: r2(prev.c),
    ret1: r2(pct(last.c, prev.c)),
    ret5: r2(back(5)),
    ret20: r2(back(20)),
    ret60: r2(back(60)),
    ema20: r2(e20),
    ema50: r2(e50),
    ema200: r2(e200),
    vsEma20: r2(pct(last.c, e20)),
    vsEma50: r2(pct(last.c, e50)),
    vsEma200: r2(pct(last.c, e200)),
    ema20Slope: r2(pct(e20, e20b)),
    rsi14: r1(rsi(closes.slice(-120))),
    atrPct: r2((atr / last.c) * 100),
    atr: r2(atr),
    hi20: r2(hi20),
    lo20: r2(lo20),
    toHi20Pct: r2(pct(hi20, last.c)), // how far above the price the 20-day high is (negative: broken)
    toLo20Pct: r2(pct(last.c, lo20)),
    hi52: r2(hi52),
    lo52: r2(lo52),
    fromHi52Pct: r2(pct(last.c, hi52)),
    fromLo52Pct: r2(pct(last.c, lo52)),
    relVol: avgVol > 0 && num(last.v) ? r2(last.v / avgVol) : null,
    avgVol: Math.round(avgVol),
    turnoverCr: r2(turnover),
    nr7: ranges.length === 7 && range <= Math.min(...ranges),
    inside: last.h <= prev.h && last.l >= prev.l,
    closeLoc: range > 0 ? r2((last.c - last.l) / range) : 0.5,
  };
}

/**
 * What the live quote adds. @param q { last, prevClose, open, high, low, volume, avgPrice, buyQty, sellQty }
 * @param minutesIn minutes since 9:15 (0–375)
 */
function liveFeatures(q, df, { minutesIn = 375 } = {}) {
  if (!q || !num(q.last) || q.last <= 0) return null;
  const pc = num(q.prevClose) && q.prevClose > 0 ? q.prevClose : df ? df.close : null;
  const range = num(q.high) && num(q.low) ? q.high - q.low : null;
  const frac = clamp(minutesIn / 375, 0.05, 1);
  return {
    last: r2(q.last),
    changePct: r2(pct(q.last, pc)),
    gapPct: num(q.open) && q.open > 0 ? r2(pct(q.open, pc)) : null,
    vsOpenPct: num(q.open) && q.open > 0 ? r2(pct(q.last, q.open)) : null,
    vsVwapPct: num(q.avgPrice) && q.avgPrice > 0 ? r2(pct(q.last, q.avgPrice)) : null,
    rangePos: range > 0 ? r2((q.last - q.low) / range) : null,
    relVolNow: df && df.avgVol > 0 && num(q.volume) ? r2(q.volume / (df.avgVol * frac)) : null,
    buyersPct: num(q.buyQty) && num(q.sellQty) && q.buyQty + q.sellQty > 0 ? Math.round((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null,
  };
}

/** One stock scored on both sides. @param ctx { niftyRet20, niftyChangePct, world: { score, firm, word }, tide: { score }, sector: { name, vsNiftyPct }, news: { sentiment, high, mentions, title }, live: bool } */
function score(df, lf, ctx = {}) {
  const parts = { long: [], short: [] };
  const add = (side, id, pts, text) => parts[side].push({ id, pts, text });
  const both = (id, pts, text) => {
    add("long", id, pts, text);
    add("short", id, pts, text);
  };
  let excluded = "";
  if (df) {
    // trend
    const above = [df.vsEma20, df.vsEma50, df.vsEma200].filter((x) => num(x) && x > 0).length;
    const below = [df.vsEma20, df.vsEma50, df.vsEma200].filter((x) => num(x) && x < 0).length;
    if (above === 3) add("long", "trend", 14, `Above its 20-, 50- and 200-day averages (${sgn(df.vsEma20)} from the 20-day).`);
    else if (above === 2 && df.vsEma20 > 0) add("long", "trend", 7, `Above its 20-day average (${sgn(df.vsEma20)}) and one of the longer ones.`);
    if (below === 3) add("short", "trend", 14, `Below its 20-, 50- and 200-day averages (${sgn(df.vsEma20)} from the 20-day).`);
    else if (below === 2 && df.vsEma20 < 0) add("short", "trend", 7, `Below its 20-day average (${sgn(df.vsEma20)}) and one of the longer ones.`);
    if (num(df.ema20Slope) && df.ema20Slope >= 0.3) add("long", "slope", 5, `The 20-day average is rising (${sgn(df.ema20Slope)} in a week).`);
    if (num(df.ema20Slope) && df.ema20Slope <= -0.3) add("short", "slope", 5, `The 20-day average is falling (${sgn(df.ema20Slope)} in a week).`);
    // relative strength against the NIFTY
    if (num(df.ret20) && num(ctx.niftyRet20)) {
      const rs = df.ret20 - ctx.niftyRet20;
      if (rs >= 3) add("long", "rs", 10, `Stronger than the NIFTY: ${sgn(df.ret20)} in 20 sessions against ${sgn(ctx.niftyRet20)}.`);
      else if (rs >= 1.5) add("long", "rs", 5, `A little stronger than the NIFTY over 20 sessions (${sgn(rs)}).`);
      if (rs <= -3) add("short", "rs", 10, `Weaker than the NIFTY: ${sgn(df.ret20)} in 20 sessions against ${sgn(ctx.niftyRet20)}.`);
      else if (rs <= -1.5) add("short", "rs", 5, `A little weaker than the NIFTY over 20 sessions (${sgn(rs)}).`);
    }
    // set-ups
    if (num(df.toHi20Pct) && df.toHi20Pct <= 0 && num(df.relVol) && df.relVol >= 1.5) add("long", "breakout", 10, `Closed above its 20-day high (${df.hi20}) on ${df.relVol}× its usual volume.`);
    else if (num(df.toHi20Pct) && df.toHi20Pct > 0 && df.toHi20Pct <= 1 && df.vsEma20 > 0) add("long", "nearHigh", 7, `${df.toHi20Pct}% under its 20-day high (${df.hi20}): a break is one push away.`);
    if (num(df.toLo20Pct) && df.close < df.lo20 && num(df.relVol) && df.relVol >= 1.5) add("short", "breakdown", 10, `Closed below its 20-day low (${df.lo20}) on ${df.relVol}× its usual volume.`);
    else if (num(df.toLo20Pct) && df.toLo20Pct >= 0 && df.toLo20Pct <= 1 && df.vsEma20 < 0) add("short", "nearLow", 7, `${df.toLo20Pct}% above its 20-day low (${df.lo20}): a break is one push away.`);
    if (num(df.fromHi52Pct) && df.fromHi52Pct >= -2 && df.vsEma50 > 0) add("long", "high52", 5, `Within 2% of its 52-week high (${df.hi52}).`);
    if (num(df.fromLo52Pct) && df.fromLo52Pct <= 2 && df.vsEma50 < 0) add("short", "low52", 5, `Within 2% of its 52-week low (${df.lo52}).`);
    if (df.nr7) both("nr7", 4, "The narrowest daily range of the last seven sessions: ranges tend to expand after this.");
    else if (df.inside) both("inside", 3, "An inside day (inside the previous day's range): a break either way tends to run.");
    if (num(df.relVol) && df.relVol >= 1.8 && df.closeLoc >= 0.7) add("long", "volume", 6, `${df.relVol}× its usual volume, closing near the day's high.`);
    if (num(df.relVol) && df.relVol >= 1.8 && df.closeLoc <= 0.3) add("short", "volume", 6, `${df.relVol}× its usual volume, closing near the day's low.`);
    // stretch
    if (num(df.rsi14) && df.rsi14 >= 75) add("long", "stretch", -6, `Stretched: daily RSI ${df.rsi14} — a long here chases.`);
    if (num(df.rsi14) && df.rsi14 <= 25) add("short", "stretch", -6, `Stretched: daily RSI ${df.rsi14} — a short here chases.`);
    // tradability
    if (num(df.atrPct)) {
      if (df.atrPct >= 1 && df.atrPct <= 4) both("range", 6, `Moves enough to trade: an average daily range of ${df.atrPct}%.`);
      else if (df.atrPct < 0.6) excluded = `Too quiet to trade intraday: an average daily range of only ${df.atrPct}%.`;
      else if (df.atrPct < 0.8) both("range", -10, `Quiet: an average daily range of only ${df.atrPct}%.`);
      else if (df.atrPct > 5) both("range", -6, `Very wild: an average daily range of ${df.atrPct}%.`);
    }
    if (num(df.turnoverCr) && df.turnoverCr < 20) excluded = `Too thin to trade: ₹${df.turnoverCr} crore a day on average.`;
    else if (num(df.turnoverCr) && df.turnoverCr < 50) both("liquidity", -8, `Thin: ₹${df.turnoverCr} crore traded a day on average.`);
  }
  if (lf && ctx.live) {
    const rel = num(lf.changePct) && num(ctx.niftyChangePct) ? lf.changePct - ctx.niftyChangePct : null;
    if (num(rel) && rel >= 1) add("long", "today", 8, `Up ${sgn(lf.changePct)} today, ${sgn(rel)} better than the NIFTY.`);
    if (num(rel) && rel <= -1) add("short", "today", 8, `Down ${sgn(lf.changePct)} today, ${sgn(rel)} worse than the NIFTY.`);
    if (num(lf.vsVwapPct) && lf.vsVwapPct >= 0.2) add("long", "vwap", 6, `Above VWAP (${sgn(lf.vsVwapPct)}): today's buyers are in profit.`);
    if (num(lf.vsVwapPct) && lf.vsVwapPct <= -0.2) add("short", "vwap", 6, `Below VWAP (${sgn(lf.vsVwapPct)}): today's buyers are underwater.`);
    if (num(lf.rangePos) && lf.rangePos >= 0.75) add("long", "rangePos", 4, "Trading in the top quarter of today's range.");
    if (num(lf.rangePos) && lf.rangePos <= 0.25) add("short", "rangePos", 4, "Trading in the bottom quarter of today's range.");
    if (num(lf.relVolNow) && lf.relVolNow >= 1.5) add(num(lf.changePct) && lf.changePct < 0 ? "short" : "long", "volNow", 6, `Volume so far is ${lf.relVolNow}× its usual for this time of day.`);
    if (num(lf.gapPct) && Math.abs(lf.gapPct) >= 1.5) {
      const holds = lf.gapPct > 0 ? lf.vsOpenPct >= 0 : lf.vsOpenPct <= 0;
      add(lf.gapPct > 0 ? "long" : "short", "gap", holds ? 5 : -5, `Opened with a ${sgn(lf.gapPct)} gap that is ${holds ? "holding" : "fading"} (${sgn(lf.vsOpenPct)} from the open).`);
    }
  }
  // context
  if (ctx.world && num(ctx.world.score) && Math.abs(ctx.world.score) >= 10) {
    const pts = Math.round(clamp(Math.abs(ctx.world.score) * (ctx.world.firm ? 0.1 : 0.06), 0, 8));
    if (pts) add(ctx.world.score > 0 ? "long" : "short", "world", pts, `The NSE forecast from the world (GIFT Nifty, the US, Asia) leans ${ctx.world.word || (ctx.world.score > 0 ? "up" : "down")}${ctx.world.firm ? ", firmly" : ""}.`);
  }
  if (ctx.live && ctx.tide && num(ctx.tide.score) && Math.abs(ctx.tide.score) >= 20) {
    const pts = Math.round(clamp(Math.abs(ctx.tide.score) * 0.06, 0, 6));
    if (pts) add(ctx.tide.score > 0 ? "long" : "short", "tide", pts, `The market's tide is ${ctx.tide.score > 0 ? "rising" : "falling"} (${ctx.tide.score}).`);
  }
  if (ctx.sector && num(ctx.sector.vsNiftyPct)) {
    if (ctx.sector.vsNiftyPct >= 0.8) add("long", "sector", 5, `Its sector (${ctx.sector.name}) is leading the NIFTY by ${sgn(ctx.sector.vsNiftyPct)}.`);
    if (ctx.sector.vsNiftyPct <= -0.8) add("short", "sector", 5, `Its sector (${ctx.sector.name}) is lagging the NIFTY by ${sgn(ctx.sector.vsNiftyPct)}.`);
  }
  if (ctx.news && num(ctx.news.sentiment) && ctx.news.mentions > 0) {
    if (ctx.news.sentiment >= 0.3) add("long", "news", ctx.news.high ? 6 : 3, `Positive news${ctx.news.high ? " (high impact)" : ""}: “${String(ctx.news.title || "").slice(0, 90)}”.`);
    else if (ctx.news.sentiment <= -0.3) add("short", "news", ctx.news.high ? 6 : 3, `Negative news${ctx.news.high ? " (high impact)" : ""}: “${String(ctx.news.title || "").slice(0, 90)}”.`);
    else if (ctx.news.high) both("news", 2, "In the news today (high impact): in play.");
  }
  // the knowledge base read against these numbers (market/situation.js): only the context the items above
  // do not already weigh — a stretch from VWAP, a break on thin volume, a chase, a leader in a weak market.
  // A rule against a side takes points from that side; it never gives them to the other.
  let knowledge = null;
  try {
    knowledge = KC.check(KC.fromPick(df, lf, ctx), { skip: ["gap"] });
  } catch (_) {
    knowledge = null; // the knowledge base never stops a ranking
  }
  if (knowledge) {
    for (const n of knowledge.notes) {
      if (!n.counts || (n.id === "break-volume" && n.stance === "for")) continue; // a break on volume is already scored above
      const pts = Math.round(3 * n.weight);
      add(n.side, "kb", n.stance === "for" ? pts : -pts, `Knowledge base (${n.title}): ${n.text}`);
    }
  }
  const out = finish(parts, excluded);
  out.knowledge = knowledge ? KC.brief(knowledge, { limit: 6 }) : null;
  return out;
}


/** The second pass: the desk's own engines, added to a first-pass score. @param eng { verdict, edge, plan, pulse, live } */
function deepen(first, eng = {}) {
  const parts = { long: first.parts.long.slice(), short: first.parts.short.slice() };
  const add = (side, id, pts, text) => parts[side].push({ id, pts, text });
  let excluded = first.excluded;
  let plan = null;
  const v = eng.verdict;
  if (v && v.available !== false) {
    const k = num(v.conviction) ? clamp(v.conviction, 0, 100) / 100 : 0.5;
    if (v.direction === "bullish") add("long", "verdict", Math.round(4 + 6 * k), `The desk's daily verdict is bullish (${v.convictionLabel || "conviction"} conviction).`);
    if (v.direction === "bearish") add("short", "verdict", Math.round(4 + 6 * k), `The desk's daily verdict is bearish (${v.convictionLabel || "conviction"} conviction).`);
    const d = v.day;
    if (eng.live && d && d.available && (d.state === "long" || d.state === "short")) add(d.state, "liveCall", 10, `The desk's live call is ${d.state.toUpperCase()} now${num(d.score) ? ` (score ${d.score})` : ""}.`);
  }
  const e = eng.edge;
  if (e && e.available !== false && e.kinds) {
    let best = { long: null, short: null };
    for (const [kind, sides] of Object.entries(e.kinds)) {
      if (kind !== "day") continue;
      for (const side of ["long", "short"]) {
        const x = sides && sides[side];
        if (x && (x.grade === "A" || x.grade === "B") && (!best[side] || x.grade < best[side].grade)) best = { ...best, [side]: x };
      }
    }
    for (const side of ["long", "short"]) {
      const x = best[side];
      if (!x) continue;
      const live = x.live || {};
      add(side, "odds", x.grade === "A" ? 12 : 7, `Measured odds, grade ${x.grade}: on the days most like today a ${side} day trade won ${live.winPct ?? "—"}% of ${live.n ?? "—"} times (${num(live.expR) ? `${live.expR > 0 ? "+" : ""}${live.expR}R` : "—"} a trade).`);
    }
  }
  const p = eng.plan;
  if (p && p.available !== false && p.decision) {
    const kind = p.decision.kind;
    const rec = p.record || null;
    if (kind === "long" || kind === "short") {
      const lr = rec && rec.lean ? rec.lean[kind] : null;
      add(kind, "plan", 10, `The intraday plan is ${kind.toUpperCase()}${lr && lr.trades ? ` (its rule won ${lr.winRate}% of ${lr.trades} past sessions)` : ""}.`);
      const pl = p.plans && p.plans[kind];
      if (pl) plan = { kind, entry: r2(pl.entry), stop: r2(pl.stop), target: r2(pl.targets && pl.targets[0]), target2: r2(pl.targets && pl.targets[1]), record: lr && lr.trades ? { trades: lr.trades, winRate: lr.winRate, avgR: lr.avgR } : null, why: p.decision.why || p.decision.headline || "" };
    } else if (kind === "orb") {
      add("long", "plan", 4, "The intraday plan is the opening-range break, either side.");
      add("short", "plan", 4, "The intraday plan is the opening-range break, either side.");
      const o = rec && rec.orb;
      plan = { kind, rule: "Break of the 9:15–9:30 high or low after 9:30; stop at the other side.", record: o && o.trades ? { trades: o.trades, winRate: o.winRate, avgR: o.avgR } : null, why: p.decision.why || "" };
    } else if (kind === "avoid") {
      excluded = excluded || `The intraday plan says avoid: ${String(p.decision.why || "").slice(0, 140)}`;
    } else plan = { kind: "wait", why: p.decision.why || "" };
  }
  const pu = eng.pulse;
  if (eng.live && pu && pu.available !== false && num(pu.score)) {
    if (pu.score >= 30) add("long", "pulse", 8, `The Live Pulse for the next 15–30 minutes leans up (${pu.score}).`);
    if (pu.score <= -30) add("short", "pulse", 8, `The Live Pulse for the next 15–30 minutes leans down (${pu.score}).`);
  }
  const out = finish(parts, excluded);
  out.plan = plan;
  out.deep = true;
  out.knowledge = first.knowledge || null;
  return out;
}

function finish(parts, excluded) {
  const sum = (xs) => xs.reduce((a, x) => a + x.pts, 0);
  const L = sum(parts.long);
  const S = sum(parts.short);
  const side = L >= S ? "long" : "short";
  const margin = Math.abs(L - S);
  const raw = Math.max(L, S);
  const reasons = parts[side].filter((x) => x.pts > 0).sort((a, b) => b.pts - a.pts);
  const against = parts[side].filter((x) => x.pts < 0).concat(parts[side === "long" ? "short" : "long"].filter((x) => x.pts >= 8 && !["nr7", "inside", "range", "news"].includes(x.id)));
  return {
    side,
    score: clamp(Math.round(raw * 1.15), 0, 99),
    margin,
    long: L,
    short: S,
    clear: margin >= MIN_MARGIN,
    excluded: excluded || (margin < MIN_MARGIN ? `Two-sided: ${L} points for a long, ${S} for a short.` : ""),
    reasons: reasons.map((x) => x.text),
    against: against.map((x) => x.text).slice(0, 3),
    tags: reasons.map((x) => x.id),
    parts,
  };
}

/** The final list: the clear ones, best first, at most three per sector. */
function rank(rows, { limit = 10 } = {}) {
  const ok = rows.filter((r) => r.s && !r.s.excluded).sort((a, b) => b.s.score - a.s.score || b.s.margin - a.s.margin);
  const per = new Map();
  const out = [];
  for (const r of ok) {
    // a stock in no known sector is not capped with the others
    const k = r.sector || null;
    if (k && (per.get(k) || 0) >= MAX_PER_SECTOR) continue;
    if (k) per.set(k, (per.get(k) || 0) + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * How a list did in its session: each pick from the open to the close in its direction, and against the
 * same move for the whole universe. @param picks [{ symbol, side }] @param day { [symbol]: { o, h, l, c } } that session's candles
 */
function scoreList(picks, day, universe = []) {
  const rows = [];
  for (const p of picks) {
    const c = day[p.symbol];
    if (!c || !num(c.o) || c.o <= 0 || !num(c.c)) continue;
    const s = p.side === "short" ? -1 : 1;
    const move = (s * (c.c - c.o)) / c.o * 100;
    const best = s > 0 ? pct(c.h, c.o) : -pct(c.l, c.o);
    const worst = s > 0 ? pct(c.l, c.o) : -pct(c.h, c.o);
    rows.push({ symbol: p.symbol, side: p.side, rank: p.rank, movePct: r2(move), bestPct: r2(best), worstPct: r2(worst), hit: move > 0, tags: p.tags || [] });
  }
  const base = universe.map((sym) => day[sym]).filter((c) => c && num(c.o) && c.o > 0 && num(c.c)).map((c) => ((c.c - c.o) / c.o) * 100);
  const baseAvg = base.length ? base.reduce((a, x) => a + x, 0) / base.length : null;
  const n = rows.length;
  const avg = n ? rows.reduce((a, x) => a + x.movePct, 0) / n : null;
  // the same side mix in the whole universe: a long is measured against the average stock, a short against its opposite
  const baseSide = n && num(baseAvg) ? rows.reduce((a, x) => a + (x.side === "short" ? -baseAvg : baseAvg), 0) / n : null;
  return {
    n,
    hits: rows.filter((x) => x.hit).length,
    hitRate: n ? Math.round((rows.filter((x) => x.hit).length / n) * 100) : null,
    avgPct: r2(avg),
    universeAvgPct: r2(baseAvg),
    baselinePct: r2(baseSide),
    edgePct: num(avg) && num(baseSide) ? r2(avg - baseSide) : null,
    rows,
  };
}

/** The record over many scored lists: overall, and by reason, so the desk learns which reasons paid. */
function record(lists) {
  const all = lists.flatMap((l) => (l.result ? l.result.rows : []));
  const n = all.length;
  const by = new Map();
  for (const r of all) for (const t of new Set(r.tags || [])) {
    const x = by.get(t) || { tag: t, n: 0, hits: 0, sum: 0 };
    x.n += 1;
    x.hits += r.hit ? 1 : 0;
    x.sum += r.movePct;
    by.set(t, x);
  }
  const sessions = lists.filter((l) => l.result && l.result.n);
  return {
    sessions: sessions.length,
    picks: n,
    hitRate: n ? Math.round((all.filter((r) => r.hit).length / n) * 100) : null,
    avgPct: n ? r2(all.reduce((a, r) => a + r.movePct, 0) / n) : null,
    avgEdgePct: sessions.length ? r2(sessions.reduce((a, l) => a + (l.result.edgePct || 0), 0) / sessions.length) : null,
    beatUniverse: sessions.filter((l) => num(l.result.edgePct) && l.result.edgePct > 0).length,
    longs: (() => {
      const xs = all.filter((r) => r.side === "long");
      return { n: xs.length, hitRate: xs.length ? Math.round((xs.filter((r) => r.hit).length / xs.length) * 100) : null, avgPct: xs.length ? r2(xs.reduce((a, r) => a + r.movePct, 0) / xs.length) : null };
    })(),
    shorts: (() => {
      const xs = all.filter((r) => r.side === "short");
      return { n: xs.length, hitRate: xs.length ? Math.round((xs.filter((r) => r.hit).length / xs.length) * 100) : null, avgPct: xs.length ? r2(xs.reduce((a, r) => a + r.movePct, 0) / xs.length) : null };
    })(),
    byReason: [...by.values()].filter((x) => x.n >= 3).map((x) => ({ tag: x.tag, n: x.n, hitRate: Math.round((x.hits / x.n) * 100), avgPct: r2(x.sum / x.n) })).sort((a, b) => b.n - a.n),
  };
}

const TAG_NAME = {
  trend: "Trend (above or below the 20/50/200-day averages)",
  slope: "The 20-day average's slope",
  rs: "Relative strength against the NIFTY",
  breakout: "A close through the 20-day high on volume",
  breakdown: "A close through the 20-day low on volume",
  nearHigh: "Near the 20-day high",
  nearLow: "Near the 20-day low",
  high52: "Near the 52-week high",
  low52: "Near the 52-week low",
  nr7: "Narrowest range in seven sessions",
  inside: "Inside day",
  volume: "Heavy volume, closing at an extreme",
  range: "Enough daily range to trade",
  today: "Today's move against the NIFTY",
  vwap: "VWAP",
  rangePos: "Place in today's range",
  volNow: "Volume so far today",
  gap: "A gap that holds",
  world: "The NSE forecast from the world",
  tide: "The market's tide",
  sector: "Its sector against the NIFTY",
  news: "The news",
  verdict: "The desk's daily verdict",
  liveCall: "The desk's live call",
  odds: "Measured odds (grade A or B)",
  plan: "The intraday plan",
  pulse: "The Live Pulse",
  kb: "The knowledge base's checks",
};

module.exports = { dailyFeatures, liveFeatures, score, deepen, rank, scoreList, record, TAG_NAME, MIN_MARGIN, MAX_PER_SECTOR, ema, rsi };
