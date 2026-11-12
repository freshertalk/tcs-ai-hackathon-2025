// Small, pure helpers for the hover help: reading a label's text and placing the bubble.

/** A label as a lookup key: lower case, single spaces, no trailing colon. */
export const norm = (s) =>
  String(s == null ? "" : s)
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:：]\s*$/, "")
    .toLowerCase();

/**
 * The text an element carries itself — its direct text, not its children's.
 * "Setups <i>2</i>" reads as "Setups"; "R1 <small>Pivot</small>" reads as "R1".
 */
export function ownText(el) {
  if (!el || !el.childNodes) return "";
  let out = "";
  for (const n of el.childNodes) if (n.nodeType === 3) out += ` ${n.nodeValue}`;
  return out.replace(/\s+/g, " ").trim();
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Where the bubble goes: above the thing it explains, centred on it; below when there
 * is no room above; never off the edge of the window.
 * @param target  { left, top, width, height } of the element (viewport coordinates)
 * @param size    { w, h } of the bubble
 * @param view    { w, h } of the window
 * @returns { left, top, side: "top" | "bottom", arrow }  arrow: x of the pointer inside the bubble
 */
export function place(target, size, view, gap = 8, margin = 8) {
  const cx = target.left + target.width / 2;
  const left = clamp(cx - size.w / 2, margin, Math.max(margin, view.w - size.w - margin));
  const above = target.top - size.h - gap;
  const below = target.top + target.height + gap;
  // above by default; below when it would leave the window at the top and fits below (or fits better)
  const side = above >= margin ? "top" : below + size.h <= view.h - margin || view.h - below > target.top ? "bottom" : "top";
  const top = side === "top" ? Math.max(margin, above) : Math.min(below, Math.max(margin, view.h - size.h - margin));
  return { left: Math.round(left), top: Math.round(top), side, arrow: Math.round(clamp(cx - left, 12, Math.max(12, size.w - 12))) };
}

/** Things a press already does something with: they explain themselves on hover and focus, never on tap. */
export const isInteractive = (el) => Boolean(el && el.closest && el.closest('a[href], button, input, select, textarea, summary, [role="tab"], [role="button"], [tabindex]:not([tabindex="-1"])'));
