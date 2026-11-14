// The screener: the market board for any NSE index, and every Nifty 500 stock whose RSI is where you ask, right now.
//
// "Right now" means the daily RSI with the live price as the newest bar: each
// stock's last year of daily closes (downloaded once, kept up to date from the
// quotes) plus what it is trading at this moment.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { clock, compact, day, inr, isNum, num, pct, when } from "./format";
import "./analyzer.css";
import MarketBoard from "./MarketBoard";

const CONDITIONS = [
  { id: "about", label: "about (± 2)" },
  { id: "max", label: "at most" },
  { id: "min", label: "at least" },
  { id: "between", label: "between" },
];
const PRESETS = [
  { label: "Oversold ≤ 30", cond: "max", a: "30" },
  { label: "Deeply oversold ≤ 20", cond: "max", a: "20" },
  { label: "Overbought ≥ 70", cond: "min", a: "70" },
  { label: "Very overbought ≥ 80", cond: "min", a: "80" },
  { label: "Mid-range 45 – 55", cond: "between", a: "45", b: "55" },
];
const LIQUIDITY = [
  { v: "0", label: "Any" },
  { v: "1", label: "₹1 crore a day or more" },
  { v: "5", label: "₹5 crore a day or more" },
  { v: "25", label: "₹25 crore a day or more" },
  { v: "100", label: "₹100 crore a day or more" },
];
const SORTS = [
  { id: "rsi", label: "RSI (as found)" },
  { id: "change", label: "Change today" },
  { id: "turnover", label: "Turnover" },
  { id: "symbol", label: "Name" },
];
const clamp = (x) => Math.max(0, Math.min(100, x));

/** The form's condition as the two numbers the server wants, plus words for the result line. */
function rangeOf(cond, a, b) {
  const x = Number(a);
  const y = Number(b);
  if (String(a).trim() === "" || !Number.isFinite(x)) return { error: "Enter an RSI value (0 to 100)." };
  if (x < 0 || x > 100) return { error: "RSI runs from 0 to 100." };
  if (cond === "max") return { max: x, words: `at or below ${x}` };
  if (cond === "min") return { min: x, words: `at or above ${x}` };
  if (cond === "between") {
    if (String(b).trim() === "" || !Number.isFinite(y) || y < 0 || y > 100) return { error: "Enter the second RSI value (0 to 100)." };
    return { min: Math.min(x, y), max: Math.max(x, y), words: `between ${Math.min(x, y)} and ${Math.max(x, y)}` };
  }
  return { min: clamp(x - 2), max: clamp(x + 2), words: `about ${x} (${clamp(x - 2)} to ${clamp(x + 2)})` };
}

function Progress({ job }) {
  const share = job.total ? Math.round((job.done / job.total) * 100) : 0;
  const eta = job.etaSeconds >= 90 ? `about ${Math.round(job.etaSeconds / 60)} minutes left` : job.etaSeconds > 0 ? `about ${job.etaSeconds} seconds left` : "starting…";
  return (
    <div className="scr__progress" role="status">
      <div className="vd-meter" aria-hidden="true">
        <span style={{ width: `${share}%` }} />
      </div>
      <p className="adm-small">
        Downloading daily history: {num(job.done, 0)} of {num(job.total, 0)} stocks ({share}%) — {eta}. It runs on the server; you can leave this page.
      </p>
    </div>
  );
}

export default function Screener({ onOpen }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [cond, setCond] = useState("about");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [period, setPeriod] = useState("14");
  const [liquid, setLiquid] = useState("5");
  const [funds, setFunds] = useState(false);
  const [sort, setSort] = useState("rsi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const loadStatus = useCallback(
    () =>
      api("/api/admin/market/screener/status")
        .then((d) => {
          setStatus(d);
          setStatusError("");
        })
        .catch((e) => setStatusError(e.message)),
    []
  );
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  // while the download runs, follow it
  const running = Boolean(status && status.job.running);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(loadStatus, 2000);
    return () => clearInterval(id);
  }, [running, loadStatus]);

  const act = (path, body) => {
    setStatusError("");
    api(path, { method: "POST", body: body || {} })
      .then(setStatus)
      .catch((e) => setStatusError(e.message));
  };

  const search = (over) => {
    const c = over ? over.cond : cond;
    const r = rangeOf(c, over ? over.a : a, over ? over.b || "" : b);
    if (r.error) {
      setError(r.error);
      return;
    }
    setBusy(true);
    setError("");
    const q = new URLSearchParams();
    if (r.min !== undefined) q.set("min", String(r.min));
    if (r.max !== undefined) q.set("max", String(r.max));
    q.set("period", period);
    q.set("minTurnover", liquid);
    if (funds) q.set("funds", "1");
    api(`/api/admin/market/screener/rsi?${q}`)
      .then((d) => {
        setResult({ ...d, words: r.words });
        if (d.status) setStatus((s) => ({ ...(s || {}), ...d.status }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const preset = (p) => {
    setCond(p.cond);
    setA(p.a);
    setB(p.b || "");
    search(p);
  };

  const rows = result && result.rows ? [...result.rows] : [];
  if (sort === "change") rows.sort((x, y) => (y.changePct ?? -1e9) - (x.changePct ?? -1e9));
  if (sort === "turnover") rows.sort((x, y) => (y.avgTurnoverCr ?? 0) - (x.avgTurnoverCr ?? 0));
  if (sort === "symbol") rows.sort((x, y) => x.symbol.localeCompare(y.symbol));

  return (
    <div className="scr">
      <MarketBoard onOpen={onOpen} />
      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>RSI search · NIFTY 500</h3>
            <p>
              Type an RSI value and search: the list is every Nifty 500 stock whose RSI is there <b>right now</b> — the daily RSI, with each stock’s live price as the newest bar. Select a
              stock to open it on the trading desk.
            </p>
          </div>
        </header>

        {!status && !statusError && <Loading label="Checking the stock list…" />}
        <Alert>{statusError}</Alert>

        {status && (
          <div className={`scr__status ${status.ready ? "is-ready" : ""}`}>
            {!status.connected && <p className="adm-alert adm-alert--info">Connect Zerodha on the Trading desk first — the stock list and every price come from it.</p>}
            {status.job.error && <p className="adm-alert adm-alert--error">{status.job.error}</p>}
            {running ? (
              <>
                <Progress job={status.job} />
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => act("/api/admin/market/screener/stop")}>
                  Stop
                </button>
              </>
            ) : status.ready ? (
              <p className="scr__have">
                <span>
                  <b>{num(status.symbols - status.funds, 0)} stocks</b>
                  {status.scope && status.scope.index ? ` · RSI search over the ${status.scope.index} (list from ${status.scope.source === "NSE" ? `NSE, ${day(status.scope.fetchedAt)}` : `a copy of ${day(status.scope.asOf)}`})` : ""} · daily closes to {day(status.through)} · {status.syncedAt ? `downloaded ${when(status.syncedAt)}` : "download not finished"}
                </span>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => act("/api/admin/market/screener/sync", { force: true })} disabled={!status.connected}>
                  Download again
                </button>
                {!status.syncedAt && (
                  <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => act("/api/admin/market/screener/sync")} disabled={!status.connected}>
                    Carry on downloading
                  </button>
                )}
              </p>
            ) : (
              <div className="scr__first">
                <p>
                  <b>One-time setup.</b> To know each stock’s RSI, the server first downloads about a year of daily prices for the Nifty 500 and every index on the board (about 500
                  stocks). Zerodha allows three requests a second, so this takes <b>about three minutes</b>, once — you can leave the page. After that the list keeps itself up to date and a search takes a few seconds.
                </p>
                <button type="button" className="adm-btn adm-btn--solid" onClick={() => act("/api/admin/market/screener/sync")} disabled={!status.connected}>
                  Download the Nifty 500
                </button>
              </div>
            )}
          </div>
        )}

        <form
          className="scr__form"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <div className="scr__field">
            <label htmlFor="scr-cond">RSI is</label>
            <select id="scr-cond" value={cond} onChange={(e) => setCond(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="scr__field scr__field--num">
            <label htmlFor="scr-a">{cond === "between" ? "From" : "RSI value"}</label>
            <input id="scr-a" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} placeholder="e.g. 30" autoComplete="off" />
          </div>
          {cond === "between" && (
            <div className="scr__field scr__field--num">
              <label htmlFor="scr-b">To</label>
              <input id="scr-b" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="e.g. 40" autoComplete="off" />
            </div>
          )}
          <div className="scr__field">
            <label htmlFor="scr-period">Period</label>
            <select id="scr-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="14">14 days (standard)</option>
              <option value="7">7 days (faster)</option>
              <option value="21">21 days (slower)</option>
              <option value="2">2 days (very short)</option>
            </select>
          </div>
          <div className="scr__field">
            <label htmlFor="scr-liq">Traded value</label>
            <select id="scr-liq" value={liquid} onChange={(e) => setLiquid(e.target.value)}>
              {LIQUIDITY.map((l) => (
                <option key={l.v} value={l.v}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <label className="scr__check">
            <input type="checkbox" checked={funds} onChange={(e) => setFunds(e.target.checked)} /> Include ETFs and liquid funds
          </label>
          <button className="adm-btn adm-btn--solid" disabled={busy || !status || !status.ready}>
            {busy ? "Searching the Nifty 500…" : "Search"}
          </button>
        </form>
        <div className="scr__presets" role="group" aria-label="Common searches">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => preset(p)} disabled={busy || !status || !status.ready}>
              {p.label}
            </button>
          ))}
        </div>
        <Alert>{error}</Alert>
      </section>

      {busy && !result && <Loading label="Fetching live prices for the Nifty 500 and working out each RSI…" />}

      {result && result.ready === false && <p className="adm-alert adm-alert--info">The stock list has not been downloaded yet — use the button above first.</p>}

      {result && result.ready && (
        <section className="an-card">
          <header className="an-card__head">
            <div>
              <h3>
                {num(result.matched, 0)} of {num(result.considered, 0)} with RSI({result.period}) {result.words}
              </h3>
              <p>
                As of {clock(result.at)} — {result.live ? "today’s live prices" : `prices at the close of ${day(result.session)}`}.
                {result.skipped.noQuote + result.skipped.outOfDate + result.skipped.tooShort > 0 &&
                  ` Left out: ${[
                    result.skipped.noQuote ? `${result.skipped.noQuote} with no quote` : "",
                    result.skipped.outOfDate ? `${result.skipped.outOfDate} whose history no longer matches the exchange (being downloaded again)` : "",
                    result.skipped.tooShort ? `${result.skipped.tooShort} listed too recently` : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}.`}
                {result.truncated ? " Showing the first 600." : ""}
              </p>
            </div>
            <label className="bt__cost">
              Order by
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </header>

          {rows.length === 0 ? (
            <p className="vd-note">No stock matches right now. Widen the range, lower the traded-value filter, or try another period.</p>
          ) : (
            <div className="bt__scroll scr__scroll">
              <table className="an-table scr__table">
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    <th scope="col">Price</th>
                    <th scope="col">Today</th>
                    <th scope="col">RSI now</th>
                    <th scope="col">RSI at last close</th>
                    <th scope="col">Volume today</th>
                    <th scope="col">Avg traded value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const turn = isNum(r.rsiPrev) ? r.rsi - r.rsiPrev : null;
                    return (
                      <tr key={r.symbol}>
                        <th scope="row">
                          <button type="button" className="bt__pick" onClick={() => onOpen(r.symbol)} title="Open on the trading desk">
                            {r.symbol}
                          </button>
                          <small>
                            {r.name}
                            {r.fund ? " · fund" : ""}
                          </small>
                        </th>
                        <td>{inr(r.last)}</td>
                        <td className={`is-${!isNum(r.changePct) || r.changePct === 0 ? "flat" : r.changePct > 0 ? "up" : "down"}`}>{pct(r.changePct)}</td>
                        <td>
                          <b className={r.rsi >= 70 ? "is-down" : r.rsi <= 30 ? "is-up" : ""}>{num(r.rsi, 1)}</b>
                        </td>
                        <td>
                          {isNum(r.rsiPrev) ? num(r.rsiPrev, 1) : "—"}
                          {isNum(turn) && Math.abs(turn) >= 0.1 && (
                            <small className={turn > 0 ? "is-up" : "is-down"}>
                              {turn > 0 ? "▲ rising" : "▼ falling"} {num(Math.abs(turn), 1)}
                            </small>
                          )}
                        </td>
                        <td>{compact(r.volume)}</td>
                        <td>{isNum(r.avgTurnoverCr) ? `₹${num(r.avgTurnoverCr, r.avgTurnoverCr < 10 ? 1 : 0)} Cr` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="adm-small">
            RSI below 30 is called oversold and above 70 overbought — a description of how far price has run, not a signal that it will turn. A stock can stay overbought through a long
            rally and oversold through a long fall. Open a stock on the desk for its full reading before acting on a number here. Not investment advice.
          </p>
        </section>
      )}

      <section className="an-card scr__about">
        <h3>What this RSI is — and is not</h3>
        <ul className="ai-list">
          <li>
            <b>Daily RSI, live.</b> Wilder’s RSI on daily closes, with the price at this moment standing in for today’s close. It moves through the day as the price does.
          </li>
          <li>
            <b>The Nifty 500 and NSE’s indices.</b> The RSI search covers the Nifty 500; the board above shows any index NSE publishes a list for (NIFTY 50, BANK, FINANCIAL SERVICES, MIDCAP SELECT, NEXT 50, the broad and the sector indices). Each list is re-read from NSE’s own file once a week, so the screener follows index changes.
          </li>
          <li>
            <b>Not the 5-minute RSI.</b> An intraday RSI for the whole exchange would need intraday bars for every stock at once, which Zerodha’s API cannot supply at this speed. The
            trading desk shows the 5-minute RSI for the one stock you have open.
          </li>
          <li>
            <b>Kept honest.</b> A stock whose stored history no longer matches the exchange — after a split or a bonus — is left out of the results and downloaded again, rather than
            shown with a wrong number.
          </li>
        </ul>
      </section>
    </div>
  );
}
