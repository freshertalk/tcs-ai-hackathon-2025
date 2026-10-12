// src/auth/Account.jsx
// The reader's Google account, in two shapes: a panel (for the settings sheet
// and the phone menu's account row) and a small icon button for the
// navigation bar.
//
// The navigation button carries no words at all: Google's own "G" before
// sign-in, the person's picture after, and a single sign-out icon when it is
// pressed. Signing in always goes through the dialog (src/auth/SignInDialog),
// where the acceptance of the policies is asked and recorded.

import React, { useEffect, useRef, useState } from "react";
import { signOut, useAuth } from "./google";
import { openSignIn } from "./SignInDialog";
import { syncAvailable, useSyncStatus } from "../sync/sync";

const STATUS = {
  idle: "तैयार",
  syncing: "मिला रहे हैं…",
  ok: "सब डिवाइस पर एक-सा",
  error: "अभी नहीं मिल पाया — बाद में फिर कोशिश होगी",
  expired: "फिर से साइन इन कीजिए",
  off: "",
};

function ago(ts) {
  if (!ts) return "";
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "अभी";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} मिनट पहले`;
  return `${Math.round(m / 60)} घंटे पहले`;
}

/** Google's four-colour "G", as a mark. */
export function GoogleG({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

const IconOut = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 4H5.5A1.5 1.5 0 004 5.5v13A1.5 1.5 0 005.5 20H9" />
    <path d="M15 8l4 4-4 4M19 12H9" />
  </svg>
);

/** The whole account story, for a panel. */
export function AccountPanel({ compact = false }) {
  const { user, configured } = useAuth();
  const sync = useSyncStatus();
  if (!configured) return null;

  if (!user) {
    return (
      <div className={`acct ${compact ? "acct--compact" : ""}`}>
        <p className="acct__t hi-d">Google से साइन इन कीजिए</p>
        <p className="acct__d hi">
          पढ़ने के लिए साइन-इन ज़रूरी है। साइन इन करने पर आपकी पढ़ने की जगह, बुकमार्क और रेखांकन आपके सभी
          डिवाइस पर साथ चलेंगे, और आप किताब को अपने नाम से रेटिंग दे सकेंगे।
        </p>
        <button type="button" className="acct__go" onClick={openSignIn}>
          <GoogleG size={18} />
          <span>साइन इन</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`acct ${compact ? "acct--compact" : ""}`}>
      <div className="acct__who">
        {user.picture ? (
          <img src={user.picture} alt="" width="40" height="40" referrerPolicy="no-referrer" />
        ) : (
          <span className="acct__i" aria-hidden="true">
            {String(user.name || "?").slice(0, 1)}
          </span>
        )}
        <div className="acct__id">
          <b>{user.name}</b>
          <span>{user.email}</span>
        </div>
      </div>

      {syncAvailable() && (
        <p className={`acct__sync is-${sync.status}`} role="status">
          <i aria-hidden="true" />
          <span>
            {STATUS[sync.status] || ""}
            {sync.status === "ok" && sync.lastAt ? ` · ${ago(sync.lastAt)}` : ""}
          </span>
        </p>
      )}
      <p className="acct__d hi">
        आपकी पढ़ने की जगह, बुकमार्क और रेखांकन इसी खाते से जुड़कर सभी डिवाइस पर दिखेंगे।
      </p>

      <button type="button" className="acct__out" onClick={signOut}>
        साइन-आउट
      </button>
    </div>
  );
}

/** The navigation bar's account: an icon, signed out or in — no words. */
export function AccountButton({ className = "" }) {
  const { user, configured } = useAuth();
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!configured) return null;

  if (!user) {
    return (
      <div className={`acctb ${className}`}>
        <button
          type="button"
          className="acctb__btn"
          aria-label="Sign in with Google"
          title="Google"
          onClick={openSignIn}
        >
          <GoogleG size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className={`acctb ${className}`} ref={box}>
      <button
        type="button"
        className="acctb__btn is-in"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        title={user.name}
        onClick={() => setOpen((v) => !v)}
      >
        {user.picture ? (
          <img src={user.picture} alt="" width="38" height="38" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{String(user.name || "?").slice(0, 1)}</span>
        )}
        {syncAvailable() && <i className={`acctb__dot is-${sync.status}`} aria-hidden="true" />}
      </button>
      {open && (
        <div className="acctb__pop acctb__pop--icons">
          <button type="button" className="acctb__out" aria-label="Sign out" title="Sign out" onClick={signOut}>
            <IconOut />
          </button>
        </div>
      )}
    </div>
  );
}

export default AccountPanel;
