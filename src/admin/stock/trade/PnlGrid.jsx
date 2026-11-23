// The P&L day grid, as on Zerodha Console's P&L report (23 Nov 2026): a year of days at one glance — each month a block
// of week columns, one square per day, green for a profit, red for a loss (deeper colour, larger result), grey for a
// day with no trades. Hover (or focus) a square for its date and figures; click it for that day's trades in a table
// right under the grid. Arrow keys move between days, Enter opens one, Escape closes it.
//
// Every figure is the journal's own (the same trades as the rest of the page, each on the day it was closed, as in
// Zerodha's P&L). "Realised" colours by the P&L before charges (Console's way); "Net" by the P&L after charges.
// Days entered by hand (Journal → Calendar) are marked apart and never mixed into Zerodha's figures.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { isNum, num } from "../analyzer/format";
import Skeleton from "../../ux/Skeleton";
import "./pnl-grid.css";

const DAY = 86400000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];
const utc = (k) => Date.parse(`${k}T00:00:00Z`);
const keyOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (k, n) => keyOf(utc(k) + n * DAY);
const dow = (k) => new Date(utc(k)).getUTCDay();
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const signed = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}` : "—");
/** Console's way: 8,105.50 for a profit, −2,840.00 for a loss (a true minus sign) */
const plain = (x) => (isNum(x) ? `${x < 0 ? "−" : ""}${num(Math.abs(x))}` : "0");
const rupees = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
export const longDay = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const consoleDay = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const clock = (ms) => new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(11, 16);

/**
 * The blocks of the grid: one per month from `fromDay` to `toDay`, each with its days placed by week column and weekday
 * row (Sunday on top, as on Console). Pure, for the tests.
 * @returns [{ month: "2026-11", label: "NOV", year, cols, cells: [{ key, col, row }] }]
 */
export function monthBlocks(fromDay, toDay) {
  if (!fromDay || !toDay || fromDay > toDay) return [];
  const out = [];
  let y = Number(fromDay.slice(0, 4));
  let m = Number(fromDay.slice(5, 7));
  for (let guard = 0; guard < 48; guard += 1) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    if (`${month}-01` > toDay) break;
    const first = `${month}-01`;
    const last = keyOf(Date.UTC(y, m, 0));
    const lead = dow(first);
    const cells = [];
    for (let k = first; k <= last; k = addDays(k, 1)) {
      if (k < fromDay || k > toDay) continue;
      const d = Number(k.slice(8, 10));
      cells.push({ key: k, col: Math.floor((d - 1 + lead) / 7), row: dow(k) });
    }
    if (cells.length) out.push({ month, label: MONTH[m - 1], year: y, cols: Math.floor((Number(last.slice(8, 10)) - 1 + lead) / 7) + 1, cells });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * How deep a day's colour is: 1–4 by the size of its result against the range's large days (the 95th percentile of the
 * absolute results, so one huge day does not wash the rest out). 0 = no trades.
 */
export function levelOf(v, scale) {
  if (!isNum(v) || v === 0 || !(scale > 0)) return 0;
  const r = Math.abs(v) / scale;
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
}
export function scaleOf(values) {
  const abs = values.filter((v) => isNum(v) && v !== 0).map((v) => Math.abs(v)).sort((a, b) => a - b);
  if (!abs.length) return 0;
  return abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] || abs[abs.length - 1];
}

/** The grid: `ranges` = [{ id, label, fromDay?, toDay? }] (the first is the default: the last 12 months). */
export default function PnlGrid({ kind = "", side = "", setup = "", refreshKey = 0, ranges = [], onOpenDay = null, segment = "Equity" }) {
  const [range, setRange] = useState("12m");
  const [measure, setMeasure] = useState("gross");
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [picked, setPicked] = useState("");
  const [focusKey, setFocusKey] = useState("");
  const [tip, setTip] = useState(null);
  const wrap = useRef(null);
  const cells = useRef(new Map());
  const detail = useRef(null);
  const seq = useRef(0);

  const choice = ranges.find((r) => r.id === range) || null;
  const load = useCallback(() => {
    const q = new URLSearchParams({ ...(kind ? { kind } : {}), ...(side ? { side } : {}), ...(setup ? { setup } : {}), ...(choice && choice.fromDay ? { from: choice.fromDay } : {}), ...(choice && choice.toDay ? { to: choice.toDay } : {}) });
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(`/api/admin/trading/journal/days?${q}`)
      .then((d) => {
        if (mine === seq.current) setState({ loading: false, data: d, error: "" });
      })
      .catch((e) => {
        if (mine === seq.current) setState((s) => ({ loading: false, data: s.data, error: e.message }));
      });
  }, [kind, side, setup, choice]);
  // re-read with every Journal read (`refreshKey`): that read takes today's fills from Kite first, and it runs on its own
  // whenever a trade is saved anywhere (the live channel) and every minute while the page is open
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const d = state.data;
  const byDay = useMemo(() => new Map(((d && d.days) || []).map((x) => [x.date, x])), [d]);
  const byManual = useMemo(() => new Map(((d && d.manual) || []).map((x) => [x.date, x])), [d]);
  const blocks = useMemo(() => (d ? monthBlocks(d.fromDay, d.toDay) : []), [d]);
  const scale = useMemo(() => scaleOf([...byDay.values(), ...byManual.values()].map((x) => x[measure])), [byDay, byManual, measure]);
  const traded = useMemo(() => [...new Set([...byDay.keys(), ...byManual.keys()])].sort(), [byDay, byManual]);
  const totalCols = blocks.reduce((a, b) => a + b.cols, 0);

  // a picked day that left the range (another filter, another year) is let go
  useEffect(() => {
    if (picked && d && (picked < d.fromDay || picked > d.toDay)) setPicked("");
  }, [d, picked]);
  const roving = focusKey && d && focusKey >= d.fromDay && focusKey <= d.toDay ? focusKey : picked || traded[traded.length - 1] || (d ? d.toDay : "");

  const showTip = (k, el) => {
    if (!wrap.current || !el || !el.getBoundingClientRect) return setTip({ key: k, x: 0, y: 0, below: false });
    const w = wrap.current.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const x = c.left - w.left + c.width / 2;
    const below = c.top - w.top < 64;
    setTip({ key: k, x: Math.max(110, Math.min(w.width - 110, x)), y: below ? c.bottom - w.top + 8 : c.top - w.top - 8, below });
  };
  const pick = (k) => {
    setPicked((cur) => (cur === k ? "" : k));
    setFocusKey(k);
  };
  // after a click, bring the day's table into view on a small screen (it sits under the grid)
  useEffect(() => {
    if (picked && detail.current && detail.current.scrollIntoView && window.innerWidth < 900) detail.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [picked]);

  const move = (k, step) => {
    if (!d) return;
    const next = addDays(k, step);
    if (next < d.fromDay || next > d.toDay) return;
    setFocusKey(next);
    const el = cells.current.get(next);
    if (el && el.focus) {
      el.focus();
      showTip(next, el);
    }
  };
  const onKey = (e, k) => {
    const steps = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (steps[e.key]) {
      e.preventDefault();
      move(k, steps[e.key]);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const target = e.key === "Home" ? d.fromDay : d.toDay;
      move(target, 0);
    } else if (e.key === "Escape") {
      setPicked("");
      setTip(null);
    }
  };
  const stepDay = (dir) => {
    const i = traded.indexOf(picked);
    const next = dir < 0 ? (i > 0 ? traded[i - 1] : null) : i >= 0 && i < traded.length - 1 ? traded[i + 1] : null;
    if (next) {
      setPicked(next);
      setFocusKey(next);
    }
  };

  const describe = (k) => {
    const x = byDay.get(k);
    const h = byManual.get(k);
    if (x) return `${longDay(k)}: realised P&L ${rupees(x.gross)}, net ${rupees(x.net)} after ₹${num(x.charges)} charges, ${x.trades} trade${x.trades === 1 ? "" : "s"}`;
    if (h) return `${longDay(k)}: entered by hand, realised P&L ${rupees(h.gross)}, net ${rupees(h.net)}`;
    return `${longDay(k)}: no trades`;
  };

  const tipDay = tip ? byDay.get(tip.key) || byManual.get(tip.key) || null : null;
  const sel = picked ? byDay.get(picked) || null : null;
  const selManual = picked && !sel ? byManual.get(picked) || null : null;
  const t = d ? d.totals : null;
  const label = choice ? choice.label : "Last 12 months";

  return (
    <section className="pg an-card" aria-label="Profit and loss by day">
      <header className="pg__head">
        <div className="pg__title">
          <h3>P&amp;L by day</h3>
          <p>
            {label}
            {d ? (
              <>
                {" "}
                · {consoleDay(d.fromDay)} to {consoleDay(d.toDay)}
              </>
            ) : null}
          </p>
        </div>
        <div className="pg__tools">
          <div className="sv__ranges" role="group" aria-label="Colour the days by">
            <button type="button" aria-pressed={measure === "gross"} onClick={() => setMeasure("gross")} data-tip="Realised P&L before charges & taxes: what Zerodha Console's grid shows.">
              Realised
            </button>
            <button type="button" aria-pressed={measure === "net"} onClick={() => setMeasure("net")} data-tip="Net realised P&L: after charges & taxes.">
              Net
            </button>
          </div>
          {ranges.length > 1 && (
            <label className="tr-field pg__range">
              <span className="adm-sr">Which year</span>
              <select value={range} onChange={(e) => setRange(e.target.value)}>
                {ranges.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {state.error && <p className="adm-alert adm-alert--error">{state.error}</p>}
      {state.loading && !d && <Skeleton label="Drawing the days…" lines={4} />}

      {d && (
        <div className="pg__wrap" ref={wrap} onMouseLeave={() => setTip(null)}>
          <div className="pg__grid" style={{ "--pg-cols": totalCols }}>
            <div className="pg__days" aria-hidden="true">
              {WEEKDAY.map((w, i) => (
                <span key={w} style={{ gridRow: i + 1 }}>
                  {i % 2 === 1 ? w : ""}
                </span>
              ))}
            </div>
            <div className="pg__months">
              {blocks.map((b) => (
                <div className="pg__month" key={b.month} role="group" aria-label={`${b.label} ${b.year}`}>
                  <div className="pg__cells" style={{ gridTemplateColumns: `repeat(${b.cols}, var(--pg-cell))` }}>
                    {b.cells.map((c) => {
                      const x = byDay.get(c.key);
                      const h = byManual.get(c.key);
                      const v = x ? x[measure] : h ? h[measure] : null;
                      const lvl = levelOf(v, scale);
                      const cls = ["pg__cell", lvl ? `${v > 0 ? "is-up" : "is-down"} l${lvl}` : x || h ? "is-flat" : "", h && !x ? "is-manual" : "", picked === c.key ? "is-picked" : "", c.key === d.today ? "is-today" : ""].filter(Boolean).join(" ");
                      return (
                        <button
                          key={c.key}
                          type="button"
                          ref={(el) => {
                            if (el) cells.current.set(c.key, el);
                            else cells.current.delete(c.key);
                          }}
                          className={cls}
                          style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }}
                          tabIndex={c.key === roving ? 0 : -1}
                          aria-label={describe(c.key)}
                          data-tip=""
                          aria-pressed={picked === c.key}
                          onMouseEnter={(e) => showTip(c.key, e.currentTarget)}
                          onFocus={(e) => {
                            setFocusKey(c.key);
                            showTip(c.key, e.currentTarget);
                          }}
                          onBlur={() => setTip(null)}
                          onClick={() => pick(c.key)}
                          onKeyDown={(e) => onKey(e, c.key)}
                        />
                      );
                    })}
                  </div>
                  <span className="pg__mlabel">{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {tip && (
            <div className={`pg__tip${tip.below ? " is-below" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
              {tipDay ? (
                <>
                  <b>{consoleDay(tip.key)}</b>
                  <span>
                    Realised P&amp;L <em className={tone(tipDay.gross)}>{signed(tipDay.gross)}</em>
                  </span>
                  <span>
                    Net <em className={tone(tipDay.net)}>{signed(tipDay.net)}</em> · {tipDay.trades} trade{tipDay.trades === 1 ? "" : "s"}
                    {tipDay.manual ? " · entered by hand" : ""}
                  </span>
                </>
              ) : (
                <span>No data on {consoleDay(tip.key)}</span>
              )}
            </div>
          )}

          <div className="pg__legend" aria-hidden="true">
            <span>Loss</span>
            {[4, 3, 2, 1].map((l) => (
              <i key={`d${l}`} className={`pg__cell is-down l${l}`} />
            ))}
            <i className="pg__cell" />
            {[1, 2, 3, 4].map((l) => (
              <i key={`u${l}`} className={`pg__cell is-up l${l}`} />
            ))}
            <span>Profit</span>
            {byManual.size > 0 && (
              <>
                <i className="pg__cell is-up l2 is-manual pg__legend-gap" />
                <span>entered by hand</span>
              </>
            )}
          </div>
        </div>
      )}

      {d && !picked && t && (
        <p className="pg__sum">
          {t.days ? (
            <>
              <b>{t.days}</b> day{t.days === 1 ? "" : "s"} traded · <span className="is-up">{t.green} green</span> · <span className="is-down">{t.red} red</span> · {t.trades} trade{t.trades === 1 ? "" : "s"} · realised <b className={tone(t.gross)}>{rupees(t.gross)}</b> · charges ₹{num(t.charges)} · net{" "}
              <b className={tone(t.net)}>{rupees(t.net)}</b>
              <span className="pg__hint"> Click a day for its trades.</span>
            </>
          ) : (
            <>No closed trades in this range{kind || side || setup ? " with these filters" : ""}.</>
          )}
        </p>
      )}

      {picked && (
        <div className="pg__detail" ref={detail} aria-live="polite">
          <div className="pg__dhead">
            <p className="pg__dline">
              <span>{measure === "net" ? "Net realised P&L" : "Gross realised P&L"}</span>
              <b className="pg__ddate">{consoleDay(picked)}</b>
              <span className="pg__dsep" aria-hidden="true" />
              <span>
                {segment}: <b className={tone(sel ? sel[measure] : selManual ? selManual[measure] : 0)}>{plain(sel ? sel[measure] : selManual ? selManual[measure] : 0)}</b>
              </span>
            </p>
            <div className="pg__dact">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => stepDay(-1)} disabled={traded.indexOf(picked) <= 0} aria-label="Previous day with trades">
                ‹ Prev
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => stepDay(1)} disabled={traded.indexOf(picked) === -1 || traded.indexOf(picked) >= traded.length - 1} aria-label="Next day with trades">
                Next ›
              </button>
              {onOpenDay && (sel || selManual) && (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpenDay(picked)}>
                  Open this day
                </button>
              )}
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setPicked("")} aria-label="Close the day">
                ✕
              </button>
            </div>
          </div>

          {sel ? (
            <>
              <dl className="pg__dfigs">
                <div>
                  <dt>Realised P&amp;L</dt>
                  <dd className={tone(sel.gross)}>{signed(sel.gross)}</dd>
                </div>
                <div>
                  <dt>Charges &amp; taxes</dt>
                  <dd>{num(sel.charges)}</dd>
                </div>
                <div>
                  <dt>Net realised P&amp;L</dt>
                  <dd className={tone(sel.net)}>{signed(sel.net)}</dd>
                </div>
                <div>
                  <dt>Trades</dt>
                  <dd>
                    {sel.trades} <small>({sel.wins} won)</small>
                  </dd>
                </div>
              </dl>
              <div className="bt__scroll">
                <table className="zp-table pg__table">
                  <caption className="adm-sr">Trades closed on {longDay(picked)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Closed</th>
                      <th scope="col">Symbol</th>
                      <th scope="col">Side</th>
                      <th scope="col">Product</th>
                      <th scope="col" className="is-num">
                        Qty.
                      </th>
                      <th scope="col" className="is-num">
                        Buy avg.
                      </th>
                      <th scope="col" className="is-num">
                        Sell avg.
                      </th>
                      <th scope="col" className="is-num">
                        Realised P&amp;L
                      </th>
                      <th scope="col" className="is-num">
                        Charges
                      </th>
                      <th scope="col" className="is-num">
                        Net P&amp;L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel.trips.map((x) => {
                      const long = x.side !== "short";
                      return (
                        <tr key={x.key}>
                          <td>{clock(x.exitAt)}</td>
                          <th scope="row">{x.symbol}</th>
                          <td className="pg__side">{long ? "Long" : "Short"}</td>
                          <td>{x.product || (x.intraday ? "MIS" : "CNC")}</td>
                          <td className="is-num">{x.qty}</td>
                          <td className="is-num">{num(long ? x.entryAvg : x.exitAvg)}</td>
                          <td className="is-num">{num(long ? x.exitAvg : x.entryAvg)}</td>
                          <td className={`is-num ${tone(x.gross)}`}>{signed(x.gross)}</td>
                          <td className="is-num">{num(x.charges)}</td>
                          <td className={`is-num ${tone(x.net)}`}>{signed(x.net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={7}>
                        Total
                      </th>
                      <td className={`is-num ${tone(sel.gross)}`}>{signed(sel.gross)}</td>
                      <td className="is-num">{num(sel.charges)}</td>
                      <td className={`is-num ${tone(sel.net)}`}>{signed(sel.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : selManual ? (
            <p className="pg__note">
              Entered by hand: realised <b className={tone(selManual.gross)}>{rupees(selManual.gross)}</b>, charges ₹{num(selManual.charges)}, net <b className={tone(selManual.net)}>{rupees(selManual.net)}</b>
              {selManual.trades ? `, ${selManual.trades} trade${selManual.trades === 1 ? "" : "s"}` : ""}. Change it from the Calendar tab.
              {selManual.note ? <span className="pg__noteText"> “{selManual.note}”</span> : null}
            </p>
          ) : (
            <p className="pg__note">No trades on {longDay(picked)}{dow(picked) === 0 || dow(picked) === 6 ? " (a weekend)" : ""}.</p>
          )}
        </div>
      )}
    </section>
  );
}
