// Hover help for the whole private area.
//
// One bubble, mounted once. It explains whatever the pointer rests on (or the keyboard
// focuses) when that element has help:
//   • an explicit  data-tip="…"  in the markup, or an existing  title="…"
//   • or a label the glossary knows ("VWAP", "Range used", "Go live", …) — these are
//     found by their text as the page draws, so every screen gets them without each
//     one having to be annotated by hand
// On a touch screen there is no hover: tapping a label shows its help, tapping anywhere
// else puts it away. Buttons and links are left alone there — a tap presses them.
//
// The help can be switched off (footer of every page); the choice is remembered.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { lookup, SELECTOR } from "./glossary";
import { isInteractive, ownText, place } from "./tips";

const PREF_KEY = "vpt.tips";
const EVENT = "vpt-tips-changed";
const TIP_ID = "adm-tip";
const SHOW_AFTER = 320; // ms the pointer must rest before the bubble appears

export const tipsEnabled = () => {
  try {
    return window.localStorage.getItem(PREF_KEY) !== "0";
  } catch (_) {
    return true;
  }
};
export function setTipsEnabled(on) {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch (_) {
    /* private mode — the choice lasts for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}
/** The on/off choice, kept in step across the page. */
export function useTipsEnabled() {
  const [on, setOn] = useState(tipsEnabled);
  useEffect(() => {
    const sync = () => setOn(tipsEnabled());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

/** Give every label the glossary knows its help text, inside `root`. */
function tag(root) {
  if (!root || root.nodeType !== 1) return;
  const list = root.matches(SELECTOR) ? [root] : [];
  list.push(...root.querySelectorAll(SELECTOR));
  for (const el of list) {
    const auto = el.hasAttribute("data-tip-auto");
    if (el.hasAttribute("data-tip") && !auto) continue; // help written in the markup wins
    const tip = lookup(ownText(el), el);
    if (tip) {
      if (el.getAttribute("data-tip") !== tip) el.setAttribute("data-tip", tip);
      if (!auto) el.setAttribute("data-tip-auto", "");
    } else if (auto) {
      el.removeAttribute("data-tip");
      el.removeAttribute("data-tip-auto");
    }
  }
}

/** The element under the pointer that has help — adopting a plain title="…" on the way. */
function helped(node) {
  if (!node || !node.closest) return null;
  // A label whose words arrived after it was drawn ("Replaying…" → "Refresh") was not
  // matched then: look it up now, as the pointer reaches it.
  const late = node.closest(SELECTOR);
  if (late && !late.hasAttribute("data-tip") && late.closest(".adm")) {
    const tip = lookup(ownText(late), late);
    if (tip) {
      late.setAttribute("data-tip", tip);
      late.setAttribute("data-tip-auto", "");
    }
  }
  const el = node.closest("[data-tip], [title], button[aria-label], a[aria-label]");
  if (!el || !el.closest(".adm")) return null;
  if (!el.hasAttribute("data-tip") && !el.hasAttribute("title")) {
    // a control that is only a symbol (×): its accessible name is its explanation
    if (el.textContent.trim().length <= 2) return { el, text: el.getAttribute("aria-label"), named: true };
    return helped(el.parentElement);
  }
  if (el.hasAttribute("title")) {
    // a browser's own tooltip is slow, small and never shows on touch: show ours instead
    const t = el.getAttribute("title");
    el.removeAttribute("title");
    if (t && !el.hasAttribute("data-tip")) el.setAttribute("data-tip", t);
  }
  if (el.hasAttribute("data-tip-auto")) {
    // the label may have changed since it was matched
    const tip = lookup(ownText(el), el);
    if (!tip) {
      el.removeAttribute("data-tip");
      el.removeAttribute("data-tip-auto");
      return null;
    }
    if (el.getAttribute("data-tip") !== tip) el.setAttribute("data-tip", tip);
  }
  const text = el.getAttribute("data-tip");
  return text ? { el, text, named: false } : null;
}

export default function TipLayer() {
  const enabled = useTipsEnabled();
  const [tip, setTip] = useState(null); // { el, text }
  const box = useRef(null);
  const state = useRef({ el: null, timer: null, described: null, touch: false });

  /* ---- find the labels the glossary knows, now and as the page changes */
  useEffect(() => {
    const root = document.querySelector(".adm");
    if (!root || !enabled) return undefined;
    tag(root);
    if (typeof MutationObserver === "undefined") return undefined;
    // The browser hands over a whole batch of changes at once, so this runs once per redraw.
    // (Deliberately not on an animation frame: a tab in the background gets none, and its
    // labels would stay unexplained until it was looked at.)
    const mo = new MutationObserver((records) => {
      const fresh = new Set();
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.id !== TIP_ID) fresh.add(n);
      fresh.forEach((n) => n.isConnected && tag(n));
    });
    // only new elements: prices that tick change text, not structure, and are not looked at
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [enabled]);

  /* ---- show and hide */
  useEffect(() => {
    if (!enabled) {
      setTip(null);
      return undefined;
    }
    const s = state.current;
    const hide = () => {
      clearTimeout(s.timer);
      s.timer = null;
      if (s.described) {
        s.described.removeAttribute("aria-describedby");
        s.described = null;
      }
      s.el = null;
      setTip(null);
    };
    const show = (found, delay) => {
      const { el, named } = found;
      if (s.el === el) return;
      hide();
      s.el = el;
      s.timer = setTimeout(() => {
        if (s.el !== el || !el.isConnected) return;
        // the words as they are now: a label can change while the pointer rests on it
        const text = named ? el.getAttribute("aria-label") : el.getAttribute("data-tip");
        if (!text) return;
        // for a screen reader, the bubble is the element's description while it is up
        // (not when the bubble only repeats the element's own name)
        if (!named && !el.hasAttribute("aria-describedby")) {
          el.setAttribute("aria-describedby", TIP_ID);
          s.described = el;
        }
        setTip({ el, text });
      }, delay);
    };

    const onOver = (e) => {
      if (e.pointerType === "touch") return;
      const found = helped(e.target);
      if (found) show(found, SHOW_AFTER);
      else if (s.el) hide();
    };
    const onOut = (e) => {
      if (!s.el) return;
      const to = e.relatedTarget;
      if (!to || !s.el.contains(to)) hide();
    };
    const onFocus = (e) => {
      // keyboard focus only: a click also focuses, and the pointer already has its own rules
      let visible = true;
      try {
        visible = e.target.matches(":focus-visible");
      } catch (_) {
        visible = true;
      }
      const found = visible ? helped(e.target) : null;
      if (found) show(found, 120);
    };
    const onDown = (e) => {
      s.touch = e.pointerType === "touch";
      if (!s.touch) hide(); // a press with the mouse puts the bubble away
    };
    const onClick = (e) => {
      if (!s.touch) return;
      const found = helped(e.target);
      // on a touch screen: tap a label to read about it, tap anything else to put it away
      if (found && !isInteractive(e.target) && s.el !== found.el) show(found, 0);
      else hide();
    };
    const onKey = (e) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [enabled]);

  /* ---- put the bubble where it belongs, once its size is known */
  useLayoutEffect(() => {
    const node = box.current;
    if (!tip || !node) return;
    if (!tip.el.isConnected) {
      setTip(null);
      return;
    }
    const r = tip.el.getBoundingClientRect();
    const p = place({ left: r.left, top: r.top, width: r.width, height: r.height }, { w: node.offsetWidth, h: node.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
    node.style.left = `${p.left}px`;
    node.style.top = `${p.top}px`;
    node.style.setProperty("--tip-arrow", `${p.arrow}px`);
    node.dataset.side = p.side;
    node.classList.add("is-on");
  }, [tip]);

  if (!tip) return null;
  return (
    <div id={TIP_ID} ref={box} className="adm-tip" role="tooltip">
      {tip.text}
    </div>
  );
}
