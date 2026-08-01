// src/App.js
import React, { useEffect, useLayoutEffect, useState } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { MotionConfig, AnimatePresence, motion } from "framer-motion";

import useSmoothScroll from "./hooks/useSmoothScroll";
import Preloader from "./components/site/Preloader";
import Cursor from "./components/site/Cursor";

import Gate from "./pages/Gate";
import Technical from "./pages/Technical";
import Writings from "./pages/Writings";

import "./styles/site.css";

const EASE = [0.16, 1, 0.3, 1];

/**
 * Every route change lands at the top of the new page.
 *
 * Three things fight us here, so all three are handled:
 *   1. the browser's own scroll restoration on history navigation,
 *   2. late layout shifts as fonts and images settle,
 *   3. the inertial scroll engine, which needs its target resynced.
 */
function ScrollTop() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const top = () => window.scrollTo(0, 0);
    top();

    const r1 = requestAnimationFrame(() => {
      top();
      // second frame: after the newly mounted page has laid out
      requestAnimationFrame(top);
    });
    const t = setTimeout(top, 120);

    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(t);
    };
  }, [pathname]);

  return null;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useSmoothScroll(!loading);

  useEffect(() => {
    if (loading) {
      window.scrollTo(0, 0);
      document.body.classList.add("is-locked");
    } else {
      document.body.classList.remove("is-locked");
    }
  }, [loading]);

  return (
    // reducedMotion="user" collapses every animation to a cross-fade for
    // visitors who ask their OS for less motion.
    <MotionConfig reducedMotion="user">
      <div className="grain" aria-hidden="true" />
      <Cursor />
      <ScrollTop />

      {loading && (
        <Preloader
          onDone={() => setLoading(false)}
          word="दो कुल्हड़ चाय"
          sub="Engineer &amp; Author"
        />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <Routes location={location}>
            <Route path="/" element={<Gate />} />
            <Route path="/technical" element={<Technical />} />
            <Route path="/writings" element={<Writings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
