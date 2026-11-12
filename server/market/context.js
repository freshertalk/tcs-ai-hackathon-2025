"use strict";
// The market around a stock: which way the Indian market is moving right now
// (the "tide"), how nervous it is (India VIX), which sectors are carrying it, and
// the overseas-linked instruments that trade through Zerodha — GIFT Nifty, the
// rupee, crude oil and gold.
//
// Everything here comes from the same exchange feed as the stock itself. It is
// arithmetic on quotes: no forecasts. Overseas markets that Zerodha does not
// carry (US, Europe, the rest of Asia) arrive separately, through the optional
// AI world brief, and are never used in the arithmetic.

const I = require("./indicators");
const { sessionAt } = require("./intraday");

const num = I.isNum;
const IST = 5.5 * 3600 * 1000;
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const sign = (x, d = 2) => (num(x) ? `${x > 0 ? "+" : ""}${x.toFixed(d)}%` : "—");

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SECTORS = [
  ["NSE:NIFTY IT", "IT"],
  ["NSE:NIFTY AUTO", "Auto"],
  ["NSE:NIFTY PHARMA", "Pharma"],
  ["NSE:NIFTY METAL", "Metals"],
  ["NSE:NIFTY FMCG", "FMCG"],
  ["NSE:NIFTY ENERGY", "Energy"],
  ["NSE:NIFTY REALTY", "Realty"],
  ["NSE:NIFTY PSU BANK", "PSU banks"],
  ["NSE:NIFTY FIN SERVICE", "Financials"],
  ["NSE:NIFTY MIDCAP 100", "Midcaps"],
];

/** The quote keys to ask Zerodha for. Monthly futures are tried for this month and the next. */
function contextKeys(nowMs) {
  const d = new Date(nowMs + IST);
  const code = (add) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
    return `${String(m.getUTCFullYear()).slice(2)}${MONTHS[m.getUTCMonth()]}`;
  };
  const fut = (exchange, root) => [0, 1].map((a) => `${exchange}:${root}${code(a)}FUT`);
  const plan = {
    nifty: "NSE:NIFTY 50",
    bank: "NSE:NIFTY BANK",
    vix: "NSE:INDIA VIX",
    gift: "NSEIX:GIFT NIFTY",
    usdinr: fut("CDS", "USDINR"),
    crude: fut("MCX", "CRUDEOIL"),
    gold: fut("MCX", "GOLDM"),
    sectors: SECTORS,
  };
  plan.keys = [plan.nifty, plan.bank, plan.vix, plan.gift, ...plan.usdinr, ...plan.crude, ...plan.gold, ...SECTORS.map((s) => s[0])];
  // the indices that also arrive on the live stream, by their NSE symbol
  plan.streamable = [
    { key: plan.nifty, symbol: "NIFTY 50" },
    { key: plan.bank, symbol: "NIFTY BANK" },
    { key: plan.vix, symbol: "INDIA VIX" },
  ];
  return plan;
}

const usable = (q) => q && num(q.last) && q.last > 0;
/** Of this month's and next month's contract, the one that is actually trading (more volume wins). */
function front(quotes, keys) {
  const live = keys.map((k) => ({ k, q: quotes[k] })).filter((x) => usable(x.q));
  if (!live.length) return null;
  live.sort((a, b) => (b.q.volume || 0) - (a.q.volume || 0));
  return { key: live[0].k, ...live[0].q };
}

function item(id, name, q, extra = {}) {
  if (!usable(q)) return { id, name, available: false, ...extra };
  return {
    id,
    name,
    available: true,
    last: r2(q.last),
    changePct: r2(num(q.changePct) ? q.changePct : pct(q.last, q.prevClose)),
    fromOpenPct: r2(num(q.open) && q.open > 0 ? pct(q.last, q.open) : null),
    ...extra,
  };
}

/**
 * @param quotes    { "NSE:NIFTY 50": { last, open, high, low, prevClose, changePct, volume }, … }
 * @param plan      contextKeys(nowMs)
 * @param niftyBars today's 5-minute Nifty bars (empty outside market hours)
 * @param priorBars earlier days' 5-minute Nifty bars (warm-up for the averages)
 */
function buildContext({ quotes = {}, plan, niftyBars = [], priorBars = [], nowMs }) {
  const session = sessionAt(nowMs);
  const nq = quotes[plan.nifty];
  if (!usable(nq)) {
    return { available: false, reason: "Zerodha returned no Nifty 50 quote, so the market's direction cannot be read.", session, items: [], sectors: [], notes: [] };
  }

  /* ----------------------------------------------------------- the Nifty */
  const last = nq.last;
  const open = num(nq.open) && nq.open > 0 ? nq.open : null;
  const high = Math.max(num(nq.high) ? nq.high : last, last);
  const low = Math.min(num(nq.low) && nq.low > 0 ? nq.low : last, last);
  const changePct = num(nq.changePct) ? nq.changePct : pct(last, nq.prevClose);
  const fromOpenPct = open ? pct(last, open) : null;
  const span = high - low;
  const dayPos = span > 0 ? (last - low) / span : 0.5;
  const nifty = { last: r2(last), open: r2(open), high: r2(high), low: r2(low), prevClose: r2(nq.prevClose), changePct: r2(changePct), fromOpenPct: r2(fromOpenPct), dayPosPct: Math.round(dayPos * 100) };

  /* ------------------------------------------------------------ sectors */
  const sectors = plan.sectors.map(([key, name]) => ({ name, ...item(key, name, quotes[key]) })).filter((s) => s.available);
  const up = sectors.filter((s) => s.changePct > 0.1).length;
  const down = sectors.filter((s) => s.changePct < -0.1).length;
  const breadth = { up, down, flat: sectors.length - up - down, total: sectors.length };
  sectors.sort((a, b) => b.changePct - a.changePct);

  /* -------------------------------------------------------------- the tide */
  const bq = quotes[plan.bank];
  const factors = [];
  const add = (name, reading, pts, max) => factors.push({ name, reading, pts: Math.round(pts), max });
  add("Nifty vs yesterday's close", sign(changePct), num(changePct) ? clamp(changePct / 0.6, -1, 1) * 25 : 0, 25);
  add("Nifty since today's open", open ? sign(fromOpenPct) : "no open yet", num(fromOpenPct) ? clamp(fromOpenPct / 0.4, -1, 1) * 25 : 0, 25);
  add("Nifty's place in today's range", span > 0 ? `${Math.round(dayPos * 100)}% of the way from the low to the high` : "no range yet", span > 0 ? (dayPos - 0.5) * 2 * 15 : 0, 15);

  const closes = [...priorBars, ...niftyBars].map((b) => b.c);
  if (niftyBars.length && closes.length >= 22) {
    closes[closes.length - 1] = last;
    const k = closes.length - 1;
    const e9 = I.ema(closes, 9)[k];
    const e21 = I.ema(closes, 21)[k];
    const upTrend = e9 > e21;
    const strong = upTrend ? last > e9 : last < e9;
    add("Nifty 5-minute trend", `9 EMA ${upTrend ? "above" : "below"} 21 EMA${strong ? `, price ${upTrend ? "above" : "below"} both` : ""}`, (upTrend ? 1 : -1) * (strong ? 15 : 8), 15);
  } else add("Nifty 5-minute trend", "no intraday bars", 0, 15);

  const bankFromOpen = usable(bq) && num(bq.open) && bq.open > 0 ? pct(bq.last, bq.open) : null;
  add("Bank Nifty since the open", num(bankFromOpen) ? sign(bankFromOpen) : "not available", num(bankFromOpen) ? clamp(bankFromOpen / 0.5, -1, 1) * 10 : 0, 10);
  add("Sectors rising vs falling", breadth.total ? `${up} up, ${down} down of ${breadth.total}` : "not available", breadth.total ? ((up - down) / breadth.total) * 10 : 0, 10);

  const score = clamp(Math.round(factors.reduce((s, f) => s + f.pts, 0)), -100, 100);
  const label = score >= 30 ? "Rising" : score <= -30 ? "Falling" : "Slack";
  const tide = {
    score,
    label,
    summary: `${label} tide (${score > 0 ? "+" : ""}${score}): Nifty ${sign(changePct)} on the day, ${sign(fromOpenPct)} since the open.`,
    factors,
    live: session.open,
  };

  /* ------------------------------------------------------------- the rest */
  const vq = quotes[plan.vix];
  const vixChange = usable(vq) ? (num(vq.changePct) ? vq.changePct : pct(vq.last, vq.prevClose)) : null;
  const vix = usable(vq)
    ? { last: r2(vq.last), changePct: r2(vixChange), level: vq.last >= 22 ? "high" : vq.last >= 16 ? "elevated" : vq.last >= 12 ? "normal" : "calm" }
    : null;

  const usd = front(quotes, plan.usdinr);
  const crude = front(quotes, plan.crude);
  const gold = front(quotes, plan.gold);
  const items = [
    item("nifty", "Nifty 50", nq, { group: "india", symbol: "NIFTY 50" }),
    item("bank", "Bank Nifty", bq, { group: "india", symbol: "NIFTY BANK" }),
    item("vix", "India VIX", vq, { group: "india", symbol: "INDIA VIX", inverse: true }),
    item("gift", "GIFT Nifty", quotes[plan.gift], { group: "world", note: "Nifty futures at GIFT City; trades about 21 hours a day" }),
    item("usdinr", "USD / INR", usd, { group: "world", note: "front-month future; up means a weaker rupee", inverse: true }),
    item("crude", "Crude oil (MCX)", crude, { group: "world", note: "front-month future, ₹ per barrel", inverse: true }),
    item("gold", "Gold (MCX)", gold, { group: "world", note: "front-month mini future, ₹ per 10 g" }),
  ];

  const notes = [];
  if (vix && num(vix.changePct) && vix.changePct >= 7) notes.push(`India VIX is up ${vix.changePct.toFixed(1)}% today (at ${vix.last}): swings are getting wider, so stops are hit more easily. Smaller size.`);
  else if (vix && vix.level === "high") notes.push(`India VIX is at ${vix.last} — a nervous market. Expect wider ranges than the ATR suggests.`);
  if (breadth.total >= 6 && up >= breadth.total - 1) notes.push("Almost every sector is up: a broad move, which favours longs in strong stocks.");
  if (breadth.total >= 6 && down >= breadth.total - 1) notes.push("Almost every sector is down: a broad sell-off, which favours shorts in weak stocks and argues against bottom-fishing.");
  const giftItem = items.find((x) => x.id === "gift");
  if (!session.open && giftItem.available && num(giftItem.changePct) && Math.abs(giftItem.changePct) >= 0.3) {
    notes.push(`GIFT Nifty is ${sign(giftItem.changePct)} from its previous close — an early hint of a ${giftItem.changePct > 0 ? "firmer" : "weaker"} open. It is a future, so its level is not the Nifty's.`);
  }
  if (crude && num(crude.changePct) && Math.abs(crude.changePct) >= 2) notes.push(`Crude oil is ${sign(crude.changePct)} today — it matters for oil marketers, paints, tyres and airlines.`);
  if (usd && num(usd.changePct) && Math.abs(usd.changePct) >= 0.3) notes.push(`The rupee is ${usd.changePct > 0 ? "weaker" : "stronger"} (USD/INR ${sign(usd.changePct)}) — watch IT and pharma exporters${usd.changePct > 0 ? ", and foreign selling" : ""}.`);

  return { available: true, at: new Date(nowMs).toISOString(), session, tide, nifty, vix, items, sectors, breadth, notes };
}

module.exports = { buildContext, contextKeys, SECTORS };
