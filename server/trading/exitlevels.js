"use strict";
// Exit levels: the desk's level map, and the check every AI-suggested level has to pass.
//
// The AI Engine is asked to research where an open intraday position should be exited — the levels
// to take profit at and the level whose break proves the trade wrong. A model is good at weighing
// evidence and bad at remembering numbers, so the numbers never come from it:
//
//   MAP      `levelMap` works out every price level that exists in the desk's own data at this
//            moment: today's high, low and open, the opening range, VWAP, the previous day's high,
//            low and close and the floor pivots from them, the highs and lows of the last 5 and 20
//            days, today's swing highs and lows on 5-minute bars, the busiest price of the day
//            (most volume), the nearest round numbers, the wall of orders in the book, the edges of
//            the Live Pulse's window, the desk's ladder, the 5-minute Bollinger bands, the entry and
//            the best price since it. Where the level learner has a record for that kind of level
//            (how often it held when tested), the level carries it.
//            Levels that sit together are merged into one stronger level. Each gets an id
//            (A1, A2 … above the price, B1, B2 … below it) and the no-trend odds of a touch before
//            the square-off, from today's one-minute moves.
//   CHOOSE   the model picks levels BY ID from that map (server/ai/exitadvisor.js).
//   CHECK    `verify` takes the answer apart: an id that is not on the map is thrown out; the price
//            shown is the desk's, whatever the model wrote; a target has to lie beyond the price in
//            the trade's direction, be worth more than the costs and be within reach before 3:15;
//            a stop has to lie on the losing side and is never further away than the coach's own
//            stop. What fails is left out and listed with the reason.
//   SCORE    `track` marks a level the moment the price reaches it; `settle` reads the rest of the
//            day's 1-minute bars after the close and says which came first, the target or the
//            stop — the AI's track record on this desk is counted from that, never assumed.
//
// Pure arithmetic: no AI, no network, no timer, no order.

const { bollinger } = require("../market/tape");
const { squareOffAt, clockAt } = require("../market/session");

const IST = 5.5 * 3600 * 1000;
const TICK = 0.05;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const onTick = (x) => (num(x) ? Math.round(Math.round(x / TICK) * TICK * 100) / 100 : null);
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);

// how much one source counts when levels are merged, and how it is named
const WEIGHT = { "day-high": 3, "day-low": 3, "prev-high": 3, "prev-low": 3, "prev-close": 2, vwap: 3, "n-day": 3, swing: 2, "opening-range": 2, pivot: 2, volume: 2, wall: 2, ladder: 2, open: 1, round: 1, pulse: 1, entry: 1, peak: 1, bollinger: 1 };
const MAX_AWAY = 0.03; // levels further than 3% from the price are no use to an intraday exit
const PER_SIDE = 10;

/** Two names for one thing ("Today's high" and the ladder's "Day high") are one name. */
const sameName = (label) =>
  String(label)
    .toLowerCase()
    .replace(/today's/g, "day")
    .replace(/previous day('s)?/g, "previous")
    .replace(/^pivot (?=[rs]\d)/, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

/** The normal distribution's cumulative function (Abramowitz–Stegun 26.2.17). */
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * The odds, in percent, that a price which moves `sigma1` rupees a minute with no trend touches a
 * level `dist` rupees away within `minutes` (the reflection principle). An arithmetic yardstick for
 * "is it within reach today", not a forecast.
 */
function touchOdds(dist, sigma1, minutes) {
  if (!num(dist) || !num(sigma1) || !num(minutes) || sigma1 <= 0 || minutes <= 0) return null;
  if (dist <= 0) return 100;
  return Math.round(Math.max(0, Math.min(1, 2 * (1 - phi(dist / (sigma1 * Math.sqrt(minutes)))))) * 100);
}

/** A round-number step for a price: the "nice" number nearest to half a percent of it. */
function roundStep(price) {
  const want = price * 0.005;
  return [0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500].reduce((best, s) => (Math.abs(Math.log(s / want)) < Math.abs(Math.log(best / want)) ? s : best), 0.5);
}

/** 1-minute bars folded into 5-minute bars (on the IST clock). */
function fiveMinute(bars) {
  const out = [];
  for (const b of bars) {
    const k = Math.floor(b.t / 300000) * 300000;
    const cur = out[out.length - 1];
    if (cur && cur.t === k) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += num(b.v) ? b.v : 0;
    } else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: num(b.v) ? b.v : 0 });
  }
  return out;
}

/** How a 1-minute price moves: the standard deviation of the last hour's minute-to-minute changes, in rupees. */
function sigmaOf(bars, last) {
  const floor = num(last) ? last * 0.0003 : 0; // a stock is never quieter than this for the purpose of the yardstick
  const cl = bars.slice(-61).map((b) => b.c);
  if (cl.length < 12) {
    const rg = bars.slice(-20);
    const avg = rg.length ? rg.reduce((a, b) => a + (b.h - b.l), 0) / rg.length : null;
    return num(avg) && avg > 0 ? Math.max(avg / 1.6, floor) : num(last) ? last * 0.0006 : null;
  }
  const d = [];
  for (let i = 1; i < cl.length; i += 1) d.push(cl[i] - cl[i - 1]);
  const mean = d.reduce((a, x) => a + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, x) => a + (x - mean) ** 2, 0) / d.length);
  return Math.max(sd, floor) || null;
}

/**
 * Every level the desk's data holds around the price, merged and numbered.
 * @param pos   { side, avg, entryAt }
 * @param bars  today's 1-minute bars [{ t, o, h, l, c, v }], oldest first, up to now
 * @param opts  { now, last, daily: [{ t, o, h, l, c }] (earlier days, oldest first), ladder: [{ label, price }],
 *                vwap, wall: { side, price, qty }, pulse: { window: { low, high } }, peak, squareOffAt,
 *                learned(sources) → { pct, n, scope, name, hour } — the level learner's record, when there is one }
 * @returns { at, last, sigma1, minutesLeft, anchors: [{ id, price, label, sources, strength, side, awayPct, touches, touchPct, held }] }
 */
function levelMap(pos, bars, opts = {}) {
  const now = opts.now || Date.now();
  const today = bars.filter((b) => b.t <= now);
  const last = num(opts.last) ? opts.last : today.length ? today[today.length - 1].c : pos.avg;
  const raw = [];
  const put = (price, source, label) => {
    if (num(price) && price > 0 && Math.abs(price - last) / last <= MAX_AWAY) raw.push({ price, source, label });
  };

  if (today.length) {
    const hi = today.reduce((m, b) => Math.max(m, b.h), -Infinity);
    const lo = today.reduce((m, b) => Math.min(m, b.l), Infinity);
    put(hi, "day-high", "Today's high");
    put(lo, "day-low", "Today's low");
    put(today[0].o, "open", "Today's open");
    const first = today.filter((b) => b.t < today[0].t + 15 * 60000);
    if (today[today.length - 1].t >= today[0].t + 15 * 60000 && first.length) {
      put(first.reduce((m, b) => Math.max(m, b.h), -Infinity), "opening-range", "Opening-range high");
      put(first.reduce((m, b) => Math.min(m, b.l), Infinity), "opening-range", "Opening-range low");
    }
    // swing highs and lows on completed 5-minute bars: a bar that stands above (below) two on each side
    const five = fiveMinute(today).filter((b) => b.t + 300000 <= now);
    const sw = [];
    for (let i = 2; i < five.length - 2; i += 1) {
      const b = five[i];
      const around = [five[i - 2], five[i - 1], five[i + 1], five[i + 2]];
      if (around.every((x) => b.h >= x.h) && around.some((x) => b.h > x.h)) sw.push({ price: b.h, label: `Swing high ${clock(b.t)}` });
      if (around.every((x) => b.l <= x.l) && around.some((x) => b.l < x.l)) sw.push({ price: b.l, label: `Swing low ${clock(b.t)}` });
    }
    sw.slice(-8).forEach((x) => put(x.price, "swing", x.label));
    // the 5-minute Bollinger bands (20 bars, 2 deviations) as they stand now
    const bb = bollinger(five.map((b) => b.c));
    if (bb) {
      put(bb.upper, "bollinger", "Upper Bollinger band (5-min)");
      put(bb.lower, "bollinger", "Lower Bollinger band (5-min)");
    }
    // the busiest price of the day: the price band that has traded the most volume
    const bin = Math.max(TICK, last * 0.001);
    const vol = new Map();
    for (const b of today) {
      const k = Math.round((b.h + b.l + b.c) / 3 / bin);
      vol.set(k, (vol.get(k) || 0) + (num(b.v) && b.v > 0 ? b.v : 0));
    }
    const top = [...vol.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0 && today.length >= 20) put(top[0] * bin, "volume", "Busiest price today");
  }
  put(opts.vwap, "vwap", "VWAP");

  const day = istDate(now);
  const daily = (opts.daily || []).filter((c) => c && num(c.h) && num(c.l) && num(c.c) && String(c.t).slice(0, 10) < day);
  const prev = daily[daily.length - 1];
  if (prev) {
    put(prev.h, "prev-high", "Previous day's high");
    put(prev.l, "prev-low", "Previous day's low");
    put(prev.c, "prev-close", "Previous day's close");
    const p = (prev.h + prev.l + prev.c) / 3;
    put(p, "pivot", "Pivot");
    put(2 * p - prev.l, "pivot", "Pivot R1");
    put(2 * p - prev.h, "pivot", "Pivot S1");
    put(p + (prev.h - prev.l), "pivot", "Pivot R2");
    put(p - (prev.h - prev.l), "pivot", "Pivot S2");
    for (const n of [5, 20]) {
      const w = daily.slice(-n);
      if (w.length < n) continue;
      put(w.reduce((m, c) => Math.max(m, c.h), -Infinity), "n-day", `${n}-day high`);
      put(w.reduce((m, c) => Math.min(m, c.l), Infinity), "n-day", `${n}-day low`);
    }
  }

  const step = roundStep(last);
  put(Math.ceil((last * 1.0002) / step) * step, "round", `Round number`);
  put(Math.floor((last * 0.9998) / step) * step, "round", `Round number`);
  if (opts.wall && num(opts.wall.price)) put(opts.wall.price, "wall", `Wall of ${/ask|sell/i.test(String(opts.wall.side)) ? "sell" : "buy"} orders${num(opts.wall.qty) ? ` (${Math.round(opts.wall.qty).toLocaleString("en-IN")})` : ""}`);
  const win = opts.pulse && opts.pulse.window;
  if (win) {
    put(win.high, "pulse", "Top of the pulse's window (next 15–30 min)");
    put(win.low, "pulse", "Bottom of the pulse's window (next 15–30 min)");
  }
  for (const l of opts.ladder || []) if (!/^last (price|close)$/i.test(String(l.label))) put(l.price, "ladder", str(l.label, 40) || "Desk level");
  put(pos.avg, "entry", "Your entry");
  if (num(opts.peak) && Math.abs(opts.peak - pos.avg) / pos.avg > 0.0005) put(opts.peak, "peak", "Best price since the entry");

  // levels that sit together are one level: the heaviest source gives the price, the names are joined
  raw.sort((a, b) => a.price - b.price);
  const tol = Math.max(TICK * 2, last * 0.0008);
  const groups = [];
  for (const x of raw) {
    const g = groups[groups.length - 1];
    if (g && x.price - g.items[g.items.length - 1].price <= tol && x.price - g.items[0].price <= tol * 2) g.items.push(x);
    else groups.push({ items: [x] });
  }
  const touchesOf = (price) => {
    // how many separate times today's bars turned within reach of the level
    let n = 0;
    let inside = false;
    for (const b of today) {
      const near = b.l - tol <= price && b.h + tol >= price;
      if (near && !inside) n += 1;
      inside = near;
    }
    return n;
  };
  const sigma1 = sigmaOf(today, last);
  // the broker's square-off for this stock on this day (market/session.js); a closing-auction stock unless told otherwise
  const sqAt = opts.squareOffAt || squareOffAt(now, { cas: opts.cas !== false });
  const minutesLeft = Math.max(0, Math.round((sqAt - now) / 60000));
  let merged = groups.map((g) => {
    const best = g.items.slice().sort((a, b) => (WEIGHT[b.source] || 1) - (WEIGHT[a.source] || 1))[0];
    const sources = [...new Set(g.items.map((i) => i.source))];
    const labels = [];
    const named = new Set();
    for (const i of g.items.slice().sort((a, b) => (WEIGHT[b.source] || 1) - (WEIGHT[a.source] || 1))) {
      const k = sameName(i.label) || i.label;
      if (named.has(k)) continue;
      named.add(k);
      labels.push(i.label);
    }
    const price = onTick(best.price);
    return {
      price,
      label: labels.slice(0, 3).join(" + "),
      sources,
      strength: Math.min(9, sources.reduce((a, s) => a + (WEIGHT[s] || 1), 0)),
      side: price > last ? "above" : "below",
      awayPct: r2(((price - last) / last) * 100),
      touches: touchesOf(price),
      touchPct: touchOdds(Math.abs(price - last), sigma1, minutesLeft),
      // what levels of this kind have done before, counted by the level learner (trading/levellearn.js)
      held: typeof opts.learned === "function" ? opts.learned(sources) || null : null,
    };
  });
  merged = merged.filter((a) => Math.abs(a.price - last) >= TICK);
  const above = merged.filter((a) => a.side === "above").sort((a, b) => a.price - b.price).slice(0, PER_SIDE);
  const below = merged.filter((a) => a.side === "below").sort((a, b) => b.price - a.price).slice(0, PER_SIDE);
  above.forEach((a, i) => (a.id = `A${i + 1}`));
  below.forEach((a, i) => (a.id = `B${i + 1}`));
  return { at: now, last: r2(last), sigma1: num(sigma1) ? Math.round(sigma1 * 1000) / 1000 : null, minutesLeft, anchors: [...above.slice().reverse(), ...below] };
}

/**
 * The check on the AI's answer. Nothing it says about a price is taken on trust.
 * @param answer { targets: [{ anchor, price, why }], stop: { anchor, price, why }, reversal: { anchor, sign } }
 * @param map    what `levelMap` returned — the same map the model was shown
 * @param pos    { side, avg }
 * @param opts   { last (now), coachStop, unit (the stock's own step, ₹), costPct = 0.06 }
 * @returns { targets, stop, reversal, rejected: [{ what, price, why }], checks: { asked, passed, corrected } }
 */
function verify(answer, map, pos, opts = {}) {
  const s = pos.side === "short" ? -1 : 1;
  const last = num(opts.last) ? opts.last : map.last;
  const unit = num(opts.unit) && opts.unit > 0 ? opts.unit : last * 0.004;
  const costPct = num(opts.costPct) ? opts.costPct : 0.06;
  const byId = new Map(map.anchors.map((a) => [a.id, a]));
  const rejected = [];
  let asked = 0;
  let corrected = 0;
  const find = (x, what) => {
    asked += 1;
    const id = str(x && x.anchor, 8).toUpperCase();
    const a = byId.get(id);
    const said = num(x && x.price) ? r2(x.price) : null;
    if (!a) {
      rejected.push({ what, price: said, why: id ? `“${id}” is not a level on the desk's map.` : "No level from the desk's map was named." });
      return null;
    }
    if (said !== null && Math.abs(said - a.price) / a.price > 0.01) {
      rejected.push({ what, price: said, why: `It quoted ₹${said.toFixed(2)} for ${a.label}, which is ₹${a.price.toFixed(2)} on the desk's data.` });
      return null;
    }
    if (said !== null && Math.abs(said - a.price) > TICK * 2) corrected += 1; // the desk's price is the one shown
    return a;
  };

  /* ---- the stop first: the reward of a target is measured against it */
  let stop = null;
  const coachStop = num(opts.coachStop) ? opts.coachStop : null;
  const wantsCoach = /^coach/i.test(str(answer && answer.stop && answer.stop.anchor, 12));
  const sa = wantsCoach ? null : find(answer && answer.stop, "stop");
  if (wantsCoach) asked += 1;
  if (sa) {
    const buffer = Math.max(TICK * 2, unit * 0.15);
    const px = onTick(sa.price - s * buffer); // just beyond the level, so a touch of it does not take the trade out
    if (s * (last - px) <= 0) rejected.push({ what: "stop", price: sa.price, why: `${sa.label} ₹${sa.price.toFixed(2)} is on the wrong side of the price for a stop.` });
    else if (coachStop !== null && s * (coachStop - px) > 0) {
      stop = { anchor: sa.id, label: sa.label, level: sa.price, price: coachStop, clamped: true, note: `The AI's level (${sa.label} ₹${sa.price.toFixed(2)}) is further away than the coach's stop. A stop is only ever moved towards the price, so the coach's ₹${coachStop.toFixed(2)} stands.` };
    } else {
      stop = { anchor: sa.id, label: sa.label, level: sa.price, price: px, clamped: false, note: Math.abs(last - px) < unit * 0.35 ? "Inside the stock's one-minute noise: a wobble can hit it." : "" };
    }
  }
  if (!stop && coachStop !== null && s * (last - coachStop) > 0) stop = { anchor: "coach", label: "The coach's stop", level: coachStop, price: coachStop, clamped: false, note: wantsCoach ? "" : "No level from the AI passed for the stop: the coach's stop stands." };
  if (stop) {
    Object.assign(stop, {
      why: str(answer && answer.stop && answer.stop.why, 240),
      awayPct: r2(((stop.price - last) / last) * 100),
      touchPct: touchOdds(Math.abs(last - stop.price), map.sigma1, map.minutesLeft),
      tight: Math.abs(last - stop.price) < unit * 0.35,
      status: "open",
      hitAt: null,
    });
  }

  /* ---- the targets */
  const targets = [];
  const seen = new Set();
  for (const x of Array.isArray(answer && answer.targets) ? answer.targets.slice(0, 4) : []) {
    const a = find(x, "target");
    if (!a) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const dist = s * (a.price - last);
    if (dist <= last * 0.0005) {
      rejected.push({ what: "target", price: a.price, why: `${a.label} ₹${a.price.toFixed(2)} is not ahead of the price in the trade's direction.` });
      continue;
    }
    if ((dist / last) * 100 < costPct + 0.04) {
      rejected.push({ what: "target", price: a.price, why: `${a.label} ₹${a.price.toFixed(2)} is closer than the costs of the trade: not worth waiting for.` });
      continue;
    }
    if (num(a.touchPct) && a.touchPct < 8) {
      rejected.push({ what: "target", price: a.price, why: `${a.label} ₹${a.price.toFixed(2)} is out of reach before ${clockAt(map.at + map.minutesLeft * 60000)} on today's movement (about ${a.touchPct}% odds of a touch with no trend).` });
      continue;
    }
    const front = Math.max(TICK, Math.min(unit * 0.1, a.price * 0.0004)); // a limit a touch before the level gets filled when the level holds
    const risk = stop ? s * (last - stop.price) : null;
    targets.push({
      anchor: a.id,
      label: a.label,
      level: a.price,
      price: onTick(a.price - s * front),
      strength: a.strength,
      touches: a.touches,
      held: a.held || null,
      awayPct: r2(((a.price - last) / last) * 100),
      gainPct: r2(((s * (a.price - pos.avg)) / pos.avg) * 100),
      touchPct: a.touchPct,
      reach: !num(a.touchPct) ? null : a.touchPct >= 25 ? "within reach" : "a stretch",
      r: num(risk) && risk > 0 ? r1(dist / risk) : null,
      firstPct: num(risk) && risk > 0 ? Math.round((risk / (risk + dist)) * 100) : null, // no trend: the odds it comes before the stop
      why: str(x.why, 240),
      status: "open",
      reachedAt: null,
    });
  }
  targets.sort((a, b) => s * (a.level - b.level));
  targets.splice(2);
  targets.forEach((t, i) => (t.n = i + 1));

  /* ---- where a turn is most likely before the target */
  let reversal = null;
  const ra = byId.get(str(answer && answer.reversal && answer.reversal.anchor, 8).toUpperCase());
  if (ra) reversal = { anchor: ra.id, label: ra.label, price: ra.price, sign: str(answer.reversal.sign, 240) };

  const stopPassed = Boolean(stop) && (stop.anchor === "coach" ? wantsCoach : !stop.clamped);
  const passed = targets.length + (stopPassed ? 1 : 0);
  return { targets, stop, reversal, rejected, checks: { asked, passed, corrected } };
}

/**
 * Has the price reached a level? Called on every look with the last price (or with a bar's high
 * and low in a replay). Marks the set in place and returns what changed just now.
 * @returns [{ kind: "target" | "stop", n, price }]
 */
function track(set, pos, { last, high, low, now }) {
  if (!set) return [];
  const s = pos.side === "short" ? -1 : 1;
  const best = s > 0 ? (num(high) ? high : last) : num(low) ? low : last;
  const worst = s > 0 ? (num(low) ? low : last) : num(high) ? high : last;
  const out = [];
  const stopLive = set.stop && set.stop.status === "open";
  if (stopLive && num(worst) && s * (worst - set.stop.price) <= 0) {
    Object.assign(set.stop, { status: "hit", hitAt: now });
    out.push({ kind: "stop", n: 0, price: set.stop.price });
  }
  for (const t of set.targets || []) {
    if (t.status !== "open" || !num(best)) continue;
    if (s * (best - t.level) < 0) continue;
    // a target that comes after the stop (or in the same bar as it) does not count: the unkind reading
    const after = Boolean(set.stop && set.stop.status === "hit");
    Object.assign(t, { status: after ? "after-stop" : "reached", reachedAt: now });
    out.push({ kind: "target", n: t.n, price: t.level, after });
  }
  return out;
}

/**
 * After the close: the rest of the day's 1-minute bars, read against a set of levels that was still
 * open — which came first, each target or the stop?
 * @returns { t1, t2, stop, judged } where t1 / t2 are "reached" | "stopped" | "neither" | null
 */
function settle(set, pos, bars) {
  const copy = { targets: (set.targets || []).map((t) => ({ ...t })), stop: set.stop ? { ...set.stop } : null };
  for (const b of bars.filter((x) => x.t >= set.at - 60000).sort((a, b2) => a.t - b2.t)) track(copy, pos, { last: b.c, high: b.h, low: b.l, now: b.t + 60000 });
  const word = (t) => (!t ? null : t.status === "reached" ? "reached" : t.status === "after-stop" || (copy.stop && copy.stop.status === "hit") ? "stopped" : "neither");
  const t1 = copy.targets[0] || null;
  const t2 = copy.targets[1] || null;
  return {
    t1: word(t1),
    t1At: t1 && t1.reachedAt ? t1.reachedAt : null,
    t2: word(t2),
    t2At: t2 && t2.reachedAt ? t2.reachedAt : null,
    stop: copy.stop ? copy.stop.status : null,
    stopAt: copy.stop && copy.stop.hitAt ? copy.stop.hitAt : null,
    judged: Boolean(t1),
  };
}

/** The AI's record on this desk from the settled sets: how often its targets came before its stop. */
function record(rows) {
  const xs = (rows || []).filter((r) => r && r.t1);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const t1 = xs.filter((r) => r.t1 === "reached").length;
  const with2 = xs.filter((r) => r.t2);
  const t2 = with2.filter((r) => r.t2 === "reached").length;
  const stopped = xs.filter((r) => r.t1 === "stopped").length;
  return {
    judged: xs.length,
    enough: xs.length >= 10,
    t1Reached: t1,
    t1Pct: pct(t1, xs.length),
    t2Given: with2.length,
    t2Reached: t2,
    t2Pct: pct(t2, with2.length),
    stoppedFirst: stopped,
    neither: xs.length - t1 - stopped,
    text: !xs.length
      ? "No AI level has been scored yet: each set is scored after the close, on the day's 1-minute bars."
      : `First target reached before the stop on ${t1} of ${xs.length} sets (${pct(t1, xs.length)}%)${with2.length ? `; second target on ${t2} of ${with2.length}` : ""}; the stop came first on ${stopped}.${xs.length < 10 ? " Too few to judge yet." : ""}`,
  };
}

module.exports = { levelMap, verify, track, settle, record, touchOdds, fiveMinute, roundStep, sigmaOf };
