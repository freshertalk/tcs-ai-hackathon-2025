// The evidence desk on the Desk, in Research and on Positions: everything weighed into one call for the next 5 and 15 minutes.
//   THE CALL       up, down or no clear lean, with the measured chance of a rise and of a fall beside their usual rates
//   TECHNIQUES     the day-trading techniques speaking on this bar, each with its own record on the stored history
//   LIVE           the order book price by price (NSE and BSE), every pending order, open interest, the option chain,
//                  NIFTY, the sector, India VIX, GIFT NIFTY, Wall Street, Asia — each with its lean and its live record
//   THE AI READ    asked once when the stock is opened and the readings are undecided (or on a click), and checked
// The server reads, weighs, keeps and checks (server/evidence.js, server/market/evidence.js); this only shows it.
// A number here is a measured frequency, never a promise.

import React, { useEffect, useState } from "react";
import { api, peek } from "../../api";
import { everyVisible } from "../../visible";
import { useAuth } from "../../auth";
import { isNum } from "./format";
import "./horizon.css";
import "./ahead.css";
import "./evidence.css";

const enc = encodeURIComponent;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const pc = (x) => (isNum(x) ? `${Math.round(x * 100)}%` : "—");
const pc1 = (x) => (isNum(x) ? `${(x * 100).toFixed(1)}%` : "—");
const num = (x) => (isNum(x) ? Math.round(x).toLocaleString("en-IN") : "—");
const px = (x) => (isNum(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const LEAN = { up: "UP", down: "DOWN", none: "NO CLEAR LEAN" };
const VERDICT = { works: "works here", backwards: "works the other way here", none: "no edge found here", thin: "too few cases yet" };
const arrow = (s) => (s > 0 ? "▲" : s < 0 ? "▽" : "·");
const LIVE_GROUPS = ["Order book", "Futures & options", "NSE market", "BSE", "World"];

/**
 * The evidence board for a stock, re-read every 30 seconds while the page is visible. With `announce` (the Desk) the
 * server is told once that the stock was opened: it may then ask the AI about it, when its own test says the AI is needed.
 */
export function useEvidence(symbol, enabled = true, { announce = false } = {}) {
  const url = `/api/admin/market/evidence/${enc(symbol || "")}`;
  const [s, setS] = useState(() => {
    const seen = enabled && symbol ? peek(url, 60000) : null;
    return seen ? { loading: false, data: seen, error: "", opened: null } : { loading: Boolean(enabled && symbol), data: null, error: "", opened: null };
  });
  useEffect(() => {
    let alive = true;
    if (!enabled || !symbol) return undefined;
    const seen = peek(url, 60000);
    setS(seen ? { loading: false, data: seen, error: "", opened: null } : { loading: true, data: null, error: "", opened: null });
    const read = () =>
      api(url)
        .then((d) => alive && setS((p) => ({ ...p, loading: false, data: d, error: "" })))
        .catch((e) => alive && setS((p) => ({ ...p, loading: false, error: e.message })));
    read();
    if (announce)
      api(`${url}/open`, { method: "POST" })
        .then((r) => alive && setS((p) => ({ ...p, opened: r })))
        .catch(() => {});
    const stop = everyVisible(read, 30000, { topics: ["evidence", "horizon"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [url, symbol, enabled, announce]);
  return s;
}

/** A chance against its usual rate: a bar filled to the chance, with a tick where "usual" is. */
function Chance({ label, p, usual, tone }) {
  if (!isNum(p)) return null;
  const at = (x) => Math.round(Math.max(0, Math.min(100, x * 100)) * 10) / 10;
  return (
    <div className="ev-chance" data-tip={`${label}: ${pc(p)} on this bar. Over all bars it is ${pc(usual)} (the tick). "A ${label.toLowerCase()}" means by at least 0.3 of the stock's usual move for that time.`}>
      <span className="ev-chance__k">{label}</span>
      <span className={`ah-meter ah-meter--${tone}`} aria-hidden="true">
        <i style={{ width: `${Math.max(2, at(p))}%` }} />
        {isNum(usual) && <u style={{ left: `${at(usual)}%` }} />}
      </span>
      <span className="ev-chance__v">
        <b>{pc(p)}</b> <small>usual {pc(usual)}</small>
      </span>
    </div>
  );
}

/** One horizon's call. */
function Call({ c }) {
  const tone = c.lean === "up" ? "up" : c.lean === "down" ? "down" : "flat";
  return (
    <div className={`ah-col ev-call ev-call--${tone}`}>
      <div className="ah-col__head">
        <b>Next {c.minutes} minutes</b>
        <small>by {clock(c.at)}</small>
      </div>
      <p className={`ev-lean ev-lean--${tone}`}>
        <strong>{LEAN[c.lean]}</strong>
        {c.lean !== "none" && (
          <span className={`ev-proof ${c.proven ? "is-proven" : ""}`} data-tip={c.proven ? `A lean this firm was right ${pc(c.right)} of ${num(c.n)} times on sessions the model had not seen, and it held session after session.` : `A lean this firm has not yet proven itself on unseen sessions (${c.n ? `${pc(c.right)} of ${num(c.n)}` : "no cases yet"}): read it with care.`}>
            {c.proven ? `proven · right ${pc(c.right)} of ${num(c.n)}` : "not proven yet"}
          </span>
        )}
      </p>
      <Chance label="Rise" p={c.pUp} usual={c.usualUp} tone={c.lean === "up" ? "up" : "flat"} />
      <Chance label="Fall" p={c.pDown} usual={c.usualDown} tone={c.lean === "down" ? "down" : "flat"} />
      <p className="ah-read">{c.read}</p>
      {c.why && c.why.length > 0 && (
        <p className="ev-why">
          {c.why.map((w) => (
            <span key={w.id} className={`ev-push ${w.push > 0 ? "is-for" : "is-against"}`} data-tip={`${w.name}: ${w.push > 0 ? "pushes the call this way" : "pulls against it"} by ${Math.abs(w.push * 100).toFixed(1)} points.`}>
              {w.push > 0 ? "+" : "−"} {w.name}
            </span>
          ))}
        </p>
      )}
      {c.live && c.live.length > 0 && <p className="ev-uses">Moved by proven live readings: {c.live.map((x) => `${x.name} (${x.points > 0 ? "+" : "−"}${Math.abs(x.points * 100).toFixed(1)} pts)`).join(", ")}.</p>}
      <p className="ev-uses">
        {c.uses === "techniques"
          ? `The techniques are in this call: with them it missed ${pc1(c.adds)} less than the forecaster alone on unseen sessions.`
          : "This call is the forecaster's own, calibrated: the techniques did not make it miss less on unseen sessions, so they are shown for reading only."}
      </p>
    </div>
  );
}

const recText = (r) => (r && r.n ? `${VERDICT[r.verdict]} · went its way ${pc(r.right)} of ${num(r.n)}` : "not measured yet");
const recTip = (r, live) =>
  r && r.n
    ? `${live ? "Checked live on this desk" : "On the stored NIFTY 100 history"}: it spoke ${num(r.n)} times on ${r.days} sessions; 15 minutes later the price had gone its way ${pc(r.right)} of the time, by ${isNum(r.edge) ? r.edge.toFixed(3) : "—"} of a usual move on average. ${r.verdict === "works" ? "That is clear of chance, session after session." : r.verdict === "backwards" ? "Here it works the other way: the price tends to go AGAINST it." : r.verdict === "none" ? "That is within chance: no edge was found." : "Too few cases, or too few sessions, to say."}`
    : live
      ? "Nothing checked yet: every time this reading leans it is kept with the call and checked 5 and 15 minutes later."
      : "This technique has not spoken on the stored history yet.";

/** Which comes first within 30 minutes: the move up or the same move down — a target and a stop the same distance apart. */
function First({ f }) {
  if (!f) return null;
  const tone = f.lean === "up" ? "up" : f.lean === "down" ? "down" : "flat";
  return (
    <div className={`ev-first ev-first--${tone}`} data-tip="A trade ends at its target, at its stop or at the clock. This is the measured chance that a move of this size up comes before the same move down within 30 minutes (and the reverse), on sessions the model had not seen. What is left over is “neither”.">
      <div className="ev-first__head">
        <b>Which comes first, within {f.minutes} minutes</b>
        <small>
          a move of {f.movePct.toFixed(2)}% either way
          {f.lean !== "none" ? ` · ${f.proven ? `proven · right ${pc(f.right)} of ${num(f.n)}` : "not proven yet"}` : ""}
        </small>
      </div>
      <div className="ev-first__rows">
        <Chance label={`▲ ${px(f.up.price)}`} p={f.up.p} usual={f.up.usual} tone={f.lean === "up" ? "up" : "flat"} />
        <Chance label={`▽ ${px(f.down.price)}`} p={f.down.p} usual={f.down.usual} tone={f.lean === "down" ? "down" : "flat"} />
      </div>
    </div>
  );
}

/** One reading: which way it leans, what it saw, and its record. */
function Row({ r, live = false }) {
  // a technique's record for the regime the stock is in now (a trend or a range) when it has spoken often enough there
  const own = r.regime && r.regime[15] && r.regime[15].verdict !== "thin" ? r.regime[15] : null;
  const rec = own || (r.record ? r.record[15] : null);
  const where = own ? `in a ${r.regime.name}: ` : "";
  return (
    <li className={`ev-row ${r.state > 0 ? "is-up" : r.state < 0 ? "is-down" : "is-flat"}`} data-tip={r.what}>
      <span className="ev-row__s" aria-label={r.state > 0 ? "leans up" : r.state < 0 ? "leans down" : "no lean"}>
        {arrow(r.state)}
      </span>
      <span className="ev-row__t">
        <b>{r.name}</b>
        <span>{r.text}</span>
      </span>
      {rec && (
        <span className={`ev-rec ev-rec--${rec.verdict}`} data-tip={`${own ? `Counted only on bars where the stock was in a ${r.regime.name}, as it is now. ` : ""}${recTip(rec, live)}`}>
          {where}
          {recText(rec)}
        </span>
      )}
    </li>
  );
}

/** The order book price by price: the 5 best bids and offers, with the shares and the number of orders at each. */
function Ladder({ title, book }) {
  if (!book || (!book.bids.length && !book.asks.length)) return null;
  const max = Math.max(1, ...book.bids.map((l) => l.qty), ...book.asks.map((l) => l.qty));
  const rows = Array.from({ length: Math.max(book.bids.length, book.asks.length) }, (_, i) => [book.bids[i], book.asks[i]]);
  const qty = (l, side) => (
    <td className={`ev-ladder__q ev-ladder__q--${side}`} data-tip={l ? `${num(l.qty)} shares in ${num(l.orders)} order${l.orders === 1 ? "" : "s"} at ${px(l.price)}` : undefined}>
      {l && <i style={{ width: `${Math.round((l.qty / max) * 100)}%` }} />}
      {l && (
        <span>
          {num(l.qty)} <small>×{num(l.orders)}</small>
        </span>
      )}
    </td>
  );
  return (
    <div className="ev-ladder">
      <p className="ev-ladder__cap">
        <b>{title}</b> · {num(book.bidQty)} shares bid, {num(book.askQty)} offered at these prices
        {isNum(book.buyTotal) ? ` · all pending orders: ${num(book.buyTotal)} to buy, ${num(book.sellTotal)} to sell` : ""} <small>(×n = in n orders)</small>
      </p>
      <table className="hz-table ev-ladder__t">
        <thead>
          <tr>
            <th scope="col" data-tip="Shares waiting to buy at this price, and in how many orders (×)">Bid shares</th>
            <th scope="col">Bid</th>
            <th scope="col">Offer</th>
            <th scope="col" data-tip="Shares waiting to sell at this price, and in how many orders (×)">Offer shares</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([b, a], i) => (
            <tr key={i}>
              {qty(b, "bid")}
              <td className="ev-ladder__p ev-ladder__p--bid">{b ? px(b.price) : ""}</td>
              <td className="ev-ladder__p ev-ladder__p--ask">{a ? px(a.price) : ""}</td>
              {qty(a, "ask")}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The AI's read of the board: asked when the stock was opened and the readings were undecided, or on a click. */
function AiRead({ symbol, ai, opened, onAsked }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!ai) return null;
  const ask = async () => {
    setBusy(true);
    setErr("");
    try {
      onAsked(await api(`/api/admin/market/evidence/${enc(symbol)}/ai`, { method: "POST" }));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const r = ai.read;
  const rec = ai.record && ai.record.n ? `its reads were right ${pc(ai.record.right)} of ${ai.record.n} checked` : "no read checked yet";
  const mode = ai.mode === "off" ? "automatic read off" : ai.mode === "always" ? "reads every stock you open" : "reads a stock you open when the readings are undecided";
  const working = busy || ai.busy;
  return (
    <div className={`ev-ai ${r ? `ev-ai--${r.lean}` : ""}`}>
      <div className="ev-ai__head">
        <b>AI read</b>
        <small>
          {mode} · {ai.usedToday} of {ai.perDay} automatic reads today · {rec}
        </small>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={working || !ai.ready} onClick={ask} data-tip={ai.ready ? "Ask the AI now to weigh this whole board: the call, the techniques and their records, the order book, open interest, the market and the world. One request to your default model; it uses AI credit." : "No AI model is set up (AI page)."}>
          {working ? "The AI is reading…" : "Ask the AI"}
        </button>
      </div>
      {r ? (
        <>
          <p className="ev-ai__lean">
            <strong>{LEAN[r.lean]}</strong> for the next 15 minutes · {r.confidence} confidence
            <small>
              {" "}
              {r.by} at {clock(r.at)}, price {px(r.price)} · asked because {r.trigger}
              {r.settled && r.ok !== null ? ` · checked: ${r.ok ? "right ✓" : "wrong ✗"}` : r.lean !== "none" ? " · checked 15 minutes after" : ""}
            </small>
          </p>
          <p>{r.why}</p>
          {r.watch && (
            <p>
              <b>Watch:</b> {r.watch}
            </p>
          )}
          {isNum(r.invalid) && (
            <p>
              <b>Wrong if it breaks:</b> {px(r.invalid)}
            </p>
          )}
          {r.risk && (
            <p>
              <b>Risk:</b> {r.risk}
            </p>
          )}
        </>
      ) : (
        <p className="hz-dim">{working ? "Weighing the board…" : opened && opened.why ? (opened.asked ? `The AI was asked because ${opened.why}.` : `Not asked: ${opened.why.replace(/^The /, "the ")}`) : "No AI read of this stock yet."}</p>
      )}
      {err && <p className="adm-alert adm-alert--info">{err}</p>}
    </div>
  );
}

/**
 * The board for one stock. `compact` (Research) shows the call, the count and the AI read; the Desk shows everything.
 * `state` lets the caller share one reading (the Desk head's chips use the same).
 */
export default function EvidenceCard({ symbol, enabled = true, compact = false, state = null, announce = false }) {
  const own = useEvidence(symbol, enabled && !state, { announce });
  const s = state || own;
  const [aiNow, setAiNow] = useState(null);
  useEffect(() => setAiNow(null), [symbol]);
  const d = s.data;
  if (!enabled) return null;
  if (!d)
    return (
      <section className="hz ev" aria-label="Evidence for the next 5 and 15 minutes">
        <header className="hz-head">
          <h3>Evidence · everything weighed</h3>
        </header>
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <p className="hz-dim">Reading the techniques, the order book, open interest, the market and the world…</p>}
      </section>
    );
  const ai = aiNow ? { ...d.ai, ...aiNow } : d.ai;
  const head = (
    <header className="hz-head">
      <h3>Evidence · everything weighed</h3>
      <small className="hz-when">
        {d.available ? `as of the ${clock(d.anchor.at)} bar · ` : ""}
        {d.techniques} techniques, the order book, open interest, the market and the world
      </small>
    </header>
  );
  if (!d.available)
    return (
      <section className="hz ev" aria-label="Evidence for the next 5 and 15 minutes">
        {head}
        <p className="hz-dim">{d.reason}</p>
      </section>
    );
  const c15 = d.calls.find((c) => c.key === "15") || d.calls[0];
  const tone = c15 ? (c15.lean === "up" ? "up" : c15.lean === "down" ? "down" : "") : "";
  const groups = LIVE_GROUPS.map((g) => [g, d.live.filter((r) => r.fam === g)]).filter(([, rows]) => rows.length);
  const ind = d.indicators || {};
  const missing = (d.sources || []).filter((x) => !x.ok);
  return (
    <section className={`hz ev ${tone ? `ah--${tone}` : ""}`} aria-label="Evidence for the next 5 and 15 minutes">
      {head}
      {d.reason && <p className="hz-dim">{d.reason}</p>}
      {d.calls.length > 0 && (
        <div className="ah-cols">
          {d.calls.map((c) => (
            <Call key={c.key} c={c} />
          ))}
        </div>
      )}
      <First f={d.first} />
      <p className="ev-count" data-tip="Every technique and live reading that is leaning one way on this bar. “Proven” counts only the ones whose own record is clear of chance (a reading that works the other way counts for the side it really favours).">
        <span className="is-up">▲ {d.count.up} lean up</span>
        <span className="is-down">▽ {d.count.down} lean down</span>
        <span>
          proven: {d.count.provenUp} up, {d.count.provenDown} down
        </span>
        <span className="hz-dim">{d.count.silent} techniques silent</span>
        {d.regime && <span className="hz-dim">the stock is {d.regime.name === "trend" ? "trending" : "ranging"} now</span>}
      </p>
      <AiRead symbol={symbol} ai={ai} opened={s.opened} onAsked={setAiNow} />
      {!compact && (
        <>
          <details className="ev-sec" open>
            <summary>
              Techniques speaking now <small>{d.witnesses.length} of {d.techniques}</small>
            </summary>
            {d.witnesses.length ? (
              <ul className="ev-rows">
                {d.witnesses.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </ul>
            ) : (
              <p className="hz-dim">No technique has a signal on this bar.</p>
            )}
          </details>
          <details className="ev-sec" open>
            <summary>
              Order book, price by price <small>the 5 best bids and offers Zerodha sends, on NSE and on BSE</small>
            </summary>
            <div className="ev-ladders">
              <Ladder title="NSE" book={d.book && d.book.nse} />
              <Ladder title="BSE" book={d.book && d.book.bse} />
            </div>
            {!(d.book && d.book.nse) && <p className="hz-dim">Zerodha sent no order book for this stock just now.</p>}
          </details>
          {groups.map(([g, rows]) => (
            <details className="ev-sec" key={g} open={g !== "World"}>
              <summary>
                {g} <small>{rows.filter((r) => r.state > 0).length} up, {rows.filter((r) => r.state < 0).length} down</small>
              </summary>
              <ul className="ev-rows">
                {rows.map((r) => (
                  <Row key={r.id} r={r} live />
                ))}
              </ul>
            </details>
          ))}
          <details className="ev-sec">
            <summary>
              Indicators and levels <small>RSI {isNum(ind.rsi14) ? ind.rsi14 : "—"} · VWAP {px(ind.vwap)} · {isNum(ind.volumeTimesUsual) ? `${ind.volumeTimesUsual}× usual volume` : ""}</small>
            </summary>
            <dl className="ev-ind">
              {[
                ["RSI (14)", ind.rsi14],
                ["RSI (2)", ind.rsi2],
                ["VWAP", px(ind.vwap)],
                ["From VWAP", isNum(ind.vsVwapPct) ? `${ind.vsVwapPct > 0 ? "+" : ""}${ind.vsVwapPct}%` : null],
                ["VWAP bands away", ind.vwapBands],
                ["Bollinger %B", ind.bollinger ? ind.bollinger.pctB : null],
                ["Bollinger band", ind.bollinger ? `${px(ind.bollinger.lower)} – ${px(ind.bollinger.upper)}` : null],
                ["MACD histogram", ind.macdHist],
                ["ADX", ind.adx],
                ["+DI / −DI", isNum(ind.plusDI) ? `${ind.plusDI} / ${ind.minusDI}` : null],
                ["Supertrend", ind.supertrend ? `${ind.supertrend.dir} (${px(ind.supertrend.line)})` : null],
                ["9 EMA / 20 EMA", `${px(ind.ema9)} / ${px(ind.ema20)}`],
                ["Volume, last bar", isNum(ind.volumeTimesUsual) ? `${ind.volumeTimesUsual}× usual` : null],
                ["A usual 5-minute move", isNum(ind.usualMovePct) ? `${ind.usualMovePct}%` : null],
              ]
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            <div className="hz-scroll">
              <table className="hz-table">
                <caption>The levels nearest the price</caption>
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">Price</th>
                    <th scope="col">Away</th>
                    <th scope="col">In usual moves</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.levels || []).map((l) => (
                    <tr key={l.name} className={l.side === "above" ? "ev-lvl--above" : "ev-lvl--below"}>
                      <th scope="row">{l.name}</th>
                      <td>{px(l.price)}</td>
                      <td>
                        {l.awayPct > 0 ? "+" : ""}
                        {l.awayPct}%
                      </td>
                      <td>{l.moves}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {missing.length > 0 && (
            <p className="ev-missing">
              <b>Not read just now:</b> {missing.map((x) => `${x.name} — ${x.note}`).join(" · ")}
            </p>
          )}
          <details className="hz-rule">
            <summary>How this is worked out</summary>
            <p>{d.rule}</p>
            <p>{d.checkRule}</p>
          </details>
        </>
      )}
    </section>
  );
}

/** The Research page's table: every technique and live reading with its record, how the call has done, and the learning. */
export function EvidenceBoard() {
  const { user } = useAuth() || {};
  const owner = Boolean(user && user.role === "superadmin");
  const [s, setS] = useState({ loading: true, data: null, error: "" });
  const [msg, setMsg] = useState("");
  const read = () =>
    api("/api/admin/market/evidence")
      .then((d) => setS({ loading: false, data: d, error: "" }))
      .catch((e) => setS((p) => ({ loading: false, data: p.data, error: e.message })));
  useEffect(() => {
    read();
    const stop = everyVisible(read, 20000, { topics: ["evidence"] });
    return () => stop && stop();
  }, []);
  const run = async (path) => {
    setMsg("");
    try {
      setS({ loading: false, data: await api(path, { method: "POST" }), error: "" });
    } catch (e) {
      setMsg(e.message);
    }
  };
  const d = s.data;
  if (!d || !d.techniques)
    return (
      <section className="hz hz--board">
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <p className="hz-dim">Reading the evidence desk’s record…</p>}
      </section>
    );
  const busy = d.job && !d.job.finishedAt;
  const now = d.learning && d.learning.now;
  const cell = (r) => (r && r.n ? `${pc(r.right)} of ${num(r.n)}` : "—");
  const callRow = (h, x) =>
    x ? (
      <tr key={h}>
        <th scope="row">{h}</th>
        <td>{x.on ? `in use · cut the miss by ${pc1(x.adds)}` : `not in use (${x.adds >= 0.0005 ? `the miss fell only ${pc1(x.adds)}, or not on every session` : "no real gain"})`}</td>
        <td>{cell(x.all)}</td>
        <td>{cell(x.alone)}</td>
        <td>{cell(x.tiers.strong)}</td>
        <td>{cell(x.tiers.clear)}</td>
        <td>{cell(x.tiers.slight)}</td>
      </tr>
    ) : null;
  const live = (h) => {
    const t = d.liveCalls && d.liveCalls[h];
    return t && t.n ? `${pc(t.ok / t.n)} of ${num(t.n)}` : "none checked yet";
  };
  return (
    <section className="hz hz--board ev-board" aria-label="How the evidence desk has done">
      <header className="hz-head">
        <h3>Evidence desk · what it has measured</h3>
        {d.trained ? (
          <small className="hz-when">
            learned from {num(d.learning.rows)} bars of {d.learning.sessions} sessions · to {day(d.learning.lastDate)}
          </small>
        ) : (
          <small className="hz-when">not trained yet — it trains by itself right after the 15-minute forecaster</small>
        )}
        {owner && (
          <span className="hz-btns">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => run("/api/admin/market/evidence/train")} data-tip="Measure every technique again on every stored session of the NIFTY 100 and fit the call again. It runs in the background and takes a few minutes. No AI is used.">
              Learn from all history
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy || !d.trained} onClick={() => run("/api/admin/market/evidence/learn")} data-tip="Call, check and then learn every session newer than the last one learned. It also happens by itself at 3:50 PM.">
              Learn new sessions
            </button>
          </span>
        )}
      </header>
      {msg && <p className="adm-alert adm-alert--info">{msg}</p>}
      {busy && (
        <p className="hz-job" role="status">
          {d.job.kind === "train" ? "Training" : "Learning"}: {d.job.phase} · {num(d.job.rows || 0)} bars read
        </p>
      )}
      {d.error && !busy && <p className="hz-dim">Last problem: {d.error}</p>}
      {now && (
        <div className="hz-scroll">
          <table className="hz-table">
            <caption>The call on sessions it had not seen: how often a lean was right (the price ended on the side it named). Checked live so far: 5 min {live(1)}, 15 min {live(3)}.</caption>
            <thead>
              <tr>
                <th scope="col">Horizon</th>
                <th scope="col">Techniques</th>
                <th scope="col">Every lean</th>
                <th scope="col">Forecaster alone</th>
                <th scope="col">Strong</th>
                <th scope="col">Clear</th>
                <th scope="col">Slight</th>
              </tr>
            </thead>
            <tbody>
              {callRow("5 minutes", now[1])}
              {callRow("15 minutes", now[3])}
              {callRow("Which first, 30 min", now.tb)}
            </tbody>
          </table>
        </div>
      )}
      <div className="hz-scroll">
        <table className="hz-table ev-led">
          <caption>Each technique’s own record on the stored history: when it spoke, how often the price then went its way — overall, and apart for bars in a trend and bars in a range (the same signal can work in one and fail in the other). “Works” and “works the other way” are clear of chance counted session by session; the rest is noise here.</caption>
          <thead>
            <tr>
              <th scope="col">Technique</th>
              <th scope="col">Kind</th>
              <th scope="col">5 minutes later</th>
              <th scope="col">15 minutes later</th>
              <th scope="col">Verdict (15 min)</th>
              <th scope="col">In a trend</th>
              <th scope="col">In a range</th>
            </tr>
          </thead>
          <tbody>
            {d.techniques.map((t) => (
              <tr key={t.id} data-tip={t.what}>
                <th scope="row">{t.name}</th>
                <td>{t.fam}</td>
                <td>{cell(t.record[5])}</td>
                <td>{cell(t.record[15])}</td>
                <td>
                  <span className={`ev-rec ev-rec--${t.record[15].verdict}`}>{VERDICT[t.record[15].verdict]}</span>
                </td>
                {[t.trend15, t.range15].map((r, i) => (
                  <td key={i}>
                    {r && r.n ? (
                      <span className={`ev-rec ev-rec--${r.verdict}`} data-tip={`${VERDICT[r.verdict]}: went its way ${pc(r.right)} of ${num(r.n)} on ${r.days} sessions`}>
                        {pc(r.right)} of {num(r.n)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hz-scroll">
        <table className="hz-table ev-led">
          <caption>The live readings, checked on this desk as they happen ({num(d.checked)} calls checked so far). A reading moves the call only after its own record is clear of chance.</caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col">Kind</th>
              <th scope="col">5 minutes later</th>
              <th scope="col">15 minutes later</th>
              <th scope="col">Verdict (15 min)</th>
            </tr>
          </thead>
          <tbody>
            {d.live.map((t) => (
              <tr key={t.id} data-tip={t.what}>
                <th scope="row">{t.name}</th>
                <td>{t.fam}</td>
                <td>{cell(t.record[5])}</td>
                <td>{cell(t.record[15])}</td>
                <td>
                  <span className={`ev-rec ev-rec--${t.record[15].verdict}`}>{VERDICT[t.record[15].verdict]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.days && d.days.length > 0 && (
        <div className="hz-scroll">
          <table className="hz-table">
            <caption>Each evening’s check: the whole NIFTY 100 day called with the model as it stood, then learned</caption>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Bars</th>
                <th scope="col">Leans right, 5 min</th>
                <th scope="col">Leans right, 15 min</th>
                <th scope="col">Forecaster alone, 15 min</th>
              </tr>
            </thead>
            <tbody>
              {d.days.slice(0, 10).map((x) => (
                <tr key={x.date}>
                  <th scope="row">{day(x.date)}</th>
                  <td>{num(x.rows)}</td>
                  <td>{cell(x.call5 && x.call5.all)}</td>
                  <td>{cell(x.call15 && x.call15.all)}</td>
                  <td>{cell(x.call15 && x.call15.alone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.ai && (
        <p className="hz-dim">
          AI reads on opening a stock: {d.ai.mode === "off" ? "off" : d.ai.mode === "always" ? "every opened stock" : "only when the readings are undecided"} · {d.ai.usedToday} of {d.ai.perDay} used today ·{" "}
          {d.ai.record && d.ai.record.n ? `right ${pc(d.ai.record.right)} of ${d.ai.record.n} checked` : "none checked yet"} (change it on the AI page).
        </p>
      )}
      <details className="hz-rule">
        <summary>How this is worked out</summary>
        <p>{d.rule}</p>
        <p>{d.checkRule}</p>
      </details>
    </section>
  );
}

/**
 * For the Positions screens: the next 15 minutes for each open position, and whether it is with the position or against it.
 * @param positions [{ symbol, side: "long" | "short" }]
 * @returns { [`${symbol}|${side}`]: reading }
 */
export function usePositionEvidence(positions) {
  const list = (positions || []).filter((p) => p && p.symbol).map((p) => `${p.symbol}:${p.side === "short" ? "short" : "long"}`);
  const key = list.join(",");
  const [rows, setRows] = useState({});
  useEffect(() => {
    let alive = true;
    if (!key) {
      setRows({});
      return undefined;
    }
    const read = () =>
      api(`/api/admin/market/evidence/positions?list=${enc(key)}`)
        .then((d) => alive && setRows(Object.fromEntries(((d && d.rows) || []).map((r) => [`${r.symbol}|${r.side}`, r]))))
        .catch(() => {});
    read();
    const stop = everyVisible(read, 60000, { topics: ["evidence", "horizon"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [key]);
  return rows;
}

/** One position's line: the evidence for its next 15 minutes. */
export function PositionEvidence({ reading }) {
  if (!reading || !reading.available) return null;
  const tone = reading.lean === "none" ? "flat" : reading.against ? "against" : "with";
  return (
    <span className={`ev-pos ev-pos--${tone}`} data-tip={`${reading.text} ${reading.up} readings lean up, ${reading.down} lean down. From the evidence desk (the Desk shows the whole board for this stock).`}>
      {reading.first && (
        <small className="ev-pos__first">
          in favour first {pc(reading.first.favour.p)} · against first {pc(reading.first.against.p)}
        </small>
      )}
      <b>{reading.lean === "none" ? "No clear lean" : `${LEAN[reading.lean]} ${pc(reading.p)}`}</b>
      <small>{reading.lean === "none" ? "next 15 min" : reading.against ? "against you · next 15 min" : "with you · next 15 min"}</small>
      {reading.lean !== "none" && !reading.proven && <small className="ev-pos__np">not proven</small>}
    </span>
  );
}
