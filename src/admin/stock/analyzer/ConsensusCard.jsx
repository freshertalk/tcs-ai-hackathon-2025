// The consensus forecast on the Desk and in Research (21 Nov 2026): ONE level forecast for about 5 and 15 minutes — the
// price, the likely band, the chance of a rise, the level likely touched first above and below — made from the desk's three
// forecasters (the 15-minute forecaster, the evidence desk, the early calls) and the live order book, with WHO LEADS (the
// blend, once its checked record beats the forecaster alone; the forecaster until then) and that record. The server makes,
// keeps, checks and learns every forecast (server/consensus.js); this only shows it.

import React, { useEffect, useState } from "react";
import { api, peek } from "../../api";
import { everyVisible } from "../../visible";
import { inr, isNum } from "./format";
import "./consensus.css";

const enc = encodeURIComponent;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const pc = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
const sgn = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%` : "—");
const TIER = { strong: "strong", clear: "clear", slight: "slight", none: "no clear lean" };
const INPUT = { forecaster: "15-minute forecaster", evidence: "Evidence desk", early: "Early calls", book: "Order book", bias: "Its own bias" };

/** The consensus forecast for a stock, re-read every 30 seconds while the page is visible (and when the forecasters move). */
export function useConsensus(symbol, enabled = true) {
  const url = `/api/admin/market/consensus/${enc(symbol || "")}`;
  const [s, setS] = useState(() => {
    const seen = enabled && symbol ? peek(url, 60000) : null;
    return seen ? { loading: false, data: seen, error: "" } : { loading: Boolean(enabled && symbol), data: null, error: "" };
  });
  useEffect(() => {
    let alive = true;
    if (!enabled || !symbol) return undefined;
    const seen = peek(url, 60000);
    setS(seen ? { loading: false, data: seen, error: "" } : { loading: true, data: null, error: "" });
    const read = () =>
      api(url)
        .then((d) => alive && setS({ loading: false, data: d, error: "" }))
        .catch((e) => alive && setS((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    const stop = everyVisible(read, 30000, { topics: ["horizon", "evidence"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [url, symbol, enabled]);
  return s;
}

/** One horizon: the price, the band drawn as a bar around today's price, the chance of a rise. */
function Tile({ h, anchor }) {
  const side = h.lean === "up" ? "up" : h.lean === "down" ? "down" : "flat";
  const lo = Math.min(h.low, anchor);
  const hi = Math.max(h.high, anchor);
  const span = hi - lo || 1;
  const at = (v) => `${(((v - lo) / span) * 100).toFixed(1)}%`;
  return (
    <div className={`cs-tile cs-tile--${side}`}>
      <div className="cs-tile__top">
        <span className="cs-tile__k">In {h.minutesAhead} min</span>
        <small>for {clock(h.at)}</small>
      </div>
      <b className="cs-tile__price">{inr(h.price)}</b>
      <span className={`cs-tile__move cs-tile__move--${side}`}>{sgn(h.pct)}</span>
      <div className="cs-band" role="img" aria-label={`Likely between ${inr(h.low)} and ${inr(h.high)}; now ${inr(anchor)}`}>
        <i className="cs-band__fill" style={{ left: at(h.low), width: `calc(${at(h.high)} - ${at(h.low)})` }} />
        <i className="cs-band__now" style={{ left: at(anchor) }} />
        <i className={`cs-band__mid cs-band__mid--${side}`} style={{ left: at(h.price) }} />
      </div>
      <span className="cs-tile__band">
        likely {inr(h.low)} – {inr(h.high)}
      </span>
      <span className="cs-tile__p">
        Chance of a rise <b>{pc(h.pUp)}</b> · {TIER[h.tier] || h.tier}
      </span>
    </div>
  );
}

/** The record: the blend and the forecaster alone, scored on the same forecasts. */
function Record({ r, label }) {
  if (!r || !r.checks) return <li>{label}: no forecast checked yet — the forecaster's own numbers lead until the blend has a record.</li>;
  return (
    <li>
      {label}: {r.checks} checks over {r.days} session{r.days === 1 ? "" : "s"} — direction right <b>{pc(r.blend.dirAcc)}</b> for the blend, {pc(r.forecaster.dirAcc)} for the forecaster alone; average miss {r.blend.missAvg} against {r.forecaster.missAvg} usual moves{" "}
      <span className={`cs-proof ${r.proven ? "is-on" : ""}`}>{r.proven ? "blend proven" : "blend in trial"}</span>
    </li>
  );
}

/** The refiner (a second stage): the top of the book, today's volatility, the conformal band and the off-form alarm. */
function Refiner({ d, h }) {
  const rf = h && h.refine;
  if (!rf) return null;
  const r = rf.record || {};
  const band = r.band || {};
  const mean = r.mean || {};
  return (
    <div className={`cs-refine ${d.offForm ? "is-off" : ""}`} aria-label="The refiner">
      {d.offForm && (
        <p className="cs-refine__alarm" role="status">
          Off-form session: the forecasts are missing clearly more than usual today, so no lean is shown stronger than slight.
        </p>
      )}
      <ul className="cs-parts">
        <li>
          <span>Microprice</span>
          <b>{d.topOfBook ? inr(d.topOfBook.microprice) : "—"}</b>
          <small>{d.topOfBook ? `bid ${inr(d.topOfBook.bid)} × ${d.topOfBook.bidQty.toLocaleString("en-IN")} · offer ${inr(d.topOfBook.ask)} × ${d.topOfBook.askQty.toLocaleString("en-IN")}` : "no best bid and offer"}</small>
        </li>
        <li>
          <span>Today's volatility</span>
          <b>{d.volatility && d.volatility.ratio != null ? `${d.volatility.ratio}× usual` : "—"}</b>
          <small>{d.volatility ? d.volatility.read : "too few bars yet"}</small>
          {d.volatility && d.volatility.expected != null && (
            <small className="cs-refine__outlook">
              Last days: {d.volatility.expected}× expected — {d.volatility.outlook}
            </small>
          )}
        </li>
        <li>
          <span>Conformal band</span>
          <b>{rf.conformal ? `${inr(rf.conformal.low)} – ${inr(rf.conformal.high)}` : "learning"}</b>
          <small>{band.checks ? `held ${pc(band.coverage)} (old band ${pc(band.oldCoverage)}) · stated 70%` : "from the forecast's own misses, once there are enough"}</small>
          {r.band2 && r.band2.checks > 0 && (
            <small>
              multi-day band held {pc(r.band2.coverage)} · {r.bandBy === "multi" ? "in use" : "in trial"}
            </small>
          )}
        </li>
        <li>
          <span>Refiner</span>
          <b>{h.refined ? "in use" : "in trial"}</b>
          <small>{r.checks ? `${r.checks} checks · centre ${mean.proven ? "proven" : "in trial"} · band ${band.proven ? "proven" : "in trial"}` : "no check yet"}</small>
        </li>
      </ul>
    </div>
  );
}

export default function ConsensusCard({ symbol, enabled = true, compact = false, state = null }) {
  const own = useConsensus(symbol, enabled && !state);
  const s = state || own;
  const [more, setMore] = useState(false);
  const d = s.data;
  if (!enabled || !symbol) return null;
  if (!d)
    return (
      <section className="cs cs--wait">
        {s.error ? <p className="adm-alert adm-alert--info">The consensus forecast is not available: {s.error}</p> : <p className="cs-dim">Reading the consensus forecast…</p>}
      </section>
    );
  if (!d.available)
    return (
      <section className="cs cs--wait" aria-label={`The consensus forecast for ${symbol}`}>
        <header className="cs-head">
          <h3>Consensus forecast</h3>
        </header>
        <p className="cs-dim">{d.reason || "No forecast now."}</p>
      </section>
    );
  const h15 = d.horizons.find((h) => h.key === "15") || d.horizons[d.horizons.length - 1];
  const side = h15 && h15.lean !== "none" ? h15.lean : "flat";
  const leads = h15 ? h15.leads : "forecaster";
  const rec = d.record || {};
  return (
    <section className={`cs cs--${side} ${compact ? "cs--compact" : ""}`} aria-label={`The consensus forecast for ${symbol}`}>
      <header className="cs-head">
        <h3>Consensus forecast</h3>
        <span className={`cs-lead ${leads === "blend" ? "is-blend" : ""}`} data-tip="Who leads: the blend of the three forecasters and the order book once its checked record beats the forecaster alone; the 15-minute forecaster until then.">
          led by the {leads === "blend" ? "blend" : "forecaster"}
          {h15 && h15.refined ? " + refiner" : ""}
        </span>
        <small className="cs-when">from the bar that closed at {clock(d.anchor.at)} · now {inr(d.anchor.price)}</small>
      </header>
      <div className="cs-tiles">
        {d.horizons.map((h) => (
          <Tile key={h.key} h={h} anchor={d.anchor.price} />
        ))}
      </div>
      {(d.firstUp || d.firstDown) && (
        <p className="cs-first">
          Likely touched first —{" "}
          {d.firstUp ? (
            <span>
              above: <b>{d.firstUp.name}</b> {inr(d.firstUp.price)} ({pc(d.firstUp.p15)} within 15 min)
            </span>
          ) : null}
          {d.firstUp && d.firstDown ? " · " : null}
          {d.firstDown ? (
            <span>
              below: <b>{d.firstDown.name}</b> {inr(d.firstDown.price)} ({pc(d.firstDown.p15)})
            </span>
          ) : null}
        </p>
      )}
      {!compact && h15 && (
        <ul className="cs-parts" aria-label="What it was blended from">
          <li>
            <span>15-minute forecaster</span>
            <b>{inr(h15.forecaster.price)}</b>
            <small>rise {pc(h15.forecaster.pUp)}</small>
          </li>
          <li>
            <span>Evidence desk</span>
            <b>{h15.parts.evidence ? (h15.parts.evidence.lean === "none" ? "no lean" : h15.parts.evidence.lean) : "—"}</b>
            <small>{h15.parts.evidence ? `rise ${pc(h15.parts.evidence.pUp)} · fall ${pc(h15.parts.evidence.pDown)}` : "not read"}</small>
          </li>
          <li>
            <span>Early calls</span>
            <b>{h15.parts.early ? h15.parts.early.tone || "—" : "—"}</b>
            <small>{h15.parts.early ? h15.parts.early.read : "not read"}</small>
          </li>
          <li>
            <span>Order book</span>
            <b>{h15.parts.book ? `${pc(h15.parts.book.buyShare)} buy` : "—"}</b>
            <small>{h15.parts.book ? `${h15.parts.book.buyQty.toLocaleString("en-IN")} to buy · ${h15.parts.book.sellQty.toLocaleString("en-IN")} to sell` : "not read"}</small>
          </li>
        </ul>
      )}
      {!compact && <Refiner d={d} h={h15} />}
      {compact && d.offForm && <p className="cs-refine__alarm" role="status">Off-form session: leans capped at slight.</p>}
      <ul className="cs-record">
        <Record r={rec["5"]} label="5 min" />
        <Record r={rec["15"]} label="15 min" />
      </ul>
      {!compact && (
        <>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm cs-more" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? "Hide how it is weighed" : "How it is weighed"}
          </button>
          {more && (
            <div className="cs-how">
              {h15 && (
                <ul className="cs-weights">
                  {h15.contributions
                    .filter((c) => c.input !== "bias" || Math.abs(c.adds) > 0.0001)
                    .map((c) => (
                      <li key={c.input}>
                        <span>{INPUT[c.input] || c.input}</span>
                        <small>weight {c.weight}</small>
                        <b className={c.adds > 0 ? "is-up" : c.adds < 0 ? "is-down" : ""}>{sgn(c.adds, 3)}</b>
                      </li>
                    ))}
                </ul>
              )}
              <p>{d.rule}</p>
              <p>{d.checkRule}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
