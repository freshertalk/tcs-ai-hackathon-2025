// src/auth/Account.jsx
// The reader's Google account, in two shapes: a panel (for the settings sheet
// and the phone menu's account row) and the button in the navigation bar.
//
// Signed out, the navigation button is a sign-in icon (a person stepping
// through a door) with a tooltip — not Google's "G": the page may offer other
// ways in one day, and an icon should say what it does. Signed in, it is the
// person's picture, and pressing it opens a small menu: their account page,
// the admin dashboard if they are an admin, and sign-out.
//
// Signing in always goes through the dialog (src/auth/SignInDialog), where the
// acceptance of the policies is asked and recorded.

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { signOut, useAuth } from "./google";
import { openSignIn } from "./SignInDialog";
import { syncAvailable, useSyncStatus } from "../sync/sync";
import { useMe } from "../account/me";
import { GoogleG, IconDashboard, IconShield, IconSignIn, IconSignOut, IconUser } from "../components/ui/icons";

export { GoogleG };

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

/** The whole account story, for a panel. */
export function AccountPanel({ compact = false }) {
  const { user, configured } = useAuth();
  const sync = useSyncStatus();
  const { isAdmin } = useMe();
  if (!configured) return null;

  if (!user) {
    return (
      <div className={`acct ${compact ? "acct--compact" : ""}`}>
        <p className="acct__t hi-d">Google से साइन इन कीजिए</p>
        <p className="acct__d hi">
          पढ़ने के लिए साइन-इन ज़रूरी है। साइन इन करने पर आपकी पढ़ने की जगह, बुकमार्क और रेखांकन आपके सभी
          डिवाइस पर साथ चलेंगे, और आप किताब को अपने नाम से रेटिंग दे सकेंगे।
        </p>
        <button type="button" className="acct__go" onClick={() => openSignIn()}>
          <IconSignIn size={18} />
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

      <div className="acct__links">
        <Link to="/account" className="acct__go">
          <IconDashboard size={18} />
          <span>मेरा खाता</span>
        </Link>
        {isAdmin && (
          <Link to="/admin" className="acct__go">
            <IconShield size={18} />
            <span>एडमिन डैशबोर्ड</span>
          </Link>
        )}
      </div>

      <button type="button" className="acct__out" onClick={signOut}>
        साइन-आउट
      </button>
    </div>
  );
}

/** The navigation bar's account: an icon, signed out or in. */
export function AccountButton({ className = "" }) {
  const { user, configured } = useAuth();
  const sync = useSyncStatus();
  const { isAdmin, me } = useMe();
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
        <button type="button" className="acctb__signin" aria-label="Sign in" onClick={() => openSignIn()}>
          <IconUser size={20} />
        </button>
        <span className="acctb__tip" role="tooltip">
          साइन इन · Sign in
        </span>
      </div>
    );
  }

  const close = () => setOpen(false);

  return (
    <div className={`acctb ${className}`} ref={box}>
      <button
        type="button"
        className="acctb__btn is-in"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {user.picture ? (
          <img src={user.picture} alt="" width="38" height="38" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{String(user.name || "?").slice(0, 1)}</span>
        )}
        {syncAvailable() && <i className={`acctb__dot is-${sync.status}`} aria-hidden="true" />}
      </button>
      {!open && (
        <span className="acctb__tip" role="tooltip">
          {user.name}
        </span>
      )}

      {open && (
        <div className="acctb__menu" role="menu">
          <div className="acctb__who">
            {user.picture ? (
              <img src={user.picture} alt="" width="44" height="44" referrerPolicy="no-referrer" />
            ) : (
              <span className="acctb__ini" aria-hidden="true">
                {String(user.name || "?").slice(0, 1)}
              </span>
            )}
            <div>
              <b>{user.name}</b>
              <span>{user.email}</span>
              {isAdmin ? <span className="acctb__role">Admin</span> : null}
            </div>
          </div>

          <Link to="/account" className="acctb__item" role="menuitem" onClick={close}>
            <IconDashboard size={20} />
            <span>
              मेरा खाता
              <small>
                {me && me.usage && me.usage.seconds
                  ? `पढ़ने में बिताया समय · ${Math.max(1, Math.round(me.usage.seconds / 60))} मिनट`
                  : "प्रोफ़ाइल, प्रगति और डेटा"}
              </small>
            </span>
          </Link>

          {isAdmin && (
            <Link to="/admin" className="acctb__item" role="menuitem" onClick={close}>
              <IconShield size={20} />
              <span>
                एडमिन डैशबोर्ड
                <small>आँकड़े, कूपन, ऑडिट लॉग</small>
              </span>
            </Link>
          )}

          <button
            type="button"
            className="acctb__item acctb__item--out"
            role="menuitem"
            onClick={() => {
              close();
              signOut();
            }}
          >
            <IconSignOut size={20} />
            <span>साइन-आउट</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default AccountPanel;
