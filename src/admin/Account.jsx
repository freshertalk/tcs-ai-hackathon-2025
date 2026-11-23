// Your account: how you sign in, your password, signing out of every device, and your recent activity.
//
// Redesigned on 24 Nov 2026 as "My profile" (the account menu's link), in the private area's Kite look: a profile band
// (your photo, name, email, role, last sign-in, Sign out), then cards — how you sign in, your password, your devices — and
// your recent activity as a quiet timeline. The logic is unchanged.

import React, { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import Shell from "./Shell";
import { Alert, Loading } from "./ui";
import { PasswordInput } from "./Login";
import { Rules } from "./ResetPassword";
import { useDialog } from "./dialog/DialogProvider";
import { Avatar, roleLabel } from "./AccountMenu";
import { adminPath } from "./paths";
import "./signin.css";
import "./account-page.css";

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
// how each kind of activity is marked on the timeline: good (green), a warning (red), news (blue), plain
const TONE = { signin: "ok", password_set: "ok", password_changed: "ok", signin_failed: "bad", unauthorized_attempt: "bad", locked: "bad", password_change_failed: "bad", signout_forced: "bad", link_requested: "info", code_sent: "info", invite_sent: "info" };
const WHAT = {
  signin: "Signed in",
  signin_failed: "A failed sign-in",
  unauthorized_attempt: "A refused attempt (not on the list)",
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

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign(adminPath());
    }
  };
  const me = auth.user || {};
  const role = roleLabel(me) || (a && a.role === "superadmin" ? "Superadmin" : "Admin");
  const Method = ({ on, name, yes, no, detail }) => (
    <li className={`acp-method ${on ? "is-on" : ""}`}>
      <span className="acp-method__dot" aria-hidden="true">
        {on ? "✓" : "–"}
      </span>
      <span className="acp-method__txt">
        <b>{name}</b>
        <small>{on ? yes : no}</small>
      </span>
      {detail && <span className="acp-method__detail">{detail}</span>}
    </li>
  );

  return (
    <Shell crumb="My profile">
      <h1 className="adm-sr">My profile</h1>
      {!a && !msg.text && <Loading />}
      {a && (
        <div className="acp">
          <section className="acp-hero" aria-label="You">
            <Avatar user={{ ...me, name: a.name || me.name, email: a.email }} size={72} />
            <div className="acp-hero__txt">
              <p className="acp-hero__kicker">My profile</p>
              <h2 className="acp-hero__name">{a.name || me.name || "You"}</h2>
              <p className="acp-hero__mail">{a.email}</p>
              <p className="acp-hero__meta">
                <span className={`acp-role acp-role--${role.toLowerCase()}`}>{role}</span>
                <span>Last sign-in {when(a.lastLogin)}</span>
              </p>
            </div>
            <div className="acp-hero__act">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={signOut}>
                Sign out
              </button>
            </div>
          </section>

          <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>

          <div className="acp-grid">
            <section className="acp-card" aria-labelledby="acp-how">
              <header className="acp-card__head">
                <h3 id="acp-how">How you sign in</h3>
                <p>You are one person here whether you arrive with Google, a password or an emailed code.</p>
              </header>
              <ul className="acp-methods">
                <Method on={a.googleLinked} name="Google" yes="Linked to this account" no="Not used yet" />
                <Method on={a.hasPassword} name="Password" yes={a.passwordAt ? `Set · changed ${when(a.passwordAt)}` : "Set"} no={a.methods.password ? "Not set yet" : "Turned off by the owner"} />
                <Method on={a.emailVerified} name="Email" yes="Verified — codes and links reach you" no="Not verified yet" />
              </ul>
            </section>

            <section className="acp-card" aria-labelledby="acp-pw">
              <header className="acp-card__head">
                <h3 id="acp-pw">{a.hasPassword ? "Change your password" : "Choose a password"}</h3>
                <p>{a.hasPassword ? "Saving a new one signs your other devices out; this one stays signed in." : "A password lets you sign in without Google."}</p>
              </header>
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
                <form className="sg-form acp-form" onSubmit={change} autoComplete="off">
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

            <section className="acp-card" aria-labelledby="acp-dev">
              <header className="acp-card__head">
                <h3 id="acp-dev">Devices</h3>
                <p>Signed in on a shared or lost device? Sign out of everything and nothing stays open. This device stays signed in.</p>
              </header>
              <p>
                <button className="adm-btn adm-btn--danger" onClick={revoke} disabled={Boolean(busy)}>
                  Sign out of every device
                </button>
              </p>
            </section>

            <section className="acp-card acp-card--wide" aria-labelledby="acp-act">
              <header className="acp-card__head">
                <h3 id="acp-act">Recent activity on your account</h3>
                <p>The last {a.activity.length || "few"} sign-ins and changes, newest first.</p>
              </header>
              {!a.activity.length && <p className="adm-small">Nothing recorded yet.</p>}
              {a.activity.length > 0 && (
                <ol className="acp-timeline" aria-label="Recent activity">
                  {a.activity.map((x, i) => (
                    <li key={`${x.at}-${i}`} className={`acp-ev acp-ev--${TONE[x.type] || "plain"}`}>
                      <i className="acp-ev__dot" aria-hidden="true" />
                      <div className="acp-ev__txt">
                        <b>{WHAT[x.type] || x.type}</b>
                        <small>
                          {when(x.at)}
                          {x.method ? ` · ${x.method}` : ""}
                          {x.ip ? ` · ${x.ip}` : ""}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
      {!a && msg.text && <Alert>{msg.text}</Alert>}
    </Shell>
  );
}
