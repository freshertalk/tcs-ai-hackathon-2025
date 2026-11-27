// The Desk's first sight (27 Nov 2026, the owner: "all details required for stock analysis must be displayed on front …
// keep all first sight information upfront"). One panel right under the price, in plain groups:
//   the live call across the top, with its entry, stop and targets, then
//   Price today · Trend · Momentum · Key levels.
// It reads only what the Desk already holds (the daily analysis, the live verdict, the quote, today's intraday read) and
// asks the server for nothing of its own. A figure that is not known shows "—"; nothing is guessed.
// On a phone the groups are one at a time behind a row of buttons, so the chart stays close.

import React, { useState } from "react";
import { compact, inr, isNum, num, pct, tone } from "./format";
import MorningStrip, { MorningRecap } from "./MorningCall";

const ARROW = { up: "▲", down: "▼", sideways: "◆", mixed: "◆" };
const FRAME_NAMES = { Weekly: "Weekly", Daily: "Daily", "Intraday (5 min)": "5-min" };
const STATE_WORD = { long: "LONG", short: "SHORT", "wait-long": "WAIT", "wait-short": "WAIT", wait: "WAIT", "no-trade": "NO TRADE" };
const STATE_TONE = { long: "up", short: "down", "wait-long": "up", "wait-short": "down", wait: "flat", "no-trade": "flat" };

const first = (...xs) => xs.find(isNum);
const plus = (x) => (x > 0 ? `+${x}` : `${x}`);
const away = (level, price) => (isNum(level) && isNum(price) && price > 0 ? ((level - price) / price) * 100 : null);
const place = (x, lo, hi) => (isNum(x) && isNum(lo) && isNum(hi) && hi > lo ? Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100)) : null);
const rsiWord = (r) => (!isNum(r) ? "" : r >= 70 ? "overbought" : r <= 30 ? "oversold" : r >= 55 ? "firm" : r <= 45 ? "soft" : "mid-range");

/**
 * The levels nearest the price on each side, from the daily swing levels and the 52-week high and low.
 * @returns { up, down } — each { price, awayPct, name } or null
 */
export function nearestLevels(levels, price) {
  const out = { up: null, down: null };
  if (!levels || !isNum(price)) return out;
  const w = levels.week52 || {};
  const all = [
    ...(levels.resistances || []).map((x) => ({ price: x.price, name: x.touches > 1 ? `${x.touches} touches` : "swing level" })),
    ...(levels.supports || []).map((x) => ({ price: x.price, name: x.touches > 1 ? `${x.touches} touches` : "swing level" })),
    { price: w.high, name: "52-week high" },
    { price: w.low, name: "52-week low" },
  ].filter((x) => isNum(x.price));
  for (const x of all) {
    if (x.price > price && (!out.up || x.price < out.up.price)) out.up = { ...x, awayPct: away(x.price, price) };
    if (x.price < price && (!out.down || x.price > out.down.price)) out.down = { ...x, awayPct: away(x.price, price) };
  }
  return out;
}

/** One line: what it is, the figure, and a quiet note. `t` colours the figure (up, down). */
function Line({ k, tip, v, note, t, className = "" }) {
  return (
    <div className={`dg-line ${className}`.trim()}>
      <dt data-tip={tip}>{k}</dt>
      <dd>
        <b className={t ? `is-${t}` : undefined}>{v}</b>
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

/** A thin bar from low to high with the price's place on it. */
function Range({ k, tip, low, high, at, label }) {
  return (
    <div className="dg-line dg-line--range" data-tip={tip}>
      <dt>{k}</dt>
      <dd>
        <span className="dg-range__end">{num(low)}</span>
        <span className="dg-range__bar" role="img" aria-label={at === null ? `${k}: not known` : label}>
          {at !== null && <i style={{ left: `${at}%` }} />}
        </span>
        <span className="dg-range__end">{num(high)}</span>
      </dd>
    </div>
  );
}

function Group({ id, title, action, onAction, actionTip, seg, children }) {
  return (
    <section className={`dg-group dg-group--${id} ${seg === id ? "is-seg" : ""}`} aria-labelledby={`dg-${id}`}>
      <header className="dg-group__head">
        <h3 id={`dg-${id}`}>{title}</h3>
        {action && (
          <button type="button" className="dg-link" onClick={onAction} data-tip={actionTip}>
            {action}
          </button>
        )}
      </header>
      <dl>{children}</dl>
    </section>
  );
}

/** One figure of the call strip: what it is, and the price under it. */
function Fig({ k, v, note, t }) {
  return (
    <div className="dg-fig">
      <dt>{k}</dt>
      <dd>
        <b className={t ? `is-${t}` : undefined}>{v}</b>
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

/** The live call across the top: what it says, and the prices to act on — or, when no call is live, the next session's triggers. */
function CallStrip({ day, next, ready, onVerdict }) {
  const live = Boolean(day && day.available);
  const p = live ? day.plan : null;
  const t = live ? STATE_TONE[day.state] || "flat" : "flat";
  const figures = [];
  if (p) {
    figures.push({ k: `${p.side === "long" ? "Buy" : "Sell"} ${p.entryNote || ""}`.trim(), v: inr(p.entry) });
    figures.push({ k: "Stop-loss", v: inr(p.stop), note: isNum(p.riskPct) ? `${num(p.riskPct)}% risk` : "" });
    (p.targets || []).slice(0, 2).forEach((x) => figures.push({ k: `Target ${x.label}`, v: inr(x.price) }));
  } else if (live && day.triggers) {
    figures.push({ k: "Long only above", v: inr(day.triggers.long) });
    figures.push({ k: "Short only below", v: inr(day.triggers.short) });
  } else if (next && next.long && next.short) {
    figures.push({ k: "Long only above", v: inr(next.long.entry), note: `stop ${num(next.long.stop)}` });
    figures.push({ k: "Short only below", v: inr(next.short.entry), note: `stop ${num(next.short.stop)}` });
  }
  if (live && isNum(day.score)) figures.push({ k: "Score", v: plus(day.score), note: isNum(day.threshold) ? `needs ±${day.threshold}` : "", t: day.score >= day.threshold ? "up" : day.score <= -day.threshold ? "down" : "" });
  const headline = live ? day.headline : next && next.long ? `No live call. Triggers for ${next.forSession || "the next session"}.` : (day && day.reason) || (ready ? "No live call right now." : "Reading the market…");
  return (
    <section className={`dg-strip is-${t}`} aria-label={live ? "Live call and plan" : "The next triggers"}>
      <p className="dg-call">
        <span className="dg-call__badge">{live ? STATE_WORD[day.state] || "—" : "NO CALL"}</span>
        <span>{headline}</span>
      </p>
      {figures.length > 0 && (
        <dl className="dg-figs">
          {figures.map((f) => (
            <Fig key={f.k} {...f} />
          ))}
        </dl>
      )}
      <button type="button" className="dg-link" onClick={onVerdict} data-tip="Open the desk verdict: why, the order book, three horizons and every level.">
        Full verdict
      </button>
    </section>
  );
}

/**
 * @param a        the daily analysis (/analysis/:symbol)
 * @param v        the live verdict's data, or null while it loads
 * @param intraday today's intraday read, or null
 * @param quote    the live quote, or null
 * @param price    the price on screen; prevClose, high, low: the day's
 * @param setupsOn the setups that have triggered
 * @param onTab    (tabId) => open one of the analysis tabs
 * @param onVerdict () => show the whole desk verdict
 * @param morning  the morning call (MorningCall.jsx useMorning): it leads from the evening before to 9:45 AM, then says how it did
 */
export default function DeskGlance({ a, v, intraday, quote, price, prevClose, high, low, setupsOn = [], onTab, onVerdict, morning = null }) {
  const [seg, setSeg] = useState("today");
  const ok = Boolean(v && v.available);
  const day = ok ? v.day : null;
  const m = day && day.available ? day.movement || {} : {}; // the live tape
  const base = (ok && v.movement) || {}; // the day's normal measures
  const intra = intraday && intraday.available ? intraday : {};
  const ind = a.indicators || {};
  const lv = a.levels || {};
  const piv = lv.pivots || {};
  const w52 = lv.week52 || {};
  const ma = lv.movingAverages || {};

  const open = first(quote && quote.open, m.open, a.price.open);
  const gap = first(base.gapPct, m.gapPct, away(open, prevClose));
  const vwap = first(m.vwap, intra.vwap, quote && quote.avgPrice);
  const vsVwap = isNum(vwap) && isNum(price) ? ((price - vwap) / vwap) * 100 : null;
  const volume = first(quote && quote.volume, m.volume, a.price.volume);
  const orHigh = first(m.orHigh, intra.openingRange && intra.openingRange.high);
  const orLow = first(m.orLow, intra.openingRange && intra.openingRange.low);
  const upper = first(quote && quote.upperCircuit, ok && v.circuit ? v.circuit.upper : null);
  const lower = first(quote && quote.lowerCircuit, ok && v.circuit ? v.circuit.lower : null);
  const atr = first(base.atr, lv.atr && lv.atr.value);
  const atrPct = first(base.atrPct, ind.atrPct, lv.atr && lv.atr.pctOfPrice);
  const used = first(m.rangeUsedPct, base.rangeUsedPct);
  const expLow = first(base.expectedLow, lv.atr && lv.atr.nextDayLow);
  const expHigh = first(base.expectedHigh, lv.atr && lv.atr.nextDayHigh);
  const relVol = first(base.relVolume, ind.relVolume);
  const bids = quote && isNum(quote.buyQty) ? quote.buyQty : null;
  const asks = quote && isNum(quote.sellQty) ? quote.sellQty : null;
  const buyShare = isNum(bids) && isNum(asks) && bids + asks > 0 ? Math.round((bids / (bids + asks)) * 100) : null;
  const near = nearestLevels(lv, price);
  const dayAt = place(price, low, high);
  const yearAt = place(price, w52.low, w52.high);
  const frames = ok ? v.frames || [] : [];
  const lt = ok ? v.longTerm : null;
  const rel = a.relative;

  const groups = [["today", "Today"], ["trend", "Trend"], ["momentum", "Momentum"], ["levels", "Levels"]];

  return (
    <div className="dg" aria-label="At a glance" role="group">
      {/* before 9:45 the morning call leads (the live call takes no entries before 9:30); its triggers for the session stay under it */}
      {morning && morning.show && <MorningStrip m={morning} day={day} />}
      {!(morning && morning.show && morning.stage === "opening") && <CallStrip day={day} next={ok ? v.intraday : null} ready={ok} onVerdict={onVerdict} />}
      {morning && morning.handover && <MorningRecap m={morning} />}

      <div className="dg-segs" role="group" aria-label="Which figures to show">
        {groups.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={seg === id} onClick={() => setSeg(id)}>
            {label}
          </button>
        ))}
      </div>

      <Group id="today" title="Price today" seg={seg}>
        <Line k="Open" v={inr(open)} note={isNum(gap) ? `gap ${pct(gap)}` : ""} />
        <Line k="Prev close" v={inr(prevClose)} />
        <Range k="Day range" tip="Today’s low and high, and where the price sits between them." low={low} high={high} at={dayAt} label={dayAt === null ? "" : `The price is ${Math.round(dayAt)}% of the way from today’s low to today’s high`} />
        <Line k="VWAP" tip="The average price of every share traded today, weighted by volume. Above it, buyers are ahead." v={inr(vwap)} t={isNum(vsVwap) ? tone(vsVwap) : ""} note={isNum(vsVwap) ? `price ${pct(vsVwap)}` : ""} />
        <Line k="Volume" tip="Shares traded today, and how that compares with a normal day of the last 20." v={compact(volume)} note={isNum(relVol) ? `${num(relVol, 1)}× avg` : ""} />
        <Line k="Waiting buy / sell" tip={`Of all the shares waiting in the order book right now, the part waiting to buy and the part waiting to sell.${buyShare === null ? "" : ` ${compact(bids)} to buy, ${compact(asks)} to sell.`}`} v={buyShare === null ? "—" : `${buyShare}% / ${100 - buyShare}%`} />
        <Line k="Circuit limits" tip="The exchange’s lowest and highest allowed price today." v={isNum(lower) && isNum(upper) ? `${num(lower)} – ${num(upper)}` : "—"} />
      </Group>

      <Group id="trend" title="Trend" action="Reading" onAction={() => onTab("overview")} actionTip="Open the technical reading, factor by factor." seg={seg}>
        <div className="dg-line dg-line--frames">
          <dt data-tip="The direction on three time frames.">Frames</dt>
          <dd>
            {frames.length === 0 ? (
              <b>—</b>
            ) : (
              frames.map((f) => (
                <span key={f.name} className={`dg-frame is-${f.dir === "up" ? "up" : f.dir === "down" ? "down" : "flat"}`} data-tip={`${f.name}: ${f.label}. ${f.basis}`}>
                  <i aria-hidden="true">{ARROW[f.dir] || "–"}</i> {FRAME_NAMES[f.name] || f.name}
                  <span className="adm-sr"> {f.label}</span>
                </span>
              ))
            )}
          </dd>
        </div>
        <Line k="Intraday" v={!day ? "—" : !day.available ? "Off" : `${STATE_WORD[day.state] || "—"}${day.side && day.side !== "none" ? ` · ${day.side} side` : ""}`} t={day && day.available ? STATE_TONE[day.state] : ""} />
        <Line k="Swing" tip="The daily-chart verdict, for days to weeks." v={ok ? v.stance : "—"} t={ok ? (v.direction === "bullish" ? "up" : v.direction === "bearish" ? "down" : "") : ""} note={ok && isNum(v.composite) ? `score ${plus(v.composite)}` : ""} />
        <Line k="Long term" tip={`The primary trend, for months to years.${lt && lt.available ? ` ${lt.stance}: ${lt.met} of ${lt.total} checks are met.` : ""}`} v={lt && lt.available ? (lt.trend === "up" ? "Uptrend" : lt.trend === "down" ? "Downtrend" : "No clear trend") : "—"} t={lt && lt.available ? (lt.trend === "up" ? "up" : lt.trend === "down" ? "down" : "") : ""} note={lt && lt.available ? `${lt.met} of ${lt.total}` : ""} />
        <Line k="Daily reading" tip="The technical score of the daily chart, −100 to +100." v={`${a.score.value > 0 ? "+" : ""}${a.score.value} · ${a.score.label}`} />
        <div className="dg-line">
          <dt data-tip="Rule-based setups that have triggered on the latest close.">Setups on</dt>
          <dd>
            <button type="button" className="dg-link dg-link--value" onClick={() => onTab("setups")}>
              {setupsOn.length ? setupsOn.map((s) => s.name).join(", ") : "None"}
            </button>
          </dd>
        </div>
        <Line k="vs Nifty, 1 month" tip="How much more (or less) the stock has returned than the Nifty 50, in percentage points." v={rel && isNum(rel.m1) ? `${plus(Math.round(rel.m1 * 10) / 10)} pts` : "—"} t={rel && isNum(rel.m1) ? tone(rel.m1) : ""} note={rel && isNum(rel.m3) ? `3M ${plus(Math.round(rel.m3 * 10) / 10)}` : ""} />
      </Group>

      <Group id="momentum" title="Momentum" action="Indicators" onAction={() => onTab("indicators")} actionTip="Open every indicator." seg={seg}>
        <Line k="RSI daily (14)" tip="Strength of the recent moves, 0 to 100. Over 70 is stretched up, under 30 stretched down." v={isNum(ind.rsi14) ? num(ind.rsi14, 0) : "—"} note={rsiWord(ind.rsi14)} />
        <Line k="RSI 5-min" v={isNum(m.rsi5) ? num(m.rsi5, 0) : "—"} note={rsiWord(m.rsi5)} />
        <Line k="Last 15 / 30 min" v={isNum(m.m15Pct) || isNum(m.m30Pct) ? `${pct(m.m15Pct)} / ${pct(m.m30Pct)}` : "—"} t={isNum(m.m15Pct) ? tone(m.m15Pct) : ""} />
        <Line k="MACD" tip="Momentum on the daily chart: the MACD line against its signal line." v={isNum(ind.macdHist) ? (ind.macdHist >= 0 ? "Above signal" : "Below signal") : "—"} t={isNum(ind.macdHist) ? tone(ind.macdHist) : ""} note={isNum(ind.macdHist) ? plus(Math.round(ind.macdHist * 100) / 100) : ""} />
        <Line k="ADX" tip="How strong the daily trend is, whichever way. 25 or more is a trend." v={isNum(ind.adx) ? num(ind.adx, 0) : "—"} note={isNum(ind.adx) ? `${ind.adx >= 25 ? "trending" : "weak trend"}${isNum(ind.plusDI) && isNum(ind.minusDI) ? ` · ${ind.plusDI >= ind.minusDI ? "up" : "down"}` : ""}` : ""} />
        <Line k="ATR" tip="The stock’s usual range in a day, from the last 14 sessions." v={inr(atr)} note={isNum(atrPct) ? `${num(atrPct)}%` : ""} />
        <Line k="Range used today" tip="Today’s high to low, as a part of a usual day’s range (ATR). Past 100% the day has already moved more than usual." v={isNum(used) ? `${used}%` : "—"} t={isNum(used) && used >= 150 ? "down" : ""} />
        <Line k="Expected range" tip="Yesterday’s close, one ATR down and up." v={isNum(expLow) && isNum(expHigh) ? `${num(expLow)} – ${num(expHigh)}` : "—"} />
      </Group>

      <Group id="levels" title="Key levels" action="All levels" onAction={() => onTab("levels")} actionTip="Open pivots, supports, resistances and averages." seg={seg}>
        <Line k="Resistance" tip={`The nearest level above the price.${near.up ? ` It is a ${near.up.name}.` : ""}`} v={near.up ? inr(near.up.price) : "—"} note={near.up ? pct(near.up.awayPct) : "none above"} />
        <Line k="Support" tip={`The nearest level below the price.${near.down ? ` It is a ${near.down.name}.` : ""}`} v={near.down ? inr(near.down.price) : "—"} note={near.down ? pct(near.down.awayPct) : "none below"} />
        <Line k="Pivot" tip="The pivot from yesterday’s high, low and close." v={inr(piv.p)} />
        <Line k="S1 / R1" tip="The first support and resistance around the pivot." v={isNum(piv.s1) && isNum(piv.r1) ? `${num(piv.s1)} / ${num(piv.r1)}` : "—"} />
        <Line k="Opening range" tip={`The high and low of the first 15 minutes today.${isNum(orHigh) && isNum(orLow) ? ` The price is ${price > orHigh ? "above" : price < orLow ? "below" : "inside"} it (green above, red below).` : ""}`} v={isNum(orLow) && isNum(orHigh) ? `${num(orLow)} – ${num(orHigh)}` : "—"} t={isNum(orHigh) && price > orHigh ? "up" : isNum(orLow) && price < orLow ? "down" : ""} />
        <Line k="EMA 20 / 200" tip={`The 20-day and 200-day averages: the short and the long trend lines.${isNum(ma.ema200) ? ` The price is ${price >= ma.ema200 ? "above" : "below"} the 200-day (green above, red below).` : ""}`} v={isNum(ma.ema20) && isNum(ma.ema200) ? `${num(ma.ema20)} / ${num(ma.ema200)}` : "—"} t={isNum(ma.ema200) ? (price >= ma.ema200 ? "up" : "down") : ""} />
        <Range k="52 weeks" tip="The lowest and highest price of the last year, and where the price sits between them." low={w52.low} high={w52.high} at={yearAt} label={yearAt === null ? "" : `The price is ${Math.round(yearAt)}% of the way from the 52-week low to the 52-week high`} />
        <Line k="From 52w high / low" tip="How far the price is below the year’s high and above the year’s low." v={isNum(w52.high) && isNum(w52.low) ? `${pct(away(price, w52.high), 1)} / ${pct(away(price, w52.low), 1)}` : "—"} />
      </Group>
    </div>
  );
}
