// The Advisor: the whole watchlist read by the measured-odds engine, side by side.
//
// For every stock: the best reading today (swing or day, long or short), how the days most
// like today turned out, the forward test that decides whether to believe it, and a plan
// priced at the latest price with the quantity for your chosen risk. Beneath it, two records
// that keep the engine honest: the method pooled across your watchlist, and the forward
// record — every favourable call written down the day it was made and scored afterwards.
//
// It measures and reports. It never places an order, and a grade is not a promise.

import React, { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, peek } from "../../api";
import { Alert } from "../../ui";
import { day, inr, isNum, num, pct, when } from "../analyzer/format";
import { TickContext, useLiveTicks, useTick } from "../analyzer/liveTicks";
import { useTrade } from "../trade/TradeContext";
import EdgeCard, { Grade, OddsBar } from "./EdgeCard";
import { callLabel, dayStillOpen, headline, planAt, qtyForRisk, rankRows, signedR, tally, ticketFor, verdictOf } from "./advisorMath";
import { useRisk } from "./useRisk";
import "./advisor.css";

const SHOW = [
  { id: "all", label: "All" },
  { id: "fav", label: "Favourable" },
  { id: "proven", label: "A and B only" },
];
const VERDICT_TIP = {
  proven: "Enough trades, a clearly positive average after costs, and a t of 2.5 or more: hard to get by luck.",
  promising: "Positive after costs, but the evidence is not strong enough to rule out luck.",
  unproven: "No edge shown: the result is within what chance alone produces.",
  loses: "Clearly negative after costs. Calls of this kind have cost money.",
  none: "No trades yet.",
};

function Price({ symbol, fallback, prev }) {
  const tick = useTick(symbol);
  const last = tick && isNum(tick.last) ? tick.last : fallback;
  const base = tick && isNum(tick.prevClose) ? tick.prevClose : prev;
  const chg = isNum(last) && isNum(base) && base > 0 ? ((last - base) / base) * 100 : null;
  return (
    <small className="av-px">
      {inr(last)} {chg !== null && <b className={chg > 0 ? "is-up" : chg < 0 ? "is-down" : ""}>{pct(chg)}</b>}
    </small>
  );
}

function BoardRow({ row, risk, open, onToggle, onOpen }) {
  const trade = useTrade();
  const tick = useTick(row.symbol);
  const h = headline(row);
  const last = tick && isNum(tick.last) ? tick.last : isNum(row.last) ? row.last : row.close;

  if (!row.available) {
    return (
      <tr className="av-row av-row--idle">
        <th scope="row">
          <button type="button" className="av-sym" onClick={() => onOpen(row.symbol)} data-tip={`Open ${row.symbol} on the Desk.`}>
            {row.symbol}
          </button>
        </th>
        <td colSpan={7} className={row.pending ? "av-pending" : ""}>
          {row.error ? row.error : row.pending ? "Measuring: finding similar days and testing the method forward…" : row.reason}
        </td>
      </tr>
    );
  }

  const tradeable = h && !(h.kind === "swing" && h.side === "short");
  const plan = h ? (h.kind === "swing" ? planAt(h.rules, h.side, last, row.atr) || h.plan : h.plan) : null;
  const still = h && h.kind === "day" && plan ? dayStillOpen(h.side, plan, last) : { ok: true, why: "" };
  const qty = plan ? qtyForRisk(risk, plan.riskPerShare) : 0;
  const off = !trade || !trade.enabled || !trade.connected;
  const usable = Boolean(h && h.grade !== "C" && plan && tradeable && still.ok);
  // with no favourable reading, the plain swing-long odds are still shown: "nothing here" is information too
  const quiet = h ? null : row.kinds.swing.long;
  const shown = h || quiet;
  const o = shown.oos;

  return (
    <Fragment>
      <tr className={`av-row av-row--${h ? h.grade : "none"} ${open ? "is-open" : ""}`}>
        <th scope="row">
          <button type="button" className="av-sym" aria-expanded={open} onClick={onToggle} data-tip="Show every reading for this stock: swing and day, long and short, the similar days and the forward test.">
            <i aria-hidden="true">{open ? "▾" : "▸"}</i>
            {row.symbol}
          </button>
          <Price symbol={row.symbol} fallback={last} prev={row.close} />
        </th>
        <td>
          {h ? (
            <>
              <b className={h.side === "long" ? "av-long" : "av-short"}>{callLabel(h.kind, h.side)}</b> <Grade g={h.grade} short />
            </>
          ) : (
            <span className="av-mute">No favourable reading</span>
          )}
          {row.warning && (
            <small className="av-warn" data-tip={row.warning}>
              downside warning
            </small>
          )}
          {!row.fresh && <small className="av-mute">being refreshed</small>}
        </td>
        <td>
          {shown.live ? (
            <>
              <b>{num(shown.live.winPct, 0)}%</b> <small>of {shown.live.n}</small>
              <OddsBar live={shown.live} />
            </>
          ) : (
            <span className="av-mute">too few</span>
          )}
        </td>
        <td>
          {shown.live ? (
            <>
              <b className={shown.live.expR > 0 ? "is-up" : shown.live.expR < 0 ? "is-down" : ""}>{signedR(shown.live.expR)}</b>
              <small>at least {signedR(shown.live.expRLo)}</small>
            </>
          ) : (
            "—"
          )}
        </td>
        <td>
          {o.trades ? (
            <>
              <b className={o.expR > 0 ? "is-up" : o.expR < 0 ? "is-down" : ""}>{signedR(o.expR)}</b> <small>× {o.trades}</small>
              <small>
                {num(o.winPct, 0)}% won · t {isNum(o.t) ? o.t.toFixed(1) : "—"}
              </small>
            </>
          ) : (
            <span className="av-mute">no calls</span>
          )}
        </td>
        <td>
          {h && plan && tradeable ? (
            <>
              <span className="av-levels">
                {num(plan.entryRef)} <i aria-hidden="true">→</i> <b className="is-down">{num(plan.stop)}</b>
                {plan.target !== null && (
                  <>
                    {" "}
                    / <b className="is-up">{num(plan.target)}</b>
                  </>
                )}
              </span>
              <small className={still.ok ? "" : "av-warn"}>{still.ok ? (h.kind === "day" ? "from the open · out at the close" : `risk ${inr(plan.riskPerShare)} a share`) : "the entry has gone"}</small>
            </>
          ) : h && !tradeable ? (
            <span className="av-mute">a warning, not a trade</span>
          ) : (
            <span className="av-mute">—</span>
          )}
        </td>
        <td className="is-num">{h && plan && tradeable ? <b>{num(qty, 0)}</b> : "—"}</td>
        <td className="av-act">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpen(row.symbol)} data-tip={`Open ${row.symbol} on the Desk: chart, live call, order book.`}>
            Desk
          </button>
          {trade && h && tradeable && (
            <button
              type="button"
              className={`tr-btn tr-btn--${h.side === "long" ? "buy" : "sell"}`}
              disabled={off || !usable}
              onClick={() => trade.openTicket(ticketFor(row.symbol, h.kind, h.side, plan, risk, `Measured odds · ${callLabel(h.kind, h.side)} · grade ${h.grade}`))}
              data-tip={off ? (!trade.connected ? "Zerodha is not connected." : "Trading is switched OFF. Turn it on in Positions.") : !usable ? (still.ok ? "A ticket is offered only for a grade A or B reading." : still.why) : "Open an order ticket with this plan: the quantity for your risk, the stop and the target. You confirm before anything is sent."}
            >
              Ticket
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="av-detail">
          <td colSpan={8}>
            <EdgeCard symbol={row.symbol} report={row} embedded />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Pooled({ board }) {
  const rows = Object.values(board.pooled || {});
  return (
    <section className="an-card">
      <header className="an-card__head">
        <div>
          <h3>Does the method work on your watchlist?</h3>
          <p>The forward test of every stock on the board, added together. One stock can look good by luck; a method that holds across many is harder to fake.</p>
        </div>
      </header>
      <table className="an-table av-rec">
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col" className="is-num">
              Trades
            </th>
            <th scope="col" className="is-num">
              Won
            </th>
            <th scope="col" className="is-num">
              Each
            </th>
            <th scope="col" className="is-num" data-tip="The average result divided by its standard error. About 2.5 or more is hard to get by luck.">
              t
            </th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const v = verdictOf(p, board.proof);
            return (
              <tr key={`${p.kind}.${p.side}`}>
                <th scope="row">
                  {callLabel(p.kind, p.side)} <small>{p.stocks} stocks</small>
                </th>
                <td className="is-num">{num(p.trades, 0)}</td>
                <td className="is-num">{isNum(p.winPct) ? `${num(p.winPct, 0)}%` : "—"}</td>
                <td className={`is-num ${p.expR > 0 ? "is-up" : p.expR < 0 ? "is-down" : ""}`}>{signedR(p.expR)}</td>
                <td className="is-num">{isNum(p.t) ? p.t.toFixed(1) : "—"}</td>
                <td>
                  <span className={`av-verdict av-verdict--${v.id}`} data-tip={VERDICT_TIP[v.id]}>
                    {v.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="vd-note">After assumed costs, one trade at a time per stock. Stocks move together, so the pooled t is somewhat flattering: read a borderline result as unproven.</p>
    </section>
  );
}

function Forward({ log, proof }) {
  const groups = (log && log.summary) || [];
  const order = ["all", "grade A", "grade B", "grade C", "swing long", "day long", "day short", "swing short"];
  const shown = order.map((k) => groups.find((g) => g.key === k)).filter(Boolean);
  const recent = (log && log.signals ? log.signals : []).slice(0, 12);
  return (
    <section className="an-card">
      <header className="an-card__head">
        <div>
          <h3>Forward record</h3>
          <p>Every favourable call is written down on the day it is made, before anyone knows how it ends, and scored later against the real bars by the engine’s own rules. Hindsight cannot improve it.</p>
        </div>
      </header>
      {!shown.length ? (
        <p className="adm-alert adm-alert--info">No calls yet. The record starts with the first favourable reading and fills in as each call’s outcome becomes known — a day for a day call, up to ten sessions for a swing.</p>
      ) : (
        <>
          <table className="an-table av-rec">
            <thead>
              <tr>
                <th scope="col">Calls</th>
                <th scope="col" className="is-num">
                  Made
                </th>
                <th scope="col" className="is-num">
                  Open
                </th>
                <th scope="col" className="is-num">
                  Won
                </th>
                <th scope="col" className="is-num">
                  Each
                </th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const v = verdictOf({ trades: g.scored, expR: g.expR, t: g.t }, proof);
                return (
                  <tr key={g.key}>
                    <th scope="row">{g.key === "all" ? "All calls" : g.key.replace(/^grade /, "Grade ").replace(/^(swing|day) /, (m) => m[0].toUpperCase() + m.slice(1))}</th>
                    <td className="is-num">{g.calls}</td>
                    <td className="is-num">{g.open}</td>
                    <td className="is-num">{g.scored ? `${num(g.winPct, 0)}% of ${g.scored}` : "—"}</td>
                    <td className={`is-num ${g.expR > 0 ? "is-up" : g.expR < 0 ? "is-down" : ""}`}>{g.scored ? signedR(g.expR) : "—"}</td>
                    <td>
                      <span className={`av-verdict av-verdict--${v.id}`} data-tip={VERDICT_TIP[v.id]}>
                        {v.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h4>Latest calls</h4>
          <ul className="av-calls">
            {recent.map((s) => (
              <li key={s.id}>
                <time>{day(s.asOf, { day: "numeric", month: "short" })}</time>
                <b>{s.symbol}</b>
                <span>
                  {callLabel(s.kind, s.side)} <Grade g={s.grade} short />
                </span>
                {isNum(s.r) ? (
                  <b className={s.r > 0 ? "is-up" : "is-down"} data-tip={`Closed ${day(s.exitDate)} by ${s.how === "time" ? "the time limit" : `the ${s.how}`}.`}>
                    {signedR(s.r)}
                  </b>
                ) : (
                  <span className="av-mute">open</span>
                )}
              </li>
            ))}
          </ul>
          <p className="vd-note">Since {when(log.since)}. A few dozen scored calls are needed before this says anything.</p>
        </>
      )}
    </section>
  );
}

function Method({ board }) {
  const a = board.proof.A;
  const b = board.proof.B;
  return (
    <section className="an-card av-method">
      <header className="an-card__head">
        <div>
          <h3>How to read this</h3>
        </div>
      </header>
      <ol>
        <li>
          <b>Similar days.</b> Each past day of a stock is described by twelve numbers known at its close — trend, momentum, place in its 20-day and 52-week range, volume, volatility, and the Nifty. The 50 days most like today (kept apart in time) show what happened next.
        </li>
        <li>
          <b>Two fixed trades.</b> Swing: in at the next open, stop 1.5 ATR away, target 2.25 ATR, out after 10 sessions. Day: in at the open, stop 0.6 ATR away, out at the close. Results are in R — multiples of the amount risked — after costs.
        </li>
        <li>
          <b>The forward test decides.</b> Every past day is read from earlier data only and each favourable call traded on paper. <Grade g="A" short /> needs {a.trades}+ trades with t ≥ {a.t}; <Grade g="B" short /> needs {b.trades}+ with t ≥ {b.t}; <Grade g="C" short /> means today looks good but the test does not back it. On pure noise the engine finds nothing — a test checks that it does.
        </li>
        <li>
          <b>Size by risk.</b> Quantity is your risk per trade divided by the distance to the stop, so a loss costs about what you chose. The risk guard’s daily limits still apply.
        </li>
      </ol>
      <p className="vd-note">Frequencies from past prices, not forecasts. A proven record can stop working; no reading here is a probability of profit, and none of it is investment advice.</p>
    </section>
  );
}

export default function Advisor({ onOpen }) {
  const [board, setBoard] = useState(() => peek("/api/admin/market/edge", 10 * 60 * 1000));
  const [log, setLog] = useState(() => peek("/api/admin/market/signals", 10 * 60 * 1000));
  const [mode, setMode] = useState("");
  const [error, setError] = useState("");
  const [risk, setRisk] = useRisk();
  const [openRow, setOpenRow] = useState("");
  const [show, setShow] = useState("all");

  const load = useCallback(
    () =>
      api("/api/admin/market/edge")
        .then((d) => {
          setBoard(d);
          setError("");
          return d;
        })
        .catch((e) => {
          setError(e.message);
          return null;
        }),
    []
  );

  // while readings are being built the board is re-read every few seconds; after that, once a minute
  useEffect(() => {
    let alive = true;
    let timer = null;
    const loop = async () => {
      const d = await load();
      if (!alive) return;
      if (d && d.building === 0) api("/api/admin/market/signals").then((x) => alive && setLog(x)).catch(() => {});
      timer = setTimeout(loop, d && d.building > 0 ? 3000 : 60000);
    };
    loop();
    api("/api/admin/market/status")
      .then((s) => alive && setMode(s.mode))
      .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [load]);

  const symbols = useMemo(() => (board ? board.rows.map((r) => r.symbol) : []), [board]);
  const live = useLiveTicks(symbols, mode === "kite");
  const rows = useMemo(() => rankRows(board ? board.rows : []), [board]);
  const t = useMemo(() => tally(rows), [rows]);
  const visible = rows.filter((r) => (show === "all" ? true : show === "fav" ? r.available && r.best : r.available && r.best && r.best.grade !== "C"));
  const asOf = rows.find((r) => r.available);

  return (
    <TickContext.Provider value={live.store}>
      <div className="av">
        <header className="av-head">
          <div>
            <h2>Advisor</h2>
            <p>
              Your watchlist, read by measured odds: what followed the days most like today, and whether such calls held up when tested forward.
              {asOf ? ` Readings from completed bars to ${day(asOf.asOf)}.` : ""}
            </p>
          </div>
          <div className="av-tools">
            <label className="av-risk" data-tip="The money you accept losing if a trade hits its stop. The quantity on every row is this amount divided by the distance to the stop. Remembered in this browser.">
              <span>Risk per trade</span>
              <span className="av-risk__in">
                ₹
                <input type="number" inputMode="numeric" min="0" step="100" value={risk || ""} onChange={(e) => setRisk(e.target.value)} aria-label="Risk per trade in rupees" />
              </span>
            </label>
            <div className="av-seg" role="radiogroup" aria-label="Show">
              {SHOW.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={show === s.id} onClick={() => setShow(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </header>
        <Alert>{error}</Alert>

        {board && (
          <p className="av-tally" role="status">
            <span className="av-tally__n is-a" data-tip="Favourable today, and the method held up on that stock when tested forward.">
              <b>{t.A}</b> proven
            </span>
            <span className="av-tally__n is-b" data-tip="Favourable today; the forward test is positive but not conclusive.">
              <b>{t.B}</b> promising
            </span>
            <span className="av-tally__n is-c" data-tip="Favourable-looking today, but the forward test does not back it. Treat as noise.">
              <b>{t.C}</b> unproven
            </span>
            <span className="av-tally__n" data-tip="No favourable reading today. Most days, for most stocks, this is the honest answer.">
              <b>{t.none}</b> no edge
            </span>
            {t.warnings > 0 && (
              <span className="av-tally__n is-w" data-tip="Stocks whose similar days fell more often than not, with a forward test that backs it: a reason to avoid new longs there.">
                <b>{t.warnings}</b> downside {t.warnings === 1 ? "warning" : "warnings"}
              </span>
            )}
            {board.building > 0 && <span className="av-tally__busy">measuring {board.building} more…</span>}
          </p>
        )}

        <section className="an-card av-board">
          {!board ? (
            <p className="av-pending av-pending--block">Reading the board…</p>
          ) : !rows.length ? (
            <p className="adm-alert adm-alert--info">Your watchlist is empty. Add stocks on the Desk and they are measured here.</p>
          ) : (
            <div className="av-scroll">
              <table className="av-table">
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    <th scope="col" data-tip="The best reading for this stock today. Swing: held up to ten sessions. Day: this session only.">
                      Call
                    </th>
                    <th scope="col" data-tip="Of the past days most like today, the share where the fixed-rule trade made money after costs. The tick on the bar is a cautious lower reading; the line is 50%.">
                      Similar days won
                    </th>
                    <th scope="col" data-tip="The average result of the trade on those days, in R (multiples of the risk), after costs.">
                      Average
                    </th>
                    <th scope="col" data-tip="How favourable calls of this kind did on this stock when each was made from earlier data only: the average per trade, the number of trades, the win share and the t statistic.">
                      Forward test
                    </th>
                    <th scope="col" data-tip="Entry reference → stop / target, by the engine’s rules. A swing plan follows the latest price; a day plan is measured from today’s open.">
                      Plan
                    </th>
                    <th scope="col" className="is-num" data-tip="Shares for your risk per trade.">
                      Qty
                    </th>
                    <th scope="col">
                      <span className="adm-sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <BoardRow key={r.symbol} row={r} risk={risk} open={openRow === r.symbol} onToggle={() => setOpenRow((x) => (x === r.symbol ? "" : r.symbol))} onOpen={onOpen} />
                  ))}
                  {!visible.length && (
                    <tr>
                      <td colSpan={8} className="av-mute av-empty">
                        Nothing on the board meets that filter today. That is a result too: no trade is a position.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {board && (
          <div className="av-two">
            <Pooled board={board} />
            <Forward log={log} proof={board.proof} />
          </div>
        )}
        {board && <Method board={board} />}
      </div>
    </TickContext.Provider>
  );
}
