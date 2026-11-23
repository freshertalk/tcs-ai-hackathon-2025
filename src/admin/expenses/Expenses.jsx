// Expenses — the owner's expense tracker (/me → Personal → Expenses), for superadmins only, laid out like a Google
// Analytics report.
//
// One row of filters scopes everything under it — every figure, chart and list describes the same entries:
//   the period    this month · last month · this year · last 12 months · all time · any month (‹ ›) · picked dates
//   and           words to search for, a group, a way of paying; "compare with the period before" on or off
// Under it:
//   scorecards    spent, per day, entries, Stock Market costs, the biggest expense — each with its change from the
//                 period before and a sparkline
//   the trend     a line (with the period before, dashed) or bars stacked by group; a point or bar opens its day/month
//   the split     a donut of the groups with every figure in its legend; pressing a group shows only that group
//   top categories · Stock Market costs · by day of the week · paid by
//   add / change, the entries (searched, sorted, subtotalled by month), and every month or year of the whole ledger
//
// The arithmetic is in ledger.js, the charts in charts.jsx. The eight groups wear eight colours checked for colour-blind
// separation on this area's light and dark surfaces; "Other" is grey. A colour belongs to its group, never to its rank,
// and a name or a figure is never written in a group's colour — a swatch beside it carries the identity.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import Shell from "../Shell";
import { Alert, Loading } from "../ui";
import { DateField, DateRangeField } from "../DatePicker";
import { useDialog } from "../dialog/DialogProvider";
import { addMonths, alignPrev, applyFilters, breakdown, bucketsFor, byCategory, byMethod, byWeekday, dayName, daysSoFar, groupTotal, money, monthName, periodRange, sortItems, splitByGroup, stack, toCsv, total, weekday, ymOf } from "./ledger";
import { Columns, Donut, RankBars, Sparkline, StackBars, TrendLine } from "./charts";
import "./expenses.css";
import { useTopics } from "../live";

const BLANK = { id: "", date: "", amount: "", category: "grocery", title: "", method: "upi", note: "" };
const pct = (x) => `${Math.round(x * 100)}%`;
/** A change from the period before, in words a glance can take in: "+4%", "−12%", "under 1%", "more than 10 times". */
const changeText = (c) => (c >= 10 ? "more than 10 times as much" : Math.abs(c) < 0.005 ? "under 1% apart" : `${c > 0 ? "+" : "−"}${Math.round(Math.abs(c) * 100)}%`);

/** A group's swatch: the coloured mark that sits beside its name. */
function Swatch({ group }) {
  return <i className={`ex-sw ex-g--${group}`} aria-hidden="true" />;
}

/**
 * A scorecard, as on a Google Analytics report: the name, the figure, the change from the period before (spending
 * more is the red way, spending less the green — with an arrow and the word, never colour alone) and a sparkline.
 */
function Scorecard({ label, value, sub, now, before, spark, sparkLabel, lead = false, prevLabel }) {
  const change = Number.isFinite(before) && before > 0 && Number.isFinite(now) ? (now - before) / before : null;
  return (
    <div className={`ex-score${lead ? " ex-score--lead" : ""}`}>
      <span className="ex-score__k">{label}</span>
      <b className="ex-score__v">{value}</b>
      <span className="ex-score__sub">
        {change !== null ? (
          <span className={`ex-delta ${change > 0.005 ? "is-more" : change < -0.005 ? "is-less" : ""}`} title={prevLabel ? `against ${prevLabel}` : undefined}>
            {change > 0.005 ? "▲" : change < -0.005 ? "▼" : "•"} {changeText(change)}
          </span>
        ) : null}
        {sub && <small>{sub}</small>}
      </span>
      {spark && <Sparkline values={spark} label={sparkLabel} />}
    </div>
  );
}

/* ------------------------------------------------------------------ add or change one entry */
function EntryForm({ form, setForm, meta, busy, onSave, onCancel, amountRef }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e && e.target ? e.target.value : e });
  const editing = Boolean(form.id);
  return (
    <form
      className="ex-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <DateField value={form.date} onChange={set("date")} label="Day" id="ex-date" />
      <div className="adm-field">
        <label htmlFor="ex-amount">Amount (₹)</label>
        <input id="ex-amount" ref={amountRef} value={form.amount} onChange={set("amount")} inputMode="decimal" placeholder="0" autoComplete="off" required />
      </div>
      <div className="adm-field">
        <label htmlFor="ex-category">Category</label>
        <select id="ex-category" value={form.category} onChange={set("category")}>
          {meta.groups.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {meta.categories
                .filter((c) => c.group === g.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="adm-field">
        <label htmlFor="ex-method">Paid by</label>
        <select id="ex-method" value={form.method} onChange={set("method")}>
          {meta.methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="adm-field ex-form__wide">
        <label htmlFor="ex-title">What it was</label>
        <input id="ex-title" value={form.title} onChange={set("title")} maxLength={120} placeholder="e.g. Vegetables and milk" autoComplete="off" />
      </div>
      <div className="adm-field ex-form__wide">
        <label htmlFor="ex-note">Note (optional)</label>
        <input id="ex-note" value={form.note} onChange={set("note")} maxLength={500} autoComplete="off" />
      </div>
      <div className="ex-form__acts">
        <button className="adm-btn adm-btn--solid" disabled={busy}>
          {editing ? "Save the change" : "Add expense"}
        </button>
        {editing && (
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ the page */
const SORTS = [
  ["date", "Day"],
  ["title", "What"],
  ["category", "Category"],
  ["method", "Paid by"],
  ["amount", "Amount"],
];

export default function Expenses() {
  const ask = useDialog();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(null); // null = this month
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [method, setMethod] = useState("");
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [form, setForm] = useState(BLANK);
  const [shown, setShown] = useState(100);
  const [unit, setUnit] = useState("month");
  const [view, setView] = useState("line"); // the trend: a line, or bars stacked by group
  const [compare, setCompare] = useState(true);
  const amountRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    const before = document.title;
    document.title = "Expenses";
    return () => {
      document.title = before;
    };
  }, []);
  useEffect(() => {
    api("/api/admin/expenses")
      .then((d) => {
        setData(d);
        setForm((f) => ({ ...f, date: f.date || d.today }));
      })
      .catch((e) => setError(e.message || "The expenses could not be read."));
  }, []);
  // live: an expense added, changed or removed anywhere (another tab, another device) shows here at once; the form is left alone
  useTopics(["expenses"], () => {
    api("/api/admin/expenses")
      .then(setData)
      .catch(() => {});
  });

  const items = useMemo(() => (data ? data.items : []), [data]);
  const today = data ? data.today : "";
  const cats = useMemo(() => new Map(((data && data.categories) || []).map((c) => [c.id, c])), [data]);
  const groups = useMemo(() => (data && data.groups) || [], [data]);
  const methods = useMemo(() => new Map(((data && data.methods) || []).map((m) => [m.id, m.label])), [data]);
  const range = useMemo(() => (data ? periodRange(period, today, items) : null), [data, period, today, items]);
  const slice = useMemo(() => (range ? applyFilters(items, { range, q, group, method }, cats) : []), [items, range, q, group, method, cats]);
  const before = useMemo(() => (range && range.prev ? applyFilters(items, { range: range.prev, q, group, method }, cats) : null), [items, range, q, group, method, cats]);
  // the donut and the Stock Market card keep every group in view (a group chosen above is shown by emphasis instead)
  const sliceAllGroups = useMemo(() => (range ? applyFilters(items, { range, q, group: "", method }, cats) : []), [items, range, q, method, cats]);
  const beforeAllGroups = useMemo(() => (range && range.prev ? applyFilters(items, { range: range.prev, q, group: "", method }, cats) : null), [items, range, q, method, cats]);
  const spent = useMemo(() => total(slice), [slice]);
  const split = useMemo(() => splitByGroup(sliceAllGroups, groups, cats), [sliceAllGroups, groups, cats]);
  const trend = useMemo(() => {
    if (!range) return { unit: "day", rows: [], prev: null };
    const b = bucketsFor(range);
    const rows = stack(slice, b.buckets, cats);
    const prevRows = range.prev && before ? stack(before, bucketsFor(range.prev).buckets, cats) : null;
    return { unit: b.unit, rows, prev: prevRows ? alignPrev(rows, prevRows) : null };
  }, [range, slice, before, cats]);
  const catsTop = useMemo(() => byCategory(slice, cats), [slice, cats]);
  // the Stock Market card: each cost as a share of what the trading desk cost, not of all spending
  const stockRows = useMemo(() => {
    const rows = byCategory(sliceAllGroups, cats).filter((r) => r.group === "stock");
    const all = rows.reduce((t, r) => t + r.total, 0);
    return rows.map((r) => ({ ...r, share: all ? r.total / all : 0 }));
  }, [sliceAllGroups, cats]);
  const weekdays = useMemo(() => byWeekday(slice), [slice]);
  const paid = useMemo(() => byMethod(slice, (data && data.methods) || []), [slice, data]);
  const sorted = useMemo(() => sortItems(slice, sort.key, sort.dir, cats), [slice, sort, cats]);
  // the whole ledger by month or year (the words, group and way of paying still apply; the period does not)
  const everything = useMemo(() => (data ? applyFilters(items, { range: null, q, group, method }, cats) : []), [data, items, q, group, method, cats]);
  const table = useMemo(() => breakdown(everything, unit, groups, cats, today), [everything, unit, groups, cats, today]);

  useEffect(() => setShown(100), [period, q, group, method, sort]);

  const pickBar = useCallback(
    (row) => {
      if (trend.unit === "month") setPeriod({ kind: "month", ym: row.key });
      else if (trend.unit === "year") setPeriod({ kind: "year", y: Number(row.key) });
      else setPeriod({ kind: "range", from: row.key, to: row.key });
    },
    [trend.unit]
  );

  const save = async () => {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const body = { date: form.date, amount: form.amount, category: form.category, title: form.title, method: form.method, note: form.note };
    try {
      if (form.id) {
        const d = await api(`/api/admin/expenses/${form.id}`, { method: "PUT", body });
        setData((cur) => ({ ...cur, items: cur.items.map((x) => (x.id === d.item.id ? d.item : x)) }));
        setMsg({ kind: "ok", text: `Changed: ${d.item.title}, ${money(d.item.amount)} on ${dayName(d.item.date)}.` });
        setForm({ ...BLANK, date: form.date, category: form.category, method: form.method });
      } else {
        const d = await api("/api/admin/expenses", { method: "POST", body });
        setData((cur) => ({ ...cur, items: [d.item, ...cur.items] }));
        setMsg({ kind: "ok", text: `Added: ${d.item.title}, ${money(d.item.amount)} on ${dayName(d.item.date)}.` });
        // the day, the category and the way of paying stay: the next entry is usually from the same day
        setForm({ ...BLANK, date: form.date, category: form.category, method: form.method });
        if (amountRef.current) amountRef.current.focus();
      }
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };

  const edit = (x) => {
    setMsg({ kind: "", text: "" });
    setForm({ id: x.id, date: x.date, amount: String(x.amount), category: x.category, title: x.title, method: x.method, note: x.note || "" });
    if (formRef.current && formRef.current.scrollIntoView) formRef.current.scrollIntoView({ block: "center" });
  };

  const remove = async (x) => {
    const yes = await ask({
      tone: "danger",
      title: "Remove this expense?",
      body: (
        <p>
          <b>{x.title}</b>, {money(x.amount)} on {dayName(x.date)}. It is taken out of every total. This cannot be undone.
        </p>
      ),
      confirmText: "Remove",
      cancelText: "Keep it",
    });
    if (!yes) return;
    try {
      await api(`/api/admin/expenses/${x.id}`, { method: "DELETE" });
      setData((cur) => ({ ...cur, items: cur.items.filter((i) => i.id !== x.id) }));
      if (form.id === x.id) setForm({ ...BLANK, date: today });
      setMsg({ kind: "ok", text: `Removed: ${x.title}, ${money(x.amount)}.` });
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
  };

  const exportCsv = () => {
    const blob = new Blob([`﻿${toCsv(slice, cats, groups, (data && data.methods) || [])}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (error) {
    return (
      <Shell crumb="Expenses" wide>
        <Alert kind="error">{error}</Alert>
      </Shell>
    );
  }
  if (!data || !range) {
    return (
      <Shell crumb="Expenses" wide>
        <Loading label="Opening the ledger…" />
      </Shell>
    );
  }

  const kind = range.kind;
  const ym = kind === "month" ? range.ym : ymOf(today);
  const isThisMonth = kind === "month" && range.ym === ymOf(today);
  const isLastMonth = kind === "month" && range.ym === addMonths(ymOf(today), -1);
  const isThisYear = kind === "year" && range.label === today.slice(0, 4);
  const days = daysSoFar(range, today);
  const prevSpent = before ? total(before) : null;
  const prevDays = range.prev ? daysSoFar(range.prev, today) : null;
  const stockNow = groupTotal(sliceAllGroups, cats, "stock");
  const stockBefore = beforeAllGroups ? groupTotal(beforeAllGroups, cats, "stock") : null;
  const allNow = total(sliceAllGroups);
  const months = Math.max(1, Math.round(days / 30.4));
  const filtered = Boolean(q || group || method);
  const biggest = slice.length ? slice.reduce((a, x) => (x.amount > a.amount ? x : a)) : null;
  const byMonth = sort.key === "date" && new Set(slice.map((x) => ymOf(x.date))).size > 1;
  const visible = sorted.slice(0, shown);
  const monthTotals = byMonth ? slice.reduce((m, x) => m.set(ymOf(x.date), (m.get(ymOf(x.date)) || 0) + x.amount), new Map()) : null;
  const unitWord = trend.unit === "day" ? "day" : trend.unit === "month" ? "month" : "year";
  const spark = (pick) => trend.rows.map(pick);
  const groupName = group ? (groups.find((g) => g.id === group) || {}).label : "";

  return (
    <Shell crumb="Expenses" wide>
      <div className="ex">
        <header className="ex-head">
          <div>
            <h1 className="adm-h1">Expenses</h1>
            <p className="adm-lead">What was spent, on which day, on what. Everything below follows the period and the filters chosen here.</p>
          </div>
          <div className="ex-head__acts">
            <label className="ex-switch">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              <span>Compare with {range.prev ? range.prev.label : "the period before"}</span>
            </label>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={exportCsv} disabled={!slice.length} data-tip="Save the entries shown below as a spreadsheet file (CSV).">
              Export {slice.length ? `${slice.length} ` : ""}to a file
            </button>
          </div>
        </header>

        {/* one row of filters, above everything it scopes */}
        <section className="ex-filters" aria-label="Period and filters">
          <div className="ex-chips jp-chips" role="group" aria-label="Period">
            <button type="button" aria-pressed={isThisMonth} onClick={() => setPeriod(null)}>
              This month
            </button>
            <button type="button" aria-pressed={isLastMonth} onClick={() => setPeriod({ kind: "month", ym: addMonths(ymOf(today), -1) })}>
              Last month
            </button>
            <button type="button" aria-pressed={isThisYear} onClick={() => setPeriod({ kind: "year", y: Number(today.slice(0, 4)) })}>
              This year
            </button>
            <button type="button" aria-pressed={kind === "last12"} onClick={() => setPeriod({ kind: "last12" })}>
              Last 12 months
            </button>
            <button type="button" aria-pressed={kind === "all"} onClick={() => setPeriod({ kind: "all" })}>
              All time
            </button>
          </div>
          <div className="ex-step" role="group" aria-label="Any month">
            <button type="button" onClick={() => setPeriod({ kind: "month", ym: addMonths(ym, -1) })} aria-label="The month before">
              ‹
            </button>
            <b aria-live="polite">{kind === "month" ? range.label : monthName(ym)}</b>
            <button type="button" onClick={() => setPeriod({ kind: "month", ym: addMonths(ym, 1) })} aria-label="The month after">
              ›
            </button>
          </div>
          <DateRangeField value={kind === "range" ? { from: range.from, to: range.to } : null} onChange={(v) => v && v.from && setPeriod({ kind: "range", from: v.from, to: v.to || v.from })} label="Pick dates" placeholder="Any dates" className="ex-range" />
          <div className="ex-find">
            <label htmlFor="ex-q" className="ex-vh">
              Search the entries
            </label>
            <input id="ex-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: what, note, category, day, amount" />
            <label htmlFor="ex-group" className="ex-vh">
              Group
            </label>
            <select id="ex-group" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Every group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
            <label htmlFor="ex-paid" className="ex-vh">
              Paid by
            </label>
            <select id="ex-paid" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Paid any way</option>
              {(data.methods || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {filtered && (
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--sm"
                onClick={() => {
                  setQ("");
                  setGroup("");
                  setMethod("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </section>

        {/* the scorecards */}
        <section className="ex-scores" aria-label={`The figures for ${range.label}`}>
          <Scorecard lead label={`Spent · ${range.label}${filtered ? " · filtered" : ""}`} value={money(spent)} now={spent} before={compare ? prevSpent : null} prevLabel={range.prev && range.prev.label} sub={range.prev && compare && prevSpent > 0 ? `${money(prevSpent)} in ${range.prev.label}` : `${slice.length} ${slice.length === 1 ? "entry" : "entries"}`} spark={spark((r) => r.total)} sparkLabel={`Spending ${unitWord} by ${unitWord}`} />
          <Scorecard label="Per day" value={money(Math.round(spent / days))} now={spent / days} before={compare && prevSpent !== null && prevDays ? prevSpent / prevDays : null} prevLabel={range.prev && range.prev.label} sub={`over ${days} ${days === 1 ? "day" : "days"}`} />
          <Scorecard label="Entries" value={String(slice.length)} now={slice.length} before={compare && before ? before.length : null} prevLabel={range.prev && range.prev.label} sub={slice.length ? `${money(Math.round(spent / slice.length))} each, on average` : "nothing entered"} spark={spark((r) => r.count)} sparkLabel={`Entries ${unitWord} by ${unitWord}`} />
          <Scorecard label="Stock Market costs" value={money(stockNow)} now={stockNow} before={compare ? stockBefore : null} prevLabel={range.prev && range.prev.label} sub={allNow ? `${pct(stockNow / allNow)} of all spending` : "nothing spent"} spark={spark((r) => r.parts.stock || 0)} sparkLabel={`Stock Market costs ${unitWord} by ${unitWord}`} />
          <Scorecard label="Biggest expense" value={biggest ? money(biggest.amount) : "—"} sub={biggest ? `${biggest.title} · ${dayName(biggest.date)}` : "nothing spent"} />
        </section>

        {/* the trend and the split */}
        <div className="ex-grid ex-grid--main">
          <section className="adm-card ex-card" aria-labelledby="ex-trend-h">
            <header className="ex-card__head ex-card__head--row">
              <div>
                <h2 id="ex-trend-h">Spending over time</h2>
                <p>
                  {range.label} · {unitWord} by {unitWord}
                  {groupName ? ` · ${groupName}` : ""}. Press a {view === "line" ? "point" : "bar"} to open that {unitWord}.
                </p>
              </div>
              <div className="ex-tabs" role="tablist" aria-label="How to show it">
                <button type="button" role="tab" aria-selected={view === "line"} onClick={() => setView("line")}>
                  Total
                </button>
                <button type="button" role="tab" aria-selected={view === "bars"} onClick={() => setView("bars")}>
                  By group
                </button>
              </div>
            </header>
            {spent > 0 || (compare && trend.prev && trend.prev.some((v) => v > 0)) ? (
              view === "line" ? (
                <TrendLine rows={trend.rows} prev={compare ? trend.prev : null} prevLabel={range.prev ? range.prev.label : "Previous period"} onPick={pickBar} upTo={today} />
              ) : (
                <StackBars rows={trend.rows} unit={trend.unit} groups={groups} onPick={pickBar} />
              )
            ) : (
              <p className="ex-empty">Nothing was spent in this period.</p>
            )}
          </section>
          <section className="adm-card ex-card ex-card--split" aria-labelledby="ex-split-h">
            <header className="ex-card__head">
              <h2 id="ex-split-h">Where it went</h2>
              <p>{range.label} · by group. Press a group to see only that group; press it again for all.</p>
            </header>
            {split.length ? <Donut parts={split} whole={allNow} selected={group} onPick={(id) => setGroup(group === id ? "" : id)} /> : <p className="ex-empty">Nothing was spent in this period.</p>}
          </section>
        </div>

        <div className="ex-grid ex-grid--two">
          <section className="adm-card ex-card" aria-labelledby="ex-cats-h">
            <header className="ex-card__head">
              <h2 id="ex-cats-h">Top categories</h2>
              <p>
                {range.label}
                {groupName ? ` · ${groupName}` : ""} · largest first. Press one to search for it.
              </p>
            </header>
            <RankBars rows={catsTop} limit={10} onPick={(r) => setQ(r.label)} empty="Nothing was spent in this period." />
          </section>
          <section className="adm-card ex-card ex-card--stock" aria-labelledby="ex-stock-h">
            <header className="ex-card__head ex-card__head--row">
              <div>
                <h2 id="ex-stock-h">
                  <Swatch group="stock" /> Stock Market costs
                </h2>
                <p>What running the trading desk cost in {range.label}: subscriptions, data, AI, the office.</p>
              </div>
              <div className="ex-mini">
                <b>{money(stockNow)}</b>
                <small>{stockNow ? `about ${money(Math.round(stockNow / months))} a month` : "nothing yet"}</small>
              </div>
            </header>
            <RankBars rows={stockRows} limit={8} empty="No Stock Market cost in this period. Add one with the category set to anything under Stock Market — ChatGPT, Claude, the Kite API, broadband, the office." />
          </section>
        </div>

        <div className="ex-grid ex-grid--two">
          <section className="adm-card ex-card" aria-labelledby="ex-week-h">
            <header className="ex-card__head">
              <h2 id="ex-week-h">By day of the week</h2>
              <p>{range.label} · which days the money goes out.</p>
            </header>
            {spent > 0 ? <Columns rows={weekdays} /> : <p className="ex-empty">Nothing was spent in this period.</p>}
          </section>
          <section className="adm-card ex-card" aria-labelledby="ex-paid-h">
            <header className="ex-card__head">
              <h2 id="ex-paid-h">Paid by</h2>
              <p>{range.label} · how it was paid.</p>
            </header>
            <RankBars rows={paid} limit={6} empty="Nothing was spent in this period." />
          </section>
        </div>

        <div className="ex-two ex-two--list">
          <section className="adm-card ex-card" aria-labelledby="ex-form-h" ref={formRef}>
            <header className="ex-card__head">
              <h2 id="ex-form-h">{form.id ? "Change this expense" : "Add an expense"}</h2>
              <p>{form.id ? "Correct what is wrong and save." : "The day, the amount and the category are enough; the rest helps you find it later."}</p>
            </header>
            <EntryForm form={form} setForm={setForm} meta={data} busy={busy} onSave={save} onCancel={() => setForm({ ...BLANK, date: today })} amountRef={amountRef} />
            <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
          </section>

          <section className="adm-card ex-card" aria-labelledby="ex-list-h">
            <header className="ex-card__head ex-card__head--row">
              <div>
                <h2 id="ex-list-h">The entries</h2>
                <p>
                  {slice.length ? `${slice.length} ${slice.length === 1 ? "entry" : "entries"} · ${money(spent)} · ${range.label}` : `No entry in ${range.label}${filtered ? " with these filters" : ""}.`}
                </p>
              </div>
              <label className="ex-sortby">
                Sort by
                <select value={`${sort.key}:${sort.dir}`} onChange={(e) => setSort({ key: e.target.value.split(":")[0], dir: e.target.value.split(":")[1] })} aria-label="Sort the entries">
                  <option value="date:desc">Day, newest first</option>
                  <option value="date:asc">Day, oldest first</option>
                  <option value="amount:desc">Amount, largest first</option>
                  <option value="amount:asc">Amount, smallest first</option>
                  <option value="category:asc">Category, A to Z</option>
                  <option value="title:asc">What, A to Z</option>
                  <option value="method:asc">Paid by</option>
                </select>
              </label>
            </header>
            {items.length === 0 && <p className="ex-empty">No expense has been entered yet. Add the first one on the left: it appears here, in the chart and in every total at once.</p>}
            {slice.length > 0 && (
              <div className="ex-scroll">
                <table className="ex-table">
                  <thead>
                    <tr>
                      {SORTS.map(([key, name]) => (
                        <th key={key} scope="col" className={key === "amount" ? "is-num" : ""} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                          <button type="button" onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "amount" || key === "date" ? "desc" : "asc" })}>
                            {name}
                            <span aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</span>
                          </button>
                        </th>
                      ))}
                      <th scope="col">
                        <span className="ex-vh">Change or remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((x, i) => {
                      const c = cats.get(x.category) || { label: x.category, group: "other" };
                      const head = byMonth && (i === 0 || ymOf(visible[i - 1].date) !== ymOf(x.date));
                      return (
                        <React.Fragment key={x.id}>
                          {head && (
                            <tr className="ex-month">
                              <th scope="colgroup" colSpan={4}>
                                {monthName(ymOf(x.date))}
                              </th>
                              <td className="is-num">{money(Math.round(monthTotals.get(ymOf(x.date)) * 100) / 100)}</td>
                              <td />
                            </tr>
                          )}
                          <tr className={form.id === x.id ? "is-editing" : ""}>
                            <td className="ex-day">
                              <b>{dayName(x.date)}</b>
                              <small>{weekday(x.date)}</small>
                            </td>
                            <td className="ex-what">
                              <b>{x.title}</b>
                              {x.note && <small>{x.note}</small>}
                            </td>
                            <td>
                              <span className="ex-cat">
                                <Swatch group={c.group} />
                                {c.label}
                              </span>
                            </td>
                            <td>{methods.get(x.method) || x.method}</td>
                            <td className="is-num">
                              <b>{money(x.amount)}</b>
                            </td>
                            <td className="ex-acts">
                              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => edit(x)} aria-label={`Change ${x.title}, ${money(x.amount)}`}>
                                Change
                              </button>
                              <button type="button" className="adm-btn adm-btn--danger adm-btn--sm" onClick={() => remove(x)} aria-label={`Remove ${x.title}, ${money(x.amount)}`}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {sorted.length > shown && (
              <button type="button" className="adm-btn adm-btn--ghost ex-more" onClick={() => setShown(shown + 200)}>
                Show more ({sorted.length - shown} left)
              </button>
            )}
          </section>
        </div>

        <section className="adm-card ex-card" aria-labelledby="ex-all-h">
          <header className="ex-card__head ex-card__head--row">
            <div>
              <h2 id="ex-all-h">Every {unit === "year" ? "year" : "month"}</h2>
              <p>The whole ledger, {unit === "year" ? "year by year" : "month by month"}{filtered ? ", with the search and filters above" : ""}. Press a row to open it.</p>
            </div>
            <div className="ex-chips jp-chips" role="group" aria-label="Month by month or year by year">
              <button type="button" aria-pressed={unit === "month"} onClick={() => setUnit("month")}>
                Month by month
              </button>
              <button type="button" aria-pressed={unit === "year"} onClick={() => setUnit("year")}>
                Year by year
              </button>
            </div>
          </header>
          {table.length === 0 ? (
            <p className="ex-empty">Nothing to show yet.</p>
          ) : (
            <div className="ex-scroll">
              <table className="ex-table ex-table--all">
                <thead>
                  <tr>
                    <th scope="col">{unit === "year" ? "Year" : "Month"}</th>
                    <th scope="col" className="is-num">
                      Spent
                    </th>
                    <th scope="col" className="is-num">
                      Entries
                    </th>
                    <th scope="col" className="is-num">
                      Per day
                    </th>
                    <th scope="col">Biggest group</th>
                    <th scope="col">The split</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => {
                    const on = (unit === "month" && kind === "month" && range.ym === r.key) || (unit === "year" && kind === "year" && range.label === r.key);
                    return (
                      <tr key={r.key} className={on ? "is-on" : ""}>
                        <th scope="row">
                          <button type="button" className="ex-link" onClick={() => setPeriod(unit === "year" ? { kind: "year", y: Number(r.key) } : { kind: "month", ym: r.key })}>
                            {r.label}
                          </button>
                        </th>
                        <td className="is-num">
                          <b>{money(r.total)}</b>
                        </td>
                        <td className="is-num">{r.count}</td>
                        <td className="is-num">{money(Math.round(r.perDay))}</td>
                        <td>
                          {r.top && (
                            <span className="ex-cat">
                              <Swatch group={r.top.id} />
                              {r.top.label} · {pct(r.top.total / (r.total || 1))}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="ex-seg ex-seg--row" role="img" aria-label={groups.filter((g) => r.parts[g.id]).map((g) => `${g.label} ${pct(r.parts[g.id] / (r.total || 1))}`).join(", ")}>
                            {groups
                              .filter((g) => r.parts[g.id])
                              .map((g) => (
                                <i key={g.id} className={`ex-g--${g.id}`} style={{ flexGrow: r.parts[g.id] }} />
                              ))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <ul className="ex-legend" aria-label="Groups">
            {groups.map((g) => (
              <li key={g.id}>
                <Swatch group={g.id} />
                {g.label}
              </li>
            ))}
          </ul>
        </section>
        <p className="ex-small ex-foot">Kept on this server, one record an entry, and in the daily backup. Superadmins only; nothing here is read by the trading desk or shown to an AI model.</p>
      </div>
    </Shell>
  );
}
