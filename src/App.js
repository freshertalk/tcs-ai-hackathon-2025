// src/App.js
import React, { useLayoutEffect } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { MotionConfig, AnimatePresence, motion } from "framer-motion";

import useSmoothScroll from "./hooks/useSmoothScroll";
import Cursor from "./components/site/Cursor";
import CoverViewerHost from "./library/CoverViewer";

import Home from "./pages/Home";
import Library from "./pages/Library";
import BookPage from "./pages/Book";
import Reader from "./reader/Reader";

import "./styles/site.css";
import "./styles/library.css";
import "./styles/reader.css";
import "./styles/typography.css"; // last: it sets the one text size

const EASE = [0.16, 1, 0.3, 1];

// The reading room is its own world: no preloader, cursor, grain or
// inertial scroll — a page of prose wants the platform's own scrolling.
const isReaderPath = (p) => p === "/read" || p.startsWith("/read/");

/**
 * Every route change lands at the top of the new page — except inside the
 * reader, which restores its own position and would be fought by this.
 *
 * Three things fight us here, so all three are handled:
 *   1. the browser's own scroll restoration on history navigation,
 *   2. late layout shifts as fonts and images settle,
 *   3. the inertial scroll engine, which needs its target resynced.
 */
function ScrollTop() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    if (isReaderPath(pathname)) return undefined;

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
  const location = useLocation();
  const reading = isReaderPath(location.pathname);

  // No splash screen: the cover, the author and the Read button are the
  // first thing on screen, as soon as the page can paint them.
  useSmoothScroll(!reading);

  // All reader chapters share one transition key, so turning a chapter does
  // not fade the whole room out and in.
  const routeKey = reading ? "/read" : location.pathname;

  return (
    // reducedMotion="user" collapses every animation to a cross-fade for
    // visitors who ask their OS for less motion.
    <MotionConfig reducedMotion="user">
      {!reading && <div className="grain" aria-hidden="true" />}
      {!reading && <Cursor />}
      <ScrollTop />
      <CoverViewerHost />

      <AnimatePresence mode="wait">
        <motion.div
          key={routeKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reading ? 0.2 : 0.4, ease: EASE }}
        >
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/books/:slug" element={<BookPage />} />
            <Route path="/read/:slug" element={<Reader />} />
            <Route path="/read/:slug/:chapter" element={<Reader />} />

            {/* retired addresses: keep every old link and bookmark alive */}
            <Route path="/writings" element={<Navigate to="/" replace />} />
            <Route path="/technical" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
