// The day board: what a day trader needs in front of them before looking at any one stock.
//   Session    where the trading day is — its zones (opening noise, prime window, midday lull, wind-down, square-off),
//              the time to the next change, and the broker's square-off warning
//   Market     the tide, India VIX and breadth, in one glance
//   Radar      the stocks on the watchlist that are strongest and weakest against the index right now (tap to open)
//   Checklist  six questions to answer before every entry; the time-of-day one answers itself
// Everything here is read from data the desk already has; it advises nothing, and the checklist is only a prompt.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { everyVisible } from "../../visible";
import { exchangeNow, useExchangeNow } from "../../clock/exchangeClock";
import { isNum, num, pct } from "./format";
import { radarScore } from "./radar";
import "./dayboard.css";

const IST = 5.5 * 3600 * 1000;

/** Minutes since midnight in India, the weekday (0 = Sunday), the date, and the clock text. */
export function istParts(ms = exchangeNow()) {
  const d = new Date(ms + IST);
  return { min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds(), dow: d.getUTCDay(), date: d.toISOString().slice(0, 10), text: d.toISOString().slice(11, 16) };
}

// The trading day, in zones. Words are about how sessions usually behave, not a promise.
export const OPEN = 9 * 60 + 15;
export const CLOSE = 15 * 60 + 30;
export const ZONES = [
  { id: "open", from: OPEN, to: 9 * 60 + 30, title: "Opening noise", tone: "warn", tip: "Wide spreads and fast reversals. Many traders wait for the first 15 minutes’ range before entering." },
  { id: "prime", from: 9 * 60 + 30, to: 11 * 60 + 30, title: "Prime window", tone: "up", tip: "Volume is deepest and trends tend to form. The cleanest place for planned entries." },
  { id: "lull", from: 11 * 60 + 30, to: 13 * 60 + 30, title: "Midday lull", tone: "flat", tip: "Volume usually thins and prices chop. Fewer, smaller trades; skip setups that need momentum." },
  { id: "pm", from: 13 * 60 + 30, to: 14 * 60 + 45, title: "Afternoon", tone: "up", tip: "Activity often returns. Trade the plan; a trend that has run all day can still reverse." },
  { id: "wind", from: 14 * 60 + 45, to: 15 * 60 + 20, title: "Wind-down", tone: "warn", tip: "Close or trail what you hold. Avoid fresh intraday entries that need time to work." },
  { id: "sq", from: 15 * 60 + 20, to: CLOSE, title: "Square-off", tone: "down", tip: "Brokers start squaring off intraday (MIS) positions about now — check your broker’s time. Do not open new trades." },
];

export function zoneAt(min) {
  return ZONES.find((z) => min >= z.from && min < z.to) || null;
}

const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
function span(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Where the day is right now: { phase, title, tip, tone, left, next } — left/next in minutes. */
export function sessionNow(p, marketHours) {
  const weekday = p.dow >= 1 && p.dow <= 5;
  if (marketHours) {
    const z = zoneAt(p.min);
    if (z) return { phase: "open", zone: z, title: z.title, tip: z.tip, tone: z.tone, nextLabel: `${span(CLOSE - p.min)} to the close`, mark: (p.min - OPEN) / (CLOSE - OPEN) };
  }
  if (weekday && p.min >= 9 * 60 && p.min < OPEN && !marketHours) {
    return { phase: "pre", zone: null, title: "Pre-open", tip: "The exchange collects orders and sets the opening price. Plan the day; trading starts at 9:15.", tone: "flat", nextLabel: `opens in ${span(OPEN - p.min)}`, mark: 0 };
  }
  const todayAhead = weekday && p.min < OPEN;
  const nextDay = todayAhead ? "today" : p.dow === 5 || p.dow === 6 ? "Monday" : p.dow === 0 ? "Monday" : "tomorrow";
  return { phase: "closed", zone: null, title: "Market closed", tip: `Next session ${nextDay} at 9:15 (exchange holidays aside). A good time to review the day and prepare the watchlist.`, tone: "flat", nextLabel: `next: ${nextDay} 9:15`, mark: p.min >= CLOSE ? 1 : 0 };
}

/* ------------------------------------------------------------------ cards */

function SessionCard({ now, status }) {
  const s = sessionNow(now, Boolean(status.marketHours));
  return (
    <section className={`dkb-card dkb-session is-${s.tone}`} aria-label="Trading session">
      <h3>
        Session <small>IST {now.text}</small>
      </h3>
      <p className="dkb-big">
        <b>{s.title}</b>
        <span>{s.nextLabel}</span>
      </p>
      <div className="dkb-track" role="img" aria-label={`Trading day from 9:15 to 3:30 PM. ${s.title}. ${s.nextLabel}.`}>
        {ZONES.map((z) => (
          <i key={z.id} className={`is-${z.tone} ${s.zone && s.zone.id === z.id ? "is-now" : ""}`} style={{ flexGrow: z.to - z.from }} title={`${z.title} ${hm(z.from)}–${hm(z.to)}`} />
        ))}
        {s.phase === "open" && <b className="dkb-now" style={{ left: `${Math.max(0, Math.min(1, s.mark)) * 100}%` }} aria-hidden="true" />}
      </div>
      <p className="dkb-ticks" aria-hidden="true">
        <span>9:15</span>
        <span>11:30</span>
        <span>1:30</span>
        <span>3:20</span>
      </p>
      <p className="dkb-tip">{s.tip}</p>
      {s.phase === "open" && now.min < 15 * 60 && <p className="dkb-flag">Zerodha squares off intraday positions at 3:12 PM in F&O stocks (they stop trading at 3:15 PM for the closing auction) and at 3:25 PM in the rest.</p>}
    </section>
  );
}

function MarketCard({ ctx }) {
  const ok = ctx && ctx.available;
  const t = ok ? ctx.tide : null;
  const tone = !t ? "flat" : t.score >= 30 ? "up" : t.score <= -30 ? "down" : "flat";
  return (
    <section className={`dkb-card is-${tone}`} aria-label="Market gauge">
      <h3>Market</h3>
      {ok ? (
        <>
          <p className="dkb-big">
            <b>
              {t.label} {t.score > 0 ? `+${t.score}` : t.score}
            </b>
            <span>{t.live ? "market tide, live" : "tide at the close"}</span>
          </p>
          <dl className="dkb-kv">
            {ctx.vix && (
              <div title="India VIX: the market’s expected swing. Higher means wider moves, so smaller size and wider stops.">
                <dt>India VIX</dt>
                <dd>
                  {num(ctx.vix.last)} <em className={isNum(ctx.vix.changePct) && ctx.vix.changePct > 0 ? "is-down" : "is-up"}>{pct(ctx.vix.changePct)}</em>
                </dd>
              </div>
            )}
            {ctx.breadth && (
              <div title="How many of the tracked stocks are up against down.">
                <dt>Breadth</dt>
                <dd>
                  <span className="is-up">{ctx.breadth.up} up</span> · <span className="is-down">{ctx.breadth.down} down</span>
                </dd>
              </div>
            )}
          </dl>
          {ctx.vix && ctx.vix.level && <p className="dkb-tip">VIX is {String(ctx.vix.level).toLowerCase()}.</p>}
        </>
      ) : (
        <p className="dkb-tip">{ctx && ctx.reason ? ctx.reason : "The market reading appears once the index has quotes today."}</p>
      )}
    </section>
  );
}

export function radarPicks(symbols, quotes, n = 3) {
  const nifty = quotes["NIFTY 50"];
  const rows = symbols
    .map((s) => ({ symbol: s, r: radarScore(quotes[s], nifty) }))
    .filter((x) => x.r)
    .sort((a, b) => b.r.score - a.r.score);
  return { strong: rows.filter((x) => x.r.score >= 25).slice(0, n), weak: rows.filter((x) => x.r.score <= -25).slice(-n).reverse() };
}

function RadarCard({ symbols, quotes, onPick, live }) {
  const { strong, weak } = useMemo(() => radarPicks(symbols, quotes), [symbols, quotes]);
  const chip = (x, side) => (
    <button key={x.symbol} type="button" className={`dkb-chip is-${side}`} onClick={() => onPick(x.symbol)} title={`${x.symbol}: ${x.r.relPct > 0 ? "+" : ""}${x.r.relPct}% against the Nifty since the open, ${x.r.vsVwapPct > 0 ? "+" : ""}${x.r.vsVwapPct}% from VWAP. Open it.`}>
      {x.symbol}
      <small>{x.r.score > 0 ? `+${x.r.score}` : x.r.score}</small>
    </button>
  );
  return (
    <section className="dkb-card" aria-label="Watchlist radar">
      <h3>
        Radar <small>watchlist vs the Nifty</small>
      </h3>
      {!live ? (
        <p className="dkb-tip">The radar needs live prices: connect Zerodha.</p>
      ) : strong.length || weak.length ? (
        <>
          <div className="dkb-rrow">
            <span>Strong</span>
            <div>{strong.length ? strong.map((x) => chip(x, "up")) : <em>none</em>}</div>
          </div>
          <div className="dkb-rrow">
            <span>Weak</span>
            <div>{weak.length ? weak.map((x) => chip(x, "down")) : <em>none</em>}</div>
          </div>
          <p className="dkb-tip">Strength against the index and VWAP, since the open. Where to look first — not a signal.</p>
        </>
      ) : (
        <p className="dkb-tip">Nothing stands out yet. The radar fills in once the watchlist stocks have traded for a while today.</p>
      )}
    </section>
  );
}

const CHECKS = [
  { id: "stop", text: "My stop-loss is decided before I enter" },
  { id: "size", text: "The risk on this trade is inside my limit (position sizer)" },
  { id: "tide", text: "The market tide agrees with my side" },
  { id: "chase", text: "I am not chasing: the entry is near a level, not after a spike" },
  { id: "revenge", text: "This is a plan, not a reaction to the last loss" },
];

function loadChecks(date) {
  try {
    const raw = JSON.parse(window.localStorage.getItem("dkb-checks") || "{}");
    return raw.date === date && Array.isArray(raw.done) ? raw.done : [];
  } catch (_) {
    return [];
  }
}

function ChecklistCard({ now, status, ctx }) {
  const [done, setDone] = useState(() => loadChecks(now.date));
  // a new day starts clean
  useEffect(() => {
    setDone(loadChecks(now.date));
  }, [now.date]);
  const save = useCallback(
    (next) => {
      setDone(next);
      try {
        window.localStorage.setItem("dkb-checks", JSON.stringify({ date: now.date, done: next }));
      } catch (_) {
        /* private mode: it simply is not remembered */
      }
    },
    [now.date]
  );
  const flip = (id) => save(done.includes(id) ? done.filter((x) => x !== id) : [...done, id]);
  const s = sessionNow(now, Boolean(status.marketHours));
  const timeOk = s.phase === "open" && s.zone && (s.zone.id === "prime" || s.zone.id === "pm");
  const timeWarn = s.phase === "open" && s.zone && !timeOk;
  const tide = ctx && ctx.available ? ctx.tide : null;
  const count = done.filter((x) => CHECKS.some((c) => c.id === x)).length;
  return (
    <section className="dkb-card dkb-check" aria-label="Pre-trade checklist">
      <h3>
        Before you enter{" "}
        <small>
          {count}/{CHECKS.length}
        </small>
        <button type="button" className="dkb-reset" onClick={() => save([])} disabled={!count}>
          Reset
        </button>
      </h3>
      <ul>
        <li className={`dkb-auto ${timeOk ? "is-ok" : timeWarn ? "is-warn" : ""}`}>
          <span aria-hidden="true">{timeOk ? "✓" : timeWarn ? "!" : "–"}</span>
          <span>
            {s.phase !== "open" ? "The market is closed" : timeOk ? `Good time of day (${s.title.toLowerCase()})` : `Careful: ${s.title.toLowerCase()}`}
          </span>
        </li>
        {CHECKS.map((c) => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={done.includes(c.id)} onChange={() => flip(c.id)} />
              <span>
                {c.text}
                {c.id === "tide" && tide ? <em> (tide: {tide.label.toLowerCase()})</em> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ the board */

export default function DayBoard({ status, quotes, symbols, onPick }) {
  // NSE's time, re-read on the edge of every exchange minute (the board is minute-grained) — no drift, no lag
  const now = istParts(useExchangeNow(60000));

  // the market reading: shared with the strip below it by asking for the same page of the API
  const live = status.mode === "kite";
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    if (!live) {
      setCtx(null);
      return undefined;
    }
    let alive = true;
    const pull = () =>
      api("/api/admin/market/context")
        .then((d) => alive && setCtx(d))
        .catch(() => {});
    pull();
    const stop = everyVisible(pull, status.marketHours ? 30000 : 120000, { topics: ["market"] });
    return () => {
      alive = false;
      stop();
    };
  }, [live, status.marketHours]);

  return (
    <div className="dkb" role="region" aria-label="Day board">
      <SessionCard now={now} status={status} />
      <MarketCard ctx={live ? ctx : null} />
      <RadarCard symbols={symbols} quotes={quotes} onPick={onPick} live={live} />
      <ChecklistCard now={now} status={status} ctx={ctx} />
    </div>
  );
}
