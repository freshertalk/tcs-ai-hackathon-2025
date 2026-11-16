// The Trading journal's workspace pieces: the sticky command bar (the period's headline figures and the tabs
// stay in view while the page scrolls), the Returns tab (the capital ledger and every percentage measured on
// the principal), and the printable report. Every figure still comes from Zerodha's fills; the only thing the
// trader types is the money put in or taken out, because Zerodha's API does not say.

import React, { useState } from "react";
import { api } from "../../api";
import { Alert } from "../../ui";
import { isNum, num } from "../analyzer/format";
import { LineChart } from "../analysis/charts";
import { downloadCsv } from "./JournalPeriods";
import "./journal-pro.css";

const IST = 5.5 * 3600 * 1000;
const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
export const dayName = (k) => (k ? `${Number(k.slice(8))} ${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : "—");
export const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
/** Principal figures: whole rupees. */
export const rupees = (x) => (isNum(x) ? `₹${num(Math.abs(x), 0)}` : "—");
export const pctText = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%` : "—");
export const toneOf = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");

/** Save any object as a JSON file. */
export function downloadJson(name, obj) {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (_) {
    /* the browser refused the download */
  }
}

/** What the period's principal is, in a few words, for the headline and the bar. */
export function principalNote(rt) {
  if (!rt || !rt.hasCapital) return "";
  const scored = rt.months.filter((m) => isNum(m.pct) && isNum(m.base)); // a month before the first capital has no return
  const bases = scored.map((m) => m.base);
  if (!bases.length) return "";
  if (scored.length === 1) {
    const m = scored[0];
    return `of your ${rupees(m.base)} principal${m.additions.length ? ` (${rupees(m.startPrincipal)} on the first trading day, ${m.additions.length === 1 ? "an addition" : `${m.additions.length} additions`} counted from the day ${m.additions.length === 1 ? "it was" : "they were"} made)` : ""}`;
  }
  return `summed over ${scored.length} months, each on its own principal (${rupees(Math.min(...bases))}–${rupees(Math.max(...bases))})`;
}

/* ------------------------------------------------------------------------------ the command bar */

export const TABS = [
  { id: "overview", label: "Overview", key: "1" },
  { id: "returns", label: "Returns", key: "2", tip: "Percentage returns on your principal, the capital you put in, and the risk ratios." },
  { id: "performance", label: "Performance", key: "3", tip: "Win rate, costs, hold times, streaks and where the money is made and lost." },
  { id: "trades", label: "Trades", key: "4", tip: "Every round trip: search, sort, tag, export." },
  { id: "calendar", label: "Calendar", key: "5", tip: "Every day and month, every period and financial year." },
  { id: "reports", label: "Reports", key: "6", tip: "Print or save a report, download the data, the AI review and where the history comes from." },
];

/** The strip that stays under the top bar while the page scrolls: the period's headline figures and the tabs. */
export function CommandBar({ label, s, rt, tab, setTab, counts = {}, updatedAt, loading, onRefresh, onTop, gaps = 0 }) {
  const cap = rt && rt.hasCapital;
  return (
    <div className="jr-cmd" role="region" aria-label="The period at a glance">
      <div className="jr-cmd__row">
        <button type="button" className="jr-cmd__period" onClick={onTop} data-tip="Back to the period and filters.">
          <small>Period</small>
          <b>{label || "—"}</b>
        </button>
        <dl className="jr-cmd__kpis">
          <div className={toneOf(s && s.net)}>
            <dt>Net P&amp;L</dt>
            <dd>{s ? sMoney(s.net) : "—"}</dd>
          </div>
          <div className={cap ? toneOf(rt.totalPct) : ""}>
            <dt>Return</dt>
            <dd>
              {cap ? (
                pctText(rt.totalPct)
              ) : (
                <button type="button" className="jr-link" onClick={() => setTab("returns")}>
                  add capital
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{s ? `${num(s.winRate, 0)}%` : "—"}</dd>
          </div>
          <div className="jr-cmd__more">
            <dt>Profit factor</dt>
            <dd>{s ? (s.profitFactor === null ? "∞" : num(s.profitFactor)) : "—"}</dd>
          </div>
          <div className="jr-cmd__more">
            <dt>Max drawdown</dt>
            <dd className="is-down">{s ? sMoney(-s.maxDrawdown) : "—"}</dd>
          </div>
          <div className="jr-cmd__more">
            <dt>Trades</dt>
            <dd>{s ? s.trades : "—"}</dd>
          </div>
        </dl>
        <div className="jr-cmd__tools">
          {gaps > 0 && (
            <button type="button" className="jr-chip jr-chip--warn" onClick={() => setTab("reports")} data-tip="Weekdays with nothing on record: import the Console tradebook for them.">
              {gaps} gap{gaps === 1 ? "" : "s"} in the history
            </button>
          )}
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRefresh} disabled={loading} data-tip="Read the journal again (it also refreshes by itself every minute).">
            {loading ? "Reading…" : "↻"}
          </button>
          {updatedAt && <small className="jr-cmd__at">{new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</small>}
        </div>
      </div>
      <nav className="jr-tabs" role="tablist" aria-label="Journal sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-tip={t.tip ? `${t.tip} (key ${t.key})` : `Key ${t.key}`}>
            {t.label}
            {counts[t.id] ? <small>{counts[t.id]}</small> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------------------- the Returns tab */

const Tile = ({ label, value, sub, cls = "", tip }) => (
  <div className={`jp2-tile ${cls}`} data-tip={tip}>
    <dt>{label}</dt>
    <dd>{value}</dd>
    {sub ? <small>{sub}</small> : null}
  </div>
);

function Ledger({ capital, onChanged }) {
  const [form, setForm] = useState({ date: todayIst(), kind: "add", amount: "", note: "" });
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const first = !capital.length;
  const save = async (e) => {
    e.preventDefault();
    const amt = Number(String(form.amount).replace(/,/g, ""));
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      await api("/api/admin/trading/journal/capital", { method: "POST", body: { date: form.date, amount: form.kind === "take" ? -Math.abs(amt) : Math.abs(amt), note: form.note } });
      setForm((f) => ({ ...f, amount: "", note: "" }));
      setMsg({ kind: "ok", text: "Saved. Every percentage has been worked out again." });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    setBusy(true);
    try {
      await api(`/api/admin/trading/journal/capital/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMsg({ kind: "ok", text: "Removed." });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  };
  let run = 0;
  const rows = capital.map((e) => {
    run += e.amount;
    return { ...e, balance: run };
  });
  return (
    <section className="an-card jp2-ledger">
      <header className="jp-head">
        <h3 className="jr-h">Your capital</h3>
      </header>
      <p className="jc-info">
        Every percentage on this page is measured on the money you put in — your principal — not on your margin. Enter the first amount you traded with, and every later addition or withdrawal on the day it happened. A month&rsquo;s return uses the principal on its first trading day, and an addition counts from the day it was made. Profit is not added to the principal.
      </p>
      <form className="jp2-form" onSubmit={save}>
        <label>
          <span>Day</span>
          <input type="date" value={form.date} max={todayIst()} onChange={(e) => set("date", e.target.value)} required />
        </label>
        <label>
          <span>What happened</span>
          <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="add">{first ? "First capital" : "Money added"}</option>
            <option value="take">Money taken out</option>
          </select>
        </label>
        <label>
          <span>Amount (₹)</span>
          <input type="text" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="100000" required />
        </label>
        <label className="jp2-form__note">
          <span>Note (optional)</span>
          <input type="text" maxLength={120} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. salary saved" />
        </label>
        <button type="submit" className="adm-btn adm-btn--sm" disabled={busy || !form.amount}>
          {busy ? "Saving…" : "Add to the ledger"}
        </button>
      </form>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      {rows.length === 0 ? (
        <p className="ta-empty">Nothing recorded yet. Add the capital you started with, and the journal shows every return in percent.</p>
      ) : (
        <div className="bt__scroll">
          <table className="an-table jp-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="is-num">
                  Amount
                </th>
                <th scope="col" className="is-num">
                  Principal after
                </th>
                <th scope="col">Note</th>
                <th scope="col">
                  <span className="adm-sr">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{dayName(e.date)}</th>
                  <td className={`is-num ${toneOf(e.amount)}`}>{sMoney(e.amount)}</td>
                  <td className="is-num">{rupees(e.balance)}</td>
                  <td>{e.note}</td>
                  <td>
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => remove(e.id)} aria-label={`Remove the entry of ${dayName(e.date)}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ReturnsTab({ rt, capital, label, onChanged }) {
  const cap = rt && rt.hasCapital;
  const k = rt ? rt.risk : null;
  return (
    <div className="jp2">
      {!cap && (
        <p className="adm-alert adm-alert--info" role="status">
          <b>Add your capital to see returns in percent.</b> The journal measures every percentage on the principal you put in. Add it below — the first amount you traded with, and any later addition on the day it was made.
        </p>
      )}
      {cap && (
        <>
          <dl className="jp2-tiles">
            <Tile label="Total return" value={pctText(rt.totalPct)} cls={toneOf(rt.totalPct)} sub={principalNote(rt)} tip="The period's net profit after charges over the principal, month by month, added up." />
            <Tile label="Average a month" value={pctText(rt.avgMonthPct)} cls={toneOf(rt.avgMonthPct)} sub={`${rt.greenMonths} of ${rt.months.filter((m) => isNum(m.pct)).length} months green`} />
            <Tile label="Principal now" value={rupees(rt.principal.now)} sub={rt.principal.added ? `${rupees(rt.principal.added)} added in the period` : "no additions in the period"} />
            <Tile label="Best month" value={rt.bestMonth ? pctText(rt.bestMonth.pct) : "—"} cls="is-up" sub={rt.bestMonth ? monthName(rt.bestMonth.month) : ""} />
            <Tile label="Worst month" value={rt.worstMonth ? pctText(rt.worstMonth.pct) : "—"} cls={rt.worstMonth && rt.worstMonth.pct < 0 ? "is-down" : ""} sub={rt.worstMonth ? monthName(rt.worstMonth.month) : ""} />
            <Tile label="Best day" value={rt.bestDay ? pctText(rt.bestDay.pct) : "—"} cls="is-up" sub={rt.bestDay ? dayName(rt.bestDay.date) : ""} />
            <Tile label="Worst day" value={rt.worstDay ? pctText(rt.worstDay.pct) : "—"} cls={rt.worstDay && rt.worstDay.pct < 0 ? "is-down" : ""} sub={rt.worstDay ? dayName(rt.worstDay.date) : ""} />
          </dl>
          <section className="an-card">
            <header className="jp-head">
              <h3 className="jr-h">Risk and consistency</h3>
              <small className="jp2-dim">from {k.days} daily returns on the principal (a day without trades counts as 0)</small>
            </header>
            <dl className="jp2-tiles">
              <Tile label="Sharpe ratio" value={isNum(k.sharpe) ? k.sharpe.toFixed(2) : "—"} cls={isNum(k.sharpe) ? toneOf(k.sharpe) : ""} sub="return per unit of volatility, annualised" tip="Average daily return over its standard deviation, times the square root of 250. No risk-free rate is taken off." />
              <Tile label="Sortino ratio" value={isNum(k.sortino) ? k.sortino.toFixed(2) : "—"} cls={isNum(k.sortino) ? toneOf(k.sortino) : ""} sub="the same, counting only the down days" />
              <Tile label="Volatility" value={isNum(k.annualVolPct) ? `${k.annualVolPct.toFixed(1)}%` : "—"} sub={isNum(k.volPct) ? `${k.volPct.toFixed(2)}% a day` : ""} />
              <Tile label="Deepest fall" value={isNum(k.maxDrawdownPct) ? `${k.maxDrawdownPct.toFixed(2)} pts` : "—"} cls="is-down" sub="of principal, from the running total's peak" />
              <Tile label="Annualised" value={isNum(k.annualPct) ? pctText(k.annualPct) : "—"} cls={isNum(k.annualPct) ? toneOf(k.annualPct) : ""} sub="the average day × 250" />
              <Tile label="Calmar ratio" value={isNum(k.calmar) ? k.calmar.toFixed(2) : "—"} sub="annualised return over the deepest fall" />
            </dl>
            {k.note && <p className="jp2-dim">{k.note}</p>}
          </section>
          {rt.curve.length > 1 && (
            <section className="an-card">
              <header className="jp-head">
                <h3 className="jr-h">Your running return</h3>
                <small className="jp2-dim">cumulative percentage of principal, day by day</small>
              </header>
              <LineChart xs={rt.curve.map((c) => c.date)} series={[{ label: "Running return", values: rt.curve.map((c) => c.cumPct), c: rt.totalPct >= 0 ? "up" : "down", area: true }]} valueFmt={(v) => pctText(v)} fmt={(v) => `${v}%`} label="Cumulative return on principal" height={230} />
            </section>
          )}
          <section className="an-card jp-card">
            <header className="jp-head">
              <h3 className="jr-h">Month by month, on the principal</h3>
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--sm"
                onClick={() => downloadCsv(`returns-${label || "journal"}.csv`, ["Month", "Principal on first trading day", "Additions", "Base used", "Net P&L", "Return %", "Cumulative %", "Trades"], rt.months.map((m) => [m.month, m.startPrincipal, m.additions.map((a) => `${a.date}: ${a.amount}`).join("; "), m.base, m.net, m.pct, m.cumPct, m.trades]))}
              >
                ⤓ CSV
              </button>
            </header>
            <div className="bt__scroll">
              <table className="an-table jp-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="is-num" data-tip="The principal on the month's first trading day.">
                      Principal day 1
                    </th>
                    <th scope="col" className="is-num">
                      Added in month
                    </th>
                    <th scope="col" className="is-num" data-tip="The principal averaged over the month's weekdays, each at the principal it had that day: an addition counts from its day.">
                      Base
                    </th>
                    <th scope="col" className="is-num">
                      Net P&amp;L
                    </th>
                    <th scope="col" className="is-num">
                      Return
                    </th>
                    <th scope="col" className="is-num">
                      Running
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rt.months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{monthName(m.month)}</th>
                      <td className="is-num">{isNum(m.startPrincipal) ? rupees(m.startPrincipal) : "—"}</td>
                      <td className="is-num">{m.additions.length ? m.additions.map((a) => `${a.amount > 0 ? "+" : "−"}${rupees(a.amount)} on ${Number(a.date.slice(8))}`).join(", ") : "—"}</td>
                      <td className="is-num">{isNum(m.base) ? rupees(m.base) : "—"}</td>
                      <td className={`is-num ${toneOf(m.net)}`}>{sMoney(m.net)}</td>
                      <td className={`is-num jp-net ${toneOf(m.pct)}`}>{pctText(m.pct)}</td>
                      <td className={`is-num ${toneOf(m.cumPct)}`}>{pctText(m.cumPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="jp2-dim">{rt.method}</p>
          </section>
        </>
      )}
      <Ledger capital={capital} onChanged={onChanged} />
    </div>
  );
}

/* ------------------------------------------------------------------------------- the report */

/** A clean, printable report of the period (Print → Save as PDF). Only this prints. */
export function PrintReport({ label, period, s, rt, a, trips, filters }) {
  const bySym = (s && s.by && s.by.symbol) || [];
  const now = new Date();
  return (
    <section className="jr-report" aria-label="Printable report">
      <header>
        <h2>Trading journal report</h2>
        <p>
          <b>{label}</b>
          {period && period.fromDay ? ` · ${dayName(period.fromDay)} – ${dayName(period.toDay)}` : ""} · {filters || "all trades"}
        </p>
        <p className="jr-report__at">Generated {now.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} from Zerodha&rsquo;s fills. Charges are an estimate; your contract note is the truth.</p>
      </header>
      <h3>Summary</h3>
      <table>
        <tbody>
          <tr>
            <th>Net profit / loss (after charges)</th>
            <td>{sMoney(s.net)}</td>
            <th>Return on principal</th>
            <td>{rt && rt.hasCapital ? pctText(rt.totalPct) : "capital not recorded"}</td>
          </tr>
          <tr>
            <th>Gross / charges</th>
            <td>
              {sMoney(s.gross)} / {sMoney(-s.charges)}
            </td>
            <th>Trades · won</th>
            <td>
              {s.trades} · {s.wins} ({num(s.winRate, 1)}%)
            </td>
          </tr>
          <tr>
            <th>Profit factor · expectancy</th>
            <td>
              {s.profitFactor === null ? "∞" : num(s.profitFactor)} · {sMoney(s.expectancy)}
            </td>
            <th>Largest win / loss</th>
            <td>
              {sMoney(s.largestWin)} / {sMoney(s.largestLoss)}
            </td>
          </tr>
          <tr>
            <th>Max drawdown</th>
            <td>{sMoney(-s.maxDrawdown)}</td>
            <th>Trading days · green</th>
            <td>
              {s.tradingDays} · {s.greenDays}
            </td>
          </tr>
          {rt && rt.hasCapital && rt.risk.enough && (
            <tr>
              <th>Sharpe · Sortino</th>
              <td>
                {isNum(rt.risk.sharpe) ? rt.risk.sharpe.toFixed(2) : "—"} · {isNum(rt.risk.sortino) ? rt.risk.sortino.toFixed(2) : "—"}
              </td>
              <th>Deepest fall of principal</th>
              <td>{isNum(rt.risk.maxDrawdownPct) ? `${rt.risk.maxDrawdownPct.toFixed(2)} pts` : "—"}</td>
            </tr>
          )}
        </tbody>
      </table>
      {rt && rt.hasCapital && rt.months.length > 0 && (
        <>
          <h3>Months on the principal</h3>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Principal day 1</th>
                <th>Base</th>
                <th>Net</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              {rt.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthName(m.month)}</td>
                  <td>{isNum(m.startPrincipal) ? rupees(m.startPrincipal) : "—"}</td>
                  <td>{isNum(m.base) ? rupees(m.base) : "—"}</td>
                  <td>{sMoney(m.net)}</td>
                  <td>{pctText(m.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jr-report__at">{rt.method}</p>
        </>
      )}
      {bySym.length > 0 && (
        <>
          <h3>Stocks</h3>
          <table>
            <thead>
              <tr>
                <th>Best</th>
                <th>Net</th>
                <th>Worst</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.min(5, bySym.length) }, (_, i) => (
                <tr key={i}>
                  <td>{bySym[i].key}</td>
                  <td>{sMoney(bySym[i].net)}</td>
                  <td>{bySym[bySym.length - 1 - i].key}</td>
                  <td>{sMoney(bySym[bySym.length - 1 - i].net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {trips.length > 0 && (
        <>
          <h3>Trades (latest {Math.min(trips.length, 100)})</h3>
          <table>
            <thead>
              <tr>
                <th>Closed</th>
                <th>Stock</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry → exit</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {trips.slice(0, 100).map((t) => (
                <tr key={t.key}>
                  <td>{new Date(t.exitAt + IST).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{t.symbol}</td>
                  <td>{t.side}</td>
                  <td>{t.maxQty}</td>
                  <td>
                    {num(t.entryAvg)} → {t.exitAvg === null ? "—" : num(t.exitAvg)}
                  </td>
                  <td>{sMoney(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
