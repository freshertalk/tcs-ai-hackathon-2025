// src/App.js
import React, { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { MotionConfig, AnimatePresence, motion } from "framer-motion";

import useSmoothScroll from "./hooks/useSmoothScroll";
import Preloader from "./components/site/Preloader";
import Cursor from "./components/site/Cursor";

import Home from "./pages/Home";
import { isAdminPath } from "./admin/paths";
import { loadAnalytics } from "./analytics/loadAnalytics";

import "./styles/site.css";

// The private area is its own bundle: visitors to the public site never
// download it.
const AdminApp = lazy(() => import("./admin/AdminApp"));

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

/** The public site: preloader, cursor, smooth scroll, one page. */
function PublicSite() {
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useSmoothScroll(!loading);

  useEffect(() => {
    loadAnalytics();
  }, []);

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
          word="विनय कुमार तिवारी"
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
            <Route path="/" element={<Home />} />
            {/* /technical and /writings are retired — everything is on / now */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}

export default function App() {
  const { pathname } = useLocation();

  // /me/* is a different application: none of the public
  // site's motion, preloader or analytics runs there.
  if (isAdminPath(pathname)) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }
  return <PublicSite />;
}
