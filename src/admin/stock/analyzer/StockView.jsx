import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { compact, day, inr, isNum, num, pct, signed, tone, when } from "./format";
import { useTick } from "./liveTicks";
import PriceChart from "./PriceChart";
import { History, Indicators, Levels, ScoreCard, Setups } from "./Panels";
import PositionSizer from "./PositionSizer";
import BacktestPanel from "./BacktestPanel";
import VerdictPanel from "./VerdictPanel";
import IntradayChart from "./IntradayChart";
import AiPanel from "./AiPanel";
import useVerdict, { callActive, callLabel, callTone } from "./useVerdict";
import useTripwires from "./useTripwires";
import useTape from "./useTape";
import useCopilot from "./useCopilot";
import Copilot from "./Copilot";
import OrderBook from "./OrderBook";
import FastRead from "./FastRead";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "setups", label: "Setups" },
  { id: "levels", label: "Levels" },
  { id: "indicators", label: "Indicators" },
  { id: "ai", label: "AI strategist" },
  { id: "size", label: "Position size" },
  { id: "backtest", label: "Backtest" },
  { id: "history", label: "History" },
];
const RANGES = [
  { bars: 66, label: "3M" },
  { bars: 130, label: "6M" },
  { bars: 260, label: "1Y" },
  { bars: 520, label: "2Y" },
];

const enc = encodeURIComponent;

// the chart you last chose (1 min, 5 min or daily) is remembered on this device
const CHART_KEY = "vpt.desk.chart";
const storedChart = () => {
  try {
    const m = window.localStorage.getItem(CHART_KEY);
    return ["m1", "m5", "daily"].includes(m) ? m : null;
  } catch (_) {
    return null;
  }
};

// On a wide screen the verdict sits in its own column beside the chart. On
// anything narrower it becomes the first tab, so nothing is pushed out of reach.
const WIDE = "(min-width: 1500px)";
function useWide() {
  const can = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [wide, setWide] = useState(() => (can ? window.matchMedia(WIDE).matches : true));
  useEffect(() => {
    if (!can) return undefined;
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [can]);
  return wide;
}

/** The bar that stays on screen: symbol, the live call, and the price — flashing on each tick. */
function Ticker({ symbol, meta, px: polledPx, chg: polledChg, chgPct: polledPct, sub: polledSub, call }) {
  // the price reads the live stream directly: each tick lands here at once, without redrawing the page
  const tick = useTick(symbol);
  const streamed = Boolean(tick && isNum(tick.last));
  const px = streamed ? tick.last : polledPx;
  const chg = streamed && isNum(tick.change) ? tick.change : polledChg;
  const chgPct = streamed && isNum(tick.changePct) ? tick.changePct : polledPct;
  const sub = streamed
    ? `streaming${tick.time ? ` · last trade ${tick.time.slice(11, 19)}` : ""}${isNum(tick.bid) && isNum(tick.ask) ? ` · bid ${num(tick.bid)} · ask ${num(tick.ask)}` : ""}`
    : polledSub;
  const [flash, setFlash] = useState("");
  const was = useRef(null);
  useEffect(() => {
    const before = was.current;
    was.current = px;
    if (before === null || before === px) return undefined;
    setFlash(px > before ? "up" : "down");
    const id = setTimeout(() => setFlash(""), 700);
    return () => clearTimeout(id);
  }, [px]);
  return (
    <header className="sv__ticker">
      <div className="sv__tk-id">
        <h2 className="sv__sym">{symbol}</h2>
        <p className="sv__meta">{meta}</p>
      </div>
      <div className="sv__tk-call">
        <span className={`callchip is-${callTone(call)} ${callActive(call) ? "is-active" : ""}`}>{callLabel(call)}</span>
        <small>{call && call.available ? `${call.weakening ? "⚠ weakening · " : ""}${call.session.label} · score ${call.score > 0 ? "+" : ""}${call.score}` : "live call off"}</small>
      </div>
      <div className={`sv__px is-${tone(chg)} ${flash ? `is-tick-${flash}` : ""}`}>
        <b>{inr(px)}</b>
        <span>
          {signed(chg)} ({pct(chgPct)})
        </span>
        <small>{sub}</small>
      </div>
    </header>
  );
}

export default function StockView({ symbol, quote, status, streaming = false, inWatchlist = true, onAdd = null }) {
  const [state, setState] = useState({ loading: true });
  const [intraday, setIntraday] = useState(null);
  const wide = useWide();
  const [tab, setTab] = useState(wide ? "overview" : "verdict");
  // a year of candles is too dense for a phone; start there with six months
  const [bars, setBars] = useState(() => (typeof window !== "undefined" && window.innerWidth < 700 ? 130 : 260));
  const [seed, setSeed] = useState(null);
  const [chartMode, setChartMode] = useState(storedChart); // null = pick for me
  const verdict = useVerdict(symbol, status);
  // every tick is checked against the call's levels the instant it arrives; a break re-reads the call at once
  const wireEvents = useTripwires(symbol, verdict.state.data, { alerts: verdict.alerts, refresh: verdict.reload });
  const top = useRef(null);

  const live = status.mode === "kite";
  // the 1-minute tape is fetched only while its chart is the one on screen
  const minute = useTape(symbol, 1, live && chartMode === "m1", Boolean(status.marketHours));
  // the AI co-pilot: asked when something happens on this stock, never on a loop
  const callNow = verdict.state.data && verdict.state.data.available && verdict.state.data.day ? verdict.state.data.day : null;
  const copilot = useCopilot(symbol, { day: callNow, log: verdict.log, events: wireEvents, active: live && Boolean(status.marketHours) });
  const pickChart = (m) => {
    setChartMode(m);
    try {
      window.localStorage.setItem(CHART_KEY, m);
    } catch (_) {
      /* private mode — the choice lasts for this visit */
    }
  };

  const load = useCallback(
    (quiet) => {
      let alive = true;
      if (!quiet) setState({ loading: true });
      api(`/api/admin/market/analysis/${enc(symbol)}?bars=${bars}`)
        .then((d) => alive && setState({ loading: false, data: d }))
        .catch((e) => alive && setState((s) => (quiet && s.data ? { ...s, refreshError: e.message } : { loading: false, error: e.message })));
      if (live) {
        api(`/api/admin/market/intraday/${enc(symbol)}`)
          .then((d) => alive && setIntraday(d))
          .catch(() => alive && setIntraday(null));
      } else setIntraday(null);
      return () => {
        alive = false;
      };
    },
    [symbol, bars, live]
  );

  useEffect(() => load(false), [load]);

  // while the market is open, refresh the reading once a minute without flicker
  useEffect(() => {
    if (!live || !status.marketHours) return undefined;
    const id = setInterval(() => load(true), 60000);
    return () => clearInterval(id);
  }, [live, status.marketHours, load]);

  // the verdict tab only exists on narrower screens
  useEffect(() => {
    if (wide && tab === "verdict") setTab("overview");
  }, [wide, tab]);

  const a = state.data;
  const sizeThis = (entry, stop) => {
    setSeed({ entry, stop, at: Date.now() });
    setTab("size");
    if (top.current) top.current.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  if (state.loading) return <Loading label={`Loading ${symbol}…`} />;
  if (state.error) {
    return (
      <div className="an-card">
        <h2 className="sv__sym">{symbol}</h2>
        <Alert>{state.error}</Alert>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => load(false)}>
          Try again
        </button>
      </div>
    );
  }
  if (!a.enoughData) {
    return (
      <div className="an-card">
        <h2 className="sv__sym">{symbol}</h2>
        <p className="adm-alert adm-alert--info">{a.message}</p>
      </div>
    );
  }

  // the live quote, when there is one, leads; otherwise the last daily bar
  const last = quote && isNum(quote.last) ? quote.last : a.price.last;
  const chg = quote && isNum(quote.change) ? quote.change : a.price.change;
  const chgPct = quote && isNum(quote.changePct) ? quote.changePct : a.price.changePct;
  const on = a.setups.filter((s) => s.triggered);

  // everything live comes from the verdict poll (every 5 s in market hours)
  const vd = verdict.state.data || null;
  const dayCall = vd && vd.available && vd.day ? vd.day : null;
  const tape = vd && vd.tape && vd.tape.bars && vd.tape.bars.length ? vd.tape : null;
  const px = quote && quote.streamed && isNum(quote.last) ? quote.last : vd && vd.available && vd.quoteLive && isNum(vd.last) ? vd.last : last;
  const pc = quote && isNum(quote.prevClose) ? quote.prevClose : a.price.prevClose;
  const pxChg = isNum(pc) && pc > 0 ? px - pc : chg;
  const pxChgPct = isNum(pc) && pc > 0 ? ((px - pc) / pc) * 100 : chgPct;
  const wanted = chartMode || (tape && live && status.marketHours ? "m5" : "daily");
  const mode = (wanted === "m1" && !live) || (wanted === "m5" && !tape) ? "daily" : wanted;
  const m1 = minute.data && minute.data.available ? minute.data : null;

  const panel = (
    <VerdictPanel
      className={wide ? "sv__rail" : ""}
      status={status}
      vs={verdict.state}
      onRefresh={verdict.reload}
      log={verdict.log}
      events={wireEvents}
      alerts={verdict.alerts}
      onToggleAlerts={verdict.toggleAlerts}
      onSize={sizeThis}
      chart={!wide && tape ? <IntradayChart tape={tape} call={dayCall} last={px} compactView /> : null}
      copilot={live ? <Copilot symbol={symbol} co={copilot} /> : null}
      book={live ? <OrderBook symbol={symbol} streaming={streaming} marketHours={Boolean(status.marketHours)} /> : null}
    />
  );
  const tabs = wide ? TABS : [{ id: "verdict", label: "Verdict" }, ...TABS];

  return (
    <div className="sv sv--desk">
      <Ticker
        symbol={symbol}
        px={px}
        chg={pxChg}
        chgPct={pxChgPct}
        call={dayCall}
        sub={quote && quote.time ? `live · last trade ${String(quote.time).slice(11, 19) || quote.time}` : `close of ${day(a.asOf, { day: "numeric", month: "short" })}`}
        meta={
          <>
            {a.source === "demo" ? "Demo data" : "NSE"} · daily bars to {day(a.asOf)}
            {a.barInProgress ? " · today’s bar still forming" : ""}
            {!inWatchlist && onAdd && (
              <button type="button" className="sv__add" onClick={onAdd}>
                + Add to watchlist
              </button>
            )}
          </>
        }
      />

      <div className="sv__top">
        {a.stale && (
          <p className="adm-alert adm-alert--error" role="status">
            <b>Not live.</b> {a.staleReason}
          </p>
        )}
        {state.refreshError && <p className="adm-alert adm-alert--info">Could not refresh just now ({state.refreshError}); showing the reading from {when(a.fetchedAt)}.</p>}

        <dl className="sv__stats">
          {[
            ["Open", inr(quote && isNum(quote.open) ? quote.open : a.price.open)],
            ["High", inr(quote && isNum(quote.high) ? quote.high : a.price.high)],
            ["Low", inr(quote && isNum(quote.low) ? quote.low : a.price.low)],
            ["Prev close", inr(pc)],
            ["Volume", compact(quote && isNum(quote.volume) ? quote.volume : a.price.volume)],
            ["Daily reading", `${a.score.value > 0 ? "+" : ""}${a.score.value} · ${a.score.label}`],
            ["Setups on", on.length ? on.map((s) => s.name).join(", ") : "None"],
            ...(quote && isNum(quote.upperCircuit) ? [["Circuit limits", `${inr(quote.lowerCircuit)} – ${inr(quote.upperCircuit)}`]] : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {wide && panel}

      <div className="sv__body" ref={top}>
        <div className="sv__tabs" role="tablist" aria-label="Analysis sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "setups" && on.length > 0 && <i>{on.length}</i>}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "verdict" && !wide && panel}
          {tab === "overview" && (
            <>
              <section className="an-card">
                <div className="sv__chartbar">
                  <div className="sv__ranges" role="group" aria-label="Chart type">
                    <button type="button" aria-pressed={mode === "m1"} disabled={!live} onClick={() => pickChart("m1")}>
                      Intraday · 1 min
                    </button>
                    <button type="button" aria-pressed={mode === "m5"} disabled={!tape} onClick={() => pickChart("m5")}>
                      Intraday · 5 min
                    </button>
                    <button type="button" aria-pressed={mode === "daily"} onClick={() => pickChart("daily")}>
                      Daily
                    </button>
                  </div>
                  {mode === "daily" && (
                    <div className="sv__ranges" role="group" aria-label="Chart period">
                      {RANGES.map((r) => (
                        <button key={r.bars} type="button" aria-pressed={bars === r.bars} onClick={() => setBars(r.bars)}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {mode === "m1" ? (
                  m1 ? (
                    <>
                      <IntradayChart tape={m1.tape} call={dayCall} last={px} fast={m1.fast} />
                      <FastRead fast={m1.fast} asOf={m1.tape.today ? null : m1.tape.date} />
                    </>
                  ) : minute.loading ? (
                    <Loading label="Loading the 1-minute bars…" />
                  ) : (
                    <p className="adm-alert adm-alert--info">{(minute.data && minute.data.reason) || minute.error || "The 1-minute bars are not available right now."}</p>
                  )
                ) : mode === "m5" && tape ? (
                  <>
                    <IntradayChart tape={tape} call={dayCall} last={px} />
                    {dayCall && dayCall.fast && <FastRead fast={dayCall.fast} />}
                  </>
                ) : (
                  <PriceChart chart={a.chart} levels={a.levels} />
                )}
                {mode === "m1" && minute.error && m1 && <p className="adm-small">Could not refresh the 1-minute bars just now ({minute.error}).</p>}
                {a.barInProgress && mode === "daily" && <p className="adm-small">Today’s daily bar is unfinished: setups are judged on the close and can appear or disappear until 3:30 PM.</p>}
              </section>
              <ScoreCard score={a.score} cautions={a.cautions} />
            </>
          )}
          {tab === "setups" && <Setups setups={a.setups} bearish={a.bearish} patterns={a.patterns} fullHistory={a.fullHistory} onSize={sizeThis} />}
          {tab === "levels" && <Levels levels={a.levels} last={px} intraday={intraday} />}
          {tab === "indicators" && <Indicators ind={a.indicators} liquidity={a.liquidity} volatilityPct={a.volatilityPct} />}
          {tab === "size" && <PositionSizer seed={seed || { entry: px, stop: a.levels.atr ? Math.round((px - 1.5 * a.levels.atr.value) * 100) / 100 : null, at: symbol }} />}
          {tab === "ai" && <AiPanel symbol={symbol} onSize={sizeThis} />}
          {tab === "backtest" && <BacktestPanel symbol={symbol} />}
          {tab === "history" && <History a={a} />}
        </div>
      </div>
    </div>
  );
}
