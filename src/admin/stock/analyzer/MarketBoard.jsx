// The market board: any NSE index's stocks in one table, laid out like NSE's live equity market
// page (pick NIFTY 50, NIFTY BANK, NIFTY NEXT 50, a broad or a sectoral index) — the index's own
// row on top, then top gainers and losers, the most traded, volume surges, RSI overbought and
// oversold, above or below VWAP, near the 52-week high or low.
// Live while the market trades (refreshed every 15 seconds); the last session's figures when it
// is closed. Prices, VWAP and volume come from Zerodha's quotes; RSI and the 52-week range from
// the screener's stored daily history with the live price as the newest bar.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { day, inr, isNum, num, when } from "./format";
import "./board.css";

const TABS = [
  { id: "gainers", label: "Top gainers", tip: "Up the most today, by % change.", test: (r) => r.changePct > 0, sort: ["changePct", -1] },
  { id: "losers", label: "Top losers", tip: "Down the most today, by % change.", test: (r) => r.changePct < 0, sort: ["changePct", 1] },
  { id: "active", label: "Most active", tip: "The most rupees traded today (volume × VWAP).", test: (r) => isNum(r.turnoverCr), sort: ["turnoverCr", -1] },
  { id: "surge", label: "Volume surge", tip: "Trading at least 1.5× its usual value by now (against its 20-day average day).", test: (r) => r.relTurnover >= 1.5, sort: ["relTurnover", -1] },
  { id: "overbought", label: "RSI overbought", tip: "Daily RSI 70 or above, with the live price as today’s bar.", test: (r) => r.rsi >= 70, sort: ["rsi", -1] },
  { id: "oversold", label: "RSI oversold", tip: "Daily RSI 30 or below, with the live price as today’s bar.", test: (r) => isNum(r.rsi) && r.rsi <= 30, sort: ["rsi", 1] },
  { id: "above", label: "Above VWAP", tip: "Trading above the day’s volume-weighted average price.", test: (r) => r.vsVwapPct > 0, sort: ["vsVwapPct", -1] },
  { id: "below", label: "Below VWAP", tip: "Trading below the day’s volume-weighted average price.", test: (r) => r.vsVwapPct < 0, sort: ["vsVwapPct", 1] },
  { id: "high52", label: "Near 52-wk high", tip: "Within 3% of the 52-week high (closing basis, plus today’s high).", test: (r) => isNum(r.fromHigh52Pct) && r.fromHigh52Pct >= -3, sort: ["fromHigh52Pct", -1] },
  { id: "low52", label: "Near 52-wk low", tip: "Within 3% of the 52-week low.", test: (r) => isNum(r.fromLow52Pct) && r.fromLow52Pct <= 3, sort: ["fromLow52Pct", 1] },
  { id: "all", label: "All", tip: "Every stock in the index, A to Z.", test: () => true, sort: ["symbol", 1] },
];

// NSE's columns, in NSE's order, then the desk's own: RSI, VWAP, how busy and the day's range
const COLS = [
  { id: "symbol", label: "Symbol", num: false },
  { id: "open", label: "Open" },
  { id: "high", label: "High" },
  { id: "low", label: "Low" },
  { id: "prevClose", label: "Prev. close" },
  { id: "last", label: "LTP" },
  { id: "change", label: "Change" },
  { id: "changePct", label: "% Change" },
  { id: "volume", label: "Volume" },
  { id: "turnoverCr", label: "Value" },
  { id: "high52", label: "52 week high" },
  { id: "low52", label: "52 week low" },
  { id: "rsi", label: "RSI (14)" },
  { id: "vwap", label: "VWAP" },
  { id: "vsVwapPct", label: "vs VWAP" },
  { id: "relTurnover", label: "× usual" },
  { id: "range", label: "Day range", sortable: false },
  { id: "fromHigh52Pct", label: "From 52w high" },
];
const INDEX_KEY = "vpt.board.index";
const storedIndex = () => {
  try {
    return window.localStorage.getItem(INDEX_KEY) || "nifty50";
  } catch (_) {
    return "nifty50";
  }
};

const pctText = (x) => (isNum(x) ? `${x > 0 ? "+" : ""}${x.toFixed(2)}%` : "—");
const tone = (x) => (isNum(x) ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
const vol = (v) => (!isNum(v) ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} K` : String(v));

function RsiCell({ r }) {
  if (!isNum(r.rsi)) return <td className="is-num mb-dim">—</td>;
  const band = r.rsi >= 70 ? "mb-rsi--hot" : r.rsi <= 30 ? "mb-rsi--cold" : "";
  const arrow = isNum(r.rsiPrev) ? (r.rsi > r.rsiPrev ? "↑" : r.rsi < r.rsiPrev ? "↓" : "") : "";
  return (
    <td className={`is-num mb-rsi ${band}`} data-tip={`RSI ${r.rsi}${isNum(r.rsiPrev) ? ` (yesterday ${r.rsiPrev})` : ""}${r.rsi >= 70 ? " — overbought" : r.rsi <= 30 ? " — oversold" : ""}`}>
      {num(r.rsi, 1)} {arrow}
    </td>
  );
}

function Range({ r }) {
  if (!isNum(r.high) || !isNum(r.low) || r.high <= r.low) return <td className="mb-dim">—</td>;
  const at = Math.max(0, Math.min(100, ((r.last - r.low) / (r.high - r.low)) * 100));
  return (
    <td data-tip={`Low ${inr(r.low)} · high ${inr(r.high)} · now ${inr(r.last)}`}>
      <span className="mb-range">
        <i style={{ left: `${at}%` }} />
      </span>
    </td>
  );
}

export default function MarketBoard({ onOpen }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(() => {
    try {
      return window.sessionStorage.getItem("vpt.board.tab") || "gainers";
    } catch (_) {
      return "gainers";
    }
  });
  const [sort, setSort] = useState(null); // a header the user clicked: [column, direction]
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(storedIndex);

  const load = useCallback(
    () =>
      api(`/api/admin/market/screener/board?index=${encodeURIComponent(index)}`)
        .then((d) => {
          setB(d);
          setErr("");
        })
        .catch((e) => setErr(e.message)),
    [index]
  );
  useEffect(() => {
    load();
  }, [load]);
  // live: every 15 seconds while the page is in front; closed: the last session does not change
  useEffect(() => {
    if (!b || !b.live) return undefined;
    const id = setInterval(() => document.visibilityState !== "hidden" && load(), 15000);
    return () => clearInterval(id);
  }, [b, load]);

  const chooseIndex = (id) => {
    setIndex(id);
    setSort(null);
    try {
      window.localStorage.setItem(INDEX_KEY, id);
    } catch (_) {
      /* remembered for this visit only */
    }
  };

  const pick = (id) => {
    setTab(id);
    setSort(null);
    try {
      window.sessionStorage.setItem("vpt.board.tab", id);
    } catch (_) {
      /* remembered for this visit only */
    }
  };

  const rowsAll = useMemo(() => (b && b.rows ? b.rows : []), [b]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, rowsAll.filter(t.test).length])), [rowsAll]);
  const def = TABS.find((t) => t.id === tab) || TABS[0];
  const rows = useMemo(() => {
    const term = q.trim().toUpperCase();
    const list = rowsAll.filter(def.test).filter((r) => !term || r.symbol.includes(term) || String(r.name || "").toUpperCase().includes(term));
    const [col, dir] = sort || def.sort;
    return list.sort((x, y) => {
      const a = x[col];
      const c = y[col];
      if (col === "symbol") return dir * String(a).localeCompare(String(c));
      if (!isNum(a) && !isNum(c)) return 0;
      if (!isNum(a)) return 1;
      if (!isNum(c)) return -1;
      return dir * (a - c);
    });
  }, [rowsAll, def, sort, q]);

  if (!b && !err) return <Loading label="Reading the index…" />;
  if (!b) return <Alert>{err}</Alert>;
  if (!b.ready) return <p className="adm-alert adm-alert--info">The board fills once the stock list is ready — use the history download under RSI search below (once, a few minutes).</p>;
  const ix = b.index;
  const groups = [...new Set((b.indices || []).map((x) => x.group))];

  const br = b.breadth;
  const total = br.advances + br.declines + br.unchanged || 1;
  const head = (c) => {
    const active = (sort || def.sort)[0] === c.id;
    const dir = (sort || def.sort)[1];
    if (c.sortable === false) return <th key={c.id} scope="col">{c.label}</th>;
    return (
      <th key={c.id} scope="col" className={c.num === false ? "" : "is-num"} aria-sort={active ? (dir > 0 ? "ascending" : "descending") : "none"}>
        <button type="button" className="mb-sort" onClick={() => setSort([c.id, active ? -dir : c.id === "symbol" ? 1 : -1])}>
          {c.label}
          {active ? (dir > 0 ? " ▲" : " ▼") : ""}
        </button>
      </th>
    );
  };

  return (
    <section className="an-card mb">
      <header className="mb-head">
        <div>
          <h3>
            Market board
            <select className="mb-index" value={ix ? ix.id : index} onChange={(e) => chooseIndex(e.target.value)} aria-label="Index">
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {b.indices
                    .filter((x) => x.group === g)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.count})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <span className={`mb-live ${b.live ? "is-on" : ""}`}>{b.live ? "● Live" : "Market closed"}</span>
          </h3>
          <p className="vd-note">
            {b.live ? `Refreshed every 15 s · ${when(b.at)}` : `Last session${b.session ? ` · ${day(b.session)}` : ""} — closing figures`} · {b.quoted} of {b.covered} stocks priced
            {b.withRsi < b.quoted ? ` · RSI for ${b.withRsi} (the rest after the history download)` : ""}
          </p>
        </div>
        <div className="mb-breadth" data-tip={`${br.advances} up · ${br.declines} down · ${br.unchanged} unchanged`}>
          {b.nifty && (
            <span className={tone(b.nifty.changePct)}>
              NIFTY 50 {num(b.nifty.last, 2)} ({pctText(b.nifty.changePct)})
            </span>
          )}
          <span className="mb-bar" aria-hidden="true">
            <i className="is-up" style={{ width: `${(br.advances / total) * 100}%` }} />
            <i className="is-down" style={{ width: `${(br.declines / total) * 100}%` }} />
          </span>
          <small>
            <b className="is-up">{br.advances}</b> advances · <b className="is-down">{br.declines}</b> declines · {br.unchanged} unchanged
          </small>
        </div>
      </header>

      <div className="mb-tabs" role="tablist" aria-label="Board">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => pick(t.id)} data-tip={t.tip} className={t.id === "gainers" ? "is-g" : t.id === "losers" ? "is-l" : ""}>
            {t.label} <small>{counts[t.id]}</small>
          </button>
        ))}
        <input className="mb-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by symbol or name" aria-label="Filter the board" spellCheck="false" />
      </div>

      {rows.length === 0 ? (
        <p className="vd-note">No stock fits “{def.label}” right now.</p>
      ) : (
        <div className="mb-scroll">
          <table className="an-table mb-table">
            <thead>
              <tr>
                <th scope="col" className="is-num">#</th>
                {COLS.map(head)}
              </tr>
            </thead>
            <tbody>
              {ix && ix.available && (
                <tr className="mb-ixrow">
                  <td className="is-num mb-dim" />
                  <th scope="row" className="mb-sym">
                    <span>
                      <b>{ix.name}</b>
                      <small>the index</small>
                    </span>
                  </th>
                  <td className="is-num">{num(ix.open, 2)}</td>
                  <td className="is-num">{num(ix.high, 2)}</td>
                  <td className="is-num">{num(ix.low, 2)}</td>
                  <td className="is-num">{num(ix.prevClose, 2)}</td>
                  <td className="is-num">
                    <b>{num(ix.last, 2)}</b>
                  </td>
                  <td className={`is-num ${tone(ix.change)}`}>{isNum(ix.change) ? `${ix.change > 0 ? "+" : ""}${num(ix.change, 2)}` : "—"}</td>
                  <td className={`is-num mb-pct ${tone(ix.changePct)}`}>{pctText(ix.changePct)}</td>
                  <td colSpan={COLS.length - 8} className="mb-dim">
                    {br.advances} advances · {br.declines} declines · {br.unchanged} unchanged
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.symbol} onClick={() => onOpen && onOpen(r.symbol)} className={onOpen ? "is-link" : ""} title={onOpen ? `Open ${r.symbol} on the desk` : undefined}>
                  <td className="is-num mb-dim">{i + 1}</td>
                  <th scope="row" className="mb-sym">
                    <span>
                      <b>{r.symbol}</b>
                      {r.name && <small>{r.name}</small>}
                    </span>
                  </th>
                  <td className="is-num">{num(r.open, 2)}</td>
                  <td className="is-num">{num(r.high, 2)}</td>
                  <td className="is-num">{num(r.low, 2)}</td>
                  <td className="is-num">{num(r.prevClose, 2)}</td>
                  <td className="is-num">
                    <b>{num(r.last, 2)}</b>
                  </td>
                  <td className="is-num">
                    <span className={`mb-chip ${tone(r.change)}`}>{isNum(r.change) ? `${r.change > 0 ? "+" : ""}${num(r.change, 2)}` : "—"}</span>
                  </td>
                  <td className="is-num">
                    <span className={`mb-chip mb-pct ${tone(r.changePct)}`}>{isNum(r.changePct) ? num(r.changePct, 2) : "—"}</span>
                  </td>
                  <td className="is-num">{vol(r.volume)}</td>
                  <td className="is-num">{isNum(r.turnoverCr) ? `${num(r.turnoverCr, 2)} Cr` : "—"}</td>
                  <td className="is-num">{num(r.high52, 2)}</td>
                  <td className="is-num">{num(r.low52, 2)}</td>
                  <RsiCell r={r} />
                  <td className="is-num">{num(r.vwap, 2)}</td>
                  <td className={`is-num ${tone(r.vsVwapPct)}`}>{pctText(r.vsVwapPct)}</td>
                  <td className={`is-num ${r.relTurnover >= 1.5 ? "is-up" : ""}`}>{isNum(r.relTurnover) ? `${num(r.relTurnover, 1)}×` : "—"}</td>
                  <Range r={r} />
                  <td className={`is-num ${tone(r.fromHigh52Pct)}`}>{pctText(r.fromHigh52Pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="vd-note">
        Prices, VWAP (the exchange’s average traded price) and volume from Zerodha · RSI is the daily 14-period RSI with today’s price as the newest bar · “× usual” is today’s value traded
        against the stock’s 20-day average day · 52-week range on daily closes plus today’s high and low. Select a row to open the stock on the desk. A list of movers is not a
        recommendation.
      </p>
    </section>
  );
}
