// Measured odds for one stock: what followed the past days most like today, and whether such
// calls held up when each was made from earlier data only (the forward test). Frequencies
// from the stock's own history after assumed costs — never a forecast, never advice.
//
// Used on the Advisor board (given a reading) and in each stock's "Behaviour & AI" tab
// (fetches its own).

import React, { useCallback, useEffect, useState } from "react";
import { api, peek } from "../../api";
import { Alert, Loading } from "../../ui";
import { day, inr, isNum, num, pct } from "../analyzer/format";
import { useTick } from "../analyzer/liveTicks";
import { useTrade } from "../trade/TradeContext";
import { GRADE_WORD, callLabel, dayStillOpen, planAt, qtyForRisk, signedR, ticketFor } from "./advisorMath";
import { useRisk } from "./useRisk";
import "./advisor.css";

const GRADE_TIP = {
  A: "Grade A: today reads favourable AND the method held up on this stock when tested forward — enough trades, a clearly positive average after costs, and still positive in the last two years.",
  B: "Grade B: today reads favourable and the forward test is positive, but not strongly enough to rule out luck.",
  C: "Grade C: today's similar days look favourable, but the forward test does NOT back the method on this stock. Treat it as noise.",
  none: "No favourable reading: the similar days do not show a positive result after costs with enough certainty.",
};

export function Grade({ g, short = false }) {
  const k = g || "none";
  return (
    <span className={`av-grade av-grade--${k}`} data-tip={GRADE_TIP[k]}>
      {g ? (short ? g : `${g} · ${GRADE_WORD[g]}`) : short ? "–" : "No edge"}
    </span>
  );
}

/** The share of similar days that made money: a thin bar with the halfway mark and the cautious bound. */
export function OddsBar({ live }) {
  if (!live) return null;
  const w = Math.max(0, Math.min(100, live.winPct));
  return (
    <span className={`av-bar ${live.fires ? "is-on" : ""}`} role="img" aria-label={`${live.winPct}% of ${live.n} similar days made money; at least ${live.winLoPct}% on a cautious reading`}>
      <i style={{ width: `${w}%` }} />
      <b style={{ left: `${Math.max(0, Math.min(100, live.winLoPct))}%` }} />
      <u />
    </span>
  );
}

function Row({ k, tip, children }) {
  return (
    <div data-tip={tip}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Side({ symbol, kind, side, rules, x, atr, last, risk }) {
  const trade = useTrade();
  const tradeable = !(kind === "swing" && side === "short");
  const live = x.live;
  const o = x.oos;
  // a swing entry is taken at the price now; a day reading stands or falls with the open
  const plan = kind === "swing" ? planAt(rules, side, isNum(last) ? last : x.plan && x.plan.entryRef, atr) || x.plan : x.plan;
  const still = kind === "day" && plan ? dayStillOpen(side, plan, last) : { ok: true, drift: null, why: "" };
  const qty = plan ? qtyForRisk(risk, plan.riskPerShare) : 0;
  const off = !trade || !trade.enabled || !trade.connected;
  const usable = Boolean(x.grade && x.grade !== "C" && plan && tradeable && still.ok);
  return (
    <section className={`av-side av-side--${x.grade || "none"}`}>
      <header>
        <b>{callLabel(kind, side)}</b>
        <Grade g={x.grade} />
      </header>
      <dl>
        <Row k="Similar days" tip="The past days of this stock most like today — by trend, momentum, place in its range, volume, volatility and the market — kept a few sessions apart so one episode is not counted many times.">
          {live ? (
            <>
              <b>{num(live.winPct, 0)}%</b> of {live.n} made money <small>(at least {num(live.winLoPct, 0)}%)</small>
              <OddsBar live={live} />
            </>
          ) : (
            "too few to say"
          )}
        </Row>
        {live && (
          <Row k="Average result" tip="The average outcome of the fixed-rule trade on those days, after costs, in R — multiples of the amount risked. The bracket is a cautious reading: the average minus one standard error.">
            <b className={live.expR > 0 ? "is-up" : live.expR < 0 ? "is-down" : ""}>{signedR(live.expR)}</b> <small>(at least {signedR(live.expRLo)})</small>
            {rules.targetAtr !== null && (
              <small>
                {" "}
                · target {num(live.targetPct, 0)}% · stop {num(live.stopPct, 0)}%
              </small>
            )}
          </Row>
        )}
        <Row k="Forward test" tip="Every past day was read using only what was known before it, and each favourable call was traded on paper, one at a time. This is how those trades did — the evidence the grade rests on. t is the average divided by its standard error: about 2.5 or more is hard to get by luck.">
          {o.trades ? (
            <>
              <b>{o.trades}</b> trades · {num(o.winPct, 0)}% won · <b className={o.expR > 0 ? "is-up" : o.expR < 0 ? "is-down" : ""}>{signedR(o.expR)}</b> each · t {isNum(o.t) ? o.t.toFixed(1) : "—"}
              <small>
                {" "}
                · profit factor {isNum(o.pf) ? o.pf.toFixed(2) : "—"} · worst run {signedR(-o.maxDdR, 1)}
              </small>
            </>
          ) : (
            "no favourable calls in its history"
          )}
        </Row>
        {o.recent && o.recent.trades > 0 && (
          <Row k="Last two years" tip="The same forward test over the most recent 500 sessions only. A method that worked years ago and not lately is not graded A or B.">
            {o.recent.trades} trades · <b className={o.recent.expR > 0 ? "is-up" : o.recent.expR < 0 ? "is-down" : ""}>{signedR(o.recent.expR)}</b> each
          </Row>
        )}
        <Row k="Taking every day" tip="The yardstick: the same trade taken on every day without choosing. A method earns its keep only by beating this.">
          {o.base && o.base.n ? (
            <>
              {num(o.base.winPct, 0)}% won · {signedR(o.base.expR)} each
            </>
          ) : (
            "—"
          )}
        </Row>
      </dl>
      <p className="av-why">{x.why}</p>
      {!tradeable && <p className="av-why">Shares cannot be held short overnight in the cash market: read this side as a warning for longs, not as a trade.</p>}
      {plan && tradeable && x.grade && (
        <div className={`av-plan ${still.ok ? "" : "is-gone"}`}>
          <span data-tip={kind === "swing" ? "Priced from the latest price by the engine's rules: stop 1.5 ATR away, target 2.25 ATR (1.5 times the risk), out after 10 sessions if neither is touched." : "Priced from today's open by the engine's rules: stop 0.6 ATR away, out at the close. No target."}>
            {kind === "swing" ? "At" : "From the open"} <b>{inr(plan.entryRef)}</b> · stop <b>{inr(plan.stop)}</b>
            {plan.target !== null && (
              <>
                {" "}
                · target <b>{inr(plan.target)}</b>
              </>
            )}{" "}
            · risk {inr(plan.riskPerShare)} a share
          </span>
          <span data-tip="Shares for your chosen risk per trade: the risk divided by the distance to the stop.">
            <b>{qty > 0 ? num(qty, 0) : "0"}</b> shares for {inr(risk, 0)} risk
          </span>
          {!still.ok && <span className="is-warn">{still.why}</span>}
          {trade && (
            <button
              type="button"
              className={`tr-btn tr-btn--${side === "long" ? "buy" : "sell"}`}
              disabled={off || !usable}
              onClick={() => trade.openTicket(ticketFor(symbol, kind, side, plan, risk, `Measured odds · ${callLabel(kind, side)} · grade ${x.grade}`))}
              data-tip={off ? (trade && !trade.connected ? "Zerodha is not connected." : "Trading is switched OFF. Turn it on in Positions.") : !usable ? (still.ok ? "A ticket is offered only for a grade A or B reading." : still.why) : "Open an order ticket with this plan: quantity for your risk, the stop and the target filled in. You confirm before anything is sent."}
            >
              Ticket
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Kind({ symbol, id, title, sub, k, atr, last, risk }) {
  return (
    <div className="av-kind">
      <h4>
        {title} <small>{sub}</small>
      </h4>
      {k.preOpen && <p className="av-why">Today’s open is not known yet: this reading does not use the gap, and gives no entry price until the session opens.</p>}
      <div className="av-sides">
        <Side symbol={symbol} kind={id} side="long" rules={k} x={k.long} atr={atr} last={last} risk={risk} />
        <Side symbol={symbol} kind={id} side="short" rules={k} x={k.short} atr={atr} last={last} risk={risk} />
      </div>
    </div>
  );
}

/**
 * @param report  a reading already loaded (the Advisor board), or omit it and the card
 *                fetches the stock's own
 * @param embedded  inside the board: no card frame, no title
 */
export default function EdgeCard({ symbol, report = null, embedded = false }) {
  const [s, setS] = useState(() => ({ loading: !report, r: report || peek(`/api/admin/market/edge/${encodeURIComponent(symbol)}`, 10 * 60 * 1000), error: "" }));
  const [risk] = useRisk();
  const tick = useTick(symbol);
  const load = useCallback(
    (refresh = false) => {
      setS((x) => ({ ...x, loading: true, error: "" }));
      api(`/api/admin/market/edge/${encodeURIComponent(symbol)}${refresh ? "?refresh=1" : ""}`)
        .then((r) => setS({ loading: false, r, error: "" }))
        .catch((e) => setS((x) => ({ loading: false, r: x.r, error: e.message })));
    },
    [symbol]
  );
  useEffect(() => {
    if (report) setS({ loading: false, r: report, error: "" });
    else load(false);
  }, [report, load]);

  const r = s.r;
  const last = tick && isNum(tick.last) ? tick.last : r && isNum(r.last) ? r.last : r ? r.close : null;
  const body = !r ? (
    s.loading ? (
      <Loading label="Finding the days most like today, and testing the method forward…" />
    ) : (
      <Alert>{s.error}</Alert>
    )
  ) : !r.available ? (
    <p className="adm-alert adm-alert--info">{r.reason}</p>
  ) : (
    <>
      <Alert>{s.error}</Alert>
      {r.warning && <p className="tr-note is-warn">{r.warning}</p>}
      <div className="av-kinds">
        <Kind symbol={symbol} id="swing" title="Swing" sub="in at the next open · stop 1.5 ATR · target 2.25 ATR · out after 10 sessions" k={r.kinds.swing} atr={r.atr} last={last} risk={risk} />
        <Kind symbol={symbol} id="day" title="Day" sub="in at the open · stop 0.6 ATR · out at the close" k={r.kinds.day} atr={r.atr} last={last} risk={risk} />
      </div>
      <div className="av-more">
        {r.kinds.swing.forward && (
          <div>
            <h4 data-tip="What the stock did, close to close, after the days most like today. No stop, no target, no costs: just where it went.">After similar days</h4>
            <table className="an-table av-fwd">
              <thead>
                <tr>
                  <th scope="col">Sessions later</th>
                  <th scope="col" className="is-num">
                    Average move
                  </th>
                  <th scope="col" className="is-num">
                    Closed higher
                  </th>
                </tr>
              </thead>
              <tbody>
                {[1, 3, 5, 10].map((d) =>
                  r.kinds.swing.forward[`d${d}`] ? (
                    <tr key={d}>
                      <th scope="row">{d}</th>
                      <td className={`is-num ${r.kinds.swing.forward[`d${d}`].avgPct > 0 ? "is-up" : r.kinds.swing.forward[`d${d}`].avgPct < 0 ? "is-down" : ""}`}>{pct(r.kinds.swing.forward[`d${d}`].avgPct)}</td>
                      <td className="is-num">{num(r.kinds.swing.forward[`d${d}`].upPct, 0)}%</td>
                    </tr>
                  ) : null
                )}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <h4 data-tip="The six past days that looked most like today, and what a swing long taken the next morning did, in R after costs. Open the chart at these dates to see them for yourself.">Most similar days</h4>
          <ul className="av-analogs">
            {r.kinds.swing.analogs.map((a) => (
              <li key={a.date}>
                <time>{day(a.date)}</time>
                <b className={a.longR > 0 ? "is-up" : a.longR < 0 ? "is-down" : ""}>{isNum(a.longR) ? signedR(a.longR) : "open"}</b>
              </li>
            ))}
          </ul>
        </div>
        {r.kinds.swing.long.oos.calibration && r.kinds.swing.long.oos.calibration.length > 1 && (
          <div>
            <h4 data-tip="A check on the odds themselves: over the forward test, when the similar days said a swing long would win this often, how often did it? Close numbers mean the odds can be believed.">Were its odds honest?</h4>
            <table className="an-table av-fwd">
              <thead>
                <tr>
                  <th scope="col">It said</th>
                  <th scope="col" className="is-num">
                    It was
                  </th>
                  <th scope="col" className="is-num">
                    Days
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.kinds.swing.long.oos.calibration.map((c) => (
                  <tr key={c.range}>
                    <th scope="row">
                      {c.range} <small>avg {num(c.predictedPct, 0)}%</small>
                    </th>
                    <td className="is-num">{num(c.realisedPct, 0)}%</td>
                    <td className="is-num">{c.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="vd-note">
        Measured from {num(r.bars, 0)} completed daily bars to {day(r.asOf)}; ATR {inr(r.atr)}
        {isNum(r.gapAtr) ? ` · today opened ${r.gapAtr > 0 ? "+" : ""}${r.gapAtr.toFixed(2)} ATR from that close` : ""}. Costs assumed: 0.25% a swing trade, 0.1% a day trade. These are frequencies from this stock’s own past — not a forecast, not a probability of profit, and not advice.
      </p>
    </>
  );

  if (embedded) return <div className="av-card av-card--in">{body}</div>;
  return (
    <section className="an-card av-card">
      <header className="an-card__head">
        <div>
          <h3>Measured odds</h3>
          <p>What followed the past days of {symbol} most like today, and whether such calls held up when each was made from earlier data only. A grade needs both.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => load(true)} disabled={s.loading} data-tip="Measure again from the latest daily bars.">
          {s.loading ? "Measuring…" : "Refresh"}
        </button>
      </header>
      {body}
    </section>
  );
}
