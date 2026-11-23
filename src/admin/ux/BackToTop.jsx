// "Back to top": a small round button that appears once a long page (or the terminal's work area) has been scrolled well down,
// and glides back to the top. It watches whichever area scrolls, so it works on /me, the terminal and the long workspaces alike.

import React, { useEffect, useRef, useState } from "react";

export default function BackToTop() {
  const [show, setShow] = useState(false);
  const target = useRef(null);
  useEffect(() => {
    const look = (e) => {
      const el = e && e.target && e.target !== document && e.target.nodeType === 1 ? e.target : document.scrollingElement || document.documentElement;
      if (!el || el.scrollHeight - el.clientHeight < 600) return;
      // a small scrolling box inside the page (a table, a list) is not "the page"
      if (el !== document.scrollingElement && el.clientHeight < window.innerHeight * 0.6) return;
      target.current = el;
      setShow(el.scrollTop > window.innerHeight * 1.4);
    };
    document.addEventListener("scroll", look, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", look, { capture: true });
  }, []);
  if (!show) return null;
  const go = () => {
    const el = target.current || document.scrollingElement;
    const smooth = !window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el && el.scrollTo) el.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    setShow(false);
  };
  return (
    <button type="button" className="ux-top" onClick={go} aria-label="Back to the top of the page" data-tip="Back to top">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    </button>
  );
}
