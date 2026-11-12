// src/admin/stock/analyzer/Analyzer.jsx
// The trading desk: a watchlist with live quotes on the left; for the selected
// stock — any NSE symbol, not only the watchlist — a chart, a technical reading,
// rule-based setups, levels, a position-size calculator, backtests and history;
// and beside it the desk verdict (direction, plans, circuit limits, every level).
//
// It reads the market; it never places an order. Everything it shows is
// arithmetic on prices — a second opinion, not advice.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import ConnectPanel from "./ConnectPanel";
import Watchlist, { SymbolSearch } from "./Watchlist";
import StockView from "./StockView";
import ErrorBoundary from "./ErrorBoundary";
import MarketStrip from "./MarketStrip";
import { TickContext, useLiveTicks } from "./liveTicks";
import { useDeskTheme } from "./theme";
import { clock } from "./format";
import "./analyzer.css";

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
export default function Analyzer() {
  const [params, setParams] = useSearchParams();
  // ?s=SYMBOL keeps the stock across a refresh and makes the page linkable
  const fromUrl = useRef(undefined);
  if (fromUrl.current === undefined) {
    const s = (params.get("s") || "").trim().toUpperCase();
    fromUrl.current = SYMBOL_RE.test(s) ? s : null;
  }
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [symbols, setSymbols] = useState([]);
  const [selected, setSelected] = useState(fromUrl.current);
  // a stock being looked at without being on the watchlist
  const [adhoc, setAdhoc] = useState(fromUrl.current);
  const [quotes, setQuotes] = useState({ quotes: {}, live: false, at: null });
  const [quoteError, setQuoteError] = useState("");
  const [scan, setScan] = useState({ rows: null, loading: false });
  const [listError, setListError] = useState("");
  const [theme, toggleTheme] = useDeskTheme();

  // the result of the Kite login round trip arrives as ?kite=connected | error
  const flash = useRef(null);
  if (flash.current === null) {
    const k = params.get("kite");
    flash.current = k === "connected" ? { kind: "ok", text: "Zerodha connected. Live data is on until 6 AM tomorrow." } : k === "error" ? { kind: "error", text: params.get("reason") || "The Kite login did not complete." } : false;
  }
  useEffect(() => {
    if (params.has("kite")) {
      const next = new URLSearchParams(params);
      next.delete("kite");
      next.delete("reason");
      setParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyStatus = useCallback((s) => {
    setStatus(s);
    if (Array.isArray(s.watchlist)) setSymbols(s.watchlist);
  }, []);

  const loadStatus = useCallback(() => {
    api("/api/admin/market/status")
      .then((s) => {
        applyStatus(s);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [applyStatus]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // re-check the connection every 5 minutes: the Kite token dies at 6 AM by itself
  useEffect(() => {
    const id = setInterval(loadStatus, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadStatus]);

  const mode = status ? status.mode : "none";

  const symbolKey = symbols.join(",");

  // real symbols and demo symbols do not mix: switching source drops the ad-hoc pick
  const lastMode = useRef(null);
  useEffect(() => {
    if (!status) return;
    if (lastMode.current !== null && lastMode.current !== mode) setAdhoc(null);
    lastMode.current = mode;
  }, [status, mode]);

  // keep the selection valid as the list or the mode changes
  useEffect(() => {
    if (!status) return;
    if (selected && (symbols.includes(selected) || selected === adhoc)) return;
    setSelected(symbols[0] || null);
  }, [status, symbolKey, adhoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // mirror the selection into the address bar
  useEffect(() => {
    if (!status) return;
    const cur = params.get("s") || "";
    if ((selected || "") === cur) return;
    const next = new URLSearchParams(params);
    if (selected) next.set("s", selected);
    else next.delete("s");
    setParams(next, { replace: true });
  }, [status, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (symbol) => {
    if (!symbols.includes(symbol)) setAdhoc(symbol);
    setSelected(symbol);
  };
  // the open stock's quote is polled too when it is not on the watchlist
  const extra = selected && !symbols.includes(selected) ? selected : "";

  // live ticks for everything on screen: the watchlist, the open stock and the indices in the strip
  const streamKey = [...new Set([...symbols, ...(selected ? [selected] : []), "NIFTY 50", "NIFTY BANK", "INDIA VIX"])].join(",");
  const streamSymbols = useMemo(() => streamKey.split(","), [streamKey]);
  // the open stock is "in focus": its ticks also bring the order book and the flow reading
  const live = useLiveTicks(streamSymbols, mode === "kite", mode === "kite" && selected ? selected : "");
  const streaming = live.state === "live";

  const runScan = useCallback(() => {
    setScan((s) => ({ rows: s.rows, loading: true }));
    api("/api/admin/market/scan")
      .then((d) => setScan({ rows: d.rows, loading: false }))
      .catch(() => setScan((s) => ({ rows: s.rows, loading: false })));
  }, []);

  useEffect(() => {
    if (mode === "none" || symbols.length === 0) {
      setScan({ rows: null, loading: false });
      return;
    }
    runScan();
  }, [mode, symbolKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // quotes: every 5 s while the market is open, every minute otherwise
  useEffect(() => {
    if (mode === "none" || (symbols.length === 0 && !extra)) {
      setQuotes({ quotes: {}, live: false, at: null });
      return undefined;
    }
    let alive = true;
    const pull = () =>
      api(`/api/admin/market/quotes${extra ? `?symbols=${encodeURIComponent(extra)}` : ""}`)
        .then((d) => {
          if (!alive) return;
          setQuotes(d);
          setQuoteError("");
        })
        .catch((e) => {
          if (!alive) return;
          setQuoteError(e.message);
          if (e.code === "not_connected") loadStatus(); // the session ended: show the login button
        });
    pull();
    if (mode !== "kite") return () => (alive = false);
    // while ticks stream, polling only has to bring what the stream lacks (circuit limits)
    const id = setInterval(pull, status.marketHours ? (streaming ? 15000 : 5000) : 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode, symbolKey, extra, streaming, status && status.marketHours]); // eslint-disable-line react-hooks/exhaustive-deps

  // the polled quotes with the newest streamed values laid over them, refreshed once a second.
  // (Price labels read the stream directly and move on every tick.)
  const merged = useMemo(() => {
    const out = { ...quotes.quotes };
    for (const [s, t] of Object.entries(live.slow)) out[s] = { ...(out[s] || {}), ...t };
    return out;
  }, [quotes.quotes, live.slow]);

  const changeList = (next) => {
    setListError("");
    api("/api/admin/market/watchlist", { method: "PUT", body: { symbols: next } })
      .then((d) => setSymbols(d.watchlist))
      .catch((e) => setListError(e.message));
  };

  if (error && !status) {
    return (
      <div className="an-card">
        <Alert>{error}</Alert>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={loadStatus}>
          Try again
        </button>
      </div>
    );
  }
  if (!status) return <Loading label="Loading the analyzer…" />;

  const feed = streaming
    ? "prices streaming live from Zerodha, tick by tick"
    : live.state === "connecting" || live.state === "down"
      ? "connecting to the live stream — polling every 5 seconds meanwhile"
      : `prices polled every ${status.marketHours ? "5 seconds" : "minute"}${live.reason ? ` (${live.reason})` : ""}`;

  return (
    <TickContext.Provider value={live.store}>
    <div className={`an ${mode === "demo" ? "an--demo" : ""}`}>
      <ConnectPanel status={status} flash={flash.current || null} onStatus={applyStatus} startOpen={mode === "none" && !status.kite.configured} />
      {mode === "kite" && <MarketStrip status={status} />}

      {mode !== "none" && (
        <div className="an__desk">
          <SymbolSearch
            id="desk-q"
            label="Analyze any stock"
            placeholder={mode === "demo" ? "Analyze a demo series — type DEMO" : "Analyze any NSE stock — type a name or symbol, then Enter"}
            onPick={pick}
          />
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm an__theme" onClick={toggleTheme} aria-pressed={theme === "dark"}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          <p className="an__live" role="status">
            {mode === "kite" ? (
              <>
                <i className={streaming ? "is-on" : ""} aria-hidden="true" />
                {status.marketHours ? "Market hours" : "Market closed"} · {feed}
                {!streaming && quotes.at ? ` · last ${clock(quotes.at)}` : ""}
                {quoteError ? ` · ${quoteError}` : ""}
              </>
            ) : (
              <>
                <i aria-hidden="true" /> Demo series · one synthetic bar per weekday · nothing here is a real price
              </>
            )}
          </p>
        </div>
      )}

      {mode === "none" ? (
        <section className="an-card an-empty">
          <h2>What you get once data is connected</h2>
          <ul>
            <li>
              <b>Desk verdict</b> — for any NSE stock: bullish, bearish or neutral across weekly, daily and intraday trends, with a delivery plan, an
              intraday long/short plan, upper and lower circuit limits, and every support and resistance level in one ladder.
            </li>
            <li>
              <b>Live watchlist</b> — last price, change, and a one-line technical reading for every stock, with flags when a setup triggers.
            </li>
            <li>
              <b>Chart and reading</b> — candles with 20/50/200 EMAs, Bollinger Bands, Supertrend, volume and RSI, plus a transparent −100…+100 score.
            </li>
            <li>
              <b>Seven rule-based setups</b> — trend pullback, 55-day breakout, MACD turn-up, Supertrend, golden cross, RSI-2 dip, squeeze breakout —
              each with its conditions ticked off, a stop-loss and R-multiple levels.
            </li>
            <li>
              <b>Levels</b> — pivots and CPR, support and resistance, 52-week range, ATR, intraday VWAP and opening range.
            </li>
            <li>
              <b>Position sizing</b> — shares to buy from the money you are prepared to lose.
            </li>
            <li>
              <b>Backtests and history</b> — how every setup actually behaved on that stock over ~10 years, costs included.
            </li>
          </ul>
          <p className="adm-small">Use “Explore with demo data” above to see all of it right now with made-up prices.</p>
        </section>
      ) : (
        <div className="an__grid">
          <div>
            <Watchlist symbols={symbols} quotes={merged} scan={scan.rows} selected={selected} onSelect={pick} onChange={changeList} mode={mode} scanning={scan.loading} onRescan={runScan} />
            <Alert>{listError}</Alert>
          </div>
          <div className="an__main">
            {selected ? (
              <ErrorBoundary key={selected} title={selected}>
                <StockView
                  key={selected}
                  symbol={selected}
                  quote={merged[selected]}
                  status={status}
                  streaming={streaming}
                  inWatchlist={symbols.includes(selected)}
                  onAdd={mode === "kite" ? () => changeList([...symbols, selected]) : null}
                />
              </ErrorBoundary>
            ) : (
              <section className="an-card an-empty">
                <h2>Pick a stock to begin</h2>
                <p className="adm-small">Type a name or symbol in the search box above — for example RELIANCE, INFY or HDFCBANK — or add stocks to the watchlist.</p>
              </section>
            )}
          </div>
        </div>
      )}

      <footer className="an__disc">
        <b>For your own study — not investment advice.</b> This tool does arithmetic on market prices; it does not know your finances, upcoming
        results, news or corporate actions, and it is not a SEBI-registered adviser. No method wins every time: trades can and do lose money, and a
        gap can lose more than the planned stop. Check every number against your broker before acting, and decide for yourself.
      </footer>
    </div>
    </TickContext.Provider>
  );
}
