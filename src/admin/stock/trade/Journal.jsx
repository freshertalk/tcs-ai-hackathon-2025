// The trading journal: every round trip you made, and what the numbers say about how you
// trade — net P&L after estimated charges, win rate, profit factor, expectancy, drawdown,
// streaks; the equity curve and a P&L calendar; where the money is made and lost (stock,
// hour, weekday, side, intraday/delivery, setup, mistake); MAE/MFE per trade; tags and notes;
// and an AI review of it all. Today's fills come in from Zerodha by themselves; history comes
// from a Zerodha Console tradebook CSV.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { useAiStatus } from "../../aiStatus";
import { isNum, num, when } from "../analyzer/format";
import "./trade.css";

const RANGES = [
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];
const IST = 5.5 * 3600 * 1000;
const day = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const time = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const hold = (m) => (!isNum(m) ? "open" : m < 60 ? `${m}m` : m < 60 * 24 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`);

/* ---------------------------------------------------------- equity curve */
function Equity({ curve }) {
  if (curve.length < 2) return <p className="tr-empty">The equity curve appears after two closed trades.</p>;
  const W = 800;
  const H = 180;
  const pad = { l: 78, r: 10, t: 10, b: 22 };
  const axis = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
  const ys = curve.map((p) => p.equity);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const span = hi - lo || 1;
  const x = (i) => pad.l + (i / (curve.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const d = curve.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
  const last = curve[curve.length - 1];
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <svg className="jr-eq" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Equity curve: ${curve.length} trades, ending at ${sMoney(last.equity)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="jr-eq__grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="jr-eq__axis">
            {axis(t)}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="jr-eq__zero" />
      <path d={d} className={`jr-eq__line ${last.equity >= 0 ? "is-up" : "is-down"}`} />
      {curve.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.equity)} r="6" className="jr-eq__hit">
          <title>{`${day(p.at)} ${p.symbol}: ${sMoney(p.net)} → ${sMoney(p.equity)}`}</title>
        </circle>
      ))}
      <text x={pad.l} y={H - 4} className="jr-eq__axis">
        {day(curve[0].at)}
      </text>
      <text x={W - pad.r} y={H - 4} textAnchor="end" className="jr-eq__axis">
        {day(last.at)}
      </text>
    </svg>
  );
}

const TRIP_ROWS = 25;

/* --------------------------------------------------------- P&L calendar */
function Calendar({ days }) {
  const box = useRef(null);
  // on a phone the months are one row to swipe through: it opens on the newest
  useEffect(() => {
    if (box.current) box.current.scrollLeft = box.current.scrollWidth;
  }, [days.length]);
  if (!days.length) return null;
  const byDay = new Map(days.map((d) => [d.key, d]));
  const max = Math.max(...days.map((d) => Math.abs(d.net)), 1);
  // the last six months that have trades
  const months = [...new Set(days.map((d) => d.key.slice(0, 7)))].slice(-6);
  return (
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
                return (
                  <span key={k} className={`jr-cal__d ${d ? (d.net >= 0 ? "is-up" : "is-down") : ""}`} style={d ? { "--a": a } : undefined} title={d ? `${k}: ${sMoney(d.net)} · ${d.trades} trade${d.trades === 1 ? "" : "s"}` : k}>
                    {Number(k.slice(8))}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- breakdowns */
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
            <th scope="col" className="is-num">
              Net
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
function ReviewPanel({ range }) {
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
      const d = await api("/api/admin/trading/journal/review", { method: "POST", body: { range } });
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
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={run} disabled={busy || !st.configured} data-tip="Review the trades in the range shown. It uses your AI company's tokens, and runs only when you press it.">
          {busy ? "Reading your journal…" : "Review this range"}
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
export default function Journal() {
  const [range, setRange] = useState("3m");
  const [kind, setKind] = useState("");
  const [side, setSide] = useState("");
  const [setup, setSetup] = useState("");
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [editing, setEditing] = useState("");
  const [allTrips, setAllTrips] = useState(false); // the list opens on the latest few; the totals above always cover every trade
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    const q = new URLSearchParams({ range, ...(kind ? { kind } : {}), ...(side ? { side } : {}), ...(setup ? { setup } : {}) });
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(`/api/admin/trading/journal?${q}`)
      .then((d) => setState({ loading: false, data: d, error: "" }))
      .catch((e) => setState((s) => ({ loading: false, data: s.data, error: e.message })));
  }, [range, kind, side, setup]);
  useEffect(() => load(), [load]);

  const importCsv = async (file) => {
    if (!file) return;
    setBusy("import");
    setMsg({ kind: "", text: "" });
    try {
      const text = await file.text();
      const res = await fetch("/api/admin/trading/journal/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "text/csv", "X-Requested-With": "vpt", Accept: "application/json" }, body: text });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error((d && d.message) || `Import failed (${res.status}).`);
      setMsg({ kind: "ok", text: `Imported ${d.added} new fill${d.added === 1 ? "" : "s"} of ${d.read} read${d.skipped ? ` · ${d.skipped} row${d.skipped === 1 ? "" : "s"} skipped` : ""}.` });
      load();
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };
  const measure = async () => {
    setBusy("exc");
    setMsg({ kind: "", text: "" });
    try {
      const d = await api("/api/admin/trading/journal/excursions", { method: "POST", body: { limit: 25 } });
      setMsg({ kind: d.failed.length ? "error" : "ok", text: `Measured ${d.done} trade${d.done === 1 ? "" : "s"}.${d.left ? ` ${d.left} still to do — press again.` : ""}${d.failed.length ? ` Not measured: ${d.failed.join("; ")}` : ""}` });
      load();
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
    setBusy("");
  };

  const d = state.data;
  const s = d ? d.stats : null;
  const bySym = useMemo(() => (s ? [...s.by.symbol.slice(0, 8), ...s.by.symbol.slice(-4).filter((x) => !s.by.symbol.slice(0, 8).includes(x))] : []), [s]);

  return (
    <div className="jr">
      <section className="an-card jr-head">
        <header className="an-card__head">
          <div>
            <h3>Trading journal</h3>
            <p>
              Every round trip you made, flat to flat, with estimated charges. Today’s fills come in from Zerodha by themselves; for history, import a tradebook from Zerodha Console (Reports → Tradebook → download CSV), as many date ranges as you like — repeats are ignored.
            </p>
          </div>
          <span className="jr-head__act">
            <label className="adm-btn adm-btn--ghost adm-btn--sm jr-file" data-tip="Import a tradebook CSV downloaded from Zerodha Console. Trades already in the journal are skipped.">
              {busy === "import" ? "Importing…" : "Import Console CSV"}
              <input type="file" accept=".csv,text/csv" onChange={(e) => importCsv(e.target.files && e.target.files[0])} disabled={busy === "import"} />
            </label>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={measure} disabled={Boolean(busy)} data-tip="Measure MAE and MFE — how far each trade went against you and in your favour — from 1-minute bars, for up to 25 recent trades (Zerodha keeps about 60 days of them).">
              {busy === "exc" ? "Measuring…" : "Measure MAE / MFE"}
            </button>
          </span>
        </header>
        <div className="jr-filters">
          <div className="sv__ranges" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
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
        <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
        <Alert>{state.error}</Alert>
      </section>

      {state.loading && !d && <Loading label="Reading your journal…" />}
      {d && d.fills === 0 && <p className="adm-alert adm-alert--info">The journal is empty. Trades you make from now on are added by themselves while Zerodha is connected; import a Console tradebook for your history.</p>}

      {s && s.trades > 0 && (
        <>
          <dl className="tr-tiles jr-tiles">
            <div className={tone(s.net)} data-tip="Profit after estimated charges on closed round trips in this range.">
              <dt>Net P&amp;L</dt>
              <dd>{sMoney(s.net)}</dd>
              <small>
                gross {sMoney(s.gross)} · charges {sMoney(-s.charges)}
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
            <div className="is-down" data-tip="The largest fall of the equity curve from a high, in this range.">
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
          </dl>

          <div className="jr-two">
            <section className="an-card">
              <h3 className="jr-h">Equity curve</h3>
              <Equity curve={s.curve} />
            </section>
            <section className="an-card">
              <h3 className="jr-h">P&amp;L calendar</h3>
              <Calendar days={s.calendar} />
            </section>
          </div>

          <section className="an-card jr-bdcard">
            <h3 className="jr-h">Where the money is made and lost</h3>
            <p className="vd-note">Groups with fewer than 8 trades are greyed: too few to trust.</p>
            <div className="jr-bds">
              <Breakdown title="By stock" rows={bySym} tip="Net after charges per stock: best first, the worst at the end." />
              <Breakdown title="By hour of entry" rows={s.by.hour} tip="When you enter, and how it has turned out." />
              <Breakdown title="By weekday" rows={s.by.weekday} tip="Day of the week of the entry." />
              <Breakdown title="Long or short" rows={s.by.side} />
              <Breakdown title="Intraday or delivery" rows={s.by.kind} />
              <Breakdown title="By setup" rows={s.by.setup} tip="The setup tag you put on trades." />
              <Breakdown title="Cost of mistakes" rows={s.by.mistake} tip="Net of the trades carrying each mistake tag, worst first." />
            </div>
          </section>
        </>
      )}

      {d && d.trips.length > 0 && (
        <section className="an-card jr-tripcard">
          <h3 className="jr-h">Round trips ({d.trips.length}{d.trips.length === 500 ? ", newest 500" : ""})</h3>
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
                  <th scope="col" className="is-num">
                    Net
                  </th>
                  <th scope="col" className="is-num" data-tip="MAE: how far the trade went against you. MFE: how far it went your way. Captured: the share of that best move you kept.">
                    MAE / MFE
                  </th>
                  <th scope="col">Tags</th>
                </tr>
              </thead>
              <tbody>
                {(allTrips ? d.trips : d.trips.slice(0, TRIP_ROWS)).map((t) => (
                  <React.Fragment key={t.key}>
                    <tr className={t.open ? "is-closed" : ""}>
                      <td>
                        {day(t.entryAt)} <small>{time(t.entryAt)}</small>
                      </td>
                      <th scope="row">
                        {t.symbol} <small>{t.intraday ? "intraday" : t.open ? "open" : "delivery"}</small>
                      </th>
                      <td>
                        <span className={`tr-side-tag tr-side-tag--${t.side === "long" ? "buy" : "sell"}`}>{t.side}</span>
                      </td>
                      <td className="is-num">{t.maxQty}</td>
                      <td className="is-num">
                        {num(t.entryAvg)} → {t.exitAvg === null ? "—" : num(t.exitAvg)}
                      </td>
                      <td className="is-num">{hold(t.holdMin)}</td>
                      <td className={`is-num ${tone(t.net)}`} title={`gross ${sMoney(t.pnl)} · charges ${sMoney(-t.charges)}`}>
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
                          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEditing(editing === t.key ? "" : t.key)} data-tip="Tag the setup, any mistakes, a note and how well you executed. The breakdowns and the AI review use them.">
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
          {d.trips.length > TRIP_ROWS && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm jr-more" onClick={() => setAllTrips((a) => !a)}>
              {allTrips ? `Show only the latest ${TRIP_ROWS}` : `Show all ${d.trips.length} round trips`}
            </button>
          )}
          <p className="vd-note">Charges are estimated from Zerodha’s published equity rates (brokerage, STT, exchange and SEBI fees, GST, stamp duty, DP charge); your contract note is the truth. F&amp;O charges are not estimated.</p>
        </section>
      )}

      <ReviewPanel range={range} />
    </div>
  );
}
