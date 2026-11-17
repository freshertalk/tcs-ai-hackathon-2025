// Your account: how you sign in, your password, signing out of every device, and your recent activity.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import Shell from "./Shell";
import { Alert, Loading } from "./ui";
import { PasswordInput } from "./Login";
import { Rules } from "./ResetPassword";
import { useDialog } from "./dialog/DialogProvider";
import "./signin.css";

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
const WHAT = {
  signin: "Signed in",
  signin_failed: "A failed sign-in",
  signout: "Signed out",
  signout_everywhere: "Signed out of every device",
  signout_forced: "Signed out by the owner",
  locked: "Locked after wrong tries",
  link_requested: "A link was requested",
  code_sent: "A code was sent",
  invite_sent: "An invitation was sent",
  password_set: "Password chosen",
  password_changed: "Password changed",
  password_change_failed: "A wrong current password was typed",
};

export default function Account() {
  const ask = useDialog();
  const auth = useAuth();
  const [a, setA] = useState(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState("");

  const load = () =>
    api("/api/auth/account")
      .then(setA)
      .catch((e) => setMsg({ kind: "error", text: e.message }));
  useEffect(() => {
    load();
  }, []);

  const run = async (name, fn) => {
    setBusy(name);
    setMsg({ kind: "", text: "" });
    try {
      await fn();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy("");
  };

  const change = (e) => {
    e.preventDefault();
    if (next !== again) return setMsg({ kind: "error", text: "The two new passwords are not the same." });
    return run("pw", async () => {
      await api("/api/auth/password/change", { method: "POST", body: { current, next } });
      setCurrent("");
      setNext("");
      setAgain("");
      setMsg({ kind: "ok", text: "Password saved. Your other devices were signed out; this one stays signed in." });
      await load();
      auth.reload();
    });
  };
  const emailLink = () =>
    run("link", async () => {
      const d = await api("/api/auth/email/link", { method: "POST", body: { email: a.email } });
      setMsg({ kind: "ok", text: d.message || "A link is on its way." });
    });
  const revoke = async () => {
    const yes = await ask({
      tone: "danger",
      title: "Sign out of every device?",
      body: <p>Every browser and phone signed in as you — including this one's old session — will have to sign in again. This device stays signed in.</p>,
      confirmText: "Sign out everywhere",
      cancelText: "Keep as is",
    });
    if (!yes) return;
    run("revoke", async () => {
      await api("/api/auth/sessions/revoke", { method: "POST", body: {} });
      setMsg({ kind: "ok", text: "Done. Every other device was signed out." });
      load();
    });
  };

  return (
    <Shell crumb="Your account" narrow>
      <h1 className="adm-h1">Your account</h1>
      <p className="adm-lead">How you sign in, and the keys to it. You are one person here whether you arrive with Google, a password or an emailed code.</p>

      {!a && !msg.text && <Loading />}
      {a && (
        <>
          <section className="adm-card">
            <h2>{a.name || "You"}</h2>
            <p className="adm-small">
              <b>{a.email}</b> · {a.role === "superadmin" ? "Superadmin" : "Admin"} · last sign-in {when(a.lastLogin)}
            </p>
            <p className="sg-chips">
              <span className={`sg-chip ${a.googleLinked ? "is-on" : ""}`}>Google {a.googleLinked ? "linked" : "not used yet"}</span>
              <span className={`sg-chip ${a.hasPassword ? "is-on" : ""}`}>Password {a.hasPassword ? "set" : "not set"}</span>
              <span className={`sg-chip ${a.emailVerified ? "is-on" : ""}`}>Email {a.emailVerified ? "verified" : "not verified"}</span>
            </p>
            {a.passwordAt && <p className="adm-small">Password last changed {when(a.passwordAt)}.</p>}
          </section>

          <section className="adm-card">
            <h2>{a.hasPassword ? "Change your password" : "Choose a password"}</h2>
            {!a.methods.password && <Alert kind="info">Signing in with a password is turned off by the owner.</Alert>}
            {a.methods.password && !a.hasPassword && !a.canSetPasswordDirectly && (
              <>
                <p className="adm-small">To make sure it is really you, the first password is chosen from a link we email to {a.email}.</p>
                <p>
                  <button className="adm-btn adm-btn--solid" onClick={emailLink} disabled={Boolean(busy)}>
                    {busy === "link" ? "Sending…" : "Email me the link"}
                  </button>
                </p>
              </>
            )}
            {a.methods.password && (a.hasPassword || a.canSetPasswordDirectly) && (
              <form className="sg-form" onSubmit={change} autoComplete="off">
                {a.hasPassword && <PasswordInput id="ac-cur" label="Current password" value={current} onChange={setCurrent} />}
                <PasswordInput id="ac-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" describedBy="ac-rules" />
                <div id="ac-rules">
                  <Rules password={next} />
                </div>
                <PasswordInput id="ac-again" label="Type it again" value={again} onChange={setAgain} autoComplete="new-password" />
                <div>
                  <button className="adm-btn adm-btn--solid" disabled={Boolean(busy)}>
                    {busy === "pw" ? "Saving…" : "Save password"}
                  </button>
                </div>
              </form>
            )}
            {a.hasPassword && !a.canSetPasswordDirectly && (
              <p className="adm-small">
                Forgot it?{" "}
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={emailLink} disabled={Boolean(busy)}>
                  Email me a reset link
                </button>
              </p>
            )}
          </section>

          <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>

          <section className="adm-card">
            <h2>Devices</h2>
            <p className="adm-small">If you signed in on a shared or lost device, sign out of everything and nothing stays open.</p>
            <p>
              <button className="adm-btn adm-btn--danger" onClick={revoke} disabled={Boolean(busy)}>
                Sign out of every device
              </button>
            </p>
          </section>

          <section className="adm-card">
            <h2>Recent activity on your account</h2>
            {!a.activity.length && <p className="adm-small">Nothing recorded yet.</p>}
            {a.activity.length > 0 && (
              <ul className="adm-people" aria-label="Recent activity">
                {a.activity.map((x, i) => (
                  <li key={`${x.at}-${i}`}>
                    <div>
                      <b>{WHAT[x.type] || x.type}</b>
                      <small>
                        {when(x.at)}
                        {x.method ? ` · ${x.method}` : ""}
                        {x.ip ? ` · ${x.ip}` : ""}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {!a && msg.text && <Alert>{msg.text}</Alert>}
    </Shell>
  );
}
