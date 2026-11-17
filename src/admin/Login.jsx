// The door to the private area. It says plainly, and politely, that this is a personal space; no address or name
// of an account is shown, and having a Google account or an email address is not enough on its own: the owner
// must have added it. Ways in: Google, email + password, or a code sent by email.

import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { IconGoogle, IconShield } from "./icons";
import "./signin.css";

const ERRORS = {
  denied: "The Google sign-in was cancelled. You may try again whenever you wish.",
  state: "That sign-in attempt expired or did not match. Please try once more.",
  google: "Google could not complete the sign-in. Please try once more.",
  unverified: "That Google account does not have a verified email address.",
  unauthorized: "Thank you for your interest — this account does not have access to this area.",
  "not-configured": "Sign-in has not been set up yet.",
  "google-off": "Signing in with Google is turned off. Use your email address instead.",
};

/** An eye: open while the password is showing (the pupil rolls as it opens), shut with a lid line while it is hidden. */
function Eye({ open }) {
  return (
    <svg className="sg-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="sg-eye__lid" d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <g className="sg-eye__ball">
        <circle className="sg-eye__pupil" cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      </g>
      {!open && <path className="sg-eye__slash" d="M4 4l16 16" />}
    </svg>
  );
}

/** The password field, with an eye that shows / hides it. */
export function PasswordInput({ id, value, onChange, label = "Password", autoComplete = "current-password", describedBy, required = true }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="sg-field">
      <label htmlFor={id}>{label}</label>
      <div className="sg-pass">
        <input id={id} type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required={required} spellCheck="false" aria-describedby={describedBy} />
        <button type="button" className={`sg-pass__eye ${shown ? "is-open" : "is-shut"}`} onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} data-tip={shown ? "Hide the password" : "Show the password"}>
          <Eye key={shown ? "open" : "shut"} open={shown} />
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const methods = auth.methods || { google: true, password: true, code: false };
  const urlError = ERRORS[params.get("error")];

  // which email form is showing: password | code (ask, then enter) | link (ask, then sent) | signup (ask, then sent)
  const [mode, setMode] = useState("password");
  const [step, setStep] = useState("ask");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [wrong, setWrong] = useState(false); // the last password try was refused: offer the way out beside the message
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const emailOpen = methods.password || methods.code;
  const canLink = Boolean(auth.emailReady);
  const go = (m) => {
    setMode(m);
    setStep("ask");
    setError("");
    setNote("");
    setCode("");
    setWrong(false);
    setPassword("");
  };

  const run = async (fn) => {
    setBusy(true);
    setError("");
    setNote("");
    setWrong(false);
    try {
      await fn();
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
      setWrong(e.code === "bad_login" || e.code === "bad_code" || e.code === "locked");
    }
    setBusy(false);
  };

  const signInPassword = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/api/auth/email/login", { method: "POST", body: { email: email.trim(), password, remember } });
      setPassword("");
      await auth.reload();
    });
  };
  const ask = (path, then) => (e) => {
    e.preventDefault();
    run(async () => {
      const d = await api(path, { method: "POST", body: { email: email.trim() } });
      setNote(d.message || "");
      setStep(then);
    });
  };
  const signUp = (e) => {
    e.preventDefault();
    run(async () => {
      const d = await api("/api/auth/email/signup", { method: "POST", body: { name: name.trim(), email: email.trim(), note: why.trim() } });
      setNote(d.message || "");
      setStep("sent");
    });
  };
  const signInCode = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/api/auth/email/code/verify", { method: "POST", body: { email: email.trim(), code: code.replace(/\s+/g, ""), remember } });
      await auth.reload();
    });
  };

  const emailField = (
    <div className="sg-field">
      <label htmlFor="sg-email">Email address</label>
      <input id="sg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" required spellCheck="false" autoCapitalize="none" />
    </div>
  );
  const remembered = (
    <label className="sg-check">
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in on this device
    </label>
  );

  return (
    <main className="gate">
      <section className="gate__panel" aria-labelledby="gate-title">
        <span className="gate__badge" aria-hidden="true">
          <IconShield />
        </span>
        <p className="gate__kicker">Private area</p>
        <h1 id="gate-title">Vinay&rsquo;s control room</h1>

        <div className="gate__notice" role="note">
          <p>
            Namaste, and thank you for visiting. This area is a personal workspace of <b>Vinay Kumar Tiwari</b>. It is
            not a public service and is not intended for visitors.
          </p>
          <p>
            If you have reached this page by chance, we kindly request that you do not attempt to enter. You are most
            welcome on the public website instead.
          </p>
        </div>

        {(urlError || error) && (
          <div className="gate__error" role="alert">
            <p>{error || urlError}</p>
            {wrong && mode === "password" && (
              <p className="sg-oops">
                {canLink && (
                  <button type="button" onClick={() => go("link")}>
                    Forgot your password?
                  </button>
                )}
                {canLink ? (
                  <button type="button" onClick={() => go("signup")}>
                    New here? Create an account
                  </button>
                ) : null}
                {methods.code && (
                  <>
                    <button type="button" onClick={() => go("code")}>
                      Email me a code
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {note && !error && (
          <p className="sg-note" role="status">
            {note}
          </p>
        )}

        {emailOpen && canLink && (
          <div className="sg-tabs" role="tablist" aria-label="Sign in or create an account">
            <button type="button" role="tab" aria-selected={mode !== "signup"} className={mode !== "signup" ? "is-on" : ""} onClick={() => go("password")}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-on" : ""} onClick={() => go("signup")}>
              Create account
            </button>
          </div>
        )}

        {/* a normal link, not fetch(): the browser has to follow Google's redirects */}
        {methods.google && mode !== "signup" && (
          <a className="gate__google" href="/api/auth/google/start">
            <IconGoogle />
            <span>Sign in with Google</span>
          </a>
        )}

        {methods.google && emailOpen && mode !== "signup" && (
          <p className="sg-or" aria-hidden="true">
            <span>or with your email</span>
          </p>
        )}

        {emailOpen && mode === "password" && methods.password && (
          <form className="sg-form" onSubmit={signInPassword} aria-label="Sign in with email and password">
            {emailField}
            <PasswordInput id="sg-pass" value={password} onChange={setPassword} />
            {remembered}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Signing in…" : "Sign in with email"}
            </button>
            <div className="sg-links">
              {canLink && (
                <button type="button" onClick={() => go("link")}>
                  Forgot your password, or first time here?
                </button>
              )}
              {methods.code && (
                <button type="button" onClick={() => go("code")}>
                  Email me a sign-in code instead
                </button>
              )}
            </div>
          </form>
        )}

        {emailOpen && mode === "code" && methods.code && (
          <form className="sg-form" onSubmit={step === "ask" ? ask("/api/auth/email/code", "enter") : signInCode} aria-label="Sign in with an emailed code">
            {emailField}
            {step === "enter" && (
              <div className="sg-field">
                <label htmlFor="sg-code">6-digit code</label>
                <input id="sg-code" className="sg-code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
              </div>
            )}
            {step === "enter" && remembered}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Please wait…" : step === "ask" ? "Email me a code" : "Sign in"}
            </button>
            <div className="sg-links">
              {step === "enter" && (
                <button type="button" onClick={() => setStep("ask")}>
                  Send a new code
                </button>
              )}
              {methods.password && (
                <button type="button" onClick={() => go("password")}>
                  Use my password instead
                </button>
              )}
            </div>
          </form>
        )}

        {emailOpen && mode === "link" && (
          <form className="sg-form" onSubmit={step === "ask" ? ask("/api/auth/email/link", "sent") : (e) => (e.preventDefault(), go("password"))} aria-label="Email me a link to choose a password">
            {step === "ask" && (
              <>
                <p className="sg-help">Enter your email address and we will send you a link to choose a new password. It works once, for an hour.</p>
                {emailField}
              </>
            )}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Please wait…" : step === "ask" ? "Email me the link" : "Back to sign in"}
            </button>
            {step === "ask" && (
              <div className="sg-links">
                <button type="button" onClick={() => go("password")}>
                  Back to sign in
                </button>
              </div>
            )}
          </form>
        )}

        {emailOpen && mode === "signup" && (
          <form className="sg-form" onSubmit={step === "ask" ? signUp : (e) => (e.preventDefault(), go("password"))} aria-label="Create an account">
            {step === "ask" ? (
              <>
                <p className="sg-help">Tell us who you are. If this address already has access, we email you a link to finish setting up. Otherwise your request goes to the owner, who replies by email — nobody gets in by asking alone.</p>
                <div className="sg-field">
                  <label htmlFor="sg-name">Your name</label>
                  <input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
                </div>
                {emailField}
                <div className="sg-field">
                  <label htmlFor="sg-why">Why do you need access? (optional)</label>
                  <textarea id="sg-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={240} rows={2} />
                </div>
              </>
            ) : (
              <p className="sg-help">Done. Check your inbox (and the spam folder) for the next step.</p>
            )}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Please wait…" : step === "ask" ? "Request access" : "Back to sign in"}
            </button>
            {step === "ask" && (
              <div className="sg-links">
                <button type="button" onClick={() => go("password")}>
                  Already have an account? Sign in
                </button>
              </div>
            )}
          </form>
        )}

        <p className="gate__fine">Only accounts authorised by the owner can sign in, however they arrive. Every attempt is checked by the server.</p>

        <a className="gate__home" href="/">
          ← Go to the public website
        </a>
      </section>
    </main>
  );
}
