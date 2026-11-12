// The Day debrief: what the rule engine's calls would have done today, stock by stock,
// worked out by arithmetic — and, when an Anthropic key is set, read back by the model
// as a short review with a few lessons you can accept or ignore.
//
// The scorecard needs no AI. It replays the live call over the session's 5-minute bars
// for every stock on the watchlist and scores each "in play" call: stop first, then the
// 1R target, otherwise out at the 3:15 PM square-off — before and after an assumed cost.
// It is not a record of anything that was traded.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { adminPath } from "../../paths";
import { Alert, Loading } from "../../ui";
import { day as dayText, inr, isNum, num, pct, tone, when } from "./format";
import { useDeskTheme } from "./theme";
import { fmtR, WHY } from "./debriefMath";
import { NetBar, ReplayStrip, RunningTotal } from "./DebriefCharts";
import "./analyzer.css";

const COSTS = [
  { v: "0", label: "None" },
  { v: "0.05", label: "0.05%" },
  { v: "0.1", label: "0.1%" },
  { v: "0.2", label: "0.2%" },
];
const PHASE = { morning: "morning", midday: "midday", afternoon: "afternoon" };
const TREND = { with: "with the daily trend", against: "against the daily trend", neutral: "daily trend neutral" };
const rTone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "up" : "down");

// How many columns of the stock table fit: 6 on a desk, 4 on a tablet, 3 on a phone.
// The columns that do not fit are not rendered at all (hiding cells with CSS would leave
// the table with empty columns under the row that spans it).
const NARROW = ["(max-width: 560px)", "(max-width: 760px)"];
function useCols() {
  const can = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const read = () => (!can ? 6 : window.matchMedia(NARROW[0]).matches ? 3 : window.matchMedia(NARROW[1]).matches ? 4 : 6);
  const [cols, setCols] = useState(read);
  useEffect(() => {
    if (!can) return undefined;
    const lists = NARROW.map((q) => window.matchMedia(q));
    const on = () => setCols(read());
    lists.forEach((l) => l.addEventListener("change", on));
    on();
    return () => lists.forEach((l) => l.removeEventListener("change", on));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return cols;
}

function Tile({ k, v, sub, t }) {
  return (
    <div className={t ? `is-${t}` : ""}>
      <dt>{k}</dt>
      <dd>{v}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** One stock's replayed calls, as a table: every number the pictures show, without hovering. */
function Calls({ row }) {
  if (row.trades.length === 0) {
    return <p className="vd-note">The engine never said “in play” on {row.symbol} in this session: it waited, or stood aside. {row.changes.length} change{row.changes.length === 1 ? "" : "s"} of its call.</p>;
  }
  return (
    <div className="bt__scroll">
      <table className="an-table db-calls">
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col">Entry</th>
            <th scope="col">Stop</th>
            <th scope="col">Target</th>
            <th scope="col">How it ended</th>
            <th scope="col">Before costs</th>
            <th scope="col">Cost</th>
            <th scope="col">After costs</th>
          </tr>
        </thead>
        <tbody>
          {row.trades.map((t) => (
            <tr key={`${t.at}${t.side}`}>
              <th scope="row">
                <span className={`callchip is-${t.side}`}>{t.side === "long" ? "▲ Long" : "▼ Short"}</span> {t.at}
                <small>
                  {PHASE[t.phase] || t.phase} · score {t.score > 0 ? "+" : ""}
                  {t.score} · {TREND[t.withDaily] || ""}
                </small>
              </th>
              <td>{num(t.entry)}</td>
              <td>
                {num(t.stop)}
                <small>{num(t.riskPct)}% away</small>
              </td>
              <td>{isNum(t.target) ? num(t.target) : "—"}</td>
              <td>
                {WHY[t.why].mark} {WHY[t.why].label}
                <small>
                  {t.exitAt} at {num(t.exit)}
                </small>
              </td>
              <td className={`is-${rTone(t.r)}`}>{fmtR(t.r)}</td>
              <td>{fmtR(-t.costR)}</td>
              <td className={`is-${rTone(t.netR)}`}>
                <b>{fmtR(t.netR)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, max, open, onToggle, onOpen, cols }) {
  if (!row.available) {
    return (
      <tr className="db-row is-off">
        <th scope="row">{row.symbol}</th>
        <td colSpan={cols - 1} className="db-off">
          {row.reason}
        </td>
      </tr>
    );
  }
  const s = row.summary;
  const d = row.day;
  return (
    <>
      <tr className={`db-row ${open ? "is-open" : ""}`}>
        <th scope="row">
          <button type="button" className="db-toggle" aria-expanded={open} onClick={onToggle} data-tip="Open or close this stock’s day: its price, the side the engine was on, and each call.">
            <i aria-hidden="true">{open ? "−" : "+"}</i>
            {row.symbol}
          </button>
        </th>
        {cols >= 4 && (
          <td className={`db-mid is-${tone(d.changePct)}`}>
            {pct(d.changePct)}
            <small>since the open {pct(d.fromOpenPct)}</small>
          </td>
        )}
        <td>
          {s.calls}
          <small>
            {s.calls === 0
              ? `${s.callChanges} change${s.callChanges === 1 ? "" : "s"} of call`
              : [s.target && `✓ ${s.target}`, s.stop && `✕ ${s.stop}`, s.squareOff && `◦ ${s.squareOff}`, s.flip && `⇄ ${s.flip}`, s.open && `… ${s.open} open`].filter(Boolean).join("  ")}
          </small>
        </td>
        <td className="db-barcell">
          <NetBar value={s.netR} max={max} label={row.symbol} />
        </td>
        {cols === 6 && <td className="db-wide">{fmtR(s.grossR)}</td>}
        {cols === 6 && <td className="db-wide">{fmtR(-s.costR)}</td>}
      </tr>
      {open && (
        <tr className="db-detail">
          <td colSpan={cols}>
            <ReplayStrip row={row} />
            <Calls row={row} />
            <p className="vd-note">
              {row.symbol} on the day: opened {inr(d.open)} ({pct(d.gapPct)} gap), high {inr(d.high)}, low {inr(d.low)}, {d.complete ? "closed" : "last"} {inr(d.close)}
              {isNum(d.rangeVsAtr) ? ` — a range of ${num(d.rangeVsAtr, 1)}× a normal day` : ""}; finished {pct(d.closeVsVwapPct)} against VWAP ({inr(d.vwap)}) and{" "}
              {d.closedVsOpeningRange || "—"} the opening range ({num(d.orLow)} – {num(d.orHigh)}).{" "}
              {onOpen && (
                <button type="button" className="sv__add" onClick={() => onOpen(row.symbol)}>
                  Open {row.symbol} on the trading desk
                </button>
              )}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/** The model's reading of the day, with the lessons it suggests. */
function Written({ d, models, onLesson, busy }) {
  const model = (models.find((m) => m.id === d.model) || {}).name || d.model;
  return (
    <div className="ai-out db-written">
      <p className="vd-headline">{d.headline}</p>
      <p className="db-summary">{d.summary}</p>
      <div className="an-two">
        <div>
          <h4>What worked</h4>
          {d.worked.length ? (
            <ul className="ai-list">
              {d.worked.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="vd-note">Nothing it could point to.</p>
          )}
          {d.byStock.length > 0 && (
            <>
              <h4>Stock by stock</h4>
              <ul className="ai-list">
                {d.byStock.map((x) => (
                  <li key={x.symbol}>
                    <b>{x.symbol}:</b> {x.note}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h4>What did not</h4>
          {d.didNot.length ? (
            <ul className="ai-list ai-list--risk">
              {d.didNot.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="vd-note">Nothing it could point to.</p>
          )}
          {d.tomorrow.length > 0 && (
            <>
              <h4>Worth having in mind at the next open</h4>
              <ul className="ai-list">
                {d.tomorrow.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {d.copilotNote && (
        <p className="vd-note">
          <b>The co-pilot:</b> {d.copilotNote}
        </p>
      )}

      <h4>Lessons it suggests</h4>
      {d.lessons.length === 0 ? (
        <p className="vd-note">None — it found nothing that at least two of the day’s calls support. One day is a small sample, and no lesson is better than a weak one.</p>
      ) : (
        <ul className="db-lessons">
          {d.lessons.map((l, i) => (
            <li key={l.text}>
              <span>{l.text}</span>
              {l.added ? (
                <em>✓ in the skills file</em>
              ) : (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onLesson(d.id, i)} disabled={Boolean(busy)}>
                  Add to the skills file
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {d.lessons.length > 0 && <p className="vd-note">Nothing is saved unless you add it. A lesson you add is followed by the AI strategist from its next plan; you can edit or remove it on the AI strategist tab.</p>}

      {d.caveat && <p className="vd-note vd-note--caveat">{d.caveat}</p>}
      <p className="adm-small">
        {model} · written {when(d.at)} from {d.stocks} stock{d.stocks === 1 ? "" : "s"} and {d.totals.calls} replayed call{d.totals.calls === 1 ? "" : "s"}, with an assumed cost of {d.costPct}% a round
        trip{d.sawCopilot ? ", the co-pilot’s readings" : ""}
        {d.sawPlans ? ` and ${d.sawPlans} strategist plan${d.sawPlans === 1 ? "" : "s"}` : ""} · {num(d.usage.inputTokens, 0)} tokens in, {num(d.usage.outputTokens, 0)} out · a language model’s reading of
        the numbers above. It is not investment advice.
      </p>
    </div>
  );
}

export default function Debrief({ onOpen = null }) {
  const [theme, toggleTheme] = useDeskTheme();
  const [cost, setCost] = useState("0.1");
  const [card, setCard] = useState({ loading: true, data: null, error: "" });
  const [ai, setAi] = useState({ configured: false, debriefs: [], models: [] });
  const [busy, setBusy] = useState("");
  const [aiError, setAiError] = useState("");
  const [open, setOpen] = useState(null); // { SYMBOL: true }; null until the first answer decides
  const [picked, setPicked] = useState(null);
  const cols = useCols();

  const load = useCallback(() => {
    let alive = true;
    // while it reloads, the previous numbers stay on screen (dimmed): no flash, no jump
    setCard((c) => ({ ...c, loading: true, error: "" }));
    api(`/api/admin/market/scorecard?cost=${encodeURIComponent(cost)}`)
      .then((d) => alive && setCard({ loading: false, data: d, error: "" }))
      .catch((e) => alive && setCard((c) => ({ loading: false, data: c.data, error: e.message })));
    return () => {
      alive = false;
    };
  }, [cost]);
  useEffect(() => load(), [load]);

  useEffect(() => {
    let alive = true;
    Promise.all([api("/api/admin/ai/debrief"), api("/api/admin/ai/status")])
      .then(([d, s]) => alive && setAi({ configured: d.configured, debriefs: d.debriefs, models: s.models || [] }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const data = card.data;
  const rows = useMemo(() => (data && data.rows ? data.rows : []), [data]);
  const max = useMemo(() => Math.max(0, ...rows.filter((r) => r.available).map((r) => Math.abs(r.summary.netR))), [rows]);
  // open the first stock that produced a call, once
  useEffect(() => {
    if (open !== null || rows.length === 0) return;
    const first = rows.find((r) => r.available && r.trades.length > 0);
    setOpen(first ? { [first.symbol]: true } : {});
  }, [rows, open]);

  const write = async (refresh) => {
    setBusy("write");
    setAiError("");
    try {
      const d = await api("/api/admin/ai/debrief", { method: "POST", body: { refresh, cost: Number(cost) } });
      setAi((a) => ({ ...a, configured: d.configured, debriefs: d.debriefs }));
      setPicked(d.debrief.id);
    } catch (e) {
      setAiError(e.message);
    }
    setBusy("");
  };
  const addLesson = async (id, index) => {
    setBusy("lesson");
    setAiError("");
    try {
      const d = await api(`/api/admin/ai/debrief/${encodeURIComponent(id)}/lesson`, { method: "POST", body: { index } });
      setAi((a) => ({ ...a, debriefs: a.debriefs.map((x) => (x.id === d.debrief.id ? d.debrief : x)) }));
    } catch (e) {
      setAiError(e.message);
    }
    setBusy("");
  };

  const ok = Boolean(data && data.available);
  const t = ok ? data.totals : null;
  const shown = ai.debriefs.find((d) => d.id === picked) || (ok ? ai.debriefs.find((d) => d.day === data.date) : null) || ai.debriefs[0] || null;
  const forThisDay = ok && shown && shown.day === data.date;

  return (
    <div className="db">
      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>Day debrief{ok ? ` · ${dayText(data.date)}` : ""}</h3>
            <p>
              What the desk’s live call would have done on every stock of your watchlist, replayed over the session’s 5-minute bars and scored by arithmetic. It is{" "}
              <b>not a record of trades you took</b> — it shows what following each “in play” call mechanically would have added up to, before and after costs.
            </p>
          </div>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={toggleTheme} aria-pressed={theme === "dark"}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </header>

        <div className="db-filters">
          <span className="db-filters__k" id="db-cost">
            Assumed cost of a round trip
          </span>
          <div className="sv__ranges" role="group" aria-labelledby="db-cost">
            {COSTS.map((c) => (
              <button key={c.v} type="button" aria-pressed={cost === c.v} onClick={() => setCost(c.v)}>
                {c.label}
              </button>
            ))}
          </div>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={load} disabled={card.loading}>
            {card.loading ? "Replaying…" : "Refresh"}
          </button>
          <small>of the position’s value: brokerage, STT, exchange fees, GST and stamp duty together. An assumption — your contract note is the truth, and slippage is extra.</small>
        </div>

        <Alert>{card.error}</Alert>
        {card.loading && !data && <Loading label="Replaying the watchlist’s day… a few seconds per stock the first time" />}
        {data && !data.available && <p className="adm-alert adm-alert--info">{data.reason}</p>}

        {ok && (
          <div className={card.loading ? "db-stale" : ""}>
            {!data.complete && (
              <p className="adm-alert adm-alert--info">
                {data.today ? "The session is still open: this is the day so far, and a call that is still running is not counted in the totals." : "The bars for this session are incomplete."}
              </p>
            )}
            {!data.today && <p className="adm-alert adm-alert--info">Today has not traded yet — this is the last session, {dayText(data.date)}.</p>}
            {data.skipped > 0 && (
              <p className="adm-alert adm-alert--info">
                Only the first 15 stocks of the watchlist are replayed; {data.skipped} more {data.skipped === 1 ? "is" : "are"} left out. Reorder the watchlist to choose which.
              </p>
            )}
            <dl className="vd-tiles db-tiles">
              <Tile k="Calls made" v={t.calls} sub={`on ${t.stocks} stock${t.stocks === 1 ? "" : "s"}${t.open ? ` · ${t.open} still open` : ""}`} />
              <Tile k="✓ Reached target" v={t.target} sub="made what they risked (+1 R)" />
              <Tile k="✕ Stopped out" v={t.stop} sub="lost what they risked (−1 R or worse)" />
              <Tile k="◦ Closed at 3:15 PM" v={t.squareOff + t.flip} sub="neither stop nor target" />
              <Tile k="Before costs" v={fmtR(t.grossR)} t={rTone(t.grossR)} />
              <Tile k="Costs" v={fmtR(-t.costR)} sub={`at ${data.costPct}% a round trip`} />
              <Tile k="After costs" v={fmtR(t.netR)} t={rTone(t.netR)} sub="all finished calls together" />
              <Tile k="Deepest dip on the way" v={fmtR(t.deepestDipR)} sub="the running total, from its high" />
            </dl>
            <p className="vd-note">
              <b>R</b> is the amount risked on one call — the distance from its entry to its stop. +1 R means a call made as much as it risked; −1 R means it lost what it risked. Adding R
              across calls assumes the same money was risked on each.
            </p>
          </div>
        )}
      </section>

      {ok && (
        <section className={`an-card ${card.loading ? "db-stale" : ""}`}>
          <header className="an-card__head">
            <div>
              <h3>Running total, after costs</h3>
              <p>Every finished call across the watchlist, in the order it ended. Each step is one call; the line is where the day stood, in R.</p>
            </div>
          </header>
          <RunningTotal curve={data.curve} />
        </section>
      )}

      {ok && (
        <section className={`an-card ${card.loading ? "db-stale" : ""}`}>
          <header className="an-card__head">
            <div>
              <h3>Stock by stock</h3>
              <p>
                The bar is each stock’s result after costs — left of the line is a loss, right of it a gain, all on one scale. Open a row for its day: the price, the side the engine was
                on, and every call.
              </p>
            </div>
          </header>
          <div className="bt__scroll">
            <table className="an-table db-table">
              <thead>
                <tr>
                  <th scope="col" className="db-c-stock">
                    Stock
                  </th>
                  {cols >= 4 && (
                    <th scope="col" className="db-mid">
                      Day
                    </th>
                  )}
                  <th scope="col" className="db-c-calls">
                    Calls
                  </th>
                  <th scope="col" className="db-barhead">
                    After costs
                  </th>
                  {cols === 6 && (
                    <th scope="col" className="db-wide">
                      Before costs
                    </th>
                  )}
                  {cols === 6 && (
                    <th scope="col" className="db-wide">
                      Costs
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.symbol} row={r} max={max} open={Boolean(open && open[r.symbol])} onToggle={() => setOpen((o) => ({ ...(o || {}), [r.symbol]: !(o && o[r.symbol]) }))} onOpen={onOpen} cols={cols} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>The AI’s reading of the day</h3>
            <p>
              {ai.configured
                ? "The model is shown the numbers above — plus the co-pilot’s scored readings and the strategist’s plans from the same session, if there were any — and writes a short review. It runs only when you press the button."
                : "No Anthropic API key is set, so there is no written review. The scorecard above needs no AI and works without it."}
            </p>
          </div>
          {ai.configured ? (
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => write(Boolean(forThisDay))} disabled={Boolean(busy) || !ok}>
              {busy === "write" ? "Reading the day… up to a minute" : forThisDay ? "Write it again" : "Write the debrief"}
            </button>
          ) : (
            <a className="adm-btn adm-btn--solid adm-btn--sm" href={adminPath("/ai")}>
              Set up the AI
            </a>
          )}
        </header>
        <Alert>{aiError}</Alert>
        {busy === "write" && <Loading label="Replaying the watchlist and asking the model…" />}
        {ai.debriefs.length > 1 && (
          <div className="db-filters">
            <span className="db-filters__k" id="db-days">
              Earlier debriefs
            </span>
            <div className="sv__ranges" role="group" aria-labelledby="db-days">
              {ai.debriefs.map((d) => (
                <button key={d.id} type="button" aria-pressed={Boolean(shown && shown.id === d.id)} onClick={() => setPicked(d.id)}>
                  {dayText(d.day, { day: "numeric", month: "short" })}
                </button>
              ))}
            </div>
          </div>
        )}
        {busy !== "write" && shown && (
          <>
            {ok && !forThisDay && <p className="adm-alert adm-alert--info">This debrief is for {dayText(shown.day)}, not for the session shown above.</p>}
            <Written d={shown} models={ai.models} onLesson={addLesson} busy={busy} />
          </>
        )}
        {busy !== "write" && !shown && ai.configured && <p className="vd-note">No debrief has been written yet.</p>}
      </section>

      <section className="an-card db-about">
        <h3>How to read this — and what it cannot tell you</h3>
        <ul className="ai-list">
          <li>
            <b>How a call is replayed.</b> At each 5-minute close the engine is asked for its call with only what was known then. A change to “in play” opens one imaginary trade at
            that close. The stop is checked first — a bar that touches both stop and target counts as a stop, and a gap through the stop is filled at the bar’s open — then the 1 R
            target; otherwise it is closed at the open of the 3:15 PM bar. One trade at a time per stock.
          </li>
          <li>
            <b>Why it can differ from what you saw.</b> The live call is read every two seconds and also weighs the market’s direction, the tick stream and the order book. The replay
            reads it once every five minutes without those, and uses the daily picture as it stood at the previous close.
          </li>
          <li>
            <b>Costs decide small trades.</b> A stop only 0.25% away means an assumed 0.1% round-trip cost is 0.4 R gone before the trade starts. Try the cost buttons above: the calls stay
            the same, the result does not.
          </li>
          <li>
            <b>One day proves nothing.</b> A good day does not make the engine right and a bad one does not make it wrong. No method wins every trade, real fills slip, and this is not
            investment advice.
          </li>
        </ul>
      </section>
    </div>
  );
}
