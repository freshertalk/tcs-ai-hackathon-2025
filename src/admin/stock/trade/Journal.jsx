// The trading journal: every round trip you made, and what the numbers say about how you
// trade — profit and loss for any period (today, yesterday, this week / month / quarter, the last
// 6, 9 and 12 months, this financial year, every past financial year, all time, a custom range or a
// saved view), net after estimated charges, win rate, profit factor, expectancy, drawdown, streaks;
// the financial-year chart, the month heatmap, the equity curve, the P&L calendar, month-by-month
// and day-by-day tables; where the money is made and lost; MAE/MFE; tags and notes; an AI review;
// CSV downloads of all of it. Every figure comes from Zerodha: today's fills are read from Kite by
// the server by itself, and the history from Zerodha Console tradebook files. Nothing is typed in.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { useAiStatus } from "../../aiStatus";
import { isNum, num, when } from "../analyzer/format";
import { DayTable, FyChart, MonthHeatmap, MonthTable, PeriodBar, PeriodTable, Sources, dayLabel, downloadCsv, monthLabel } from "./JournalPeriods";
import { Dashboard, Hero, Retro, useRetro } from "./JournalCharts";
import { CommandBar, PrintReport, ReturnsTab, TABS, downloadJson } from "./JournalPro";
import { LineChart } from "../analysis/charts";
import { everyVisible } from "../../visible";
import DayBook from "../analysis/DayBook";
import { PnlBySymbol, PnlSummary, unrealisedOf } from "./PnlReport";
import { useLiveBook } from "./liveBook";
import { ChargesBreakdown, MonthCalendar } from "./JournalLedger";
import OtherLedger from "./OtherLedger";
import PnlGrid from "./PnlGrid";
import "./trade.css";
const IST = 5.5 * 3600 * 1000;
const day = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const time = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const hold = (m) => (!isNum(m) ? "open" : m < 60 ? `${m}m` : m < 60 * 24 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`);

/* ---------------------------------------------------------- equity curve */

const TRIP_ROWS = 25;
const TAB_KEY = "vpt.journal.tab";
const SORTS = [
  ["new", "Newest first"],
  ["old", "Oldest first"],
  ["best", "Best result"],
  ["worst", "Worst result"],
  ["long", "Longest held"],
];

/* --------------------------------------------------------- P&L calendar */
const longDay = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The three figures of one day, in short words: profit or loss, taxes, and brokerage with the taxes. */
function DayFigures({ k, d }) {
  if (!k) return <p className="jr-cal__hint">Hover over a date to see its figures. Click or tap a date to keep it open.</p>;
  return (
    <div className="jr-cal__tip">
      <p className="jr-cal__head">
        <b>{longDay(k)}</b>
        {d ? (
          <span>
            {d.trades} trade{d.trades === 1 ? "" : "s"} · net realised P&amp;L <b className={tone(d.net)}>{sMoney(d.net)}</b>
          </span>
        ) : (
          <span>no trades</span>
        )}
      </p>
      {d && (
        <dl>
          <div data-tip="Profit or loss of the day's closed trades, before charges & taxes (Zerodha's Realised P&L).">
            <dt>Realised P&amp;L</dt>
            <dd className={tone(d.gross)}>{sMoney(d.gross)}</dd>
          </div>
          <div data-tip="STT, exchange fee, SEBI fee, GST, stamp duty and DP charge: the taxes and statutory fees (an estimate).">
            <dt>Taxes</dt>
            <dd>{sMoney(-d.taxes)}</dd>
          </div>
          <div data-tip="Brokerage plus all the taxes above: everything the day cost (an estimate).">
            <dt>Charges &amp; taxes</dt>
            <dd>{sMoney(-d.charges)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Calendar({ days, fromDay, toDay }) {
  const box = useRef(null);
  const [hover, setHover] = useState("");
  const [sel, setSel] = useState("");
  // on a phone the months are one row to swipe through: it opens on the newest
  useEffect(() => {
    if (box.current) box.current.scrollLeft = box.current.scrollWidth;
  }, [days.length]);
  const byDay = new Map(days.map((d) => [d.key, d]));
  const max = Math.max(...days.map((d) => Math.abs(d.net)), 1);
  // the months of the period shown (the last twelve of a longer one), newest on the right
  const last = (toDay || day(Date.now())).slice(0, 7);
  // from the first month of the period that has a trade (empty months before it say nothing)
  const firstTrade = days.length ? days.reduce((a, d) => (d.key < a ? d.key : a), days[0].key) : "";
  const first = [fromDay || "", firstTrade || last].sort().pop().slice(0, 7);
  const months = [];
  for (let m = last; m >= first && months.length < 12; ) {
    months.unshift(m);
    const [yy, mm] = m.split("-").map(Number);
    m = mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, "0")}`;
  }
  const shown = hover || sel;
  return (
    <div className="jr-calw">
      <div className="jr-cal" ref={box}>
        {months.map((m) => {
          const [yy, mm] = m.split("-").map(Number);
          const first = new Date(Date.UTC(yy, mm - 1, 1));
          const len = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
          const lead = (first.getUTCDay() + 6) % 7; // Monday first
          const cells = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`)];
          const total = days.filter((d) => d.key.startsWith(m)).reduce((a, d) => a + d.net, 0);
          return (
            <div key={m} className="jr-cal__m">
              <p>
                <b>{first.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}</b> <span className={tone(total)}>{sMoney(total)}</span>
              </p>
              <div className="jr-cal__grid">
                {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
                  <span key={`h${i}`} className="jr-cal__h">
                    {w}
                  </span>
                ))}
                {cells.map((k, i) => {
                  if (!k) return <span key={`e${i}`} />;
                  const d = byDay.get(k);
                  const a = d ? 0.18 + 0.82 * Math.min(1, Math.abs(d.net) / max) : 0;
                  const future = k > day(Date.now());
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`jr-cal__d ${d ? (d.net >= 0 ? "is-up" : "is-down") : ""} ${sel === k ? "is-sel" : ""} ${future ? "is-future" : ""}`}
                      style={d ? { "--a": a } : undefined}
                      onMouseEnter={() => setHover(k)}
                      onMouseLeave={() => setHover("")}
                      onFocus={() => setHover(k)}
                      onBlur={() => setHover("")}
                      onClick={() => setSel((x) => (x === k ? "" : k))}
                      aria-pressed={sel === k}
                      aria-label={d ? `${longDay(k)}: net ${sMoney(d.net)}, ${d.trades} trade${d.trades === 1 ? "" : "s"}` : `${longDay(k)}: no trades`}
                    >
                      <span className="jr-cal__n">{Number(k.slice(8))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div role="status" aria-live="polite">
        <DayFigures k={shown} d={shown ? byDay.get(shown) : null} />
      </div>
    </div>
  );
}

function Breakdown({ title, rows, tip, limit = 12 }) {
  if (!rows || !rows.length) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
  return (
    <section className="jr-bd" data-tip={tip}>
      <h4>{title}</h4>
      <table className="an-table jr-bd__t">
        <thead>
          <tr>
            <th scope="col"> </th>
            <th scope="col" className="is-num">
              Trades
            </th>
            <th scope="col" className="is-num">
              Win %
            </th>
            <th scope="col" className="is-num" data-tip="Net realised P&L: after charges & taxes.">
              Net P&amp;L
            </th>
            <th scope="col">
              <span className="adm-sr">Bar</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r) => (
            <tr key={r.key} className={r.trades < 8 ? "is-thin" : ""}>
              <th scope="row">{r.key}</th>
              <td className="is-num">{r.trades}</td>
              <td className="is-num">{num(r.winRate, 0)}%</td>
              <td className={`is-num ${tone(r.net)}`}>{sMoney(r.net)}</td>
              <td className="jr-bd__bar">
                <i className={r.net >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(r.net) / max) * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* --------------------------------------------------------- tag editor */
function TagEditor({ trip, setups, mistakes, onSaved, onClose }) {
  const t = trip.tags || {};
  const [f, setF] = useState({ setup: t.setup || "", mistakes: t.mistakes || [], note: t.note || "", rating: t.rating || null });
  const [err, setErr] = useState("");
  const save = async () => {
    try {
      await api("/api/admin/trading/journal/tags", { method: "PUT", body: { key: trip.key, ...f } });
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="jr-tag">
      <label className="tr-field">
        <span>Setup</span>
        <input list="jr-setups" value={f.setup} onChange={(e) => setF((x) => ({ ...x, setup: e.target.value }))} placeholder="e.g. Opening range breakout" />
        <datalist id="jr-setups">
          {setups.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <div className="jr-tag__m" role="group" aria-label="Mistakes">
        {mistakes.map((m) => (
          <label key={m} className={`rs-pick ${f.mistakes.includes(m) ? "is-on" : ""}`}>
            <input type="checkbox" checked={f.mistakes.includes(m)} onChange={() => setF((x) => ({ ...x, mistakes: x.mistakes.includes(m) ? x.mistakes.filter((y) => y !== m) : [...x.mistakes, m] }))} /> {m}
          </label>
        ))}
      </div>
      <label className="tr-field">
        <span>Note</span>
        <input value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} placeholder="What you saw, what you felt" />
      </label>
      <div className="jr-tag__r" role="radiogroup" aria-label="Execution rating">
        <span>Execution</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={f.rating === n} className={f.rating >= n ? "is-on" : ""} onClick={() => setF((x) => ({ ...x, rating: x.rating === n ? null : n }))} aria-label={`${n} of 5`}>
            ★
          </button>
        ))}
      </div>
      <Alert>{err}</Alert>
      <span className="jr-tag__a">
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={save}>
          Save
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onClose}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ AI review */
function ReviewPanel({ sel, label }) {
  const [st0, setSt] = useState({ configured: false, reviews: [] });
  const aiNow = useAiStatus();
  const st = { ...st0, configured: aiNow ? aiNow.configured : st0.configured };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/trading/journal/reviews").then(setSt).catch(() => {});
  }, []);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const d = await api("/api/admin/trading/journal/review", { method: "POST", body: { period: sel.period, from: sel.from, to: sel.to, range: label } });
      setSt({ configured: d.configured, reviews: d.reviews });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const add = async (id, index) => {
    try {
      const d = await api(`/api/admin/trading/journal/review/${encodeURIComponent(id)}/rule`, { method: "POST", body: { index } });
      setSt((s) => ({ ...s, reviews: s.reviews.map((r) => (r.id === d.review.id ? d.review : r)) }));
    } catch (e) {
      setErr(e.message);
    }
  };
  const r = st.reviews[0];
  return (
    <section className="an-card jr-rev">
      <header className="an-card__head">
        <div>
          <h3>AI review of your trading</h3>
          <p>The model reads this journal’s numbers — by stock, hour, weekday, side, setup and mistake, with MAE/MFE where measured — and names where your money is made and where it leaks, with the figures. Rules it suggests go into your skills file only if you add them.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={run} disabled={busy || !st.configured} data-tip="Review the trades in the period shown. It uses your AI company's tokens, and runs only when you press it.">
          {busy ? "Reading your journal…" : `Review ${label || "this period"}`}
        </button>
      </header>
      {!st.configured && <p className="adm-alert adm-alert--info">Add an AI API key in the AI settings to use the review.</p>}
      <Alert>{err}</Alert>
      {r && (
        <div className="jr-rev__out">
          <p className="vd-note">
            {when(r.at)} · {r.range} · {r.trades} trades · {sMoney(r.net)} · {r.model}
          </p>
          <h4>{r.headline}</h4>
          <p>{r.summary}</p>
          <div className="rs-cols">
            <div>
              <h4>What works</h4>
              <ul>
                {r.edge.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Where it leaks</h4>
              <ul>
                {r.leaks.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          {r.rules.length > 0 && (
            <>
              <h4>Suggested rules</h4>
              <ul className="jr-rules">
                {r.rules.map((x, i) => (
                  <li key={x.text}>
                    {x.text}{" "}
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={x.added} onClick={() => add(r.id, i)} data-tip="Add this rule to your trading-skills file, which every AI request reads.">
                      {x.added ? "Added" : "Add to skills"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.focus && (
            <p className="tr-note">
              <b>Focus next:</b> {r.focus}
            </p>
          )}
          <p className="vd-note">{r.caveat} Past results do not predict future ones; this is not investment advice.</p>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- view */
const TRIP_HEAD = ["Entry", "Exit", "Symbol", "Exchange", "Side", "Product", "Qty", "Entry avg", "Exit avg", "Hold (min)", "Realised P&L", "Brokerage", "Charges & taxes", "Net realised P&L", "Setup", "Mistakes", "Note", "Rating"];
const stamp = (ms) => (ms ? new Date(ms + IST).toISOString().slice(0, 16).replace("T", " ") : "");

const PART_KEY = "vpt.journal.part";

/**
 * The Journal: its trades and analytics, and the Day book — every trading day's report, saved by
 * itself at 3:45 PM (and any missed day within the hour). Nothing in either is saved by hand.
 */
export default function Journal() {
  const [part, setPart] = useState(() => {
    try {
      return window.localStorage.getItem(PART_KEY) === "days" ? "days" : "trades";
    } catch (_) {
      return "trades";
    }
  });
  const pick = (p) => {
    setPart(p);
    try {
      window.localStorage.setItem(PART_KEY, p);
    } catch (_) {
      /* remembered for this visit only */
    }
  };
  return (
    <div className="jr-wrap">
      <div className="jr-parts" role="tablist" aria-label="Journal">
        <button type="button" role="tab" aria-selected={part === "trades"} onClick={() => pick("trades")}>
          Trades &amp; analytics
        </button>
        <button type="button" role="tab" aria-selected={part === "days"} onClick={() => pick("days")} data-tip="Every trading day's report — profit, loss, charges, margin, what went well — saved by itself at 3:45 PM, and any missed day within the hour.">
          Day book <small>saved by itself</small>
        </button>
      </div>
      {part === "days" ? <DayBook /> : <TradesJournal />}
    </div>
  );
}

function TradesJournal() {
  const [sel, setSel] = useState({ period: "fy", from: "", to: "" });
  const [kind, setKind] = useState("intraday"); // an intraday desk: intraday trades first
  const [side, setSide] = useState("");
  const [setup, setSetup] = useState("");
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [per, setPer] = useState(null);
  const [editing, setEditing] = useState("");
  const [tab, setTab] = useState(() => {
    try {
      const t = window.localStorage.getItem(TAB_KEY);
      return TABS.some((x) => x.id === t) ? t : "overview";
    } catch (_) {
      return "overview";
    }
  });
  const [q, setQ] = useState("");
  const [result, setResult] = useState("all");
  const [sortBy, setSortBy] = useState("new");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(TRIP_ROWS);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [hmsg, setHmsg] = useState({ kind: "", text: "" }); // MAE / MFE (shown at the top)
  const [busy, setBusy] = useState("");
  const top = useRef(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ period: sel.period, ...(sel.period === "custom" ? { from: sel.from, to: sel.to } : {}), ...(kind ? { kind } : {}), ...(side ? { side } : {}), ...(setup ? { setup } : {}) });
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(`/api/admin/trading/journal?${q}`)
      .then((d) => {
        setState({ loading: false, data: d, error: "" });
        setUpdatedAt(Date.now());
      })
      .catch((e) => setState((s) => ({ loading: false, data: s.data, error: e.message })));
  }, [sel, kind, side, setup]);
  const loadPer = useCallback(() => {
    api("/api/admin/trading/journal/periods")
      .then((d) => d && Array.isArray(d.rows) && setPer(d))
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => loadPer(), [loadPer]);
  // the journal keeps itself current while the tab is in view
  useEffect(() => everyVisible(() => load(), 60000, { catchUp: true, topics: ["trading", "analysis"] }), [load]);
  const goTab = useCallback((t) => {
    setTab(t);
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch (_) {
      /* remembered for this visit only */
    }
  }, []);
  // 1–6 switch the tabs (not while typing)
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const t = TABS.find((x) => x.key === e.key);
      if (t) goTab(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTab]);
  // a saved view brings its filters with it
  useEffect(() => {
    if (!sel.view) return;
    setKind(sel.view.kind || "");
    setSide(sel.view.side || "");
    setSetup(sel.view.setup || "");
  }, [sel.view]);

  const pick = (id) => {
    setSel({ period: id, from: "", to: "" });
    if (top.current && top.current.scrollIntoView) top.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const pickMonth = (m) => {
    const [y, mm] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    setSel({ period: "custom", from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` });
    if (top.current && top.current.scrollIntoView) top.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const measure = async () => {
    setBusy("exc");
    setHmsg({ kind: "", text: "" });
    try {
      const d = await api("/api/admin/trading/journal/excursions", { method: "POST", body: { limit: 25 } });
      setHmsg({ kind: d.failed.length ? "error" : "ok", text: `Measured ${d.done} trade${d.done === 1 ? "" : "s"}.${d.left ? ` ${d.left} still to do — press again.` : ""}${d.failed.length ? ` Not measured: ${d.failed.join("; ")}` : ""}` });
      load();
    } catch (e) {
      setHmsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };

  const retro = useRetro(sel, { kind, side, setup });
  const d = state.data;
  const s = d ? d.stats : null;
  const a = d ? d.analytics : null;
  const rt = d ? d.returns || null : null;
  const capital = d ? d.capital || [] : [];
  const other = d ? d.other || null : null; // other credits & debits of the period (part of Net realised P&L)
  const netAll = s ? Math.round((s.net + (other && other.count ? other.total : 0)) * 100) / 100 : null;
  const period = d && d.period;
  const label = period ? period.label : "";
  const fileTag = period ? `${period.fromDay || "start"}_${period.toDay}` : "journal";
  // Zerodha's P&L report, figure for figure: the open positions come from the live book when the period reaches today
  const book = useLiveBook();
  const unreal = useMemo(() => unrealisedOf({ s, period, book }), [s, period, book]);
  const symbolCsv = (rows) =>
    downloadCsv(
      `pnl-by-symbol-${fileTag}.csv`,
      ["Symbol", "Qty.", "Buy avg.", "Buy value", "Sell avg.", "Sell value", "Realised P&L", "Unrealised P&L"],
      rows.map((r) => [r.key, r.qty, r.buyAvg ?? "", r.buyValue ?? "", r.sellAvg ?? "", r.sellValue ?? "", r.gross, isNum(r.unrealised) ? r.unrealised : ""])
    );
  const bySym = useMemo(() => (s && s.by && s.by.symbol ? [...s.by.symbol.slice(0, 8), ...s.by.symbol.slice(-4).filter((x) => !s.by.symbol.slice(0, 8).includes(x))] : []), [s]);
  const monthRows = useMemo(() => {
    if (!a) return null;
    const by = Object.fromEntries(((rt && rt.months) || []).map((m) => [m.month, m.pct]));
    return a.months.map((m) => ({ ...m, netPct: by[m.month] ?? null }));
  }, [a, rt]);
  const dayRows = useMemo(() => {
    if (!s) return [];
    const by = Object.fromEntries(((rt && rt.daily) || []).map((x) => [x.date, x.pct]));
    return s.calendar.map((x) => ({ ...x, netPct: by[x.key] ?? null }));
  }, [s, rt]);
  // the trades list: search, result, sort, page
  const shown = useMemo(() => {
    if (!d) return [];
    const needle = q.trim().toUpperCase();
    let list = d.trips.filter((t) => (!needle || t.symbol.includes(needle)) && (result === "all" || (result === "win" && !t.open && t.net > 0) || (result === "loss" && !t.open && t.net < 0) || (result === "open" && t.open)));
    const at = (t) => (t.open ? t.entryAt : t.exitAt);
    if (sortBy === "old") list = [...list].sort((x, y) => at(x) - at(y));
    else if (sortBy === "best") list = [...list].sort((x, y) => (y.net ?? 0) - (x.net ?? 0));
    else if (sortBy === "worst") list = [...list].sort((x, y) => (x.net ?? 0) - (y.net ?? 0));
    else if (sortBy === "long") list = [...list].sort((x, y) => (y.holdMin ?? 0) - (x.holdMin ?? 0));
    return list;
  }, [d, q, result, sortBy]);
  useEffect(() => setPage(0), [q, result, sortBy, pageSize, d]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const pageRows = shown.slice(page * pageSize, page * pageSize + pageSize);
  const shownNet = shown.reduce((x, t) => x + (t.open ? 0 : t.net || 0), 0);
  const filterText = [kind || "", side || "", setup ? `setup ${setup}` : ""].filter(Boolean).join(" · ") || "all trades";
  const tripsCsv = () =>
    downloadCsv(
      `trades-${fileTag}.csv`,
      TRIP_HEAD,
      d.trips.filter((t) => !t.open).map((t) => [stamp(t.entryAt), stamp(t.exitAt), t.symbol, t.exchange, t.side, t.product, t.maxQty, t.entryAvg, t.exitAvg, t.holdMin, t.pnl, t.brokerage, t.charges, t.net, t.tags ? t.tags.setup : "", t.tags ? t.tags.mistakes.join("; ") : "", t.tags ? t.tags.note : "", t.tags && t.tags.rating ? t.tags.rating : ""])
    );

  // the year of days, as on Zerodha Console's P&L report: the last 12 months, this FY or any past FY
  const gridRanges = [{ id: "12m", label: "Last 12 months" }];
  const fyRow = per && per.rows ? per.rows.find((r) => r.id === "fy") : null;
  if (fyRow && fyRow.fromDay) gridRanges.push({ id: "fy", label: fyRow.label || "This FY", fromDay: fyRow.fromDay, toDay: fyRow.toDay });
  for (const r of (per && per.fys) || []) if (r && r.fromDay) gridRanges.push({ id: r.id, label: r.label, fromDay: r.fromDay, toDay: r.toDay });
  const grid = d ? (
    <PnlGrid
      kind={kind}
      side={side}
      setup={setup}
      refreshKey={updatedAt || 0}
      ranges={gridRanges}
      segment={kind === "intraday" ? "Equity · intraday" : kind === "delivery" ? "Equity · delivery" : "Equity"}
      onOpenDay={(k) => {
        setSel({ period: "custom", from: k, to: k });
        if (top.current && top.current.scrollIntoView) top.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    />
  ) : null;

  return (
    <div className="jr">
      <section className="an-card jr-head" ref={top}>
        <header className="an-card__head">
          <div>
            <h3>Trading journal</h3>
            <p>Profit and loss for any period since your account opened — every figure from Zerodha. Today’s trades are read from Kite by the server by itself; the history comes from Zerodha Console tradebook files (see “Where the history comes from” below). Nothing is typed in by hand.</p>
          </div>
          <span className="jr-head__act">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={measure} disabled={Boolean(busy)} data-tip="Measure MAE and MFE — how far each trade went against you and in your favour — from 1-minute bars, for up to 25 recent trades (Zerodha keeps about 60 days of them).">
              {busy === "exc" ? "Measuring…" : "Measure MAE / MFE"}
            </button>
          </span>
        </header>
        <PeriodBar key={sel.view ? sel.view.id : "bar"} sel={sel} setSel={setSel} fys={per ? per.fys : []} views={per ? per.views || [] : []} filters={{ kind, side, setup }} onViews={(views) => setPer((x) => (x ? { ...x, views } : x))} />
        <div className="jr-filters">
          <div className="sv__ranges" role="group" aria-label="Kind">
            {[["", "All"], ["intraday", "Intraday"], ["delivery", "Delivery"]].map(([v, l]) => (
              <button key={l} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="sv__ranges" role="group" aria-label="Side">
            {[["", "Both"], ["long", "Long"], ["short", "Short"]].map(([v, l]) => (
              <button key={l} type="button" aria-pressed={side === v} onClick={() => setSide(v)}>
                {l}
              </button>
            ))}
          </div>
          {d && d.setups.length > 0 && (
            <label className="tr-field jr-filters__setup">
              <span className="adm-sr">Setup</span>
              <select value={setup} onChange={(e) => setSetup(e.target.value)}>
                <option value="">All setups</option>
                {d.setups.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {period && (
          <p className="jp-now">
            <b>{label}</b>
            {period.fromDay && period.id !== "custom" ? <span> · {period.fromDay === period.toDay ? dayLabel(period.toDay) : `${dayLabel(period.fromDay)} – ${dayLabel(period.toDay)}`}</span> : null}
            {sel.view ? <span className="jr-chip">view: {sel.view.name}</span> : null}
          </p>
        )}
        <Alert kind={hmsg.kind === "ok" ? "ok" : "error"}>{hmsg.text}</Alert>
        <Alert>{state.error}</Alert>
      </section>

      <CommandBar
        label={label}
        s={s}
        netAll={netAll}
        rt={rt}
        tab={tab}
        setTab={goTab}
        counts={{ trades: d ? d.trips.length : 0 }}
        updatedAt={updatedAt}
        loading={state.loading}
        onRefresh={() => {
          load();
          loadPer();
        }}
        onTop={() => top.current && top.current.scrollIntoView && top.current.scrollIntoView({ behavior: "smooth", block: "start" })}
        gaps={per ? per.gaps.length : 0}
      />

      {state.loading && !d && <Loading label="Reading your journal…" />}
      {d && d.fills === 0 && <p className="adm-alert adm-alert--info">The journal is empty. Trades are added by themselves every trading day while Zerodha is connected; import your Console tradebooks below for the history since your account opened.</p>}
      {s && s.trades === 0 && d.fills > 0 && <p className="adm-alert adm-alert--info">No closed trades in {label || "this period"}. Pick another period above, or a row in the table below.</p>}


      {tab === "overview" && s && s.trades > 0 && (
        <>
          <Hero s={s} a={a} rt={rt} label={label} period={period} onRetro={retro.run} busy={retro.busy} onCapital={() => goTab("returns")} />
          <Alert>{retro.err}</Alert>
          {retro.r && <Retro r={retro.r} list={retro.list} onOpen={retro.open} onClose={retro.close} />}
          {grid}
          <PnlSummary s={s} unrealised={unreal} period={period} other={other} />
          {/* where the money went: every charge on its own (and days entered by hand, when included) */}
          <ChargesBreakdown s={s} parts={d.chargeParts} manual={d.manualDays || []} label={label} />
          <OtherLedger other={other} label={label} onChanged={load} />
          <dl className="jp2-tiles jr-glance">
            <div className="jp2-tile">
              <dt>Expectancy</dt>
              <dd className={tone(s.expectancy)}>{sMoney(s.expectancy)}</dd>
              <small>average result of a trade, after charges</small>
            </div>
            <div className="jp2-tile">
              <dt>Profit factor</dt>
              <dd>{s.profitFactor === null ? "∞" : num(s.profitFactor)}</dd>
              <small>won for every ₹1 lost</small>
            </div>
            <div className="jp2-tile">
              <dt>Average win / loss</dt>
              <dd>
                <span className="is-up">{sMoney(s.avgWin)}</span> / <span className="is-down">{sMoney(s.avgLoss)}</span>
              </dd>
              <small>payoff {s.payoff === null ? "—" : num(s.payoff)}</small>
            </div>
            <div className="jp2-tile">
              <dt>Charges &amp; taxes</dt>
              <dd>{sMoney(-s.charges)}</dd>
              <small>{a && a.summary.chargesPct !== null ? `${num(a.summary.chargesPct, 0)}% of the realised profit` : "brokerage, taxes and fees"}</small>
            </div>
            <div className="jp2-tile">
              <dt>Deepest fall</dt>
              <dd className="is-down">{sMoney(-s.maxDrawdown)}</dd>
              <small>{rt && rt.hasCapital && rt.risk.maxDrawdownPct !== null ? `${rt.risk.maxDrawdownPct.toFixed(2)} pts of principal` : "from the running total's peak"}</small>
            </div>
            <div className="jp2-tile">
              <dt>Green days</dt>
              <dd>
                {s.greenDays} / {s.tradingDays}
              </dd>
              <small>
                runs: {s.bestStreak} wins · {s.worstStreak} losses
              </small>
            </div>
          </dl>
          {s.curve.length > 1 && (
            <section className="an-card">
              <header className="jp-head">
                <h3 className="jr-h">Your money over time</h3>
                <small className="jp2-dim">running profit or loss after charges, trade by trade</small>
              </header>
              <LineChart xs={s.curve.map((c) => day(c.at))} series={[{ label: "Total so far", values: s.curve.map((c) => c.equity), c: s.net >= 0 ? "up" : "down", area: true }]} height={230} label="Your total profit or loss over time" />
            </section>
          )}
          {/* the month, like Google Calendar: a day opens its trades and charges; days with no Zerodha trades can be entered by hand */}
          <MonthCalendar
            calendar={s.calendar}
            trips={d.trips}
            manual={d.manualDays || []}
            toDay={period && period.toDay}
            onChanged={() => {
              load();
              loadPer();
            }}
          />
          <section className="an-card jr-calcard">
            <h3 className="jr-h">📆 Every day on a calendar</h3>
            <p className="jc-info">Green days made money, red days lost money; the deeper the colour, the bigger the amount. Point at a day for its figures.</p>
            <Calendar days={s.calendar} fromDay={period && period.fromDay} toDay={period && period.toDay} />
          </section>
          <PnlBySymbol rows={s.by.symbol} unrealised={unreal} onCsv={symbolCsv} updated={updatedAt ? new Date(updatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : ""} />

        </>
      )}

      {/* no Zerodha trades in the period: the calendar still opens, so a day traded elsewhere can be entered by hand */}
      {tab === "overview" && d && (!s || s.trades === 0) && (
        <>
          {grid}
          {(d.manualDays || []).length > 0 && <ChargesBreakdown s={null} parts={null} manual={d.manualDays} label={label} />}
          <MonthCalendar
            calendar={[]}
            trips={[]}
            manual={d.manualDays || []}
            toDay={period && period.toDay}
            onChanged={() => {
              load();
              loadPer();
            }}
          />
        </>
      )}

      {tab === "returns" && <ReturnsTab rt={rt} capital={capital} label={fileTag} onChanged={() => { load(); loadPer(); }} />}

      {tab === "performance" && s && s.trades > 0 && (
        <>
          <Dashboard s={s} a={a} />

          <details className="an-card jr-more-card">
            <summary>
              <b>All the numbers</b> <small>— every figure of this period, group by group, for a closer look</small>
            </summary>
            <dl className="tr-tiles jr-tiles">
              <div className={tone(netAll)} data-tip="Realised P&L minus the estimated charges & taxes, plus other credits & debits, on trades closed in this period (Zerodha's Net realised P&L).">
                <dt>Net realised P&amp;L</dt>
                <dd>{sMoney(netAll)}</dd>
                <small>
                  realised P&amp;L {sMoney(s.gross)} · charges &amp; taxes {sMoney(-s.charges)}
                  {other && other.count > 0 ? ` · other credits & debits ${sMoney(other.total)}` : ""}
                </small>
              </div>
              <div className={tone(s.netPct)} data-tip="Net profit or loss as a share of the money put into the trades: each trade's size at its entry price, added up. A trade done many times counts each time, so this is the return on the money traded, not on your account.">
                <dt>Profit / loss %</dt>
                <dd>{s.netPct === null || s.netPct === undefined ? "—" : `${s.netPct > 0 ? "+" : s.netPct < 0 ? "−" : ""}${Math.abs(s.netPct).toFixed(2)}%`}</dd>
                <small>
                  of {s.invested ? `₹${num(s.invested, 0)}` : "—"} put into the trades · gross {s.grossPct === null || s.grossPct === undefined ? "—" : `${s.grossPct > 0 ? "+" : s.grossPct < 0 ? "−" : ""}${Math.abs(s.grossPct).toFixed(2)}%`}
                </small>
              </div>
              <div data-tip="Share of closed trades that made money after charges.">
                <dt>Win rate</dt>
                <dd>{num(s.winRate, 1)}%</dd>
                <small>
                  {s.wins} won · {s.losses} lost · {s.trades} trades
                </small>
              </div>
              <div className={s.profitFactor !== null && s.profitFactor < 1 ? "is-down" : ""} data-tip="Money won divided by money lost. Above 1 the trades made money overall; below 1 they lost it.">
                <dt>Profit factor</dt>
                <dd>{s.profitFactor === null ? "∞" : num(s.profitFactor)}</dd>
                <small>payoff {s.payoff === null ? "—" : num(s.payoff)} (avg win ÷ avg loss)</small>
              </div>
              <div className={tone(s.expectancy)} data-tip="The average result per trade after charges: what one more trade like these has been worth.">
                <dt>Expectancy</dt>
                <dd>{sMoney(s.expectancy)}</dd>
                <small>
                  avg win {sMoney(s.avgWin)} · avg loss {sMoney(s.avgLoss)}
                </small>
              </div>
              <div className="is-down" data-tip="The largest fall of the equity curve from a high, in this period.">
                <dt>Max drawdown</dt>
                <dd>{sMoney(-s.maxDrawdown)}</dd>
                <small>
                  largest loss {sMoney(s.largestLoss)} · best {sMoney(s.largestWin)}
                </small>
              </div>
              <div data-tip="Days with a net gain out of days traded, and the longest runs of wins and losses.">
                <dt>Green days</dt>
                <dd>
                  {s.greenDays} / {s.tradingDays}
                </dd>
                <small>
                  streaks +{s.bestStreak} / −{s.worstStreak} · hold {hold(s.avgHoldMin)}
                </small>
              </div>
              {a && (
                <>
                  <div data-tip="The best and the worst day of the period, after charges.">
                    <dt>Best / worst day</dt>
                    <dd>
                      <span className="is-up">{a.summary.bestDay ? sMoney(a.summary.bestDay.net) : "—"}</span>
                    </dd>
                    <small>
                      {a.summary.bestDay ? dayLabel(a.summary.bestDay.day) : ""}
                      {a.summary.worstDay ? ` · worst ${sMoney(a.summary.worstDay.net)} on ${dayLabel(a.summary.worstDay.day)}` : ""}
                    </small>
                  </div>
                  <div className={a.summary.chargesPct !== null && a.summary.chargesPct > 30 ? "is-down" : ""} data-tip="Brokerage and taxes as a share of the gross profit: how much of what you made the costs took.">
                    <dt>Charges &amp; taxes vs realised P&amp;L</dt>
                    <dd>{a.summary.chargesPct === null ? "—" : `${num(a.summary.chargesPct, 1)}%`}</dd>
                    <small>
                      brokerage {sMoney(-a.summary.brokerage)} · taxes {sMoney(-a.summary.taxes)}
                    </small>
                  </div>
                  {(a.bestMonth || a.worstMonth) && a.months.length > 1 && (
                    <div data-tip="The best and the worst calendar month inside the period.">
                      <dt>Best / worst month</dt>
                      <dd>
                        <span className="is-up">{a.bestMonth ? sMoney(a.bestMonth.net) : "—"}</span>
                      </dd>
                      <small>
                        {a.bestMonth ? monthLabel(a.bestMonth.month) : ""}
                        {a.worstMonth ? ` · worst ${sMoney(a.worstMonth.net)} in ${monthLabel(a.worstMonth.month)}` : ""}
                      </small>
                    </div>
                  )}
                </>
              )}
            </dl>
            <p className="vd-note">Groups with fewer than 8 trades are greyed: too few to trust.</p>
            <div className="jr-bds">
              <Breakdown title="By stock" rows={bySym} tip="Net realised P&L (after charges & taxes) per stock: best first, the worst at the end." />
              <Breakdown title="By hour of entry" rows={s.by.hour} tip="When you enter, and how it has turned out." />
              <Breakdown title="By weekday" rows={s.by.weekday} tip="Day of the week of the entry." />
              <Breakdown title="Long or short" rows={s.by.side} />
              <Breakdown title="Intraday or delivery" rows={s.by.kind} />
              <Breakdown title="By setup" rows={s.by.setup} tip="The setup tag you put on trades." />
              <Breakdown title="Cost of mistakes" rows={s.by.mistake} tip="Net of the trades carrying each mistake tag, worst first." />
            </div>
          </details>
        </>
      )}
      {tab === "performance" && s && s.trades === 0 && <p className="ta-empty">Nothing to analyse in {label || "this period"}.</p>}

      {tab === "trades" && (
        <>
      {d && d.trips.length > 0 && (
        <section className="an-card jr-tripcard">
          <header className="jp-head">
            <h3 className="jr-h">Round trips ({d.trips.length}{d.trips.length === 500 ? ", newest 500" : ""})</h3>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={tripsCsv} data-tip="Every closed trade of this period with its charges and tags, as a CSV.">
              ⤓ CSV
            </button>
          </header>
          <div className="jr-tools">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a stock…" aria-label="Search a stock" />
            <select value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
              <option value="all">All results</option>
              <option value="win">Winners</option>
              <option value="loss">Losers</option>
              <option value="open">Still open</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <span className="jr-tools__sum">
              {shown.length} of {d.trips.length} trades · net realised P&amp;L <b className={tone(shownNet)}>{sMoney(shownNet)}</b>
            </span>
          </div>
          <div className="bt__scroll tr">
            <table className="an-table tr-table jr-trips">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Instrument</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="is-num">
                    Qty.
                  </th>
                  <th scope="col" className="is-num">
                    Entry → exit
                  </th>
                  <th scope="col" className="is-num">
                    Hold
                  </th>
                  <th scope="col" className="is-num" data-tip="Realised P&L minus the estimated charges & taxes.">
                    Net realised P&amp;L
                  </th>
                  <th scope="col" className="is-num" data-tip="MAE: how far the trade went against you. MFE: how far it went your way. Captured: the share of that best move you kept.">
                    MAE / MFE
                  </th>
                  <th scope="col">Tags</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <React.Fragment key={t.key}>
                    <tr className={t.open ? "is-closed" : ""}>
                      <td>
                        {day(t.open ? t.entryAt : t.exitAt)} <small>{time(t.open ? t.entryAt : t.exitAt)}</small>
                      </td>
                      <th scope="row">
                        {t.symbol} <small>{t.intraday ? "intraday" : t.open ? "open" : "delivery"}</small>
                        {t.sources && t.sources.includes("console") && !t.sources.includes("kite") && (
                          <span className="jr-chip" data-tip="From a Zerodha Console tradebook import.">
                            Console
                          </span>
                        )}
                      </th>
                      <td>
                        <span className={`tr-side-tag tr-side-tag--${t.side === "long" ? "buy" : "sell"}`}>{t.side}</span>
                      </td>
                      <td className="is-num">{t.maxQty}</td>
                      <td className="is-num">
                        {num(t.entryAvg)} → {t.exitAvg === null ? "—" : num(t.exitAvg)}
                      </td>
                      <td className="is-num">{hold(t.holdMin)}</td>
                      <td className={`is-num ${tone(t.net)}`} title={`realised P&L ${sMoney(t.pnl)} · charges & taxes ${sMoney(-t.charges)}`}>
                        {t.open ? "open" : sMoney(t.net)}
                      </td>
                      <td className="is-num">
                        {t.exc && !t.exc.none ? (
                          <>
                            <span className="is-down">{sMoney(t.exc.mae)}</span> / <span className="is-up">{sMoney(t.exc.mfe)}</span>
                            {isNum(t.exc.captured) && <small> {num(t.exc.captured, 0)}%</small>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {t.tags && t.tags.setup && <span className="jr-chip">{t.tags.setup}</span>}
                        {t.tags && t.tags.mistakes.map((m) => <span key={m} className="jr-chip jr-chip--bad">{m}</span>)}
                        {t.tags && t.tags.rating ? <small> {"★".repeat(t.tags.rating)}</small> : null}
                        {!t.open && (
                          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEditing(editing === t.key ? "" : t.key)} data-tip="Tag the setup, any mistakes, a note and how well you executed. The breakdowns and the AI review use them. (Tags never change a figure.)">
                            {editing === t.key ? "Close" : "Tag"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {editing === t.key && (
                      <tr>
                        <td colSpan={9}>
                          <TagEditor
                            trip={t}
                            setups={d.setups}
                            mistakes={d.mistakes}
                            onClose={() => setEditing("")}
                            onSaved={() => {
                              setEditing("");
                              load();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 0 && (
            <div className="jr-pager">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                ← Newer
              </button>
              <span>
                Page {page + 1} of {pages}
              </span>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
                Older →
              </button>
              <label>
                Rows{" "}
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">
                  {[25, 50, 100, 250].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <p className="vd-note">Charges &amp; taxes are estimated from Zerodha’s published equity rates (brokerage, STT, exchange and SEBI fees, GST, stamp duty, DP charge); your contract note is the truth. F&amp;O charges are not estimated.</p>
        </section>
      )}

        </>
      )}

      {tab === "calendar" && (
        <>
          {grid}
          {s && s.trades > 0 && (
            <>
          {monthRows && <MonthTable months={monthRows} label={fileTag} />}
          <DayTable days={dayRows} label={fileTag} />
            </>
          )}
      {per && <PeriodTable per={per} sel={sel.period} onPick={pick} />}
      {per && (
        <div className="jp-two">
          <FyChart per={per} onPick={pick} />
          <MonthHeatmap per={per} onMonth={pickMonth} />
        </div>
      )}

        </>
      )}

      {tab === "reports" && (
        <>
          <section className="an-card">
            <header className="jp-head">
              <h3 className="jr-h">Reports and downloads</h3>
            </header>
            <p className="jc-info">Print a clean report of {label || "the period"} (Save as PDF from the print window), or download the data for your own analysis.</p>
            <div className="jr-exports">
              <button type="button" className="adm-btn adm-btn--sm" onClick={() => window.print()} disabled={!s || !s.trades}>
                🖨 Print / save as PDF
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={tripsCsv} disabled={!d || !d.trips.length}>
                ⤓ Trades CSV
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => downloadJson(`journal-${fileTag}.json`, { period: period || null, filters: { kind, side, setup }, summary: s, returns: rt, capital, trades: d ? d.trips : [] })} disabled={!s}>
                ⤓ Everything as JSON
              </button>
            </div>
          </section>
          {s && s.trades > 0 && <PrintReport label={label} period={period} s={s} rt={rt} a={a} trips={d.trips.filter((t) => !t.open)} filters={filterText} />}
      {per && (
        <Sources
          per={per}
          ignoredManual={d ? d.ignoredManual || 0 : 0}
          onChanged={() => {
            load();
            loadPer();
          }}
        />
      )}


      <ReviewPanel sel={sel} label={label} />

        </>
      )}
    </div>
  );
}
