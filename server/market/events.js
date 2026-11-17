"use strict";
// The event calendar: what is coming that moves prices, what it usually does to a trade, and what to do about it.
//
// Two kinds of event, one list:
//   AUTOMATIC   worked out from data the desk already has — F&O expiries (from the NFO contract list Zerodha
//               supplies), exchange holidays and the session before one, special sessions, the month's last session
//   YOURS       entered by the owner: a company's results date, an RBI policy day, the US Fed, the Budget, anything
//               (Zerodha has no results calendar; nobody knows your stock's date better than the announcement)
//
// Every event carries what a careful trader does about it, as a size factor (1 = normal, 0.5 = half) and flags
// (no overnight positions, no new trades around the announcement). The advice is conservative and general: it
// describes how such days usually behave, not what will happen.
//
// Pure functions: the service supplies the expiries, the custom events and the date.

const nse = require("./nse-holidays");

const DAY = 86400000;
const utc = (date) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY);
const clean = (x, n) => String(x == null ? "" : x).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const INDEXES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"];
const IMPACT = { high: 3, medium: 2, low: 1 };

/**
 * The expiry dates of the index and stock derivatives, from the NFO contract list ({ n: name, y: "FUT"|"CE"|"PE", e: "YYYY-MM-DD" }).
 * @returns [{ name, date, kind: "weekly"|"monthly", index: boolean }]
 */
function expiriesFrom(list, { today, days = 45, symbols = [] } = {}) {
  const last = iso(utc(today) + days * DAY);
  const byName = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || !x.n || !x.e || x.e < today || x.e > last) continue;
    const index = INDEXES.includes(x.n);
    if (!index && !symbols.includes(x.n)) continue;
    if (!byName.has(x.n)) byName.set(x.n, new Set());
    byName.get(x.n).add(x.e);
  }
  const out = [];
  for (const [name, set] of byName) {
    const dates = [...set].sort();
    const index = INDEXES.includes(name);
    for (const d of dates) {
      // monthly = the month's last expiry of this name; the rest are weeklies
      const month = d.slice(0, 7);
      const lastOfMonth = [...set].filter((x) => x.startsWith(month)).sort().pop();
      out.push({ name, date: d, kind: d === lastOfMonth ? "monthly" : "weekly", index });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : 1));
}

const ev = (date, kind, title, over) => ({ id: `${kind}|${date}|${title}`, date, kind, title, impact: "low", scope: { market: true }, sizeFactor: 1, noOvernight: false, avoidNew: false, advice: "", source: "auto", ...over });

/** The automatic events from today for `days` days. */
function autoEvents({ today, days = 30, expiries = [] } = {}) {
  const out = [];
  const end = iso(utc(today) + days * DAY);
  // exchange closures, and the session before each
  for (const c of nse.closuresBetween(today, days)) {
    if (c.kind === "closed") {
      out.push(ev(c.date, "holiday", `Market closed: ${c.name}`, { impact: "medium", advice: "The market is shut. A position held over the closure carries gap risk for that many more days; intraday trades are unaffected. Plan positional trades around it." }));
      const before = nse.prevTradingDay(c.date);
      if (before >= today && before <= end) out.push(ev(before, "pre-holiday", `Last session before ${c.name}`, { impact: "medium", sizeFactor: 0.85, noOvernight: false, advice: "Volumes tend to thin and many traders square off before a closure. Avoid carrying leveraged positions over it unless it is the plan, and size for the gap risk." }));
    } else {
      out.push(ev(c.date, "special", c.name, { impact: "medium", advice: "A special session outside the normal calendar: timings are set by the exchange. Check them; liquidity can differ from a normal day." }));
    }
  }
  // F&O expiries
  for (const x of expiries) {
    if (x.date < today || x.date > end) continue;
    if (x.index) {
      const monthly = x.kind === "monthly";
      out.push(ev(x.date, "expiry", `${x.name} ${monthly ? "monthly" : "weekly"} expiry`, { impact: monthly ? "high" : "medium", sizeFactor: monthly ? 0.75 : 0.85, advice: `Expiry day. Option writers and hedgers move prices near round strikes, especially in the last hour, and prices tend to gravitate toward the max-pain strike. Trade smaller (about ×${monthly ? "0.75" : "0.85"}) and avoid starting new trades after 2:45 PM.` }));
    } else {
      out.push(ev(x.date, "expiry", `${x.name} F&O expiry`, { impact: "low", scope: { symbols: [x.name] }, sizeFactor: 0.85, advice: "This stock's derivatives expire today: late-session moves can be driven by squaring and rollover rather than by news. Trade a little smaller and be out before the close." }));
    }
  }
  const eom = nse.lastTradingDayOfMonth(today);
  if (eom >= today && eom <= end) out.push(ev(eom, "month-end", "Last session of the month", { impact: "low", advice: "Month-end flows (fund rebalancing, derivative rollover) can add late-day volatility. Nothing to change unless you trade the close." }));
  return out;
}

const CUSTOM_KINDS = { results: "Results", rbi: "RBI policy", fed: "US Fed", budget: "Budget", policy: "Policy / data release", other: "Other" };

/** Clean a custom event from the owner. @returns the event, or { error } */
function cleanCustom(input = {}) {
  const date = String(input.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(utc(date))) return { error: "Enter the date as YYYY-MM-DD." };
  const kind = Object.keys(CUSTOM_KINDS).includes(input.kind) ? input.kind : "other";
  const title = clean(input.title, 100) || CUSTOM_KINDS[kind];
  const symbols = [...new Set((Array.isArray(input.symbols) ? input.symbols : String(input.symbols || "").split(/[\s,]+/)).map((s) => String(s).toUpperCase().trim()).filter((s) => /^[A-Z0-9][A-Z0-9&._-]{0,24}$/.test(s)))].slice(0, 20);
  if (kind === "results" && !symbols.length) return { error: "Results belong to a stock: enter its symbol." };
  const time = /^\d{1,2}:\d{2}$/.test(String(input.time || "").trim()) ? String(input.time).trim().padStart(5, "0") : "";
  const impact = Object.keys(IMPACT).includes(input.impact) ? input.impact : kind === "results" ? "high" : kind === "other" ? "medium" : "high";
  return { date, kind, title, symbols, time, impact, note: clean(input.note, 240) };
}

/** A custom event turned into a calendar event with its advice. */
function fromCustom(c, today) {
  const stock = c.symbols.length > 0;
  const away = daysBetween(today, c.date);
  const at = c.time ? ` at ${c.time} IST` : "";
  const scope = stock ? { symbols: c.symbols } : { market: true };
  const note = c.note ? ` ${c.note}` : "";
  let advice;
  let sizeFactor = 1;
  let noOvernight = false;
  let avoidNew = false;
  if (c.kind === "results") {
    sizeFactor = away <= 0 ? 0.5 : away === 1 ? 0.7 : 0.9;
    noOvernight = away === 0 || away === 1;
    advice = away < 0 ? "The results are out: the stock may still be repricing for days. Let the first reaction settle before trading it; use the gap's low and high as the levels." : away === 0 ? `Results today${at}. The stock can gap sharply when they land. Do not carry a leveraged position through the announcement unless it is the plan and sized for the gap; after them, wait for the first reaction to settle.` : away === 1 ? `Results tomorrow${at}. A position held overnight faces the gap: square off intraday positions, and size anything positional for a move much larger than a normal day.` : `Results on ${c.date}${at}: positions held into the date carry event risk. Decide before then whether to hold through it.`;
    avoidNew = away === 0;
  } else {
    sizeFactor = away === 0 ? 0.6 : away === 1 ? 0.85 : 1;
    avoidNew = away === 0;
    advice = `${CUSTOM_KINDS[c.kind] || "Event"}${away === 0 ? ` today${at}` : ` on ${c.date}${at}`}: prices can move sharply and spreads widen when it lands. ${away === 0 ? "No new trades in the 15 minutes either side of it; trade smaller (about ×0.6) and keep stops in." : "Plan to be smaller or flat going into it."}`;
  }
  return ev(c.date, "custom", c.title, { id: c.id || `custom|${c.date}|${c.title}`, impact: c.impact, scope, sizeFactor, noOvernight, avoidNew, advice: `${advice}${note}`.trim(), source: "yours", sub: c.kind, time: c.time, note: c.note });
}

const applies = (e, symbol) => Boolean(e.scope.market) || (symbol && e.scope.symbols && e.scope.symbols.includes(symbol));

/** Everything that applies to one stock on one date: the events, their combined size factor and flags. */
function eventsOn(events, date, symbol = null) {
  const list = events.filter((e) => e.date === date && applies(e, symbol));
  const tomorrow = iso(utc(date) + DAY);
  // an event on a later day that bans carrying a position over tonight (results tomorrow)
  const eve = events.filter((e) => e.date === tomorrow && e.noOvernight && e.kind === "custom" && applies(e, symbol));
  const all = [...list, ...eve.filter((e) => !list.includes(e))];
  const size = Math.max(0.25, all.reduce((p, e) => p * (e.date === date ? e.sizeFactor : 1), 1));
  return {
    date,
    events: all.sort((a, b) => IMPACT[b.impact] - IMPACT[a.impact]),
    sizeFactor: Math.round(size * 100) / 100,
    noOvernight: all.some((e) => e.noOvernight),
    avoidNew: all.some((e) => e.date === date && e.avoidNew),
    top: all.length ? all.sort((a, b) => IMPACT[b.impact] - IMPACT[a.impact])[0].title : "",
  };
}

/** The coming events for a stock (or the whole market), soonest first, with how many days away. */
function upcoming(events, today, { symbol = null, days = 14 } = {}) {
  const end = iso(utc(today) + days * DAY);
  return events
    .filter((e) => e.date >= today && e.date <= end && (symbol === null ? true : applies(e, symbol)))
    .map((e) => ({ ...e, daysAway: daysBetween(today, e.date) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : IMPACT[b.impact] - IMPACT[a.impact]));
}

module.exports = { expiriesFrom, autoEvents, cleanCustom, fromCustom, eventsOn, upcoming, CUSTOM_KINDS, INDEXES };
