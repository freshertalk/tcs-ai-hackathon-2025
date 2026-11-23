"use strict";
// The trade setup (23 Nov 2026): the fifteen readings Indian desks look at before and during a session — worked out by the desk
// itself from Zerodha's data and NSE's public files, with no AI and no manual refresh.
//
//    1–2  KEY LEVELS        NIFTY 50 and NIFTY BANK: the classic floor-trader pivots from the last session's high, low and close
//                           (pivot, three supports, three resistances), beside the option chain's walls and max pain
//    3–6  OPTIONS           for NIFTY and BANKNIFTY calls and puts: the strikes with the most open interest, the most OI added
//                           and the most OI shed since the last session (where writers are building and leaving)
//    7    FUNDS FLOW        FII/FPI and DII net buying in the cash market, ₹ crore (NSE's public report, after the close)
//    8    PUT-CALL RATIO    NIFTY's and BANKNIFTY's PCR on open interest, near expiry
//    9    INDIA VIX         its level and change
//   10–13 BUILD-UPS         every F&O stock's near-month future: price change against open-interest change — LONG BUILD-UP
//                           (price up, OI up), LONG UNWINDING (down, down), SHORT BUILD-UP (down, up), SHORT COVERING (up, down)
//   14    HIGH DELIVERY     F&O stocks whose delivered share of the last session's volume was well above their own average
//   15    F&O BAN           the securities in NSE's ban period today (no new positions; only reducing ones)
//
// From them THE SETUP LEAN: each reading votes −1…+1 with a weight (the same way the option chain's bias does) — NIFTY against
// its pivot, PCR, the option writing, VIX, the funds flow, and the BREADTH of the build-ups across all F&O stocks. It is a lean
// with its reasons, recorded every day and scored against what NIFTY then did, so its record says how far to trust it.
//
// Pure arithmetic: no network, no clock, no records.

const { buildup } = require("./options");

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

const FULL_WEIGHT = 6.3; // every reading in: pivot 1.2 + options 1.5 + breadth 1.3 + flows 0.9 + VIX 0.8 + BANKNIFTY 0.6

/** Classic floor-trader pivots from one session's high, low and close. */
function pivots({ h, l, c } = {}) {
  if (![h, l, c].every(num) || h < l || h <= 0) return null;
  const p = (h + l + c) / 3;
  return { pivot: r2(p), r1: r2(2 * p - l), r2: r2(p + (h - l)), r3: r2(h + 2 * (p - l)), s1: r2(2 * p - h), s2: r2(p - (h - l)), s3: r2(l - 2 * (h - p)), prevHigh: r2(h), prevLow: r2(l), prevClose: r2(c) };
}

/**
 * Key levels for an index: the pivots, the nearest two supports and resistances around the price, and the option walls.
 * @param prev  the last finished session { h, l, c }   @param spot the price now (or the last close)   @param chain the option chain (options.js) or null
 */
function keyLevels({ name, prev, spot, chain = null }) {
  const pv = pivots(prev);
  if (!pv) return { name, available: false, reason: "No finished session to work the pivots from." };
  const px = num(spot) && spot > 0 ? spot : pv.prevClose;
  const lv = [
    ["S3", pv.s3], ["S2", pv.s2], ["S1", pv.s1], ["Pivot", pv.pivot], ["R1", pv.r1], ["R2", pv.r2], ["R3", pv.r3],
  ];
  const supports = lv.filter(([, v]) => v < px).reverse().slice(0, 3).map(([k, v]) => ({ name: k, price: v }));
  const resistances = lv.filter(([, v]) => v > px).slice(0, 3).map(([k, v]) => ({ name: k, price: v }));
  const walls = chain && chain.available ? { put: chain.support ? chain.support.strike : null, call: chain.resistance ? chain.resistance.strike : null, maxPain: chain.maxPain ?? null } : null;
  const side = px >= pv.pivot ? "above" : "below";
  const read = `${name} ${side} its pivot ₹${pv.pivot.toLocaleString("en-IN")}: support ${supports.slice(0, 2).map((x) => `₹${x.price.toLocaleString("en-IN")} (${x.name})`).join(", ") || "—"}; resistance ${resistances.slice(0, 2).map((x) => `₹${x.price.toLocaleString("en-IN")} (${x.name})`).join(", ") || "—"}${walls && walls.put && walls.call ? `; option walls: puts at ${walls.put}, calls at ${walls.call}` : ""}.`;
  return { name, available: true, spot: r2(px), ...pv, side, supports, resistances, walls, read };
}

/** Options data for one side ("ce" calls, "pe" puts) of a chain: most OI, most OI added, most OI shed. */
function optionSide(chain, side) {
  if (!chain || !chain.available || !Array.isArray(chain.rows)) return null;
  const legs = chain.rows.filter((r) => r[side] && num(r[side].oi)).map((r) => ({ strike: r.strike, oi: r[side].oi, oiChange: num(r[side].oiChange) ? r[side].oiChange : null, last: r[side].last }));
  if (!legs.length) return null;
  const byOi = [...legs].sort((a, b) => b.oi - a.oi).slice(0, 3);
  const withChg = legs.filter((x) => num(x.oiChange));
  const added = [...withChg].filter((x) => x.oiChange > 0).sort((a, b) => b.oiChange - a.oiChange).slice(0, 3);
  const shed = [...withChg].filter((x) => x.oiChange < 0).sort((a, b) => a.oiChange - b.oiChange).slice(0, 3);
  const total = legs.reduce((s, x) => s + x.oi, 0);
  const lots = (n) => (num(chain.lot) && chain.lot > 0 ? Math.round(n / chain.lot) : null);
  const kind = side === "ce" ? "call" : "put";
  const read =
    `Most ${kind} OI at ${byOi.map((x) => x.strike).join(", ")}` +
    (added.length ? `; most ${kind} writing (OI added) at ${added.map((x) => x.strike).join(", ")}` : "") +
    (shed.length ? `; most ${kind} unwinding at ${shed.map((x) => x.strike).join(", ")}` : "") +
    (side === "ce" ? " — calls written are a ceiling above." : " — puts written are a floor below.");
  return { side: kind, expiry: chain.expiry, totalOi: total, maxOi: byOi.map((x) => ({ ...x, lots: lots(x.oi) })), maxAdded: added, maxShed: shed, changeKnown: withChg.length > 0, read };
}

/**
 * The build-ups across F&O stocks. rows: { symbol, last, prevClose, oi, prevOi }.
 * @returns { counts, lists: { "long build-up": [...], … }, breadth (−1…+1: the share of OI-backed buying minus selling) }
 */
function buildups(rows, { top = 15 } = {}) {
  const KINDS = ["long build-up", "long unwinding", "short build-up", "short covering"];
  const lists = Object.fromEntries(KINDS.map((k) => [k, []]));
  let known = 0;
  for (const r of rows || []) {
    if (!r || !num(r.last) || !num(r.prevClose) || r.prevClose <= 0 || !num(r.oi) || !num(r.prevOi) || r.prevOi <= 0) continue;
    const changePct = ((r.last - r.prevClose) / r.prevClose) * 100;
    const oiChangePct = ((r.oi - r.prevOi) / r.prevOi) * 100;
    const kind = buildup(changePct, r.oi - r.prevOi);
    known += 1;
    if (!kind || !lists[kind]) continue;
    lists[kind].push({ symbol: r.symbol, last: r2(r.last), changePct: r2(changePct), oi: r.oi, oiChangePct: r2(oiChangePct) });
  }
  // the strongest first: the biggest OI change (that is what makes a build-up a build-up)
  for (const k of KINDS) lists[k].sort((a, b) => Math.abs(b.oiChangePct) - Math.abs(a.oiChangePct));
  const counts = Object.fromEntries(KINDS.map((k) => [k, lists[k].length]));
  const bull = counts["long build-up"] + 0.5 * counts["short covering"];
  const bear = counts["short build-up"] + 0.5 * counts["long unwinding"];
  const breadth = bull + bear > 0 ? r2((bull - bear) / (bull + bear)) : null;
  return { known, counts, breadth, lists: Object.fromEntries(KINDS.map((k) => [k, lists[k].slice(0, top)])), all: Object.fromEntries(KINDS.flatMap((k) => lists[k].map((x) => [x.symbol, { kind: k, changePct: x.changePct, oiChangePct: x.oiChangePct }]))) };
}

/** NSE's FII/DII report rows → { fii, dii, date } in ₹ crore. */
function flowsOf(list) {
  if (!Array.isArray(list)) return null;
  const pick = (re) => list.find((x) => x && re.test(String(x.category || "")));
  const f = pick(/FII|FPI/i);
  const d = pick(/DII/i);
  const n = (x, k) => (x && x[k] != null && Number.isFinite(Number(String(x[k]).replace(/,/g, ""))) ? Number(String(x[k]).replace(/,/g, "")) : null);
  if (!f && !d) return null;
  return {
    date: (f && f.date) || (d && d.date) || null,
    fii: f ? { buy: n(f, "buyValue"), sell: n(f, "sellValue"), net: n(f, "netValue") } : null,
    dii: d ? { buy: n(d, "buyValue"), sell: n(d, "sellValue"), net: n(d, "netValue") } : null,
  };
}

/** NSE's ban file → { date, symbols }. "Securities in Ban For Trade Date 23-NOV-2026:" then "1,MANAPPURAM" lines. */
function banOf(text) {
  const s = String(text || "");
  const m = /Trade Date\s+(\d{1,2})-([A-Z]{3})-(\d{4})/i.exec(s);
  const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const date = m && MON[m[2].toUpperCase()] ? `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}` : null;
  const symbols = s
    .split(/\r?\n/)
    .map((l) => /^\s*\d+\s*,\s*([A-Z0-9&_.-]+)\s*$/i.exec(l))
    .filter(Boolean)
    .map((x) => x[1].toUpperCase());
  if (!date) return null;
  return { date, symbols };
}

/**
 * The setup lean for the market: every reading votes −1…+1 with a weight; the lean is the weighted sum.
 * @param nifty keyLevels for NIFTY   @param chain NIFTY's option chain   @param vix { last, changePct }   @param flows flowsOf
 * @param build buildups(...)   @param bank keyLevels for BANKNIFTY
 */
function setupLean({ nifty = null, bank = null, chain = null, vix = null, flows = null, build = null }) {
  const votes = [];
  const add = (id, label, weight, vote, why) => votes.push({ id, label, weight, vote: r2(clamp(vote, -1, 1)), why });
  if (nifty && nifty.available) {
    const range = nifty.r1 - nifty.s1;
    if (range > 0) add("pivot", "NIFTY against its pivot", 1.2, ((nifty.spot - nifty.pivot) / (range / 2)) * 0.8, `NIFTY ₹${nifty.spot.toLocaleString("en-IN")} is ${nifty.side} its pivot ₹${nifty.pivot.toLocaleString("en-IN")}`);
  }
  if (bank && bank.available) {
    const range = bank.r1 - bank.s1;
    if (range > 0) add("bank", "BANKNIFTY against its pivot", 0.6, ((bank.spot - bank.pivot) / (range / 2)) * 0.8, `BANKNIFTY is ${bank.side} its pivot`);
  }
  if (chain && chain.available && chain.bias && Array.isArray(chain.bias.votes)) {
    // the option chain's own reading (PCR, fresh writing, futures build-up, room between the walls, max pain)
    add("options", "NIFTY option chain", 1.5, chain.bias.score / 60, `option chain: ${chain.bias.label} (PCR ${chain.pcr ?? "—"}${chain.support && chain.resistance ? `, put wall ${chain.support.strike}, call wall ${chain.resistance.strike}` : ""})`);
  }
  if (vix && num(vix.last)) {
    const ch = num(vix.changePct) ? vix.changePct : 0;
    // a rising VIX is fear arriving; a falling one, calm returning. A very high VIX is a warning either way (wider swings).
    add("vix", "India VIX", 0.8, -ch / 6, `India VIX ${r2(vix.last)} (${ch >= 0 ? "+" : ""}${r2(ch)}%)${vix.last >= 20 ? " — high: expect wide swings" : vix.last <= 12 ? " — low: calm, narrower ranges" : ""}`);
  }
  if (flows && flows.fii && num(flows.fii.net)) {
    const f = flows.fii.net;
    const d = flows.dii && num(flows.dii.net) ? flows.dii.net : 0;
    add("flows", "Funds flow (FII + DII)", 0.9, (f + 0.5 * d) / 4000, `FIIs ${f >= 0 ? "bought" : "sold"} ₹${Math.abs(Math.round(f)).toLocaleString("en-IN")} cr, DIIs ${d >= 0 ? "bought" : "sold"} ₹${Math.abs(Math.round(d)).toLocaleString("en-IN")} cr (${flows.date || "last session"})`);
  }
  if (build && num(build.breadth) && build.known >= 20) {
    const c = build.counts;
    add("breadth", "F&O build-up breadth", 1.3, build.breadth, `${c["long build-up"]} long build-ups and ${c["short covering"]} short coverings against ${c["short build-up"]} short build-ups and ${c["long unwinding"]} long unwindings across ${build.known} F&O stocks`);
  }
  const wsum = votes.reduce((s, v) => s + v.weight, 0);
  // with only a few readings in, the lean is shrunk: it divides by at least 60% of the full weight (6.3), so one reading alone
  // can never make a strong lean (the morning before the option chains and the build-ups are read, say)
  const lean = wsum ? votes.reduce((s, v) => s + v.vote * v.weight, 0) / Math.max(wsum, FULL_WEIGHT * 0.6) : 0;
  const score = Math.round(lean * 100);
  const few = votes.length < 3;
  const label = few ? "Too few readings yet" : score >= 30 ? "Bullish" : score >= 12 ? "Mildly bullish" : score <= -30 ? "Bearish" : score <= -12 ? "Mildly bearish" : "Neutral";
  const agree = wsum ? votes.filter((v) => Math.sign(v.vote) === Math.sign(lean) && v.vote !== 0).reduce((s, v) => s + v.weight, 0) / wsum : 0;
  return { score, lean: r2(lean), label, agreement: r2(agree), votes, readings: votes.length, of: 6, coverage: r2(wsum / FULL_WEIGHT) };
}

/** One stock's tags from the setup: its build-up now, whether it is banned, whether it had high delivery. */
function stockTags(symbol, { build = null, prevBuild = null, ban = null, delivery = null } = {}) {
  const s = String(symbol || "").toUpperCase();
  const live = build && build.all ? build.all[s] || null : null;
  const prev = prevBuild && prevBuild.all ? prevBuild.all[s] || null : null;
  const banned = Boolean(ban && Array.isArray(ban.symbols) && ban.symbols.includes(s));
  const deliv = Array.isArray(delivery) ? delivery.find((x) => x.symbol === s) || null : null;
  const sign = (b) => (!b ? 0 : { "long build-up": 1, "short covering": 0.5, "long unwinding": -0.5, "short build-up": -1 }[b.kind] || 0);
  // the refiner's input: the build-up's side, scaled by how big the OI change is (5% OI = a full unit)
  const score = live ? r2(sign(live) * clamp(Math.abs(live.oiChangePct || 0) / 5, 0.2, 1)) : 0;
  return { symbol: s, live, prev, banned, highDelivery: deliv, score };
}

/** The setup in a few lines, for the trading-skills file and the AI. */
function linesOf(v) {
  const out = [];
  if (!v) return out;
  if (v.lean) out.push(`Setup lean: ${v.lean.label} (${v.lean.score}, ${Math.round((v.lean.agreement || 0) * 100)}% of the weight agrees) — ${v.lean.votes.map((x) => x.why).join("; ")}.`);
  if (v.nifty && v.nifty.available) out.push(v.nifty.read);
  if (v.bank && v.bank.available) out.push(v.bank.read);
  for (const k of ["niftyCalls", "niftyPuts", "bankCalls", "bankPuts"]) if (v.options && v.options[k]) out.push(`${k.startsWith("nifty") ? "NIFTY" : "BANKNIFTY"}: ${v.options[k].read}`);
  if (v.pcr) out.push(`PCR (OI): NIFTY ${v.pcr.nifty ?? "—"}, BANKNIFTY ${v.pcr.bank ?? "—"}.`);
  if (v.vix && num(v.vix.last)) out.push(`India VIX ${r2(v.vix.last)} (${num(v.vix.changePct) ? `${v.vix.changePct >= 0 ? "+" : ""}${r2(v.vix.changePct)}%` : "—"}).`);
  if (v.flows && v.flows.fii) out.push(`Funds flow ${v.flows.date || ""}: FII ${num(v.flows.fii.net) ? `₹${Math.round(v.flows.fii.net).toLocaleString("en-IN")} cr` : "—"}, DII ${v.flows.dii && num(v.flows.dii.net) ? `₹${Math.round(v.flows.dii.net).toLocaleString("en-IN")} cr` : "—"}.`);
  const b = v.build || v.prevBuild;
  if (b && b.counts) {
    const names = (k) => (b.lists[k] || []).slice(0, 6).map((x) => x.symbol).join(", ") || "—";
    out.push(`Build-ups (${v.build ? "now, against the last session" : "last session"}): long build-up ${b.counts["long build-up"]} (${names("long build-up")}); short build-up ${b.counts["short build-up"]} (${names("short build-up")}); short covering ${b.counts["short covering"]} (${names("short covering")}); long unwinding ${b.counts["long unwinding"]} (${names("long unwinding")}).`);
  }
  if (Array.isArray(v.delivery) && v.delivery.length) out.push(`High delivery last session: ${v.delivery.slice(0, 8).map((x) => `${x.symbol} ${x.delivPct}%`).join(", ")}.`);
  if (v.ban) out.push(v.ban.symbols.length ? `F&O ban today: ${v.ban.symbols.join(", ")} (no new F&O positions in them).` : "No stock is in the F&O ban today.");
  return out;
}

module.exports = { pivots, keyLevels, optionSide, buildups, flowsOf, banOf, setupLean, stockTags, linesOf };
