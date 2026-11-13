// The chart on a page of its own (/me/chart/SYMBOL), opened from the Desk's "open in a new tab"
// button — like Kite's full chart. Everything the Desk's chart has, filling the window: intervals,
// chart types, indicators, drawing tools, compare, patterns, pivots, zoom and the technical
// summary, with live prices while Zerodha is connected. Another stock is one search away.

import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, peek } from "../../api";
import { adminPath } from "../../paths";
import { TickContext, useLiveTicks, useTick } from "../analyzer/liveTicks";
import { useDeskTheme } from "../analyzer/theme";
import ProChart from "./ProChart";
import "./chart.css";

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const fmt = (x) => (typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

/** The price in the header: the live tick when streaming, else the last quote. */
function Price({ symbol, quote }) {
  const tick = useTick(symbol);
  const last = tick && typeof tick.last === "number" ? tick.last : quote ? quote.last : null;
  const prev = quote && typeof quote.prevClose === "number" ? quote.prevClose : quote && typeof quote.change === "number" && typeof quote.last === "number" ? quote.last - quote.change : null;
  const chg = typeof last === "number" && typeof prev === "number" ? last - prev : null;
  const cls = chg > 0 ? "is-up" : chg < 0 ? "is-down" : "";
  return (
    <p className="kp__px" aria-live="off">
      <b>₹{fmt(last)}</b>
      {chg !== null && <span className={cls}>{`${chg > 0 ? "+" : ""}${fmt(chg)} (${chg > 0 ? "+" : ""}${fmt((chg / prev) * 100)}%)`}</span>}
      {tick && <i className="kc__live">● live</i>}
    </p>
  );
}

/** Find another stock: NSE symbols and names, as the Desk's search. */
function Search({ onPick }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    let alive = true;
    timer.current = setTimeout(() => {
      api(`/api/admin/market/search?q=${encodeURIComponent(term)}`)
        .then((d) => alive && setResults((d.results || []).slice(0, 8)))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [q]);
  const pick = (s) => {
    setQ("");
    setResults([]);
    onPick(s);
  };
  return (
    <div className="kp__search">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const typed = q.trim().toUpperCase();
            if (results[0]) pick(results[0].symbol);
            else if (SYMBOL_RE.test(typed)) pick(typed);
          } else if (e.key === "Escape") setQ("");
        }}
        placeholder="Search a stock…"
        aria-label="Search a stock to chart"
        spellCheck="false"
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className="kp__results" role="listbox">
          {results.map((r) => (
            <li key={r.symbol}>
              <button type="button" onClick={() => pick(r.symbol)}>
                <b>{r.symbol}</b> <span>{r.name || ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ChartPage() {
  const params = useParams();
  const navigate = useNavigate();
  const symbol = String(params.symbol || "").toUpperCase();
  const valid = SYMBOL_RE.test(symbol);
  const [status, setStatus] = useState(() => peek("/api/admin/market/status"));
  const [quote, setQuote] = useState(null);
  const [theme, toggleTheme] = useDeskTheme();
  const mode = status ? status.mode : "none";
  const live = useLiveTicks(valid ? [symbol] : [], mode === "kite", mode === "kite" && valid ? symbol : "");

  useEffect(() => {
    api("/api/admin/market/status")
      .then(setStatus)
      .catch(() => {});
  }, []);
  useEffect(() => {
    document.title = valid ? `${symbol} · Chart` : "Chart";
  }, [symbol, valid]);
  useEffect(() => {
    if (!valid) return undefined;
    let alive = true;
    const read = () =>
      api(`/api/admin/market/quotes?symbols=${encodeURIComponent(symbol)}`)
        .then((d) => alive && setQuote((d.quotes || {})[symbol] || null))
        .catch(() => {});
    read();
    const id = setInterval(() => document.visibilityState !== "hidden" && read(), 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, valid]);

  const open = (s) => navigate(adminPath(`/chart/${encodeURIComponent(s)}`));

  return (
    <TickContext.Provider value={live.store}>
      <div className="kp">
        <header className="kp__head">
          <Link className="kp__back" to={adminPath("/stock-report")} aria-label="Back to the trading desk" data-tip="The trading desk">
            ←
          </Link>
          <h1 className="kp__sym">{valid ? symbol : "Chart"}</h1>
          {valid && <Price symbol={symbol} quote={quote} />}
          <span className="kp__grow" />
          <Search onPick={open} />
          <span className={`kp__state ${mode === "kite" ? "is-on" : ""}`} data-tip={mode === "kite" ? "Zerodha connected: live prices and every intraday interval." : "Zerodha not connected: daily history only. Connect it on the trading desk."}>
            {mode === "kite" ? (live.state === "live" ? "Live" : "Zerodha") : mode === "demo" ? "Demo" : "Offline"}
          </span>
          <button type="button" className="kc__icon" onClick={toggleTheme} aria-label={theme === "dark" ? "Light theme" : "Dark theme"} data-tip="Light or dark.">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </header>
        <main className="kp__main">
          {valid ? <ProChart key={symbol} symbol={symbol} live={mode === "kite"} standalone /> : <p className="kc__note">That is not a valid NSE symbol. Search for a stock above.</p>}
        </main>
      </div>
    </TickContext.Provider>
  );
}
