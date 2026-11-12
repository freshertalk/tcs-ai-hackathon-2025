import React from "react";
import { compact, day, inr, isNum, num, pct, tone } from "./format";

/* ------------------------------------------------------------ score card */

export function ScoreCard({ score, cautions }) {
  const groups = [];
  for (const f of score.factors) {
    let g = groups.find((x) => x.name === f.group);
    if (!g) groups.push((g = { name: f.group, rows: [], points: 0, max: 0 }));
    g.rows.push(f);
    g.points += f.points;
    g.max += f.max;
  }
  const pos = ((score.value + 100) / 200) * 100;
  const cls = score.value >= 20 ? "is-up" : score.value <= -20 ? "is-down" : "is-flat";

  return (
    <section className="an-card" aria-labelledby="score-h">
      <header className="an-card__head">
        <h3 id="score-h">Technical reading</h3>
        <p>A checklist, not a forecast. Every line shows what it measured and the points it added or took away.</p>
      </header>

      <div className={`score ${cls}`}>
        <div className="score__num">
          <b>{score.value > 0 ? `+${score.value}` : score.value}</b>
          <span>{score.label}</span>
        </div>
        <div className="score__bar" role="img" aria-label={`Score ${score.value} on a scale from minus 100 to plus 100`}>
          <i style={{ left: `${pos}%` }} />
          <div className="score__scale">
            <span>−100 bearish</span>
            <span>0</span>
            <span>bullish +100</span>
          </div>
        </div>
      </div>

      <div className="score__groups">
        {groups.map((g) => (
          <div key={g.name} className="score__group">
            <h4>
              {g.name}
              <span className={tone(g.points) === "up" ? "is-up" : tone(g.points) === "down" ? "is-down" : ""}>
                {g.points > 0 ? `+${g.points}` : g.points} of ±{g.max}
              </span>
            </h4>
            <ul>
              {g.rows.map((f) => (
                <li key={f.name}>
                  <span className="score__name">
                    {f.name}
                    <small>{f.reading}</small>
                  </span>
                  <span className="score__val">{f.value}</span>
                  <span className={`score__pts ${f.points > 0 ? "is-up" : f.points < 0 ? "is-down" : ""}`}>
                    {f.points > 0 ? `+${f.points}` : f.points}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {cautions.length > 0 && (
        <div className="an-cautions">
          <h4>Things to be careful about</h4>
          <ul>
            {cautions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- setups */

export function Setups({ setups, bearish, patterns, fullHistory, onSize }) {
  const sorted = [...setups].sort((a, b) => Number(b.triggered) - Number(a.triggered) || b.met / (b.total || 1) - a.met / (a.total || 1));
  return (
    <section className="an-card" aria-labelledby="setups-h">
      <header className="an-card__head">
        <h3 id="setups-h">Trade setups</h3>
        <p>
          Seven published, rule-based methods. A setup is “on” only when <b>every</b> condition is true on the latest
          close. Long side only — in the cash market a bearish reading means exit or stay out, not sell short.
        </p>
      </header>

      {!fullHistory && (
        <p className="adm-alert adm-alert--info">Setups need about 200 trading days of history; this stock does not have that yet.</p>
      )}

      {bearish.length > 0 && (
        <div className="an-bear">
          <h4>Warning signs in the last 5 sessions</h4>
          <ul>
            {bearish.map((b) => (
              <li key={`${b.date}${b.name}`}>
                <b>{b.name}</b> — {b.detail} <small>({b.barsAgo === 0 ? "latest bar" : `${b.barsAgo} bar${b.barsAgo > 1 ? "s" : ""} ago`}, {day(b.date, { day: "numeric", month: "short" })})</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {patterns.length > 0 && (
        <p className="an-patterns">
          Latest candle:{" "}
          {patterns.map((p) => (
            <span key={p.name} className={`an-chip an-chip--${p.bias}`} title={p.note}>
              {p.name}
            </span>
          ))}
        </p>
      )}

      <ul className="setups">
        {sorted.map((s) => (
          <li key={s.id} className={`setup ${s.triggered ? "is-on" : ""}`}>
            <div className="setup__top">
              <div>
                <h4>{s.name}</h4>
                <small>{s.style}</small>
              </div>
              <span className={`an-pill ${s.triggered ? "an-pill--on" : ""}`}>
                {s.triggered ? "Triggered on the latest close" : s.total ? `${s.met} of ${s.total} conditions` : "Not enough history"}
              </span>
            </div>
            <p className="setup__idea">{s.idea}</p>

            {s.conditions.length > 0 && (
              <ul className="setup__conds">
                {s.conditions.map((c) => (
                  <li key={c.label} className={c.ok ? "is-ok" : "is-no"}>
                    <i aria-hidden="true">{c.ok ? "✓" : "✗"}</i>
                    <span>
                      {c.label}
                      {c.detail && <small>{c.detail}</small>}
                    </span>
                    <span className="adm-sr">{c.ok ? "met" : "not met"}</span>
                  </li>
                ))}
              </ul>
            )}

            {s.plan && (
              <div className="setup__plan">
                <dl>
                  <div>
                    <dt>Reference (last close)</dt>
                    <dd>{inr(s.plan.entryRef)}</dd>
                  </div>
                  <div>
                    <dt>Stop-loss</dt>
                    <dd className="is-down">{inr(s.plan.stop)}</dd>
                  </div>
                  <div>
                    <dt>Risk per share</dt>
                    <dd>
                      {inr(s.plan.riskPerShare)} <small>({s.plan.riskPct}%)</small>
                    </dd>
                  </div>
                  {s.plan.targets.map((t) => (
                    <div key={t.r}>
                      <dt>{t.r}R level</dt>
                      <dd className="is-up">{inr(t.price)}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  The rule buys at the <b>next session’s open</b>, so the real entry will differ from the last close.{" "}
                  {s.plan.exitRule}
                </p>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onSize(s.plan.entryRef, s.plan.stop)}>
                  Size this trade
                </button>
              </div>
            )}

            <p className="setup__foot">
              {s.exitText}
              {s.lastFired && !s.triggered ? ` Last triggered ${s.lastFired.barsAgo} bars ago (${day(s.lastFired.date, { day: "numeric", month: "short" })}).` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- levels */

function Row({ k, v, note, cls }) {
  return (
    <tr>
      <th scope="row">{k}</th>
      <td className={cls}>{v}</td>
      <td>{note}</td>
    </tr>
  );
}

export function Levels({ levels, last, intraday }) {
  const p = levels.pivots;
  const w = levels.week52;
  const away = (x) => (isNum(x) && isNum(last) ? pct(((x - last) / last) * 100, 1) : "");
  return (
    <section className="an-card" aria-labelledby="levels-h">
      <header className="an-card__head">
        <h3 id="levels-h">Price levels</h3>
        <p>Where buyers and sellers have acted before, and how far price usually travels in a day.</p>
      </header>

      <div className="an-two">
        <div>
          <h4>52-week range</h4>
          <div className="range" role="img" aria-label={`Price is ${w.positionPct}% of the way from the 52-week low to the 52-week high`}>
            <div className="range__bar">
              <i style={{ left: `${Math.max(0, Math.min(100, w.positionPct ?? 0))}%` }} />
            </div>
            <div className="range__ends">
              <span>
                Low {inr(w.low)}
                <small>
                  {day(w.lowDate, { day: "numeric", month: "short" })} · {pct(w.fromLowPct, 1)}
                </small>
              </span>
              <span>
                High {inr(w.high)}
                <small>
                  {day(w.highDate, { day: "numeric", month: "short" })} · {pct(w.fromHighPct, 1)}
                </small>
              </span>
            </div>
          </div>

          <h4>Support and resistance</h4>
          <table className="an-table">
            <tbody>
              {[...levels.resistances].reverse().map((r) => (
                <Row key={`r${r.price}`} k="Resistance" v={inr(r.price)} cls="is-down" note={`${pct(r.awayPct, 1)} · tested ${r.touches}×`} />
              ))}
              <Row k="Last close" v={inr(last)} note={day(levels.lastBar.date)} cls="is-strong" />
              {levels.supports.map((r) => (
                <Row key={`s${r.price}`} k="Support" v={inr(r.price)} cls="is-up" note={`${pct(r.awayPct, 1)} · tested ${r.touches}×`} />
              ))}
            </tbody>
          </table>
          {levels.supports.length + levels.resistances.length === 0 && <p className="adm-small">No clear swing levels in the last year.</p>}

          {levels.atr && (
            <>
              <h4>Typical daily move (ATR 14)</h4>
              <p className="an-atr">
                <b>{inr(levels.atr.value)}</b> a day, {levels.atr.pctOfPrice}% of price. A normal next session would sit roughly
                between <b>{inr(levels.atr.nextDayLow)}</b> and <b>{inr(levels.atr.nextDayHigh)}</b>.
              </p>
            </>
          )}
        </div>

        <div>
          <h4>Pivot levels for the next session</h4>
          <table className="an-table">
            <tbody>
              <Row k="R3" v={num(p.r3)} note={away(p.r3)} />
              <Row k="R2" v={num(p.r2)} note={away(p.r2)} />
              <Row k="R1" v={num(p.r1)} note={away(p.r1)} />
              <Row k="CPR top" v={num(p.cprTop)} note={away(p.cprTop)} />
              <Row k="Pivot" v={num(p.p)} note={away(p.p)} cls="is-strong" />
              <Row k="CPR bottom" v={num(p.cprBottom)} note={away(p.cprBottom)} />
              <Row k="S1" v={num(p.s1)} note={away(p.s1)} />
              <Row k="S2" v={num(p.s2)} note={away(p.s2)} />
              <Row k="S3" v={num(p.s3)} note={away(p.s3)} />
            </tbody>
          </table>
          <p className="adm-small">Calculated from the bar of {day(p.basedOn)} (high {num(levels.lastBar.high)}, low {num(levels.lastBar.low)}, close {num(levels.lastBar.close)}).</p>

          <h4>Moving averages</h4>
          <table className="an-table">
            <tbody>
              {[
                ["20 EMA", levels.movingAverages.ema20],
                ["50 EMA", levels.movingAverages.ema50],
                ["200 EMA", levels.movingAverages.ema200],
                ["50 DMA", levels.movingAverages.sma50],
                ["200 DMA", levels.movingAverages.sma200],
              ].map(([k, v]) => (
                <Row key={k} k={k} v={num(v)} note={isNum(v) ? `price is ${last >= v ? "above" : "below"} (${away(v)})` : "not enough history"} cls={isNum(v) ? (last >= v ? "is-up" : "is-down") : ""} />
              ))}
            </tbody>
          </table>

          {intraday && intraday.available && (
            <>
              <h4>Today, intraday</h4>
              <table className="an-table">
                <tbody>
                  <Row k="VWAP" v={num(intraday.vwap)} note={intraday.aboveVwap ? "price above — buyers ahead today" : "price below — sellers ahead today"} cls={intraday.aboveVwap ? "is-up" : "is-down"} />
                  {intraday.openingRange && <Row k="Opening range (15 min)" v={`${num(intraday.openingRange.low)} – ${num(intraday.openingRange.high)}`} note="break above/below is the classic ORB trigger" />}
                  <Row k="Day high / low" v={`${num(intraday.dayHigh)} / ${num(intraday.dayLow)}`} note="" />
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ indicators */

export function Indicators({ ind, liquidity, volatilityPct }) {
  const rows = [
    ["RSI (14)", ind.rsi14, "Above 70 overbought · below 30 oversold · 50 is the bull/bear line"],
    ["RSI (2)", ind.rsi2, "Very short-term. Below 10 = a sharp dip; above 90 = a sharp pop"],
    ["MACD line / signal", `${num(ind.macd)} / ${num(ind.macdSignal)}`, "Line above signal = momentum rising"],
    ["MACD histogram", ind.macdHist, "Positive and growing = momentum building"],
    ["ADX (14)", ind.adx, "Above 25 = a real trend · below 20 = sideways"],
    ["+DI / −DI", `${ind.plusDI ?? "—"} / ${ind.minusDI ?? "—"}`, "+DI above −DI = buyers in control"],
    ["Stochastic %K / %D", `${ind.stochK ?? "—"} / ${ind.stochD ?? "—"}`, "Above 80 overbought · below 20 oversold"],
    ["Supertrend (10, 3)", `${num(ind.supertrend)} · ${ind.supertrendDir === 1 ? "bullish" : ind.supertrendDir === -1 ? "bearish" : "—"}`, "Trailing line; price above it is an uptrend"],
    ["Bollinger upper / mid / lower", `${num(ind.bbUpper)} / ${num(ind.bbMid)} / ${num(ind.bbLower)}`, "20-day average ± 2 standard deviations"],
    ["Bollinger width", isNum(ind.bbWidthPct) ? `${ind.bbWidthPct}%` : "—", "Narrow = quiet market; big moves often start from narrow bands"],
    ["Bollinger %B", ind.bbPctB, "0 = on the lower band · 1 = on the upper band"],
    ["ATR (14)", `${num(ind.atr14)} · ${ind.atrPct ?? "—"}% of price`, "Average daily range, gaps included"],
    ["20-day change", isNum(ind.roc20) ? `${ind.roc20}%` : "—", "Price versus one month ago"],
    ["Volume vs 20-day average", isNum(ind.relVolume) ? `${ind.relVolume}×` : "—", "Above 1.5× = unusual interest"],
    ["Average volume (20 days)", compact(ind.avgVolume20), "Shares per day"],
    ["Average turnover (20 days)", isNum(liquidity.avgTurnoverCr) ? `₹${liquidity.avgTurnoverCr} Cr` : "—", "How easily size can get in and out"],
    ["20-day high / low", `${num(ind.high20)} / ${num(ind.low20)}`, "Short-term breakout and breakdown levels"],
    ["55-day high", num(ind.high55), "The Turtle breakout level"],
    ["Volatility (annualised)", isNum(volatilityPct) ? `${volatilityPct}%` : "—", "Standard deviation of daily returns over a year"],
  ];
  return (
    <section className="an-card" aria-labelledby="ind-h">
      <header className="an-card__head">
        <h3 id="ind-h">All indicators</h3>
        <p>Latest values, calculated on daily bars with the standard formulas.</p>
      </header>
      <table className="an-table an-table--wide">
        <thead>
          <tr>
            <th scope="col">Indicator</th>
            <th scope="col">Value</th>
            <th scope="col">How to read it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v, note]) => (
            <Row key={k} k={k} v={isNum(v) ? num(v, Number.isInteger(v) ? 0 : 2) : v ?? "—"} note={note} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* --------------------------------------------------------------- history */

export function History({ a }) {
  const r = a.returns;
  const cells = [
    ["1 day", r.d1],
    ["1 week", r.w1],
    ["1 month", r.m1],
    ["3 months", r.m3],
    ["6 months", r.m6],
    ["1 year", r.y1],
    ["Year to date", r.ytd],
  ];
  const maxAbs = Math.max(10, ...a.yearly.map((y) => Math.abs(y.returnPct || 0)));
  return (
    <section className="an-card" aria-labelledby="hist-h">
      <header className="an-card__head">
        <h3 id="hist-h">History</h3>
        <p>
          {a.bars.toLocaleString("en-IN")} daily bars, {day(a.firstBar)} to {day(a.asOf)}. Price returns only — dividends are not included.
        </p>
      </header>

      <h4>Returns</h4>
      <ul className="an-returns">
        {cells.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <b className={`is-${tone(v)}`}>{pct(v)}</b>
          </li>
        ))}
      </ul>

      <h4>Year by year</h4>
      <ul className="an-years" aria-label="Yearly returns">
        {a.yearly.map((y) => (
          <li key={y.year}>
            <span>
              {y.year}
              {y.partial ? "*" : ""}
            </span>
            <div className="an-years__bar">
              <i className={`is-${tone(y.returnPct)}`} style={{ width: `${(Math.abs(y.returnPct || 0) / maxAbs) * 50}%`, [y.returnPct >= 0 ? "left" : "right"]: "50%" }} />
            </div>
            <b className={`is-${tone(y.returnPct)}`}>{pct(y.returnPct, 1)}</b>
          </li>
        ))}
      </ul>
      <p className="adm-small">* part of a year: the first year starts where the data starts, the latest year is still running.</p>

      <div className="an-two">
        <div>
          <h4>Risk</h4>
          <table className="an-table">
            <tbody>
              <Row k="Worst fall (peak to trough)" v={`−${num(a.drawdown.maxPct, 1)}%`} cls="is-down" note={`${day(a.drawdown.maxFrom, { month: "short", year: "numeric" })} → ${day(a.drawdown.maxTo, { month: "short", year: "numeric" })}`} />
              <Row k="Below its peak now" v={`−${num(a.drawdown.currentPct, 1)}%`} note={`peak ${inr(a.drawdown.peak)} on ${day(a.drawdown.peakDate)}`} />
              <Row k="Volatility (annualised)" v={isNum(a.volatilityPct) ? `${a.volatilityPct}%` : "—"} note="higher = wider swings, smaller positions" />
            </tbody>
          </table>
        </div>
        <div>
          <h4>Against {a.relative ? a.relative.name : "the index"}</h4>
          {a.relative ? (
            <table className="an-table">
              <tbody>
                {[
                  ["1 month", a.relative.m1],
                  ["3 months", a.relative.m3],
                  ["6 months", a.relative.m6],
                  ["1 year", a.relative.y1],
                ].map(([k, v]) => (
                  <Row key={k} k={k} v={isNum(v) ? `${v > 0 ? "+" : ""}${num(v, 1)} pts` : "—"} cls={`is-${tone(v)}`} note={isNum(v) ? (v > 0 ? "ahead of the index" : "behind the index") : ""} />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="adm-small">Index data is not available, so relative strength is left out of the reading.</p>
          )}
        </div>
      </div>
    </section>
  );
}
