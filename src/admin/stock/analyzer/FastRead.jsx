// The 1-minute read: the fastest view of the tape the desk has — trend, momentum,
// structure and volume from one-minute bars. It turns before the 5-minute view does,
// and it is wrong more often. The live call still waits for a 5-minute close.

import React from "react";
import { day, inr, isNum, num, pct, tone } from "./format";

const TREND_TONE = { up: "up", "up, pausing": "up", down: "down", "down, pausing": "down" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");

function Tile({ k, v, sub, t }) {
  return (
    <div className={t ? `is-${t}` : ""}>
      <dt>{k}</dt>
      <dd>{v}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/**
 * @param fast     the server's quick read of the 1-minute bars
 * @param compact  fewer tiles, no explanation — for the verdict panel
 * @param asOf     the session's date when this is not today's tape
 */
export default function FastRead({ fast, compact = false, asOf = null }) {
  if (!fast || !fast.available) {
    return compact ? null : <p className="vd-note">{(fast && fast.reason) || "The 1-minute read needs at least five 1-minute bars from today."}</p>;
  }
  const rsiWord = !isNum(fast.rsi) ? "warming up" : fast.rsi >= 70 ? "overbought" : fast.rsi <= 30 ? "oversold" : "mid-range";
  const structTone = /^higher/.test(fast.structure) ? "up" : /^lower/.test(fast.structure) ? "down" : "";
  const tiles = (
    <dl className="vd-tiles fr__tiles">
      <Tile k="1-min trend" v={cap(fast.trend)} t={TREND_TONE[fast.trend] || ""} sub={isNum(fast.ema9) ? `9-min avg ${num(fast.ema9)} · 21-min ${num(fast.ema21)}` : "averages need 22 bars"} />
      <Tile k="Last 1 min" v={pct(fast.m1Pct)} t={tone(fast.m1Pct)} />
      <Tile k="Last 5 min" v={pct(fast.m5Pct)} t={tone(fast.m5Pct)} />
      {!compact && <Tile k="Last 15 min" v={pct(fast.m15Pct)} t={tone(fast.m15Pct)} />}
      <Tile k="1-min RSI" v={isNum(fast.rsi) ? num(fast.rsi, 0) : "—"} sub={rsiWord} />
      {!compact && <Tile k="Structure" v={cap(fast.structure)} t={structTone} sub="from the last two swing highs and lows" />}
      {!compact && <Tile k="Last swing low" v={inr(fast.swingLow)} sub="1-minute bars" />}
      {!compact && <Tile k="Last swing high" v={inr(fast.swingHigh)} sub="1-minute bars" />}
      {!compact && <Tile k="Volume, last 5 min" v={isNum(fast.volumeSurge) ? `${num(fast.volumeSurge, 1)}×` : "—"} sub="against the session's average minute" t={isNum(fast.volumeSurge) && fast.volumeSurge >= 2 ? "up" : ""} />}
    </dl>
  );
  if (compact) return tiles;
  return (
    <div className="fr">
      <h4>{asOf ? `1-minute read · end of the session of ${day(asOf, { day: "numeric", month: "short" })}` : "1-minute read · the fastest view"}</h4>
      {tiles}
      <p className="vd-note">
        {fast.summary} One-minute bars turn first and mislead most: use them to time what the 5-minute call already says, not to overrule it.
      </p>
    </div>
  );
}
