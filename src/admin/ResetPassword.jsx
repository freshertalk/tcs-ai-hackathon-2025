// The page an emailed link opens: choose (or reset) the password. The link is checked first, so a used or
// expired one is said plainly instead of after typing. Public on purpose: the person is not signed in yet.

import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { GateFoot, PasswordInput } from "./Login";
import DrishtiLogo from "./DrishtiLogo";
import { adminPath } from "./paths";
import "./signin.css";
import "./gate-kite.css";

/** The same rules the server enforces, shown as they are met (the server has the last word). */
export function passwordRules(pw) {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const n = [...pw].length;
  return [
    { ok: n >= 10, text: "At least 10 characters" },
    { ok: n >= 16 || kinds >= 3, text: "Three of: lower case, upper case, digits, symbols — or 16 characters or more" },
  ];
}

export function Rules({ password }) {
  const rules = passwordRules(password);
  return (
    <ul className="sg-rules" aria-label="Password rules">
      {rules.map((r) => (
        <li key={r.text} className={r.ok ? "is-ok" : ""}>
          {r.text}
        </li>
      ))}
    </ul>
  );
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState("checking"); // checking | ready | bad | done
  const [who, setWho] = useState("");
  const [first, setFirst] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setState("bad");
      return;
    }
    api("/api/auth/email/token", { method: "POST", body: { token } })
      .then((d) => {
        setWho(d.email);
        setFirst(!d.hasPassword);
        setName(d.name || "");
        setState("ready");
      })
      .catch((e) => {
        setError(e.message);
        setState("bad");
      });
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/email/password", { method: "POST", body: { token, password, ...(first ? { name: name.trim() } : {}) } });
      setPassword("");
      setAgain("");
      setState("done");
    } catch (err) {
      setError(err.message);
      if (err.code === "expired") setState("bad");
    }
    setBusy(false);
  };

  return (
    <main className="gate">
      <section className="gate__panel" aria-labelledby="rp-title">
        <span className="gate__badge" aria-hidden="true">
          <DrishtiLogo size={56} />
        </span>
        <p className="gate__kicker">Private area</p>
        <h1 id="rp-title">{first ? "Complete your setup" : "Reset your password"}</h1>

        {state === "checking" && <p className="sg-help">Checking the link…</p>}

        {state === "bad" && (
          <>
            <p className="gate__error" role="alert">
              {error || "This link has expired or has already been used."}
            </p>
            <p className="sg-help">Go back to the sign-in page and ask for a new link: “Forgot your password, or first time here?”.</p>
            <Link className="sg-btn" style={{ display: "grid", placeItems: "center", width: "100%", textDecoration: "none" }} to={adminPath()}>
              Back to sign in
            </Link>
          </>
        )}

        {state === "ready" && (
          <form className="sg-form" onSubmit={submit}>
            <p className="sg-help">
              For <b>{who}</b>. Choose a password you do not use anywhere else. Every other device that is signed in will be signed out.
            </p>
            {/* a hidden user name lets a password manager save it against the right address */}
            <input type="text" name="username" autoComplete="username" value={who} readOnly hidden />
            {first && (
              <div className="sg-field">
                <label htmlFor="rp-name">Your name</label>
                <input id="rp-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              </div>
            )}
            <PasswordInput id="rp-new" label="New password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="rp-rules" />
            <div id="rp-rules">
              <Rules password={password} />
            </div>
            <PasswordInput id="rp-again" label="Type it again" value={again} onChange={setAgain} autoComplete="new-password" />
            {error && (
              <p className="gate__error" role="alert">
                {error}
              </p>
            )}
            <button className="sg-btn" disabled={busy}>
              {busy ? "Saving…" : first ? "Finish setup" : "Reset my password"}
            </button>
          </form>
        )}

        {state === "done" && (
          <>
            <p className="sg-note" role="status">
              {first ? "Your setup is complete. You can sign in now." : "Your password is saved. You can sign in with it now."}
            </p>
            <Link className="sg-btn" style={{ display: "grid", placeItems: "center", width: "100%", textDecoration: "none" }} to={adminPath()}>
              Go to sign in
            </Link>
          </>
        )}
      </section>
      <div className="gate__below">
        <GateFoot />
      </div>
    </main>
  );
}
