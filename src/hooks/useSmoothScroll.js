// src/hooks/useSmoothScroll.js
// A dependency-free, Lenis-style inertial scroll.
//
// Native scroll stays the source of truth — we only lerp toward a target
// position each frame — so `position: sticky`, anchors, IntersectionObserver
// and framer-motion's useScroll offsets all keep working.

import { useEffect } from "react";

const LERP = 0.12;       // 0..1 — higher settles faster, lower glides longer
const WHEEL_GAIN = 1.0;  // wheel delta multiplier
const EPSILON = 0.4;     // px — close enough, stop the loop
const JUMP = 80;         // px — a scroll this far off is a real user jump

export default function useSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === "undefined") return undefined;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // Touch devices already have excellent native inertia — don't fight it.
    if (reduced || coarse) return undefined;

    const root = document.documentElement;

    // CSS `scroll-behavior: smooth` would make the browser animate toward
    // every window.scrollTo() we issue, so scrollY would lag the engine and
    // the wheel would feel dead. Force it off while the engine owns scrolling.
    const prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";

    let target = window.scrollY;
    let current = target;
    let lastSetY = target;
    let rafId = null;
    let running = false;

    const maxScroll = () =>
      Math.max(0, root.scrollHeight - window.innerHeight);

    const clamp = (v) => Math.min(Math.max(v, 0), maxScroll());

    const frame = () => {
      const delta = target - current;

      if (Math.abs(delta) < EPSILON) {
        current = target;
        lastSetY = Math.round(current);
        window.scrollTo(0, lastSetY);
        running = false;
        rafId = null;
        root.style.setProperty("--scroll-velocity", "0");
        return;
      }

      current += delta * LERP;
      lastSetY = Math.round(current);
      window.scrollTo(0, lastSetY);

      root.style.setProperty(
        "--scroll-velocity",
        String(Math.max(-1, Math.min(1, delta / 90)))
      );

      rafId = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(frame);
    };

    // Let modals and inner scrollers keep native wheel behaviour.
    //
    // This runs on every wheel event, so it uses closest() — a cheap selector
    // match — rather than walking ancestors calling getComputedStyle(), which
    // would force a style recalculation on the hottest handler on the page.
    // Mark any inner scrollable region with data-lenis-prevent.
    const isInsideOptOut = (node) => {
      const el = node instanceof Element ? node : node?.parentElement;
      return Boolean(el?.closest?.("[data-lenis-prevent]"));
    };

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;  // pinch / browser zoom
      if (e.defaultPrevented) return;
      if (document.body.classList.contains("is-locked")) return; // menu open
      if (isInsideOptOut(e.target)) return;

      e.preventDefault();

      // Normalise: some mice report deltaMode 1 (lines) or 2 (pages).
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 18;
      else if (e.deltaMode === 2) dy *= window.innerHeight;

      target = clamp(target + dy * WHEEL_GAIN);
      start();
    };

    // Resync for scrolling we didn't cause: keyboard, scrollbar drag, hash
    // jumps, find-in-page, scrollIntoView, anchor clicks.
    //
    // While the loop is running it is the authority — scroll events are just
    // echoes of our own writes and must be ignored, otherwise the target
    // collapses onto the current position and all momentum is lost. Only a
    // jump larger than JUMP is treated as genuine user input mid-glide.
    const onScroll = () => {
      const drift = Math.abs(window.scrollY - lastSetY);
      if (running && drift < JUMP) return;
      if (!running && drift === 0) return;
      target = window.scrollY;
      current = window.scrollY;
      lastSetY = window.scrollY;
    };

    const onResize = () => {
      target = clamp(target);
      current = clamp(current);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (rafId) cancelAnimationFrame(rafId);
      root.style.scrollBehavior = prevBehavior;
      root.style.removeProperty("--scroll-velocity");
    };
  }, [enabled]);
}

/** Smoothly scroll to an element id, respecting the fixed nav height. */
export function scrollToId(id, offset = 0) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
}
