// src/components/site/MotionHost.jsx
// One motion language for the whole site: as a heading, a paragraph, a picture,
// a card or a table of figures scrolls into view, it settles into place —
// rising a little, fading in, a picture easing down from a slight zoom — with
// neighbours following each other by a few tens of milliseconds.
//
// Design rules, because this runs on every kind of device:
//   • transform and opacity only — no layout changes, so a cheap phone keeps
//     its frame rate; a very low-powered device (≤ 2 cores, ≤ 1 GB) gets a
//     plain fade
//   • nothing is hidden until JavaScript has run: the prerendered pages, and
//     anyone without scripts, see everything at once
//   • people who ask their system for less motion get no motion at all
//   • each element is released (its hiding rules removed) once it has arrived,
//     so its own hover and press effects work as designed
//   • places that already move themselves — the hero, the ticker, the pinned
//     rails, anything a framer-motion wrapper has taken charge of (it leaves an
//     inline opacity or transform on the element) — are left alone
//
// The state lives in data-* attributes, never in className, so a React
// re-render cannot undo it.

import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

const TARGETS = [
  "main h1",
  "main h2",
  "main h3",
  "main h4",
  "main p",
  "main li",
  "main dd",
  "main blockquote",
  "main figcaption",
  "main img",
  "main .bcard",
  "main .cast__card",
  "main .themes__cell",
  "main .novel__fact",
  "main .dc",
  "main .kpi",
  "main .snap__c",
  "main .rv-item",
  "main .rv-sum",
  "main .rv-form",
  "main .cp",
  ".foot",
].join(",");

const SKIP = [
  ".nav",
  ".menu",
  ".marquee",
  ".rd",
  ".sid",
  ".ck",
  ".cpn",
  ".acctb",
  ".tabs",
  ".qgate",
  ".gate",
  ".ls",
  ".sia",
  ".chai",
  ".stars",
  ".hv",
  ".bh",
  ".syn",
  ".offline",
  "[data-mx-skip]",
].join(",");

/**
 * Is this element, or something between it and the page's <main>, in charge of
 * its own motion? A framer-motion wrapper leaves an inline opacity or transform.
 * (The route wrapper above <main> has one too; it is not a reason to skip the
 * whole page, so ancestors of <main> are not asked.)
 */
function blocked(el, main) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches(SKIP)) return true;
    if (main && n.contains(main) && n !== main) continue;
    const st = n.getAttribute("style");
    if (st && /opacity|transform/.test(st)) return true;
  }
  return false;
}

const MAX_PER_SCAN = 420;

function kindOf(el) {
  const t = el.tagName;
  if (t === "IMG") return "img";
  if (/^H[1-4]$/.test(t)) return "head";
  if (/\b(bcard|cast__card|themes__cell|novel__fact|dc|kpi|snap__c|rv-item|rv-sum|rv-form|cp)\b/.test(el.className || "")) return "card";
  return "text";
}

export default function MotionHost() {
  const { pathname } = useLocation();

  // mark the document before the first paint of a route, so nothing flashes
  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) return undefined;
    const root = document.documentElement;
    root.classList.add("mx-on");
    const weak =
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
      (navigator.deviceMemory && navigator.deviceMemory <= 1);
    root.classList.toggle("mx-lite", Boolean(weak));
    return () => root.classList.remove("mx-on", "mx-lite");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("mx-on")) return undefined;

    const seen = new WeakSet();

    const release = (el) => {
      el.removeAttribute("data-mx");
      el.removeAttribute("data-mx-in");
      el.style.removeProperty("--mx-d");
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          el.setAttribute("data-mx-in", "");
          const delay = parseFloat(el.style.getPropertyValue("--mx-d")) || 0;
          // released once it has arrived; a timer as well, in case no
          // transition event comes (a hidden tab, a very slow device)
          const done = () => release(el);
          el.addEventListener("transitionend", function once(e) {
            if (e.target !== el || e.propertyName !== "opacity") return;
            el.removeEventListener("transitionend", once);
            done();
          });
          setTimeout(done, 1500 + delay);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }
    );

    const scan = () => {
      // looked up each time: a lazily loaded page brings its <main> later
      const mainEl = document.querySelector("main");
      const found = document.querySelectorAll(TARGETS);
      const groups = new Map();
      let n = 0;
      for (const el of found) {
        if (n >= MAX_PER_SCAN) break;
        if (seen.has(el) || el.hasAttribute("data-mx")) continue;
        if (blocked(el, mainEl)) continue;
        seen.add(el);
        n += 1;

        const parent = el.parentElement;
        const idx = groups.get(parent) || 0;
        groups.set(parent, idx + 1);

        el.setAttribute("data-mx", kindOf(el));
        el.style.setProperty("--mx-d", `${Math.min(idx, 7) * 65}ms`);
        io.observe(el);
      }
    };

    scan();

    // things that arrive later (a list that loads, a tab that opens)
    let timer = 0;
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 120);
    });
    mo.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      mo.disconnect();
      io.disconnect();
      document.querySelectorAll("[data-mx]").forEach(release);
    };
  }, [pathname]);

  return null;
}
