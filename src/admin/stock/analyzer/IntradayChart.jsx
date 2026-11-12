// Today's tape as a day trader reads it: 1-minute or 5-minute candles on a fixed time
// axis (so the empty space on the right is the time that is left), with VWAP, the
// opening range, the times that change the rules, and the live plan's entry, stop
// and targets drawn as levels. The 1-minute view can zoom to the last hour or two,
// and the candle still forming moves with the live price.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { compact, day, num } from "./format";
import { axisFor, clip, minOf, timeLabels, CLOSE_MIN, OPEN_MIN } from "./tapeAxis";

const PAD = { l: 6, r: 94, t: 14, b: 22 };
const NO_ENTRY_AFTER = 14 * 60 + 45;
const MARKS = [9 * 60 + 30, 11 * 60 + 30, 13 * 60 + 30, NO_ENTRY_AFTER];
const SPANS = [
  { span: 60, label: "Last hour" },
  { span: 120, label: "Last 2 h" },
  { span: 0, label: "Full day" },
];

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** The levels worth a line: the live plan if there is one, otherwise the two triggers. */
function levelsFor(tape, call, fast) {
  const out = [];
  if (call && call.available) {
    const p = call.plan;
    if (p) {
      out.push({ kind: "entry", label: p.side === "long" ? "Buy" : "Sell", price: p.entry });
      out.push({ kind: "stop", label: "Stop", price: p.stop });
      p.targets.forEach((t) => out.push({ kind: "target", label: `T ${t.label}`, price: t.price }));
    } else {
      out.push({ kind: "trigger", label: "Long >", price: call.triggers.long });
      out.push({ kind: "trigger", label: "Short <", price: call.triggers.short });
    }
  }
  // on the 1-minute view: the last swing high and low, the levels a scalper leans on
  if (fast && fast.available) {
    if (Number.isFinite(fast.swingHigh)) out.push({ kind: "swing", label: "Sw H", price: fast.swingHigh });
    if (Number.isFinite(fast.swingLow)) out.push({ kind: "swing", label: "Sw L", price: fast.swingLow });
  }
  if (tape.prevClose) out.push({ kind: "prev", label: "Prev", price: tape.prevClose });
  return out;
}

export default function IntradayChart({ tape, call, last, compactView = false, fast = null }) {
  const box = useRef(null);
  const [W, setW] = useState(900);
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const [hover, setHover] = useState(null);
  const step = tape.step === 1 ? 1 : 5;
  // one-minute candles need room: start zoomed in, and let the reader zoom out
  const [span, setSpan] = useState(() => (typeof window !== "undefined" && window.innerWidth < 700 ? 60 : 120));

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => setW(Math.max(280, Math.round(el.clientWidth)));
    const tall = () => setVh(window.innerHeight);
    fit();
    window.addEventListener("resize", tall);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener("resize", tall);
      if (ro) ro.disconnect();
    };
  }, []);

  const narrow = W < 560;
  const H_PRICE = compactView || narrow ? 230 : Math.max(320, Math.min(560, vh - 520));
  const H_VOL = narrow ? 36 : 54;
  const H = PAD.t + H_PRICE + 10 + H_VOL + PAD.b;
  const all = tape.bars;
  const live = tape.today && Number.isFinite(last) ? last : all[all.length - 1].c;

  // what is on screen: the chosen window of the session, with the forming candle following the live price
  const { axis, bars } = useMemo(() => {
    const ax = axisFor(all, step, step === 1 ? span : 0);
    let vis = all.filter((b) => {
      const m = minOf(b.t);
      return m >= ax.from && m < ax.to;
    });
    if (vis.length === 0) vis = all.slice(-1);
    if (tape.today && tape.forming && Number.isFinite(last) && vis[vis.length - 1] === all[all.length - 1]) {
      const b = vis[vis.length - 1];
      vis = [...vis.slice(0, -1), { ...b, c: last, h: Math.max(b.h, last), l: Math.min(b.l, last) }];
    }
    return { axis: ax, bars: vis };
  }, [all, step, span, tape.today, tape.forming, last]);

  const g = useMemo(() => {
    const plotW = W - PAD.l - PAD.r;
    const w = plotW / axis.slots; // width of one bar's slot
    const xAt = (min) => PAD.l + ((min - axis.from) / step) * w; // the left edge of the slot that starts at `min`
    const x = (hhmm) => xAt(minOf(hhmm)) + w / 2;
    let lo = Math.min(live, ...bars.map((b) => b.l));
    let hi = Math.max(live, ...bars.map((b) => b.h));
    const range = Math.max(hi - lo, hi * 0.004);
    // levels a little outside the range on screen stretch the scale; far ones are left off
    const every = levelsFor(tape, call, step === 1 ? fast : null);
    const reach = 0.7 * range;
    const shown = every.filter((l) => l.price >= lo - reach && l.price <= hi + reach);
    shown.forEach((l) => {
      lo = Math.min(lo, l.price);
      hi = Math.max(hi, l.price);
    });
    const pad = (hi - lo) * 0.07 || hi * 0.002;
    lo -= pad;
    hi += pad;
    const y = (v) => PAD.t + ((hi - v) / (hi - lo)) * H_PRICE;
    const volTop = PAD.t + H_PRICE + 10;
    const vMax = Math.max(1, ...bars.map((b) => b.v));
    const yVol = (v) => volTop + H_VOL - (v / vMax) * H_VOL;
    return { plotW, w, xAt, x, y, lo, hi, volTop, yVol, shown, hidden: every.length - shown.length };
  }, [W, bars, axis, step, tape, call, fast, live, H_PRICE, H_VOL]);

  // right-hand labels, nudged apart so they never sit on top of each other
  const tags = useMemo(() => {
    const list = [...g.shown.map((l) => ({ ...l, y: g.y(l.price) })), { kind: "last", label: "", price: live, y: g.y(live) }].sort((a, b) => a.y - b.y);
    for (let i = 1; i < list.length; i += 1) if (list[i].y - list[i - 1].y < 15) list[i].y = list[i - 1].y + 15;
    return list;
  }, [g, live]);

  const bodyW = Math.max(1, Math.min(11, g.w * 0.62));
  const vwapPath = bars.map((b, i) => `${i ? "L" : "M"}${g.x(b.t).toFixed(1)} ${g.y(b.w).toFixed(1)}`).join(" ");
  const xr = W - PAD.r;
  const zones = [clip(OPEN_MIN, OPEN_MIN + 15, axis.from, axis.to), clip(NO_ENTRY_AFTER, CLOSE_MIN, axis.from, axis.to)].filter(Boolean);
  const labels = timeLabels(axis.from, axis.to, narrow);
  const newest = bars[bars.length - 1];

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const min = axis.from + Math.floor((e.clientX - r.left - PAD.l) / g.w) * step;
    const i = bars.findIndex((b) => minOf(b.t) === min);
    setHover(i >= 0 ? i : null);
  };
  const h = hover !== null && bars[hover] ? bars[hover] : newest;
  const anchor = (k) => (k === 0 && labels[0].min === axis.from ? "start" : k === labels.length - 1 && labels[k].min === axis.to ? "end" : "middle");

  return (
    <div className="ic" ref={box}>
      <div className="pc__bar">
        <p className="pc__read" aria-live="off">
          <b>
            {h.t} · {step} min{hover === null ? (tape.forming ? " (forming)" : " (latest)") : ""}
          </b>
          <span>O {num(h.o)}</span>
          <span>H {num(h.h)}</span>
          <span>L {num(h.l)}</span>
          <span>C {num(h.c)}</span>
          <span>Vol {compact(h.v)}</span>
          <span>VWAP {num(h.w)}</span>
        </p>
        <div className="ic__right">
          {step === 1 && (
            <div className="sv__ranges ic__spans" role="group" aria-label="How much of the day to show">
              {SPANS.map((s) => (
                <button key={s.span} type="button" aria-pressed={span === s.span} onClick={() => setSpan(s.span)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <p className="ic__date">{tape.today ? "Today" : `Previous session · ${day(tape.date, { day: "numeric", month: "short" })}`}</p>
        </div>
      </div>

      <svg
        className="pc__svg"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Intraday ${step}-minute chart, ${bars.length} bars, latest price ${num(live)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* times when no fresh entry is taken: the first 15 minutes and after 2:45 PM */}
        {zones.map(([a, b]) => (
          <rect key={a} className="ic__zone" x={g.xAt(a)} y={PAD.t} width={g.xAt(b) - g.xAt(a)} height={H_PRICE} />
        ))}

        {niceTicks(g.lo, g.hi).map((v) => (
          <g key={v}>
            <line className="pc__grid" x1={PAD.l} x2={xr} y1={g.y(v)} y2={g.y(v)} />
            <text className="pc__axis ic__axis--y" x={W - 4} y={g.y(v) + 4} textAnchor="end">
              {num(v, v < 100 ? 2 : 1)}
            </text>
          </g>
        ))}
        {labels.map((l, k) => (
          <text key={l.min} className="pc__axis" x={g.xAt(l.min)} y={H - 6} textAnchor={anchor(k)}>
            {l.label}
          </text>
        ))}
        {MARKS.filter((m) => m > axis.from && m < axis.to).map((m) => (
          <line key={m} className="ic__mark" x1={g.xAt(m)} x2={g.xAt(m)} y1={PAD.t} y2={PAD.t + H_PRICE} />
        ))}

        {/* the opening range, carried across the whole day */}
        {tape.orHigh !== null && (
          <>
            <rect className="ic__or" x={PAD.l} width={g.plotW} y={g.y(tape.orHigh)} height={Math.max(1, g.y(tape.orLow) - g.y(tape.orHigh))} />
            <line className="ic__orline" x1={PAD.l} x2={xr} y1={g.y(tape.orHigh)} y2={g.y(tape.orHigh)} />
            <line className="ic__orline" x1={PAD.l} x2={xr} y1={g.y(tape.orLow)} y2={g.y(tape.orLow)} />
          </>
        )}

        {g.shown.map((l) => (
          <line key={`${l.kind}${l.label}`} className={`ic__lvl ic__lvl--${l.kind}`} x1={PAD.l} x2={xr} y1={g.y(l.price)} y2={g.y(l.price)} />
        ))}

        {bars.map((b) => {
          const cx = g.x(b.t);
          const up = b.c >= b.o;
          const top = g.y(Math.max(b.o, b.c));
          const bot = g.y(Math.min(b.o, b.c));
          return (
            <g key={b.t} className={up ? "pc__up" : "pc__down"}>
              <line x1={cx} x2={cx} y1={g.y(b.h)} y2={g.y(b.l)} />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bot - top)} />
              <rect className={up ? "pc__vol--up" : "pc__vol--down"} x={cx - bodyW / 2} y={g.yVol(b.v)} width={bodyW} height={Math.max(0, g.volTop + H_VOL - g.yVol(b.v))} />
            </g>
          );
        })}

        <path className="ic__vwap" d={vwapPath} />
        {tape.today && <line className="ic__now" x1={g.x(newest.t) + g.w / 2} x2={g.x(newest.t) + g.w / 2} y1={PAD.t} y2={PAD.t + H_PRICE} />}
        <line className="pc__last" x1={PAD.l} x2={xr} y1={g.y(live)} y2={g.y(live)} />

        {tags.map((t) => (
          <g key={`${t.kind}${t.label}`} className={`ic__tag ic__tag--${t.kind}`}>
            <rect x={xr + 2} y={t.y - 8} width={PAD.r - 4} height={16} rx={4} />
            <text x={xr + 6} y={t.y + 4}>
              {t.kind === "last" ? num(t.price) : `${t.label} ${num(t.price, t.price < 1000 ? 2 : 1)}`}
            </text>
          </g>
        ))}

        {hover !== null && bars[hover] && <line className="pc__cross" x1={g.x(bars[hover].t)} x2={g.x(bars[hover].t)} y1={PAD.t} y2={PAD.t + H_PRICE + 10 + H_VOL} />}
      </svg>

      <ul className="pc__legend ic__legend">
        <li className="kv">VWAP</li>
        <li className="ko">Opening range (first 15 min)</li>
        <li className="kz">No fresh entries (before 9:30, after 2:45)</li>
        {call && call.available && call.plan && <li className="kp">Entry, stop and targets from the live call</li>}
        {step === 1 && fast && fast.available && (Number.isFinite(fast.swingHigh) || Number.isFinite(fast.swingLow)) && <li className="kw">Last 1-minute swing high and low</li>}
        {g.hidden > 0 && <li className="km">{g.hidden} level{g.hidden > 1 ? "s" : ""} too far away to draw</li>}
      </ul>
    </div>
  );
}
