// src/admin/AdminApp.jsx
// The private area at /vinay-personal-tasks. A separate application from the
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

import Login from "./Login";
import Setup from "./Setup";
import Dashboard from "./Dashboard";
import GoogleSettings from "./GoogleSettings";
import AnalyticsSettings from "./AnalyticsSettings";
import AdminUsers from "./AdminUsers";
import PersonalAccess from "./PersonalAccess";

import "./admin.css";

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
    return (
      <main className="adm-center">
        <section className="adm-card">
          <h1>Server not reachable</h1>
          <p className="adm-lead">
            The private area needs the API server. Start it with <code>npm run server</code> (and keep{" "}
            <code>npm start</code> running for development), then reload.
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
    } catch (_) {
      setState({ loading: false, error: true });
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
          <Route path={`${ADMIN_BASE}/personal-access`} element={<Gate><PersonalAccess /></Gate>} />
          <Route path="*" element={<Navigate to={ADMIN_BASE} replace />} />
        </Routes>
      </AuthContext.Provider>
    </div>
  );
}
