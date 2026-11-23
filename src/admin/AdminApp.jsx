// src/admin/AdminApp.jsx
// The private area at /me. A separate application from the
// public site: its own bundle, its own styles, no preloader or analytics.
//
// Who gets what (the server enforces all of it again — this only decides what
// to show):
//   not signed in .... the login screen (or first-run setup)
//   admin ............ the dashboard and every settings page
//   superadmin ....... the same, plus Admin users and the Personal pages — the Kundali and Expenses (the owner, and
//                      anyone the owner has made one)

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BRAND } from "./brand";
import { Navigate, Route, Routes } from "react-router-dom";

import { api } from "./api";
import { AuthContext, useAuth } from "./auth";
import { ADMIN_BASE } from "./paths";
import { Loading } from "./ui";
import Shell from "./Shell";
import TipLayer from "./help/TipLayer";
import { DialogProvider } from "./dialog/DialogProvider";
import { PrefsProvider } from "./prefs";
import { TempleProvider } from "./temple/Temple";


import Login from "./Login";
import Setup from "./Setup";
import Dashboard from "./Dashboard";
import GoogleSettings from "./GoogleSettings";
import AnalyticsSettings from "./AnalyticsSettings";
import AdminUsers from "./AdminUsers";
import EmailSettings from "./EmailSettings";
import Account from "./Account";
import ResetPassword from "./ResetPassword";
import AiSettings from "./AiSettings";
import PersonalAccess from "./PersonalAccess";
import StockReport from "./stock/StockReport";
import ChartPage from "./stock/chart/ChartPage";
import TradeAI from "./tradeai/TradeAI";
import Social from "./social/Social";
import Kundali from "./kundali/Kundali";
import Expenses from "./expenses/Expenses";
import AiAsks from "./AiAsks";
import SnackHost from "./ux/SnackHost";
import BackToTop from "./ux/BackToTop";

import "./admin.css";
import "./hub.css";
// the one button system: loaded last so it governs every page (see BRAND.md)
import "./buttons.css";
// motion and softness: loaded last of all, it changes how things move and how their edges feel, nothing else
import "./signin.css";
import "./smooth.css";
// the finish: one family of surfaces, headers and type over every page
import "./polish.css";
// the Zerodha look (the owner's choice, 21 Nov 2026): flat, hairlines, small corners, Kite's orange tab — loaded last
import "./kite.css";
// no text spilling, cut off or pushing a page sideways, on any screen: loaded last of all
import "./fit.css";
// the experience layer (23 Nov 2026): spacing and motion scales, wrapping type, focus ring, tap targets, snackbar, skeletons
import "./ux/ux.css";
// The private area wears the DrishtiAI logo as its icon (public/drishti-logo.svg and its PNG copies). The public
// site's own link tags are put aside while this area is open and put back when it is left. (A page loaded straight
// from /me already carries these in its own head: see scripts/prerender.js.)
const PRIVATE_ICONS = [
  ["icon", "any", "/drishti-logo.svg", "image/svg+xml"],
  ["icon", "192x192", "/drishti-192.png"],
  ["icon", "512x512", "/drishti-512.png"],
  ["apple-touch-icon", "180x180", "/drishti-apple-touch.png"],
];
function usePrivateFavicon() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const head = document.head;
    const put = [...head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]')].filter((l) => !l.dataset.private);
    put.forEach((l) => l.remove());
    // a page that came straight from /me already carries them in its own head
    const have = Boolean(head.querySelector("link[data-private]"));
    const added = (have ? [] : PRIVATE_ICONS).map(([rel, sizes, href, type = "image/png"]) => {
      const l = document.createElement("link");
      l.rel = rel;
      l.sizes = sizes;
      l.type = type;
      l.href = href;
      l.dataset.private = "1";
      head.appendChild(l);
      return l;
    });
    return () => {
      added.forEach((l) => l.remove());
      put.forEach((l) => head.appendChild(l));
    };
  }, []);
}


/** Keep this area out of search results and out of the browser tab's public identity. */
function useQuietHead() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = BRAND.name;
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
              {auth.errorCode === "not_api" && (
                <p className="adm-small">
                  The usual fix, in one step: <code>stock-deploy --nginx-apply</code> — it writes nginx&rsquo;s rules,
                  tests them, reloads, checks <code>/api</code> again, and puts every file back by itself if any step
                  fails.
                </p>
              )}
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
      <Shell crumb="Superadmin only" narrow>
        <section className="adm-card">
          <h1 className="adm-h1">Superadmin only</h1>
          <p className="adm-lead">Only the superadmin can open this page.</p>
        </section>
      </Shell>
    );
  }
  return children;
}

export default function AdminApp() {
  useQuietHead();
  usePrivateFavicon();
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
        {/* your preferences (/me → Customize): the look, the workspaces, the Desk's start — read once signed in */}
        <PrefsProvider enabled={Boolean(value.user)}>
        <DialogProvider>
        {/* the Mandir: devotional audio on every private page, once signed in */}
        <TempleProvider>
        {/* what an automatic feature would like the AI for: a popup for the superadmin, "Allow once" or "Not now" */}
        {value.user && value.user.role === "superadmin" && <AiAsks />}
        {/* the snackbar (short notes at the bottom: saved, copied, offline…) and "back to top" on long pages */}
        {value.user && <SnackHost />}
        {value.user && <BackToTop />}
        <Routes>
          <Route path={ADMIN_BASE} element={<Gate><Dashboard /></Gate>} />
          <Route path={`${ADMIN_BASE}/google`} element={<Gate><GoogleSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/analytics`} element={<Gate><AnalyticsSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/admins`} element={<Gate superOnly><AdminUsers /></Gate>} />
          {/* the page an emailed link opens: public, the person is not signed in yet */}
          <Route path={`${ADMIN_BASE}/reset`} element={<ResetPassword />} />
          <Route path={`${ADMIN_BASE}/account`} element={<Gate><Account /></Gate>} />
          <Route path={`${ADMIN_BASE}/email`} element={<Gate superOnly><EmailSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/ai`} element={<Gate><AiSettings /></Gate>} />
          <Route path={`${ADMIN_BASE}/stock-report`} element={<Gate><StockReport /></Gate>} />
          <Route path={`${ADMIN_BASE}/chart/:symbol`} element={<Gate><ChartPage /></Gate>} />
          <Route path={`${ADMIN_BASE}/tradeai`} element={<Gate><TradeAI /></Gate>} />
          <Route path={`${ADMIN_BASE}/social`} element={<Gate><Social /></Gate>} />
          <Route path={`${ADMIN_BASE}/personal-access`} element={<Gate><PersonalAccess /></Gate>} />
          {/* the owner's birth chart, in Hindi: superadmins only (the server refuses everyone else too) */}
          <Route path={`${ADMIN_BASE}/kundali`} element={<Gate superOnly><Kundali /></Gate>} />
          {/* the owner's expense tracker: superadmins only, as the Kundali is */}
          <Route path={`${ADMIN_BASE}/expenses`} element={<Gate superOnly><Expenses /></Gate>} />
          <Route path="*" element={<Navigate to={ADMIN_BASE} replace />} />
        </Routes>
        </TempleProvider>
        </DialogProvider>
        </PrefsProvider>
      </AuthContext.Provider>
      {/* hover help: one bubble for every label and button that has an explanation */}
      <TipLayer />
    </div>
  );
}
