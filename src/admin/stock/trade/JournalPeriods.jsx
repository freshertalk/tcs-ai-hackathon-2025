// The Journal's periods and analytics: the period picker (today … every financial year, all time,
// a custom range, your saved views), profit and loss for every period at once, the financial-year
// chart, the month heatmap across all years, month-by-month and day-by-day tables, where the history
// comes from (automatic capture from Kite, Console tradebook imports, gaps), and CSV downloads of
// everything for your own analysis. Nothing here is typed in: every figure comes from Zerodha's fills.

import React, { useMemo, useState } from "react";
import { api } from "../../api";
import { Alert } from "../../ui";
import { isNum, num } from "../analyzer/format";

export const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
export const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (k) => (k ? `${Number(k.slice(8))} ${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : "");
export const monthLabel = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const pf = (x) => (x === null ? "∞" : isNum(x) ? num(x) : "—");
/** ₹ in thousands, lakhs and crores, signed: +₹12.3k, −₹1.25L, +₹2.1Cr */
export function compact(x) {
  if (!isNum(x)) return "";
  const a = Math.abs(x);
  const s = x > 0 ? "+" : x < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}₹${Math.round(a)}`;
}

/* ---------------------------------------------------------------------------- CSV download */
const cell = (v) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function downloadCsv(name, head, rows) {
  const text = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const PERIOD_HEAD = ["Period", "From", "To", "Trades", "Won", "Win rate %", "Gross P&L", "Brokerage", "Taxes", "Charges", "Net P&L", "Profit factor", "Expectancy", "Avg win", "Avg loss", "Max drawdown", "Days traded", "Green days", "Best day", "Best day net", "Worst day", "Worst day net", "Charges % of gross"];
export const periodCsvRow = (r) => [r.label, r.fromDay || "", r.toDay, r.trades, r.wins, r.winRate, r.gross, r.brokerage, r.taxes, r.charges, r.net, r.profitFactor === null ? "inf" : r.profitFactor, r.expectancy, r.avgWin, r.avgLoss, r.maxDrawdown, r.days, r.greenDays, r.bestDay ? r.bestDay.day : "", r.bestDay ? r.bestDay.net : "", r.worstDay ? r.worstDay.day : "", r.worstDay ? r.worstDay.net : "", r.chargesPct === null ? "" : r.chargesPct];

/* ------------------------------------------------------------------------------ the picker */
export const QUICK = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "This week"],
  ["month", "This month"],
  ["quarter", "This quarter"],
  ["6m", "6 months"],
  ["9m", "9 months"],
  ["12m", "12 months"],
  ["fy", "This FY"],
  ["all", "All time"],
];

export function PeriodBar({ sel, setSel, fys, views, filters, onViews }) {
  const [custom, setCustom] = useState({ from: sel.from || "", to: sel.to || "" });
  const [showCustom, setShowCustom] = useState(sel.period === "custom");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const pastFy = sel.period.startsWith("fy-") ? sel.period : "";
  const save = async () => {
    setErr("");
    try {
      const d = await api("/api/admin/trading/journal/views", { method: "POST", body: { name, period: sel.period, from: sel.from, to: sel.to, ...filters } });
      onViews(d.views);
      setNaming(false);
      setName("");
    } catch (e) {
      setErr(e.message);
    }
  };
  const drop = async (id) => {
    const d = await api(`/api/admin/trading/journal/views/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (d) onViews(d.views);
  };
  return (
    <div className="jp-bar">
      <div className="jp-chips" role="group" aria-label="Period">
        {QUICK.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={sel.period === id}
            onClick={() => {
              setShowCustom(false);
              setSel({ period: id, from: "", to: "" });
            }}
          >
            {label}
          </button>
        ))}
        {fys.length > 0 && (
          <label className={`jp-sel ${pastFy ? "is-on" : ""}`}>
            <span className="adm-sr">Past financial year</span>
            <select
              value={pastFy}
              onChange={(e) => {
                if (!e.target.value) return;
                setShowCustom(false);
                setSel({ period: e.target.value, from: "", to: "" });
              }}
            >
              <option value="">Past FYs ▾</option>
              {fys.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" aria-pressed={sel.period === "custom"} onClick={() => setShowCustom((x) => !x)} aria-expanded={showCustom}>
          Custom…
        </button>
      </div>
      {showCustom && (
        <form
          className="jp-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.from && custom.to) setSel({ period: "custom", from: custom.from, to: custom.to });
          }}
        >
          <label>
            <span>From</span>
            <input type="date" value={custom.from} max={custom.to || today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} required />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={custom.to} min={custom.from || undefined} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} required />
          </label>
          <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={!custom.from || !custom.to || custom.from > custom.to}>
            Show
          </button>
        </form>
      )}
      <div className="jp-views">
        {views.length > 0 && (
          <label className="jp-sel">
            <span className="adm-sr">Your saved views</span>
            <select
              value=""
              onChange={(e) => {
                const v = views.find((x) => x.id === e.target.value);
                if (v) {
                  setShowCustom(v.period === "custom");
                  setCustom({ from: v.from, to: v.to });
                  setSel({ period: v.period, from: v.from, to: v.to, view: v });
                }
              }}
            >
              <option value="">Your saved views ({views.length}) ▾</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {naming ? (
          <form
            className="jp-name"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name this view" autoFocus aria-label="Name of the view" />
            <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={!name.trim()}>
              Save
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setNaming(true)} data-tip="Save this period and these filters under a name, in the database, to open again in one click.">
            ☆ Save this view
          </button>
        )}
        {sel.view && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => drop(sel.view.id)} data-tip="Delete this saved view (the trades are not touched).">
            Delete “{sel.view.name}”
          </button>
        )}
      </div>
      <Alert>{err}</Alert>
    </div>
  );
}

/* ---------------------------------------------------------- P&L for every period at once */
export function PeriodTable({ per, sel, onPick }) {
  const rows = [...per.rows, ...per.fys, ...(per.all ? [per.all] : [])];
  return (
    <section className="an-card jp-card">
      <header className="jp-head">
        <div>
          <h3 className="jr-h">Profit and loss by period</h3>
          <p className="vd-note">Every period at once, each trade on the day it was closed, after estimated charges. Click a row to open it below.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`pnl-by-period-${per.today}.csv`, PERIOD_HEAD, rows.map(periodCsvRow))} data-tip="Every period and financial year with all its figures, as a CSV for Excel or Sheets.">
          ⤓ CSV
        </button>
      </header>
      <div className="bt__scroll">
        <table className="an-table jp-table">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col" className="is-num">
                Trades
              </th>
              <th scope="col" className="is-num">
                Win %
              </th>
              <th scope="col" className="is-num">
                Gross
              </th>
              <th scope="col" className="is-num" data-tip="Brokerage and taxes (an estimate from Zerodha's published rates).">
                Charges
              </th>
              <th scope="col" className="is-num">
                Net P&amp;L
              </th>
              <th scope="col" className="is-num">
                Profit factor
              </th>
              <th scope="col" className="is-num" data-tip="The largest fall from a high inside the period.">
                Drawdown
              </th>
              <th scope="col">Best / worst day</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`${sel === r.id ? "is-sel" : ""} ${r.id.startsWith("fy-") && rows[i - 1] && !rows[i - 1].id.startsWith("fy-") ? "is-break" : ""} ${r.trades ? "" : "is-empty"}`} onClick={() => onPick(r.id)} tabIndex={0} onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(r.id);
                }
              }} aria-label={`${r.label}: net ${sMoney(r.net)}`}>
                <th scope="row">
                  {r.label}
                  <small>{r.fromDay ? (r.fromDay === r.toDay ? dayLabel(r.toDay) : `${dayLabel(r.fromDay)} – ${dayLabel(r.toDay)}`) : ""}</small>
                </th>
                <td className="is-num">{r.trades || "—"}</td>
                <td className="is-num">{r.trades ? `${num(r.winRate, 0)}%` : "—"}</td>
                <td className={`is-num ${tone(r.gross)}`}>{r.trades ? sMoney(r.gross) : "—"}</td>
                <td className="is-num">{r.trades ? sMoney(-r.charges) : "—"}</td>
                <td className={`is-num jp-net ${tone(r.net)}`}>{r.trades ? sMoney(r.net) : "—"}</td>
                <td className={`is-num ${r.profitFactor !== null && r.profitFactor < 1 && r.trades ? "is-down" : ""}`}>{r.trades ? pf(r.profitFactor) : "—"}</td>
                <td className="is-num">{r.trades && r.maxDrawdown ? sMoney(-r.maxDrawdown) : "—"}</td>
                <td>
                  {r.bestDay && <span className="is-up">{compact(r.bestDay.net)}</span>}
                  {r.bestDay && r.worstDay && " / "}
                  {r.worstDay && <span className="is-down">{compact(r.worstDay.net)}</span>}
                  {!r.bestDay && !r.worstDay && "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ net P&L per financial year */
export function FyChart({ per, onPick }) {
  const [hover, setHover] = useState(null);
  const cur = per.rows.find((r) => r.id === "fy");
  const bars = [...per.fys].reverse().concat(cur ? [{ ...cur, label: `${cur.label.replace("This FY (", "FY ").replace(")", "")} so far` }] : []).filter((b) => b);
  if (bars.length < 2 || !bars.some((b) => b.trades)) return null;
  const W = 800;
  const H = 230;
  const pad = { l: 70, r: 12, t: 22, b: 40 };
  const lo0 = Math.min(0, ...bars.map((b) => b.net));
  const hi0 = Math.max(0, ...bars.map((b) => b.net));
  const room = (hi0 - lo0 || 1) * 0.16; // space for the value labels above and below the bars
  const lo = lo0 < 0 ? lo0 - room : 0;
  const hi = hi0 > 0 ? hi0 + room : 0;
  const span = hi - lo || 1;
  const y = (v) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / bars.length;
  const bw = Math.min(56, slot * 0.6);
  const h = hover !== null ? bars[hover] : null;
  return (
    <section className="an-card jp-card">
      <h3 className="jr-h">Net P&amp;L by financial year</h3>
      <svg className="jp-fy" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Net profit and loss for ${bars.length} financial years`}>
        {[lo0, hi0].filter((v, i, a) => a.indexOf(v) === i && v !== 0).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="jr-eq__grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="jr-eq__axis">
              {compact(t)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="jr-eq__zero" />
        <text x={pad.l - 6} y={y(0) + 4} textAnchor="end" className="jr-eq__axis">
          ₹0
        </text>
        {bars.map((b, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const top = y(Math.max(0, b.net));
          const height = Math.max(b.trades ? 2 : 0, Math.abs(y(b.net) - y(0)));
          return (
            <g key={b.id} className={`jp-fy__bar ${hover === i ? "is-hover" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick(b.id)} role="button" tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onKeyDown={(e) => e.key === "Enter" && onPick(b.id)} aria-label={`${b.label}: net ${sMoney(b.net)}, ${b.trades} trades`}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={H - pad.t - pad.b} className="jp-fy__hit" />
              <rect x={cx - bw / 2} y={top} width={bw} height={height} rx="4" className={b.net >= 0 ? "is-up" : "is-down"} />
              {b.trades > 0 && (
                <text x={cx} y={b.net >= 0 ? top - 6 : top + height + 14} textAnchor="middle" className="jp-fy__val">
                  {compact(b.net)}
                </text>
              )}
              <text x={cx} y={H - pad.b + 16} textAnchor="middle" className="jr-eq__axis">
                {b.label.replace("FY ", "")}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="jp-cap" aria-live="polite">
        {h ? (
          <>
            <b>{h.label}</b> · {h.trades} trades · win {num(h.winRate, 0)}% · gross {sMoney(h.gross)} · charges {sMoney(-h.charges)} · net <b className={tone(h.net)}>{sMoney(h.net)}</b>
          </>
        ) : (
          "Point at a year for its figures; click to open it."
        )}
      </p>
    </section>
  );
}

/* --------------------------------------------------- months of every financial year */
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
export function MonthHeatmap({ per, onMonth }) {
  const byKey = useMemo(() => new Map(per.months.map((m) => [m.month, m])), [per.months]);
  const curFy = (() => {
    const [y, m] = per.today.split("-").map(Number);
    return m >= 4 ? y : y - 1;
  })();
  const startDay = per.accountSince || per.firstDay;
  if (!startDay || !per.months.length) return null;
  const firstFy = (() => {
    const [y, m] = startDay.split("-").map(Number);
    return m >= 4 ? y : y - 1;
  })();
  const years = [];
  for (let y = curFy; y >= firstFy && years.length < 30; y -= 1) years.push(y);
  const max = Math.max(...per.months.map((m) => Math.abs(m.net)), 1);
  return (
    <section className="an-card jp-card">
      <header className="jp-head">
        <div>
          <h3 className="jr-h">Every month since the start</h3>
          <p className="vd-note">Net P&amp;L of each month (by the day trades were closed). Deeper colour, larger result. Click a month to open it.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`pnl-by-month-${per.today}.csv`, ["Month", "Financial year", "Trades", "Win rate %", "Gross P&L", "Charges", "Net P&L", "Profit factor"], [...per.months].reverse().map((m) => [m.month, `FY ${m.fy}-${String((m.fy + 1) % 100).padStart(2, "0")}`, m.trades, m.winRate, m.gross, m.charges, m.net, m.profitFactor === null ? "inf" : m.profitFactor]))}>
          ⤓ CSV
        </button>
      </header>
      <div className="bt__scroll">
        <table className="jp-heat">
          <thead>
            <tr>
              <th scope="col">FY</th>
              {FY_MONTHS.map((m) => (
                <th key={m} scope="col">
                  {MONTHS[m - 1]}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              let total = 0;
              let any = false;
              return (
                <tr key={y}>
                  <th scope="row">{`${y}-${String((y + 1) % 100).padStart(2, "0")}`}</th>
                  {FY_MONTHS.map((m) => {
                    const key = `${m >= 4 ? y : y + 1}-${String(m).padStart(2, "0")}`;
                    const d = byKey.get(key);
                    if (d) {
                      total += d.net;
                      any = true;
                    }
                    const future = key > per.today.slice(0, 7);
                    return (
                      <td key={m} className={d ? (d.net >= 0 ? "is-up" : "is-down") : future ? "is-future" : ""} style={d ? { "--a": 0.15 + 0.85 * Math.min(1, Math.abs(d.net) / max) } : undefined}>
                        {d ? (
                          <button type="button" onClick={() => onMonth(key)} title={`${monthLabel(key)}: ${d.trades} trades · win ${num(d.winRate, 0)}% · net ${sMoney(d.net)}`}>
                            {compact(d.net)}
                          </button>
                        ) : (
                          <span aria-label={`${monthLabel(key)}: no trades`}>{future ? "" : "·"}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={`jp-heat__tot ${tone(any ? total : null)}`}>{any ? compact(total) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------- the selected period, month by month */
export function MonthTable({ months, label }) {
  if (!months || months.length < 2) return null;
  const max = Math.max(...months.map((m) => Math.abs(m.net)), 1);
  return (
    <section className="an-card jp-card">
      <header className="jp-head">
        <h3 className="jr-h">Month by month</h3>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`months-${label}.csv`, ["Month", "Trades", "Won", "Win rate %", "Gross P&L", "Brokerage", "Taxes", "Charges", "Net P&L", "Profit factor", "Expectancy", "Max drawdown", "Days traded", "Green days"], months.map((m) => [m.month, m.trades, m.wins, m.winRate, m.gross, m.brokerage, m.taxes, m.charges, m.net, m.profitFactor === null ? "inf" : m.profitFactor, m.expectancy, m.maxDrawdown, m.days, m.greenDays]))}>
          ⤓ CSV
        </button>
      </header>
      <div className="bt__scroll">
        <table className="an-table jp-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="is-num">
                Trades
              </th>
              <th scope="col" className="is-num">
                Win %
              </th>
              <th scope="col" className="is-num">
                Gross
              </th>
              <th scope="col" className="is-num">
                Charges
              </th>
              <th scope="col" className="is-num">
                Net
              </th>
              <th scope="col" className="is-num">
                PF
              </th>
              <th scope="col" className="is-num">
                Green days
              </th>
              <th scope="col">
                <span className="adm-sr">Bar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthLabel(m.month)}</th>
                <td className="is-num">{m.trades}</td>
                <td className="is-num">{num(m.winRate, 0)}%</td>
                <td className={`is-num ${tone(m.gross)}`}>{sMoney(m.gross)}</td>
                <td className="is-num">{sMoney(-m.charges)}</td>
                <td className={`is-num jp-net ${tone(m.net)}`}>{sMoney(m.net)}</td>
                <td className="is-num">{pf(m.profitFactor)}</td>
                <td className="is-num">
                  {m.greenDays}/{m.days}
                </td>
                <td className="jr-bd__bar">
                  <i className={m.net >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(m.net) / max) * 100}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --------------------------------------------------- the selected period, day by day */
const DAY_ROWS = 20;
export function DayTable({ days, label }) {
  const [all, setAll] = useState(false);
  if (!days || !days.length) return null;
  const list = [...days].sort((a, b) => (a.key < b.key ? 1 : -1));
  return (
    <section className="an-card jp-card">
      <header className="jp-head">
        <h3 className="jr-h">Day by day ({list.length} trading day{list.length === 1 ? "" : "s"})</h3>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`days-${label}.csv`, ["Date", "Trades", "Won", "Win rate %", "Gross P&L", "Brokerage", "Taxes", "Charges", "Net P&L"], list.map((d) => [d.key, d.trades, d.wins, d.winRate, d.gross, d.brokerage, d.taxes, d.charges, d.net]))}>
          ⤓ CSV
        </button>
      </header>
      <div className="bt__scroll">
        <table className="an-table jp-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="is-num">
                Trades
              </th>
              <th scope="col" className="is-num">
                Win %
              </th>
              <th scope="col" className="is-num">
                Gross
              </th>
              <th scope="col" className="is-num">
                Brokerage
              </th>
              <th scope="col" className="is-num">
                Taxes
              </th>
              <th scope="col" className="is-num">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {(all ? list : list.slice(0, DAY_ROWS)).map((d) => (
              <tr key={d.key}>
                <th scope="row">{new Date(`${d.key}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</th>
                <td className="is-num">{d.trades}</td>
                <td className="is-num">{num(d.winRate, 0)}%</td>
                <td className={`is-num ${tone(d.gross)}`}>{sMoney(d.gross)}</td>
                <td className="is-num">{sMoney(-d.brokerage)}</td>
                <td className="is-num">{sMoney(-d.taxes)}</td>
                <td className={`is-num jp-net ${tone(d.net)}`}>{sMoney(d.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > DAY_ROWS && (
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm jr-more" onClick={() => setAll((a) => !a)}>
          {all ? `Show only the latest ${DAY_ROWS}` : `Show all ${list.length} days`}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------ where the history comes from */
export function Sources({ per, ignoredManual, onImport, importing, onChanged, msg }) {
  const [since, setSince] = useState(per.accountSince || "");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const cap = per.capture;
  const today = per.today;
  const run = async (what, fn) => {
    setBusy(what);
    setErr("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  const snapCsv = async () => {
    const d = await api("/api/admin/trading/journal/snapshots");
    const head = ["Saved on", ...(d.columns || [])];
    const rows = Object.entries(d.days || {})
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .flatMap(([k, v]) => v.rows.map((r) => [k, ...r]));
    downloadCsv(`pnl-snapshots-${today}.csv`, head, rows);
  };
  return (
    <section className="an-card jp-card jp-src">
      <h3 className="jr-h">Where the history comes from</h3>
      <div className="jp-src__grid">
        <div>
          <h4>Every day, by itself, from Kite</h4>
          <p>
            Zerodha’s Kite API gives only the <b>current day’s</b> trades — it has no way to fetch past trades or past P&amp;L. So the server reads today’s trades every {cap ? cap.everyMin : 5} minutes on weekdays (9:10 AM to midnight) while Zerodha is connected, with no page open. Log in to Kite each trading day, even in the evening, and that day is saved.
          </p>
          <p className="jp-src__st">
            <span className={`jp-dot ${cap && cap.connected ? "is-on" : ""}`} /> {cap ? (cap.connected ? "Zerodha connected" : "Zerodha not connected — today is not being read") : "Capture is off on this server"}
            {cap && cap.at ? ` · last read ${new Date(cap.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${cap.error ? ` — ${cap.error}` : ` (${cap.trades} trade${cap.trades === 1 ? "" : "s"} today)`}` : ""}
          </p>
          <p className="vd-note">
            {per.sources.kite.toLocaleString("en-IN")} fills captured from Kite on {per.sources.capturedDays} day{per.sources.capturedDays === 1 ? "" : "s"}.
          </p>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy) || !cap} onClick={() => run("cap", () => api("/api/admin/trading/journal/capture", { method: "POST" }))}>
            {busy === "cap" ? "Reading…" : "Read today’s trades now"}
          </button>
        </div>
        <div>
          <h4>Before that, from Zerodha Console (once)</h4>
          <p>
            For everything since your account opened: on <b>console.zerodha.com</b> go to Reports → Tradebook, choose Equity, pick one financial year (1 April to 31 March) and download the CSV. Do it for each year, then drop all the files here at once. Repeats are ignored, so importing again is safe.
          </p>
          <label className="adm-btn adm-btn--solid adm-btn--sm jr-file">
            {importing ? "Importing…" : "Import Console tradebook files"}
            <input type="file" accept=".csv,text/csv" multiple onChange={(e) => onImport([...(e.target.files || [])])} disabled={importing} />
          </label>
          <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
          {per.sources.imports.length > 0 && (
            <ul className="jp-imports">
              {per.sources.imports.slice(0, 8).map((i, k) => (
                <li key={k}>
                  {new Date(i.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}: {i.added} new of {i.total}
                  {i.fromDay ? ` · trades ${dayLabel(i.fromDay)} – ${dayLabel(i.toDay)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4>Since when</h4>
          <p>
            First trade on record: <b>{per.firstDay ? dayLabel(per.firstDay) : "none yet"}</b>. Kite’s API does not tell when the account was opened; give the date and every financial year since then is listed (empty years show what is still to import).
          </p>
          <form
            className="jp-since"
            onSubmit={(e) => {
              e.preventDefault();
              run("since", () => api("/api/admin/trading/journal/account-since", { method: "PUT", body: { date: since } }));
            }}
          >
            <label>
              <span>Account opened</span>
              <input type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} />
            </label>
            <button type="submit" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy) || since === (per.accountSince || "")}>
              {busy === "since" ? "Saving…" : "Save"}
            </button>
          </form>
          <p className="vd-note">
            Saved in the database: every period’s P&amp;L each day it changes ({per.snapshots ? per.snapshots.days : 0} day{per.snapshots && per.snapshots.days === 1 ? "" : "s"} so far){" "}
            <button type="button" className="ta-link" onClick={snapCsv}>
              download all
            </button>
            .
          </p>
        </div>
      </div>
      {per.gaps.length > 0 && (
        <div className="jp-gaps">
          <h4>Gaps: weekdays with nothing on record</h4>
          <ul>
            {per.gaps.map((g) => (
              <li key={g.fromDay}>
                {dayLabel(g.fromDay)} – {dayLabel(g.toDay)} <small>({g.weekdays} weekdays)</small>
              </li>
            ))}
          </ul>
          <p className="vd-note">If you traded then, import that financial year’s tradebook from Console. If you did not trade, there is nothing to do.</p>
        </div>
      )}
      {ignoredManual > 0 && <p className="vd-note">{ignoredManual} fill{ignoredManual === 1 ? "" : "s"} typed in by hand in an earlier version {ignoredManual === 1 ? "is" : "are"} kept in the record but no longer counted: every figure now comes from Zerodha.</p>}
      <Alert>{err}</Alert>
    </section>
  );
}
