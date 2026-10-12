// src/reader/util.js

/**
 * Was this click a finger/pen tap rather than a mouse click?
 * `pointerType` is the answer where it exists; older Safari reports a plain
 * MouseEvent, so fall back to whether the device can hover at all.
 */
export function isTouchTap(e) {
  const t = e.nativeEvent && e.nativeEvent.pointerType;
  if (t) return t !== "mouse";
  try {
    return window.matchMedia("(hover: none)").matches;
  } catch {
    return false;
  }
}

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export function fmtMinutes(min) {
  if (min < 60) return `${min} मिनट`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} घंटे ${m} मिनट` : `${h} घंटे`;
}

const MONTHS_HI = [
  "जनवरी",
  "फ़रवरी",
  "मार्च",
  "अप्रैल",
  "मई",
  "जून",
  "जुलाई",
  "अगस्त",
  "सितंबर",
  "अक्टूबर",
  "नवंबर",
  "दिसंबर",
];

/** "2026-10-16" → "16 अक्टूबर 2026". Anything else (a bare year) is left as is. */
export function fmtDate(iso) {
  const m = String(iso || "").match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})/);
  if (!m) return String(iso || "");
  return `${Number(m[3])} ${MONTHS_HI[Number(m[2]) - 1]} ${m[1]}`;
}

/** Western digits → Devanagari digits, for chapter numbers in running text. */
export function toDevanagari(s) {
  return String(s).replace(/\d/g, (d) => "०१२३४५६७८९"[d]);
}
