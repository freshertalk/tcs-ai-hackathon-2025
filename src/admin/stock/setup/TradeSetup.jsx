// Trade setup (23 Nov 2026): the fifteen readings of the morning trade setup — NIFTY and BANKNIFTY key levels, their option writing
// (calls and puts), the funds flow, PCR, India VIX, every F&O stock's futures build-up, high delivery and the F&O ban — and the
// setup lean made from them, with its measured record. The server keeps all of it up to date by itself from Zerodha and NSE's
// public files (server/setup.js): no AI, no button. This page only shows it, and changes the moment the server has something new.

import React, { useEffect, useState } from "react";
import { api, peek } from "../../api";
import { everyVisible } from "../../visible";
import Skeleton from "../../ux/Skeleton";
import { PageBar, PageHead, PagePart, usePageTab } from "../../ux/PageKit";
import "./setup.css";

// The Journal's anatomy (23 Nov 2026): the head card, the sticky bar with the morning's headline readings, and the
// readings in tabs — with "All 15" first, because this is a checklist read top to bottom before the open. Every part
// stays mounted behind its tab.
const PARTS = [
  { id: "all", label: "All 15", tip: "Every reading on one page, as a checklist." },
  { id: "levels", label: "Levels", tip: "1–2: pivots from the last session beside the option walls." },
  { id: "options", label: "Options", tip: "3–6: where call and put writers are building and leaving." },
  { id: "flows", label: "Flows · PCR · VIX", tip: "7–9: FII/DII cash flows, the put-call ratio and India VIX." },
  { id: "builds", label: "Build-ups", tip: "10–13: every F&O stock's near-month future." },
  { id: "delivery", label: "Delivery & ban", tip: "14–15: high delivery and the F&O ban list." },
];
const PART_IDS = PARTS.map((p) => p.id);

const URL = "/api/admin/market/setup";
const inr = (x) => (typeof x === "number" ? x.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");
const sgn = (x, d = 2) => (typeof x === "number" ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "—");
const crore = (x) => (typeof x === "number" ? `${x >= 0 ? "+" : "−"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")} cr` : "—");
const lakh = (x) => (typeof x === "number" ? (Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(1)} L` : x.toLocaleString("en-IN")) : "—");
const stamp = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const tone = (x) => (typeof x === "number" ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
const KINDS = [
  ["long build-up", "Long build-up", "price up, OI up", "is-up"],
  ["short covering", "Short covering", "price up, OI down", "is-up"],
  ["short build-up", "Short build-up", "price down, OI up", "is-down"],
  ["long unwinding", "Long unwinding", "price down, OI down", "is-down"],
];

function Levels({ x }) {
  if (!x || !x.available) return <p className="ts-dim">{(x && x.reason) || "Waiting for the index candles (they need the Zerodha connection)."}</p>;
  const row = (k, v) => (
    <li key={k} className={x.spot >= v ? "is-below" : "is-above"}>
      <span>{k}</span>
      <b>{inr(v)}</b>
    </li>
  );
  return (
    <div className="ts-levels">
      <p className="ts-read">{x.read}</p>
      <ul className="ts-ladder" aria-label={`${x.name} pivots`}>
        {row("R3", x.r3)}
        {row("R2", x.r2)}
        {row("R1", x.r1)}
        <li className="is-pivot">
          <span>Pivot</span>
          <b>{inr(x.pivot)}</b>
        </li>
        {row("S1", x.s1)}
        {row("S2", x.s2)}
        {row("S3", x.s3)}
      </ul>
      <small className="ts-dim">
        Now {inr(x.spot)} · from {x.basedOn || "the last session"}: high {inr(x.prevHigh)}, low {inr(x.prevLow)}, close {inr(x.prevClose)}
        {x.walls ? ` · put wall ${inr(x.walls.put)}, call wall ${inr(x.walls.call)}, max pain ${inr(x.walls.maxPain)}` : ""}
      </small>
    </div>
  );
}

function OptionSide({ title, x }) {
  return (
    <div className="ts-opt">
      <h4>{title}</h4>
      {!x ? (
        <p className="ts-dim">Not read yet.</p>
      ) : (
        <>
          <dl>
            <dt>Most OI</dt>
            <dd>{x.maxOi.map((o) => `${o.strike} (${lakh(o.oi)})`).join(" · ") || "—"}</dd>
            <dt>Most added</dt>
            <dd>{x.changeKnown ? x.maxAdded.map((o) => `${o.strike} (+${lakh(o.oiChange)})`).join(" · ") || "none" : "from the next reading"}</dd>
            <dt>Most shed</dt>
            <dd>{x.changeKnown ? x.maxShed.map((o) => `${o.strike} (${lakh(o.oiChange)})`).join(" · ") || "none" : "from the next reading"}</dd>
          </dl>
          <small className="ts-dim">expiry {x.expiry}</small>
        </>
      )}
    </div>
  );
}

function Builds({ b, onOpen }) {
  if (!b) return <p className="ts-dim">The futures' open interest is being read (once a day from Kite's history, then live).</p>;
  return (
    <div className="ts-builds">
      {KINDS.map(([k, label, how, cls]) => (
        <div key={k} className={`ts-build ${cls}`}>
          <h4>
            {label} <span>{b.counts[k]}</span>
          </h4>
          <small className="ts-dim">{how}</small>
          <ol>
            {(b.lists[k] || []).slice(0, 10).map((x) => (
              <li key={x.symbol}>
                <button type="button" className="ts-sym" onClick={() => onOpen && onOpen(x.symbol)} data-tip={`Open ${x.symbol} on the Desk`}>
                  {x.symbol}
                </button>
                <span className={tone(x.changePct)}>{sgn(x.changePct)}%</span>
                <small>OI {sgn(x.oiChangePct, 1)}%</small>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

export default function TradeSetup({ onOpen }) {
  const [s, setS] = useState(() => ({ d: peek(URL, 5 * 60000), error: "" }));
  const [which, setWhich] = useState("now");
  const [part, setPart] = usePageTab("setup", PART_IDS);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api(URL)
        .then((d) => alive && setS({ d, error: "" }))
        .catch((e) => alive && setS((p) => ({ d: p.d, error: e.message })));
    read();
    const stop = everyVisible(read, 15000, { topics: ["setup"] }); // every 15 s (was a minute), and at once when the setup changes
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, []);
  const d = s.d;
  if (!d)
    return (
      <section className="sr-card ts" aria-labelledby="ts-h">
        <div className="sr-card__head">
          <div>
            <h2 id="ts-h">Trade setup</h2>
            <p>Levels, options, flows, PCR, VIX, build-ups, delivery and the F&amp;O ban — kept current by the desk itself</p>
          </div>
        </div>
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <Skeleton label="Reading the trade setup…" tiles={4} lines={3} />}
      </section>
    );
  const lean = d.lean || { votes: [] };
  const leanCls = lean.score >= 12 ? "is-up" : lean.score <= -12 ? "is-down" : "";
  const rec = d.record || {};
  const builds = which === "now" ? d.build || d.prevBuild : d.prevBuild;
  const errs = Object.entries(d.errors || {});
  return (
    <>
      <PageHead
        title="Trade setup"
        text={
          <>
            Fifteen readings for the session — levels, options, flows, PCR, VIX, build-ups, delivery and the F&amp;O ban — kept current by itself from Zerodha and NSE ({d.sessionOn ? "live: the futures and option chains every two minutes" : "between sessions: the last session's readings"}
            {!d.connected ? "; Zerodha is not connected, so only NSE's files are fresh" : ""}). No AI.
          </>
        }
      />
      <PageBar
        label={lean.label || "—"}
        labelTitle="Setup lean"
        kpis={[
          { label: "Lean score", value: sgn(lean.score, 0), tone: lean.score >= 12 ? "up" : lean.score <= -12 ? "down" : "" },
          { label: "India VIX", value: d.vix ? inr(d.vix.last) : null, tone: d.vix && d.vix.last >= 20 ? "warn" : "" },
          { label: "PCR NIFTY", value: d.pcr ? d.pcr.nifty : null },
          { label: "FII cash", value: d.flows && d.flows.fii ? crore(d.flows.fii.net) : null, tone: d.flows && d.flows.fii ? (d.flows.fii.net > 0 ? "up" : d.flows.fii.net < 0 ? "down" : "") : "", more: true },
          { label: "F&O ban", value: d.ban ? `${d.ban.symbols.length} stock${d.ban.symbols.length === 1 ? "" : "s"}` : null, more: true },
        ]}
        tabs={PARTS}
        tab={part}
        onTab={setPart}
        updatedAt={d.asOf}
        tabsLabel="Trade setup readings"
      />
      <PagePart id="all" tab={part}>
      <section className={`sr-card ts ts-lean ${leanCls}`} aria-labelledby="ts-h" data-jump="Setup lean">
        <div className="sr-card__head">
          <div>
            <h2 id="ts-h">Setup lean</h2>
            <p>
              The six readings weighed into one lean · updated {stamp(d.asOf)}
            </p>
          </div>
        </div>
        <div className="ts-leanrow">
          <div className="ts-leanbox">
            <small>Setup lean</small>
            <b>{lean.label || "—"}</b>
            <span>
              score {sgn(lean.score, 0)} · {Math.round((lean.agreement || 0) * 100)}% of the weight agrees · {lean.readings ?? lean.votes.length} of {lean.of || 6} readings in
            </span>
          </div>
          <ul className="ts-votes">
            {lean.votes.map((v) => (
              <li key={v.id}>
                <span className={tone(v.vote)}>{sgn(v.vote)}</span>
                <span>{v.why}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="ts-dim">
          Record: {rec.called ? `the 9:14 lean was right on ${rec.right} of ${rec.called} called sessions (${Math.round(rec.hitRate * 100)}%)` : "scored from the first session it is written down (9:14, against NIFTY's close)"}. {rec.rule}
        </p>
      </section>
      </PagePart>

      <PagePart id="levels" tab={part} all="all">
      <section className="sr-card ts" aria-labelledby="ts-lv" data-jump="Key levels">
        <div className="sr-card__head">
          <div>
            <h2 id="ts-lv">1–2 · Key levels</h2>
            <p>Floor-trader pivots from the last finished session, beside the option walls</p>
          </div>
        </div>
        <div className="ts-two">
          <div>
            <h3>NIFTY 50</h3>
            <Levels x={d.nifty} />
          </div>
          <div>
            <h3>NIFTY BANK</h3>
            <Levels x={d.bank} />
          </div>
        </div>
      </section>
      </PagePart>

      <PagePart id="options" tab={part} all="all">
      <section className="sr-card ts" aria-labelledby="ts-op" data-jump="Options">
        <div className="sr-card__head">
          <div>
            <h2 id="ts-op">3–6 · Options data</h2>
            <p>Where call and put writers are building and leaving (open interest, and its change since the last session)</p>
          </div>
        </div>
        <div className="ts-four">
          <OptionSide title="NIFTY calls" x={d.options.niftyCalls} />
          <OptionSide title="NIFTY puts" x={d.options.niftyPuts} />
          <OptionSide title="BANKNIFTY calls" x={d.options.bankCalls} />
          <OptionSide title="BANKNIFTY puts" x={d.options.bankPuts} />
        </div>
      </section>
      </PagePart>

      <PagePart id="flows" tab={part} all="all">
      <section className="sr-card ts" aria-labelledby="ts-mk" data-jump="Flows, PCR, VIX">
        <div className="sr-card__head">
          <div>
            <h2 id="ts-mk">7–9 · Funds flow, put-call ratio, India VIX</h2>
          </div>
        </div>
        <div className="ts-tiles">
          <div className="ts-tile">
            <small>FII / FPI (cash)</small>
            <b className={tone(d.flows && d.flows.fii && d.flows.fii.net)}>{d.flows && d.flows.fii ? crore(d.flows.fii.net) : "—"}</b>
            <span>{d.flows ? `${d.flows.date || ""} · bought ${inr(d.flows.fii && d.flows.fii.buy)}, sold ${inr(d.flows.fii && d.flows.fii.sell)} cr` : "NSE publishes it after the close"}</span>
          </div>
          <div className="ts-tile">
            <small>DII (cash)</small>
            <b className={tone(d.flows && d.flows.dii && d.flows.dii.net)}>{d.flows && d.flows.dii ? crore(d.flows.dii.net) : "—"}</b>
            <span>{d.flows && d.flows.dii ? `bought ${inr(d.flows.dii.buy)}, sold ${inr(d.flows.dii.sell)} cr` : "—"}</span>
          </div>
          <div className="ts-tile">
            <small>Put-call ratio (OI)</small>
            <b>
              {d.pcr.nifty ?? "—"} <span className="ts-dim">NIFTY</span> · {d.pcr.bank ?? "—"} <span className="ts-dim">BANK</span>
            </b>
            <span>{d.pcr.expiry ? `expiry ${d.pcr.expiry} · max pain ${inr(d.maxPain.nifty)} / ${inr(d.maxPain.bank)}` : "from the option chains"}</span>
          </div>
          <div className="ts-tile">
            <small>India VIX</small>
            <b>{d.vix ? inr(d.vix.last) : "—"}</b>
            <span className={tone(d.vix && -d.vix.changePct)}>{d.vix ? `${sgn(d.vix.changePct)}% — ${d.vix.last >= 20 ? "high: wide swings" : d.vix.last <= 12 ? "low: calm" : "normal"}` : "needs the Zerodha connection"}</span>
          </div>
        </div>
      </section>
      </PagePart>

      <PagePart id="builds" tab={part} all="all">
      <section className="sr-card ts" aria-labelledby="ts-bu" data-jump="Build-ups">
        <div className="sr-card__head">
          <div>
            <h2 id="ts-bu">10–13 · Futures build-ups</h2>
            <p>{d.buildBasis ? `Every F&O stock's near-month future: ${which === "now" && d.build ? d.buildBasis : "the last finished session against the one before"}` : "Every F&O stock's near-month future"}</p>
          </div>
          <div className="ts-switch" role="group" aria-label="Which build-ups">
            <button type="button" className={`xp-chip ${which === "now" ? "is-on" : ""}`} aria-pressed={which === "now"} onClick={() => setWhich("now")} disabled={!d.build}>
              Now
            </button>
            <button type="button" className={`xp-chip ${which === "prev" ? "is-on" : ""}`} aria-pressed={which === "prev"} onClick={() => setWhich("prev")} disabled={!d.prevBuild}>
              Last session
            </button>
          </div>
        </div>
        <Builds b={builds} onOpen={onOpen} />
      </section>
      </PagePart>

      <PagePart id="delivery" tab={part} all="all">
      <div className="ts-two">
        <section className="sr-card ts" aria-labelledby="ts-dl" data-jump="High delivery">
          <div className="sr-card__head">
            <div>
              <h2 id="ts-dl">14 · High delivery</h2>
              <p>F&amp;O stocks whose delivered share was well above their own average{d.deliveryAsOf ? ` · ${d.deliveryAsOf}` : ""}</p>
            </div>
          </div>
          {d.delivery.length ? (
            <div className="ts-scroll">
              <table className="ts-table">
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    <th scope="col">Delivery</th>
                    <th scope="col">× avg</th>
                    <th scope="col">Day</th>
                  </tr>
                </thead>
                <tbody>
                  {d.delivery.map((x) => (
                    <tr key={x.symbol}>
                      <td>
                        <button type="button" className="ts-sym" onClick={() => onOpen && onOpen(x.symbol)}>
                          {x.symbol}
                        </button>
                      </td>
                      <td>{x.delivPct}%</td>
                      <td>{x.vsAvg}×</td>
                      <td className={tone(x.changePct)}>{sgn(x.changePct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ts-dim">No F&amp;O stock stood out, or NSE's delivery files are not read yet.</p>
          )}
        </section>
        <section className="sr-card ts" aria-labelledby="ts-bn" data-jump="F&O ban">
          <div className="sr-card__head">
            <div>
              <h2 id="ts-bn">15 · Stocks in the F&amp;O ban</h2>
              <p>{d.ban ? `For trade date ${d.ban.date} (NSE)` : "Read from NSE from 8 AM"}</p>
            </div>
          </div>
          {d.ban ? (
            d.ban.symbols.length ? (
              <ul className="ts-chips">
                {d.ban.symbols.map((x) => (
                  <li key={x}>
                    <button type="button" className="ts-sym" onClick={() => onOpen && onOpen(x)}>
                      {x}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No stock is in the ban today.</p>
            )
          ) : (
            <p className="ts-dim">Not read yet.</p>
          )}
          <p className="ts-dim">A stock in the ban takes no new F&amp;O positions; only positions that reduce open interest are allowed.</p>
        </section>
      </div>
      </PagePart>
      <p className="hc__foot ts-foot">
        {d.rule}
        {errs.length ? ` Not read at the last try: ${errs.map(([k, v]) => `${k} (${v})`).join("; ")} — the last good reading is shown.` : ""}
      </p>
    </>
  );
}
