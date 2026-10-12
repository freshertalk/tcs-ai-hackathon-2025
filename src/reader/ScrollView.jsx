// src/reader/ScrollView.jsx
// Continuous reading: the chapter is one long column and the page scrolls.
//
// It uses the window's own scroll on purpose. That is what gets native
// momentum, the collapsing browser bar on phones and the status-bar tap to
// return to the top for free — none of which survive an inner scroller.
//
// Position is reported as 0..1 through the article, where 1 means the end of
// the text is at the bottom edge of the screen.

import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { isTouchTap, prefersReducedMotion } from "./util";

const USER_WINDOW = 700; // ms after a wheel/touch/key during which scroll is "theirs"
const LONG_MS = 460; // press-and-hold on a paragraph
const HL = ["hl", "hl-y", "hl-g", "hl-b", "hl-r", "has-note"];

export default function ScrollView({
  html,
  startPos = 0,
  lang,
  onPos,
  onChrome,
  onTap,
  onRegisterApi,
  footer,
  marks = [],
  onPara,
}) {
  const articleRef = useRef(null);
  const press = useRef(null);
  const lastUser = useRef(0);
  const lastY = useRef(0);
  const acc = useRef(0);
  const frame = useRef(0);

  const range = useCallback(() => {
    const el = articleRef.current;
    if (!el) return 1;
    const bottom = el.getBoundingClientRect().bottom + window.scrollY;
    return Math.max(1, bottom - window.innerHeight);
  }, []);

  const place = useCallback(
    (pos) => {
      const y = Math.round(Math.min(1, Math.max(0, pos)) * range());
      window.scrollTo(0, y);
      lastY.current = window.scrollY;
    },
    [range]
  );

  /* ---- put the reader where they were, before the first paint ---- */
  useLayoutEffect(() => {
    place(startPos);
    // run again once webfonts settle — glyph metrics change the height
    let cancelled = false;
    const refit = () => {
      if (cancelled) return;
      if (performance.now() - lastUser.current > USER_WINDOW * 3) place(startPos);
    };
    document.fonts?.ready?.then(refit);
    const t = setTimeout(refit, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // only on mount: a view is remounted for each chapter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- highlights ---- */
  useLayoutEffect(() => {
    const art = articleRef.current;
    if (!art) return;
    const byPara = new Map();
    marks.forEach((m) => byPara.set(m.p, m));
    art.querySelectorAll("p").forEach((p, i) => {
      p.classList.remove(...HL);
      const m = byPara.get(i);
      if (m) {
        p.classList.add("hl", `hl-${m.color}`);
        if (m.note) p.classList.add("has-note");
      }
    });
  }, [marks, html]);

  /* ---- press and hold on a paragraph: mark it ---- */
  const clearPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (e) => {
    if (!onPara || (e.pointerType === "mouse" && e.button !== 0)) return;
    const el = e.target.closest && e.target.closest(".rd-text p");
    if (!el) return;
    const art = el.closest("article");
    const rec = { x: e.clientX, y: e.clientY, timer: 0 };
    rec.timer = setTimeout(() => {
      const index = Array.prototype.indexOf.call(art.querySelectorAll("p"), el);
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      press.current = null;
      if (index >= 0 && text.length > 1) onPara({ index, text });
    }, LONG_MS);
    press.current = rec;
  };
  const onPointerMove = (e) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 9) clearPress();
  };

  /* ---- imperative surface for the reader shell ---- */
  useEffect(() => {
    onRegisterApi?.({
      // page forward/back by most of a screen — used by Space / PageDown
      step: (dir) =>
        window.scrollBy({
          top: dir * window.innerHeight * 0.86,
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        }),
      seek: (pos) => place(pos),
    });
    return () => onRegisterApi?.(null);
  }, [onRegisterApi, place]);

  /* ---- scroll → position + chrome visibility ---- */
  useEffect(() => {
    const markUser = () => {
      lastUser.current = performance.now();
    };
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const y = window.scrollY;
        const user = performance.now() - lastUser.current < USER_WINDOW;
        const pos = Math.min(1, Math.max(0, y / range()));
        onPos?.(pos, user);

        if (user) {
          const dy = y - lastY.current;
          acc.current = Math.sign(dy) === Math.sign(acc.current) ? acc.current + dy : dy;
          if (y < 90) onChrome?.(true);
          else if (acc.current > 28) onChrome?.(false);
          else if (acc.current < -28) onChrome?.(true);
        }
        lastY.current = y;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", markUser, { passive: true });
    window.addEventListener("touchmove", markUser, { passive: true });
    window.addEventListener("keydown", markUser);
    window.addEventListener("pointerdown", markUser, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", markUser);
      window.removeEventListener("touchmove", markUser);
      window.removeEventListener("keydown", markUser);
      window.removeEventListener("pointerdown", markUser);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [onPos, onChrome, range]);

  /* ---- a tap (touch/pen only) summons or dismisses the bars ---- */
  const onClick = (e) => {
    if (e.target.closest("a, button")) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    // mouse users keep their bars; the scroll direction manages them
    if (!isTouchTap(e)) return;
    onTap?.();
  };

  return (
    <div
      className="rd__flow"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
    >
      <article
        ref={articleRef}
        className="rd-text"
        lang={lang}
        // chapter html is sanitised in library/api.js before it is cached
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {footer}
    </div>
  );
}
