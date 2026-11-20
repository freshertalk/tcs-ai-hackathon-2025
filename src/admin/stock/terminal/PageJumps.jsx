// Jumps for a long page: one row under the top bar that stays on screen and takes you to any section in one press.
//
// The Desk has them in its verdict rail; the other long workspaces (Research, the Advisor, the Screener, Trade Analysis)
// get the same thing for the whole page. The sections are read from the page itself — every top-level card with a title —
// so a section that is not on screen has no jump, and a page needs no list to keep in step. The row also says where you
// are (the section at the top of the screen is marked), and it writes its own height to --pj-h on the terminal, so
// whatever else is sticky on the page (a side rail, a page head) sits exactly under it.

import React, { useCallback, useEffect, useRef, useState } from "react";

export const SECTIONS = "section.an-card, details.an-card, section.ta-card, details.rs-ai, [data-jump]";
const MAX_NAME = 24;

/** A section's short name: the one given for its title, else the words before the first " · ", " — ", ":" or "(". An empty given name means "no jump". */
export function sectionName(title, names = []) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  for (const [re, name] of names) if (re.test(t)) return name;
  const head = t.split(/\s[·—–|]\s|[:(]/)[0].trim();
  return head.length > MAX_NAME ? `${head.slice(0, MAX_NAME - 1).trimEnd()}…` : head;
}

/**
 * The sections of a page, in the order they are written: [{ name, el }]. A card inside a card belongs to its parent;
 * a section with no title (and no data-jump) has no jump; two sections never share a name.
 */
export function readSections(root, { select = SECTIONS, names = [], skip = "", visible = () => true } = {}) {
  const out = [];
  const seen = new Set();
  if (!root) return out;
  root.querySelectorAll(select).forEach((el) => {
    if (el.closest(".pj") || (skip && el.matches(skip))) return;
    const up = el.parentElement ? el.parentElement.closest(select) : null;
    if (up && root.contains(up) && up !== root) return;
    if (!visible(el)) return;
    const given = el.getAttribute("data-jump");
    const h = given ? null : el.querySelector("h2, h3, summary");
    const name = given || sectionName(h ? h.textContent : el.getAttribute("aria-label") || "", names);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, el });
  });
  return out;
}

/** The nearest box around a section that scrolls on its own (a side rail), up to the page — or null: the page scrolls. */
function scrollBox(el, stop) {
  for (let p = el.parentElement; p && p !== stop && p !== document.body; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(window.getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * Where a section should land: under the row — and under whatever else the page keeps on screen (a page head, its bar).
 * A page says how much room that takes with the section's scroll-margin-top (terminal/pages.css); the row's own bottom
 * is the least it can be.
 */
function landingLine(el, nav, side = false) {
  // a row across the top: sections land under it; a list at the side (the /me page): only the page's own margin counts
  const under = side ? 0 : nav.getBoundingClientRect().bottom + 8;
  const margin = parseFloat(window.getComputedStyle(el).scrollMarginTop);
  return Number.isFinite(margin) ? Math.max(under, margin) : under;
}

const laidOut = () => typeof document !== "undefined" && document.documentElement.clientWidth > 0;
const onScreen = (el) => !laidOut() || el.getClientRects().length > 0;
const jumpTo = (top) => {
  try {
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" }); // at once: a jump on a trading screen should simply be there
  } catch (_) {
    window.scrollTo(0, Math.max(0, top));
  }
};

/**
 * @param names  [[RegExp, "Short name"], …] for titles whose own first words are not a good name ("" = no jump)
 * @param select which elements are sections (a CSS selector), when the default — every top-level card — is not right
 * @param skip   sections to leave out (a CSS selector)
 * @param min    fewer sections than this and there is no row at all (a short page needs none)
 * @param within the sections are read from the nearest ancestor matching this selector (default: the row's own parent) —
 *               for a list that sits in a side column of the page it describes
 * @param side   the list stands at the side of the page, not across its top
 */
export default function PageJumps({ names = [], select = SECTIONS, skip = "", min = 3, label = "Jump to a section of this page", within = "", side = false, className = "" }) {
  const rootOf = useCallback((nav) => (nav ? (within ? nav.closest(within) : nav.parentElement) : null), [within]);
  const ref = useRef(null);
  const items = useRef([]);
  const timers = useRef({ build: 0, spy: 0 });
  const [list, setList] = useState([]);
  const [active, setActive] = useState("");

  // the row's own height, for whatever is sticky under it: 0 when there is no row, or when the row does not follow you
  // down the page (on a phone it stays at the top)
  const tell = useCallback(() => {
    const nav = ref.current;
    const tm = nav ? nav.closest(".tm") : null;
    if (!tm) return;
    const follows = !side && !nav.hidden && (!laidOut() || window.getComputedStyle(nav).position === "sticky");
    tm.style.setProperty("--pj-h", `${follows ? Math.round(nav.offsetHeight) : 0}px`);
  }, [side]);

  const rebuild = useCallback(() => {
    const nav = ref.current;
    const page = rootOf(nav);
    if (!nav || !page) return;
    const found = readSections(page, { select, names, skip, visible: onScreen });
    items.current = found;
    const next = found.map((x) => x.name);
    setList((cur) => (cur.length === next.length && cur.every((n, i) => n === next[i]) ? cur : next));
    tell(); // a resize can wrap the row onto another line, or stop it following: say so even when the list is the same
  }, [select, names, skip, tell, rootOf]);

  // which section is at the top of the screen (a section in a rail that scrolls on its own is never "where you are")
  const spy = useCallback(() => {
    const nav = ref.current;
    if (!nav) return;
    let cur = "";
    for (const it of items.current) {
      if (scrollBox(it.el, rootOf(nav))) continue;
      if (it.el.getBoundingClientRect().top <= landingLine(it.el, nav, side) + 16) cur = it.name;
    }
    setActive(cur);
  }, [rootOf, side]);

  useEffect(() => {
    const nav = ref.current;
    const root = rootOf(nav);
    if (!root) return undefined;
    const t = timers.current;
    const later = () => {
      clearTimeout(t.build);
      t.build = setTimeout(rebuild, 200);
    };
    rebuild();
    // the page fills in as its data arrives: the row follows (a timer, not a frame — a frame never comes in a background tab)
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(later);
    if (mo) mo.observe(root, { childList: true, subtree: true });
    const onScroll = () => {
      if (t.spy) return;
      t.spy = setTimeout(() => {
        t.spy = 0;
        spy();
      }, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      if (mo) mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", later);
      clearTimeout(t.build);
      clearTimeout(t.spy);
      t.spy = 0;
      const tm = nav.closest(".tm");
      if (tm) tm.style.removeProperty("--pj-h");
    };
  }, [rebuild, spy, rootOf]);

  const shown = list.length >= min;
  useEffect(() => {
    tell();
    spy();
  }, [list, shown, spy, tell]);

  const go = (name) => {
    const nav = ref.current;
    const it = items.current.find((x) => x.name === name);
    if (!nav || !it) return;
    if (it.el.tagName === "DETAILS") it.el.open = true;
    const line = landingLine(it.el, nav, side);
    const box = scrollBox(it.el, rootOf(nav));
    if (box) {
      // the section is in a rail that scrolls on its own: scroll the rail, and bring the rail on screen if it is not
      box.scrollTop += it.el.getBoundingClientRect().top - box.getBoundingClientRect().top - 4;
      const b = box.getBoundingClientRect();
      if (b.top > window.innerHeight - 120 || b.bottom < line + 60) jumpTo(window.scrollY + b.top - line);
    } else jumpTo(window.scrollY + it.el.getBoundingClientRect().top - line);
    setActive(name);
  };

  return (
    <nav className={`pj ${side ? "pj--side" : ""} ${className}`.trim()} ref={ref} aria-label={label} hidden={!shown}>
      {list.map((n) => (
        <button key={n} type="button" className={n === active ? "is-on" : undefined} aria-current={n === active ? "true" : undefined} onClick={() => go(n)}>
          {n}
        </button>
      ))}
    </nav>
  );
}
