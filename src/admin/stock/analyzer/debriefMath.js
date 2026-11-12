// Pure arithmetic for the Day debrief's charts: scales, the stepped running total,
// and the lanes that show which side the engine was on through the day.

import { minOf } from "./tapeAxis";

/** How a replayed call ended — a mark and words, so the result never rests on colour alone. */
export const WHY = {
  target: { mark: "✓", label: "Target reached", text: "target reached" },
  stop: { mark: "✕", label: "Stopped out", text: "stopped out" },
  "square-off": { mark: "◦", label: "Closed at the 3:15 PM square-off", text: "closed at the 3:15 PM square-off" },
  flip: { mark: "⇄", label: "Closed by the opposite call", text: "closed by the opposite call" },
  open: { mark: "…", label: "Still open", text: "still open" },
};

/** What the engine was saying, in words. */
export const CALL = {
  long: "Long — in play",
  short: "Short — in play",
  "wait-long": "Waiting · long side",
  "wait-short": "Waiting · short side",
  wait: "Waiting · no edge",
  "no-trade": "No trade",
  closed: "Market closed",
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** "+1.25 R", "−0.40 R", "0.00 R" — with a real minus sign. */
export const fmtR = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)} R` : "—");

/**
 * A y-axis in R that always contains zero and ends on round numbers.
 * @returns { lo, hi, step, ticks }
 */
export function rAxis(values, want = 4) {
  let lo = Math.min(0, ...values.filter(isNum));
  let hi = Math.max(0, ...values.filter(isNum));
  // a flat day still needs a scale to be drawn on
  if (hi - lo < 1) {
    hi = Math.max(hi, 0.5);
    lo = Math.min(lo, -0.5);
  }
  const raw = (hi - lo) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-12);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo: ticks[0], hi: ticks[ticks.length - 1], step, ticks };
}

/**
 * The running total as points for a stepped line: flat until a call ends, then a jump.
 * @param curve  [{ t: "HH:MM", total }]
 * @returns [{ min, total, call }] starting at the open with zero
 */
export function stepLine(curve, openMin) {
  const pts = [{ min: openMin, total: 0, call: null }];
  for (const p of curve) pts.push({ min: minOf(p.t), total: p.total, call: p });
  return pts;
}

/**
 * Which side the engine was on, as stretches of time.
 * @param steps  [{ t: "HH:MM" (the 5-minute close), state }]
 * @returns [{ side: "long"|"short", kind: "play"|"wait", from, to }] in minutes since midnight
 */
export function lanes(steps) {
  const out = [];
  steps.forEach((s, i) => {
    const side = s.state === "long" || s.state === "wait-long" ? "long" : s.state === "short" || s.state === "wait-short" ? "short" : null;
    if (!side) return;
    const kind = s.state === "long" || s.state === "short" ? "play" : "wait";
    const from = minOf(s.t);
    // what was said at one close stands until the next
    const to = i + 1 < steps.length ? minOf(steps[i + 1].t) : from + 5;
    const last = out[out.length - 1];
    if (last && last.side === side && last.kind === kind && last.to === from) last.to = to;
    else out.push({ side, kind, from, to });
  });
  return out;
}

/** The index of the point nearest to `min` (minutes since midnight) — the pointer aims at a time, not at a mark. */
export function nearest(points, min) {
  let best = -1;
  let gap = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(p.min - min);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}
