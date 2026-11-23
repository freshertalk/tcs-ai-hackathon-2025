// The Journal's P&L, laid out and worded as Zerodha's own P&L report (Console → Reports → P&L), so a figure here and a
// figure there can be read side by side:
//
//   PnlSummary    Realised P&L · Charges & taxes · Other credits & debits | Net realised P&L · Unrealised P&L
//   PnlBySymbol   Symbol · Qty. · Buy avg. · Buy value · Sell avg. · Sell value · Realised P&L · Unrealised P&L
//
// The words mean what they mean in Zerodha's report:
//   Realised P&L            what the closed trades made or lost, before any cost (sell value − buy value)
//   Charges & taxes         brokerage, STT, exchange and SEBI fees, GST, stamp duty, DP charge — estimated here from
//                           Zerodha's published equity rates (the contract note is the truth)
//   Other credits & debits  ledger entries that are not trades (interest, DP charges billed separately, …). Zerodha's
//                           API does not give these, so this page cannot know them: it says so rather than show a 0
//   Net realised P&L        Realised P&L − Charges & taxes (the Journal's "net" everywhere else)
//   Unrealised P&L          open positions at today's price: from the live position book when the period includes today
//                           and Zerodha is connected; 0 when nothing is open; unknown otherwise
import React, { useMemo, useState } from "react";
import { isNum, num } from "../analyzer/format";
import "./pnl-report.css";

/** Zerodha's short figure: 950, 4.24k, 1.25L, 2.10Cr — with a sign for a profit or loss. */
export function kite(x, { signed = false } = {}) {
  if (!isNum(x)) return "—";
  const v = Math.abs(x);
  const sign = signed && x > 0 ? "+" : x < 0 ? "−" : "";
  const cut = (n) => (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  if (v >= 1e7) return `${sign}${cut(v / 1e7)}Cr`;
  if (v >= 1e5) return `${sign}${cut(v / 1e5)}L`;
  if (v >= 1e3) return `${sign}${cut(v / 1e3)}k`;
  return `${sign}${cut(v)}`;
}
const full = (x) => (isNum(x) ? num(x) : "—");
const signedFull = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}` : "—");
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * The unrealised part of one live position: what the quantity still held makes or loses at the price
 * (quantity × (price − average) × multiplier), or null when the position is closed. The server sends it ready as
 * `unrealisedOpen`; an older server's book is worked out here the same way.
 */
export function openPart(p) {
  if (!p || !isNum(p.quantity) || p.quantity === 0) return null;
  if (isNum(p.unrealisedOpen)) return p.unrealisedOpen;
  const mult = isNum(p.multiplier) && p.multiplier > 0 ? p.multiplier : 1;
  if (isNum(p.average) && p.average > 0 && isNum(p.last) && p.last > 0) return Math.round(p.quantity * (p.last - p.average) * mult * 100) / 100;
  return isNum(p.unrealised) ? p.unrealised : null;
}

/**
 * The unrealised P&L of a period: the live book's open positions when the period reaches today; 0 when nothing in the
 * period is open; otherwise unknown (null).
 * @returns { total: number|null, bySymbol: Map<symbol, number>, why: string }
 */
export function unrealisedOf({ s, period, book, today = istToday() }) {
  const reachesToday = !period || !period.toDay || period.toDay >= today;
  const live = book && book.available && Array.isArray(book.positions);
  if (reachesToday && live) {
    // Open positions only (23 Nov 2026). Kite's own `unrealised` field carries the WHOLE P&L of a position — also of an
    // intraday position already squared off — so the book's total used to show the day's booked profit as "Unrealised"
    // with nothing open (+1.63k here, 0 in Console). The booked part is already in Realised P&L.
    const bySymbol = new Map();
    for (const p of book.positions) {
      const u = openPart(p);
      if (u !== null) bySymbol.set(p.symbol, (bySymbol.get(p.symbol) || 0) + u);
    }
    const total = [...bySymbol.values()].reduce((a, v) => a + v, 0);
    const open = [...bySymbol.keys()].length;
    if (!open) return { total: 0, bySymbol, why: "nothing is open just now (positions closed today are in Realised P&L)" };
    return { total: Math.round(total * 100) / 100, bySymbol, why: book.live && book.streaming ? "open positions, live with every price" : "open positions, as Zerodha last reported them" };
  }
  if (!s || !s.open) return { total: 0, bySymbol: new Map(), why: "nothing in this period is open" };
  return { total: null, bySymbol: new Map(), why: `${s.open} position${s.open === 1 ? " is" : "s are"} still open; ${reachesToday ? "connect Zerodha to value them" : "they are valued live on the Positions page"}` };
}

/**
 * Why this page and Zerodha Console can differ, worked out (23 Nov 2026). Console's P&L report is rebuilt overnight
 * ("Last updated: …" under its table), so a day's trades reach it the next morning; this page reads today's trades from
 * Kite as they happen. When the period includes today and today has closed trades, the figures "as Console shows them
 * until its next update" are the period without today.
 * @returns null, or { today: { trades, gross, charges, net }, console: { gross, charges, net, trades } }
 */
export function consoleView(s, period, today = istToday()) {
  if (!s || !Array.isArray(s.calendar)) return null;
  const reachesToday = !period || !period.toDay || period.toDay >= today;
  const t = reachesToday ? s.calendar.find((d) => d && d.key === today) : null;
  if (!t || !t.trades) return null;
  const r = (x) => Math.round(x * 100) / 100;
  return {
    today: { trades: t.trades, gross: r(t.gross), charges: r(t.charges), net: r(t.net) },
    console: { trades: s.trades - t.trades, gross: r(s.gross - t.gross), charges: r(s.charges - t.charges), net: r(s.net - t.net) },
  };
}

/* ------------------------------------------------------------------ the five figures */
export function PnlSummary({ s, unrealised, period = null }) {
  const u = unrealised || { total: null, why: "" };
  const cv = useMemo(() => consoleView(s, period), [s, period]);
  const [asConsole, setAsConsole] = useState(false);
  const shown = asConsole && cv ? { ...s, ...cv.console } : s;
  const Fig = ({ label, value, cls = "", tip, sub }) => (
    <div className="zp-fig" data-tip={tip}>
      <dt>{label}</dt>
      <dd className={cls}>{value}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
  return (
    <section className="zp-sum" aria-label="P&L summary, as in Zerodha's P&L report">
      <dl className="zp-sum__row">
        <Fig label="Realised P&L" value={kite(shown.gross, { signed: true })} cls={tone(shown.gross)} tip={`What the closed trades made or lost before any cost: ₹${full(shown.gross)}.`} />
        <Fig label="Charges & taxes" value={kite(shown.charges)} tip={`Brokerage, STT, exchange and SEBI fees, GST, stamp duty and DP charge: ₹${full(shown.charges)}. An estimate from Zerodha's published rates; your contract note is the truth.`} />
        <Fig label="Other credits & debits" value="—" tip="Ledger entries that are not trades (interest, separately billed DP charges and the like). Zerodha's API does not give them, so they are not counted here; Console's P&L report shows them." />
        <i className="zp-sum__rule" aria-hidden="true" />
        <Fig label="Net realised P&L" value={kite(shown.net, { signed: true })} cls={tone(shown.net)} tip={`Realised P&L − Charges & taxes: ₹${full(shown.net)}.`} />
        <Fig label="Unrealised P&L" value={u.total === null ? "—" : kite(u.total, { signed: true })} cls={tone(u.total)} tip={`Profit or loss on positions not yet closed: ${u.why}.`} />
      </dl>
      {cv && (
        <div className="zp-recon" role="note">
          <p className="zp-recon__text">
            {asConsole ? (
              <>
                Shown <b>as Zerodha Console shows it</b> until its overnight update: without today’s {cv.today.trades} trade{cv.today.trades === 1 ? "" : "s"}{" "}
                (realised <span className={tone(cv.today.gross)}>{signedFull(cv.today.gross)}</span>, charges ₹{full(cv.today.charges)}).
              </>
            ) : (
              <>
                Includes <b>today’s {cv.today.trades} trade{cv.today.trades === 1 ? "" : "s"}</b>: realised <span className={tone(cv.today.gross)}>{signedFull(cv.today.gross)}</span>, charges ₹{full(cv.today.charges)}. Zerodha Console adds a day’s trades after its overnight update, so until then it shows realised{" "}
                <span className={tone(cv.console.gross)}>{signedFull(cv.console.gross)}</span> · charges ₹{full(cv.console.charges)} · net <span className={tone(cv.console.net)}>{signedFull(cv.console.net)}</span>.
              </>
            )}{" "}
            <span className="zp-recon__fine">Charges here are worked out from Zerodha’s published rates; Console uses the contract notes, so they can differ by a few rupees.</span>
          </p>
          <div className="sv__ranges zp-recon__pick" role="group" aria-label="Which figures to show">
            <button type="button" aria-pressed={!asConsole} onClick={() => setAsConsole(false)}>
              Including today
            </button>
            <button type="button" aria-pressed={asConsole} onClick={() => setAsConsole(true)}>
              As in Console
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ per symbol */
const COLS = [
  ["key", "Symbol", false],
  ["qty", "Qty.", true],
  ["buyAvg", "Buy avg.", true],
  ["buyValue", "Buy value", true],
  ["sellAvg", "Sell avg.", true],
  ["sellValue", "Sell value", true],
  ["gross", "Realised P&L", true],
  ["unrealised", "Unrealised P&L", true],
];

export function PnlBySymbol({ rows, unrealised, onCsv, updated }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "key", dir: "asc" });
  const u = useMemo(() => (unrealised && unrealised.bySymbol) || new Map(), [unrealised]);
  const list = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const withU = (rows || []).map((r) => ({ ...r, unrealised: u.has(r.key) ? u.get(r.key) : null }));
    // a stock held open with nothing closed in the period still has a row, as in Zerodha's report
    for (const [sym, v] of u) if (!withU.some((r) => r.key === sym)) withU.push({ key: sym, qty: 0, buyAvg: null, buyValue: null, sellAvg: null, sellValue: null, gross: 0, unrealised: v });
    const shown = needle ? withU.filter((r) => String(r.key).toUpperCase().includes(needle)) : withU;
    const val = (r) => r[sort.key];
    return shown.slice().sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "string" ? x.localeCompare(y) : (isNum(x) ? x : -Infinity) - (isNum(y) ? y : -Infinity);
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, q, sort, u]);
  const pick = (key) => setSort((cur) => ({ key, dir: cur.key === key ? (cur.dir === "asc" ? "desc" : "asc") : key === "key" ? "asc" : "desc" }));
  return (
    <section className="zp-card" aria-label="P&L by symbol">
      <header className="zp-card__bar">
        <p className="zp-card__info">
          Showing {list.length} symbol{list.length === 1 ? "" : "s"}
          {updated ? <> · Last updated: {updated}</> : null}
        </p>
        <label className="zp-search">
          <span className="adm-sr">Search a symbol</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        </label>
        {onCsv && (
          <button type="button" className="zp-link" onClick={() => onCsv(list)}>
            Download
          </button>
        )}
      </header>
      {list.length === 0 ? (
        <p className="zp-empty">No trades in this period{q ? " match the search" : ""}.</p>
      ) : (
        <div className="bt__scroll">
          <table className="zp-table">
            <thead>
              <tr>
                {COLS.map(([key, label, isNumCol]) => (
                  <th key={key} scope="col" className={isNumCol ? "is-num" : ""} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => pick(key)}>
                      {label}
                      <span aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? " ˄" : " ˅") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.key}</th>
                  <td className="is-num">{r.qty || "—"}</td>
                  <td className="is-num">{full(r.buyAvg)}</td>
                  <td className="is-num">{full(r.buyValue)}</td>
                  <td className="is-num">{full(r.sellAvg)}</td>
                  <td className="is-num">{full(r.sellValue)}</td>
                  <td className={`is-num ${tone(r.gross)}`}>
                    {r.qty ? signedFull(r.gross) : "—"}
                    {r.qty && isNum(r.buyValue) && r.buyValue > 0 ? <small> {r.gross > 0 ? "+" : r.gross < 0 ? "−" : ""}{(Math.abs(r.gross / r.buyValue) * 100).toFixed(2)}%</small> : null}
                  </td>
                  <td className={`is-num ${tone(r.unrealised)}`}>{isNum(r.unrealised) ? signedFull(r.unrealised) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
