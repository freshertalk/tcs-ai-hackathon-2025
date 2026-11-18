// The live scanner on the Research tab: the NIFTY 100 held in a buffer on the server (server/scanner.js)
// from Zerodha's live stream and read every two seconds — which stocks may be traded intraday now, on
// which side, with the plan, the next-move lean and the reasons; the near misses and what holds them back;
// every stock on one board; the scanner's own measured record; and the AI Engine's note when it was needed.
//
// It is pushed on the live-price stream the page already holds (one connection per tab); a read every five
// seconds while the tab is in view is the fallback. Nothing here places an order: Buy and Sell open the
// order ticket, which the owner confirms.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { everyVisible } from "../../visible";
import { clock, inr, isNum, pct } from "../analyzer/format";
import { useScanFeed } from "../analyzer/liveTicks";
import { TradeButtons } from "./TradeContext";
import { KnowledgeChecks } from "../engine/KnowledgeChecks";
import "./scanner.css";

const FILTERS = [
  { id: "eligible", label: "Eligible" },
  { id: "long", label: "Leaning up" },
  { id: "short", label: "Leaning down" },
  { id: "all", label: "All" },
];
const STR = { strong: "strong", moderate: "moderate", weak: "weak", none: "" };
// the classic set-ups in a few characters (server/market/setups.js)
export const SETUP_SHORT = { orb: "ORB", "vwap-pullback": "VWAP pullback", "vwap-reclaim": "VWAP reclaim", "pd-break": "Prev-day break", "gap-go": "Gap & go", "gap-fade": "Gap fade", "squeeze-break": "Squeeze", "trend-pullback": "1st pullback", "vwap-fade": "VWAP fade" };

/** The set-ups that fired on the stock's last closed bar, each with what it has measured on this desk. */
function Setups({ list }) {
  if (!list || !list.length) return null;
  return (
    <ul className="sx-sus">
      {list.map((su) => {
        const e = su.edge;
        const t = !e || e.n < 30 ? "flat" : e.avgR > 0 ? "up" : "down";
        return (
          <li key={`${su.id}:${su.side}`} className={`sx-su is-${t}`} data-tip={`${su.name} (${su.side}): ${su.why}. ${e ? `Measured on this desk: ${e.n} trades, ${e.winPct}% won, ${e.avgR > 0 ? "+" : ""}${e.avgR}R a trade after costs${e.n < 30 ? " — too few to count yet" : ""}.` : "Not yet measured on this desk (the set-up lab runs each evening)."}`}>
            {su.side === "long" ? "▲" : "▼"} {SETUP_SHORT[su.id] || su.name}
            <small>{e ? `${e.avgR > 0 ? "+" : ""}${e.avgR}R · ${e.n}` : "unmeasured"}</small>
          </li>
        );
      })}
    </ul>
  );
}
const arrow = (dir) => (dir === "up" ? "▲" : dir === "down" ? "▼" : "◆");
const n1 = (x) => (isNum(x) ? x.toFixed(1) : "—");
const newer = (a, b) => (!a ? b : !b ? a : Date.parse(a.at) >= Date.parse(b.at) ? a : b);

/** The status pill: live, filling, closed or off. */
function State({ v }) {
  const word = { live: "Live", filling: "Filling", closed: "Closed", off: "Off" }[v.state] || v.state;
  return (
    <span className={`sx-state sx-state--${v.state}`} role="status" data-tip={v.reason || "Every NIFTY 100 stock read from Zerodha's live stream every two seconds."}>
      <i aria-hidden="true" />
      {word}
      {v.state === "filling" ? ` · ${v.universe.seeded}/${v.universe.size}` : ""}
    </span>
  );
}

/** The indicator chips of one stock: each reading in a few characters, coloured by the way it votes. */
function Chips({ f }) {
  const c = [];
  const add = (k, text, tip, t) => c.push({ k, text, tip, t });
  if (isNum(f.vsVwapPct)) add("vwap", `VWAP ${pct(f.vsVwapPct, 1)}`, `Price against VWAP ${inr(f.vwap)}${isNum(f.vsVwapAtr) ? ` (${n1(f.vsVwapAtr)} ATR)` : ""}`, f.vsVwapPct >= 0 ? "up" : "down");
  if (isNum(f.ema9) && isNum(f.ema21)) add("ema", `EMA9 ${f.ema9 >= f.ema21 ? ">" : "<"} 21`, `EMA 9 ${inr(f.ema9)} against EMA 21 ${inr(f.ema21)} on 5-minute bars`, f.ema9 >= f.ema21 ? "up" : "down");
  if (f.supertrend === 1 || f.supertrend === -1) add("st", `ST ${f.supertrend === 1 ? "↑" : "↓"}`, "Supertrend (10, 3) on 5-minute bars", f.supertrend === 1 ? "up" : "down");
  if (isNum(f.macdHist)) add("macd", `MACD ${f.macdHist >= 0 ? "+" : "−"}`, `MACD (12, 26, 9) histogram ${f.macdHist}`, f.macdHist >= 0 ? "up" : "down");
  if (isNum(f.rsi)) add("rsi", `RSI ${Math.round(f.rsi)}`, "RSI (14) on 5-minute bars: 55+ momentum up, 45− down, 75+ / 25− stretched", f.rsi >= 75 || f.rsi <= 25 ? "warn" : f.rsi >= 55 ? "up" : f.rsi <= 45 ? "down" : "flat");
  if (isNum(f.adx)) add("adx", `ADX ${Math.round(f.adx)}`, `ADX (14): 20+ a trend forming, 25+ trending · +DI ${f.plusDI} / −DI ${f.minusDI}`, f.adx >= 20 ? (f.plusDI >= f.minusDI ? "up" : "down") : "flat");
  if (f.orb && f.orb !== "forming") add("orb", f.orb === "above" ? "ORB ↑" : f.orb === "below" ? "ORB ↓" : "In OR", `Opening range (9:15–9:30) ${inr(f.orl)}–${inr(f.orh)}`, f.orb === "above" ? "up" : f.orb === "below" ? "down" : "flat");
  if (isNum(f.relVol)) add("rv", `Vol ${n1(f.relVol)}×`, "Volume so far against the usual by this time of day", f.relVol >= 1.2 ? "up" : f.relVol < 0.8 ? "warn" : "flat");
  if (isNum(f.rsNifty)) add("rs", `vs NIFTY ${pct(f.rsNifty, 1)}`, "Today's move against the NIFTY 50's", f.rsNifty >= 0 ? "up" : "down");
  if (isNum(f.bookBuyPct)) add("book", `Bids ${Math.round(f.bookBuyPct)}%`, "Total bids against offers in the order book", f.bookBuyPct >= 55 ? "up" : f.bookBuyPct <= 45 ? "down" : "flat");
  if (f.squeeze) add("sq", "Squeeze", "Bollinger bands at their narrowest of the last 60 bars: a move tends to follow", "warn");
  return (
    <ul className="sx-chips">
      {c.map((x) => (
        <li key={x.k} className={`sx-chip is-${x.t}`} data-tip={x.tip}>
          {x.text}
        </li>
      ))}
    </ul>
  );
}

/** The next-move lean in one line. */
function Lean({ next }) {
  if (!next) return null;
  return (
    <p className={`sx-lean is-${next.dir}`}>
      <b>
        {arrow(next.dir)} {next.dir === "flat" ? "No clear lean" : `Leans ${next.dir.toUpperCase()}`}
      </b>
      {next.dir !== "flat" && <span>{STR[next.strength]} · next {next.horizon}</span>}
      {isNum(next.rangeLow) && <small>usual range {inr(next.rangeLow)}–{inr(next.rangeHigh)}</small>}
    </p>
  );
}

/** One eligible stock: the side, the lean, the plan, the readings, the reasons, the AI's note. */
function Pick({ p, fresh, onOpen }) {
  const [more, setMore] = useState(false);
  const f = p.f;
  const pl = p.plan || {};
  return (
    <article className={`sx-pick is-${p.side} ${fresh ? "is-new" : ""} ${p.ai && p.ai.keep === false ? "is-skip" : ""}`}>
      <header className="sx-pick__head">
        <span className="sx-rank" aria-label={`Rank ${p.rank}`}>
          {p.rank}
        </span>
        <button type="button" className="sx-sym" onClick={() => onOpen && onOpen(p.symbol)} data-tip="Open this stock on the Desk.">
          {p.symbol}
        </button>
        <span className={`sx-side sx-side--${p.side}`}>{p.side === "long" ? "LONG" : "SHORT"}</span>
        <span className="sx-px">
          <b>{inr(f.last)}</b>
          <small className={`is-${f.chgPct >= 0 ? "up" : "down"}`}>{pct(f.chgPct)}</small>
        </span>
      </header>
      <Lean next={p.next} />
      <div className="sx-meter" data-tip={`Score ${p.score} on −100…+100; ${Math.round(p.agree * 100)}% of the weighted evidence agrees.`}>
        <span className="sx-meter__bar" aria-hidden="true">
          <i className={p.score >= 0 ? "is-up" : "is-down"} style={{ width: `${Math.min(100, Math.abs(p.score))}%` }} />
        </span>
        <small>
          score <b>{p.score > 0 ? `+${p.score}` : p.score}</b> · {Math.round(p.agree * 100)}% agree
        </small>
      </div>
      <dl className="sx-plan">
        <div>
          <dt>Entry</dt>
          <dd>{inr(pl.entry)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="is-down">
            {inr(pl.stop)} <small>{isNum(pl.riskPct) ? `${pl.riskPct}%` : ""}</small>
          </dd>
        </div>
        <div>
          <dt>Target 1.5R</dt>
          <dd className="is-up">{inr(pl.t1)}</dd>
        </div>
        <div>
          <dt>Target 2.5R</dt>
          <dd className="is-up">{inr(pl.t2)}</dd>
        </div>
      </dl>
      {pl.level && (
        <p className="sx-note">
          Next level against it: {pl.level.name} {inr(pl.level.price)} ({pl.level.roomR}R away)
        </p>
      )}
      <Setups list={p.setups} />
      <KnowledgeChecks k={p.knowledge} side={p.side} title="The knowledge base" compact />
      <Chips f={f} />
      {p.ai && (
        <div className={`sx-ai ${p.ai.keep === false ? "is-skip" : ""}`}>
          <b>{p.ai.keep === false ? "AI would skip" : "AI"}</b> <small>{p.ai.confidence} confidence</small>
          <p>{p.ai.thesis}</p>
          {p.ai.risk && <p className="sx-ai__risk">Risk: {p.ai.risk}</p>}
        </div>
      )}
      <button type="button" className="sx-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
        {more ? "Hide the reasons" : `Why (${p.reasons.length} for · ${p.against.length} against)`}
      </button>
      {more && (
        <div className="sx-why">
          <ul className="sx-for">
            {p.reasons.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
          {p.against.length > 0 && (
            <ul className="sx-against">
              {p.against.map((r) => (
                <li key={r.id}>{r.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="sx-actions">
        <TradeButtons symbol={p.symbol} exchange="NSE" product="MIS" small />
      </div>
    </article>
  );
}

/** One stock opened on the board: every reading, its vote, the rules, the plan. */
function Detail({ symbol }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    const read = () =>
      api(`/api/admin/scanner/stock/${encodeURIComponent(symbol)}`)
        .then((x) => alive && (setD(x), setErr("")))
        .catch((e) => alive && setErr(e.message));
    read();
    const stop = everyVisible(read, 5000, { topics: ["scanner"] });
    return () => {
      alive = false;
      stop();
    };
  }, [symbol]);
  if (err) return <p className="adm-alert adm-alert--info">{err}</p>;
  if (!d) return <p className="sx-dim">Reading {symbol}…</p>;
  if (!d.ready) return <p className="sx-dim">{d.reason}</p>;
  const f = d.f;
  const rows = [
    ["VWAP", inr(f.vwap), `${pct(f.vsVwapPct)} · ${n1(f.vsVwapAtr)} ATR`, "vwap"],
    ["EMA 9 / 21", `${inr(f.ema9)} / ${inr(f.ema21)}`, isNum(f.ema9Slope) ? `slope ${f.ema9Slope}` : "", "ema"],
    ["Supertrend", f.supertrend === 1 ? "up" : f.supertrend === -1 ? "down" : "—", inr(f.supertrendLine), "supertrend"],
    ["MACD hist", isNum(f.macdHist) ? f.macdHist : "—", isNum(f.macdHistPrev) ? `was ${f.macdHistPrev}` : "", "macd"],
    ["RSI (14)", n1(f.rsi), "", "rsi"],
    ["ADX (14)", n1(f.adx), `+DI ${n1(f.plusDI)} / −DI ${n1(f.minusDI)}`, "adx"],
    ["ATR (5 min)", inr(f.atr5), isNum(f.atrPct) ? `${f.atrPct}%` : "", ""],
    ["Bollinger %B", isNum(f.bbPctB) ? f.bbPctB : "—", f.squeeze ? "squeeze" : isNum(f.bbWidth) ? `width ${f.bbWidth}%` : "", "bollinger"],
    ["Opening range", f.orh ? `${inr(f.orl)}–${inr(f.orh)}` : "forming", f.orb, "orb"],
    ["Yesterday", f.pdh ? `H ${inr(f.pdh)} · L ${inr(f.pdl)}` : "—", f.pdc ? `C ${inr(f.pdc)}` : "", "prevday"],
    ["Pivots", f.pivots ? `S1 ${inr(f.pivots.s1)} · P ${inr(f.pivots.p)} · R1 ${inr(f.pivots.r1)}` : "—", f.pivots ? `CPR ${inr(f.pivots.cprBottom)}–${inr(f.pivots.cprTop)}` : "", "pivots"],
    ["Volume", isNum(f.relVol) ? `${n1(f.relVol)}× usual` : "—", "", "volume"],
    ["vs NIFTY", pct(f.rsNifty), isNum(f.rs30) ? `30 min ${pct(f.rs30)}` : "", "rs"],
    ["15-min move", pct(f.roc3), "", "momentum"],
    ["Order book", isNum(f.bookBuyPct) ? `${Math.round(f.bookBuyPct)}% bids` : "—", "", "book"],
    ["Day", `${inr(f.dayLow)}–${inr(f.dayHigh)}`, `gap ${pct(f.gapPct)}`, ""],
  ];
  return (
    <div className="sx-detail">
      <Lean next={d.next} />
      <Setups list={d.setups} />
      <KnowledgeChecks k={d.knowledge} side={d.side || (d.next && d.next.dir === "up" ? "long" : d.next && d.next.dir === "down" ? "short" : null)} />
      <table className="an-table sx-readings">
        <thead>
          <tr>
            <th scope="col">Reading</th>
            <th scope="col">Value</th>
            <th scope="col" className="sx-hide-sm">
              Detail
            </th>
            <th scope="col" className="is-num">
              Vote
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v, x, id]) => {
            const vote = id && d.votes ? d.votes[id] : null;
            return (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
                <td className="sx-hide-sm">{x}</td>
                <td className={`is-num is-${isNum(vote) ? (vote > 0.1 ? "up" : vote < -0.1 ? "down" : "flat") : "flat"}`}>{isNum(vote) ? (vote > 0 ? `+${vote}` : vote) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.blocks && d.blocks.length > 0 && (
        <div className="sx-blocks">
          <b>Not eligible because</b>
          <ul>
            {d.blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {d.calls && d.calls.length > 0 && (
        <p className="sx-note">
          Calls today: {d.calls.map((c) => `${c.side} at ${inr(c.entry)} → ${c.outcome || "open"}${isNum(c.moveR) ? ` (${c.moveR}R)` : ""}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** The scanner's measured record in one line. */
function Record({ r, h }) {
  if (!r) return null;
  const strong = r.lean && r.lean.strong;
  return (
    <p className="sx-record" data-tip="Every stock that turns eligible opens a call, followed to its first target (1.5R), its stop or 30 minutes. Every lean is checked 15 minutes on. Counted, not assumed.">
      <b>Record today</b> {r.calls} call{r.calls === 1 ? "" : "s"}
      {r.settled > 0 && (
        <>
          {" "}
          · {r.targets} to target, {r.stops} to stop{isNum(r.hitPct) ? ` (${r.hitPct}%)` : ""}
          {isNum(r.avgR) ? ` · avg ${r.avgR}R` : ""}
        </>
      )}
      {strong && strong.n > 0 && isNum(strong.rightPct) ? ` · strong leans right ${strong.rightPct}% of ${strong.n}` : ""}
      {h && h.sessions > 1 && isNum(h.hitPct) ? ` · last ${h.sessions} sessions ${h.hitPct}% to target` : ""}
    </p>
  );
}

export function LiveScanner({ onOpen }) {
  const { user } = useAuth();
  const owner = Boolean(user && user.role === "superadmin");
  const pushed = useScanFeed(true);
  const [polled, setPolled] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("eligible");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [asking, setAsking] = useState(false);
  const v = newer(pushed, polled);

  // the fallback: a read when the page opens, then every five seconds while no push is arriving
  const lastPush = useRef(0);
  useEffect(() => {
    if (pushed) lastPush.current = Date.now();
  }, [pushed]);
  useEffect(() => {
    let alive = true;
    const read = (force) => {
      if (!force && Date.now() - lastPush.current < 8000) return;
      api("/api/admin/scanner")
        .then((x) => alive && (setPolled(x), setErr("")))
        .catch((e) => alive && setErr(e.message));
    };
    read(true);
    const stop = everyVisible(() => read(false), 5000, { topics: ["scanner"] });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  // a pick that was not on the list a moment ago is marked for a few seconds
  const seen = useRef(null);
  const [fresh, setFresh] = useState(() => new Set());
  const pickKey = v && v.picks ? v.picks.map((p) => p.symbol).join(",") : "";
  useEffect(() => {
    const now = new Set(pickKey ? pickKey.split(",") : []);
    const before = seen.current;
    seen.current = now;
    if (!before) return undefined;
    const added = [...now].filter((s) => !before.has(s));
    if (!added.length) return undefined;
    setFresh(new Set(added));
    const id = setTimeout(() => setFresh(new Set()), 6000);
    return () => clearTimeout(id);
  }, [pickKey]);

  const board = useMemo(() => {
    if (!v || !v.board) return [];
    const s = q.trim().toUpperCase();
    return v.board.filter((b) => (!s || b.s.includes(s)) && (filter === "all" || (filter === "eligible" ? b.el : filter === "long" ? b.dir === "up" : b.dir === "down")));
  }, [v, filter, q]);

  const ask = async () => {
    setAsking(true);
    setErr("");
    try {
      const r = await api("/api/admin/scanner/ai", { method: "POST" });
      if (r && r.view) setPolled(r.view);
    } catch (e) {
      setErr(e.message);
    } finally {
      setAsking(false);
    }
  };

  if (!v) {
    return (
      <section className="an-card sx" aria-label="Live scanner">
        <h3 className="sx-title">Live scanner · NIFTY 100</h3>
        <p className="sx-dim">{err || "Connecting to the scanner…"}</p>
      </section>
    );
  }
  const m = v.market;
  const counts = { eligible: v.board.filter((b) => b.el).length, long: v.board.filter((b) => b.dir === "up").length, short: v.board.filter((b) => b.dir === "down").length, all: v.board.length };

  return (
    <section className="an-card sx" aria-label="Live scanner">
      <header className="sx-head">
        <div className="sx-head__title">
          <h3 className="sx-title">Live scanner · NIFTY 100</h3>
          <State v={v} />
          <small className="sx-dim">
            {v.universe.ticking}/{v.universe.size} streaming · read {v.readAt ? clock(v.readAt) : "—"}
          </small>
        </div>
        {owner && v.settings && v.settings.aiReady && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={ask} disabled={asking || v.aiBusy || !v.picks.length} data-tip={`Ask the AI Engine to review the eligible stocks now. By itself it asks only on need (${v.settings.aiToday} of ${v.settings.aiDailyCap} today).`}>
            {asking || v.aiBusy ? "AI reviewing…" : "Ask the AI"}
          </button>
        )}
      </header>
      {v.state !== "live" && v.reason && <p className={`adm-alert ${v.state === "off" ? "adm-alert--info" : ""}`}>{v.reason}</p>}
      {err && <p className="adm-alert">{err}</p>}

      {m && (
        <div className="sx-market">
          <div className={`sx-mk sx-mk--${m.dir}`} data-tip="The market's lean: the NIFTY 50's own reading (60%) and the breadth of the hundred (40%).">
            <small>Market lean</small>
            <b>
              {arrow(m.dir)} {m.dir === "flat" ? "FLAT" : m.dir.toUpperCase()} {isNum(m.score) ? `(${m.score > 0 ? "+" : ""}${m.score})` : ""}
            </b>
          </div>
          {m.nifty && (
            <div className="sx-mk" data-tip={m.nifty.reasons && m.nifty.reasons.length ? m.nifty.reasons.map((r) => r.text).join(" · ") : "The NIFTY 50 on 5-minute bars."}>
              <small>NIFTY 50</small>
              <b>
                {inr(m.nifty.last)} <span className={`is-${m.nifty.chgPct >= 0 ? "up" : "down"}`}>{pct(m.nifty.chgPct)}</span>
              </b>
              <small>
                next: {arrow(m.nifty.next.dir)} {m.nifty.next.dir} {STR[m.nifty.next.strength]}
              </small>
            </div>
          )}
          <div className="sx-mk" data-tip="Of the hundred: rising on the day, above VWAP, EMA 9 above EMA 21.">
            <small>Breadth</small>
            <b>
              <span className="is-up">{m.breadth.advancing}▲</span> <span className="is-down">{m.breadth.declining}▼</span>
            </b>
            <small>
              {m.breadth.aboveVwap} above VWAP · {m.breadth.emaUp} EMA up
            </small>
          </div>
          <div className="sx-mk">
            <small>Eligible now</small>
            <b>{v.eligibleCount}</b>
            <small>of {v.universe.ready} read</small>
          </div>
        </div>
      )}
      <Record r={v.record} h={v.history} />
      {v.ai && !v.ai.failed && (v.ai.summary || v.ai.marketView) && (
        <div className="sx-aibox">
          <b>AI Engine</b> <small>{v.ai.by} · {v.ai.why} · {clock(v.ai.at)}</small>
          {v.ai.summary && <p>{v.ai.summary}</p>}
          {v.ai.marketView && <p className="sx-dim">{v.ai.marketView}</p>}
        </div>
      )}
      {v.ai && v.ai.failed && <p className="sx-note">The AI's last review did not complete ({v.ai.error}); the desk's arithmetic stands.</p>}

      <h4 className="sx-sub">Eligible for an intraday trade now</h4>
      {v.picks.length === 0 ? (
        <p className="sx-dim">{v.state === "live" ? "No stock clears every rule right now — the near misses below show what holds each one back." : "The list appears once the buffer is read."}</p>
      ) : (
        <div className="sx-picks">
          {v.picks.map((p) => (
            <Pick key={p.symbol} p={p} fresh={fresh.has(p.symbol)} onOpen={onOpen} />
          ))}
        </div>
      )}

      {v.watch && v.watch.length > 0 && (
        <>
          <h4 className="sx-sub">Near misses</h4>
          <ul className="sx-watch">
            {v.watch.map((w) => (
              <li key={w.symbol}>
                <button type="button" className="sx-sym" onClick={() => setOpen(open === w.symbol ? null : w.symbol)}>
                  {w.symbol}
                </button>
                <span className={`is-${w.next.dir}`}>
                  {arrow(w.next.dir)} {w.score > 0 ? `+${w.score}` : w.score}
                </span>
                <small>{w.blocks[0]}</small>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="sx-board-head">
        <h4 className="sx-sub">All {v.universe.size}</h4>
        <div className="sx-filters" role="group" aria-label="Show">
          {FILTERS.map((x) => (
            <button key={x.id} type="button" aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>
              {x.label} <i>{counts[x.id]}</i>
            </button>
          ))}
        </div>
        <label className="sx-search">
          <span className="adm-sr">Find a stock</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a stock" spellCheck="false" autoComplete="off" />
        </label>
      </div>
      <div className="sx-board" aria-label="Every NIFTY 100 stock, read live">
        <div className="sx-row sx-row--head" aria-hidden="true">
          <span>Stock</span>
          <span className="is-num">
            LTP
          </span>
          <span className="is-num">
            Chg
          </span>
          <span>Next</span>
          <span className="is-num">
            Score
          </span>
          <span className="is-num sx-hide-sm">
            VWAP
          </span>
          <span className="is-num sx-hide-sm">
            RSI
          </span>
          <span className="is-num sx-hide-sm">
            ADX
          </span>
          <span className="is-num sx-hide-sm">
            Vol
          </span>
          <span className="sx-hide-md">
            Status
          </span>
        </div>
        {board.length === 0 && <p className="sx-dim sx-pad">{filter === "eligible" ? "None eligible right now." : "Nothing matches."}</p>}
        {board.map((b) => (
          <React.Fragment key={b.s}>
            <button type="button" className={`sx-row ${b.el ? "is-el" : ""} ${open === b.s ? "is-open" : ""}`} aria-expanded={open === b.s} aria-label={`${b.s}${b.el ? `, eligible ${b.side}` : ""}${isNum(b.sc) ? `, score ${b.sc}` : ""}: show every reading`} onClick={() => setOpen(open === b.s ? null : b.s)}>
              <span className="sx-row__sym">
                {b.s}
                {b.el && <em className={`sx-side sx-side--${b.side}`}>{b.side === "long" ? "L" : "S"}</em>}
              </span>
              {b.wait ? (
                <span className="sx-row__wait">
                  {b.wait}
                </span>
              ) : (
                <>
                  <span className="is-num">
                    {inr(b.last)}
                  </span>
                  <span className={`is-num is-${b.chg >= 0 ? "up" : "down"}`}>
                    {pct(b.chg)}
                  </span>
                  <span className={`is-${b.dir}`}>
                    {arrow(b.dir)} <small>{STR[b.str]}</small>
                  </span>
                  <span className={`is-num is-${b.sc > 0 ? "up" : b.sc < 0 ? "down" : "flat"}`}>
                    {b.sc > 0 ? `+${b.sc}` : b.sc}
                  </span>
                  <span className="is-num sx-hide-sm">
                    {pct(b.vw, 1)}
                  </span>
                  <span className="is-num sx-hide-sm">
                    {isNum(b.rsi) ? Math.round(b.rsi) : "—"}
                  </span>
                  <span className="is-num sx-hide-sm">
                    {isNum(b.adx) ? Math.round(b.adx) : "—"}
                  </span>
                  <span className="is-num sx-hide-sm">
                    {isNum(b.rv) ? `${n1(b.rv)}×` : "—"}
                  </span>
                  <span className="sx-row__why sx-hide-md">
                    {b.su && b.su.length > 0 && <em className="sx-su-tag">{SETUP_SHORT[b.su[0].split(":")[0]] || b.su[0]}</em>}
                    {b.why}
                  </span>
                </>
              )}
            </button>
            {open === b.s && (
              <div className="sx-open">
                <Detail symbol={b.s} />
                <div className="sx-actions">
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpen && onOpen(b.s)}>
                    Open on the Desk
                  </button>
                  <TradeButtons symbol={b.s} exchange="NSE" product="MIS" small />
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <p className="sx-foot">
        Read every two seconds from Zerodha's live stream on 5-minute bars. Eligible means every rule holds now: 9:30 AM – 2:45 PM, score ±{v.rules ? v.rules.minScore : 35} with {v.rules ? Math.round(v.rules.minAgree * 100) : 65}% of the evidence agreeing, the right side of VWAP, a trend (ADX {v.rules ? v.rules.minAdx : 18}+) or an opening-range break, live volume, liquidity, not stretched, room to the next level. A lean is not a forecast and no method wins every time: the record above is what this scanner has actually done. Study material, not advice — nothing here places an order.
      </p>
    </section>
  );
}

export default LiveScanner;
