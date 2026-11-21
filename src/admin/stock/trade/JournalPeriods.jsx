// The Journal's periods and analytics: the period picker (today … every financial year, all time,
// a custom range, your saved views), profit and loss for every period at once, the financial-year
// chart, the month heatmap across all years, month-by-month and day-by-day tables, where the history
// comes from (automatic capture from Kite, Console tradebook imports, gaps), and CSV downloads of
// everything for your own analysis. Nothing here is typed in: every figure comes from Zerodha's fills.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useTopics } from "../../live";
import { Alert } from "../../ui";
import { useDialog } from "../../dialog/DialogProvider";
import { DateField, DateRangeField } from "../../DatePicker";
import { isNum, num } from "../analyzer/format";

const sPctText = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%` : "—");
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
export const PERIOD_HEAD = ["Period", "From", "To", "Trades", "Won", "Win rate %", "Realised P&L", "Brokerage", "Taxes", "Charges & taxes", "Net realised P&L", "Profit factor", "Expectancy", "Avg win", "Avg loss", "Max drawdown", "Days traded", "Green days", "Best day", "Best day net", "Worst day", "Worst day net", "Charges & taxes % of realised P&L"];
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
        <div className="jp-custom">
          <DateRangeField
            value={custom}
            max={today}
            label="Your dates"
            title="Pick the first and last day"
            onChange={(r) => {
              setCustom({ from: r.from, to: r.to });
              if (r.from && r.to) setSel({ period: "custom", from: r.from, to: r.to });
            }}
          />
        </div>
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
          <p className="vd-note">Every period at once, each trade on the day it was closed, after estimated charges &amp; taxes. Click a row to open it below.</p>
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
              <th scope="col" className="is-num" data-tip="Profit or loss of the trades closed, before charges & taxes.">
                Realised P&amp;L
              </th>
              <th scope="col" className="is-num" data-tip="Brokerage, taxes and fees (an estimate from Zerodha's published rates).">
                Charges &amp; taxes
              </th>
              <th scope="col" className="is-num">
                Net realised P&amp;L
              </th>
              <th scope="col" className="is-num" data-tip="The period's net as a share of your principal (the capital you put in, month by month). Add your capital under Returns.">
                Return
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
                <td className={`is-num ${tone(r.pct)}`}>{r.trades ? sPctText(r.pct) : "—"}</td>
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
      <h3 className="jr-h">Net realised P&amp;L by financial year</h3>
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
            <b>{h.label}</b> · {h.trades} trades · win {num(h.winRate, 0)}% · realised P&amp;L {sMoney(h.gross)} · charges &amp; taxes {sMoney(-h.charges)} · net realised P&amp;L <b className={tone(h.net)}>{sMoney(h.net)}</b>
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
          <p className="vd-note">Net realised P&amp;L of each month (by the day trades were closed). Deeper colour, larger result. Click a month to open it.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`pnl-by-month-${per.today}.csv`, ["Month", "Financial year", "Trades", "Win rate %", "Realised P&L", "Charges & taxes", "Net realised P&L", "Profit factor"], [...per.months].reverse().map((m) => [m.month, `FY ${m.fy}-${String((m.fy + 1) % 100).padStart(2, "0")}`, m.trades, m.winRate, m.gross, m.charges, m.net, m.profitFactor === null ? "inf" : m.profitFactor]))}>
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
                            <span className="jp-heat__v">{compact(d.net)}</span>
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
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`months-${label}.csv`, ["Month", "Trades", "Won", "Win rate %", "Realised P&L", "Brokerage", "Taxes", "Charges & taxes", "Net realised P&L", "Profit factor", "Expectancy", "Max drawdown", "Days traded", "Green days"], months.map((m) => [m.month, m.trades, m.wins, m.winRate, m.gross, m.brokerage, m.taxes, m.charges, m.net, m.profitFactor === null ? "inf" : m.profitFactor, m.expectancy, m.maxDrawdown, m.days, m.greenDays]))}>
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
                Realised P&amp;L
              </th>
              <th scope="col" className="is-num">
                Charges &amp; taxes
              </th>
              <th scope="col" className="is-num">
                Net realised P&amp;L
              </th>
              <th scope="col" className="is-num" data-tip="Net as a share of your principal in that month (the principal on its first trading day; additions count from their day).">
                Return
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
                <td className={`is-num ${tone(m.netPct)}`}>{sPctText(m.netPct)}</td>
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
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadCsv(`days-${label}.csv`, ["Date", "Trades", "Won", "Win rate %", "Realised P&L", "Brokerage", "Taxes", "Charges & taxes", "Net realised P&L"], list.map((d) => [d.key, d.trades, d.wins, d.winRate, d.gross, d.brokerage, d.taxes, d.charges, d.net]))}>
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
              <th scope="col" className="is-num" data-tip="Net as a share of your principal that day.">
                Return
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
                <td className={`is-num ${tone(d.netPct)}`}>{sPctText(d.netPct)}</td>
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

/* ------------------------------------------- uploading tradebooks (.xlsx and .csv), and the kept files */
const SIZE = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const STATE = { waiting: "Waiting", uploading: "Uploading", reading: "Reading the trades", done: "Done", error: "Not imported" };

export function UploadPanel({ onDone }) {
  const ask = useDialog();
  const [queue, setQueue] = useState([]);
  const [files, setFiles] = useState(null);
  const [store, setStore] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const loadFiles = useCallback(
    () =>
      api("/api/admin/trading/journal/files")
        .then((d) => {
          setFiles(Array.isArray(d && d.files) ? d.files : []);
          setStore((d && d.store) || "");
        })
        .catch(() => setFiles([])),
    []
  );
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);
  useTopics(["trading"], loadFiles);

  const send = async (list) => {
    setErr("");
    const ok = list.filter((f) => /\.(csv|xlsx|txt)$/i.test(f.name));
    if (ok.length < list.length) setErr(`${list.length - ok.length} file${list.length - ok.length === 1 ? " was" : "s were"} left out: only .csv and .xlsx tradebooks can be imported.`);
    if (!ok.length) return;
    const stamp = Date.now();
    const items = ok.map((f, i) => ({ key: `${stamp}-${i}`, file: f, name: f.name, size: f.size, pct: 0, state: "waiting" }));
    setQueue((q) => [...items.map(({ file, ...x }) => x), ...q].slice(0, 40));
    setBusy(true);
    for (const it of items) {
      const upd = (patch) => setQueue((q) => q.map((x) => (x.key === it.key ? { ...x, ...patch } : x)));
      try {
        upd({ state: "uploading" });
        const st = await api("/api/admin/trading/journal/upload", { method: "POST", body: { name: it.name, size: it.size } });
        for (let i = 0, k = 0; i < it.size; i += st.partSize, k += 1) {
          const blob = it.file.slice(i, i + st.partSize);
          const res = await fetch(`/api/admin/trading/journal/upload/${st.id}/${k}`, { method: "PUT", credentials: "same-origin", headers: { "X-Requested-With": "vpt", "Content-Type": "application/octet-stream", Accept: "application/json" }, body: blob });
          if (!res.ok) {
            const d = await res.json().catch(() => null);
            throw new Error((d && d.message) || `The upload failed (${res.status}).`);
          }
          upd({ pct: Math.round(((i + blob.size) / it.size) * 100) });
        }
        upd({ state: "reading", pct: 100 });
        const r = await api(`/api/admin/trading/journal/upload/${st.id}/finish`, { method: "POST", body: {} });
        upd({ state: "done", result: r });
      } catch (e) {
        upd({ state: "error", error: e.message });
      }
    }
    setBusy(false);
    loadFiles();
    onDone();
  };
  const again = async (f) => {
    setErr("");
    try {
      const r = await api(`/api/admin/trading/journal/files/${f.id}/reimport`, { method: "POST", body: {} });
      setQueue((q) => [{ key: `re-${Date.now()}`, name: `${f.name} (read again)`, size: f.size, pct: 100, state: "done", result: r }, ...q]);
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  };
  const drop = async (f) => {
    const yes = await ask({ tone: "danger", title: "Delete the kept copy of this file?", body: `“${f.name}” is deleted from the database. Its trades stay in the journal.`, confirmText: "Delete the copy", cancelText: "Keep it" });
    if (!yes) return;
    try {
      const d = await api(`/api/admin/trading/journal/files/${f.id}`, { method: "DELETE" });
      setFiles(d.files || []);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="jp-up">
      <label
        className={`jp-drop ${drag ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) send([...(e.dataTransfer.files || [])]);
        }}
      >
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple disabled={busy} onChange={(e) => {
          send([...(e.target.files || [])]);
          e.target.value = "";
        }} />
        <span className="jp-drop__ic" aria-hidden="true">⇪</span>
        <b>{busy ? "Importing…" : "Drop tradebook files here, or click to choose"}</b>
        <small>.xlsx or .csv from Zerodha Console · many at once · up to 15 MB each · repeats are ignored</small>
      </label>
      <Alert>{err}</Alert>
      {queue.length > 0 && (
        <ul className="jp-queue">
          {queue.map((q) => (
            <li key={q.key} className={`is-${q.state}`}>
              <div className="jp-queue__top">
                <b>{q.name}</b>
                <small>
                  {SIZE(q.size)} · {STATE[q.state]}
                </small>
              </div>
              {(q.state === "uploading" || q.state === "reading") && (
                <span className="jp-bar__p" role="progressbar" aria-valuenow={q.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${q.name}: ${q.pct}%`}>
                  <i style={{ width: `${q.pct}%` }} />
                </span>
              )}
              {q.state === "done" && q.result && (
                <small className="jp-queue__res">
                  {q.result.added.toLocaleString("en-IN")} new of {q.result.read.toLocaleString("en-IN")} trades{q.result.skipped ? ` · ${q.result.skipped} row${q.result.skipped === 1 ? "" : "s"} skipped` : ""}
                  {q.result.fromDay ? ` · ${dayLabel(q.result.fromDay)} – ${dayLabel(q.result.toDay)}` : ""}
                  {q.result.segments && q.result.segments.length ? ` · ${q.result.segments.join(", ")}` : ""}
                  {q.result.duplicate ? " · this file was already kept" : ""}
                </small>
              )}
              {q.state === "error" && <small className="jp-queue__err">{q.error}</small>}
            </li>
          ))}
        </ul>
      )}
      {files && files.length > 0 && (
        <details className="jp-files" open={files.length <= 6}>
          <summary>
            Uploaded files kept in the database ({files.length}){store ? ` — ${store}` : ""}
          </summary>
          <div className="bt__scroll">
            <table className="an-table jp-table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col" className="is-num">
                    Trades (new)
                  </th>
                  <th scope="col">Dates in it</th>
                  <th scope="col">
                    <span className="adm-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <th scope="row">
                      {f.name}
                      <small>
                        {f.type.toUpperCase()} · {SIZE(f.size)}
                        {f.result && f.result.segments && f.result.segments.length ? ` · ${f.result.segments.join(", ")}` : ""}
                      </small>
                    </th>
                    <td>{new Date(f.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="is-num">{f.result ? `${f.result.read.toLocaleString("en-IN")} (${f.result.added.toLocaleString("en-IN")})` : "—"}</td>
                    <td>{f.result && f.result.fromDay ? `${dayLabel(f.result.fromDay)} – ${dayLabel(f.result.toDay)}` : "—"}</td>
                    <td className="jp-files__act">
                      <a className="adm-btn adm-btn--ghost adm-btn--sm" href={`/api/admin/trading/journal/files/${f.id}`} download={f.name}>
                        Download
                      </a>
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => again(f)} data-tip="Read the kept file again: only trades the journal lacks are added.">
                        Read again
                      </button>
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => drop(f)} data-tip="Delete the kept copy (its trades stay in the journal).">
                        Delete copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------ where the history comes from */
export function Sources({ per, ignoredManual, onChanged }) {
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
            For everything since your account opened: on <b>console.zerodha.com</b> go to Reports → Tradebook, pick the segment (Equity — and F&amp;O, Currency or Commodity if you traded them), choose one financial year (1 April to 31 March) and download it as <b>XLSX or CSV</b>. Do it for every year, then upload all the files below at once.
          </p>
          <p className="vd-note">Each file is kept in the database exactly as it came (download it or read it again any time), and every trade in it is saved with all its columns — symbol, ISIN, segment, series, trade and order IDs, date and time, quantity and price.</p>
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
            <DateField value={since} max={today} onChange={setSince} label="Account opened" />
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
      <UploadPanel onDone={onChanged} />
      <p className="vd-note">
        Trades on record: <b>{(per.sources.kite + per.sources.console).toLocaleString("en-IN")}</b> fills ({per.sources.kite.toLocaleString("en-IN")} read from Kite, {per.sources.console.toLocaleString("en-IN")} from uploaded files){per.sources.segments && per.sources.segments.length ? ` · segments ${per.sources.segments.join(", ")}` : ""}{per.sources.store ? ` · kept in ${per.sources.store}, one record per trade` : ""}. F&amp;O, currency and commodity trades are counted in the P&amp;L; their charges are not estimated.
      </p>
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
