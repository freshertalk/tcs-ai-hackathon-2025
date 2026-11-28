// Hide amounts (24 Nov 2026) — the owner: "a toggle … which will turn profit/loss and amounts hidden with stars (*****) across
// all the pages where applicable". One switch (on /me and in the account menu, kept with your preferences so it follows you to
// every device) puts data-privacy="on" on the private area, and every amount that is YOURS — P&L, charges, capital, margin,
// funds, the value of a position, an expense — shows as ***** until it is switched off. Market data is not yours and stays:
// a stock's price, a level, an index, FII flows.
//
// HOW, without rewriting every page: the money lives in a few places (the YOUR-MONEY ZONES below: Positions, the Journal,
// Trade Analysis, Paper, the dock, the top bar's P&L and goal pills, /me's glance and status, Expenses). While the switch is
// on, a watcher reads those zones as they draw and change, and marks (an attribute, never a change to the page's own text, so
// the page keeps working normally) every short piece of text that is an amount:
//   · a rupee figure (₹1,627.85, ₹4.2 L), a signed figure (+1,627.85, −2,840), a short one (4.24k, 1.2L, 3Cr)
//   · every figure in a table column whose heading names money (P&L, charges, value, net, margin, brokerage, taxes…)
//   · every figure under a label that names money (a <dt> "Net realised P&L" and its <dd>)
// Percentages, quantities, times and prices without a rupee sign are left alone. The marked text is drawn as ***** (privacy.css).
// Words that carry amounts (a hover help, the daily goal's popup) pass through hideAmounts().
import React, { useLayoutEffect } from "react";
import { usePrefs } from "./prefs";
import "./privacy.css";

export const MONEY_ZONES = [
  '.tm-page[data-view="account"]',
  '.tm-page[data-view="journal"]',
  '.tm-page[data-view="analysis"]',
  '.tm-page[data-view="paper"]',
  '.tm-page[data-view="loans"]',
  ".tm-dock",
  ".tm-pnl",
  ".dg-pill",
  ".hm-today",
  ".hm-pulse",
  // /me's first screen: your funds, positions and holdings (the market's own prices beside them stay readable)
  ".fs-acct",
  ".fs-pos",
  ".td",
  ".ex",
].join(", ");

const MONEY_WORDS = /(p\s*&\s*l|pnl|profit(?! factor)|loss(?!es\b| streak)|charges?|brokerage|tax|stt|gst|stamp|\bnet\b|gross|value|amount|margin|balance|capital|principal|invested|m2m|drawdown|expectancy|avg (win|loss)|best day|worst day|equity|funds?|cash|collateral|spent|expense|budget|total|realised|unrealised|turnover|cost|fees?|payout|pay-?in|deposit|withdraw)/i;
const RUPEE = /₹\s?\d/;
const SIGNED = /^[+−–-]\s?₹?\s?\d[\d,]*(\.\d+)?\s?(k|K|L|Cr|cr|lakh|crore)?$/;
const SHORT = /^₹?\s?\d[\d,.]*\s?(k|K|L|Cr|cr)$/;

/** Is this short piece of text an amount (never a percentage, a time or a plain count)? Pure, for the tests. */
export function isAmount(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 32 || !/\d/.test(t)) return false;
  if (/%\)?$/.test(t) || /^\d{1,2}:\d{2}/.test(t)) return false;
  return RUPEE.test(t) || SIGNED.test(t) || SHORT.test(t);
}
/** Words with every rupee amount in them starred: "now +₹1,628" → "now +₹*****". */
export function hideAmounts(text) {
  return String(text == null ? "" : text).replace(/₹\s?\d[0-9,]*(\.\d+)?(\s?(k|K|L|Cr|cr|lakh|crore)\b)?/g, "₹*****");
}
/** Is the switch on right now (read from the page, for code outside React — the hover help)? */
export const privacyOn = () => typeof document !== "undefined" && Boolean(document.querySelector('.adm[data-privacy="on"]'));

const ownText = (el) => {
  let t = "";
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
  return t.trim();
};
const hasDigit = (el) => /\d/.test(el.textContent || "");
// the stars are drawn over the figure, so a figure that is not positioned itself becomes the frame for them (one already
// placed — a tooltip, a badge — keeps its own position)
const mark = (el, why) => {
  el.setAttribute("data-pv", why);
  try {
    if (getComputedStyle(el).position === "static") el.setAttribute("data-pv-pos", "r");
  } catch (_) {
    /* not drawn yet: the frame is set on the next look */
  }
};

/** The own-text rule for one element: an amount gets the mark, a figure that stopped being one loses it. */
function markOne(el) {
  if (!el || el.nodeType !== 1 || el.closest(".pv-skip, svg defs")) return 0;
  const own = ownText(el);
  const was = el.getAttribute("data-pv");
  if (own && isAmount(own)) {
    if (!was) {
      mark(el, "t");
      return 1;
    }
  } else if (was === "t") el.removeAttribute("data-pv");
  return 0;
}
/** A table column whose heading names money: every figure in it. */
function markTable(table) {
  let n = 0;
  const heads = [...table.querySelectorAll("thead th")];
  const cols = new Set(heads.map((th, i) => (MONEY_WORDS.test(th.textContent || "") ? th.cellIndex ?? i : -1)).filter((i) => i >= 0));
  if (!cols.size) return 0;
  for (const row of table.querySelectorAll("tbody tr, tfoot tr")) {
    for (const cell of row.children) {
      if (cols.has(cell.cellIndex) && hasDigit(cell) && !cell.getAttribute("data-pv")) {
        mark(cell, "c");
        n += 1;
      }
    }
  }
  return n;
}
/** A figure under a label that names money. */
function markPair(dt) {
  if (!dt || !MONEY_WORDS.test(dt.textContent || "")) return 0;
  const dd = dt.nextElementSibling;
  if (dd && dd.tagName === "DD" && hasDigit(dd) && !dd.getAttribute("data-pv")) {
    mark(dd, "d");
    return 1;
  }
  return 0;
}
/** What around an element decides it: the table it sits in, the label it sits under. */
function markContext(el) {
  let n = 0;
  const table = el.closest && el.closest("table");
  if (table && table.closest(MONEY_ZONES)) n += markTable(table);
  const dd = el.closest && el.closest("dd");
  if (dd && dd.closest(MONEY_ZONES)) n += markPair(dd.previousElementSibling);
  return n;
}

/** Mark the amounts inside `scope` (an element). @returns how many were marked */
export function markAmounts(scope) {
  if (!scope || scope.nodeType !== 1) return 0;
  const zones = [];
  if (scope.closest && scope.closest(MONEY_ZONES)) zones.push(scope);
  else zones.push(...scope.querySelectorAll(MONEY_ZONES));
  let n = 0;
  for (const zone of zones) {
    for (const el of [zone, ...zone.querySelectorAll("*")]) n += markOne(el);
    for (const table of zone.querySelectorAll("table")) n += markTable(table);
    for (const dt of zone.querySelectorAll("dt")) n += markPair(dt);
    // a piece drawn inside a table or under a label (a new row, a changed figure)
    n += markContext(zone);
  }
  return n;
}

/**
 * The work the watcher does for one batch of changes, before the browser draws them: a changed figure is read again, a new
 * piece of page is read whole, a workspace that changed is read whole. Exported for the tests.
 */
export function onChanges(records) {
  for (const r of records) {
    if (r.type === "characterData") {
      const el = r.target.parentElement;
      if (el && el.closest(MONEY_ZONES)) {
        markOne(el);
        markContext(el);
      }
    } else if (r.type === "attributes") {
      if (r.target.nodeType === 1) markAmounts(r.target);
    } else {
      for (const node of r.addedNodes) {
        if (node.nodeType === 1) markAmounts(node);
        else if (node.nodeType === 3 && node.parentElement && node.parentElement.closest(MONEY_ZONES)) {
          markOne(node.parentElement);
          markContext(node.parentElement);
        }
      }
      if (r.target.nodeType === 1 && r.target.closest(MONEY_ZONES)) markOne(r.target);
    }
  }
}

/** The switch's state and how to flip it (kept with your preferences). */
export function usePrivacy() {
  const { prefs, save } = usePrefs();
  const on = Boolean(prefs && prefs.privacy);
  return { on, set: (v) => save({ privacy: Boolean(v) }), toggle: () => save({ privacy: !on }) };
}

/**
 * Mounted once (AdminApp). Instant, both ways (24 Nov 2026, the owner: "after switch on/off, without doing manual refresh,
 * amounts must be displayed instantly"): the watcher keeps every amount marked ALL the time — whether the switch is on or
 * off — and reads each change in the same moment it happens (a MutationObserver runs before the browser draws), so a figure
 * that appears or changes is marked before it is ever seen. The switch itself then only flips data-privacy on the page,
 * which the stylesheet follows at once: nothing is read, nothing waits. Other tabs and devices follow too (prefs.js).
 */
export function PrivacyMasker() {
  useLayoutEffect(() => {
    if (typeof MutationObserver === "undefined") return undefined;
    const root = document.querySelector(".adm") || document.body;
    markAmounts(root);
    const mo = new MutationObserver(onChanges);
    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-view"] });
    return () => mo.disconnect();
  }, []);
  return null;
}

/** The switch: an eye that closes. `variant="item"` is the account menu's row. */
export function PrivacyToggle({ variant = "button", onDone }) {
  const { on, toggle } = usePrivacy();
  const label = on ? "Show amounts" : "Hide amounts";
  const icon = on ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c5.5 0 9 6 9 6a15.8 15.8 0 0 1-3.2 3.8M6.4 7.6A15.6 15.6 0 0 0 3 12s3.5 6 9 6a9.2 9.2 0 0 0 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
  const press = () => {
    toggle();
    if (onDone) onDone();
  };
  if (variant === "item") {
    return (
      <button type="button" role="menuitemcheckbox" aria-checked={on} className="acm__item" onClick={press}>
        {icon}
        <span>{label}</span>
        <span className={`pv-switch ${on ? "is-on" : ""}`} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" className={`pv-toggle ${on ? "is-on" : ""}`} aria-pressed={on} onClick={press} data-tip={on ? "Amounts are hidden on every page (P&L, charges, capital, funds). Press to show them." : "Hide your P&L and amounts with ***** on every page — for screen sharing or a crowded room. Prices stay visible."}>
      {icon}
      <span>{on ? "Amounts hidden" : "Hide amounts"}</span>
      <span className={`pv-switch ${on ? "is-on" : ""}`} aria-hidden="true" />
    </button>
  );
}
