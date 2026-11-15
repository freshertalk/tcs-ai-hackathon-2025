"use strict";
// The option chain, read: what the options market says about one NSE stock or index.
//
// From the chain's prices and open interest (Zerodha quotes on the NFO contracts) it works out:
//   implied volatility and delta of every strike (Black-76 on the futures price — no dividend guess)
//   PCR             puts' open interest ÷ calls' (and the same for volume)
//   max pain        the expiry price at which option buyers, together, would collect the least
//   OI walls        the strikes with the most call OI (resistance) and put OI (support)
//   fresh writing   where open interest was added since the last session's last reading
//   build-up        long build-up, short build-up, short covering, long unwinding — futures and options
//   expected move   the ATM straddle (to expiry) and ATM IV scaled to one day
//   skew            out-of-the-money puts' IV against calls'
//   the bias        each of these votes −1…+1 with a weight; the lean is the weighted sum, with the
//                   reasons in plain words. It is ONE factor for the desk's decisions, not a call.
//
// Pure functions: the market service supplies the quotes. No network, no clock, no order.

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const RATE = 0.065; // a short-term rupee rate for discounting
const YEAR_MS = 365 * 86400000;

/* ---------------------------------------------------------------------------- Black-76 */
function ncdf(x) {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
function black76(type, F, K, T, sigma, r = RATE) {
  if (!(F > 0 && K > 0 && T > 0 && sigma > 0)) return null;
  const sd = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  const df = Math.exp(-r * T);
  const price = type === "CE" ? df * (F * ncdf(d1) - K * ncdf(d2)) : df * (K * ncdf(-d2) - F * ncdf(-d1));
  const delta = type === "CE" ? df * ncdf(d1) : -df * ncdf(-d1);
  return { price, delta };
}
/** The volatility that prices the option at `price` (bisection), or null when no volatility can. */
function impliedVol(type, price, F, K, T, r = RATE) {
  if (!(price > 0 && F > 0 && K > 0 && T > 0)) return null;
  const intrinsic = Math.exp(-r * T) * Math.max(0, type === "CE" ? F - K : K - F);
  if (price <= intrinsic + 0.01) return null;
  let lo = 0.005;
  let hi = 4;
  const at = (s) => black76(type, F, K, T, s, r).price;
  if (at(hi) < price) return null;
  for (let i = 0; i < 70; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Years to 3:30 PM IST on the expiry day; never less than an hour. */
function yearsTo(expiry, now) {
  const end = Date.parse(`${expiry}T15:30:00+05:30`);
  return Math.max(3600000, end - now) / YEAR_MS;
}

const buildup = (dPrice, dOi) => {
  if (!num(dPrice) || !num(dOi) || dOi === 0 || dPrice === 0) return null;
  if (dPrice > 0 && dOi > 0) return "long build-up";
  if (dPrice < 0 && dOi > 0) return "short build-up";
  if (dPrice > 0 && dOi < 0) return "short covering";
  return "long unwinding";
};

/**
 * @param spot     the underlying's last price
 * @param future   { last, prevClose, oi, prevOi } of the expiry's future (or the nearest), or null
 * @param expiry   "YYYY-MM-DD"
 * @param now      ms
 * @param lot      lot size
 * @param rows     [{ strike, ce: { last, prevClose, oi, volume, prevOi }, pe: {…} }] (prevOi may be null)
 * @param dayAtrPct the underlying's normal daily range as % (optional, for "near a wall")
 */
function buildOptionChain({ spot, future = null, expiry, now, lot = 1, rows = [], dayAtrPct = null, prevOiAt = null }) {
  if (!(spot > 0) || !rows.length) return { available: false, reason: "No option prices to read." };
  const F = future && future.last > 0 ? future.last : spot;
  const T = yearsTo(expiry, now);
  const daysToExpiry = Math.max(0, Math.round(((Date.parse(`${expiry}T15:30:00+05:30`) - now) / 86400000) * 10) / 10);
  const strikes = rows.map((r) => r.strike).sort((a, b) => a - b);
  const atm = strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0]);
  const hasPrev = rows.some((r) => (r.ce && num(r.ce.prevOi)) || (r.pe && num(r.pe.prevOi)));

  const side = (type, k, q) => {
    if (!q) return null;
    const last = num(q.last) && q.last > 0 ? q.last : null;
    const iv = last ? impliedVol(type, last, F, k, T) : null;
    const g = iv ? black76(type, F, k, T, iv) : null;
    const oiChg = num(q.oi) && num(q.prevOi) ? q.oi - q.prevOi : null;
    const chg = last && num(q.prevClose) && q.prevClose > 0 ? last - q.prevClose : null;
    return { last: r2(last), change: r2(chg), oi: num(q.oi) ? q.oi : null, oiChange: oiChg, volume: num(q.volume) ? q.volume : null, iv: iv ? r1(iv * 100) : null, delta: g ? r2(g.delta) : null, buildup: buildup(chg, oiChg) };
  };
  const table = rows
    .slice()
    .sort((a, b) => a.strike - b.strike)
    .map((r) => ({ strike: r.strike, ce: side("CE", r.strike, r.ce), pe: side("PE", r.strike, r.pe), atm: r.strike === atm }));

  const sum = (f) => table.reduce((s, r) => s + (f(r) || 0), 0);
  const ceOi = sum((r) => r.ce && r.ce.oi);
  const peOi = sum((r) => r.pe && r.pe.oi);
  const ceVol = sum((r) => r.ce && r.ce.volume);
  const peVol = sum((r) => r.pe && r.pe.volume);
  const pcr = ceOi > 0 ? r2(peOi / ceOi) : null;
  const pcrVol = ceVol > 0 ? r2(peVol / ceVol) : null;

  // max pain: the expiry price that pays option buyers the least
  let maxPain = null;
  let least = Infinity;
  for (const P of strikes) {
    let pay = 0;
    for (const r of table) {
      if (r.ce && r.ce.oi) pay += r.ce.oi * Math.max(0, P - r.strike);
      if (r.pe && r.pe.oi) pay += r.pe.oi * Math.max(0, r.strike - P);
    }
    if (pay < least) {
      least = pay;
      maxPain = P;
    }
  }

  const top = (pick, n = 3) =>
    table
      .filter((r) => r[pick] && r[pick].oi > 0)
      .sort((a, b) => b[pick].oi - a[pick].oi)
      .slice(0, n)
      .map((r) => ({ strike: r.strike, oi: r[pick].oi, oiChange: r[pick].oiChange }));
  const callWalls = top("ce");
  const putWalls = top("pe");
  const resistance = callWalls.find((w) => w.strike >= spot) || callWalls[0] || null;
  const support = putWalls.find((w) => w.strike <= spot) || putWalls[0] || null;

  const atmRow = table.find((r) => r.atm);
  const straddle = atmRow && atmRow.ce && atmRow.pe && atmRow.ce.last && atmRow.pe.last ? r2(atmRow.ce.last + atmRow.pe.last) : null;
  const atmIv = atmRow ? (num(atmRow.ce && atmRow.ce.iv) && num(atmRow.pe && atmRow.pe.iv) ? r1((atmRow.ce.iv + atmRow.pe.iv) / 2) : (atmRow.ce && atmRow.ce.iv) || (atmRow.pe && atmRow.pe.iv) || null) : null;
  const dayMove = num(atmIv) ? r2((atmIv / 100) * spot * Math.sqrt(1 / 252)) : null;
  // skew: puts about 4% below against calls about 4% above
  const near = (target, pick) => table.filter((r) => r[pick] && num(r[pick].iv)).sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target))[0];
  const pOtm = near(spot * 0.96, "pe");
  const cOtm = near(spot * 1.04, "ce");
  const skew = pOtm && cOtm ? r1(pOtm.pe.iv - cOtm.ce.iv) : null;

  // fresh writing near the money (ATM ± 4 strikes)
  const i0 = strikes.indexOf(atm);
  const band = new Set(strikes.slice(Math.max(0, i0 - 4), i0 + 5));
  const added = (pick) => (hasPrev ? table.filter((r) => band.has(r.strike) && r[pick] && num(r[pick].oiChange)).reduce((s, r) => s + r[pick].oiChange, 0) : null);
  const ceAdd = added("ce");
  const peAdd = added("pe");

  const fut = future && future.last > 0 ? { last: r2(future.last), changePct: num(future.prevClose) && future.prevClose > 0 ? r2(((future.last - future.prevClose) / future.prevClose) * 100) : null, oi: num(future.oi) ? future.oi : null, oiChange: num(future.oi) && num(future.prevOi) ? future.oi - future.prevOi : null } : null;
  if (fut) fut.buildup = buildup(fut.changePct, fut.oiChange);
  const basis = fut ? r2(fut.last - spot) : null;

  /* ------------------------------------------------------------------------------ the bias */
  const votes = [];
  const add = (id, label, weight, vote, why) => votes.push({ id, label, weight, vote: r2(clamp(vote, -1, 1)), why });
  if (num(pcr)) {
    // more puts written than calls reads as support; an extreme reading is crowded and pulls back
    let v = clamp((pcr - 1) / 0.45, -1, 1);
    if (pcr >= 1.7) v = 0.3;
    if (pcr <= 0.45) v = -0.3;
    add("pcr", "Put-call ratio (OI)", 1.5, v, `PCR ${pcr}${pcr >= 1.7 ? " — very high: crowded, so only mildly supportive" : pcr <= 0.45 ? " — very low: crowded, so only mildly weak" : pcr >= 1.1 ? ": puts written more than calls — support below" : pcr <= 0.85 ? ": calls written more than puts — a ceiling above" : ": balanced"}`);
  }
  if (num(ceAdd) && num(peAdd) && (Math.abs(ceAdd) + Math.abs(peAdd)) > 0) {
    const tot = Math.abs(ceAdd) + Math.abs(peAdd);
    add("writing", "Fresh writing near the money", 1.5, (peAdd - ceAdd) / tot, `since the last session: put OI ${peAdd >= 0 ? "+" : ""}${Math.round(peAdd).toLocaleString("en-IN")}, call OI ${ceAdd >= 0 ? "+" : ""}${Math.round(ceAdd).toLocaleString("en-IN")} around the money — ${peAdd > ceAdd ? "put writers adding (supportive)" : "call writers adding (capping)"}`);
  }
  if (fut && fut.buildup) {
    const v = { "long build-up": 0.8, "short covering": 0.4, "long unwinding": -0.4, "short build-up": -0.8 }[fut.buildup];
    add("futures", "Futures build-up", 1.2, v, `futures ${fut.changePct >= 0 ? "+" : ""}${fut.changePct}% with OI ${fut.oiChange >= 0 ? "up" : "down"}: ${fut.buildup}`);
  }
  if (resistance && support && resistance.strike > support.strike) {
    const room = (resistance.strike - spot) / (resistance.strike - support.strike); // 1 = at support, 0 = at the call wall
    add("walls", "Room between the OI walls", 1, clamp((room - 0.5) * 1.6, -1, 1), `support (put wall) ₹${support.strike}, resistance (call wall) ₹${resistance.strike}; price is ${Math.round(room * 100)}% of the way down from the call wall`);
  }
  if (num(maxPain) && daysToExpiry <= 5) {
    const gap = (maxPain - spot) / spot;
    add("maxpain", "Pull toward max pain", 0.6 * (1 - daysToExpiry / 6), clamp(gap * 40, -1, 1), `max pain ₹${maxPain} with ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"} to expiry — prices often drift toward it into expiry`);
  }
  const wsum = votes.reduce((s, v) => s + v.weight, 0);
  const lean = wsum ? votes.reduce((s, v) => s + v.vote * v.weight, 0) / wsum : 0;
  const score = Math.round(lean * 100);
  const label = score >= 25 ? "Bullish" : score >= 10 ? "Mildly bullish" : score <= -25 ? "Bearish" : score <= -10 ? "Mildly bearish" : "Neutral";
  const cautions = [];
  if (num(atmIv) && atmIv >= 35) cautions.push(`ATM implied volatility is ${atmIv}%: the options market expects wide swings — smaller size, wider stops.`);
  if (num(skew) && skew >= 6) cautions.push(`Puts are priced ${skew} volatility points above calls: traders are paying up for downside protection.`);
  if (daysToExpiry <= 1) cautions.push("Expiry is today or tomorrow: option-driven moves (pinning near big strikes, sharp swings late) are common.");
  if (!hasPrev) cautions.push("No earlier reading of open interest is saved yet, so OI changes and build-ups are not shown. They appear from the next session.");

  const nearWall = (w) => (w && num(dayAtrPct) ? Math.abs(w.strike - spot) / spot <= (dayAtrPct / 100) * 0.5 : false);
  return {
    available: true,
    expiry,
    daysToExpiry,
    spot: r2(spot),
    future: fut,
    basis,
    lot,
    atm,
    pcr,
    pcrVol,
    maxPain,
    callWalls,
    putWalls,
    resistance,
    support,
    nearResistance: nearWall(resistance),
    nearSupport: nearWall(support),
    straddle,
    expectedMove: { toExpiry: straddle, low: straddle ? r2(spot - straddle) : null, high: straddle ? r2(spot + straddle) : null, day: dayMove },
    atmIv,
    skew,
    freshWriting: { ce: ceAdd, pe: peAdd },
    oiChangeSince: hasPrev ? prevOiAt : null,
    bias: { score, label, votes, cautions },
    rows: table,
    rule: "Implied volatility and delta from Black-76 on the futures price (6.5% rate). PCR = puts' OI ÷ calls' OI over the strikes shown. Max pain = the expiry price paying option buyers the least. Walls = the strikes with the most OI. Fresh writing = OI added since the last reading of the previous session, ATM ± 4 strikes. The bias weighs PCR 1.5, fresh writing 1.5, futures build-up 1.2, room between the walls 1, and the pull toward max pain (only within 5 days of expiry). One factor among many — not a call.",
  };
}

module.exports = { buildOptionChain, impliedVol, black76, yearsTo, buildup, ncdf };
