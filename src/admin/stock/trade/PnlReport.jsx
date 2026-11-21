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
 * The unrealised P&L of a period: the live book's open positions when the period reaches today; 0 when nothing in the
 * period is open; otherwise unknown (null).
 * @returns { total: number|null, bySymbol: Map<symbol, number>, why: string }
 */
export function unrealisedOf({ s, period, book, today = istToday() }) {
  const reachesToday = !period || !period.toDay || period.toDay >= today;
  const live = book && book.available && Array.isArray(book.positions);
  if (reachesToday && live) {
    const bySymbol = new Map();
    for (const p of book.positions) if (p && p.quantity !== 0 && isNum(p.unrealised)) bySymbol.set(p.symbol, (bySymbol.get(p.symbol) || 0) + p.unrealised);
    const total = isNum(book.unrealised) ? book.unrealised : [...bySymbol.values()].reduce((a, v) => a + v, 0);
    return { total: Math.round(total * 100) / 100, bySymbol, why: book.live && book.streaming ? "open positions, live with every price" : "open positions, as Zerodha last reported them" };
  }
  if (!s || !s.open) return { total: 0, bySymbol: new Map(), why: "nothing in this period is open" };
  return { total: null, bySymbol: new Map(), why: `${s.open} position${s.open === 1 ? " is" : "s are"} still open; ${reachesToday ? "connect Zerodha to value them" : "they are valued live on the Positions page"}` };
}

/* ------------------------------------------------------------------ the five figures */
export function PnlSummary({ s, unrealised }) {
  const u = unrealised || { total: null, why: "" };
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
        <Fig label="Realised P&L" value={kite(s.gross, { signed: true })} cls={tone(s.gross)} tip={`What the closed trades made or lost before any cost: ₹${full(s.gross)}.`} />
        <Fig label="Charges & taxes" value={kite(s.charges)} tip={`Brokerage, STT, exchange and SEBI fees, GST, stamp duty and DP charge: ₹${full(s.charges)}. An estimate from Zerodha's published rates; your contract note is the truth.`} />
        <Fig label="Other credits & debits" value="—" tip="Ledger entries that are not trades (interest, separately billed DP charges and the like). Zerodha's API does not give them, so they are not counted here; Console's P&L report shows them." />
        <i className="zp-sum__rule" aria-hidden="true" />
        <Fig label="Net realised P&L" value={kite(s.net, { signed: true })} cls={tone(s.net)} tip={`Realised P&L − Charges & taxes: ₹${full(s.net)}.`} />
        <Fig label="Unrealised P&L" value={u.total === null ? "—" : kite(u.total, { signed: true })} cls={tone(u.total)} tip={`Profit or loss on positions not yet closed: ${u.why}.`} />
      </dl>
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
