// src/auth/SignInDialog.jsx
// The one door to signing in.
//
// A person must first agree to the Terms of Use, Privacy Policy and Refund
// Policy (the box is not pre-ticked); only then does Google's button work. The
// moment Google returns a token, src/legal/consent.js writes the acceptance to
// the owner's record. Everything that offers sign-in — the navigation bar, the
// reading wall, the ratings form, the account and admin pages — comes through
// here, so there is no way to sign in without that acceptance.
//
// Two shapes of the same thing:
//   • SignInCard   the box + Google's button (used inside both shapes below)
//   • the dialog   opened by openSignIn() from anywhere on the site
//   • LoginScreen  the full page (src/auth/LoginScreen.jsx)

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { markTermsPending } from "../legal/consent";
import { renderSignInButton, useAuth } from "./google";
import { LEGAL } from "../data/legal";
import ChaiMark from "../components/site/ChaiMark";
import { GoogleG, IconCheck } from "../components/ui/icons";

const EVENT = "vkt:sign-in";

const LEADS = {
  read: "यह किताब पढ़ने के लिए साइन इन ज़रूरी है।",
  rate: "राय देने के लिए साइन इन कीजिए।",
  coupon: "कूपन लगाने के लिए साइन इन कीजिए।",
  account: "अपना खाता देखने के लिए साइन इन कीजिए।",
  admin: "एडमिन डैशबोर्ड के लिए साइन इन कीजिए।",
};

/** Open the sign-in. `reason` only changes the line shown above the box. */
export function openSignIn(reason) {
  const r = typeof reason === "string" ? reason : "";
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { reason: r } }));
}

/** The acceptance and Google's button. */
export function SignInCard({ lead, onSignedIn }) {
  const [agree, setAgree] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nudge, setNudge] = useState(0);
  const holder = useRef(null);
  const box = useRef(null);
  const { user } = useAuth();

  useEffect(() => {
    markTermsPending(agree);
    return () => markTermsPending(false);
  }, [agree]);

  useEffect(() => {
    let live = true;
    if (agree && holder.current) {
      holder.current.innerHTML = "";
      renderSignInButton(holder.current, { width: 300 }).catch(() => live && setFailed(true));
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

  // pressing the greyed-out button points at the box instead of doing nothing
  const remind = () => {
    setNudge((n) => n + 1);
    if (box.current) box.current.focus();
  };

  return (
    <div className="si">
      {lead ? <p className="si__lead hi">{lead}</p> : null}

      <label className={`si__agree ${nudge ? "is-nudged" : ""}`} lang="en" key={`a${nudge}`}>
        <input ref={box} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span className="si__tick" aria-hidden="true">
          <IconCheck size={16} strokeWidth={2.6} />
        </span>
        <span className="si__txt">
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
          (edition {LEGAL.version}), and I consent to the recording of this acceptance — date and time, account
          and device details — as evidence.
        </span>
      </label>

      <div className={`si__btn ${agree ? "is-on" : ""}`}>
        <div ref={holder} className="si__g" />
        {!agree && (
          <button type="button" className="si__ghost" onClick={remind} aria-describedby="si-hint">
            <GoogleG size={20} />
            <span>Google से जारी रखें</span>
          </button>
        )}
      </div>
      {!agree && (
        <p id="si-hint" className={`si__hint ${nudge ? "is-nudged" : ""}`} key={`h${nudge}`}>
          पहले ऊपर का बॉक्स टिक कीजिए · Tick the box to continue
        </p>
      )}
      {failed && (
        <p className="si__err" role="alert">
          Google sign-in could not open. Please reload the page and try again.
        </p>
      )}
    </div>
  );
}

/** The picture side: night, rain, two cups of tea. */
export function SignInArt({ quote = true }) {
  return (
    <div className="sia" aria-hidden="true">
      <i className="sia__rain" />
      <i className="sia__rain sia__rain--b" />
      <i className="sia__glow" />
      <div className="sia__cups">
        <ChaiMark size={118} />
      </div>
      {quote && (
        <p className="sia__q hi-d">
          कुछ मुलाक़ातें अपनी मंज़िल तक नहीं पहुँचतीं…
          <br />
          फिर भी पूरी ज़िंदगी साथ चलती हैं।
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
    document.body.classList.add("is-locked");
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.classList.remove("is-locked");
    };
  }, [open]);

  // signed in: the dialog's work is done
  useEffect(() => {
    if (user && open) setOpen(false);
  }, [user, open]);

  if (!open) return null;

  return (
    <div className="sid" role="dialog" aria-modal="true" aria-labelledby="sid-title">
      <button type="button" className="sid__scrim" aria-label="Close" onClick={() => setOpen(false)} />
      <div className="sid__card">
        <SignInArt />
        <div className="sid__form">
          <button type="button" className="sid__x" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
          <p className="sid__eyebrow">दो कुल्हड़ चाय</p>
          <h2 id="sid-title" className="sid__t hi-d">
            स्वागत है
            <small lang="en">Sign in with Google</small>
          </h2>
          <SignInCard lead={LEADS[reason]} />
        </div>
      </div>
    </div>
  );
}
