// The door to the private area. It says plainly, and politely, that this is a personal space; no address or name
// of an account is shown, and having a Google account or an email address is not enough on its own: the owner
// must have added it. Ways in: Google, email + password, or a code sent by email.
//
// Redesigned 21 Nov 2026: the door shows ONE button for each way in — "Sign in with Google" and "Sign in with Email". Everything
// to do with email (password, a code by email, the link for a forgotten password, asking for an account) is folded behind the
// second button and opens only when it is pressed; nothing about how email sign-in works has changed.

import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import Captcha, { useGate } from "./Captcha";
import { IconGoogle, IconMail, IconShield } from "./icons";
import "./signin.css";

// said when an address is not on the owner's list — by the server on every email route, and here for a Google account that is not
const NOT_AUTHORIZED = "You are not authorized to enter this space. Please do not try to sign in: this is the personal space of Vinay Kumar Tiwari, open only to the email addresses he has allowed.";

const ERRORS = {
  denied: "The Google sign-in was cancelled. You may try again whenever you wish.",
  state: "That sign-in attempt expired or did not match. Please try once more.",
  google: "Google could not complete the sign-in. Please try once more.",
  unverified: "That Google account does not have a verified email address.",
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
export function PasswordInput({ id, value, onChange, label = "Password", autoComplete = "current-password", describedBy, required = true, autoFocus = false }) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false); // Caps Lock is on while typing: a very common reason for "not right"
  return (
    <div className="sg-field">
      <label htmlFor={id}>{label}</label>
      <div className="sg-pass">
        <input id={id} type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} onKeyUp={(e) => typeof e.getModifierState === "function" && setCaps(e.getModifierState("CapsLock"))} onBlur={() => setCaps(false)} autoComplete={autoComplete} required={required} spellCheck="false" aria-describedby={describedBy} autoFocus={autoFocus} />
        <button type="button" className={`sg-pass__eye ${shown ? "is-open" : "is-shut"}`} onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} data-tip={shown ? "Hide the password" : "Show the password"}>
          <Eye key={shown ? "open" : "shut"} open={shown} />
        </button>
      </div>
      {caps && (
        <p className="sg-caps" role="status">
          Caps Lock is on
        </p>
      )}
    </div>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const methods = auth.methods || { google: true, password: true, code: false };
  const urlError = ERRORS[params.get("error")];
  const googleDenied = params.get("error") === "unauthorized"; // Google signed someone in who is not on the list

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
  // identifier first: the password field and the reset / code options appear only for an address the server says is on the list
  const [known, setKnown] = useState(null); // { email, hasPassword, can: { password, code, link } }
  const [denied, setDenied] = useState(""); // the refusal for an address that is not on the list (the red warning)
  const [pauseEnd, setPauseEnd] = useState(0); // when a shut-out visitor may try again (ms); counted down on the warning
  const [pauseLen, setPauseLen] = useState(0);
  const [left, setLeft] = useState(0); // seconds of the pause still to run
  useEffect(() => {
    if (!pauseEnd) return undefined;
    const tick = () => {
      const l = Math.max(0, Math.ceil((pauseEnd - Date.now()) / 1000));
      setLeft(l);
      if (l === 0) {
        setPauseEnd(0);
        setDenied("");
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pauseEnd]);
  const clock = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

  const emailOpen = methods.password || methods.code;
  const [emailShown, setEmailShown] = useState(false);
  // the security check: a picture, a proof of work done in the background, and a pass that opens every email step for 15 minutes
  const gate = useGate(Boolean(auth.captcha) && emailShown);
  const post = async (path, body) => {
    const pass = await gate.obtain();
    return api(path, { method: "POST", body: pass ? { ...body, gate: pass } : body });
  }; // the email forms are folded away until "Sign in with Email" is pressed
  const canLink = Boolean(auth.emailReady);
  const go = (m) => {
    setDenied("");
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
    setDenied("");
    try {
      await fn();
    } catch (e) {
      if (e.code === "not_authorized") {
        // not on the list: the red warning, and nothing else — no reset, no code, no password field
        setDenied(e.message || NOT_AUTHORIZED);
        const secs = e.data && Number(e.data.retryAfter);
        if (secs > 0) {
          setPauseLen(secs);
          setPauseEnd(Date.now() + secs * 1000);
        }
        setKnown(null);
        setMode("password");
        setStep("ask");
        setPassword("");
      } else if (e.code === "gate_required") {
        // the pass ran out (or never was): back to the picture
        gate.forget();
        setKnown(null);
        setMode("password");
        setStep("ask");
        setError("Please complete the security check again.");
      } else {
        setError(e.message || "Something went wrong. Please try again.");
        setWrong(e.code === "bad_login" || e.code === "bad_code" || e.code === "locked");
      }
    }
    setBusy(false);
  };

  const checkEmail = (e) => {
    e.preventDefault();
    run(async () => {
      const d = await post("/api/auth/email/check", { email: email.trim() });
      setPauseEnd(0); // a listed address is never held by the pause
      setLeft(0);
      setEmail(d.email || email.trim());
      setKnown({ email: d.email || email.trim(), hasPassword: Boolean(d.hasPassword), can: d.can || {} });
      // a person with no password yet is taken to the way of choosing one; one whose password is switched off, to the code
      if (d.can && d.can.password === false && d.can.code) go("code");
      else if (!d.hasPassword && d.can && d.can.link) go("link");
    });
  };
  const changeEmail = () => {
    setKnown(null);
    go("password");
  };

  const signInPassword = (e) => {
    e.preventDefault();
    run(async () => {
      await post("/api/auth/email/login", { email: email.trim(), password, remember });
      setPassword("");
      await auth.reload();
    });
  };
  const ask = (path, then) => (e) => {
    e.preventDefault();
    run(async () => {
      const d = await post(path, { email: email.trim() });
      setNote(d.message || "");
      setStep(then);
    });
  };
  const signUp = (e) => {
    e.preventDefault();
    run(async () => {
      const d = await post("/api/auth/email/signup", { name: name.trim(), email: email.trim(), note: why.trim() });
      setNote(d.message || "");
      setStep("sent");
    });
  };
  const signInCode = (e) => {
    e.preventDefault();
    run(async () => {
      await post("/api/auth/email/code/verify", { email: email.trim(), code: code.replace(/\s+/g, ""), remember });
      await auth.reload();
    });
  };

  const emailField = (
    <div className="sg-field">
      <label htmlFor="sg-email">Email address</label>
      <input id="sg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" required spellCheck="false" autoCapitalize="none" autoFocus />
    </div>
  );
  // once the address is known to be on the list it is shown, not asked again
  const who = known && (
    <div className="sg-who">
      <span>
        Signing in as <b>{known.email}</b>
      </span>
      <button type="button" onClick={changeEmail}>
        Change
      </button>
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
        <a className="gate__top-home" href="/">
          <span aria-hidden="true">←</span> Home
        </a>
        <span className="gate__badge" aria-hidden="true">
          <IconShield />
        </span>
        <p className="gate__kicker">Private area</p>
        <h1 id="gate-title">
          Vinay&rsquo;s Private Room
          <small>(not for public use)</small>
        </h1>

        <div className="gate__notice" role="note">
          <p>
            Namaste, and thank you for visiting. This is a personal workspace of <b>Vinay Kumar Tiwari</b>, not a public service.
            If you have reached it by chance, please do not try to enter — you are most welcome on the public website instead.
          </p>
        </div>

        {googleDenied && !denied && (
          <div className="gate__denied" role="alert" key={denied || "google"}>
            <span className="gate__denied-ico" aria-hidden="true">
              <IconShield />
            </span>
            <div>
              <b>Access denied</b>
              <p>{denied || NOT_AUTHORIZED}</p>
            </div>
          </div>
        )}

        {(urlError || error) && !denied && (
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

        {/* a normal link, not fetch(): the browser has to follow Google's redirects */}
        {methods.google && !(emailShown && mode === "signup") && (
          <a className="gate__google" href="/api/auth/google/start">
            <IconGoogle />
            <span>Sign in with Google</span>
          </a>
        )}

        {methods.google && emailOpen && !emailShown && (
          <p className="sg-or" aria-hidden="true">
            <span>or</span>
          </p>
        )}

        {emailOpen && (
          <button type="button" className={`gate__email ${emailShown ? "is-open" : ""}`} aria-expanded={emailShown} aria-controls="gate-email" onClick={() => setEmailShown(!emailShown)}>
            <IconMail />
            <span>Sign in with Email</span>
            <i className="gate__chev" aria-hidden="true" />
          </button>
        )}

        {emailOpen && emailShown && (
          <div className="gate__email-panel" id="gate-email">
            {denied && (
              <div className="gate__denied" role="alert" key={denied || "google"}>
                <span className="gate__denied-ico" aria-hidden="true">
                  <IconShield />
                </span>
                <div>
                  <b>Access denied</b>
                  <p>{denied || NOT_AUTHORIZED}</p>
                  {left > 0 && (
                    <div className="gate__pause" role="timer" aria-label={`Paused for ${clock(left)}`}>
                      <span>
                        Addresses not on the list are paused for <b>{clock(left)}</b>. An address that is allowed is never held up — enter it above.
                      </span>
                      <i style={{ width: `${pauseLen ? Math.min(100, (left / pauseLen) * 100) : 0}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}
            {canLink && (
              <div className="sg-tabs" role="tablist" aria-label="Sign in or create an account">
                <button type="button" role="tab" aria-selected={mode !== "signup"} className={mode !== "signup" ? "is-on" : ""} onClick={() => go("password")}>
                  Sign in
                </button>
                <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-on" : ""} onClick={() => go("signup")}>
                  Create account
                </button>
              </div>
            )}

        {emailOpen && mode === "password" && !known && (
          <form className="sg-form" onSubmit={checkEmail} aria-label="Sign in with your email address">
            {emailField}
            {auth.captcha && <Captcha gate={gate} />}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {emailOpen && mode === "password" && methods.password && known && (
          <form className="sg-form" onSubmit={signInPassword} aria-label="Sign in with email and password">
            {who}
            <PasswordInput id="sg-pass" value={password} onChange={setPassword} autoFocus />
            {remembered}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <div className="sg-links">
              {canLink && known.can.link && (
                <button type="button" onClick={() => go("link")}>
                  Forgot your password, or first time here?
                </button>
              )}
              {methods.code && known.can.code && (
                <button type="button" onClick={() => go("code")}>
                  Email me a sign-in code instead
                </button>
              )}
            </div>
          </form>
        )}

        {emailOpen && mode === "code" && methods.code && known && (
          <form className="sg-form" onSubmit={step === "ask" ? ask("/api/auth/email/code", "enter") : signInCode} aria-label="Sign in with an emailed code">
            {who}
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

        {emailOpen && mode === "link" && known && (
          <form className="sg-form" onSubmit={step === "ask" ? ask("/api/auth/email/link", "sent") : (e) => {
              e.preventDefault();
              go("password");
            }} aria-label="Email me a link to choose a password">
            {step === "ask" && (
              <>
                <p className="sg-help">We will send a link to choose a new password to the address below. It works once, for an hour.</p>
                {who}
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
          <form className="sg-form" onSubmit={step === "ask" ? signUp : (e) => {
              e.preventDefault();
              go("password");
            }} aria-label="Create an account">
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
            {step === "ask" && auth.captcha && <Captcha gate={gate} />}
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

          </div>
        )}

        <p className="gate__fine">Only accounts authorised by the owner can sign in, however they arrive. Every attempt is checked by the server.</p>

        <a className="gate__home" href="/">
          ← Go to the public website
        </a>
      </section>
    </main>
  );
}
