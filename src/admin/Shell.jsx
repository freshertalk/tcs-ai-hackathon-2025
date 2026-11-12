import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";

/**
 * The frame around every signed-in screen: header, breadcrumb, user chip.
 * `notice` renders ABOVE the header — the dashboard uses it for the
 * "personal setup" strip.
 */
export default function Shell({ crumb, notice, children, narrow, wide, fluid }) {
  // fluid: use the whole window (the trading desk); wide: a roomier column
  const wrap = fluid ? "adm-wrap adm-wrap--fluid" : wide ? "adm-wrap adm-wrap--wide" : "adm-wrap";
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign(adminPath());
    }
  };

  return (
    <>
      {notice}
      <header className="adm-head">
        <div className={`${wrap} adm-head__row`}>
          <nav className="adm-crumbs" aria-label="Breadcrumb">
            <Link to={adminPath()} className="adm-brand">
              Vinay&rsquo;s control room
            </Link>
            {crumb && (
              <>
                <span aria-hidden="true">/</span>
                <span aria-current="page">{crumb}</span>
              </>
            )}
          </nav>
          {user && (
            <div className="adm-user">
              {user.picture ? (
                <img src={user.picture} alt="" referrerPolicy="no-referrer" width="32" height="32" />
              ) : (
                <span className="adm-user__ph" aria-hidden="true">
                  {(user.name || user.email).slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="adm-user__id">
                <b>{user.name || user.email}</b>
                <small>
                  {user.email} ·{" "}
                  <span className={`adm-role adm-role--${user.role}`}>
                    {user.role === "superadmin" ? "Superadmin" : "Admin"}
                  </span>
                </small>
              </span>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={logout} disabled={busy}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className={`${wrap} adm-main ${narrow ? "adm-main--narrow" : ""} ${fluid ? "adm-main--fluid" : ""}`}>{children}</main>
      <footer className={`adm-foot ${wrap}`}>
        Private area · not indexed · not for public use
      </footer>
    </>
  );
}
