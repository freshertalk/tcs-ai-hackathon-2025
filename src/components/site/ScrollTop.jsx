// src/components/site/ScrollTop.jsx
// A back-to-top button that only exists when it is wanted.
//
// Rules:
//   • never while scrolling DOWN — the reader is going somewhere
//   • appears the moment they scroll UP, which is when they want to go back
//   • fades away on its own once they stop and start reading again
//   • never at the very top of the page

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SHOW_AFTER = 420; // px from top before it can appear at all
const UP_THRESHOLD = 8; // px of upward travel that counts as intent
const IDLE_HIDE = 2200; // ms of stillness before it dissolves

export default function ScrollTop() {
  const [visible, setVisible] = useState(false);
  const lastY = useRef(0);
  const idle = useRef(null);

  useEffect(() => {
    lastY.current = window.scrollY;

    const armIdleTimer = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(() => setVisible(false), IDLE_HIDE);
    };

    const onScroll = () => {
      const y = window.scrollY;
      const delta = lastY.current - y; // positive = scrolling up
      lastY.current = y;

      if (y < SHOW_AFTER) {
        setVisible(false);
        clearTimeout(idle.current);
        return;
      }

      if (delta > UP_THRESHOLD) {
        setVisible(true);
        armIdleTimer();
      } else if (delta < 0) {
        // heading down — get out of the way immediately
        setVisible(false);
        clearTimeout(idle.current);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(idle.current);
    };
  }, []);

  const toTop = useCallback(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    setVisible(false);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          className="totop"
          onClick={toTop}
          aria-label="Back to top"
          data-cursor="Top"
          initial={{ opacity: 0, y: 14, scale: 0.86 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          transition={{
            duration: 0.45,
            ease: [0.16, 1, 0.3, 1],
            // the fade-out is slower than the fade-in, so it dissolves
            opacity: { duration: 0.7 },
          }}
          whileTap={{ scale: 0.92 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
