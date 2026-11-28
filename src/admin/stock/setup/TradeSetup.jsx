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
      <LevelBar x={x} />
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

// ---- 28 Nov 2026 (the owner: "redesign this Trade setup page with best way", Kite's look; "banned stocks representations should
// be in some other best way"). Added on top of everything above: nothing is taken away.

/** The nearest level under and over the price, from the pivot ladder. */
function nearest(x) {
  if (!x || !x.available || typeof x.spot !== "number") return { below: null, above: null };
  const all = [["S3", x.s3], ["S2", x.s2], ["S1", x.s1], ["Pivot", x.pivot], ["R1", x.r1], ["R2", x.r2], ["R3", x.r3]].filter(([, v]) => typeof v === "number");
  const below = all.filter(([, v]) => v <= x.spot).pop() || null;
  const above = all.find(([, v]) => v > x.spot) || null;
  return { below, above };
}

/** Where the price sits between S3 and R3: one thin bar, the pivot marked, the price a dot. */
function LevelBar({ x }) {
  if (!x || typeof x.s3 !== "number" || typeof x.r3 !== "number" || typeof x.spot !== "number" || x.r3 <= x.s3) return null;
  const at = (v) => Math.max(0, Math.min(100, ((v - x.s3) / (x.r3 - x.s3)) * 100));
  const ticks = [["S3", x.s3], ["S2", x.s2], ["S1", x.s1], ["P", x.pivot], ["R1", x.r1], ["R2", x.r2], ["R3", x.r3]].filter(([, v]) => typeof v === "number");
  const out = x.spot < x.s3 ? "below S3" : x.spot > x.r3 ? "above R3" : "";
  return (
    <div className="ts-bar" role="img" aria-label={`${x.name || "Index"} at ${inr(x.spot)}, ${x.spot >= x.pivot ? "above" : "below"} its pivot ${inr(x.pivot)}${out ? `, ${out}` : ""}`}>
      <div className="ts-bar__track">
        <i className="ts-bar__fill" style={{ left: `${Math.min(at(x.pivot), at(x.spot))}%`, width: `${Math.abs(at(x.spot) - at(x.pivot))}%` }} data-side={x.spot >= x.pivot ? "up" : "down"} />
        {ticks.map(([k, v]) => (
          <span key={k} className={`ts-bar__tick ${k === "P" ? "is-p" : ""}`} style={{ left: `${at(v)}%` }} />
        ))}
        <b className="ts-bar__dot" style={{ left: `${at(x.spot)}%` }} data-side={x.spot >= x.pivot ? "up" : "down"} />
      </div>
      <div className="ts-bar__keys" aria-hidden="true">
        {ticks.map(([k, v]) => (
          <span key={k} style={{ left: `${at(v)}%` }}>
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One index on the first-sight panel: price, pivot side, the nearest support and resistance. */
function GlanceIndex({ title, x }) {
  if (!x || !x.available) {
    return (
      <div className="ts-g">
        <small>{title}</small>
        <b>—</b>
        <span className="ts-dim">{(x && x.reason) || "Needs the index candles"}</span>
      </div>
    );
  }
  const n = nearest(x);
  const up = x.spot >= x.pivot;
  return (
    <div className="ts-g">
      <small>{title}</small>
      <b>{inr(x.spot)}</b>
      <span className={up ? "is-up" : "is-down"}>
        {up ? "▲ above" : "▼ below"} pivot {inr(x.pivot)}
      </span>
      <span className="ts-g__lv">
        <em>Support</em> {n.below ? `${n.below[0]} ${inr(n.below[1])}` : "under S3"}
        <em>Resistance</em> {n.above ? `${n.above[0]} ${inr(n.above[1])}` : "over R3"}
      </span>
    </div>
  );
}

/** The first-sight panel: what to know before the open, in one row. */
function Glance({ d, lean, leanCls }) {
  const b = d.build || d.prevBuild;
  const known = b ? KINDS.reduce((t, [k]) => t + (b.counts[k] || 0), 0) : 0;
  const pct = (k) => (known ? Math.round(((b.counts[k] || 0) / known) * 100) : 0);
  const ban = d.ban ? d.ban.symbols : null;
  return (
    <section className={`ts-glance ${leanCls}`} aria-label="At a glance" data-jump="At a glance">
      <div className="ts-g ts-g--lean">
        <small>Setup lean</small>
        <b className={leanCls}>{lean.label || "—"}</b>
        <span>
          score {sgn(lean.score, 0)} · {Math.round((lean.agreement || 0) * 100)}% agree
        </span>
        <span className="ts-meter" aria-hidden="true">
          <i style={{ left: `${Math.max(0, Math.min(100, 50 + (lean.score || 0) / 2))}%` }} />
        </span>
      </div>
      <GlanceIndex title="NIFTY 50" x={d.nifty} />
      <GlanceIndex title="NIFTY BANK" x={d.bank} />
      <div className="ts-g">
        <small>Flows · mood</small>
        <span className="ts-g__pairs ts-g__pairs--2">
          <em>FII</em> <b className={tone(d.flows && d.flows.fii && d.flows.fii.net)}>{d.flows && d.flows.fii ? crore(d.flows.fii.net) : "—"}</b>
          <em>DII</em> <b className={tone(d.flows && d.flows.dii && d.flows.dii.net)}>{d.flows && d.flows.dii ? crore(d.flows.dii.net) : "—"}</b>
          <em>PCR</em> <b>{d.pcr && d.pcr.nifty != null ? d.pcr.nifty : "—"}</b>
          <em>VIX</em> <b className={d.vix && d.vix.last >= 20 ? "is-down" : ""}>{d.vix ? inr(d.vix.last) : "—"}</b>
        </span>
      </div>
      <div className="ts-g">
        <small>F&amp;O breadth{b ? ` · ${known} futures` : ""}</small>
        {b ? (
          <>
            <span className="ts-breadth" aria-hidden="true">
              {KINDS.map(([k, , , cls]) => (
                <i key={k} className={`${cls} ${k.startsWith("long") ? "is-solid" : "is-soft"}`} style={{ flexGrow: b.counts[k] || 0 }} />
              ))}
            </span>
            <span className="ts-g__pairs">
              {KINDS.map(([k, label, , cls]) => (
                <React.Fragment key={k}>
                  <em>{label}</em> <b className={cls}>{b.counts[k] || 0}</b>
                  <small className="ts-dim">{pct(k)}%</small>
                </React.Fragment>
              ))}
            </span>
          </>
        ) : (
          <span className="ts-dim">Being read</span>
        )}
      </div>
      <div className={`ts-g ${ban && ban.length ? "ts-g--ban" : ""}`}>
        <small>F&amp;O ban</small>
        <b>{ban ? (ban.length ? `${ban.length} stock${ban.length === 1 ? "" : "s"}` : "None") : "—"}</b>
        <span className="ts-dim">{ban ? (ban.length ? ban.join(", ") : "every F&O stock is open") : "from NSE at 8 AM"}</span>
      </div>
    </section>
  );
}

/** The ban list as Kite would show it: one row a stock, a red BAN tag, what the stock is doing, and what the ban means. */
function BanList({ d, onOpen }) {
  const all = (d.build && d.build.all) || (d.prevBuild && d.prevBuild.all) || {};
  const deliv = new Map((d.delivery || []).map((x) => [x.symbol, x]));
  const kindName = Object.fromEntries(KINDS.map(([k, label, , cls]) => [k, [label, cls]]));
  return (
    <ul className="ts-chips ts-ban" aria-label="Stocks in the F&O ban">
      {d.ban.symbols.map((x) => {
        const b = all[x];
        const dv = deliv.get(x);
        return (
          <li key={x}>
            <span className="ts-ban__tag" aria-label="In the F&O ban">
              BAN
            </span>
            <span className="ts-ban__name">
              <button type="button" className="ts-sym" onClick={() => onOpen && onOpen(x)} data-tip={`Open ${x} on the Desk`}>
                {x}
              </button>
              <small>
                {b ? (
                  <>
                    <span className={kindName[b.kind] ? kindName[b.kind][1] : ""}>{kindName[b.kind] ? kindName[b.kind][0] : b.kind}</span> · price <span className={tone(b.changePct)}>{sgn(b.changePct)}%</span> · OI {sgn(b.oiChangePct, 1)}%
                  </>
                ) : (
                  "No new F&O positions today"
                )}
                {dv ? ` · delivery ${dv.delivPct}% (${dv.vsAvg}× avg)` : ""}
              </small>
            </span>
            <span className="ts-ban__rule">F&amp;O: reduce only · Cash: open</span>
          </li>
        );
      })}
    </ul>
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
      <Glance d={d} lean={lean} leanCls={leanCls} />
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
              <BanList d={d} onOpen={onOpen} />
            ) : (
              <p className="ts-ban__none">No stock is in the ban today: every F&amp;O stock takes new positions.</p>
            )
          ) : (
            <p className="ts-dim">Not read yet.</p>
          )}
          <p className="ts-dim ts-ban__note">A stock enters the ban when its open interest crosses 95% of the market-wide limit (MWPL). Until it falls under 80%, no new F&amp;O positions: only trades that reduce open interest. Buying and selling the shares themselves (cash, MIS or CNC) is not affected.</p>
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
