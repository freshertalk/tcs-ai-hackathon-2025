"use strict";
// NSE's cash-market day, by date: when continuous trading in a stock ends, and when Zerodha squares off intraday (MIS)
// positions. One table, so that every part of the desk that counts minutes to the end of the day counts to the same minute.
//
// What changed, and where it is written:
//   · Until 31 July 2026 every stock traded continuously to 3:30 PM and the closing price was a VWAP of the last half-hour.
//     The desk counted to a 3:15 PM square-off (a few minutes before the broker's own).
//   · From 3 August 2026 (SEBI's Closing Auction Session, phase 1) the stocks in the F&O list stop continuous trading at
//     3:15 PM and go into a closing auction (3:15 – 3:35 PM); every other stock trades to 3:30 PM as before.
//     Zerodha squares off intraday positions at 3:12 PM in closing-auction stocks and at 3:25 PM in the rest, and charges
//     ₹50 + GST for each order it has to square off itself.
//     Read on 20 November 2026 from Zerodha's own pages:
//       support.zerodha.com/…/articles/intraday-auto-square-off-timings
//       support.zerodha.com/…/articles/closing-auction-session
//   · From 7 December 2026 the rules change again (SEBI circular of 15 October 2026): continuous trading is reported to run
//     to 3:30 PM for every stock with the auction after it. Zerodha had NOT published its square-off times for that regime
//     when this was written, so the earliest known time (3:12 PM) is kept for closing-auction stocks: early is safe, late
//     is a charge and a market order. UPDATE THE LAST ROW when Zerodha publishes them.
//
// "cas" = the stock has a closing auction = it is in the F&O list. When that is not known, assume it is: the earlier time.
// Pure: no clock, no network.

const IST = 5.5 * 3600 * 1000;
const OPEN_MIN = 9 * 60 + 15;
const m = (h, min) => h * 60 + min;

/** Oldest first. Minutes after midnight IST. */
const REGIMES = [
  { id: "vwap-close", from: "0000-01-01", close: { cas: m(15, 30), other: m(15, 30) }, squareOff: { cas: m(15, 15), other: m(15, 15) }, auction: null },
  { id: "closing-auction-1", from: "2026-08-03", close: { cas: m(15, 15), other: m(15, 30) }, squareOff: { cas: m(15, 12), other: m(15, 25) }, auction: [m(15, 15), m(15, 35)] },
  { id: "closing-auction-2", from: "2026-12-07", close: { cas: m(15, 30), other: m(15, 30) }, squareOff: { cas: m(15, 12), other: m(15, 25) }, auction: [m(15, 30), m(15, 40)], unconfirmed: "Zerodha's square-off times from 7 December 2026 were not published when this was written; 3:12 PM is kept for closing-auction stocks until they are." },
];

const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
/** 912 → "3:12 PM" */
const clockOf = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min >= 720 ? "PM" : "AM"}`;
/** A moment as its IST clock, "3:12 PM". */
const clockAt = (ms) => {
  const d = new Date(ms + IST);
  return clockOf(d.getUTCHours() * 60 + d.getUTCMinutes());
};

/** The rules in force on a date ("YYYY-MM-DD", IST). */
function regimeFor(date) {
  let r = REGIMES[0];
  for (const x of REGIMES) if (String(date) >= x.from) r = x;
  return r;
}

/**
 * A stock's day on a date.
 * @returns { regime, cas, closeMin, closeSlot (5-minute slots from 9:15: 75 = 3:30 PM, 72 = 3:15 PM), squareOffMin,
 *            closeClock, squareOffClock, auction: [fromMin, toMin] | null, unconfirmed: "" | why }
 */
function sessionFor(date, { cas = true } = {}) {
  const r = regimeFor(date);
  const k = cas ? "cas" : "other";
  return {
    regime: r.id,
    cas: Boolean(cas),
    closeMin: r.close[k],
    closeSlot: Math.round((r.close[k] - OPEN_MIN) / 5),
    squareOffMin: r.squareOff[k],
    closeClock: clockOf(r.close[k]),
    squareOffClock: clockOf(r.squareOff[k]),
    auction: cas ? r.auction : null,
    unconfirmed: r.unconfirmed || "",
  };
}

/** The moment Zerodha squares off intraday positions on the IST day of `ms`. */
function squareOffAt(ms, { cas = true } = {}) {
  const date = istDate(ms);
  return Date.parse(`${date}T00:00:00Z`) - IST + sessionFor(date, { cas }).squareOffMin * 60000;
}

/** The moment continuous trading ends on the IST day of `ms`. */
function closeAt(ms, { cas = true } = {}) {
  const date = istDate(ms);
  return Date.parse(`${date}T00:00:00Z`) - IST + sessionFor(date, { cas }).closeMin * 60000;
}

/**
 * The slot after which continuous trading ends TODAY for a stock, from where it ended on its previous session (the bars
 * themselves say whether it has a closing auction) — except on the first day of new rules, when the table is used.
 * @param priorSlot  the slot after the previous session's last bar (75 when unknown)
 */
function liveCloseSlot(priorSlot, priorDate, today) {
  const was = Number.isFinite(priorSlot) && priorSlot >= 60 && priorSlot <= 75 ? priorSlot : 75;
  if (!priorDate || regimeFor(priorDate).id === regimeFor(today).id) return was;
  // new rules today: a stock that closed early yesterday is a closing-auction stock; under the old rules nothing closed early
  const cas = was < 75 || regimeFor(priorDate).close.cas === regimeFor(priorDate).close.other;
  return sessionFor(today, { cas }).closeSlot;
}

/**
 * For a SIMULATED trade (a replay, a backtest, the paper robot): the minute of the day at which whatever is still open is
 * closed — the last 5-minute mark at or before the broker's square-off, so the simulation never holds a position the
 * broker would already have closed. 3:15 PM under the old rules (as these simulations always did); 3:10 PM in a
 * closing-auction stock since 3 August 2026 (square-off 3:12 PM); 3:25 PM in a stock with no auction.
 * A simulation that does not know the stock treats it as a closing-auction stock, like the exit coach.
 */
function exitMinFor(date, { cas = true } = {}) {
  const sq = sessionFor(date, { cas }).squareOffMin;
  return sq - ((sq - OPEN_MIN) % 5);
}
/** …the same as a 24-hour clock, "15:10", for the simulations that compare clock strings. */
const exitHmFor = (date, opts) => {
  const x = exitMinFor(date, opts);
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};
/** …and the moment itself, on the IST day of `ms`. */
function exitAt(ms, opts) {
  const date = istDate(ms);
  return Date.parse(`${date}T00:00:00Z`) - IST + exitMinFor(date, opts) * 60000;
}

/** One sentence for a prompt or a note: when intraday positions are squared off, as of a date. */
function squareOffNote(date) {
  const a = sessionFor(date, { cas: true });
  const b = sessionFor(date, { cas: false });
  if (a.squareOffMin === b.squareOffMin) return `Intraday (MIS) positions are squared off by the broker at about ${a.squareOffClock}.`;
  return `Zerodha squares off intraday (MIS) positions at ${a.squareOffClock} in stocks that have a closing auction (every stock in the F&O list${a.closeMin !== b.closeMin ? `, whose continuous trading ends at ${a.closeClock}` : ""}) and at ${b.squareOffClock} in the rest, and charges for each order it has to close itself.`;
}

module.exports = { REGIMES, OPEN_MIN, regimeFor, sessionFor, squareOffAt, closeAt, liveCloseSlot, exitMinFor, exitHmFor, exitAt, squareOffNote, clockOf, clockAt };
