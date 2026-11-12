// The desk verdict for one stock, on three horizons:
//   1. Live intraday call — what the tape says right now, refreshed every few
//      seconds while the market is open: time of day, VWAP, opening range,
//      momentum, volume → long / short / wait / no trade, with entry, stop, targets.
//   2. Swing (days to weeks) — the daily-chart verdict and its delivery plan.
//   3. Long term (months to years) — the primary trend and the line that ends it.
// Then circuit limits, what argues against the reading, and every level in one ladder.
//
// Fixed rules, applied the same way every time. It never places an order.

import React, { useEffect, useState } from "react";
import { Loading } from "../../ui";
import { clock, compact, day, inr, isNum, num, pct } from "./format";
import FastRead from "./FastRead";

const ARROW = { up: "▲", down: "▼", sideways: "◆", mixed: "◆" };
const MARK = { bullish: "▲", bearish: "▼", neutral: "◆" };
const KIND = { circuit: "Circuit", pivot: "Pivot", resistance: "Resistance", support: "Support", ref: "Reference", ma: "Average", price: "Now" };
const STATE_TONE = { long: "long", short: "short", "wait-long": "long", "wait-short": "short", wait: "flat", "no-trade": "off" };
const STATE_WORD = { long: "LONG", short: "SHORT", "wait-long": "WAIT", "wait-short": "WAIT", wait: "WAIT", "no-trade": "NO TRADE" };
const STATE_MARK = { long: "▲", short: "▼", "wait-long": "▲", "wait-short": "▼", wait: "◆", "no-trade": "■" };

const list = (prices) => (prices.length ? prices.map((p) => inr(p)).join(" → ") : "—");
const tone = (x) => (!isNum(x) || x === 0 ? "flat" : x > 0 ? "up" : "down");
const plus = (x) => (x > 0 ? `+${x}` : `${x}`);
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function Row({ k, children, strong }) {
  return (
    <div className={strong ? "is-strong" : ""}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A ticking IST clock: the trading day runs on Indian time wherever the browser is. */
function IstClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <time className="vd-clock" data-tip="The time in India. The trading day runs on it wherever you are.">{now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })} IST</time>;
}

/** The trading day as a bar: where the clock is, and the times that change the rules. */
function SessionBar({ session }) {
  if (!session || !session.open) return null;
  const at = (h, m) => ((h * 60 + m - 555) / 375) * 100;
  const marks = [
    [at(9, 30), "9:30"],
    [at(11, 30), "11:30"],
    [at(13, 30), "1:30"],
    [at(14, 45), "2:45"],
    [at(15, 15), ""], // square-off: the tick is enough, its label would collide with 2:45
  ];
  return (
    <div className="vd-session">
      <div
        className="vd-session__bar"
        role="img"
        aria-label={`${session.elapsedPct}% of the trading day has passed`}
        data-tip="The trading day, 9:15 AM to 3:30 PM. The marks are 9:30 (opening range set), 11:30 and 1:30 (the midday lull), 2:45 (last new entries) and 3:15 (square-off)."
      >
        <span style={{ width: `${session.elapsedPct}%` }} />
        {marks.map(([x, label]) => (
          <i key={x} style={{ left: `${x}%` }} data-t={label} />
        ))}
      </div>
      <p>
        <b>{session.label}</b> · {session.ist} IST ·{" "}
        {session.minutesToCutoff > 0 ? `${mins(session.minutesToCutoff)} until the 2:45 PM cut-off for new entries` : session.minutesToSquareOff > 0 ? `square-off in about ${mins(session.minutesToSquareOff)}` : `closes in ${mins(session.minutesToClose)}`}
      </p>
    </div>
  );
}

/** The live call: the first thing on the panel while the market is open. */
function LiveCall({ d, onSize, fallback }) {
  if (!d.available) {
    return (
      <div className="vd-live vd-live--off">
        <p className="vd-live__k">Live intraday call</p>
        <p className="vd-live__head">
          <span aria-hidden="true">■</span> Off
        </p>
        <p className="vd-live__detail">{d.reason}</p>
        {fallback && (
          <p className="vd-live__detail">
            For {fallback.forSession}: long only above <b>{inr(fallback.long.entry)}</b>, short only below <b>{inr(fallback.short.entry)}</b> (from {fallback.basedOn}).
          </p>
        )}
      </div>
    );
  }
  const t = STATE_TONE[d.state];
  const p = d.plan;
  return (
    <div className={`vd-live vd-live--${t} ${d.state === "long" || d.state === "short" ? "is-active" : ""}`}>
      <div className="vd-live__row">
        <div>
          <p className="vd-live__k">
            <i className="vd-live__dot" aria-hidden="true" /> Live intraday call
          </p>
          <p className="vd-live__head">
            <span className="vd-live__badge">
              <span aria-hidden="true">{STATE_MARK[d.state]}</span> {STATE_WORD[d.state]}
            </span>
            {d.headline}
          </p>
        </div>
        <p className="vd-live__score" data-tip="The intraday score, from −100 (sellers in control) to +100 (buyers in control). “Tape” is the stock’s own action; “market” is the adjustment for the Nifty’s direction.">
          <b>{d.score > 0 ? `+${d.score}` : d.score}</b>
          <small>{d.marketAdj ? `tape ${plus(d.tapeScore)} · market ${plus(d.marketAdj)} · needs ±${d.threshold}` : `tape score · needs ±${d.threshold}`}</small>
        </p>
      </div>
      <p className="vd-live__detail">{d.detail}</p>

      {p ? (
        <dl className="vd-live__plan">
          <Row k={p.side === "long" ? `Buy ${p.entryNote}` : `Sell ${p.entryNote}`} strong>
            {inr(p.entry)}
          </Row>
          <Row k="Stop-loss" strong>
            {inr(p.stop)}
          </Row>
          <Row k="Risk / share">
            {inr(p.riskPerShare)} <small>({num(p.riskPct)}%)</small>
          </Row>
          {p.targets.map((x) => (
            <Row key={x.label} k={`Target ${x.label}`}>
              {inr(x.price)}
            </Row>
          ))}
          {p.nextLevels.map((x) => (
            <Row key={x.label} k={`Level: ${x.label}`}>
              {inr(x.price)}
            </Row>
          ))}
        </dl>
      ) : (
        <dl className="vd-live__plan">
          <Row k="Long only above">{inr(d.triggers.long)}</Row>
          <Row k="Short only below">{inr(d.triggers.short)}</Row>
          <Row k="VWAP">{inr(d.movement.vwap)}</Row>
        </dl>
      )}
      {p && p.clipped && <p className="vd-note">A target beyond the circuit limit was removed.</p>}
      {p && p.side === "long" && onSize && (
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => onSize(p.entry, p.stop)}>
          Size this trade
        </button>
      )}
      {p && p.side === "short" && <p className="vd-note">Quantity = the money you are prepared to lose on this trade ÷ {inr(p.riskPerShare)} per share.</p>}

      {d.early && d.early.length > 0 && (
        <div className={`vd-early ${d.weakening ? "is-hot" : ""}`}>
          <h5>{d.weakening ? "⚠ Weakening — early warning against this trade" : "Early warnings — first signs of a change"}</h5>
          <ul>
            {d.early.map((e) => (
              <li key={e.id}>
                {e.text}
                {e.against !== "either" && <small> Argues against a {e.against}.</small>}
              </li>
            ))}
          </ul>
          <p>Fast to warn, slow to commit: a warning is a reason to tighten up or wait. It does not start a trade by itself.</p>
        </div>
      )}

      <SessionBar session={d.session} />

      {d.notes.length > 0 && (
        <ul className="vd-live__notes">
          {d.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Everything that happened on this stock since it was opened — level breaks and call changes — newest first. */
function CallLog({ log, events = [], alerts, onToggleAlerts }) {
  const rows = [
    ...log.map((e) => ({ key: `c${e.at}`, t: Date.parse(e.at), tone: e.side === "long" ? "long" : e.side === "short" ? "short" : "flat", price: e.price, strong: true, call: e })),
    ...events.map((e) => ({ key: `w${e.id}${e.at}`, t: e.at, tone: e.tone === "up" ? "long" : e.tone === "down" ? "short" : "flat", price: e.price, strong: e.urgent, text: e.text })),
  ]
    .sort((x, y) => y.t - x.t)
    .slice(0, 40);
  return (
    <div className="vd-log">
      <div className="vd-log__top">
        <h4>Live events · level breaks and call changes</h4>
        {onToggleAlerts && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-pressed={alerts} onClick={onToggleAlerts}>
            {alerts ? "Alerts on — sound" : "Alert me with a sound"}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="vd-note">
          Nothing yet. Every tick is checked against VWAP, the two triggers, the previous day’s high and low, and — in a trade — the stop and targets. A break is listed here the
          instant it happens{alerts ? ", with a sound for the stop, a target or a trigger" : ""}, and the call is read again at once.
        </p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.key} className={`is-${r.tone} ${r.strong ? "is-strong" : ""}`}>
              <time>{clock(new Date(r.t).toISOString())}</time>
              <span>
                {r.call ? (
                  <>
                    Call: {r.call.from} → <b>{r.call.to}</b>
                  </>
                ) : (
                  r.text
                )}
              </span>
              <em>{inr(r.price)}</em>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const OLD_SERVER = "The API server is running older code than this page. Stop npm run dev, start it again, and reload.";

function Tile({ k, v, sub, t }) {
  return (
    <div className={t ? `is-${t}` : ""}>
      <dt>{k}</dt>
      <dd>{v}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** How it is moving right now. */
function Movement({ m, fast }) {
  return (
    <div className="vd-block">
      <h4>Movement right now</h4>
      <dl className="vd-tiles">
        <Tile k="Today" v={pct(m.changePct)} t={tone(m.changePct)} sub="vs previous close" />
        <Tile k="Opening gap" v={pct(m.gapPct)} t={tone(m.gapPct)} sub={`opened ${inr(m.open)}`} />
        <Tile k="Since the open" v={pct(m.fromOpenPct)} t={tone(m.fromOpenPct)} />
        <Tile k="vs VWAP" v={pct(m.vsVwapPct)} t={tone(m.vsVwapPct)} sub={`VWAP ${inr(m.vwap)}`} />
        <Tile k="Last 15 min" v={pct(m.m15Pct)} t={tone(m.m15Pct)} />
        <Tile k="Last 30 min" v={pct(m.m30Pct)} t={tone(m.m30Pct)} />
        <Tile k="Range used" v={`${m.rangeUsedPct}%`} sub={`of a normal day (ATR ${inr(m.atr)})`} t={m.rangeUsedPct >= 150 ? "down" : ""} />
        <Tile k="Volume pace" v={isNum(m.volumePace) ? `${num(m.volumePace, 1)}×` : "—"} sub={`${compact(m.volume)} so far · early hours run high`} />
        <Tile k="5-min RSI" v={isNum(m.rsi5) ? num(m.rsi5, 0) : "—"} sub={isNum(m.rsi5) ? (m.rsi5 >= 70 ? "overbought" : m.rsi5 <= 30 ? "oversold" : "mid-range") : "warming up"} />
        <Tile k="Opening range" v={`${num(m.orLow)} – ${num(m.orHigh)}`} sub="first 15 minutes" />
      </dl>
      {fast && fast.available && (
        <>
          <h4>1-minute tape · the fastest view</h4>
          <FastRead fast={fast} compact />
        </>
      )}
      <div className="vd-band vd-band--day" role="img" aria-label={`Price is ${m.dayPosPct}% of the way from today's low to today's high`}>
        <i style={{ left: `${Math.max(0, Math.min(100, m.dayPosPct))}%` }} />
      </div>
      <div className="vd-band__ends">
        <span>
          <small>Day low</small>
          <b>{inr(m.dayLow)}</b>
        </span>
        <span>
          <small>Day high</small>
          <b>{inr(m.dayHigh)}</b>
        </span>
      </div>
    </div>
  );
}

/** Every factor behind the score, so the call can be checked, not just trusted. */
function Factors({ d }) {
  const market = d.marketFactors || [];
  const row = (f) => (
    <li key={f.name}>
      <span>
        <b>{f.name}</b>
        <small>{f.reading}</small>
      </span>
      <em className={`is-${tone(f.pts)}`}>
        {plus(f.pts)}
        <small> / {f.max}</small>
      </em>
    </li>
  );
  return (
    <div className="vd-block">
      <h4>Why — the score, factor by factor</h4>
      <ul className="vd-factors">
        {d.factors.map(row)}
        {market.length > 0 && (
          <li className="vd-factors__sub">
            <span>
              <b>The stock’s own tape</b>
            </span>
            <em className={`is-${tone(d.tapeScore)}`}>{plus(d.tapeScore)}</em>
          </li>
        )}
        {market.map(row)}
        <li className="vd-factors__sum">
          <span>
            <b>{market.length > 0 ? "Score used for the call" : "Tape score"}</b>
            <small>
              {d.bias === "none" ? `no side: it needs ${d.threshold} or more either way` : `${d.bias} bias`}
              {d.withDaily === "with" ? " · with the daily trend" : d.withDaily === "against" ? " · against the daily trend" : ""}
              {market.length === 0 ? " · the market’s direction was not available" : ""}
            </small>
          </span>
          <em className={`is-${tone(d.score)}`}>{plus(d.score)}</em>
        </li>
      </ul>
    </div>
  );
}

function Side({ name, word, plan, preferred, dimmed }) {
  return (
    <div className={`vd-side vd-side--${name} ${preferred ? "is-pref" : ""} ${dimmed ? "is-dim" : ""}`}>
      <h5>
        {name === "long" ? "▲ Long" : "▼ Short"}
        <small>{preferred ? "preferred side" : dimmed ? "not preferred" : "either side"}</small>
      </h5>
      <dl>
        <Row k={word} strong>
          {inr(plan.entry)}
        </Row>
        <Row k="Stop-loss">{inr(plan.stop)}</Row>
        <Row k="Risk / share">{inr(plan.riskPerShare)}</Row>
        <Row k="Targets">{list(plan.targets)}</Row>
      </dl>
      {plan.note && <p className="vd-note">{plan.note}</p>}
    </div>
  );
}

/** Swing: the daily-chart verdict and its delivery plan. */
function Swing({ v, onSize }) {
  const s = v.swing;
  return (
    <div className="vd-block">
      <h4>Swing · days to weeks · delivery, long only</h4>
      <p className={`vd-stance vd-stance--${v.direction}`}>
        <b>
          <span aria-hidden="true">{MARK[v.direction]}</span> {v.stance}
        </b>
        <span>
          score {v.composite > 0 ? `+${v.composite}` : v.composite} · conviction {v.conviction}/100 ({v.convictionLabel})
        </span>
      </p>
      <p className="vd-headline">{s.headline}</p>
      {s.entry !== undefined ? (
        <>
          <dl className="vd-dl">
            <Row k={s.action === "buy-setup" ? "Entry near" : "Buy above"} strong>
              {inr(s.entry)}
            </Row>
            <Row k="Stop-loss" strong>
              {inr(s.stop)}
            </Row>
            <Row k="Risk / share">
              {inr(s.riskPerShare)} <small>({num(s.riskPct)}%)</small>
            </Row>
            {s.targets.map((t) => (
              <Row key={t.r} k={`Target ${t.r}R`}>
                {inr(t.price)}
              </Row>
            ))}
            {s.firstResistance && (
              <Row k="First resistance">
                {inr(s.firstResistance.price)} <small>({num(s.firstResistance.rewardToRisk, 1)}× risk)</small>
              </Row>
            )}
            <Row k="Bullish case ends">below {inr(s.invalidBelow)}</Row>
          </dl>
          <p className="vd-note">{s.basis}</p>
          {s.pullbackZone && (
            <p className="vd-note">
              <b>
                Pullback zone {inr(s.pullbackZone.low)} – {inr(s.pullbackZone.high)}.
              </b>{" "}
              {s.pullbackZone.note}
            </p>
          )}
          <p className="vd-note">{s.invalidNote}</p>
          {onSize && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onSize(s.entry, s.stop)}>
              Size this swing trade
            </button>
          )}
        </>
      ) : s.action === "avoid" ? (
        <>
          <dl className="vd-dl">
            <Row k="Holders: warning below" strong>
              {inr(s.holdersExitBelow)}
            </Row>
            <Row k="Improves only above" strong>
              {inr(s.improvesAbove)}
            </Row>
          </dl>
          <p className="vd-note">{s.basis}</p>
          <p className="vd-note">
            {s.holdersNote} {s.improvesNote}
          </p>
        </>
      ) : (
        <>
          <dl className="vd-dl">
            <Row k="Turns bullish above" strong>
              {inr(s.bullishAbove)}
            </Row>
            <Row k="Turns bearish below" strong>
              {inr(s.bearishBelow)}
            </Row>
          </dl>
          <p className="vd-note">{s.basis}</p>
          <p className="vd-note">{s.note}</p>
        </>
      )}
      <ul className="vd-frames">
        {v.frames.map((f) => (
          <li key={f.name} className={`is-${f.dir || "none"}`}>
            <span className="vd-frames__dir">
              <i aria-hidden="true">{ARROW[f.dir] || "–"}</i> {f.label}
            </span>
            <span className="vd-frames__name">
              <b>{f.name}</b>
              <small>{f.basis}</small>
            </span>
          </li>
        ))}
      </ul>
      {(v.activeSetups.length > 0 || v.warnings.length > 0) && (
        <p className="vd-chips">
          {v.activeSetups.map((x) => (
            <span key={x} className="an-chip an-chip--bullish">
              ▲ {x}
            </span>
          ))}
          {v.warnings.map((x) => (
            <span key={x} className="an-chip an-chip--bearish">
              ▼ {x}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Long term: the primary trend, the line that ends it, and what the stock has actually done. */
function LongTerm({ lt }) {
  if (!lt.available) {
    return (
      <div className="vd-block">
        <h4>Long term · months to years</h4>
        <p className="vd-note">{lt.reason}</p>
      </div>
    );
  }
  const L = lt.levels;
  const R = lt.returns;
  const dir = lt.trend === "up" ? "bullish" : lt.trend === "down" ? "bearish" : "neutral";
  return (
    <div className="vd-block">
      <h4>Long term · months to years</h4>
      <p className={`vd-stance vd-stance--${dir}`}>
        <b>
          <span aria-hidden="true">{ARROW[lt.trend]}</span> {lt.stance}
        </b>
        <span>
          {lt.met} of {lt.total} trend checks met
        </span>
      </p>
      <p className="vd-headline">{lt.rule}</p>
      <ul className="vd-checks">
        {lt.checks.map((c) => (
          <li key={c.name} className={c.ok ? "is-ok" : "is-no"}>
            <i aria-hidden="true">{c.ok ? "✓" : "✕"}</i>
            <span>
              {c.name}
              <span className="adm-sr">{c.ok ? " — yes" : " — no"}</span>
              <small>{c.reading}</small>
            </span>
          </li>
        ))}
      </ul>
      <dl className="vd-dl">
        <Row k={`Trend line (${L.lineName})`} strong>
          {inr(L.line)}
        </Row>
        <Row k="200-day average" strong>
          {inr(L.ema200)} <small>({pct(L.stretchPct, 1)})</small>
        </Row>
        <Row k="30-week average">{inr(L.week30)}</Row>
        <Row k="52-week range">
          {num(L.week52Low)} – {num(L.week52High)}
        </Row>
        <Row k="Highest in this history">
          {inr(L.peak)} <small>({pct(L.fromPeakPct, 1)})</small>
        </Row>
        <Row k="12 months">{pct(R.y1, 1)}</Row>
        <Row k="3 years, per year">{pct(R.cagr3, 1)}</Row>
        <Row k="5 years, per year">{pct(R.cagr5, 1)}</Row>
        {isNum(R.cagrAll) && (
          <Row k={`${num(R.years, 1)} years, per year`}>{pct(R.cagrAll, 1)}</Row>
        )}
        {isNum(R.vsIndex1y) && <Row k={`vs ${R.indexName}, 12 months`}>{pct(R.vsIndex1y, 1)} pts</Row>}
        <Row k="Worst fall from a peak">{isNum(lt.risk.maxDrawdownPct) ? `−${num(lt.risk.maxDrawdownPct, 0)}%` : "—"}</Row>
        <Row k="Yearly volatility">{isNum(lt.risk.volatilityPct) ? `${num(lt.risk.volatilityPct, 0)}%` : "—"}</Row>
      </dl>
      {lt.notes.map((n) => (
        <p key={n} className="vd-note">
          {n}
        </p>
      ))}
      <p className="vd-note vd-note--caveat">{lt.caveat}</p>
    </div>
  );
}

export default function VerdictPanel({ status, vs, onRefresh, onSize, log = [], events = [], alerts = false, onToggleAlerts = null, chart = null, copilot = null, book = null, className = "" }) {
  const state = vs;
  const live = status.mode === "kite";
  const v = state.data;
  const head = (
    <header className="vd__top">
      <h3 id="vd-h">Desk verdict</h3>
      <span className="vd__meta">
        <IstClock />
        {v && <span>read {clock(v.at)}</span>}
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRefresh} disabled={state.loading}>
          Refresh
        </button>
      </span>
    </header>
  );

  if (state.loading || state.error || !v.available) {
    return (
      <section className={`vd an-card ${className}`} aria-labelledby="vd-h">
        {head}
        {state.loading && <Loading label="Reading the market…" />}
        {state.error && <p className="adm-alert adm-alert--error">{state.error}</p>}
        {v && !v.available && <p className="adm-alert adm-alert--info">{v.reason}</p>}
      </section>
    );
  }

  // never assume a field is there: an older API server simply lacks the newer ones
  const outdated = !v.day || !v.longTerm;
  const d = v.day || { available: false, reason: OLD_SERVER };
  const lt = v.longTerm || { available: false, reason: OLD_SERVER };
  const i = v.intraday;
  const m = v.movement;
  const inPlay = d.available && (d.state === "long" || d.state === "short");
  const dayWord = !d.available ? "Off" : inPlay ? `${STATE_WORD[d.state]} in play` : `${STATE_WORD[d.state]}${d.side !== "none" ? ` · ${d.side} side` : ""}`;
  const dayTone = d.available ? STATE_TONE[d.state] : "off";
  const ltTone = !lt.available ? "off" : lt.trend === "up" ? "long" : lt.trend === "down" ? "short" : "flat";
  const swTone = v.direction === "bullish" ? "long" : v.direction === "bearish" ? "short" : "flat";

  return (
    <section className={`vd an-card ${className}`} aria-labelledby="vd-h">
      {head}

      {outdated && <p className="adm-alert adm-alert--error">{OLD_SERVER}</p>}
      <LiveCall d={d} onSize={onSize} fallback={i} />
      {copilot}
      {chart}
      {book}
      {d.available && <CallLog log={log} events={events} alerts={alerts} onToggleAlerts={onToggleAlerts} />}

      {/* the three horizons, side by side */}
      <ul className="vd-horizons" aria-label="The three horizons">
        <li className={`is-${dayTone}`}>
          <small>Intraday · today</small>
          <b>{dayWord}</b>
          <span>{d.available ? `tape score ${d.score > 0 ? "+" : ""}${d.score}` : "no live tape"}</span>
        </li>
        <li className={`is-${swTone}`}>
          <small>Swing · days to weeks</small>
          <b>{v.stance}</b>
          <span>
            score {v.composite > 0 ? "+" : ""}
            {v.composite}
          </span>
        </li>
        <li className={`is-${ltTone}`}>
          <small>Long term · months to years</small>
          <b>{lt.available ? (lt.trend === "up" ? "Uptrend" : lt.trend === "down" ? "Downtrend" : "No clear trend") : "Too little history"}</b>
          <span>{lt.available ? `${lt.met} of ${lt.total} checks` : "—"}</span>
        </li>
      </ul>

      <p className="vd__asof">
        {v.source === "demo" ? "Demo prices" : v.quoteLive ? `Live price ${inr(v.last)}` : `Last close ${inr(v.last)}`}
        {d.available && isNum(d.movement.quoteAgeSec) ? ` · last trade ${d.movement.quoteAgeSec}s before this reading` : ""}
        {live && status.marketHours ? " · the call is recomputed every 2 seconds" : ""}
        {v.quoteNote && v.source !== "demo" ? ` · ${v.quoteNote}` : ""}
      </p>
      {v.stale && (
        <p className="adm-alert adm-alert--error">
          <b>Not live.</b> {v.staleReason}
        </p>
      )}
      {state.refreshError && <p className="adm-alert adm-alert--error">Could not refresh just now ({state.refreshError}). This reading is from {clock(v.at)} — do not act on it as live.</p>}

      <div className="vd__grid">
        {d.available && <Movement m={d.movement} fast={d.fast} />}
        {d.available && <Factors d={d} />}

        {!d.available && (
          <div className="vd-block">
            <h4>Intraday levels · for {i.forSession}</h4>
            <div className="vd-sides">
              <Side name="long" word="Buy above" plan={i.long} preferred={i.preferred === "long"} dimmed={i.preferred === "short"} />
              <Side name="short" word="Sell below" plan={i.short} preferred={i.preferred === "short"} dimmed={i.preferred === "long"} />
            </div>
            <p className="vd-note">
              <b>{i.preferredNote}</b>
            </p>
            <p className="vd-note">
              Triggers from {i.basedOn}. {i.stopRule} A short in the cash market must be closed the same day.
            </p>
          </div>
        )}

        <Swing v={v} onSize={onSize} />
        <LongTerm lt={lt} />

        {/* ------------------------------------------- circuits and daily range */}
        <div className="vd-block">
          <h4>Circuit limits</h4>
          {v.circuit ? (
            <>
              <div className="vd-band" role="img" aria-label={`Price is ${num(v.circuit.positionPct, 0)}% of the way from the lower to the upper circuit`}>
                <i style={{ left: `${Math.max(0, Math.min(100, v.circuit.positionPct))}%` }} />
              </div>
              <div className="vd-band__ends">
                <span>
                  <small>Lower circuit</small>
                  <b className="is-down">{inr(v.circuit.lower)}</b>
                  <small>{pct(v.circuit.toLowerPct)} away</small>
                </span>
                <span>
                  <small>Upper circuit</small>
                  <b className="is-up">{inr(v.circuit.upper)}</b>
                  <small>{pct(v.circuit.toUpperPct)} away</small>
                </span>
              </div>
              {v.source === "demo" && <p className="vd-note">Demo mode: a made-up 10% band, to show how this looks.</p>}
            </>
          ) : (
            <p className="vd-note">{v.quoteLive ? "The exchange quote carries no price band for this symbol (indices have none)." : "Circuit limits come with the live quote. Connect Zerodha to see them."}</p>
          )}

          <h4>A normal day for this stock</h4>
          <dl className="vd-dl">
            <Row k="Day’s range (ATR)">
              {inr(m.atr)} <small>({num(m.atrPct)}%)</small>
            </Row>
            <Row k="Expected range">
              {inr(m.expectedLow)} – {inr(m.expectedHigh)}
            </Row>
            {isNum(m.relVolume) && <Row k="Volume vs 20-day">{num(m.relVolume, 1)}×</Row>}
          </dl>
        </div>

        {/* ------------------------------------------------- what is against */}
        <div className="vd-block vd-against">
          <h4>What argues against the swing reading</h4>
          {v.against.length ? (
            <ul>
              {v.against.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="vd-note">Nothing in the rules argues against it right now. News, results and gaps are outside what this can see.</p>
          )}
        </div>

        {/* ----------------------------------------------------------- ladder */}
        <div className="vd-block vd-ladderwrap">
          <h4>Every level, top to bottom</h4>
          <div className="vd-ladder__scroll">
            <table className="vd-ladder">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Price</th>
                  <th scope="col">Away</th>
                </tr>
              </thead>
              <tbody>
                {v.ladder.map((r, k) => (
                  <tr key={`${r.label}${k}`} className={`is-${r.kind}`}>
                    <th scope="row">
                      <i aria-hidden="true" />
                      {r.label}
                      <small>{KIND[r.kind]}</small>
                    </th>
                    <td>{num(r.price)}</td>
                    <td>{r.kind === "price" ? "—" : pct(r.awayPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="vd-note">Pivots and the previous day’s range are from the last completed session ({day(v.completedSession)}).</p>
        </div>
      </div>

      <p className="vd__foot">
        A mechanical reading of price, volume, the clock and — while the stream is live — the five best levels of the order book, applied the same
        way every time. It follows the tape; it does not predict it, and a call can flip within minutes. It cannot see news, results or your
        finances, it will be wrong some of the time, and it is not investment advice. The decision — and the order — are yours.
      </p>
    </section>
  );
}
