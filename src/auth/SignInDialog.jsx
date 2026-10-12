// src/auth/SignInDialog.jsx
// The one door to signing in.
//
// A person must first agree to the Terms of Use, Privacy Policy and Refund
// Policy (the box is not pre-ticked); only then is Google's button shown. The
// moment Google returns a token, src/legal/consent.js writes the acceptance to
// the owner's record. Everything that offers sign-in — the navigation bar, the
// reading wall, the ratings form, the settings sheet — comes through here, so
// there is no way to sign in without that acceptance.

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { markTermsPending } from "../legal/consent";
import { renderSignInButton, useAuth } from "./google";
import { LEGAL } from "../data/legal";

const EVENT = "vkt:sign-in";

const LEADS = {
  read: "यह किताब पढ़ने के लिए साइन इन ज़रूरी है।",
  rate: "राय देने के लिए साइन इन कीजिए।",
};

/** Open the sign-in. `reason` ("read" | "rate") only changes the line shown above the box. */
export function openSignIn(reason) {
  const r = typeof reason === "string" ? reason : "";
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { reason: r } }));
}

/** The acceptance and Google's button. Used in the dialog and on the reading wall. */
export function SignInCard({ lead, onSignedIn }) {
  const [agree, setAgree] = useState(false);
  const [failed, setFailed] = useState(false);
  const holder = useRef(null);
  const { user } = useAuth();

  useEffect(() => {
    markTermsPending(agree);
    return () => markTermsPending(false);
  }, [agree]);

  useEffect(() => {
    let live = true;
    if (agree && holder.current) {
      holder.current.innerHTML = "";
      renderSignInButton(holder.current, { width: 280 }).catch(() => live && setFailed(true));
    }
    return () => {
      live = false;
    };
  }, [agree]);

  useEffect(() => {
    if (user && onSignedIn) onSignedIn(user);
    // once, when the person arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.email]);

  return (
    <div className="si">
      {lead ? <p className="si__lead hi">{lead}</p> : null}

      <label className="si__agree" lang="en">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I have read and agree to the{" "}
          <Link to="/terms" target="_blank" rel="noopener">
            Terms of Use
          </Link>
          ,{" "}
          <Link to="/privacy" target="_blank" rel="noopener">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link to="/refund" target="_blank" rel="noopener">
            Refund Policy
          </Link>{" "}
          (edition {LEGAL.version}), and I consent to the recording of this acceptance — date and time,
          account and device details — as evidence.
        </span>
      </label>

      <div className={`si__btn ${agree ? "is-on" : ""}`}>
        <div ref={holder} className="si__g" />
        {!agree && <p className="si__hint">Tick the box above to continue with Google.</p>}
      </div>
      {failed && (
        <p className="si__err" role="alert">
          Google sign-in could not open. Please reload the page and try again.
        </p>
      )}
    </div>
  );
}

/** Mounted once; opens when anything calls openSignIn(). */
export default function SignInDialogHost() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { user } = useAuth();

  useEffect(() => {
    const on = (e) => {
      setReason((e.detail && e.detail.reason) || "");
      setOpen(true);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  // signed in: the dialog's work is done
  useEffect(() => {
    if (user && open) setOpen(false);
  }, [user, open]);

  if (!open) return null;

  return (
    <div className="sid" role="dialog" aria-modal="true" aria-label="Sign in with Google">
      <button type="button" className="sid__scrim" aria-label="Close" onClick={() => setOpen(false)} />
      <div className="sid__card">
        <button type="button" className="sid__x" aria-label="Close" onClick={() => setOpen(false)}>
          ✕
        </button>
        <h2 className="sid__t" lang="en">
          Sign in with Google
        </h2>
        <SignInCard lead={LEADS[reason]} />
      </div>
    </div>
  );
}
