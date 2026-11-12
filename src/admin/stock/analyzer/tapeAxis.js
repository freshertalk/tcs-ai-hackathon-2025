// The time axis of the intraday chart, for 1-minute and 5-minute bars alike.
// Pure arithmetic on "HH:MM" strings and minutes since midnight (India time).

export const OPEN_MIN = 9 * 60 + 15;
export const CLOSE_MIN = 15 * 60 + 30;

export const minOf = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

/**
 * The stretch of the session a chart shows.
 * @param bars  [{ t: "HH:MM" }], oldest first
 * @param step  minutes per bar (1 or 5)
 * @param span  minutes to show, or 0 for the whole session
 * @returns { from, to, slots }  from / to in minutes since midnight; slots = bars that fit
 */
export function axisFor(bars, step, span) {
  const total = CLOSE_MIN - OPEN_MIN;
  if (!span || span >= total) return { from: OPEN_MIN, to: CLOSE_MIN, slots: total / step };
  const lastMin = bars.length ? minOf(bars[bars.length - 1].t) : OPEN_MIN;
  // a little empty room to the right of the newest bar, as the full-day view leaves the rest of the day
  const lead = Math.max(step * 2, Math.round((span * 0.08) / step) * step);
  let to = Math.min(CLOSE_MIN, lastMin + step + lead);
  let from = to - span;
  if (from < OPEN_MIN) {
    from = OPEN_MIN;
    to = Math.min(CLOSE_MIN, from + span);
  }
  return { from, to, slots: (to - from) / step };
}

const label = (min, withMinutes) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h > 12 ? h - 12 : h;
  return m === 0 && !withMinutes ? String(h12) : `${h12}:${String(m).padStart(2, "0")}`;
};

/**
 * Round times worth a label between `from` and `to`.
 * @returns [{ min, label }]
 */
export function timeLabels(from, to, narrow = false) {
  const span = to - from;
  if (from === OPEN_MIN && to === CLOSE_MIN) {
    const all = [OPEN_MIN, 600, 660, 720, 780, 840, 900, CLOSE_MIN];
    // on a narrow chart "3" would sit on top of "3:30"
    const picked = narrow ? [OPEN_MIN, 660, 780, CLOSE_MIN] : all;
    return picked.map((min) => ({ min, label: label(min, false) }));
  }
  let every = span > 180 ? 60 : span > 90 ? 30 : span > 45 ? 15 : 10;
  if (narrow) every *= 2;
  const out = [];
  for (let min = Math.ceil(from / every) * every; min <= to; min += every) out.push({ min, label: label(min, every < 60) });
  return out;
}

/** The part of [a, b) that lies inside [from, to), or null. Used for the shaded "no fresh entries" zones. */
export function clip(a, b, from, to) {
  const lo = Math.max(a, from);
  const hi = Math.min(b, to);
  return hi > lo ? [lo, hi] : null;
}
