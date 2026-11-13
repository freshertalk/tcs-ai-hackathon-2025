// src/admin/AdminApp.jsx
// The private area at /me. A separate application from the
// public site: its own bundle, its own styles, no preloader or analytics.
//
// Who gets what (the server enforces all of it again — this only decides what
// to show):
//   not signed in .... the login screen (or first-run setup)
//   admin ............ the dashboard and every settings page
//   superadmin ....... the same, plus Admin users

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { api } from "./api";
import { AuthContext, useAuth } from "./auth";
import { ADMIN_BASE } from "./paths";
import { Loading } from "./ui";
import Shell from "./Shell";
import TipLayer from "./help/TipLayer";

import Login from "./Login";
import Setup from "./Setup";
import Dashboard from "./Dashboard";
import GoogleSettings from "./GoogleSettings";
import AnalyticsSettings from "./AnalyticsSettings";
import AdminUsers from "./AdminUsers";
import AiSettings from "./AiSettings";
import PersonalAccess from "./PersonalAccess";
import StockReport from "./stock/StockReport";

import "./admin.css";
import "./hub.css";

/** Keep this area out of search results and out of the browser tab's public identity. */
function useQuietHead() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Control room";
    let meta = document.querySelector('meta[name="robots"]');
    const prev = meta ? meta.getAttribute("content") : null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow, noarchive");
    document.documentElement.lang = "en";
    return () => {
      document.title = prevTitle;
      if (prev !== null) meta.setAttribute("content", prev);
    };
  }, []);
}

/** Decides which screen a visitor is allowed to see. */
function Gate({ superOnly = false, children }) {
  const auth = useAuth();

  if (auth.loading) return <Loading label="Checking your session…" />;
  if (auth.error) {
    // on the live site the cause is the hosting, not a forgotten dev command
    const hosted = process.env.NODE_ENV === "production";
    return (
      <main className="adm-center">
        <section className="adm-card">
          <h1>Can&rsquo;t reach the server</h1>
          {hosted ? (
            <>
              <p className="adm-lead">
                {auth.errorCode === "not_api"
                  ? "This page loaded, but requests to /api are coming back as the site’s own page. The web server in front is handing out the site’s files for them instead of passing them to the app — so nobody can sign in."
                  : "This page loaded, but the private area’s server did not answer. It may be restarting, or not running."}
              </p>
              <p className="adm-small">
                For the owner, on the server: <code>stock-deploy --doctor</code> checks that the app is running and that
                nginx passes <code>/api</code> and <code>/me</code> to it, and prints what to change.
              </p>
            </>
          ) : (
            <>
              <p className="adm-lead">
                The private area talks to a small API server. For development, the easiest way to run
                everything is <code>npm run dev</code> — it starts the API and the site together.
              </p>
              <p className="adm-small">
                Already running them separately? Check that <code>npm run server</code> is up, and{" "}
                <b>restart <code>npm start</code></b> if you started it before the proxy was added
                (it only reads <code>src/setupProxy.js</code> at startup).
              </p>
            </>
          )}
          <p>
            <button type="button" className="adm-btn adm-btn--solid" onClick={auth.reload}>
              Try again
            </button>
          </p>
        </section>
      </main>
    );
  }
  if (auth.needsSetup) return <Setup />;
  if (!auth.user) return <Login />;
  if (superOnly && auth.user.role !== "superadmin") {
    return (
      <Shell crumb="Admin users" narrow>
        <section className="adm-card">
          <h1 className="adm-h1">Superadmin only</h1>
          <p className="adm-lead">Only the superadmin can add or remove admin users.</p>
        </section>
      </Shell>
    );
  }
  return children;
}

export default function AdminApp() {
  useQuietHead();
  const [state, setState] = useState({ loading: true });

  const reload = useCallback(async () => {
    try {
      const d = await api("/api/auth/status");
      setState({ loading: false, ...d });
    } catch (e) {
      setState({ loading: false, error: true, errorCode: (e && e.code) || "" });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(() => ({ ...state, reload }), [state, reload]);

  return (
    <div data-theme="tech" className="adm">
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path={ADMIN_BASE} element={<Gate><Dashboard /></Gate>} />
          <Route path={`${ADMIN_BASE}/google`} element={<Gate><GoogleSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/analytics`} element={<Gate><AnalyticsSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/admins`} element={<Gate superOnly><AdminUsers /></Gate>} />
          <Route path={`${ADMIN_BASE}/ai`} element={<Gate><AiSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/stock-report`} element={<Gate><StockReport /></Gate>} />
          <Route path={`${ADMIN_BASE}/personal-access`} element={<Gate><PersonalAccess /></Gate>} />
          <Route path="*" element={<Navigate to={ADMIN_BASE} replace />} />
        </Routes>
      </AuthContext.Provider>
      {/* hover help: one bubble for every label and button that has an explanation */}
      <TipLayer />
    </div>
  );
}
