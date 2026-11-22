// The "Login icon" tile under /me → Personal: one switch that shows or hides the small person icon in the public website's navbar.
// It hides only the icon — /me itself always opens, whatever this says. Superadmins only (the server refuses everyone else too).

import React, { useEffect, useState } from "react";
import { api } from "./api";

export default function LoginIconTile() {
  const [on, setOn] = useState(null); // null: still reading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api("/api/admin/settings/login-icon")
      .then((d) => alive && setOn(Boolean(d.on)))
      .catch((e) => alive && setError(e.message || "Could not read the setting."));
    return () => {
      alive = false;
    };
  }, []);

  const flip = async () => {
    if (busy || on === null) return;
    const next = !on;
    setBusy(true);
    setError("");
    setOn(next); // at once; put back if the server refuses
    try {
      const d = await api("/api/admin/settings/login-icon", { method: "PUT", body: { on: next } });
      setOn(Boolean(d.on));
      try {
        window.localStorage.removeItem("vpt.loginIcon"); // this browser's memory of the icon: the next visit asks the server
      } catch (_) {
        /* no memory */
      }
    } catch (e) {
      setOn(!next);
      setError(e.message || "The change was not saved.");
    }
    setBusy(false);
  };

  return (
    <div className="hm-kundali hm-kundali--expenses hm-kundali--switch" role="group" aria-label="Login icon on the website">
      <span className="hm-kundali__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8.2" r="3.6" />
          <path d="M4.6 20c.6-3.8 3.6-6 7.4-6s6.8 2.2 7.4 6" />
        </svg>
      </span>
      <span className="hm-kundali__text">
        <b>Login icon</b>
        <small>
          {on === null ? "Reading…" : on ? "Shown in the public website's top bar." : "Hidden from the public website."} /me always opens.
        </small>
        {error && (
          <small className="hm-switch__err" role="alert">
            {error}
          </small>
        )}
      </span>
      <button type="button" role="switch" aria-checked={Boolean(on)} aria-label="Show the login icon on the public website" className={`hm-switch ${on ? "is-on" : ""}`} disabled={on === null || busy} onClick={flip} data-tip="Show or hide the small person icon in the public website's navbar. The /me address keeps working either way.">
        <i />
      </button>
    </div>
  );
}
