// The Research tab's Top 10 and the live RSI watch.
//
// Top 10: the stocks to trade in this session (or the next), ranked by the server by itself — before the
// open, every five minutes in the session and after the close (server/picks.js) — from each stock's daily
// history, its live quote, the desk's engines, the NSE forecast from the world, the tide, its sector and
// the news; reviewed by the AI Engine on need; and scored on its session, so the list has a record.
//
// RSI watch: every NIFTY 500 stock at a 14-day RSI of 15 or less, or 80 or more, trading ₹100 crore a
// day or more — the Screener's RSI search, run by itself and kept live.

import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { adminPath } from "../../paths";
import { inr, isNum, pct, when } from "../analyzer/format";
import { KnowledgeChecks } from "../engine/KnowledgeChecks";
import { everyVisible } from "../../visible";
import { Flash, liveRow, useLivePrices } from "../../live/prices";

const SIDE = { long: { word: "LONG", icon: "▲", cls: "is-up" }, short: { word: "SHORT", icon: "▼", cls: "is-down" } };
const PHASE = { pre: "Before the open", live: "In the session", post: "After the close" };
const dayLong = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "");
const tone = (x) => (isNum(x) ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
const marketHours = () => {
  const d = new Date(Date.now() + 5.5 * 3600000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const w = d.getUTCDay();
  return w >= 1 && w <= 5 && m >= 8 * 60 + 30 && m <= 15 * 60 + 50;
};
const DATA = [
  ["atrPct", "Daily range (ATR)", (x) => `${x}%`],
  ["ret5", "5 sessions", (x) => pct(x)],
  ["ret20", "20 sessions", (x) => pct(x)],
  ["ret60", "60 sessions", (x) => pct(x)],
  ["rsi14", "RSI (14 days)", (x) => x],
  ["vsEma20", "From the 20-day avg", (x) => pct(x)],
  ["vsEma50", "From the 50-day avg", (x) => pct(x)],
  ["vsEma200", "From the 200-day avg", (x) => pct(x)],
  ["relVol", "Last volume vs usual", (x) => `${x}×`],
  ["toHi20Pct", "To the 20-day high", (x) => pct(x)],
  ["toLo20Pct", "Above the 20-day low", (x) => pct(x)],
  ["fromHi52Pct", "From the 52-week high", (x) => pct(x)],
  ["turnoverCr", "Traded a day (20-day avg)", (x) => `₹${Math.round(x).toLocaleString("en-IN")} cr`],
  ["vsVwapPct", "From VWAP", (x) => pct(x)],
  ["rangePos", "Place in today's range", (x) => `${Math.round(x * 100)}%`],
  ["relVolNow", "Volume so far vs usual", (x) => `${x}×`],
  ["gapPct", "Today's gap", (x) => pct(x)],
  ["buyersPct", "Buyers in the quote", (x) => `${x}%`],
];

function Move({ m }) {
  if (m === undefined) return <span className="t10-move">·</span>;
  if (m === null) return <span className="t10-move is-new">NEW</span>;
  if (m === 0) return <span className="t10-move">=</span>;
  return <span className={`t10-move ${m > 0 ? "is-up" : "is-down"}`}>{m > 0 ? `▲${m}` : `▼${-m}`}</span>;
}

const PLAN_STATUS = { waiting: "waiting for the entry", triggered: "entry passed", target: "target already reached", stop: "below the stop" };
function planText(p) {
  if (!p) return "—";
  if ((p.kind === "long" || p.kind === "short") && isNum(p.entry)) return `${p.kind === "long" ? "above" : "below"} ${inr(p.entry)} · stop ${inr(p.stop)} · target ${inr(p.target)}${p.status ? ` — ${p.kind === "short" && p.status === "stop" ? "above the stop" : PLAN_STATUS[p.status]}` : ""}`;
  if (p.kind === "orb") return "opening-range break, either side";
  return "wait for the open";
}

function Row({ x, open, onToggle, onOpen }) {
  const S = SIDE[x.side] || SIDE.long;
  return (
    <>
      <tr className={open ? "is-open" : ""} onClick={onToggle} tabIndex={0} aria-expanded={open} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}>
        <th scope="row">
          <span className="t10-rank">{x.rank}</span> <Move m={x.move} />
        </th>
        <td>
          <b>{x.symbol}</b>
          {x.sector && <small className="t10-sector">{x.sector.replace(/^NIFTY /, "")}</small>}
        </td>
        <td>
          <span className={`t10-side ${S.cls}`}>
            <i aria-hidden="true">{S.icon}</i> {S.word}
          </span>
        </td>
        <td>
          <span className="t10-score" role="img" aria-label={`score ${x.score} of 99`}>
            <i style={{ width: `${x.score}%` }} />
            <em>{x.score}</em>
          </span>
        </td>
        <td className="is-num">
          <Flash value={x.last}>{inr(x.last)}</Flash> <small className={tone(x.changePct)}>{pct(x.changePct)}</small>
        </td>
        <td className="t10-plan">{planText(x.plan)}</td>
        <td className="t10-why">{x.ai && x.ai.thesis ? <span className="t10-ai">AI: {x.ai.thesis}</span> : x.reasons[0]}</td>
      </tr>
      {open && (
        <tr className="t10-detail">
          <td colSpan={7}>
            <div className="t10-detail__grid">
              <div>
                <h5>Why {S.word.toLowerCase()}</h5>
                <ul>
                  {x.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {x.against && x.against.length > 0 && (
                  <>
                    <h5>Against it</h5>
                    <ul className="t10-against">
                      {x.against.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
                {x.ai && (
                  <p className="t10-ainote">
                    <b>The AI{x.ai.carried ? " (earlier review)" : ""}:</b> {x.ai.thesis} {x.ai.risk && <span className="t10-dim">Risk: {x.ai.risk}</span>} <span className="t10-dim">· confidence {x.ai.confidence}</span>
                  </p>
                )}
                <KnowledgeChecks k={x.knowledge} side={x.side} compact />
              </div>
              <div>
                <h5>The data behind it</h5>
                <dl className="t10-data">
                  {DATA.filter(([k]) => isNum(x.data && x.data[k])).map(([k, label, f]) => (
                    <div key={k}>
                      <dt>{label}</dt>
                      <dd>{f(x.data[k])}</dd>
                    </div>
                  ))}
                </dl>
                {x.plan && (
                  <p className="t10-dim">
                    <b>The intraday plan:</b> {planText(x.plan)}
                    {isNum(x.plan.target2) ? `, then ${inr(x.plan.target2)}` : ""}
                    {x.plan.record ? ` — its rule won ${x.plan.record.winRate}% of ${x.plan.record.trades} past sessions` : ""}. {x.plan.why}
                  </p>
                )}
                <p className="t10-dim">
                  Score {x.score} · margin over the other side {x.margin} points{isNum(x.deskRank) && x.deskRank !== x.rank ? ` · the desk ranked it ${x.deskRank}` : ""}.
                </p>
                {onOpen && (
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpen(x.symbol)}>
                    Open {x.symbol} on the desk
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Record({ r, names }) {
  if (!r || !r.sessions) return <p className="t10-dim">The record starts after the first session: every list made before the open, and every list made after the close for the next session, is scored when that session ends — each pick from the open to the close in its direction, against the whole universe.</p>;
  const paid = (r.byReason || []).slice().sort((a, b) => b.avgPct - a.avgPct);
  return (
    <div className="t10-rec">
      <div className="t10-rec__kpis">
        <div>
          <span>Sessions scored</span>
          <b>{r.sessions}</b>
          <small>{r.picks} picks</small>
        </div>
        <div>
          <span>Moved their way</span>
          <b>{r.hitRate}%</b>
          <small>open to close</small>
        </div>
        <div>
          <span>Average move</span>
          <b className={tone(r.avgPct)}>{pct(r.avgPct)}</b>
          <small>in the pick's direction</small>
        </div>
        <div>
          <span>Against the universe</span>
          <b className={tone(r.avgEdgePct)}>{pct(r.avgEdgePct)}</b>
          <small>
            a session · beat it {r.beatUniverse} of {r.sessions}
          </small>
        </div>
        <div>
          <span>Longs · shorts</span>
          <b>
            {r.longs.n ? `${r.longs.hitRate}%` : "—"} · {r.shorts.n ? `${r.shorts.hitRate}%` : "—"}
          </b>
          <small>
            {r.longs.n} longs, {r.shorts.n} shorts
          </small>
        </div>
      </div>
      {paid.length > 0 && (
        <details>
          <summary>Which reasons paid ({paid.length})</summary>
          <table className="t10-mini">
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col" className="is-num">
                  Picks
                </th>
                <th scope="col" className="is-num">
                  Moved their way
                </th>
                <th scope="col" className="is-num">
                  Average
                </th>
              </tr>
            </thead>
            <tbody>
              {paid.map((x) => (
                <tr key={x.tag}>
                  <th scope="row">{(names && names[x.tag]) || x.tag}</th>
                  <td className="is-num">{x.n}</td>
                  <td className="is-num">{x.hitRate}%</td>
                  <td className={`is-num ${tone(x.avgPct)}`}>{pct(x.avgPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export function TopPicks({ onOpen }) {
  const { user } = useAuth() || {};
  const isOwner = Boolean(user && user.role === "superadmin");
  const [v, setV] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api("/api/admin/picks")
      .then((d) => {
        setV(d);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const running = Boolean(v && v.running);
  useEffect(() => {
    const ms = running ? 3000 : marketHours() ? 60000 : 5 * 60000;
    return everyVisible(load, ms, { topics: ["research", "scanner"] });
  }, [running, load]);
  const refresh = async () => {
    setBusy(true);
    try {
      setV(await api("/api/admin/picks/refresh", { method: "POST", body: {} }));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const save = async (patch) => {
    try {
      const s = await api("/api/admin/picks/settings", { method: "PUT", body: patch });
      setV((cur) => (cur ? { ...cur, settings: s } : cur));
    } catch (e) {
      setErr(e.message);
    }
  };
  const s0 = v && v.snap;
  // live: each stock's price and change from the tick stream, between the list's own refreshes
  const { prices } = useLivePrices(s0 && s0.list ? s0.list.map((x) => x.symbol) : []);
  const s = s0 && s0.list ? { ...s0, list: s0.list.map((x) => liveRow(x, prices)) } : s0;
  const c = s ? s.context || {} : {};
  return (
    <section className="an-card t10" aria-label="Top 10 stocks to trade">
      <header className="t10-h">
        <div className="t10-h__t">
          <h3>Top 10 · {s ? (s.phase === "post" ? `for the next session, ${dayLong(s.session)}` : `for today's session`) : "stocks to trade"}</h3>
          <p className="t10-dim">
            {s ? `${PHASE[s.phase]} · made ${s.clock}${s.phase === "live" ? " · re-ranked every 5 minutes" : ""} · ${s.stats.universe} stocks scored (NIFTY 100, your watchlist, the news)` : "Ranked by itself before the open, every five minutes in the session and after the close."}
          </p>
        </div>
        <div className="t10-h__c">
          {isOwner && v && (
            <>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={refresh} disabled={busy || running || !v.connected} data-tip="Rank the stocks now. The AI reviews the list when its key is saved and the mode is on need.">
                {running ? "Ranking…" : "↻ Refresh now"}
              </button>
              <label className="t10-set">
                <span>AI review</span>
                <select value={v.settings.aiMode} onChange={(e) => save({ aiMode: e.target.value })} aria-label="AI review of the Top 10">
                  <option value="need">On need</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </>
          )}
        </div>
      </header>
      {err && <p className="adm-alert">{err}</p>}
      {v && v.progress && (
        <div className="t10-progress" role="status">
          <i style={{ width: `${Math.round(((v.progress.done || 0) / Math.max(1, v.progress.of || 1)) * 100)}%` }} />
          <small>
            {v.progress.step} · {v.progress.done} of {v.progress.of}
          </small>
        </div>
      )}
      {!v ? (
        <p className="t10-dim">Reading the Top 10…</p>
      ) : !s ? (
        <p className="t10-dim">{v.connected ? "No list yet: the first one is made by itself before the open (from 8:35 AM), in the session and after the close — or press Refresh now." : "The Top 10 needs the Zerodha connection: log in to Kite on the Desk."}</p>
      ) : (
        <>
          {v.demo && <p className="adm-alert adm-alert--info">Demo data: the list is ranked from the demo stocks only. Connect Zerodha for the NIFTY 100.</p>}
          {v.stale && <p className="adm-alert adm-alert--info">This list was made {when(s.at)} for {dayLong(s.session)}; a new one is made by itself when the next phase begins.</p>}
          <div className="t10-ctx">
            {c.world && (
              <span className="t10-chip" data-tip={c.world.headline || ""}>
                World leans {c.world.word || (c.world.score > 0 ? "up" : "down")} ({c.world.score > 0 ? "+" : ""}
                {c.world.score})
              </span>
            )}
            {c.nifty && isNum(c.nifty.changePct) && <span className={`t10-chip ${tone(c.nifty.changePct)}`}>NIFTY {pct(c.nifty.changePct)}</span>}
            {c.tide && (
              <span className="t10-chip">
                Tide {c.tide.score > 0 ? "+" : ""}
                {c.tide.score} · {c.tide.label}
              </span>
            )}
            {c.mood && <span className="t10-chip">News {String(c.mood.label).toLowerCase()}</span>}
            <span className="t10-chip">
              {s.list.filter((x) => x.side === "long").length} long · {s.list.filter((x) => x.side === "short").length} short
            </span>
          </div>
          {s.ai && !s.ai.failed && (
            <p className="t10-aibox">
              <b>
                Reviewed by the AI ({s.ai.by}, {s.ai.clock}{s.ai.carried ? ", earlier in the session" : ""}):
              </b>{" "}
              {s.ai.summary} {s.ai.marketView && <span className="t10-dim">{s.ai.marketView}</span>}
              {s.ai.dropped && s.ai.dropped.length > 0 && <span className="t10-dim"> Left off: {s.ai.dropped.map((d) => `${d.symbol} (${d.why})`).join("; ")}.</span>}
            </p>
          )}
          <div className="t10-scroll">
            <table className="t10-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Side</th>
                  <th scope="col">Score</th>
                  <th scope="col" className="is-num">
                    Last
                  </th>
                  <th scope="col">Plan</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {s.list.map((x) => (
                  <Row key={x.symbol} x={x} open={open === x.symbol} onToggle={() => setOpen((o) => (o === x.symbol ? "" : x.symbol))} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
          </div>
          {s.list.length === 0 && <p className="t10-dim">No stock has a clear side right now.</p>}
          <div className="t10-foot">
            {s.onDeck && s.onDeck.length > 0 && (
              <p>
                <b>On deck:</b>{" "}
                {s.onDeck.map((x) => (
                  <span key={x.symbol} className={`t10-chip ${SIDE[x.side] ? SIDE[x.side].cls : ""}`}>
                    {SIDE[x.side] ? SIDE[x.side].icon : ""} {x.symbol} {x.score}
                  </span>
                ))}
              </p>
            )}
            {s.left && s.left.length > 0 && (
              <p>
                <b>Left the list:</b>{" "}
                {s.left.map((x) => (
                  <span key={x.symbol} className="t10-chip is-left">
                    {x.symbol} (was {x.rank})
                  </span>
                ))}
              </p>
            )}
          </div>
          <details className="t10-more">
            <summary>The record of the lists</summary>
            <Record r={v.record} names={v.tagNames} />
          </details>
        </>
      )}
      <p className="t10-dim">A ranking of evidence with its reasons — each reason carries the number behind it. Not advice and not a promise; the decision and the order are yours.</p>
    </section>
  );
}

export function RsiWatch({ onOpen }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    const load = () =>
      api("/api/admin/picks/rsi")
        .then((d) => on && (setR(d), setErr("")))
        .catch((e) => on && setErr(e.message));
    load();
    const id = everyVisible(load, r && r.preparing ? 15000 : marketHours() ? 60000 : 5 * 60000, { topics: ["research", "scanner"] });
    return () => {
      on = false;
      id();
    };
  }, [r && r.preparing]); // eslint-disable-line react-hooks/exhaustive-deps
  const { prices: rsiPrices } = useLivePrices(r && r.available ? [...(r.oversold || []), ...(r.overbought || [])].map((x) => x.symbol) : []);
  const table = (rows, kind) => (
    <div className="rw-col">
      <h4>
        {kind === "low" ? `Oversold · RSI ${r.rule.low} or less` : `Overbought · RSI ${r.rule.high} or more`} <small>({rows.length})</small>
      </h4>
      {rows.length === 0 ? (
        <p className="t10-dim">None right now.</p>
      ) : (
        <div className="t10-scroll">
          <table className="t10-table rw-table">
            <thead>
              <tr>
                <th scope="col">Stock</th>
                <th scope="col" className="is-num">
                  Last
                </th>
                <th scope="col" className="is-num">
                  Today
                </th>
                <th scope="col" className="is-num">
                  RSI
                </th>
                <th scope="col" className="is-num">
                  Traded a day
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.symbol} onClick={() => onOpen && onOpen(x.symbol)} tabIndex={onOpen ? 0 : undefined} title={x.name}>
                  <th scope="row">
                    <b>{x.symbol}</b>
                  </th>
                  <td className="is-num">
                    <Flash value={x.last}>{inr(x.last)}</Flash>
                  </td>
                  <td className={`is-num ${tone(x.changePct)}`}>{pct(x.changePct)}</td>
                  <td className="is-num">
                    <b>{x.rsi}</b> <small>{isNum(x.rsiPrev) ? `from ${x.rsiPrev}` : ""}</small>
                  </td>
                  <td className="is-num">₹{Math.round(x.avgTurnoverCr).toLocaleString("en-IN")} cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  return (
    <section className="an-card rw" aria-label="RSI watch, NIFTY 500">
      <header className="t10-h">
        <div className="t10-h__t">
          <h3>RSI watch · NIFTY 500 · live</h3>
          <p className="t10-dim">
            14-day RSI of 15 or less, or 80 or more · traded ₹100 crore a day or more (20-day average) · today&rsquo;s live price as the newest bar
            {r && r.available ? ` · ${r.considered} stocks read · updated ${when(r.at)}` : ""}
          </p>
        </div>
        <div className="t10-h__c">
          <a className="adm-btn adm-btn--ghost adm-btn--sm" href={`${adminPath("/stock-report")}?view=screener`}>
            Other RSI searches
          </a>
        </div>
      </header>
      {err && <p className="adm-alert">{err}</p>}
      {!r ? (
        <p className="t10-dim">Reading the NIFTY 500…</p>
      ) : !r.available ? (
        <p className="adm-alert adm-alert--info">{r.reason}</p>
      ) : (
        <div className="rw-grid">
          {table(r.oversold.map((x) => liveRow(x, rsiPrices)), "low")}
          {table(r.overbought.map((x) => liveRow(x, rsiPrices)), "high")}
        </div>
      )}
      <p className="t10-dim">An RSI this far from 50 says how stretched a move is, not that it must turn: strong trends stay overbought (or oversold) for a long time.</p>
    </section>
  );
}
