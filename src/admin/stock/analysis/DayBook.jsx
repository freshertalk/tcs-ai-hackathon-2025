// The Journal's Day book: every trading day read back — profit, loss, charges and taxes, trades,
// margin — with what went well and what did not, and the analytics over many days.
//
// Every day is saved by itself: at 3:45 PM IST, and any day the server missed (it was down, or the
// trades came later from a Console tradebook) on the next hourly sweep (server/analysis). Nothing is
// saved or typed by hand: the figures come only from Zerodha's fills; your notes, rating, lessons
// and mood are yours to write. Nothing on this page can place an order.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useTopics } from "../../live";
import { Alert, Loading } from "../../ui";
import { useDialog } from "../../dialog/DialogProvider";
import { DateField, DateRangeField } from "../../DatePicker";
import { Calendar, DailyBars, Donut, HBars, LineChart, Spark, Waterfall, dayLabel, dayLong, rs, rsSigned, tone } from "./charts";
import "./analysis.css";

const IST = 5.5 * 3600 * 1000;
const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const RANGES = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "1 year", days: 365 },
  { id: "all", label: "All", days: null },
  { id: "custom", label: "Custom", days: null },
];
const KEY = "vpt.analysis.range";
const LABEL = { brokerage: "Brokerage", stt: "STT / CTT", exchange: "Exchange transaction charges", sebi: "SEBI turnover fee", gst: "GST", stamp: "Stamp duty", dp: "DP charges" };
const pct1 = (x) => (typeof x === "number" ? `${x.toFixed(1)}%` : "—");
const num = (x, d = 0) => (typeof x === "number" ? x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");

/** The change since the period before, in words and a colour. */
function delta(cur, prev, { good = "up", money = true } = {}) {
  if (typeof cur !== "number" || typeof prev !== "number") return null;
  const d = cur - prev;
  if (d === 0) return { text: "same as before", cls: "" };
  const p = prev !== 0 ? Math.round((d / Math.abs(prev)) * 100) : null;
  const better = good === "up" ? d > 0 : d < 0;
  return { text: `${d > 0 ? "▲" : "▼"} ${money ? rs(Math.abs(d)) : num(Math.abs(d), 1)}${p !== null ? ` (${Math.abs(p)}%)` : ""} vs before`, cls: better ? "is-up" : "is-down" };
}

function Kpi({ label, value, cls = "", sub, change, spark, c = "a", tip }) {
  return (
    <div className="ta-kpi" data-tip={tip}>
      <span className="ta-kpi__l">{label}</span>
      <b className={`ta-kpi__v ${cls}`}>{value}</b>
      {sub && <small className="ta-kpi__s">{sub}</small>}
      {change && <small className={`ta-kpi__d ${change.cls}`}>{change.text}</small>}
      {spark && <Spark values={spark} c={c} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ dashboard */

function Dashboard({ an, days, onOpen, settings }) {
  const [metric, setMetric] = useState("net");
  const d = an.data;
  if (!d) return <Loading label="Working out the analytics…" />;
  const t = d.totals;
  const p = d.previous;
  if (!t.days) {
    return (
      <section className="ta-card ta-first">
        <h3>No days saved in this period yet</h3>
        <p>
          Your first report is saved by itself at <b>3:45 PM IST</b> on the next trading day{settings && !settings.auto ? " (automatic saving is switched OFF — turn it on above)" : ""}. To start now, press <b>Save today now</b>, or open any past day below
          and save it: the journal holds the trades it has seen, and a tradebook CSV from Zerodha Console (imported on the Journal page) brings in the history.
        </p>
      </section>
    );
  }
  const s = d.series;
  const xs = s.map((r) => r.date);
  const curve = metric === "gross" ? [{ label: "Realised P&L (before charges & taxes)", values: s.map((r) => r.cumGross), c: "b", area: false }] : metric === "both" ? [{ label: "Net realised P&L (after charges & taxes)", values: s.map((r) => r.cumNet), c: "a", area: true }, { label: "Realised P&L (before charges & taxes)", values: s.map((r) => r.cumGross), c: "b", dashed: true }] : [{ label: "Net realised P&L (after charges & taxes)", values: s.map((r) => r.cumNet), c: "a", area: true }];
  const c = t.charges;
  const donut = [
    { label: "Government taxes & statutory (STT, GST, stamp duty, SEBI)", value: c.statutory, c: "warn" },
    { label: "Exchange transaction charges", value: c.exchange, c: "b" },
    { label: "Brokerage & DP charges", value: c.brokerAndOther, c: "a" },
  ].filter((x) => x.value > 0);
  return (
    <>
      <div className="ta-kpis">
        <Kpi label="Net realised P&L" value={rsSigned(t.net)} cls={tone(t.net)} sub={`${t.days} trading day${t.days === 1 ? "" : "s"}`} change={p ? delta(t.net, p.net) : null} spark={s.map((r) => r.cumNet)} tip="Total profit − total loss − charges and taxes, for the days shown." />
        <Kpi label="Total profit" value={rs(t.grossProfit)} cls="is-up" sub={`${t.wins} winning trades`} change={p ? delta(t.grossProfit, p.grossProfit) : null} spark={s.map((r) => r.grossProfit)} c="up" tip="The sum of every trade that closed above zero, before charges." />
        <Kpi label="Total loss" value={rs(-t.grossLoss)} cls="is-down" sub={`${t.losses} losing trades`} change={p ? delta(t.grossLoss, p.grossLoss, { good: "down" }) : null} spark={s.map((r) => -r.grossLoss)} c="down" tip="The sum of every trade that closed below zero, before charges." />
        <Kpi label="Charges & taxes" value={rs(-c.total)} cls="is-warn" sub={t.chargesPctOfGross !== null ? `${pct1(t.chargesPctOfGross)} of gross profit` : `${rs(c.statutory)} government taxes`} change={p ? delta(c.total, p.charges.total, { good: "down" }) : null} spark={s.map((r) => -r.charges)} c="warn" tip="Brokerage, STT, exchange fees, SEBI fee, GST, stamp duty and DP charges. An estimate from Zerodha's published rates; the contract note is the truth." />
        <Kpi label="Win rate" value={pct1(t.winRatePct)} sub={`${t.wins} of ${t.trades} trades`} change={p && p.winRatePct !== null ? delta(t.winRatePct, p.winRatePct, { money: false }) : null} spark={s.map((r) => r.rollingWinPct)} tip="Trades that closed above zero, before charges. The line is the rolling 10-day rate." />
        <Kpi label="Trades" value={num(t.trades)} sub={`${t.avgTradesPerDay} a day`} change={p ? delta(t.trades, p.trades, { good: "none", money: false }) : null} spark={s.map((r) => r.trades)} />
        <Kpi label="Profitable days" value={pct1(t.greenDaysPct)} sub={`${t.greenDays} green · ${t.redDays} red`} spark={s.map((r) => (r.net > 0 ? 1 : 0))} />
        <Kpi label="Profit factor" value={t.profitFactor === null ? "—" : num(t.profitFactor, 2)} sub={t.payoff !== null ? `average win ${num(t.payoff, 2)}× average loss` : "needs a loss"} tip="Total profit ÷ total loss. Above 1 means the profits outweighed the losses before charges." />
        <Kpi label="Average per day" value={rsSigned(t.avgNetPerDay)} cls={tone(t.avgNetPerDay)} sub={`${rsSigned(t.expectancyPerTrade)} per trade`} />
        <Kpi label="Best day" value={rsSigned(t.bestDay.net)} cls={tone(t.bestDay.net)} sub={dayLabel(t.bestDay.date)} />
        <Kpi label="Worst day" value={rsSigned(t.worstDay.net)} cls={tone(t.worstDay.net)} sub={dayLabel(t.worstDay.date)} />
        <Kpi label="Deepest fall" value={rs(-t.maxDrawdown)} cls={t.maxDrawdown ? "is-down" : ""} sub={`${t.worstStreak}-day worst losing streak`} tip="The largest fall of the running net total from an earlier high." />
        <Kpi label="Process score" value={t.avgScore === null ? "—" : `${t.avgScore}/100`} sub="how the days were traded, not what they made" tip="From the good and bad practices found each day. A reminder about habits, not a grade of the result." />
      </div>

      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Cumulative profit & loss</h3>
          <div className="ta-seg" role="group" aria-label="Which curve">
            {[["net", "Net realised P&L"], ["gross", "Realised P&L"], ["both", "Both"]].map(([id, l]) => (
              <button key={id} type="button" aria-pressed={metric === id} onClick={() => setMetric(id)}>
                {l}
              </button>
            ))}
          </div>
        </header>
        <Legend items={curve.map((x) => ({ label: x.label, c: x.c }))} />
        <LineChart xs={xs} series={curve} label="Cumulative profit and loss by day" height={250} />
      </section>

      <div className="ta-two">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Daily profit and loss</h3>
          </header>
          <Legend items={[{ label: "Profit", c: "up" }, { label: "Loss", c: "down" }, { label: "Net", c: "a" }]} />
          <DailyBars days={s} height={230} />
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Where the money went</h3>
          </header>
          <Waterfall profit={t.grossProfit} loss={t.grossLoss} charges={c.total} net={t.net} />
          <div className="ta-split">
            <Donut parts={donut} size={132} center={[rs(c.total), "charges & taxes"]} />
            <ul className="ta-ch">
              {d.charges.map((x) => (
                <li key={x.key}>
                  <span>{LABEL[x.key]}</span>
                  <b>{rs(x.amount, 2)}</b>
                  <small>{x.pct}%</small>
                </li>
              ))}
              <li className="is-sum">
                <span>Government taxes & statutory</span>
                <b>{rs(c.statutory, 2)}</b>
                <small>{c.total ? Math.round((c.statutory / c.total) * 100) : 0}%</small>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <div className="ta-three">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>By weekday</h3>
          </header>
          <HBars rows={d.weekday.map((w) => ({ label: w.key, value: w.net, sub: `${w.days} day${w.days === 1 ? "" : "s"} · ${w.greenDaysPct}% green` }))} />
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>By hour of entry</h3>
          </header>
          <HBars rows={d.hours.map((h) => ({ label: h.key, value: h.net, sub: `${h.trades} trades · ${h.winRatePct}% won` }))} />
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Win rate and process</h3>
          </header>
          <Legend items={[{ label: "Rolling 10-day win rate %", c: "up" }, { label: "Process score", c: "a" }]} />
          <LineChart xs={xs} height={170} zero={false} fmt={(v) => `${v}`} valueFmt={(v) => `${Math.round(v)}`} label="Rolling win rate and process score" series={[{ label: "Win rate %", values: s.map((r) => r.rollingWinPct), c: "up" }, { label: "Process score", values: s.map((r) => r.score), c: "a" }]} />
        </section>
      </div>

      <div className="ta-two">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Every day at a glance</h3>
          </header>
          <Calendar days={days.filter((x) => x.date >= (d.range.from || "") && x.date <= (d.range.to || "9999"))} onPick={onOpen} />
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Drawdown</h3>
          </header>
          <LineChart xs={xs} height={170} label="Fall from the running peak" series={[{ label: "Below the peak", values: s.map((r) => -r.drawdown), c: "down", area: true }]} />
        </section>
      </div>

      <div className="ta-two">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Stocks that made money</h3>
          </header>
          <HBars rows={d.symbols.best.map((x) => ({ label: x.symbol, value: x.net, sub: `${x.trades} trades · ${x.winRatePct}% won` }))} empty="No stock finished in profit." />
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Stocks that cost money</h3>
          </header>
          <HBars rows={d.symbols.worst.map((x) => ({ label: x.symbol, value: x.net, sub: `${x.trades} trades · ${x.winRatePct}% won` }))} empty="No stock finished in loss." />
        </section>
      </div>

      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Habits across the days</h3>
          <small>How often each practice showed up, and what those days netted against the others</small>
        </header>
        <div className="ta-habits">
          <PracticeTable title="Bad practices — to fix" kind="bad" rows={d.practices.bad} total={t.days} />
          <PracticeTable title="Good practices — to keep" kind="good" rows={d.practices.good} total={t.days} />
        </div>
      </section>
    </>
  );
}

function Legend({ items }) {
  return (
    <ul className="ta-legend">
      {items.map((i) => (
        <li key={i.label}>
          <i className={`ta-sw ta-sw--${i.c}`} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function PracticeTable({ title, kind, rows, total }) {
  return (
    <div className="ta-scroll">
      <table className="an-table ta-table">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Practice</th>
            <th scope="col" className="is-num">Days</th>
            <th scope="col" className="is-num">Avg net on those days</th>
            <th scope="col" className="is-num">Avg net on the others</th>
            {kind === "bad" && <th scope="col" className="is-num">Cost</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={kind === "bad" ? 5 : 4} className="ta-dim">
                {kind === "bad" ? "None found." : "None yet."}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <span className={kind === "bad" ? "ta-x" : "ta-ok"} aria-hidden="true">
                  {kind === "bad" ? "✗" : "✓"}
                </span>{" "}
                {r.title}
              </th>
              <td className="is-num">
                {r.days} <small>of {total} ({r.pctDays}%)</small>
              </td>
              <td className={`is-num ${tone(r.avgOnThoseDays)}`}>{rsSigned(r.avgOnThoseDays)}</td>
              <td className={`is-num ${tone(r.avgOnOtherDays)}`}>{rsSigned(r.avgOnOtherDays)}</td>
              {kind === "bad" && <td className={`is-num ${tone(r.impact)}`}>{r.impact ? rsSigned(r.impact) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------------------- daily reports */

const COLS = [
  { id: "date", label: "Date" },
  { id: "trades", label: "Trades", num: true, get: (d) => d.summary.trades },
  { id: "win", label: "Win %", num: true, get: (d) => d.summary.winRatePct },
  { id: "profit", label: "Profit", num: true, get: (d) => d.summary.grossProfit },
  { id: "loss", label: "Loss", num: true, get: (d) => d.summary.grossLoss },
  { id: "charges", label: "Charges & taxes", num: true, get: (d) => d.summary.charges.total },
  { id: "net", label: "Net realised P&L", num: true, get: (d) => d.summary.net },
  { id: "netpct", label: "Net % of margin", num: true, get: (d) => d.summary.netPctOfMargin },
  { id: "margin", label: "Margin left", num: true, get: (d) => (d.margin ? d.margin.available : null) },
  { id: "score", label: "Process", num: true, get: (d) => d.score },
];

function DaysTable({ days, onOpen }) {
  const [sort, setSort] = useState(["date", -1]);
  const rows = useMemo(() => {
    const col = COLS.find((c) => c.id === sort[0]);
    return [...days].sort((a, b) => {
      const x = col.get ? col.get(a) : a.date;
      const y = col.get ? col.get(b) : b.date;
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * sort[1];
    });
  }, [days, sort]);
  const tot = useMemo(() => {
    const t = { trades: 0, wins: 0, profit: 0, loss: 0, charges: 0, net: 0 };
    for (const d of days) {
      t.trades += d.summary.trades;
      t.wins += d.summary.wins;
      t.profit += d.summary.grossProfit;
      t.loss += d.summary.grossLoss;
      t.charges += d.summary.charges.total;
      t.net += d.summary.net;
    }
    return t;
  }, [days]);
  if (!days.length) return <p className="ta-empty">No reports saved in this period.</p>;
  return (
    <div className="ta-scroll">
      <table className="an-table ta-table ta-days">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.id} scope="col" className={c.num ? "is-num" : ""} aria-sort={sort[0] === c.id ? (sort[1] > 0 ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => setSort([c.id, sort[0] === c.id ? -sort[1] : c.id === "date" ? -1 : -1])}>
                  {c.label}
                  {sort[0] === c.id ? (sort[1] > 0 ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
            <th scope="col">Practices</th>
            <th scope="col">Report</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date} onClick={() => onOpen(d.date)} className="is-link">
              <th scope="row">
                {dayLong(d.date)}
              </th>
              <td className="is-num">{d.summary.trades}</td>
              <td className="is-num">{pct1(d.summary.winRatePct)}</td>
              <td className="is-num is-up">{rs(d.summary.grossProfit)}</td>
              <td className="is-num is-down">{rs(-d.summary.grossLoss)}</td>
              <td className="is-num is-warn">{rs(-d.summary.charges.total)}</td>
              <td className={`is-num ta-netv ${tone(d.summary.net)}`}>{rsSigned(d.summary.net)}</td>
              <td className={`is-num ${tone(d.summary.netPctOfMargin)}`}>{d.summary.netPctOfMargin === null ? "—" : `${d.summary.netPctOfMargin > 0 ? "+" : ""}${d.summary.netPctOfMargin}%`}</td>
              <td className="is-num">{d.margin && d.margin.available !== null ? rs(d.margin.available) : "—"}</td>
              <td className="is-num">{d.score === null ? "—" : d.score}</td>
              <td>
                <span className="ta-ok" data-tip="Good practices found">✓ {d.good}</span> <span className="ta-x" data-tip="Bad practices found">✗ {d.bad}</span>
              </td>
              <td>
                <span className="ta-badge" data-tip={d.source === "auto" ? "Saved by itself at 3:45 PM" : "Built from the journal when you pressed Save"}>{d.source === "auto" ? "Auto 3:45" : "On request"}</span>
                {d.hasAi && <span className="ta-badge is-ai">AI</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total · {days.length} day{days.length === 1 ? "" : "s"}</th>
            <td className="is-num">{tot.trades}</td>
            <td className="is-num">{tot.trades ? pct1((tot.wins / tot.trades) * 100) : "—"}</td>
            <td className="is-num is-up">{rs(tot.profit)}</td>
            <td className="is-num is-down">{rs(-tot.loss)}</td>
            <td className="is-num is-warn">{rs(-tot.charges)}</td>
            <td className={`is-num ta-netv ${tone(tot.net)}`}>{rsSigned(tot.net)}</td>
            <td colSpan="5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------------------------------- a day */

function NotesEditor({ d, onSaved }) {
  const n = d.notes || { text: "", rating: null, lessons: [], mood: "" };
  const [text, setText] = useState(n.text || "");
  const [rating, setRating] = useState(n.rating);
  const [mood, setMood] = useState(n.mood || "");
  const [lessons, setLessons] = useState(n.lessons && n.lessons.length ? n.lessons : [""]);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      onSaved(await api(`/api/admin/analysis/day/${d.date}`, { method: "PUT", body: { notes: { text, rating, mood, lessons: lessons.filter((x) => x.trim()) } } }), "Notes saved.");
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy(false);
  };
  return (
    <section className="ta-card">
      <header className="ta-card__h">
        <h3>Your notes</h3>
        <small>Saved with the day</small>
      </header>
      <label className="ta-field">
        <span>What happened, in your words</span>
        <textarea rows="3" value={text} maxLength="4000" onChange={(e) => setText(e.target.value)} placeholder="What you saw, what you felt, what you would do differently." />
      </label>
      <div className="ta-row">
        <div className="ta-field">
          <span>How well did you stick to your rules?</span>
          <div className="ta-stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" role="radio" aria-checked={rating === i} className={rating >= i ? "is-on" : ""} onClick={() => setRating(rating === i ? null : i)} aria-label={`${i} of 5`}>
                ★
              </button>
            ))}
          </div>
        </div>
        <label className="ta-field">
          <span>Mood</span>
          <select value={mood} onChange={(e) => setMood(e.target.value)}>
            {["", "calm", "confident", "anxious", "impatient", "tired", "angry", "greedy"].map((m) => (
              <option key={m} value={m}>
                {m || "—"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ta-field">
        <span>Lessons to remember</span>
        {lessons.map((l, i) => (
          <div key={i} className="ta-lesson">
            <input value={l} maxLength="300" onChange={(e) => setLessons(lessons.map((x, k) => (k === i ? e.target.value : x)))} placeholder="One sentence you want to read again" />
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setLessons(lessons.length > 1 ? lessons.filter((_, k) => k !== i) : [""])} aria-label="Remove this lesson">
              ×
            </button>
          </div>
        ))}
        {lessons.length < 8 && (
          <button type="button" className="ta-link" onClick={() => setLessons([...lessons, ""])}>
            + Add a lesson
          </button>
        )}
      </div>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      <div className="ta-actions">
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save notes"}
        </button>
      </div>
    </section>
  );
}

function DayView({ date, onBack, onChanged }) {
  const ask = useDialog();
  const [st, setSt] = useState({ loading: true, d: null, error: "", missing: false });
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");
  const load = useCallback(
    (quiet = false) => {
      if (quiet !== true) setSt((s) => ({ ...s, loading: true }));
      return api(`/api/admin/analysis/day/${date}`)
        .then((d) => setSt({ loading: false, d, error: "", missing: false }))
        .catch((e) => setSt((s) => (quiet === true ? { ...s, loading: false } : { loading: false, d: null, error: e.message, missing: /No report is saved/.test(e.message) })));
    },
    [date]
  );
  useEffect(() => {
    load();
  }, [load]);
  useTopics(["analysis", "trading"], () => load(true));
  const act = async (what, fn, ok) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await fn();
      if (d && d.summary) setSt({ loading: false, d, error: "", missing: false });
      if (ok) setMsg({ kind: "ok", text: ok });
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };
  const saved = (d, ok) => {
    setSt({ loading: false, d, error: "", missing: false });
    setMsg({ kind: "ok", text: ok });
    onChanged();
  };
  const del = async () => {
    const yes = await ask({ tone: "danger", title: "Delete this day's report?", body: <><p>The saved report for <b>{dayLong(date)}</b>, with your notes and any figures you entered, will be removed from the analytics.</p><p>The trades themselves stay in the journal; you can save the day again at any time.</p></>, confirmText: "Delete the report", cancelText: "Keep it" });
    if (!yes) return;
    await act("del", () => api(`/api/admin/analysis/day/${date}`, { method: "DELETE" }).then(() => { onBack(); return null; }));
  };
  const d = st.d;
  return (
    <div className="ta-day">
      <header className="ta-dayhead">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onBack}>
          ← All days
        </button>
        <h3>{dayLong(date)}</h3>
        {d && (
          <span className="ta-badges">
            <span className="ta-badge">{d.source === "auto" ? "Saved by itself" : "Saved from the journal"}</span>
            {d.ai && <span className="ta-badge is-ai">AI analysis</span>}
          </span>
        )}
        <span className="ta-grow" />
        {d && (
          <>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => act("ai", () => api(`/api/admin/analysis/day/${date}/ai`, { method: "POST" }), "AI analysis written.")}>
              {busy === "ai" ? "Writing…" : d.ai ? "Rewrite the AI analysis" : "Write the AI analysis"}
            </button>
            <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" disabled={Boolean(busy)} onClick={del}>
              Delete
            </button>
          </>
        )}
      </header>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      {st.loading && !d && <Loading label="Opening the day…" />}
      {st.error && !st.missing && <Alert>{st.error}</Alert>}
      {st.missing && (
        <>
        <section className="ta-card ta-first">
          <h3>No report for this day yet</h3>
          <p>
            Days are saved by themselves — at 3:45 PM, and within the hour for any day with closed trades in the journal. If the journal has no trades for that day, it was before the server read your account each day: import that financial year’s tradebook from Zerodha Console (“Where the history comes from”, above) and the day is saved by itself within the hour. Notes can be added once it is saved.
          </p>
        </section>
        </>
      )}
      {d && <DayBody d={d} onSaved={saved} />}
    </div>
  );
}

function DayBody({ d, onSaved }) {
  const s = d.summary;
  const c = s.charges;
  const ai = d.ai;
  return (
    <>
      <div className="ta-kpis ta-kpis--day">
        <Kpi label="Net realised P&L" value={rsSigned(s.net)} cls={tone(s.net)} sub={s.netPctOfMargin !== null ? `${s.netPctOfMargin > 0 ? "+" : ""}${s.netPctOfMargin}% of opening margin` : null} />
        <Kpi label="Total profit" value={rs(s.grossProfit)} cls="is-up" sub={`${s.wins} winning trade${s.wins === 1 ? "" : "s"}`} />
        <Kpi label="Total loss" value={rs(-s.grossLoss)} cls="is-down" sub={`${s.losses} losing trade${s.losses === 1 ? "" : "s"}`} />
        <Kpi label="Charges & taxes" value={rs(-c.total)} cls="is-warn" sub={s.chargesPctOfGross !== null ? `${pct1(s.chargesPctOfGross)} of gross profit` : "estimate"} />
        <Kpi label="Trades" value={s.trades} sub={`${pct1(s.winRatePct)} won · ${s.long} long · ${s.short} short`} />
        <Kpi label="Margin left" value={d.margin && d.margin.available !== null ? rs(d.margin.available) : "—"} sub={d.margin && d.margin.opening ? `of ${rs(d.margin.opening)} at the open${d.margin.used ? ` · ${rs(d.margin.used)} used` : ""}` : "not read"} />
        <Kpi label="Profit factor" value={s.profitFactor === null ? "—" : num(s.profitFactor, 2)} sub={s.payoff !== null ? `win ${rs(s.avgWin)} · loss ${rs(s.avgLoss)}` : null} />
        <Kpi label="Process score" value={d.score === null ? "—" : `${d.score}/100`} sub={`✓ ${d.practices.good.length} · ✗ ${d.practices.bad.length}`} />
      </div>

      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Why {s.net >= 0 ? "profit" : "loss"} today</h3>
          {ai && <small>AI analysis · {ai.model} · {new Date(ai.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>}
        </header>
        {ai ? (
          <>
            <p className="ta-ai__h">{ai.headline}</p>
            <p>{ai.why}</p>
            <div className="ta-two ta-two--tight">
              {ai.worked.length > 0 && (
                <div>
                  <h4>What worked</h4>
                  <ul className="ta-list ta-list--ok">
                    {ai.worked.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ai.hurt.length > 0 && (
                <div>
                  <h4>What hurt</h4>
                  <ul className="ta-list ta-list--bad">
                    {ai.hurt.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {ai.advice.length > 0 && (
              <>
                <h4>Advice for tomorrow</h4>
                <ol className="ta-list">
                  {ai.advice.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ol>
              </>
            )}
            {ai.tomorrow.length > 0 && (
              <p className="ta-dim">
                <b>Before the first trade:</b> {ai.tomorrow.join(" · ")}
              </p>
            )}
            <p className="ta-dim">{ai.caveat}</p>
          </>
        ) : (
          <>
            <ul className="ta-list">
              {d.why.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="ta-dim">{d.aiError || "This is the desk's own arithmetic. Press “Write the AI analysis” above for a fuller reading by the AI model you chose."}</p>
          </>
        )}
      </section>

      <div className="ta-two">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Good practices</h3>
            <small>to remember</small>
          </header>
          <div className="ta-scroll">
            <table className="an-table ta-table">
              <thead>
                <tr>
                  <th scope="col">Practice</th>
                  <th scope="col">What the numbers show</th>
                </tr>
              </thead>
              <tbody>
                {d.practices.good.length === 0 && (
                  <tr>
                    <td colSpan="2" className="ta-dim">
                      None stood out today.
                    </td>
                  </tr>
                )}
                {d.practices.good.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <span className="ta-ok" aria-hidden="true">✓</span> {p.title}
                    </th>
                    <td className="ta-detail">{p.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Bad practices</h3>
            <small>to fix</small>
          </header>
          <div className="ta-scroll">
            <table className="an-table ta-table">
              <thead>
                <tr>
                  <th scope="col">Practice</th>
                  <th scope="col">What the numbers show</th>
                  <th scope="col" className="is-num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {d.practices.bad.length === 0 && (
                  <tr>
                    <td colSpan="3" className="ta-dim">
                      None found today.
                    </td>
                  </tr>
                )}
                {d.practices.bad.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <span className="ta-x" aria-hidden="true">✗</span> {p.title}
                    </th>
                    <td className="ta-detail">
                      {p.detail}
                      <small className="ta-do"> Do instead: {p.advice}</small>
                    </td>
                    <td className={`is-num ${tone(p.impact)}`}>{p.impact ? rsSigned(p.impact) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {d.advice.length > 0 && (
        <section className="ta-card ta-wide">
          <header className="ta-card__h">
            <h3>Advice from the data</h3>
            <small>from today’s winning and losing trades</small>
          </header>
          <ol className="ta-list">
            {d.advice.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </section>
      )}

      <div className="ta-two">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Where the money went</h3>
          </header>
          <Waterfall profit={s.grossProfit} loss={s.grossLoss} charges={c.total} net={s.net} />
          <ul className="ta-ch ta-ch--table">
            {["brokerage", "stt", "exchange", "sebi", "gst", "stamp", "dp"].map((k) => (
              <li key={k}>
                <span>{LABEL[k]}</span>
                <b>{rs(c[k], 2)}</b>
                <small>{c.total ? Math.round((c[k] / c.total) * 100) : 0}%</small>
              </li>
            ))}
            <li className="is-sum">
              <span>Government taxes & statutory (STT + GST + stamp + SEBI)</span>
              <b>{rs(c.statutory, 2)}</b>
              <small>{c.total ? Math.round((c.statutory / c.total) * 100) : 0}%</small>
            </li>
            <li className="is-sum">
              <span>Total charges & taxes</span>
              <b>{rs(c.total, 2)}</b>
              <small>estimate</small>
            </li>
          </ul>
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>By hour of entry</h3>
          </header>
          <HBars rows={d.hours.map((h) => ({ label: `${h.hour}:00`, value: h.net, sub: `${h.trades} trade${h.trades === 1 ? "" : "s"} · ${h.wins} won` }))} />
          <header className="ta-card__h ta-gap">
            <h3>By stock</h3>
          </header>
          <HBars rows={d.symbols.map((x) => ({ label: x.symbol, value: x.net, sub: `${x.trades} trade${x.trades === 1 ? "" : "s"} · ${x.wins} won` }))} />
        </section>
      </div>

      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Every trade</h3>
          <small>{d.trades.length} round trips closed this day{d.market ? ` · Nifty ${d.market.niftyChangePct >= 0 ? "+" : ""}${d.market.niftyChangePct}%` : ""}</small>
        </header>
        {d.trades.length === 0 ? (
          <p className="ta-dim">The journal holds no closed trades for this day. If you traded it, import that period’s Console tradebook on the Journal, then press Refresh from the journal.</p>
        ) : (
          <div className="ta-scroll">
            <table className="an-table ta-table">
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="is-num">Qty</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col" className="is-num">Held</th>
                  <th scope="col" className="is-num">Entry</th>
                  <th scope="col" className="is-num">Exit</th>
                  <th scope="col" className="is-num">Realised P&amp;L</th>
                  <th scope="col" className="is-num">Charges &amp; taxes</th>
                  <th scope="col" className="is-num">Net realised P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {d.trades.map((t) => (
                  <tr key={t.key}>
                    <th scope="row">{t.symbol}</th>
                    <td className={t.side === "long" ? "is-up" : "is-down"}>{t.side === "long" ? "Long" : "Short"}</td>
                    <td className="is-num">{num(t.qty)}</td>
                    <td>{t.entryAt}</td>
                    <td>{t.exitAt}</td>
                    <td className="is-num">{t.holdMin} min</td>
                    <td className="is-num">{num(t.entryAvg, 2)}</td>
                    <td className="is-num">{num(t.exitAvg, 2)}</td>
                    <td className={`is-num ${tone(t.pnl)}`}>{rsSigned(t.pnl, 2)}</td>
                    <td className="is-num is-warn">{rs(-t.charges, 2)}</td>
                    <td className={`is-num ta-netv ${tone(t.net)}`}>{rsSigned(t.net, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d.readNotes && d.readNotes.length > 0 && <p className="ta-dim">Not read when this report was saved: {d.readNotes.join(" ")}</p>}
      {d.formerOverrides && <p className="ta-dim">Figures typed in by hand for this day in an earlier version are kept on record but no longer used: every figure above comes from Zerodha’s trades in the journal.</p>}
      <NotesEditor key={`${d.date}-${d.editedAt || d.capturedAt}`} d={d} onSaved={onSaved} />
    </>
  );
}

/* -------------------------------------------------------------------------------------- the page */

export default function DayBook() {
  const [list, setList] = useState({ loading: true, days: [], settings: null, error: "" });
  const [range, setRange] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) || "30";
    } catch (_) {
      return "30";
    }
  });
  const [custom, setCustom] = useState({ from: addDays(todayIst(), -29), to: todayIst() });
  const [an, setAn] = useState({ data: null, error: "" });
  const [view, setView] = useState("dashboard");
  const [open, setOpen] = useState(null);
  const [pick, setPick] = useState(todayIst());
  const [msg, setMsg] = useState({ kind: "", text: "" });

  const bounds = useMemo(() => {
    const today = todayIst();
    if (range === "custom") return { from: custom.from || null, to: custom.to || today };
    const r = RANGES.find((x) => x.id === range);
    return r && r.days ? { from: addDays(today, -(r.days - 1)), to: today } : { from: null, to: null };
  }, [range, custom]);

  const loadList = useCallback(
    () =>
      api("/api/admin/analysis/days")
        .then((d) => setList({ loading: false, days: d.days, settings: d.settings, error: "" }))
        .catch((e) => setList((l) => ({ ...l, loading: false, error: e.message }))),
    []
  );
  useEffect(() => {
    loadList();
  }, [loadList]);
  const loadAn = useCallback(() => {
    const q = new URLSearchParams();
    if (bounds.from) q.set("from", bounds.from);
    if (bounds.to) q.set("to", bounds.to);
    return api(`/api/admin/analysis/analytics?${q}`)
      .then((d) => setAn({ data: d, error: "" }))
      .catch((e) => setAn({ data: null, error: e.message }));
  }, [bounds]);
  useEffect(() => {
    loadAn();
  }, [loadAn, list.days.length]);
  // a report saved, a day scored or a trade filled elsewhere: the list and the analytics are read again at once
  useTopics(["analysis", "trading"], () => {
    loadList();
    loadAn();
  });

  const changed = useCallback(() => {
    loadList();
    loadAn();
  }, [loadList, loadAn]);
  const setR = (id) => {
    setRange(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch (_) {
      /* remembered for this visit only */
    }
  };
  const openDay = (d) => {
    setOpen(d);
    setView("day");
    window.scrollTo && window.scrollTo({ top: 0 });
  };
  const setting = async (patch) => {
    try {
      const s = await api("/api/admin/analysis/settings", { method: "PUT", body: patch });
      setList((l) => ({ ...l, settings: s }));
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
  };

  const inRange = useMemo(() => list.days.filter((d) => (!bounds.from || d.date >= bounds.from) && (!bounds.to || d.date <= bounds.to)), [list.days, bounds]);
  const s = list.settings;

  if (list.loading) return <Loading label="Opening the Day book…" />;
  return (
    <div className="ta">
      <section className="ta-card ta-head">
        <div>
          <h2>Day book</h2>
          <p className="ta-dim">
            Every trading day read back: profit, loss, charges and taxes, trades and margin — what went well, what did not, and what to do about it. Saved <b>by itself</b> at 3:45 PM IST, and any day the server missed within the hour — nothing is saved or typed by hand.
          </p>
        </div>
        <div className="ta-ctrl">
          <label className="ta-chk" data-tip={s && s.aiReady ? "Also write the AI analysis with the automatic report (uses the AI model you chose)." : "No AI key is saved: reports use the desk's own arithmetic."}>
            <input type="checkbox" checked={Boolean(s && s.withAi)} disabled={!s || !s.aiReady} onChange={(e) => setting({ withAi: e.target.checked })} /> AI analysis
          </label>
        </div>
      </section>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text || list.error}</Alert>

      <div className="ta-toolbar">
        <div className="ta-tabs" role="tablist" aria-label="Day book">
          {[["dashboard", "Dashboard"], ["days", `Daily reports (${list.days.length})`], ...(open ? [["day", dayLabel(open)]] : [])].map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>
              {l}
            </button>
          ))}
        </div>
        {view !== "day" && (
          <div className="ta-range">
            <div className="ta-seg" role="group" aria-label="Period">
              {RANGES.map((r) => (
                <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setR(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
            {range === "custom" && (
              <span className="ta-dates">
                <DateRangeField value={custom} max={todayIst()} label="Dates" onChange={(r) => setCustom({ from: r.from, to: r.to })} />
              </span>
            )}
          </div>
        )}
        <div className="ta-open">
          <DateField value={pick} max={todayIst()} onChange={setPick} label="Open any day" />
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!pick} onClick={() => openDay(pick)}>
            Open this day
          </button>
        </div>
      </div>

      {view === "dashboard" && <>{an.error ? <Alert>{an.error}</Alert> : <Dashboard an={an} days={list.days} onOpen={openDay} settings={s} />}</>}
      {view === "days" && (
        <section className="ta-card ta-wide">
          <header className="ta-card__h">
            <h3>Daily reports</h3>
            <small>{inRange.length} day{inRange.length === 1 ? "" : "s"} in this period · click a row to open it</small>
          </header>
          <DaysTable days={inRange} onOpen={openDay} />
        </section>
      )}
      {view === "day" && open && <DayView key={open} date={open} onBack={() => setView("days")} onChanged={changed} />}

      <p className="ta-dim ta-foot">
        Charges and taxes are an estimate from Zerodha's published equity rates (brokerage, STT, exchange fee, SEBI fee, GST, stamp duty, DP charge); the contract note is the truth. A trade counts on the day it closed. This page describes what
        happened; it does not predict the next day and is not advice.
      </p>
    </div>
  );
}
