// Paper trading: the desk’s own live call followed with play money — in today’s market, over past
// sessions, and in an auto mode that does both by itself. Never real money: there is no Buy or
// Sell here and no order can be sent from it. It is a separate system — it does not read or change
// the real trading switch, and real Buy and Sell on the desk work exactly as they always have.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { inr, isNum, num, when } from "../analyzer/format";
import { useDialog } from "../../dialog/DialogProvider";
import "./paper.css";

const rText = (r) => (isNum(r) ? `${r > 0 ? "+" : ""}${num(r, 2)}R` : "—");
const rs = (x) => (isNum(x) ? `${x < 0 ? "−" : x > 0 ? "+" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
const tone = (x) => (isNum(x) ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
const WHY = { target: "Target", stop: "Stop", "square-off": "3:15 square-off", flip: "Opposite call", open: "Open" };

function Tiles({ items }) {
  return (
    <dl className="pp-tiles">
      {items.map(([k, v, cls, tip]) => (
        <div key={k} data-tip={tip}>
          <dt>{k}</dt>
          <dd className={cls || ""}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function sumTiles(s) {
  return [
    ["Trades", s.trades],
    ["Won", s.finished ? `${s.winPct}%` : "—", "", "Share of finished paper trades that ended above zero after costs."],
    ["Net", rs(s.pnl), tone(s.pnl), "Paper rupees after the assumed costs."],
    ["Net R", rText(s.netR), tone(s.netR), "The same result in multiples of the risk taken per trade."],
    ["Avg / trade", rText(s.avgR), tone(s.avgR)],
    ["Profit factor", isNum(s.profitFactor) ? num(s.profitFactor, 2) : "—", "", "Paper rupees won ÷ paper rupees lost. Above 1 made money."],
    ["Deepest dip", rs(s.deepestDip), tone(s.deepestDip), "The largest fall of the running paper total from an earlier high."],
  ];
}

function TradeTable({ rows, showDate = false }) {
  if (!rows || rows.length === 0) return <p className="vd-note">No paper trades yet.</p>;
  return (
    <div className="bt__scroll">
      <table className="an-table bt__table pp-table">
        <thead>
          <tr>
            {showDate && <th scope="col">Date</th>}
            <th scope="col">Stock</th>
            <th scope="col">Side</th>
            <th scope="col">In</th>
            <th scope="col" className="is-num">Entry</th>
            <th scope="col" className="is-num">Stop</th>
            <th scope="col" className="is-num">Target</th>
            <th scope="col" className="is-num">Qty</th>
            <th scope="col">Out</th>
            <th scope="col" className="is-num">Exit</th>
            <th scope="col">Why</th>
            <th scope="col" className="is-num">R</th>
            <th scope="col" className="is-num">₹ (paper)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={`${t.symbol}-${t.date}-${t.at}-${i}`}>
              {showDate && <td>{t.date}</td>}
              <th scope="row">{t.symbol}</th>
              <td className={t.side === "long" ? "is-up" : "is-down"}>{t.side === "long" ? "Long" : "Short"}</td>
              <td>{t.at}</td>
              <td className="is-num">{inr(t.entry)}</td>
              <td className="is-num">{inr(t.stop)}</td>
              <td className="is-num">{t.target ? inr(t.target) : "—"}</td>
              <td className="is-num">{num(t.qty, 0)}</td>
              <td>{t.exitAt || "—"}</td>
              <td className="is-num">{t.exit ? inr(t.exit) : "—"}</td>
              <td>{WHY[t.why] || t.why}</td>
              <td className={`is-num ${tone(t.netR)}`}>{rText(t.netR)}</td>
              <td className={`is-num ${tone(t.pnl)}`}>{t.why === "open" ? `${rs(t.pnl)} open` : rs(t.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One bar per session: the paper result of every call that day. */
function DayBars({ days }) {
  if (!days || days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => Math.abs(d.netR || 0)));
  let run = 0;
  return (
    <div className="pp-days" role="img" aria-label="Paper result per session">
      {days.map((d) => {
        run += d.netR || 0;
        const h = Math.round((Math.abs(d.netR || 0) / max) * 100);
        return (
          <span key={d.date} className={`pp-day ${d.netR >= 0 ? "is-up" : "is-down"}`} data-tip={`${d.date}: ${d.trades} trades, ${rText(d.netR)}, ${rs(d.pnl)} · running ${rText(Math.round(run * 100) / 100)}`}>
            <i style={{ height: `${Math.max(3, h)}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export default function Paper() {
  const ask = useDialog();
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState(null);

  const load = useCallback(
    () =>
      api("/api/admin/paper")
        .then((d) => {
          setS(d);
          setErr("");
          setForm((f) => f || { capital: d.settings.capital, riskPct: d.settings.riskPct, costPct: d.settings.costPct, sessions: d.settings.sessions, symbols: d.customSymbols ? d.symbols.join(", ") : "" });
        })
        .catch((e) => setErr(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  // follow a run in progress quickly; otherwise every 30 seconds (live paper trades update every five minutes)
  const running = Boolean(s && s.job && s.job.running);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState !== "hidden" && load(), running ? 1500 : 30000);
    return () => clearInterval(id);
  }, [load, running]);

  const act = async (what, path, opts, ok) => {
    setBusy(what);
    setMsg({ kind: "", text: "" });
    try {
      const d = await api(path, opts);
      setS(d);
      if (ok) setMsg({ kind: "ok", text: typeof ok === "function" ? ok(d) : ok });
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };

  if (!s && !err) return <Loading label="Loading paper trading…" />;
  if (!s) return <Alert>{err}</Alert>;

  const save = (e) => {
    e.preventDefault();
    act("save", "/api/admin/paper/settings", { method: "PUT", body: { ...form, symbols: form.symbols } }, "Saved. The next paper trades use these settings.");
  };
  const t = s.tested;

  return (
    <div className="pp">
      <section className="an-card pp-head">
        <header className="an-card__head">
          <div>
            <h3>
              Paper trading <span className="pp-badge">Play money only</span>
            </h3>
            <p>
              The desk’s own live call, followed with paper money: a fresh <b>Long / Short — in play</b> call at a 5-minute close is entered at that close, with the call’s stop and first target,
              and closed on the opposite call or at the 3:15 PM square-off — the same engine and rules as the Desk and the Debrief. <b>No order is ever sent.</b>
            </p>
          </div>
          <label className={`pp-switch ${s.auto ? "is-on" : ""}`} data-tip="Auto mode: paper-trades today’s market every five minutes while it is open, and after the close tests the setup on past sessions — by itself. It never places an order and has no effect on real trading.">
            <input type="checkbox" checked={s.auto} disabled={Boolean(busy)} onChange={(e) => act("auto", "/api/admin/paper/auto", { method: "PUT", body: { on: e.target.checked } }, (d) => (d.auto ? "Auto mode ON: paper trades in market hours, a history test after each close." : "Auto mode OFF."))} />
            <span>Auto mode {s.auto ? "ON" : "OFF"}</span>
          </label>
        </header>
        <div className="pp-flags">
          <span className="pp-flag is-safe" data-tip="Paper trading is separate from real trading: no order can be sent from here, and the real trading switch is not read or changed.">No real orders · separate from real trading</span>
          <span className="pp-flag">Setup {s.setup}</span>
          <span className={`pp-flag ${s.connected ? "" : "is-warn"}`}>{s.connected ? "Zerodha connected" : "Zerodha not connected — paper trading needs its prices"}</span>
          {s.autoSince && s.auto && <span className="pp-flag">On since {when(s.autoSince)}</span>}
        </div>
        <Tiles
          items={[
            ["Paper trades on this setup", num(t.total, 0), "", "Every paper trade counted for the setup running now (engine rules and cost). A change to either starts a new count."],
            ["Live market", t.live.trades, "", "Paper trades taken in the live market."],
            ["Live net", rs(t.live.pnl), tone(t.live.pnl)],
            ["On history", t.history.trades, "", "Paper trades from past sessions replayed through the same engine."],
            ["History net R", rText(t.history.netR), tone(t.history.netR)],
            ["All · won", t.all.finished ? `${t.all.winPct}%` : "—"],
            ["All · avg", rText(t.all.avgR), tone(t.all.avgR)],
          ]}
        />
        <div className="pp-actions">
          <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy) || !s.connected} onClick={() => act("live", "/api/admin/paper/live", { method: "POST" }, (d) => `Today: ${d.today.trades.length} paper trade${d.today.trades.length === 1 ? "" : "s"} so far.`)}>
            {busy === "live" ? "Reading today…" : "Paper-trade today now"}
          </button>
          <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy) || running || !s.connected} onClick={() => act("hist", "/api/admin/paper/history", { method: "POST" }, "Testing the setup on history…")}>
            {running ? `Testing ${s.job.symbol || ""} (${s.job.done}/${s.job.total})…` : `Test on the last ${s.settings.sessions} sessions`}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--sm"
            disabled={Boolean(busy)}
            onClick={async () => {
              const yes = await ask({
                tone: "danger",
                title: "Clear the paper record?",
                body: (
                  <>
                    <p>This removes every paper trade — live and on history — and the findings worked out from them.</p>
                    <p>Your paper account settings stay as they are, and real trading is not affected in any way.</p>
                  </>
                ),
                note: "The findings already written into the trading-skills file stay until the next paper test rewrites them.",
                confirmText: "Clear the record",
                cancelText: "Keep it",
              });
              if (yes) act("reset", "/api/admin/paper/reset", { method: "POST" }, "Paper record cleared.");
            }}
          >
            Clear paper record
          </button>
        </div>
        <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
        {s.job && s.job.error && <Alert>{s.job.error}</Alert>}
      </section>

      <div className="pp-grid">
        <section className="an-card">
          <header className="an-card__head">
            <div>
              <h3>Today · live market{s.today.date ? ` · ${s.today.date}` : ""}</h3>
              <p>Updated every five minutes while auto mode is on and the market is open. Open trades are marked to the latest 5-minute close.</p>
            </div>
          </header>
          <Tiles items={sumTiles(s.today.summary)} />
          <TradeTable rows={s.today.trades} />
        </section>

        <form className="an-card pp-set" onSubmit={save}>
          <h3>Paper account</h3>
          <label>
            <span>Paper capital (₹)</span>
            <input type="number" min="10000" step="1000" value={form.capital} onChange={(e) => setForm({ ...form, capital: e.target.value })} />
          </label>
          <label data-tip="How much of the paper capital one trade may lose at its stop. The number of shares follows from it.">
            <span>Risk per trade (%)</span>
            <input type="number" min="0.1" max="5" step="0.1" value={form.riskPct} onChange={(e) => setForm({ ...form, riskPct: e.target.value })} />
          </label>
          <label data-tip="Brokerage, STT, fees, GST and stamp duty on a round trip, as a share of the position. An assumption.">
            <span>Cost per round trip (%)</span>
            <input type="number" min="0" max="1" step="0.01" value={form.costPct} onChange={(e) => setForm({ ...form, costPct: e.target.value })} />
          </label>
          <label>
            <span>Sessions to test on history</span>
            <input type="number" min="5" max="60" step="1" value={form.sessions} onChange={(e) => setForm({ ...form, sessions: e.target.value })} />
          </label>
          <label className="pp-wide" data-tip="Up to 15 NSE symbols, comma-separated. Empty: the first 15 of the watchlist.">
            <span>Stocks (empty = watchlist)</span>
            <input value={form.symbols} onChange={(e) => setForm({ ...form, symbols: e.target.value })} placeholder={s.symbols.join(", ")} spellCheck="false" />
          </label>
          <button className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy)}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <p className="vd-note">Testing: {s.symbols.join(", ") || "no stocks yet"}.</p>
        </form>
      </div>

      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>On history{s.history ? ` · ${s.history.from || "—"} to ${s.history.to || "—"}` : ""}</h3>
            <p>
              {s.history
                ? `Tested ${when(s.history.at)} on ${s.history.symbols.length} stocks × ${s.history.sessions} sessions${s.history.current ? "" : " — an older setup; run it again for the current one"}. Each session is judged only on what was known before it.`
                : "Not run yet. Press “Test on the last sessions”, or switch auto mode on and it runs after every close."}
            </p>
          </div>
        </header>
        {s.history && (
          <>
            <Tiles items={sumTiles(s.history.summary)} />
            <DayBars days={s.history.byDay} />
            {s.history.bySymbol.length > 0 && (
              <div className="bt__scroll">
                <table className="an-table bt__table pp-table">
                  <thead>
                    <tr>
                      <th scope="col">Stock</th>
                      <th scope="col" className="is-num">Sessions</th>
                      <th scope="col" className="is-num">Trades</th>
                      <th scope="col" className="is-num">Won</th>
                      <th scope="col" className="is-num">Net R</th>
                      <th scope="col" className="is-num">₹ (paper)</th>
                      <th scope="col" className="is-num">Profit factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.history.bySymbol.map((r) => (
                      <tr key={r.symbol}>
                        <th scope="row">{r.symbol}</th>
                        <td className="is-num">{r.sessions}</td>
                        <td className="is-num">{r.trades}</td>
                        <td className="is-num">{r.finished ? `${r.winPct}%` : "—"}</td>
                        <td className={`is-num ${tone(r.netR)}`}>{rText(r.netR)}</td>
                        <td className={`is-num ${tone(r.pnl)}`}>{rs(r.pnl)}</td>
                        <td className="is-num">{isNum(r.profitFactor) ? num(r.profitFactor, 2) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.history.failures.length > 0 && <p className="vd-note">Could not test: {s.history.failures.join("; ")}</p>}
            <details className="pp-more">
              <summary>Latest {s.history.trades.length} paper trades on history</summary>
              <TradeTable rows={s.history.trades} showDate />
            </details>
          </>
        )}
      </section>

      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>What the paper trades show</h3>
            <p>
              Every finished paper trade on this setup, split a few fixed ways. A slice counts as a finding only with {s.findings ? s.findings.minTrades : 30}+ trades and a result far enough from
              zero (|t| ≥ {s.findings ? s.findings.minT : 2}) that luck is an unlikely explanation. Findings are written into the <b>trading-skills file</b> — the file every AI answer
              follows — and rewritten after each test, so the desk learns from what was measured.
            </p>
          </div>
        </header>
        {!s.findings ? (
          <p className="vd-note">Nothing yet: run a test on history first.</p>
        ) : (
          <>
            <p className="vd-note">
              {s.findings.total} finished paper trades · {when(s.findings.at)} ·{" "}
              {s.findings.written ? "written to the trading-skills file ✓" : s.findings.error ? `not written: ${s.findings.error}` : "not written"}
            </p>
            {s.findings.findings.length > 0 && (
              <ul className="pp-findings">
                {s.findings.findings.map((f) => (
                  <li key={f.id} className={f.kind === "works" ? "is-up" : "is-down"}>
                    {f.text}
                  </li>
                ))}
              </ul>
            )}
            <div className="bt__scroll">
              <table className="an-table bt__table pp-table">
                <thead>
                  <tr>
                    <th scope="col">Slice</th>
                    <th scope="col" className="is-num">Trades</th>
                    <th scope="col" className="is-num">Won</th>
                    <th scope="col" className="is-num">Avg</th>
                    <th scope="col" className="is-num">t</th>
                    <th scope="col">Reads as</th>
                  </tr>
                </thead>
                <tbody>
                  {s.findings.slices.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">{x.label}</th>
                      <td className="is-num">{x.n}</td>
                      <td className="is-num">{x.n ? `${x.winPct}%` : "—"}</td>
                      <td className={`is-num ${tone(x.avg)}`}>{rText(x.avg)}</td>
                      <td className="is-num">{isNum(x.t) ? num(x.t, 1) : "—"}</td>
                      <td className={x.verdict === "works" ? "is-up" : x.verdict === "loses" ? "is-down" : ""}>{x.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="vd-note">
          Paper results leave out slippage, partial fills and the pressure of real money, so real trading usually does worse. A good paper record is evidence, not a promise.
        </p>
      </section>

      {s.recentLive.length > 0 && (
        <section className="an-card">
          <h3>Earlier live-market paper trades</h3>
          <TradeTable rows={s.recentLive} showDate />
        </section>
      )}

      {s.log.length > 0 && (
        <details className="an-card pp-more">
          <summary>Activity</summary>
          <ul className="pp-log">
            {s.log.map((l) => (
              <li key={l.at + l.text}>
                <time>{when(l.at)}</time> {l.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
