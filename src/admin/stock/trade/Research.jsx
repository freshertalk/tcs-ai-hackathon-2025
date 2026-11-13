// Research: pre-market and post-market preparation for the watchlist.
//
// Each stock gets a data sheet straight from the desk (indicators, levels, setups and their
// backtests, the multi-time-frame verdict, the long-term view, the news check). With an
// Anthropic key the model then writes a note per stock — bias, the levels that matter,
// if-then scenarios for the open, triggers and what would cancel the idea — and a summary
// across the list. It is preparation, not orders.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { inr, isNum, num, pct, when } from "../analyzer/format";
import "./trade.css";

const PHASES = [
  { id: "pre", label: "Pre-market", tip: "Before the open: what to expect today, from yesterday’s close, the overnight world brief and the news." },
  { id: "post", label: "Post-market", tip: "After the close: what today did, and how to prepare for tomorrow’s session." },
];
const STEP = { starting: "starting", "world brief": "reading world markets", news: "checking the news", data: "gathering data", analysis: "writing the note", summary: "writing the summary", done: "done" };

function Sheet({ s }) {
  if (!s) return null;
  const ind = s.indicators || {};
  const pv = s.pivots || {};
  const cell = (k, v) =>
    v === null || v === undefined || v === "" ? null : (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    );
  const pick = (...names) => {
    for (const n of names) if (isNum(ind[n])) return ind[n];
    return null;
  };
  return (
    <dl className="rs-sheet">
      {cell("Last", inr(s.price && s.price.last))}
      {cell("Prev close", inr(s.price && s.price.prevClose))}
      {cell("ATR", isNum(s.atr) ? num(s.atr) : null)}
      {cell("Daily reading", s.reading ? `${s.reading.score ?? ""} ${s.reading.label || ""}`.trim() : null)}
      {cell("RSI (14)", isNum(pick("rsi14", "rsi")) ? num(pick("rsi14", "rsi"), 1) : null)}
      {cell("MACD hist.", isNum(pick("macdHist", "macdHistogram")) ? num(pick("macdHist", "macdHistogram")) : null)}
      {cell("ADX", isNum(pick("adx14", "adx")) ? num(pick("adx14", "adx"), 1) : null)}
      {cell("Stoch %K", isNum(ind.stochK) ? num(ind.stochK, 1) : null)}
      {cell("Bollinger %B", isNum(ind.bbPctB) ? num(ind.bbPctB) : null)}
      {cell("Supertrend", isNum(ind.supertrend) ? `${num(ind.supertrend)} ${ind.supertrendDir > 0 ? "▲" : ind.supertrendDir < 0 ? "▼" : ""}` : null)}
      {cell("Rel. volume", isNum(ind.relVolume) ? `${num(ind.relVolume)}×` : null)}
      {cell("ROC (20)", isNum(ind.roc20) ? pct(ind.roc20, 1) : null)}
      {cell("Pivot", isNum(pv.p) ? num(pv.p) : null)}
      {cell("R1 / S1", isNum(pv.r1) && isNum(pv.s1) ? `${num(pv.r1)} / ${num(pv.s1)}` : null)}
      {cell("52-wk range", s.week52 && isNum(s.week52.low) ? `${num(s.week52.low)} – ${num(s.week52.high)}` : null)}
      {cell("Swing view", s.swing ? `${s.swing.stance}${isNum(s.swing.score) ? ` (${s.swing.score > 0 ? "+" : ""}${s.swing.score})` : ""}` : null)}
      {cell("Long term", s.longTerm ? `${s.longTerm.stance} · ${s.longTerm.checks}` : null)}
      {cell("Intraday", s.intraday ? s.intraday.call : null)}
      {cell("Setups on", s.setups && s.setups.length ? s.setups.filter((x) => x.triggered).map((x) => x.name).join(", ") || "none" : null)}
      {cell("Warnings", s.warnings && s.warnings.length ? s.warnings.join(", ") : null)}
      {cell("Best backtest", s.bestBacktests && s.bestBacktests[0] ? `${s.bestBacktests[0].setup}: ${pct(s.bestBacktests[0].avgPerTradePct)} / trade over ${s.bestBacktests[0].trades}` : null)}
      {cell("News", s.news ? `${s.news.tone} — ${s.news.headline}` : null)}
    </dl>
  );
}

function StockNote({ row, onOpen }) {
  const n = row.note;
  return (
    <article className="an-card rs-stock">
      <header className="rs-stock__head">
        <h3>{row.symbol}</h3>
        {n && <span className={`rs-bias rs-bias--${n.bias}`}>{n.bias}</span>}
        {n && <small>{n.conviction} conviction</small>}
        {onOpen && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpen(row.symbol)} data-tip="Open this stock on the trading desk.">
            Open on desk
          </button>
        )}
      </header>
      {row.error && <p className="adm-alert">{row.error}</p>}
      {n && <p>{n.summary}</p>}
      {n && (
        <div className="rs-sec">
          <h4>Key levels</h4>
          <div className="rs-levels">
            {n.levels.resistances.map((x) => (
              <span key={`r${x}`} className="is-r">
                R {num(x)}
              </span>
            ))}
            {n.levels.pivot && <span className="is-p">Pivot {num(n.levels.pivot)}</span>}
            {n.levels.supports.map((x) => (
              <span key={`s${x}`} className="is-s">
                S {num(x)}
              </span>
            ))}
          </div>
          {n.levels.note && <p className="vd-note">{n.levels.note}</p>}
        </div>
      )}
      {n && n.scenarios.length > 0 && (
        <div className="rs-sec">
          <h4>Scenarios for the session</h4>
          <ul className="rs-scen">
            {n.scenarios.map((x, i) => (
              <li key={i}>
                <b>If</b> {x.if} — <b>then</b> {x.then}
              </li>
            ))}
          </ul>
        </div>
      )}
      {n && (
        <dl className="rs-plan">
          <div>
            <dt>Long trigger</dt>
            <dd>{n.plan.long || "—"}</dd>
          </div>
          <div>
            <dt>Short trigger (intraday)</dt>
            <dd>{n.plan.short || "—"}</dd>
          </div>
          <div>
            <dt>Cancels the idea</dt>
            <dd>{n.plan.invalidation || "—"}</dd>
          </div>
          <div>
            <dt>Stand aside if</dt>
            <dd>{n.plan.standAside || "—"}</dd>
          </div>
        </dl>
      )}
      {n && (
        <details className="rs-sec">
          <summary>
            <b>Trend, momentum, volume, setups, news, risks</b>
          </summary>
          <p>
            <b>Trend.</b> {n.trend}
          </p>
          <p>
            <b>Momentum.</b> {n.momentum}
          </p>
          <p>
            <b>Volume and volatility.</b> {n.volume}
          </p>
          {n.setups.length > 0 && (
            <>
              <h4>Setups to watch</h4>
              <ul>
                {n.setups.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          <p>
            <b>News.</b> {n.news}
          </p>
          {n.risks.length > 0 && (
            <>
              <h4>What argues against it</h4>
              <ul>
                {n.risks.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {n.checklist.length > 0 && (
            <>
              <h4>Check at the open</h4>
              <ul>
                {n.checklist.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      {row.sheet && (
        <details className="rs-sec" open={!n}>
          <summary>
            <b>Data sheet</b>
          </summary>
          <Sheet s={row.sheet} />
        </details>
      )}
    </article>
  );
}

export default function Research({ onOpen = null }) {
  const [st, setSt] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null);
  const [picked, setPicked] = useState(null); // Set of symbols
  const [opts, setOpts] = useState({ news: false, world: false, useAi: true });
  const [report, setReport] = useState(null);
  const [shownId, setShownId] = useState("");
  const polling = useRef(null);

  const load = useCallback(async () => {
    try {
      const s = await api("/api/admin/ai/research");
      setSt(s);
      setPhase((p) => p || s.defaultPhase);
      setPicked((p) => p || new Set(s.watchlist));
      return s;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, []);

  const show = useCallback(async (id) => {
    if (!id) return;
    try {
      setReport(await api(`/api/admin/ai/research/${encodeURIComponent(id)}`));
      setShownId(id);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load().then((s) => s && s.reports[0] && show(s.reports[0].id));
    return () => clearInterval(polling.current);
  }, [load, show]);

  // while a job runs, follow it
  const running = Boolean(st && st.job && !st.job.finishedAt);
  useEffect(() => {
    if (!running) return undefined;
    polling.current = setInterval(async () => {
      const s = await load();
      if (s && s.job && s.job.finishedAt) {
        clearInterval(polling.current);
        if (s.job.reportId) show(s.job.reportId);
        if (s.job.error) setError(s.job.error);
      }
    }, 2000);
    return () => clearInterval(polling.current);
  }, [running, load, show]);

  const run = async () => {
    setError("");
    try {
      const s = await api("/api/admin/ai/research", { method: "POST", body: { phase, symbols: [...picked], news: opts.news, world: opts.world, useAi: opts.useAi } });
      setSt(s);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!st) return error ? <Alert>{error}</Alert> : <Loading label="Loading research…" />;
  const job = st.job;
  const watch = st.watchlist;
  const toggle = (s) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  return (
    <div className="rs">
      <section className="an-card rs-controls">
        <header className="an-card__head">
          <div>
            <h3>Research · pre-market and post-market</h3>
            <p>
              Prepare the next session for your watchlist. Each stock gets a data sheet from the desk — indicators, levels, the seven setups and their backtests on that stock, the weekly/daily/intraday verdict, the long-term view and the news check.
              {st.configured ? " The AI then writes a note per stock and a summary across the list." : " Add an Anthropic API key in the AI settings to have the AI write a note per stock."}
            </p>
          </div>
        </header>
        <div className="sv__ranges" role="group" aria-label="Phase">
          {PHASES.map((p) => (
            <button key={p.id} type="button" aria-pressed={phase === p.id} onClick={() => setPhase(p.id)} data-tip={p.tip}>
              {p.label}
            </button>
          ))}
        </div>
        {watch.length === 0 ? (
          <p className="adm-alert adm-alert--info">Your watchlist is empty. Add stocks on the Trading desk first.</p>
        ) : (
          <div className="rs-picks" role="group" aria-label="Stocks to research">
            {watch.map((s) => (
              <label key={s} className={`rs-pick ${picked && picked.has(s) ? "is-on" : ""}`}>
                <input type="checkbox" checked={Boolean(picked && picked.has(s))} onChange={() => toggle(s)} /> {s}
              </label>
            ))}
          </div>
        )}
        <div className="rs-run">
          <label className="tr-check">
            <input type="checkbox" checked={opts.useAi && st.configured} disabled={!st.configured} onChange={(e) => setOpts((o) => ({ ...o, useAi: e.target.checked }))} /> AI notes
          </label>
          <label className="tr-check" data-tip="A web search on each company first: results, orders, rating changes, what is scheduled. Slower, and it uses more tokens.">
            <input type="checkbox" checked={opts.news} disabled={!st.configured || !opts.useAi} onChange={(e) => setOpts((o) => ({ ...o, news: e.target.checked }))} /> Check company news
          </label>
          <label className="tr-check" data-tip="Gather a fresh world-markets brief first (US close, Asia, GIFT Nifty, crude, the rupee, events).">
            <input type="checkbox" checked={opts.world} disabled={!st.configured || !opts.useAi} onChange={(e) => setOpts((o) => ({ ...o, world: e.target.checked }))} /> Refresh world brief
          </label>
          <button type="button" className="adm-btn adm-btn--solid" disabled={running || !picked || picked.size === 0} onClick={run} data-tip="Run the research now. With AI notes on it uses your Anthropic API tokens — about one request per stock, plus one for the summary.">
            {running ? "Researching…" : `Research ${picked ? picked.size : 0} stock${picked && picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
        {running && (
          <div className="rs-progress" role="status">
            <div className="rs-progress__bar">
              <i style={{ width: `${Math.round((job.done / job.symbols.length) * 100)}%` }} />
            </div>
            <small>
              {job.done} of {job.symbols.length}
              {job.current ? ` · ${job.current}: ${STEP[job.step] || job.step}` : job.step ? ` · ${STEP[job.step] || job.step}` : ""}
            </small>
          </div>
        )}
        <Alert>{error}</Alert>
        {st.reports.length > 0 && (
          <label className="tr-field">
            <span>Earlier reports</span>
            <select value={shownId} onChange={(e) => show(e.target.value)}>
              {st.reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {when(r.at)} · {r.phase === "pre" ? "Pre-market" : "Post-market"} · {r.symbols.length} stocks{r.withAi ? "" : " (data only)"}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {report && (
        <>
          {report.summary && (
            <section className="an-card rs-summary">
              <h3>{report.summary.headline}</h3>
              <p className="vd-note">
                {report.phase === "pre" ? "Pre-market" : "Post-market"} · {when(report.at)} · {report.model}
              </p>
              <p>{report.summary.market}</p>
              <div className="rs-cols">
                <div>
                  <h4>Clearest set-ups</h4>
                  <ul>
                    {report.summary.focus.map((x) => (
                      <li key={x.symbol}>
                        <b>{x.symbol}</b> — {x.why}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Leave alone</h4>
                  <ul>
                    {report.summary.avoid.map((x) => (
                      <li key={x.symbol}>
                        <b>{x.symbol}</b> — {x.why}
                      </li>
                    ))}
                    {report.summary.avoid.length === 0 && <li>None named.</li>}
                  </ul>
                </div>
                <div>
                  <h4>First 30 minutes</h4>
                  <ul>
                    {report.summary.checklist.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {report.summary.caveat && <p className="vd-note">{report.summary.caveat}</p>}
            </section>
          )}
          {report.failures && report.failures.length > 0 && <p className="adm-alert">Not everything worked: {report.failures.map((f) => `${f.symbol} (${f.error})`).join("; ")}</p>}
          <div className="rs-stocks">
            {report.stocks.map((r) => (
              <StockNote key={r.symbol} row={r} onOpen={onOpen} />
            ))}
          </div>
          <p className="vd-note">Research is preparation from the data shown, not a recommendation to trade. Notes never imply a probability or a profit; check the levels yourself at the open.</p>
        </>
      )}
    </div>
  );
}
