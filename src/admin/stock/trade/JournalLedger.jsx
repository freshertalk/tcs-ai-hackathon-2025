// The Journal's ledger (23 Nov 2026): where the money went, and every day on a month calendar.
//
//   CHARGES & TAXES   the period's realised P&L taken down to the net, charge by charge — brokerage, STT, exchange transaction
//                     charges, GST, SEBI fees, stamp duty and DP charges (Zerodha's published rates: an estimate; the contract
//                     note is the truth) — as a donut, a statement and two subtotals (taxes and fees), with days entered by hand
//                     counted only when you ask.
//   MONTH CALENDAR    a month like Google Calendar: every day's net, its trades, and a mark on days entered by hand. A day opens
//                     a panel with its trades and its charges. A day with no Zerodha trades can be entered (or corrected, or
//                     removed) by hand; a day Zerodha has trades for is read-only — its figures come from Zerodha alone.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useDialog } from "../../dialog/DialogProvider";
import { snack } from "../../ux/snack";
import { num } from "../analyzer/format";
import "./journal-ledger.css";

const IST = 5.5 * 3600 * 1000;
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const dayOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const todayIst = () => dayOf(Date.now());
const money = (x) => (isNum(x) ? `${x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const compact = (x) => {
  if (!isNum(x)) return "—";
  const a = Math.abs(x);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(2)} L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${x < 0 ? "−" : x > 0 ? "+" : ""}₹${s}`;
};
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const pct = (x) => (isNum(x) ? `${x < 10 ? x.toFixed(1) : Math.round(x)}%` : "—");

/** The charges, in the order their colours were checked for colour-blind separation (the Expenses page's palette). */
export const PARTS = [
  { id: "brokerage", label: "Brokerage", kind: "fee", what: "Zerodha's brokerage: ₹20 or 0.03% an executed intraday order, whichever is lower; free for delivery" },
  { id: "stt", label: "STT", kind: "tax", what: "Securities Transaction Tax: 0.025% on the sell side intraday, 0.1% on both sides for delivery" },
  { id: "exchange", label: "Exchange txn charges", kind: "fee", what: "The exchange's transaction charge on turnover (NSE 0.00307%, BSE 0.00375%)" },
  { id: "gst", label: "GST", kind: "tax", what: "18% GST on brokerage, exchange charges and SEBI fees" },
  { id: "sebi", label: "SEBI fees", kind: "fee", what: "SEBI turnover fee: ₹10 a crore" },
  { id: "stamp", label: "Stamp duty", kind: "tax", what: "Stamp duty on the buy side: 0.003% intraday, 0.015% delivery" },
  { id: "dp", label: "DP charges", kind: "fee", what: "Depository charge when delivery shares are sold" },
  { id: "other", label: "Other", kind: "fee", what: "Anything else you entered by hand for a day, and the correction that makes a day match Zerodha's ledger" },
];

/* ------------------------------------------------------------------------------------------------ the donut */
function Donut({ parts, total, focus, setFocus }) {
  const R = 78;
  const C = 2 * Math.PI * R;
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 2.5 : 0;
  let run = 0;
  const f = shown.find((p) => p.id === focus);
  return (
    <div className="jl-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Charges and taxes: ${shown.map((p) => `${p.label} ${money(p.value)}`).join(", ")}`}>
        <circle className="jl-donut__track" cx="100" cy="100" r={R} />
        {shown.map((p) => {
          const len = Math.max(0.5, (p.value / total) * C - gap);
          const el = (
            <circle
              key={p.id}
              className={`jl-donut__arc jl-c--${p.id} ${focus && focus !== p.id ? "is-dim" : ""}`}
              cx="100"
              cy="100"
              r={R}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-run}
              transform="rotate(-90 100 100)"
              onPointerEnter={() => setFocus(p.id)}
              onPointerLeave={() => setFocus("")}
            />
          );
          run += (p.value / total) * C;
          return el;
        })}
      </svg>
      <div className="jl-donut__mid" aria-hidden="true">
        <span>{f ? f.label : "Charges & taxes"}</span>
        <b>{money(f ? f.value : total)}</b>
        <small>{f ? `${pct((f.value / total) * 100)} of all charges` : `${shown.length} kinds`}</small>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- charges & taxes */
/**
 * @param s      the period's stats (gross, charges, net, trades)
 * @param parts  { brokerage, stt, … } for the period's Zerodha trades
 * @param manual the period's days entered by hand
 */
export function ChargesBreakdown({ s, parts, manual = [], label = "" }) {
  const [withManual, setWithManual] = useState(true);
  const [focus, setFocus] = useState("");
  const m = useMemo(() => {
    const out = { gross: 0, net: 0, charges: 0, trades: 0, parts: Object.fromEntries(PARTS.map((p) => [p.id, 0])) };
    for (const d of manual) {
      out.gross += d.gross || 0;
      out.net += d.net || 0;
      out.charges += d.charges || 0;
      out.trades += d.trades || 0;
      for (const p of PARTS) out.parts[p.id] += (d.parts && d.parts[p.id]) || 0;
    }
    return out;
  }, [manual]);
  const use = withManual && manual.length > 0;
  const base = { gross: (s && s.gross) || 0, charges: (s && s.charges) || 0, net: (s && s.net) || 0, trades: (s && s.trades) || 0 };
  const gross = base.gross + (use ? m.gross : 0);
  const rows = PARTS.map((p) => ({ ...p, value: Math.round((((parts && parts[p.id]) || 0) + (use ? m.parts[p.id] : 0)) * 100) / 100 })).filter((p) => p.id !== "other" || p.value !== 0);
  const total = rows.reduce((a, p) => a + p.value, 0);
  const net = gross - total;
  const trades = base.trades + (use ? m.trades : 0);
  const taxes = rows.filter((p) => p.kind === "tax").reduce((a, p) => a + p.value, 0);
  const fees = total - taxes;
  const big = Math.max(Math.abs(gross), Math.abs(net), 1);
  if (!s && !manual.length) return null;
  return (
    <section className="an-card jl" aria-labelledby="jl-ch-h" data-jump="Charges">
      <header className="jl-head">
        <div>
          <h3 id="jl-ch-h" className="jr-h">
            Charges &amp; taxes
          </h3>
          <p>
            Where the realised P&amp;L went{label ? ` · ${label}` : ""} — every charge on its own. Estimated from Zerodha's published rates; the contract note is the final word.
          </p>
        </div>
        {manual.length > 0 && (
          <label className="jl-switch">
            <input type="checkbox" checked={withManual} onChange={(e) => setWithManual(e.target.checked)} />
            <span>
              Include {manual.length} day{manual.length === 1 ? "" : "s"} entered by hand
            </span>
          </label>
        )}
      </header>

      <dl className="jl-kpis">
        <div>
          <dt>Realised P&amp;L</dt>
          <dd className={tone(gross)}>{sMoney(gross)}</dd>
          <small>{trades} trade{trades === 1 ? "" : "s"} closed</small>
        </div>
        <div>
          <dt>Charges &amp; taxes</dt>
          <dd>{money(-total)}</dd>
          <small>{gross > 0 ? `${pct((total / gross) * 100)} of the realised profit` : "on every trade"}</small>
        </div>
        <div>
          <dt>Net realised P&amp;L</dt>
          <dd className={tone(net)}>{sMoney(net)}</dd>
          <small>after every charge</small>
        </div>
        <div>
          <dt>Taxes · fees</dt>
          <dd>
            {money(taxes)} <span className="jl-dim">·</span> {money(fees)}
          </dd>
          <small>STT, GST, stamp duty · brokerage, exchange, SEBI, DP</small>
        </div>
      </dl>

      {total > 0 ? (
        <div className="jl-split">
          <Donut parts={rows} total={total} focus={focus} setFocus={setFocus} />
          <ul className="jl-legend" aria-label="Each charge">
            {rows.filter((p) => p.value > 0).map((p) => (
              <li key={p.id} className={`${focus === p.id ? "is-on" : ""} ${focus && focus !== p.id ? "is-dim" : ""}`} onPointerEnter={() => setFocus(p.id)} onPointerLeave={() => setFocus("")}>
                <i className={`jl-sw jl-c--${p.id}`} aria-hidden="true" />
                <span className="jl-legend__name" data-tip={p.what}>
                  {p.label} <small>{p.kind === "tax" ? "tax" : "fee"}</small>
                </span>
                <b>{money(p.value)}</b>
                <small className="jl-legend__share">{pct((p.value / total) * 100)}</small>
                <small className="jl-legend__per">{trades ? `${money(p.value / trades)} a trade` : ""}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="jl-dim">No charges in this period.</p>
      )}

      {/* the statement: from the realised P&L down to the net, one line a charge (Zerodha's P&L statement, as a waterfall) */}
      <div className="jl-fall" role="table" aria-label="From realised P&L to net">
        <div className="jl-fall__row is-total" role="row">
          <span role="cell">Realised P&amp;L</span>
          <span role="cell" className="jl-fall__bar">
            <i className={gross >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(gross) / big) * 100}%` }} />
          </span>
          <b role="cell" className={tone(gross)}>
            {sMoney(gross)}
          </b>
        </div>
        {rows
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.id} className="jl-fall__row" role="row">
              <span role="cell">
                <i className={`jl-sw jl-c--${p.id}`} aria-hidden="true" /> {p.label}
              </span>
              <span role="cell" className="jl-fall__bar">
                <i className={`jl-c--${p.id}`} style={{ width: `${Math.max(0.6, (p.value / big) * 100)}%` }} />
              </span>
              <b role="cell">{money(-p.value)}</b>
            </div>
          ))}
        <div className="jl-fall__row is-total is-net" role="row">
          <span role="cell">Net realised P&amp;L</span>
          <span role="cell" className="jl-fall__bar">
            <i className={net >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(net) / big) * 100}%` }} />
          </span>
          <b role="cell" className={tone(net)}>
            {sMoney(net)}
          </b>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------- the day panel */
const FIELDS = [
  ["gross", "Realised P&L (₹)", "profit as a plus number, a loss with a minus"],
  ["trades", "Trades", "how many round trips"],
  ["brokerage", "Brokerage (₹)"],
  ["stt", "STT (₹)"],
  ["exchange", "Exchange txn charges (₹)"],
  ["gst", "GST (₹)"],
  ["sebi", "SEBI fees (₹)"],
  ["stamp", "Stamp duty (₹)"],
  ["dp", "DP charges (₹)"],
  ["other", "Other (₹)"],
];

function ManualForm({ date, rec, onSaved, onCancel }) {
  const [f, setF] = useState(() => {
    const o = { note: (rec && rec.note) || "" };
    for (const [k] of FIELDS) o[k] = rec ? String(k === "gross" ? rec.gross : k === "trades" ? rec.trades : (rec.parts && rec.parts[k]) || 0) : "";
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const first = useRef(null);
  useEffect(() => {
    if (first.current) first.current.focus();
  }, []);
  const n = (k) => (f[k] === "" ? 0 : Number(f[k]));
  const charges = FIELDS.filter(([k]) => k !== "gross" && k !== "trades").reduce((a, [k]) => a + (Number.isFinite(n(k)) ? n(k) : 0), 0);
  const net = (Number.isFinite(n("gross")) ? n("gross") : 0) - charges;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = { note: f.note };
      for (const [k] of FIELDS) body[k] = f[k] === "" ? 0 : Number(f[k]);
      await api(`/api/admin/trading/journal/manual/${date}`, { method: "PUT", body });
      snack(rec ? "The day is corrected." : "The day is added to your journal.", { tone: "ok" });
      onSaved();
    } catch (x) {
      setErr(x.message || "That could not be saved.");
    }
    setBusy(false);
  };
  return (
    <form className="jl-form" onSubmit={save} noValidate>
      <div className="jl-form__grid">
        {FIELDS.map(([k, labelText, hint], i) => (
          <label key={k} className={k === "gross" ? "is-wide" : ""}>
            <span>{labelText}</span>
            <input ref={i === 0 ? first : undefined} type="number" inputMode="decimal" step={k === "trades" ? "1" : "0.01"} min={k === "gross" ? undefined : "0"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder="0" />
            {hint && <small>{hint}</small>}
          </label>
        ))}
        <label className="is-wide">
          <span>Note</span>
          <input type="text" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="for example: traded with another broker" />
        </label>
      </div>
      <p className="jl-form__sum">
        Charges {money(charges)} · Net <b className={tone(net)}>{sMoney(net)}</b>
      </p>
      {err && (
        <p className="adm-alert adm-alert--error" role="alert">
          {err}
        </p>
      )}
      <div className="jl-form__acts">
        <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy}>
          {busy ? "Saving…" : rec ? "Save the correction" : "Add this day"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DayPanel({ date, cal, trips, manual, onClose, onChanged }) {
  const ask = useDialog();
  const [editing, setEditing] = useState(false);
  const box = useRef(null);
  const back = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Escape closes; focus moves into the panel, and back to the day pressed when it closes
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    if (box.current) box.current.focus();
    const keep = back.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (keep && keep.focus) keep.focus();
    };
  }, []);
  const dayTrips = trips.filter((t) => !t.open && dayOf(t.exitAt) === date);
  const zerodha = Boolean(cal) || dayTrips.length > 0;
  const future = date > todayIst();
  const parts = {};
  for (const p of PARTS) parts[p.id] = 0;
  for (const t of dayTrips) for (const p of PARTS) parts[p.id] += (t.parts && t.parts[p.id]) || 0;
  if (manual) for (const p of PARTS) parts[p.id] += (manual.parts && manual.parts[p.id]) || 0;
  const gross = cal ? cal.gross : manual ? manual.gross : 0;
  const charges = cal ? cal.charges : manual ? manual.charges : 0;
  const net = cal ? cal.net : manual ? manual.net : 0;
  const nice = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const remove = async () => {
    if (!(await ask({ title: "Remove this day?", body: `The figures you entered for ${nice} will be removed from your journal. Days from Zerodha are not touched.`, confirmText: "Remove", tone: "danger" }))) return;
    try {
      await api(`/api/admin/trading/journal/manual/${date}`, { method: "DELETE" });
      snack("The day is removed.", { tone: "ok" });
      onChanged();
      onClose();
    } catch (x) {
      snack(x.message || "That could not be removed.", { tone: "error" });
    }
  };
  return (
    <div className="jl-scrim" onClick={onClose} role="presentation">
      <aside ref={box} className="jl-panel" role="dialog" aria-modal="true" aria-labelledby="jl-panel-h" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="jl-panel__head">
          <div>
            <h3 id="jl-panel-h">{nice}</h3>
            <span className={`jl-src ${zerodha ? "is-zerodha" : manual ? "is-manual" : ""}`}>{zerodha ? "From Zerodha · read-only" : manual ? `Entered by hand${manual.updatedAt ? " · corrected" : ""}` : future ? "Ahead" : "No trades recorded"}</span>
          </div>
          <button type="button" className="jl-x" onClick={onClose} aria-label="Close the day">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" />
            </svg>
          </button>
        </header>

        {editing ? (
          <ManualForm
            date={date}
            rec={manual}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onChanged();
            }}
          />
        ) : (
          <>
            {(zerodha || manual) && (
              <dl className="jl-panel__kpis">
                <div>
                  <dt>Realised P&amp;L</dt>
                  <dd className={tone(gross)}>{sMoney(gross)}</dd>
                </div>
                <div>
                  <dt>Charges &amp; taxes</dt>
                  <dd>{money(-charges)}</dd>
                </div>
                <div>
                  <dt>Net</dt>
                  <dd className={tone(net)}>{sMoney(net)}</dd>
                </div>
              </dl>
            )}
            {(zerodha || manual) && charges > 0 && (
              <ul className="jl-panel__parts" aria-label="The day's charges">
                {PARTS.filter((p) => parts[p.id] > 0).map((p) => (
                  <li key={p.id}>
                    <i className={`jl-sw jl-c--${p.id}`} aria-hidden="true" />
                    <span>{p.label}</span>
                    <b>{money(parts[p.id])}</b>
                  </li>
                ))}
              </ul>
            )}
            {dayTrips.length > 0 && (
              <div className="jl-panel__trips">
                <h4>
                  {dayTrips.length} trade{dayTrips.length === 1 ? "" : "s"}
                </h4>
                <ul>
                  {dayTrips.map((t) => (
                    <li key={t.key}>
                      <b>{t.symbol}</b>
                      <span className={t.side === "long" ? "is-up" : "is-down"}>{t.side === "long" ? "Long" : "Short"}</span>
                      <small>
                        {t.qty} @ {num(t.entryAvg)} → {num(t.exitAvg)}
                      </small>
                      <b className={tone(t.net)}>{sMoney(t.net)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {zerodha && cal && dayTrips.length === 0 && <p className="jl-dim">The trades of this day are older than the latest 500 shown here; its totals above are complete.</p>}
            {manual && manual.note && <p className="jl-note">“{manual.note}”</p>}
            {zerodha ? (
              <p className="jl-lock">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
                These figures come from Zerodha's own record and cannot be changed here.
              </p>
            ) : future ? (
              <p className="jl-dim">A day ahead cannot be entered.</p>
            ) : manual ? (
              <div className="jl-panel__acts">
                <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => setEditing(true)}>
                  Correct this day
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={remove}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="jl-panel__acts">
                <p className="jl-dim">No Zerodha trades on this day. If you traded elsewhere, you can enter the day by hand.</p>
                <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => setEditing(true)}>
                  Enter this day by hand
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------------------------------- the calendar */
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthKey = (d) => d.slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};

/**
 * @param calendar  the period's days from Zerodha: [{ key: "YYYY-MM-DD", net, gross, charges, trades }]
 * @param trips     the latest trades (with their charges, one by one)
 * @param manual    days entered by hand
 */
export function MonthCalendar({ calendar = [], trips = [], manual = [], toDay = "", onChanged }) {
  const byDay = useMemo(() => new Map(calendar.map((c) => [c.key, c])), [calendar]);
  const byManual = useMemo(() => new Map(manual.map((m) => [m.date, m])), [manual]);
  const latest = useMemo(() => {
    const days = [...byDay.keys(), ...byManual.keys()].sort();
    return days.length ? monthKey(days[days.length - 1]) : monthKey(toDay || todayIst());
  }, [byDay, byManual, toDay]);
  const [ym, setYm] = useState(latest);
  const [open, setOpen] = useState("");
  const [dir, setDir] = useState(0);
  useEffect(() => setYm(latest), [latest]);
  const today = todayIst();
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysIn; d += 1) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const inMonth = (k) => k && k.startsWith(ym);
  const monthDays = [...byDay.values()].filter((c) => inMonth(c.key));
  const monthManual = [...byManual.values()].filter((c) => inMonth(c.date));
  const mNet = monthDays.reduce((a, c) => a + c.net, 0) + monthManual.reduce((a, c) => a + c.net, 0);
  const green = monthDays.filter((c) => c.net > 0).length + monthManual.filter((c) => c.net > 0).length;
  const red = monthDays.filter((c) => c.net < 0).length + monthManual.filter((c) => c.net < 0).length;
  const go = (n) => {
    setDir(n);
    setYm((x) => addMonths(x, n));
  };
  const title = first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className="an-card jl-cal" aria-labelledby="jl-cal-h" data-jump="Calendar">
      <header className="jl-cal__head">
        <div className="jl-cal__nav">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setYm(monthKey(today))}>
            Today
          </button>
          <button type="button" className="jl-cal__arrow" onClick={() => go(-1)} aria-label="The month before">
            ‹
          </button>
          <button type="button" className="jl-cal__arrow" onClick={() => go(1)} aria-label="The month after">
            ›
          </button>
          <h3 id="jl-cal-h">{title}</h3>
        </div>
        <p className="jl-cal__sum" aria-live="polite">
          <b className={tone(mNet)}>{sMoney(mNet)}</b> <span>this month</span> · <span className="is-up">{green} green</span> · <span className="is-down">{red} red</span>
        </p>
      </header>
      <div className="jl-cal__week" aria-hidden="true">
        {WEEK.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div key={ym} className={`jl-cal__grid ${dir > 0 ? "is-next" : dir < 0 ? "is-prev" : ""}`} role="grid" aria-label={title}>
        {cells.map((k, i) => {
          if (!k) return <span key={`e${i}`} className="jl-cell is-empty" aria-hidden="true" />;
          const c = byDay.get(k);
          const mm = byManual.get(k);
          const net = c ? c.net : mm ? mm.net : null;
          const dow = i % 7;
          const weekend = dow >= 5;
          const label = `${Number(k.slice(8))} ${title}: ${net === null ? "no trades" : `${sMoney(net)}${c ? `, ${c.trades} trade${c.trades === 1 ? "" : "s"}` : ""}${mm ? ", entered by hand" : ""}`}`;
          return (
            <button
              key={k}
              type="button"
              role="gridcell"
              className={`jl-cell ${weekend ? "is-weekend" : ""} ${k === today ? "is-today" : ""} ${net === null ? "" : net > 0 ? "is-gain" : net < 0 ? "is-loss" : "is-flat"} ${open === k ? "is-open" : ""}`}
              onClick={() => setOpen(k)}
              aria-label={label}
            >
              <span className="jl-cell__d">{Number(k.slice(8))}</span>
              {net !== null && <b className="jl-cell__v">{compact(net)}</b>}
              {c && <small className="jl-cell__n">{c.trades} trade{c.trades === 1 ? "" : "s"}</small>}
              {mm && (
                <small className="jl-cell__m" title="Entered by hand">
                  by hand
                </small>
              )}
            </button>
          );
        })}
      </div>
      <p className="jl-dim jl-cal__foot">Press a day for its trades and charges. Days with no Zerodha trades can be entered by hand; Zerodha's own days are read-only.</p>
      {open && <DayPanel date={open} cal={byDay.get(open) || null} manual={byManual.get(open) || null} trips={trips} onClose={() => setOpen("")} onChanged={onChanged} />}
    </section>
  );
}
