// The trading days, inside /me's "Next trading day" strip (28 Nov 2026, the owner: "automatically display total number of
// count of trading days and in form of grid and date. on hovering on each date it will show that day's profit / loss. red
// for loss, green for profits. use zerodha colors"). One small month calendar per month, newest first, every date
// numbered: a day you closed trades on is green (net profit) or red (net loss) in Kite's own green and red, deeper for a
// bigger result; weekends and NSE holidays are marked. Hover, tap or focus a date for that day's figures. The counts
// above say how many sessions NSE held and how many of them you traded.
//
// Every figure is the Journal's own (GET /api/admin/trading/journal/days: trades on the day they were closed, as in
// Zerodha's P&L). Reads only; superadmins only (the server refuses everyone else).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { everyVisible } from "../visible";
import { indiaHolidays } from "../stock/holidays";
import "./trading-days.css";

const DAY = 86400000;
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const RANGES = [
  { id: 1, label: "This month" },
  { id: 3, label: "3 months" },
  { id: 6, label: "6 months" },
  { id: 12, label: "12 months" },
];
const utc = (k) => Date.parse(`${k}T00:00:00Z`);
const keyOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dow = (k) => new Date(utc(k)).getUTCDay();
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const rupees = (x) => (fin(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const amount = (x) => (fin(x) ? `₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const tone = (x) => (fin(x) && x !== 0 ? (x > 0 ? "is-up" : "is-down") : "");
export const longDay = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The first day of the month `back` months before the month of `today` (back 0 = this month). */
export function monthStart(today, back) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 - back;
  return keyOf(Date.UTC(y, m, 1));
}

/** NSE's full-day closures on weekdays, by date (the built-in table, which the server keeps in step with NSE's list). */
export function holidayMap(fromDay, toDay) {
  const out = new Map();
  for (let y = Number(fromDay.slice(0, 4)); y <= Number(toDay.slice(0, 4)); y += 1) {
    for (const h of indiaHolidays(y)) if (h.kind === "closed" && h.date >= fromDay && h.date <= toDay && dow(h.date) % 6 !== 0) out.set(h.date, h.name);
  }
  return out;
}

/**
 * The counts over a range: the sessions NSE held (weekdays that were not holidays, up to today), the days traded, the
 * green and red days, and the net. Pure, for the tests.
 */
export function countDays({ fromDay, toDay, days, holidays }) {
  let sessions = 0;
  for (let t = utc(fromDay); t <= utc(toDay); t += DAY) {
    const k = keyOf(t);
    if (dow(k) % 6 !== 0 && !holidays.has(k)) sessions += 1;
  }
  const mine = days.filter((d) => d.date >= fromDay && d.date <= toDay);
  const green = mine.filter((d) => d.net > 0);
  const red = mine.filter((d) => d.net < 0);
  const sum = (list) => list.reduce((a, d) => a + (fin(d.net) ? d.net : 0), 0);
  return {
    sessions,
    traded: mine.length,
    green: green.length,
    red: red.length,
    flat: mine.length - green.length - red.length,
    net: sum(mine),
    best: mine.length ? mine.reduce((a, d) => (d.net > a.net ? d : a)) : null,
    worst: mine.length ? mine.reduce((a, d) => (d.net < a.net ? d : a)) : null,
  };
}

/** 1–4 by a day's size against the range's large days (95th percentile), so one huge day does not wash the rest out. */
export function levelOf(v, all) {
  const abs = all.filter((x) => fin(x) && x !== 0).map(Math.abs).sort((a, b) => a - b);
  if (!fin(v) || v === 0 || !abs.length) return 0;
  const scale = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] || abs[abs.length - 1];
  const r = Math.abs(v) / scale;
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
}

/** The months of the range, newest first, each with its dates placed in a Sunday-first week grid. */
export function monthsOf(today, count) {
  const out = [];
  for (let back = 0; back < count; back += 1) {
    const first = monthStart(today, back);
    const y = Number(first.slice(0, 4));
    const m = Number(first.slice(5, 7));
    const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < dow(first); i += 1) cells.push(null);
    for (let d = 1; d <= len; d += 1) cells.push(`${first.slice(0, 8)}${String(d).padStart(2, "0")}`);
    out.push({ key: first.slice(0, 7), label: `${MONTHS[m - 1]} ${y}`, cells });
  }
  return out;
}

export default function TradingDays() {
  const [state, setState] = useState({ data: null, error: "" });
  const [range, setRange] = useState(() => {
    try {
      const v = Number(window.localStorage.getItem("vpt.home.days"));
      return RANGES.some((r) => r.id === v) ? v : 3;
    } catch (_) {
      return 3;
    }
  });
  const [tip, setTip] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      api(`/api/admin/trading/journal/days?from=${monthStart(today, 11)}`)
        .then((d) => alive && setState({ data: d, error: "" }))
        .catch((e) => alive && setState((s) => ({ data: s.data, error: (e && e.message) || "Could not be read." })));
    };
    load();
    // a trade saved anywhere (the Journal's records) is read at once; the clock keeps it current otherwise
    const stop = everyVisible(load, 120000, { topics: ["analysis", "trading"] });
    return () => {
      alive = false;
      stop();
    };
  }, []);
  const choose = (id) => {
    setRange(id);
    setTip(null);
    try {
      window.localStorage.setItem("vpt.home.days", String(id));
    } catch (_) {
      /* private mode: the choice lasts for this visit */
    }
  };

  const d = state.data;
  const today = d ? d.today : "";
  const fromDay = today ? monthStart(today, range - 1) : "";
  const byDay = useMemo(() => new Map(((d && d.days) || []).map((x) => [x.date, x])), [d]);
  const holidays = useMemo(() => (today ? holidayMap(monthStart(today, 11), today.slice(0, 4) + "-12-31") : new Map()), [today]);
  const months = useMemo(() => (today ? monthsOf(today, range) : []), [today, range]);
  const counts = useMemo(() => (today ? countDays({ fromDay, toDay: today, days: (d && d.days) || [], holidays }) : null), [d, fromDay, today, holidays]);
  const nets = useMemo(() => ((d && d.days) || []).filter((x) => x.date >= fromDay).map((x) => x.net), [d, fromDay]);

  if (!d) {
    return (
      <div className="td" aria-busy={!state.error}>
        <p className="td__dim">{state.error ? `Your trading days could not be read: ${state.error}` : "Reading your trading days…"}</p>
      </div>
    );
  }

  const describe = (k) => {
    const x = byDay.get(k);
    if (x) return { k, day: x };
    if (k > today) return { k, note: "Not yet" };
    if (dow(k) % 6 === 0) return { k, note: "Weekend · market closed" };
    if (holidays.has(k)) return { k, note: `NSE holiday · ${holidays.get(k)}` };
    return { k, note: "Market open · no trade closed" };
  };
  const show = (k, el) => {
    if (!box.current || !el) return;
    const b = box.current.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const x = Math.max(120, Math.min(b.width - 120, c.left - b.left + c.width / 2));
    const below = c.top - b.top < 96;
    setTip({ ...describe(k), x, y: below ? c.bottom - b.top + 6 : c.top - b.top - 6, below });
  };
  const words = (k) => {
    const t = describe(k);
    return t.day ? `${longDay(k)}: net ${rupees(t.day.net)}, realised ${rupees(t.day.gross)}, ${t.day.trades} trade${t.day.trades === 1 ? "" : "s"}` : `${longDay(k)}: ${t.note}`;
  };

  return (
    <div className="td" ref={box} onMouseLeave={() => setTip(null)}>
      <div className="td__head">
        <h3 className="td__title">Trading days</h3>
        <div className="td__ranges" role="group" aria-label="Show">
          {RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => choose(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="td__counts">
        <div>
          <dt>NSE sessions</dt>
          <dd>{counts.sessions}</dd>
        </div>
        <div>
          <dt>Days you traded</dt>
          <dd>{counts.traded}</dd>
        </div>
        <div>
          <dt>Profit days</dt>
          <dd className="is-up">{counts.green}</dd>
        </div>
        <div>
          <dt>Loss days</dt>
          <dd className="is-down">{counts.red}</dd>
        </div>
        <div>
          <dt>Net realised P&amp;L</dt>
          <dd className={tone(counts.net)}>{counts.traded ? rupees(counts.net) : "—"}</dd>
        </div>
        <div>
          <dt>Profit-day rate</dt>
          <dd>{counts.traded ? `${Math.round((counts.green / counts.traded) * 100)}%` : "—"}</dd>
        </div>
      </dl>

      <div className="td__months">
        {months.map((mo) => (
          <div className="td__month" key={mo.key} role="group" aria-label={mo.label}>
            <p className="td__mname">{mo.label}</p>
            <div className="td__grid">
              {WD.map((w, i) => (
                <span key={`w${i}`} className="td__wd" aria-hidden="true">
                  {w}
                </span>
              ))}
              {mo.cells.map((k, i) => {
                if (!k) return <span key={`b${i}`} aria-hidden="true" />;
                const x = byDay.get(k);
                const lvl = x ? levelOf(x.net, nets) : 0;
                const cls = [
                  "td__day",
                  x ? (x.net > 0 ? `is-up l${lvl}` : x.net < 0 ? `is-down l${lvl}` : "is-flat") : "",
                  !x && dow(k) % 6 === 0 ? "is-off" : "",
                  !x && holidays.has(k) ? "is-hol" : "",
                  k > today ? "is-later" : "",
                  k === today ? "is-today" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button key={k} type="button" className={cls} aria-label={words(k)} onMouseEnter={(e) => show(k, e.currentTarget)} onFocus={(e) => show(k, e.currentTarget)} onBlur={() => setTip(null)} onClick={(e) => show(k, e.currentTarget)}>
                    {Number(k.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="td__legend" aria-hidden="true">
        <span>Loss</span>
        {[4, 3, 2, 1].map((l) => (
          <i key={`d${l}`} className={`td__key is-down l${l}`} />
        ))}
        {[1, 2, 3, 4].map((l) => (
          <i key={`u${l}`} className={`td__key is-up l${l}`} />
        ))}
        <span>Profit</span>
        <span className="td__legend-note">net of charges · weekends and NSE holidays greyed · hover or tap a date</span>
      </div>

      {tip && (
        <div className={`td__tip${tip.below ? " is-below" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <b>{longDay(tip.k)}</b>
          {tip.day ? (
            <>
              <span>
                Net P&amp;L <em className={tone(tip.day.net)}>{rupees(tip.day.net)}</em>
              </span>
              <span>
                Realised <em className={tone(tip.day.gross)}>{rupees(tip.day.gross)}</em> · charges {amount(tip.day.charges)}
              </span>
              <span>
                {tip.day.trades} trade{tip.day.trades === 1 ? "" : "s"}
                {fin(tip.day.wins) ? ` · ${tip.day.wins} won` : ""}
              </span>
            </>
          ) : (
            <span>{tip.note}</span>
          )}
        </div>
      )}
    </div>
  );
}
